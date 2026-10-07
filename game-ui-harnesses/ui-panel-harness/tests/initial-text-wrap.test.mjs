import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {core,nodesOf} from './helpers.mjs';
import {initialWrapFixture,initialWrapIntent,initialBody,initialRequest} from '../examples/initial-text-wrap-v1/fixture.mjs';
import {createPlanningContext,validatePlanningContext} from '../src/planning-context.mjs';
import {buildNativePanelIntentResponseSchema,materializePanelIntent,validateNativePanelIntentEvidence} from '../src/panel-intent.mjs';
import {checkPanelProposal,validatePanelProposal} from '../src/proposal.mjs';
import {createPanelBundle,validatePanelBundle} from '../src/panel-bundle.mjs';
import {createWorkbenchModel} from '../src/workbench-model.mjs';
import {planWithCodex} from '../src/codex-planner.mjs';
import {digestJson} from '../src/canonical.mjs';
import {controlId} from '../src/compiler.mjs';
import {projectPanelEvent} from '../src/state.mjs';
import {createUnityDocument} from '../src/unity-export.mjs';
import {composePanelBundles,validatePanelComposition} from '../src/panel-composition.mjs';
const catalog=JSON.parse(await readFile(new URL('../examples/modern-adaptive.catalog.json',import.meta.url),'utf8'));
const {context,intent}=await initialWrapFixture(catalog);
const proposal=await materializePanelIntent(context,intent),bundle=await createPanelBundle(proposal.spec,catalog,core);
const lines=(b=bundle,id='row0')=>nodesOf(b.componentBundle.document).filter(n=>n.id===controlId(b.spec.id,id)||n.id.startsWith(controlId(b.spec.id,id)+'.line'));
const make=async i=>createPanelBundle((await materializePanelIntent(context,i)).spec,catalog,core);
const patch=async(spec,operations)=>({patchVersion:'0.1',baseSpecSha256:await digestJson(spec),reason:'Authored body edit.',operations});

