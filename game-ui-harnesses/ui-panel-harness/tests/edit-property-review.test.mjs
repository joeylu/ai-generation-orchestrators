import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {core,nodesOf} from './helpers.mjs';
import {panelFrameFixtures} from '../examples/panel-frame-v1/fixture.mjs';
import {createPanelEditContext,validatePanelEditContext,checkPanelEditProposal} from '../src/edit-planning.mjs';
import {materializeCodexEditDraft} from '../src/codex-edit-draft.mjs';
import {explicitPropertyRequirements,checkExplicitPropertyRequirements} from '../src/edit-property-review.mjs';
import {APPEARANCE_KEYS} from '../src/appearance.mjs';
import {TITLE_BAR_KEYS} from '../src/title-bar.mjs';
import {LAYOUT_DETAIL_KEYS} from '../src/layout-details.mjs';
import {createWorkbenchModel} from '../src/workbench-model.mjs';
import {createPanelBundle,validatePanelBundle} from '../src/panel-bundle.mjs';
import {applyPanelPatch} from '../src/patch.mjs';
import {digestJson} from '../src/canonical.mjs';
import {editWithCodex} from '../src/codex-planner.mjs';
const catalog=JSON.parse(await readFile(new URL('../examples/modern-adaptive.catalog.json',import.meta.url),'utf8'));
const {before}=await panelFrameFixtures(catalog,core);
const text='面板标题改为“角色资料”，改成蓝色主题，面板背景色改为#EAF4FF，标题字号30，确认按钮字号20，角色名默认值改为“蓝莓旅人”，其他保持不变。';
const request=t=>({requestVersion:'0.1',id:'panel-edit',target:'pixi',text:t});
const contextFor=(t=text,spec=before.spec,selection=null)=>createPanelEditContext(spec,catalog,request(t),selection,{requestChecks:'properties-v2'});
const context=await contextFor();
const appearance=extra=>Object.assign(Object.fromEntries(APPEARANCE_KEYS.map(k=>[k,null])),extra);
const titleStyle=extra=>Object.assign(Object.fromEntries(TITLE_BAR_KEYS.map(k=>[k,k==='padding'?0:null])),extra);
const details=extra=>({op:'set-layout-details',details:{...Object.fromEntries(LAYOUT_DETAIL_KEYS.map(k=>[k,null])),...extra}});
const operations=[{op:'set-panel-title',title:'角色资料'},{op:'set-theme',theme:{id:'modern-blue-light',version:'0.4.0'}},{op:'set-appearance',appearance:appearance({panelColor:'#EAF4FF'})},{op:'set-title-bar',style:titleStyle({fontSize:30})},{op:'set-button-font-size',rowId:'row2',fontSize:20},{op:'set-state-initial',fieldId:'row1',value:'蓝莓旅人'}];
const draft=(c,ops=operations)=>({codexEditDraftVersion:'0.3',contextSha256:c.sha256,patch:{patchVersion:'0.1',baseSpecSha256:c.baseSpecSha256,reason:c.request.text,operations:ops},bases:ops.map(()=>({kind:'request-interpretation',quote:c.request.text})),unresolved:[],noChange:null});
const raw=c=>{const d=draft(c);return {editProposalVersion:'0.1',contextSha256:c.sha256,patch:d.patch,decisions:d.bases.map((b,i)=>({operationIndex:i,basis:{...b,start:0,end:c.request.text.length}})),unresolved:[]};};

test('new policy binds six property targets plus the preservation marker; geometry-only saved context remains frozen',async()=>{
 assert.equal(context.editContextVersion,'0.12');assert.equal(context.requestChecks.items.length,6);assert(context.requestChecks.preserveRest.enforced);assert.deepEqual(await validatePanelEditContext(context),context);
 for(const i of context.requestChecks.items)assert.equal(text.slice(i.start,i.end),i.quote);
 const old=await createPanelEditContext(before.spec,catalog,request(text),null,{requestChecks:true});assert.equal(old.editContextVersion,'0.11');assert.equal(old.requestChecks.items.length,0);assert.deepEqual(await validatePanelEditContext(old),old);
});

