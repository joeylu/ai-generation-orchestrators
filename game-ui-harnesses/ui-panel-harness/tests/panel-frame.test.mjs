import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {core,nodesOf} from './helpers.mjs';
import {initialWrapFixture,initialWrapIntent} from '../examples/initial-text-wrap-v1/fixture.mjs';
import {materializePanelIntent} from '../src/panel-intent.mjs';
import {applyPanelPatch} from '../src/patch.mjs';
import {digestJson} from '../src/canonical.mjs';
import {createPanelBundle,validatePanelBundle} from '../src/panel-bundle.mjs';
import {createPanelEditContext,validatePanelEditContext} from '../src/edit-planning.mjs';
import {buildCodexEditResponseSchema,codexEditOperationContracts} from '../src/codex-edit-schema.mjs';
import {materializeCodexEditDraft} from '../src/codex-edit-draft.mjs';
import {createWorkbenchModel} from '../src/workbench-model.mjs';
import {editWithCodex} from '../src/codex-planner.mjs';
import {createUnityDocument} from '../src/unity-export.mjs';
import {projectPanelEvent} from '../src/state.mjs';
import {controlId} from '../src/compiler.mjs';
import {validatePanelSpec} from '../src/spec.mjs';
import {composePanelBundles,validatePanelComposition} from '../src/panel-composition.mjs';
const catalog=JSON.parse(await readFile(new URL('../examples/modern-adaptive.catalog.json',import.meta.url),'utf8'));
const {context:planning}=await initialWrapFixture(catalog);
const before=await createPanelBundle((await materializePanelIntent(planning,initialWrapIntent(planning,'角色名会展示给其他玩家，请使用喜欢的昵称。\n\n确认前可以继续修改。\n\n取消仅通知，不清空输入。'))).spec,catalog,core,{row1:'蓝莓玩家'});
const request={requestVersion:'0.1',id:'panel-edit',target:'pixi',text:'把实际面板改成16:9横版，宽640，正文重新换行，空间不足时滚动。保留字号、角色名输入和确认取消行为。'};
const context=await createPanelEditContext(before.spec,catalog,request,null,{panelFrame:true});
const ratio=(w,h,width=null)=>({op:'set-panel-ratio',ratio:{width:w,height:h},width});
const patch=async(spec,operations)=>({patchVersion:'0.1',baseSpecSha256:await digestJson(spec),reason:'Authored fixed panel frame.',operations});
async function change(operations,base=before){return validatePanelBundle(await createPanelBundle((await applyPanelPatch(base.spec,await patch(base.spec,operations))).spec,catalog,core,base.state),core);}
const card=b=>nodesOf(b.componentBundle.document).find(node=>node.id===b.spec.id+'.panel');
const draft=(c,operations)=>({codexEditDraftVersion:'0.3',contextSha256:c.sha256,patch:{patchVersion:'0.1',baseSpecSha256:c.baseSpecSha256,reason:c.request.text,operations},bases:operations.map(()=>({kind:'request-interpretation',quote:c.request.text})),unresolved:[],noChange:null});

