import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {core} from './helpers.mjs';
import {panelFrameFixtures} from '../examples/panel-frame-v1/fixture.mjs';
import {explicitEditRequirements,checkExplicitEditRequirements,describePanelChanges,editChangeValue} from '../src/edit-review.mjs';
import {createPanelEditContext,validatePanelEditContext,checkPanelEditProposal} from '../src/edit-planning.mjs';
import {materializeCodexEditDraft} from '../src/codex-edit-draft.mjs';
import {createWorkbenchModel} from '../src/workbench-model.mjs';
import {createCodexDiagnostic,validateCodexDiagnostic} from '../src/codex-diagnostics.mjs';
import {digestJson} from '../src/canonical.mjs';
import {LAYOUT_DETAIL_KEYS} from '../src/layout-details.mjs';
import {editWithCodex} from '../src/codex-planner.mjs';
import {createPanelBundle} from '../src/panel-bundle.mjs';
import {validatePanelSpec} from '../src/spec.mjs';
const catalog=JSON.parse(await readFile(new URL('../examples/modern-adaptive.catalog.json',import.meta.url),'utf8'));
const fixture=await panelFrameFixtures(catalog,core),baseSpec=structuredClone(fixture.before.spec);
baseSpec.layout.padding=20;baseSpec.layout.gap=8;
const before=await createPanelBundle(baseSpec,catalog,core,fixture.before.state);
const text='改成9:16竖版，宽480，内边距24，标题区域高56，间距12，保留字号、当前输入和按钮行为。';
const request=t=>({requestVersion:'0.1',id:'panel-edit',target:'pixi',text:t});
const details=values=>({op:'set-layout-details',details:{...Object.fromEntries(LAYOUT_DETAIL_KEYS.map(key=>[key,null])),...values}});
const ops=[{op:'set-panel-ratio',ratio:{width:9,height:16},width:480},details({padding:24,titleHeight:56,gap:12})];
const makeContext=(t=text,spec=before.spec,selection=null)=>createPanelEditContext(spec,catalog,request(t),selection,{requestChecks:true});
const draft=(c,operations=ops)=>({codexEditDraftVersion:'0.3',contextSha256:c.sha256,patch:{patchVersion:'0.1',baseSpecSha256:c.baseSpecSha256,reason:c.request.text,operations},bases:operations.map(()=>({kind:'request-interpretation',quote:c.request.text})),unresolved:[],noChange:null});
const noChange=c=>({codexEditDraftVersion:'0.3',contextSha256:c.sha256,patch:null,bases:null,unresolved:[],noChange:{reason:'已经符合',quote:c.request.text}});
const context=await makeContext();

test('program-owned checks bind exact source and selection to a new context; older contexts remain exact',async()=>{
 assert.equal(context.editContextVersion,'0.11');assert.equal(context.requestChecks.items.length,5);assert.deepEqual(await validatePanelEditContext(context),context);
 for(const item of context.requestChecks.items)assert.equal(context.request.text.slice(item.start,item.end),item.quote);
 for(const options of [{},{panelFrame:true},{layoutDetails:true}]){const c=await createPanelEditContext(before.spec,catalog,request(text),null,options);assert(!c.requestChecks);assert.deepEqual(await validatePanelEditContext(c),c);}
 const selected=await makeContext('宽480',before.spec,{rowId:'row1'});assert.equal(selected.requestChecks.items.length,0);assert.deepEqual(await validatePanelEditContext(selected),selected);
});

test('deleting or amending a check then recomputing the digest cannot weaken the gate',async()=>{
 for(const mutate of [c=>c.requestChecks.items.pop(),c=>c.requestChecks.items[0].expected.width=1,c=>delete c.requestChecks,c=>c.capabilities.requestCheckPolicy='OFF']){
  const c=structuredClone(context);mutate(c);delete c.sha256;c.sha256=await digestJson(c);await assert.rejects(validatePanelEditContext(c));
 }
});

test('partial patch quoting the full request is rejected without changing model, preview, history, values or rounds',async()=>{
 let presents=0;const m=await createWorkbenchModel({catalog,pool:null},core,async()=>{presents++;});await m.importPanel(before);
 const c=(await m.prepareEdit(request(text))).context,snapshot=m.getSnapshot();
 const partial=draft(c,[ops[0]]),proposal={editProposalVersion:'0.1',contextSha256:c.sha256,patch:partial.patch,decisions:[{operationIndex:0,basis:{kind:'request-interpretation',start:0,end:text.length,quote:text}}],unresolved:[]};
 await assert.rejects(m.acceptEditProposal(proposal),error=>{assert.equal(error.code,'EDIT_REQUEST_INCOMPLETE');assert.deepEqual(error.requestCheck.items.filter(i=>!i.matched).map(i=>i.field),['padding','titleHeight','gap']);return true;});
 assert.deepEqual(m.getSnapshot(),snapshot);assert.equal(m.getEditBudget().used,0);assert.equal(presents,1);m.dispose();
});

