import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,readdir} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {core,nodesOf} from './helpers.mjs';
import {panelFrameFixtures} from '../examples/panel-frame-v1/fixture.mjs';
import {LAYOUT_DETAIL_KEYS} from '../src/layout-details.mjs';
import {digestJson} from '../src/canonical.mjs';
import {applyPanelPatch} from '../src/patch.mjs';
import {createPanelBundle,validatePanelBundle} from '../src/panel-bundle.mjs';
import {createPanelEditContext,validatePanelEditContext} from '../src/edit-planning.mjs';
import {materializeCodexEditDraft} from '../src/codex-edit-draft.mjs';
import {buildCodexEditResponseSchema,codexEditOperationContracts} from '../src/codex-edit-schema.mjs';
import {createWorkbenchModel} from '../src/workbench-model.mjs';
import {createUnityDocument} from '../src/unity-export.mjs';
import {projectPanelEvent} from '../src/state.mjs';
import {controlId} from '../src/compiler.mjs';
import {editWithCodex} from '../src/codex-planner.mjs';
import {createCodexDiagnostic,validateCodexDiagnostic} from '../src/codex-diagnostics.mjs';
const catalog=JSON.parse(await readFile(new URL('../examples/modern-adaptive.catalog.json',import.meta.url),'utf8'));
const fixture=await panelFrameFixtures(catalog,core),before=fixture.before;
const request={requestVersion:'0.1',id:'panel-edit',target:'pixi',text:'改成9:16竖版，宽480，内边距24，标题区域高56，间距12，保留字号、当前输入和按钮行为。'};
const details=extra=>({op:'set-layout-details',details:{...Object.fromEntries(LAYOUT_DETAIL_KEYS.map(key=>[key,null])),...extra}});
const ratio={op:'set-panel-ratio',ratio:{width:9,height:16},width:480};
const operations=[ratio,details({padding:24,titleHeight:56,gap:12})];
const patch=async(spec,ops=operations)=>({patchVersion:'0.1',baseSpecSha256:await digestJson(spec),reason:request.text,operations:ops});
const context=await createPanelEditContext(before.spec,catalog,request,null,{layoutDetails:true});
const draft=(c,ops)=>({codexEditDraftVersion:'0.3',contextSha256:c.sha256,patch:{patchVersion:'0.1',baseSpecSha256:c.baseSpecSha256,reason:c.request.text,operations:ops},bases:ops.map(()=>({kind:'request-interpretation',quote:c.request.text})),unresolved:[],noChange:null});
async function change(ops=operations,base=before){return validatePanelBundle(await createPanelBundle((await applyPanelPatch(base.spec,await patch(base.spec,ops))).spec,catalog,core,base.state),core);}
const card=b=>nodesOf(b.componentBundle.document).find(node=>node.id===b.spec.id+'.panel');

test('new context is exact, native schema exposes layout details and old contexts reject the new operation',async()=>{
 assert.equal(context.editContextVersion,'0.10');assert.equal(context.capabilities.layoutDetailsPolicy,'layout-details-v1');assert.deepEqual(await validatePanelEditContext(context),context);
 const native=await buildCodexEditResponseSchema({draft:true,context});assert(codexEditOperationContracts(native,context).some(op=>op.operation==='set-layout-details'));
 for(const options of [{},{panelFrame:true}]){const old=await createPanelEditContext(before.spec,catalog,request,null,options);assert.deepEqual(await validatePanelEditContext(old),old);assert(!codexEditOperationContracts(await buildCodexEditResponseSchema({draft:true,context:old}),old).some(op=>op.operation==='set-layout-details'));await assert.rejects(materializeCodexEditDraft(old,draft(old,[details({padding:24})])),{code:'EDIT_PATCH'});}
 const selected=await createPanelEditContext(before.spec,catalog,request,{rowId:'row1'},{layoutDetails:true});assert.deepEqual(await validatePanelEditContext(selected),selected);assert(!selected.capabilities.operations.includes('set-layout-details'));await assert.rejects(materializeCodexEditDraft(selected,draft(selected,operations)),{code:'EDIT_PATCH'});
 const corrupt=structuredClone(context);corrupt.capabilities.operations.pop();await assert.rejects(validatePanelEditContext(corrupt));
});