test('complete result changes actual rendered title, panel color and fonts while default changes preserve live input',async()=>{
 const m=await createWorkbenchModel({catalog,pool:null},core);await m.importPanel(before);const c=(await m.prepareEdit(request(text))).context;
 const proposal=await materializeCodexEditDraft(c,draft(c)),report=await checkPanelEditProposal(c,proposal);assert.equal(report.requestCheck.items.length,7);assert.equal(report.requestCheck.preserveRest.status,'MATCHED');assert.equal(report.semanticReview,'NOT_RUN');
 await m.acceptEditProposal(proposal);const b=m.getSnapshot().panel,ns=nodesOf(b.componentBundle.document);assert.equal(b.spec.title,'角色资料');assert.equal(b.spec.state.find(s=>s.id==='row1').initial,'蓝莓旅人');assert.equal(b.state.row1,'蓝莓玩家');assert.equal(m.getEditBudget().used,1);
 assert.equal(ns.find(n=>n.id===b.spec.id+'.title').props.style.fontSize,30);assert.equal(ns.find(n=>n.id===b.spec.id+'.title').props.text,'角色资料');assert.equal(ns.find(n=>n.id===b.spec.id+'.panel').props.style.backgroundColor,'#EAF4FF');
 assert(ns.some(n=>n.id.includes('row2')&&n.type==='Text'&&n.props.style.fontSize===20));assert.deepEqual(await validatePanelBundle(await m.exportPanel(),core),b);m.dispose();
});

for(let omitted=0;omitted<operations.length;omitted++)test('a proposal cannot quote the entire request to hide missing property '+operations[omitted].op,async()=>{
 await assert.rejects(materializeCodexEditDraft(context,draft(context,operations.filter((_,i)=>i!==omitted))),error=>{assert.equal(error.code,'EDIT_REQUEST_INCOMPLETE');assert(error.requestCheck.items.some(i=>!i.matched));return true;});
});

for(const extra of [details({gap:18}),{op:'set-row-enabled',rowId:'row1',enabled:false},{op:'set-button-action',rowId:'row3',action:{kind:'submit',fields:['row1']}}])test('other-unchanged rejects unrequested authored changes '+extra.op,async()=>{
 const ops=[...operations,extra];
 const m=await createWorkbenchModel({catalog,pool:null},core);await m.importPanel(before);const c=(await m.prepareEdit(request(text))).context,p=raw(c);p.patch.operations=ops;p.decisions=ops.map((_,i)=>({operationIndex:i,basis:p.decisions[0].basis}));
 await assert.rejects(m.acceptEditProposal(p),error=>{assert.equal(error.code,'EDIT_REQUEST_INCOMPLETE');assert.equal(error.requestCheck.preserveRest.status,'MISMATCH');return true;});assert.deepEqual(m.getSnapshot().panel,before);assert.equal(m.getEditBudget().used,0);m.dispose();
});

test('clear correction/example/answer and duplicate-target requests remain unverified rather than guessed',()=>{
 for(const t of ['比如标题字号30，内边距24','标题字号30不对，改32','问题1：字号30，回答：32','面板标题改为“甲”，面板标题改为“乙”','角色名默认值改为50','面板标题改为“未闭合，内边距24']){
  const r=explicitPropertyRequirements(t,before.spec,catalog);assert.equal(r.items.length,0);assert(!r.preserveRest.enforced);assert(r.unverified.length);
 }
});

test('quoted punctuation, spaces and astral text keep exact values and offsets without suppressing geometry checks',()=>{
 const t='面板标题改为“名字，Hello 🎵”，内边距 24，其他保持不变。',r=explicitPropertyRequirements(t,before.spec,catalog);assert.equal(r.items.length,2);assert.equal(r.items[0].expected,'名字，Hello 🎵');assert.equal(r.items[1].expected,24);assert(r.preserveRest.enforced);for(const i of r.items)assert.equal(t.slice(i.start,i.end),i.quote);
});

test('unknown relative prose does not turn the rest-preservation marker into a false guarantee',async()=>{
 const c=await contextFor('面板标题改为“角色资料”，排得更舒服一点，其他保持不变。');assert(c.requestChecks.preserveRest.requested);assert(!c.requestChecks.preserveRest.enforced);
 const p=await materializeCodexEditDraft(c,draft(c,[operations[0],details({gap:18})]));assert.equal((await checkPanelEditProposal(c,p)).requestCheck.preserveRest.status,'NOT_CHECKED');
});

test('selected and unique named buttons use stable IDs; duplicate or other-target labels are not guessed',async()=>{
 const c=await contextFor('这个按钮字号24，其他保持不变。',before.spec,{rowId:'row2'});assert.equal(c.requestChecks.items[0].target,'row2');await materializeCodexEditDraft(c,draft(c,[{op:'set-button-font-size',rowId:'row2',fontSize:24}]));
 const other=await contextFor('取消按钮字号24',before.spec,{rowId:'row2'});assert.equal(other.requestChecks.items.length,0);
 const s=structuredClone(before.spec);s.sections[0].rows.find(r=>r.id==='row3').buttonLabel='确认';assert.equal(explicitPropertyRequirements('确认按钮字号24',s,catalog).items.length,0);
});