test('current generation advertises wrapping; old contexts and native schemas keep their exact contracts',async()=>{
 assert.equal(context.planningContextVersion,'0.9');assert.equal(context.capabilities.textWrap,'static-text-wrap-v1');assert(context.capabilities.panelSpecVersions.includes('0.13'));
 assert.deepEqual(await validatePlanningContext(context),context);
 const schema=buildNativePanelIntentResponseSchema(context),text=schema.$defs.body.anyOf[0].properties.rows.items.anyOf.find(r=>r.properties.kind.enum[0]==='text');
 assert.deepEqual(schema.properties.panelIntentVersion.enum,['0.10']);assert(text.required.includes('wrap'));assert.deepEqual(text.properties.wrap.enum,['none','word']);
 const old=await createPlanningContext(initialRequest,catalog,undefined,{actionLayouts:true});assert.equal(old.planningContextVersion,'0.8');assert.deepEqual(await validatePlanningContext(old),old);
 const oldSchema=buildNativePanelIntentResponseSchema(old);assert.deepEqual(oldSchema.properties.panelIntentVersion.enum,['0.9']);assert(!JSON.stringify(oldSchema).includes('"wrap"'));
 const saved=initialWrapIntent(old,'短说明');saved.panelIntentVersion='0.9';delete saved.panel.body.children[0].rows[0].wrap;
 const a=await materializePanelIntent(old,saved);assert.equal(a.spec.panelSpecVersion,'0.7');assert.deepEqual(await materializePanelIntent(old,saved),a);
 await assert.rejects(materializePanelIntent(old,intent));assert.throws(()=>validateNativePanelIntentEvidence(context,saved),{code:'INTENT_VERSION'});
 const spoof=structuredClone(context);delete spoof.capabilities.textWrap;await assert.rejects(validatePlanningContext(spoof));
});
test('three paragraphs generate complete, measured text without expanding the requested width or inventing state',async()=>{
 assert.equal(proposal.proposalVersion,'0.9');assert.equal(proposal.spec.panelSpecVersion,'0.13');assert.equal(proposal.spec.layout.width,480);
 assert.deepEqual(proposal.spec.textLayouts,[{rowId:'row0',wrap:'word'}]);assert.equal(proposal.spec.sections[0].rows[0].text,initialBody);
 assert.equal((await checkPanelProposal(context,proposal)).status,'READY_TO_COMPILE');validateNativePanelIntentEvidence(context,intent);
 assert(lines().length>10);assert(lines().some(n=>n.props.text===''));assert.equal(lines().map(n=>n.props.text).join('').replace(/\s/gu,''),initialBody.replace(/\s/gu,''));
 assert.equal(bundle.spec.state.length,1);assert.deepEqual(bundle.spec.sections[0].rows[2].action.fields,['row1']);assert.deepEqual(await validatePanelBundle(bundle,core),bundle);
 const missing=structuredClone(proposal);missing.decisions=missing.decisions.filter(d=>d.target!=='text-layout:row0');await assert.rejects(validatePanelProposal(context,missing),{code:'PLAN_COVERAGE'});
 const duplicate=structuredClone(proposal);duplicate.decisions.push(duplicate.decisions.find(d=>d.target==='text-layout:row0'));await assert.rejects(validatePanelProposal(context,duplicate),{code:'PLAN_TARGET'});
});
test('explicit single-line Text in the new transport retains the old Spec and layout behavior',async()=>{
 const i=initialWrapIntent(context,'请填写名字');i.panel.body.children[0].rows[0].wrap='none';
 const b=await make(i);assert.equal(b.spec.panelSpecVersion,'0.7');assert.equal(b.spec.textLayouts,undefined);assert.equal(lines(b).length,1);
 assert.equal(b.spec.sections[0].rows[0].text,'请填写名字');assert.deepEqual(b.spec.sections[0].rows[2].action.fields,['row1']);
});
test('long prose defaults to bounded width and scrolling; explicit error overflow fails atomically',async()=>{
 const i=initialWrapIntent(context,'正文应完整保留并且可滚动。'.repeat(60));i.panel.layout.width=null;i.panel.layout.maxHeight=300;
 const b=await make(i);assert(b.spec.layout.width<800);assert(nodesOf(b.componentBundle.document).some(n=>n.type==='ScrollView'));assert.equal(b.spec.sections[0].rows[0].text,i.panel.body.children[0].rows[0].text);
 i.panel.layout.overflow='error';const original=structuredClone(i);await assert.rejects(make(i));assert.deepEqual(i,original);
});
for(const [name,change] of [
 ['missing wrap',r=>delete r.wrap],['unsupported wrap',r=>r.wrap='ellipsis'],['extra geometry',r=>r.height=80],['too long',r=>r.text='x'.repeat(1001)],
 ['tab control',r=>r.text='a\tb'],['lone CR',r=>r.text='a\rb'],['lone surrogate',r=>r.text='a\ud800b'],['empty prose',r=>r.text='\n  '],['long unwrapped',r=>r.wrap='none'],['bad source',r=>r.sourceRef='previous-request'],
])test('invalid initial body rejects without mutation: '+name,async()=>{const i=structuredClone(intent);change(i.panel.body.children[0].rows[0]);const copy=structuredClone(i);await assert.rejects(make(i));assert.deepEqual(i,copy);});
test('LF/CRLF, emoji graphemes and explicit empty paragraphs survive generation',async()=>{
 const value='第一段\r\n\r\n👩‍👩‍👧‍👦 e\u0301\n最后一段',b=await make(initialWrapIntent(context,value));assert.equal(b.spec.sections[0].rows[0].text,value);
 assert.deepEqual(lines(b).map(n=>n.props.text),['第一段','','👩‍👩‍👧‍👦 e\u0301','最后一段']);
});
test('wrapping includes every row ordinal across nested sections and tabs',async()=>{
 const i=structuredClone(intent),first=i.panel.body,second=structuredClone(first);second.children[0].rows[2].submitRows=[5];
 i.panel.body={kind:'tabs',enabled:true,sourceRef:'request',pages:[{label:'角色',sourceRef:'request',initial:true,body:first},{label:'其他',sourceRef:'request',initial:false,body:second}]};
 const b=await make(i);assert.deepEqual(b.spec.textLayouts.map(v=>v.rowId),['row0','row4']);assert.deepEqual(b.spec.sections[1].rows[2].action.fields,['row5']);assert(lines(b,'row4').length>10);assert.equal(b.spec.tabs.pages[1].sections[0],'section1');
});
test('a wrapped body and a separate horizontal button group coexist with correct submission references',async()=>{
 const i=structuredClone(intent),section=i.panel.body.children[0],buttons=section.rows.splice(2);
 i.panel.body.children.push({kind:'section',title:'操作',rows:buttons,actionLayout:{direction:'row',align:'end',gap:16,buttonWidth:120,buttonHeight:44,shape:'default',sourceRef:'request'}});
 const b=await make(i);assert.equal(b.spec.panelSpecVersion,'0.13');assert.deepEqual(b.spec.actionLayouts.map(l=>l.sectionId),['section1']);assert.deepEqual(b.spec.textLayouts.map(l=>l.rowId),['row0']);
 const controls=nodesOf(b.componentBundle.document).filter(n=>n.type==='Button');assert.equal(controls[0].layout.y,controls[1].layout.y);
 const p=await materializePanelIntent(context,i),schema=JSON.parse(await readFile(new URL('../schemas/panel-proposal-v0.9.schema.json',import.meta.url),'utf8'));
 // Reproduce the public target-schema mismatch: both extensions must be valid
 // public decisions, including IDs at the contract's maximum length.
 const target=schema.$defs.target;
 for(const value of [...p.decisions.map(d=>d.target),'action-layout:'+'a'.repeat(64),'text-layout:'+'a'.repeat(64)]){
  assert(value.length<=target.maxLength);assert.equal(target.oneOf.filter(branch=>branch.enum?branch.enum.includes(value):new RegExp(branch.pattern).test(value)).length,1,value);
 }
});
test('generated panel submits the shifted input and remains editable, undoable, composable and native UGUI-exportable',async()=>{
 const played={row1:'蓝莓玩家'},event=projectPanelEvent(bundle.spec,played,{type:'activate',id:controlId(bundle.spec.id,'row2'),source:'keyboard'});
 assert.equal(event.event.name,'panel.row2');assert.deepEqual(event.event.values,played);
 const model=await createWorkbenchModel({catalog,pool:null},core);const prepared=await model.prepare(initialRequest);assert.equal(prepared.context.planningContextVersion,'0.9');
 const own=await materializePanelIntent(prepared.context,initialWrapIntent(prepared.context));await model.acceptProposal(own);assert.equal(model.getEditBudget().used,0);
 await model.patch(await patch(model.getSnapshot().panel.spec,[{op:'set-text',rowId:'row0',text:'新的说明\n保留正文换行'}]),played);assert.equal(model.getEditBudget().used,1);assert.deepEqual(model.getSnapshot().panel.state,played);
 await model.undo();assert.equal(model.getEditBudget().used,1);assert.equal(model.getSnapshot().panel.spec.sections[0].rows[0].text,initialBody);model.dispose();
 const unity=await createUnityDocument(bundle,core);assert(unity);
 const other=await createPanelBundle({...bundle.spec,id:'other-body'},catalog,core);
 const request={panelCompositionRequestVersion:'0.1',id:'initial-composite',title:'组合',sources:[{namespace:'one',bundleSha256:bundle.sha256},{namespace:'two',bundleSha256:other.sha256}],layout:'tabs',width:480,canvasWidth:544,canvasHeight:700,maxHeight:600,surfaceFrom:null};
 const composition=await composePanelBundles(request,[bundle,other],core);assert.deepEqual(await validatePanelComposition(composition,[bundle,other],core),composition);
});