test('new public schema references resolve and native details require exactly eight nullable fields',async()=>{
 const files=(await readdir(new URL('../schemas/',import.meta.url))).filter(name=>name.endsWith('.json'));
 const docs=await Promise.all(files.map(async name=>JSON.parse(await readFile(new URL('../schemas/'+name,import.meta.url),'utf8')))),registry=new Map(docs.filter(d=>d.$id).map(d=>[d.$id,d]));
 function visit(value,owner){if(!value||typeof value!=='object')return;if(value.$ref){const [id,pointer='']=value.$ref.split('#');let target=id?registry.get(id):owner;assert(target,value.$ref);for(const key of pointer.split('/').slice(1))target=target?.[key.replaceAll('~1','/').replaceAll('~0','~')];assert(target,value.$ref);}for(const child of Object.values(value))visit(child,owner);}
 for(const id of ['urn:ai-game-assets:panel-edit-context:0.10','urn:ai-game-assets:panel-patch:0.1'])visit(registry.get(id),registry.get(id));
 const native=await buildCodexEditResponseSchema({draft:true,context}),op=Object.values(native.$defs).find(value=>value.properties?.op?.enum?.[0]==='set-layout-details'),d=op.properties.details;
 assert.deepEqual(d.required,LAYOUT_DETAIL_KEYS);assert.equal(d.additionalProperties,false);for(const key of LAYOUT_DETAIL_KEYS)assert(d.properties[key].anyOf.some(branch=>branch.type==='null'));
});

test('invalid layout details retain a bounded public diagnostic without exposing rejected values',async()=>{
 let error;try{await materializeCodexEditDraft(context,draft(context,[{op:'set-layout-details',details:{padding:'SECRET_VALUE'}}]));}catch(cause){error=cause;}
 assert(error);const diagnostic=createCodexDiagnostic(error,{operation:'edit',contextSha256:context.sha256,proposalJsonSha256:'a'.repeat(64),stage:'proposal-validation'});
 assert.deepEqual(diagnostic.cause,{validatorCode:'layout-details',path:'$.operations[0].details'});assert.deepEqual(validateCodexDiagnostic(diagnostic),diagnostic);assert(!JSON.stringify(diagnostic).includes('SECRET_VALUE'));
});

test('ratio, padding, gap and title height all apply with exact geometry and preserved state/actions/fonts',async()=>{
 const b=await change();assert.equal(card(b).layout.width,480);assert.equal(card(b).layout.height,480*16/9);assert.equal(b.spec.layout.padding,24);assert.equal(b.spec.layout.titleHeight,56);assert.equal(b.spec.layout.gap,12);
 assert.deepEqual(b.spec.sections,before.spec.sections);assert.deepEqual(b.spec.state,before.spec.state);assert.deepEqual(b.state,before.state);assert.deepEqual(b.actions,before.actions);assert.deepEqual(b.bindings,before.bindings);
 const expected={...before.spec.layout,padding:24,titleHeight:56,gap:12,width:480,maxHeight:854};assert.deepEqual(b.spec.layout,expected);
 const old=nodesOf(before.componentBundle.document);for(const n of nodesOf(b.componentBundle.document).filter(n=>n.type==='Text'&&old.some(o=>o.id===n.id)))assert.equal(n.props.style.fontSize,old.find(o=>o.id===n.id).props.style.fontSize);
 const unity=await createUnityDocument(b,core),native=unity.nodes.find(n=>n.id===card(b).id);assert.equal(native.height,480*16/9);
 assert.deepEqual(projectPanelEvent(b.spec,b.state,{type:'activate',id:controlId(b.spec.id,'row2'),source:'keyboard'}).event.values,{row1:'蓝莓玩家'});
});

test('independent writes commute across ratio, fixed frame, frame clearing and layout details',async()=>{
 assert.deepEqual((await change(operations)).spec,(await change([...operations].reverse())).spec);
 const fixed=[{op:'set-panel-frame',frame:{width:640,height:600}},details({padding:24,titleHeight:56})];assert.deepEqual((await change(fixed)).spec,(await change([...fixed].reverse())).spec);
 const base=await change(),clear=[{op:'set-panel-frame',frame:null},details({padding:20,titleHeight:48})];const b=await change(clear,base);assert.deepEqual(b.spec,(await change([...clear].reverse(),base)).spec);assert.equal(b.spec.frame,null);assert(card(b).layout.height<854);
});

test('disjoint detail operations compose; null preserves values and empty edits preserve bundle identity',async()=>{
 const a=await change([details({padding:24}),details({titleHeight:56,gap:12}),ratio]);assert.deepEqual(a.spec,(await change()).spec);
 assert.deepEqual(await change([details({})]),before);
 const b=await change([details({padding:24})]);assert.equal(b.spec.panelSpecVersion,before.spec.panelSpecVersion);assert.deepEqual(b.spec.canvas,before.spec.canvas);
});