test('full composite is checked from final Spec and actual changes, counted once, with state intact',async()=>{
 const m=await createWorkbenchModel({catalog,pool:null},core);await m.importPanel(before);const c=(await m.prepareEdit(request(text))).context;
 const proposal=await materializeCodexEditDraft(c,draft(c)),report=await checkPanelEditProposal(c,proposal);
 assert.equal(report.requestCheck.status,'MATCHED');assert.equal(report.requestCheck.items.length,5);assert.equal(report.semanticReview,'NOT_RUN');assert(report.requestCheck.unverifiedCount>0);
 await m.acceptEditProposal(proposal);const s=m.getSnapshot();assert.equal(m.getEditBudget().used,1);assert.deepEqual(s.panel.state,before.state);
 assert(s.history[0].changes.some(v=>v.path==='layout.padding'&&v.after===24));assert(!s.history[0].changes.some(v=>v.path==='canvas'||v.path==='panelSpecVersion'));assert.equal(s.history[0].editEvidence.report.requestCheck.status,'MATCHED');
 const exported=await m.exportPanel();await m.importPanel(exported);assert.equal(m.getSnapshot().history.length,0);assert.equal(m.getEditBudget().used,1);m.dispose();
});

test('wrong numbers and fabricated no-change claims are both blocked',async()=>{
 await assert.rejects(materializeCodexEditDraft(context,draft(context,[ops[0],details({padding:24,titleHeight:56,gap:13})])),{code:'EDIT_REQUEST_INCOMPLETE'});
 await assert.rejects(materializeCodexEditDraft(context,noChange(context)),{code:'EDIT_REQUEST_INCOMPLETE'});
});

test('already-satisfied requirements allow no-change and do not force duplicate writes',async()=>{
 const t='内边距'+before.spec.layout.padding,c=await makeContext(t);
 const p=await materializeCodexEditDraft(c,noChange(c));assert.equal((await checkPanelEditProposal(c,p)).status,'NO_CHANGES');
 const next=await materializeCodexEditDraft(c,draft(c,[{op:'set-panel-title',title:'新标题'}]));assert.equal((await checkPanelEditProposal(c,next)).requestCheck.status,'MATCHED');
});

test('clarifications are not forced into partial patches and retain the original panel',async()=>{
 const p=await materializeCodexEditDraft(context,{codexEditDraftVersion:'0.3',contextSha256:context.sha256,patch:null,bases:null,unresolved:[{id:'fit',question:'固定高度不够放下正文，允许滚动吗？'}],noChange:null});
 const report=await checkPanelEditProposal(context,p);assert.equal(report.status,'NEEDS_INPUT');assert(!report.requestCheck);
});

for(const t of ['不要改成9:16','不要把内边距改成24','内边距加24','内边距减小一点','标题字号24','标题区域至少56','按钮宽480','正文改成“内边距24”，间距12','比如宽480，内边距24','内边距24，内边距20','内边距24不对，改20','问题1：内边距24，回答：20'])test('does not pretend to validate ambiguous, quoted, relative or other-target prose: '+t,()=>{
 const r=explicitEditRequirements(t);assert.equal(r.items.length,0);assert.equal(checkExplicitEditRequirements(r,before.spec).status,'NOT_CHECKED');
});

test('numeric aliases, spaces, CRLF offsets, fractional height and proportional frames are deterministic',()=>{
 const t='🎵保留输入\r\n把面板宽度改为 480 px；面板高度853.333像素；内边距设为24，标题区域高度56，布局间距12';
 const r=explicitEditRequirements(t);assert.equal(r.items.length,5);for(const i of r.items)assert.equal(t.slice(i.start,i.end),i.quote);
 const ratio=explicitEditRequirements('面板比例为9:16');assert.equal(checkExplicitEditRequirements(ratio,{frame:{width:480,height:480*16/9},layout:{}}).status,'MATCHED');assert.equal(checkExplicitEditRequirements(ratio,{frame:null,layout:{}}).status,'MISMATCH');
 assert.equal(checkExplicitEditRequirements(explicitEditRequirements('面板高600'),{frame:null,layout:{maxHeight:600}}).status,'MISMATCH');
});

test('request lists are bounded without losing the source of unchecked trailing prose',()=>{
 const t=Array.from({length:200},(_,i)=>'保持控件'+i).join('，'),r=explicitEditRequirements(t);assert.equal(r.unverified.length,64);assert.equal(t.slice(r.unverified.at(-1).start,r.unverified.at(-1).end),r.unverified.at(-1).quote);assert(r.unverified.at(-1).quote.endsWith('保持控件199'));
});