test('new context offers fixed frames and ratios; old context stays exact and selected controls cannot resize the panel',async()=>{
 assert.equal(context.editContextVersion,'0.9');assert.equal(context.capabilities.panelFramePolicy,'fixed-panel-frame-v1');assert.deepEqual(await validatePanelEditContext(context),context);
 const schema=await buildCodexEditResponseSchema({draft:true,context}),ops=codexEditOperationContracts(schema,context);assert(ops.some(op=>op.operation==='set-panel-ratio'));assert(ops.some(op=>op.operation==='set-panel-frame'));
 const old=await createPanelEditContext(before.spec,catalog,request);assert.equal(old.editContextVersion,'0.8');assert.deepEqual(await validatePanelEditContext(old),old);assert(!codexEditOperationContracts(await buildCodexEditResponseSchema({draft:true,context:old}),old).some(op=>op.operation==='set-panel-ratio'));
 await assert.rejects(materializeCodexEditDraft(old,draft(old,[ratio(16,9,640)])));
 const selected=await createPanelEditContext(before.spec,catalog,request,{rowId:'row1'},{panelFrame:true});assert.deepEqual(await validatePanelEditContext(selected),selected);assert(!selected.capabilities.operations.includes('set-panel-frame'));await assert.rejects(materializeCodexEditDraft(selected,draft(selected,[ratio(16,9)])));
});
for(const [w,h,width]of [[16,9,640],[9,16,480],[1,1,480],[4,3,640],[21,9,840],[3,2,600]])test('actual panel keeps exact '+w+':'+h+' ratio, preserving controls, state and typography',async()=>{
 const b=await change([ratio(w,h,width)]),panel=card(b);assert.equal(b.spec.panelSpecVersion,'0.14');assert.equal(b.compilerVersion,'0.14.0');assert.equal(b.panelBundleVersion,'0.14');assert.equal(panel.layout.width,width);assert(Math.abs(panel.layout.width*h-panel.layout.height*w)<1e-8);
 assert.deepEqual(b.spec.sections,before.spec.sections);assert.deepEqual(b.spec.state,before.spec.state);assert.deepEqual(b.state,before.state);assert.deepEqual(b.actions,before.actions);assert.deepEqual(b.bindings,before.bindings);assert.equal(b.spec.layout.maxHeight,Math.ceil(panel.layout.height));
 assert(b.spec.canvas.width>=panel.layout.width&&b.spec.canvas.height>=panel.layout.height);const oldTexts=nodesOf(before.componentBundle.document).filter(n=>n.type==='Text'&&n.id.includes('row1'));
 for(const n of oldTexts)assert.equal(nodesOf(b.componentBundle.document).find(m=>m.id===n.id).props.style.fontSize,n.props.style.fontSize);
 const unity=await createUnityDocument(b,core),native=unity.nodes.find(n=>n.id===panel.id);assert.equal(native.width,panel.layout.width);assert.equal(native.height,panel.layout.height);
 const event=projectPanelEvent(b.spec,b.state,{type:'activate',id:controlId(b.spec.id,'row2'),source:'keyboard'});assert.deepEqual(event.event.values,before.state);
});
test('null ratio width preserves current width and fractional logical height; short content still fills a fixed frame',async()=>{
 const b=await change([ratio(9,16)]);assert.equal(card(b).layout.width,480);assert.equal(card(b).layout.height,480*16/9);assert(!Number.isInteger(card(b).layout.height));
 const large=await change([{op:'set-panel-frame',frame:{width:640,height:1000}}]);assert.equal(card(large).layout.height,1000);assert(!nodesOf(large.componentBundle.document).some(n=>n.type==='ScrollView'));
 const cleared=await change([{op:'set-panel-frame',frame:null}],large);assert.equal(cleared.spec.panelSpecVersion,'0.14');assert.equal(cleared.spec.frame,null);assert(card(cleared).layout.height<1000);assert.deepEqual(cleared.state,large.state);
 assert.deepEqual(await change([{op:'set-panel-frame',frame:null}]),before);
});
test('short landscape frame scrolls; portrait reflows text and clears obsolete scroll geometry',async()=>{
 const a=await change([ratio(16,9,640)]),b=await change([ratio(9,16,480)],a);assert(nodesOf(a.componentBundle.document).some(n=>n.type==='ScrollView'));assert.equal(card(b).layout.height,480*16/9);
 const lineNodes=x=>nodesOf(x.componentBundle.document).filter(n=>n.id.startsWith(controlId(x.spec.id,'row0')));assert(lineNodes(b).length>=lineNodes(a).length);
 assert(!nodesOf(b.componentBundle.document).some(n=>n.type==='ScrollView'));assert.deepEqual(b.state,a.state);
});
for(const op of [ratio(0,9),ratio(16,-1),ratio(1001,9),ratio(16,9,'640'),ratio(9,16,4096),{op:'set-panel-frame',frame:{width:640,height:Infinity}},{op:'set-panel-frame',frame:{width:640.1,height:360}},{op:'set-panel-frame',frame:{width:640,height:360,scale:1}}])test('invalid frame instruction rejects atomically '+JSON.stringify(op),async()=>{
 const original=await digestJson(before);await assert.rejects(change([{op:'set-panel-title',title:'不应部分生效'},op]));assert.equal(await digestJson(before),original);
});
test('conflicting geometry writes and unreadable narrow/short geometry fail without consuming a round',async()=>{
 const model=await createWorkbenchModel({catalog,pool:null},core);await model.importPanel(before);
 for(const operations of [[ratio(16,9),{op:'set-layout',layout:before.spec.layout}],[ratio(1,1),ratio(9,16)],[{op:'set-panel-frame',frame:{width:640,height:100}}],[{op:'set-panel-frame',frame:{width:100,height:600}}]]){
  await assert.rejects(model.patch(await patch(before.spec,operations)));assert.deepEqual(model.getSnapshot().panel,before);assert.equal(model.getEditBudget().used,0);
 }model.dispose();const b=await change([ratio(16,9,640)]);assert.throws(()=>validatePanelSpec({...b.spec,frame:{width:600,height:360}}),{code:'panel-frame-layout'});
});
test('ordinary horizontal section containers reflow into a column in portrait without changing IDs',async()=>{
 const s=structuredClone(before.spec),original=s.sections[0];s.sections=[{...original,id:'intro',rows:[original.rows[0]]},{...original,id:'form',rows:original.rows.slice(1)}];s.layout.width=900;s.canvas.width=964;s.layout.body={id:'body',kind:'row',width:'fill',gap:20,align:'start',children:s.sections.map(section=>({kind:'section',sectionId:section.id,width:'fill'}))};
 const base=await createPanelBundle(s,catalog,core,before.state),b=await change([ratio(9,16,480)],base),ns=nodesOf(b.componentBundle.document);const intro=ns.find(n=>n.id.endsWith('.section.intro')),form=ns.find(n=>n.id.endsWith('.section.form'));
 assert.equal(intro.layout.x,form.layout.x);assert(form.layout.y>intro.layout.y);assert.deepEqual(b.spec.sections,base.spec.sections);assert.deepEqual(b.spec.layout.body,base.spec.layout.body);
});
test('tabs use the exact outer frame height and reserve their header once',async()=>{
 const i=initialWrapIntent(planning,'两页都需要保留说明');const second=structuredClone(i.panel.body);second.children[0].rows[2].submitRows=[5];i.panel.body={kind:'tabs',enabled:true,sourceRef:'request',pages:[{label:'角色',sourceRef:'request',initial:true,body:i.panel.body},{label:'更多',sourceRef:'request',initial:false,body:second}]};
 const base=await createPanelBundle((await materializePanelIntent(planning,i)).spec,catalog,core),b=await change([ratio(16,9,720)],base);assert.equal(card(b).layout.height,405);assert.equal(b.spec.tabs.pages.length,2);assert.deepEqual(await validatePanelBundle(b,core),b);
});