for(const ops of [
 [details({padding:24}),details({padding:20})],
 [details({padding:24}),{op:'set-layout',layout:before.spec.layout}],
 [{op:'set-layout',layout:before.spec.layout},details({padding:24})],
 [ratio,{op:'set-layout',layout:before.spec.layout}],
 [details({padding:24}),details({padding:-1})],
 [details({width:480})],
 [details({script:'run()'})],
 [{op:'set-layout-details',details:{padding:24}}],
 [ratio,details({padding:1000})],
 [ratio,details({body:{...before.spec.layout.body,children:[]}})],
])test('invalid or overlapping composite rejects atomically '+JSON.stringify(ops).slice(0,90),async()=>{
 const model=await createWorkbenchModel({catalog,pool:null},core);await model.importPanel(before);
 await assert.rejects(model.patch(await patch(before.spec,[{op:'set-panel-title',title:'不应部分应用'},...ops])));assert.deepEqual(model.getSnapshot().panel,before);assert.equal(model.getEditBudget().used,0);model.dispose();
});

test('actual model flow counts the composite once; undo, no-op and export/reimport respect used budget',async()=>{
 const m=await createWorkbenchModel({catalog,pool:null},core);await m.importPanel(before);const prepared=(await m.prepareEdit(request)).context;assert.equal(prepared.editContextVersion,'0.14');
 await m.acceptEditProposal(await materializeCodexEditDraft(prepared,draft(prepared,operations)));assert.equal(m.getEditBudget().used,1);assert.equal(m.getSnapshot().panel.spec.layout.titleHeight,56);
 const saved=await m.exportPanel();await m.importPanel(saved);assert.equal(m.getEditBudget().used,1);await m.patch(await patch(saved.spec,[details({})]));assert.equal(m.getEditBudget().used,1);
 // Reimport intentionally clears the undo stack; verify undo with a fresh successful transaction.
 await m.patch(await patch(saved.spec,[details({padding:20})]));await m.undo();assert.deepEqual(m.getSnapshot().panel,saved);assert.equal(m.getEditBudget().used,2);
 for(let n=0;n<8;n++)await m.patch(await patch(m.getSnapshot().panel.spec,[details({padding:n%2?24:20})]));assert.equal(m.getEditBudget().used,10);await assert.rejects(m.patch(await patch(m.getSnapshot().panel.spec,[details({padding:18})])),/WORKBENCH_EDIT_LIMIT/);m.dispose();
});

test('same-round flow container rearrangement preserves section IDs and frame',async()=>{
 const s=structuredClone(before.spec),first=s.sections[0];s.sections=[{...first,id:'intro',rows:[first.rows[0]]},{...first,id:'form',rows:first.rows.slice(1)}];s.layout.body={id:'body',kind:'row',width:'fill',gap:16,align:'start',children:s.sections.map(section=>({kind:'section',sectionId:section.id,width:'fill'}))};s.layout.width=900;s.canvas.width=964;
 const base=await createPanelBundle(s,catalog,core,before.state),body={...s.layout.body,kind:'column',gap:28},b=await change([ratio,details({body,padding:24})],base);
 assert.deepEqual(b.spec.sections,base.spec.sections);assert.deepEqual(b.spec.layout.body,body);assert.equal(card(b).layout.height,480*16/9);
 const ns=nodesOf(b.componentBundle.document),a=ns.find(n=>n.id.endsWith('.section.intro')),c=ns.find(n=>n.id.endsWith('.section.form'));assert.equal(a.layout.x,c.layout.x);assert(c.layout.y>a.layout.y);
});

test('CLI receives new native operation and guidance; one in-memory response materializes without real compute',async()=>{
 let calls=0,prompt='';const outputRoot=await mkdtemp(new URL('../.tmp/layout-details-cli-',import.meta.url));
 const runProcess=()=>{calls++;const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>true;child.stdin=new Writable({write(chunk,encoding,callback){prompt+=chunk;callback();},final(callback){callback();queueMicrotask(()=>{child.stdout.write([{type:'thread.started',thread_id:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'},{type:'turn.started'},{type:'item.completed',item:{type:'agent_message',text:JSON.stringify(draft(context,operations))}},{type:'turn.completed',usage:{input_tokens:1,cached_input_tokens:0,output_tokens:1}}].map(v=>JSON.stringify(v)).join('\n')+'\n');child.emit('close',0);});}});return child;};
 const result=await editWithCodex(context,{outputRoot,executable:process.execPath,runProcess});assert.equal(calls,1);assert(prompt.includes('panel-layout-details-editor.md'));assert.equal(result.report.status,'READY_TO_APPLY');assert.equal(result.receipt.automaticRetries,0);assert.deepEqual(result.proposal.patch.operations,operations);
});