test('inserted controls are compared by stable ID, and default changes differ from live values',()=>{
 const a=structuredClone(before.spec),b=structuredClone(a);b.sections[0].rows.unshift({...a.sections[0].rows[0],id:'new',label:'说明'});b.state.find(f=>f.id==='row1').initial='新默认名';
 const changes=describePanelChanges(a,b);assert.equal(changes.filter(c=>c.path.startsWith('row.')).length,1);assert(changes.some(c=>c.path==='row.new'));assert(changes.some(c=>c.path==='state.row1.initial'&&c.after==='新默认名'));
});

test('change summaries include actual font and wrap fields, and format dimensions without implementation JSON',()=>{
 const a=structuredClone(before.spec),b=structuredClone(a);b.buttonFonts=[{rowId:'row2',fontSize:32}];b.textLayouts=[];b.sections[0].rows[0].text='说明';validatePanelSpec(b);
 const changes=describePanelChanges(a,b);assert(changes.some(c=>c.path==='buttonFonts'&&c.label==='按钮字号'));assert(changes.some(c=>c.path==='textLayouts'&&c.label==='文字换行'));
 assert.equal(editChangeValue({width:480,height:480*16/9}),'480 × 853.33');assert.equal(editChangeValue(false),'关闭');assert.equal(editChangeValue(''),'空字符串');
});

test('published context schema requires program-owned checks and the capability in both selection branches',async()=>{
 const schema=JSON.parse(await readFile(new URL('../schemas/panel-edit-context-v0.11.schema.json',import.meta.url),'utf8'));
 assert(schema.required.includes('requestChecks'));assert.equal(schema.properties.editContextVersion.const,'0.11');
 for(const branch of schema.properties.capabilities.anyOf){assert(branch.required.includes('requestCheckPolicy'));assert.equal(branch.properties.requestCheckPolicy.const,context.capabilities.requestCheckPolicy);}
 assert.deepEqual(new Set(schema.properties.requestChecks.properties.items.items.properties.field.enum),new Set(['width','height','ratio','padding','gap','titleHeight','sectionTitleHeight','rowHeight','labelWidth']));
});

test('presentation failure publishes no changes or rounds; undo returns to the preceding applied summary',async()=>{
 let reject=false;const m=await createWorkbenchModel({catalog,pool:null},core,async()=>{if(reject)throw Error('RENDER_FAILED');});await m.importPanel(before);let c=(await m.prepareEdit(request(text))).context;
 reject=true;await assert.rejects(m.acceptEditProposal(await materializeCodexEditDraft(c,draft(c))),/RENDER_FAILED/);assert.equal(m.getSnapshot().history.length,0);assert.equal(m.getEditBudget().used,0);
 reject=false;await m.acceptEditProposal(await materializeCodexEditDraft(c,draft(c)));const summary=m.getSnapshot().history[0].changes;
 c=(await m.prepareEdit(request('内边距20'))).context;await m.acceptEditProposal(await materializeCodexEditDraft(c,draft(c,[details({padding:20})])));await m.undo();assert.deepEqual(m.getSnapshot().history[0].changes,summary);assert.equal(m.getEditBudget().used,2);m.dispose();
});

test('bounded diagnostics retain the new code and never contain request text or rejected values',async()=>{
 let error;try{await materializeCodexEditDraft(context,draft(context,[ops[0]]));}catch(e){error=e;}
 const d=createCodexDiagnostic(error,{operation:'edit',contextSha256:context.sha256,proposalJsonSha256:'a'.repeat(64),stage:'proposal-validation'});
 assert.equal(d.validatorCode,'EDIT_REQUEST_INCOMPLETE');assert.deepEqual(validateCodexDiagnostic(d),d);assert(!JSON.stringify(d).includes('内边距'));assert(!JSON.stringify(d).includes('requestCheck'));
});

test('fake CLI gets the contract and rejects an incomplete single response without retry or real compute',async()=>{
 let calls=0,prompt='';const outputRoot=await mkdtemp(new URL('../.tmp/edit-review-cli-',import.meta.url));
 const runProcess=()=>{calls++;const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>true;child.stdin=new Writable({write(chunk,encoding,callback){prompt+=chunk;callback();},final(callback){callback();queueMicrotask(()=>{child.stdout.write([{type:'thread.started',thread_id:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'},{type:'turn.started'},{type:'item.completed',item:{type:'agent_message',text:JSON.stringify(draft(context,[ops[0]]))}},{type:'turn.completed',usage:{input_tokens:1,cached_input_tokens:0,output_tokens:1}}].map(v=>JSON.stringify(v)).join('\n')+'\n');child.emit('close',0);});}});return child;};
 await assert.rejects(editWithCodex(context,{outputRoot,executable:process.execPath,runProcess}),error=>error.diagnostic?.validatorCode==='EDIT_REQUEST_INCOMPLETE');assert.equal(calls,1);assert(prompt.includes('panel-edit-request-checks.md'));assert(prompt.includes('requestChecks'));
});