test('real CLI adapter accepts native 0.10 using one in-memory child, with no executable, network or model',async()=>{
 const outputRoot=await mkdtemp(new URL('../.tmp/initial-wrap-cli-',import.meta.url)),calls=[];
 const runProcess=(command,args,options)=>{
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();let prompt='';child.kill=()=>true;
  child.stdin=new Writable({write(chunk,encoding,callback){prompt+=chunk;callback();},final(callback){callback();queueMicrotask(async()=>{
   const schema=JSON.parse(await readFile(args[args.indexOf('--output-schema')+1],'utf8'));calls.push({command,options,prompt,schema});
   child.stdout.write([ {type:'thread.started',thread_id:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'}, {type:'turn.started'}, {type:'item.completed',item:{type:'agent_message',text:JSON.stringify(intent)}}, {type:'turn.completed',usage:{input_tokens:1,cached_input_tokens:0,output_tokens:1}} ].map(v=>JSON.stringify(v)).join('\n')+'\n');child.emit('close',0);
  });}});return child;
 };
 const result=await planWithCodex(context,{outputRoot,executable:process.execPath,runProcess});assert.equal(result.report.status,'READY_TO_COMPILE');assert.equal(calls.length,1);assert.deepEqual(calls[0].schema.properties.panelIntentVersion.enum,['0.10']);assert(calls[0].prompt.includes('panel-intent-v0.10')||calls[0].prompt.includes('PlanningContext 0.9'));assert.equal(result.proposal.spec.sections[0].rows[0].text,initialBody);assert.equal(result.receipt.automaticRetries,0);
});