test('inherited property values already satisfied need no writes; false no-change claims still fail',async()=>{
 const c=await contextFor('标题字号28，确认按钮字号16，面板背景色改为#ffffff，其他保持不变。');const p={codexEditDraftVersion:'0.3',contextSha256:c.sha256,patch:null,bases:null,unresolved:[],noChange:{reason:'已符合',quote:c.request.text}};
 assert.equal((await checkPanelEditProposal(c,await materializeCodexEditDraft(c,p))).status,'NO_CHANGES');
 const wrong=await contextFor('标题字号30');await assert.rejects(materializeCodexEditDraft(wrong,{...p,contextSha256:wrong.sha256,noChange:{...p.noChange,quote:wrong.request.text}}),{code:'EDIT_REQUEST_INCOMPLETE'});
});

test('typed numeric and boolean defaults target unique controls without coercing quoted numbers',()=>{
 const s=structuredClone(before.spec);s.sections[0].rows=[{id:'volume',label:'主音量',kind:'slider',bind:'volume'},{id:'mute',label:'静音',kind:'toggle',bind:'mute'}];s.state=[{id:'volume',type:'number',initial:70},{id:'mute',type:'boolean',initial:false}];
 const r=explicitPropertyRequirements('主音量默认值50，静音默认开启，其他保持不变',s,catalog);assert.deepEqual(r.items.map(i=>i.expected),[50,true]);
 assert.equal(explicitPropertyRequirements('主音量默认值“50”',s,catalog).items.length,0);const result=structuredClone(s);result.state[0].initial=50;result.state[1].initial=true;assert.equal(checkExplicitPropertyRequirements(r,result,catalog,s).status,'MATCHED');
});

test('preset color-family requests keep mode, bind exact catalog versions, and preserve custom overrides',async()=>{
 const s=structuredClone(before.spec);s.theme={id:'modern-blue-dark',version:'0.4.0'};const r=explicitPropertyRequirements('改成绿色主题',s,catalog);assert.deepEqual(r.items[0].expected,{id:'modern-mint-dark',version:'0.4.0'});
 const same=structuredClone(s);assert.equal(checkExplicitPropertyRequirements(r,same,catalog,s).status,'MISMATCH');same.theme=r.items[0].expected;assert.equal(checkExplicitPropertyRequirements(r,same,catalog,s).status,'MATCHED');
});

test('fully explicit geometry and preservation permit deterministic frame/canvas derivation but protect other layout',async()=>{
 const c=await contextFor('改成9:16竖版，宽480，内边距28，其他保持不变。');const ops=[{op:'set-panel-ratio',ratio:{width:9,height:16},width:480},details({padding:28})];await materializeCodexEditDraft(c,draft(c,ops));
 await assert.rejects(materializeCodexEditDraft(c,draft(c,[ops[0],details({padding:28,gap:18})])),{code:'EDIT_REQUEST_INCOMPLETE'});
});

test('forged request checks and preservation flags cannot be laundered by rehashing the context',async()=>{
 for(const mutate of [c=>c.requestChecks.items.pop(),c=>c.requestChecks.preserveRest.enforced=false,c=>c.requestChecks.items[5].target='row2']){const c=structuredClone(context);mutate(c);delete c.sha256;c.sha256=await digestJson(c);await assert.rejects(validatePanelEditContext(c));}
});

test('published schema pins new policy, item structure and preservation metadata',async()=>{
 const s=JSON.parse(await readFile(new URL('../schemas/panel-edit-context-v0.12.schema.json',import.meta.url),'utf8'));assert.equal(s.properties.editContextVersion.const,'0.12');for(const b of s.properties.capabilities.anyOf)assert.equal(b.properties.requestCheckPolicy.const,'explicit-properties-v2');assert(s.properties.requestChecks.required.includes('preserveRest'));assert(s.properties.requestChecks.properties.items.items.required.includes('target'));
});

test('CLI substitute receives the new guidance and checks the single response without real compute',async()=>{
 let calls=0,prompt='';const outputRoot=await mkdtemp(new URL('../.tmp/property-review-cli-',import.meta.url));
 const runProcess=()=>{calls++;const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>true;child.stdin=new Writable({write(chunk,encoding,cb){prompt+=chunk;cb();},final(cb){cb();queueMicrotask(()=>{child.stdout.write([{type:'thread.started',thread_id:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'},{type:'turn.started'},{type:'item.completed',item:{type:'agent_message',text:JSON.stringify(draft(context))}},{type:'turn.completed',usage:{input_tokens:1,cached_input_tokens:0,output_tokens:1}}].map(v=>JSON.stringify(v)).join('\n')+'\n');child.emit('close',0);});}});return child;};
 const result=await editWithCodex(context,{outputRoot,executable:process.execPath,runProcess});assert.equal(calls,1);assert.equal(result.receipt.automaticRetries,0);assert(prompt.includes('panel-edit-property-checks.md'));assert(prompt.includes('preserveRest'));assert.equal(result.report.requestCheck.items.length,7);
});