test('fixed frames reserve dropdown popup clearance while preserving scroll and enum values',async()=>{
 const source=JSON.parse(await readFile(new URL('../examples/settings-controls.panel.json',import.meta.url),'utf8'));
 const s=structuredClone(before.spec);s.state.push(source.state.find(f=>f.type==='enum'));s.sections[0].rows.push(source.sections.flatMap(x=>x.rows).find(r=>r.kind==='select'));
 const base=await createPanelBundle(s,catalog,core),b=await change([ratio(16,9,640)],base),panel=card(b),ns=nodesOf(b.componentBundle.document);
 assert.equal(panel.layout.height,360);assert(ns.some(n=>n.type==='ScrollView'));assert.deepEqual(b.state,base.state);assert(b.spec.canvas.height>=360+64+2*(3*40+2));
 const select=ns.find(n=>n.type==='Select');assert(select);assert.deepEqual(await validatePanelBundle(b,core),b);
});

test('Unity adapter version gates accept resized title, progress, input, submit and tabs documents',async()=>{
 const paths=['../adapters/unity/Editor/PanelPrefabBuilder.cs','../adapters/unity/Runtime/PanelController.cs'];
 for(const path of paths){const source=await readFile(new URL(path,import.meta.url),'utf8');
  const gates=[...source.matchAll(/(?:document|source)\.panelSpecVersion != "0\.[0-9]+"(?: && (?:document|source)\.panelSpecVersion != "0\.[0-9]+")*/g)].map(m=>m[0]);
  assert(gates.length>=4);for(const gate of gates){const versions=[...gate.matchAll(/"([0-9.]+)"/g)].map(m=>m[1]);assert(versions.includes('0.14'),gate);assert(!versions.includes('0.99'));}
 }
});
test('all lower-level styling operations preserve frame version and geometry; undo does not refund the edit limit',async()=>{
 const b=await change([ratio(16,9,640)]),m=await createWorkbenchModel({catalog,pool:null},core);await m.importPanel(b);
 const edits=[{op:'set-text-wrap',rowId:'row0',wrap:'word'},{op:'set-title-bar',style:null},{op:'set-button-font-size',rowId:'row2',fontSize:16},{op:'set-button-style',rowId:'row2',style:null},{op:'set-appearance',appearance:null}];
 for(const op of edits){const r=await change([op],b);assert.equal(r.spec.panelSpecVersion,'0.14');assert.deepEqual(r.spec.frame,b.spec.frame);}
 for(let n=0;n<10;n++)await m.patch(await patch(m.getSnapshot().panel.spec,[ratio(n%2?16:9,n%2?9:16,640)]));assert.equal(m.getEditBudget().used,10);await m.undo();assert.equal(m.getEditBudget().used,10);await assert.rejects(m.patch(await patch(m.getSnapshot().panel.spec,[ratio(1,1)])),/WORKBENCH_EDIT_LIMIT/);m.dispose();
 const other=await createPanelBundle({...b.spec,id:'other-fixed'},catalog,core,b.state),request={panelCompositionRequestVersion:'0.1',id:'frame-composite',title:'组合',sources:[{namespace:'one',bundleSha256:b.sha256},{namespace:'two',bundleSha256:other.sha256}],layout:'tabs',width:640,canvasWidth:704,canvasHeight:800,maxHeight:700,surfaceFrom:null};
 const composed=await composePanelBundles(request,[b,other],core);await validatePanelComposition(composed,[b,other],core);assert.equal(composed.bundle.spec.panelSpecVersion,'0.13');
});
test('CLI editor exposes the actual ratio operation and accepts one authored response with no real child or model',async()=>{
 const outputRoot=await mkdtemp(new URL('../.tmp/panel-frame-cli-',import.meta.url));let calls=0,prompt='';
 const runProcess=(command,args)=>{calls++;const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>true;child.stdin=new Writable({write(chunk,encoding,callback){prompt+=chunk;callback();},final(callback){callback();queueMicrotask(()=>{child.stdout.write([{type:'thread.started',thread_id:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'},{type:'turn.started'},{type:'item.completed',item:{type:'agent_message',text:JSON.stringify(draft(context,[ratio(16,9,640)]))}},{type:'turn.completed',usage:{input_tokens:1,cached_input_tokens:0,output_tokens:1}}].map(v=>JSON.stringify(v)).join('\n')+'\n');child.emit('close',0);});}});return child;};
 const result=await editWithCodex(context,{outputRoot,executable:process.execPath,runProcess});assert.equal(calls,1);assert(prompt.includes('panel-frame-editor.md'));assert.equal(result.report.status,'READY_TO_APPLY');assert.equal(result.receipt.automaticRetries,0);assert.deepEqual(result.proposal.patch.operations,[ratio(16,9,640)]);
});
