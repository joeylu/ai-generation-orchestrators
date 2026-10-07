import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { core, nodesOf } from './helpers.mjs';
import { roleRequest, roleIntent } from '../examples/adaptive-v1/fixture.mjs';
import { createPlanningContext } from '../src/planning-context.mjs';
import { materializePanelIntent } from '../src/panel-intent.mjs';
import { createPanelBundle, validatePanelBundle } from '../src/panel-bundle.mjs';
import { validatePanelSpec } from '../src/spec.mjs';
import { digestJson } from '../src/canonical.mjs';
import { applyPanelPatch } from '../src/patch.mjs';
import { createPanelEditContext, validatePanelEditContext, checkPanelEditProposal } from '../src/edit-planning.mjs';
import { buildCodexEditResponseSchema, codexEditOperationContracts } from '../src/codex-edit-schema.mjs';
import { materializeCodexEditDraft } from '../src/codex-edit-draft.mjs';
import { createUnityDocument } from '../src/unity-export.mjs';
import { composePanelBundles, validatePanelComposition } from '../src/panel-composition.mjs';
import { createWorkbenchModel } from '../src/workbench-model.mjs';
import { alignPanelTitle, attachPanelVisuals } from '../src/panel-visuals.mjs';
const catalog=JSON.parse(await readFile(new URL('../examples/modern-adaptive.catalog.json',import.meta.url),'utf8'));
const planning=await createPlanningContext(roleRequest,catalog);
const role=(await materializePanelIntent(planning,roleIntent(planning))).spec;
const source=await createPanelBundle({...role,layout:{...role.layout,titleHeight:56}},catalog,core,{row0:'蓝莓玩家'});
const empty=()=>({horizontalAlign:null,verticalAlign:null,backgroundColor:null,textColor:null,cornerRadius:null,fontSize:null,padding:0});
const plate={...empty(),horizontalAlign:'center',verticalAlign:'middle',backgroundColor:'#12564C',textColor:'#FFFFFF',cornerRadius:8,padding:8};
const op=style=>({op:'set-title-bar',style});
const patch=async(s,operations)=>({patchVersion:'0.1',baseSpecSha256:await digestJson(s),reason:'Fixture: title only.',operations});
async function changed(style,b=source,extra=[]) {
  const result=await applyPanelPatch(b.spec,await patch(b.spec,[op(style),...extra]));
  return validatePanelBundle(await createPanelBundle(result.spec,b.catalog,core,b.state),core);
}
const nodes=b=>nodesOf(b.componentBundle.document);

test('a title bar centers an existing title and draws a separate plate without changing body geometry, state or behavior',async()=>{
  const b=await changed(plate);assert.equal(b.spec.panelSpecVersion,'0.12');assert.equal(b.compilerVersion,'0.12.0');
  assert.deepEqual(b.spec.titleBar,plate);assert.deepEqual(b.spec.layout,source.spec.layout);
  assert.deepEqual(b.state,source.state);assert.deepEqual(b.actions,source.actions);assert.deepEqual(b.bindings,source.bindings);assert.deepEqual(b.spec.sections,source.spec.sections);
  for(const before of nodes(source).filter(n=>['Input','Button'].includes(n.type)))assert.deepEqual(nodes(b).find(n=>n.id===before.id),before);
  const title=nodes(b).find(n=>n.id===`${b.spec.id}.title`),background=nodes(b).find(n=>n.id===`${b.spec.id}.title-bar`);
  assert.equal(background.type,'Container');assert.equal(background.layout.height,56);assert.equal(background.props.style.backgroundColor,plate.backgroundColor);
  assert.equal(title.props.style.textColor,'#FFFFFF');assert.equal(title.layout.height,40);assert.equal(background.children.length,1);assert.equal(background.children[0].id,title.id);
});

test('alignment alone paints no new background, and clearing restores the original title tree exactly',async()=>{
  const align=await changed({...empty(),horizontalAlign:'right'});
  assert(!nodes(align).some(n=>n.id.endsWith('.title-bar')));
  assert.deepEqual(nodes(align).find(n=>n.id===`${align.spec.id}.title`),nodes(source).find(n=>n.id===`${source.spec.id}.title`));
  const cleared=await changed(null,await changed(plate));
  assert.equal(cleared.spec.titleBar,null);assert.deepEqual(cleared.componentBundle.document,source.componentBundle.document);
  assert.deepEqual(await changed(null),source);
});

for(const horizontalAlign of ['left','center','right'])for(const verticalAlign of ['top','middle','bottom'])test(`actual glyph bounds align ${horizontalAlign}/${verticalAlign} inside the authored title slot`,()=>{
  const calls=[],box={x:100,y:80,width:300,height:56},glyph={x:102,y:84,width:120,height:30};
  alignPanelTitle({spec:{id:'heading',titleBar:{...plate,horizontalAlign,verticalAlign}}},{inspect:()=>({nodes:[{id:'heading.title',bounds:box,renderedTextBounds:[{bounds:glyph}]}]}),applyMotion:(id,value)=>calls.push({id,value})});
  assert.equal(calls.length,1);assert.equal(calls[0].id,'heading.title');
  const x={left:100,center:190,right:280}[horizontalAlign],y={top:80,middle:93,bottom:106}[verticalAlign];
  assert.equal(glyph.x+calls[0].value.x,x);assert.equal(glyph.y+calls[0].value.y,y);
});

test('a title-only panel still aligns without installing motion subscriptions or frame callbacks',async()=>{
  const s=structuredClone(source.spec);s.state=[];s.sections[0].rows=[{id:'intro',kind:'text',label:'说明',text:'欢迎',recipe:{id:'settings.text',version:'0.1.0'}}];
  const b=await changed({...empty(),horizontalAlign:'center'},await createPanelBundle(s,catalog,core));let calls=0;
  const runtime={inspect:()=>({nodes:[{id:`${b.spec.id}.title`,bounds:{x:0,y:0,width:300,height:56},renderedTextBounds:[{bounds:{x:0,y:0,width:120,height:30}}]}]}),applyMotion:()=>calls++,subscribe:()=>assert.fail('No button motion subscription needed')};
  attachPanelVisuals(b,runtime)();assert.equal(calls,1);
});

test('an unmentioned alignment axis inherits its original glyph position',()=>{
  const calls=[],box={x:100,y:80,width:300,height:56},glyph={x:102,y:84,width:120,height:30};
  const runtime={inspect:()=>({nodes:[{id:'heading.title',bounds:box,renderedTextBounds:[{bounds:glyph}]}]}),applyMotion:(id,value)=>calls.push(value)};
  alignPanelTitle({spec:{id:'heading',titleBar:{...empty(),horizontalAlign:'center'}}},runtime);
  assert.deepEqual(calls[0],{x:88,y:0});
  alignPanelTitle({spec:{id:'heading',titleBar:{...empty(),verticalAlign:'middle'}}},runtime);
  assert.deepEqual(calls[1],{x:0,y:9});
});

test('font/padding fit and exact style validation reject bad edits without changing the current panel or budget',async()=>{
  for(const style of [{...plate,padding:28},{...plate,fontSize:80},{...plate,horizontalAlign:'justify'},{...plate,verticalAlign:'center'},{...plate,backgroundColor:'transparent'},{...plate,backgroundColor:'#11223344'},{...plate,fontSize:7},{...plate,padding:1.5},{...plate,fontFamily:'url(secret)'},{}])await assert.rejects(changed(style));
  assert.throws(()=>validatePanelSpec({...source.spec,titleBar:null}),/unknown field/);
  const model=await createWorkbenchModel({catalog,pool:null},core);await model.importPanel(source);
  await assert.rejects(model.patch(await patch(source.spec,[{op:'set-panel-title',title:'不能部分应用'},op({...plate,fontSize:80})])));
  assert.deepEqual(model.getSnapshot().panel,source);assert.equal(model.getEditBudget().used,0);model.dispose();
});

test('title edits and later button font/style/layout operations retain the higher spec version and all unrequested fields',async()=>{
  const b=await changed(plate),button=b.spec.sections[0].rows.find(r=>r.kind==='button');
  const result=await applyPanelPatch(b.spec,await patch(b.spec,[{op:'set-button-font-size',rowId:button.id,fontSize:24},{op:'set-appearance',appearance:null},{op:'set-action-layout',sectionId:b.spec.sections[0].id,layout:null}]));
  const after=await createPanelBundle(result.spec,catalog,core,b.state);assert.equal(after.spec.panelSpecVersion,'0.12');assert.deepEqual(after.spec.titleBar,plate);
  assert.equal(nodes(after).find(n=>n.type==='Button').props.style.fontSize,24);assert.deepEqual(after.state,source.state);
});

test('native response advertises title editing only without a selected control and binds exact current request evidence',async()=>{
  const request={...roleRequest,id:'title-edit',text:'面板标题水平和垂直居中，加深绿底板，其他保持不变。'};
  const c=await createPanelEditContext(source.spec,catalog,request),schema=await buildCodexEditResponseSchema({draft:true,context:c});
  assert.equal(c.editContextVersion,'0.8');assert.equal(c.capabilities.titleBarPolicy,'panel-title-bar-v1');assert(codexEditOperationContracts(schema,c).some(o=>o.operation==='set-title-bar'));
  const draft={codexEditDraftVersion:'0.3',contextSha256:c.sha256,patch:await patch(c.spec,[op(plate)]),bases:[{kind:'request-interpretation',quote:request.text}],unresolved:[],noChange:null};
  assert.equal((await checkPanelEditProposal(c,await materializeCodexEditDraft(c,draft))).status,'READY_TO_APPLY');
  const selected=await createPanelEditContext(source.spec,catalog,request,{rowId:source.spec.sections[0].rows[0].id});
  assert(!selected.capabilities.operations.includes('set-title-bar'));assert(!codexEditOperationContracts(await buildCodexEditResponseSchema({draft:true,context:selected}),selected).some(o=>o.operation==='set-title-bar'));
  await assert.rejects(materializeCodexEditDraft(selected,{...draft,contextSha256:selected.sha256}),/EDIT_PATCH/);
  const old=structuredClone(c);old.editContextVersion='0.6';old.capabilities.operations=old.capabilities.operations.filter(o=>o!=='set-title-bar');delete old.capabilities.titleBarPolicy; delete old.capabilities.textWrapPolicy; old.capabilities.operations = old.capabilities.operations.filter(op => op !== 'set-text-wrap');delete old.sha256;old.sha256=await digestJson(old);
  assert.deepEqual(await validatePanelEditContext(old),old);assert(!JSON.stringify(await buildCodexEditResponseSchema({draft:true,context:old})).includes('set-title-bar'));
  await assert.rejects(materializeCodexEditDraft(old,{...draft,contextSha256:old.sha256}),/EDIT_PATCH/);
});

test('Unity retains a single title Text with a validated native anchor and a distinct background node',async()=>{
  const b=await changed(plate),unity=await createUnityDocument(b,core),before=await createUnityDocument(source,core);
  const title=unity.nodes.find(n=>n.id===`${b.spec.id}.title`);assert.equal(title.textAlignment,'MiddleCenter');assert.equal(title.type,'Text');assert.equal(title.text,b.spec.title);
  assert.equal(title.parentId,`${b.spec.id}.title-bar`);assert.equal(unity.nodes.filter(n=>n.id===title.id).length,1);assert.deepEqual(unity.controls,before.controls);assert.deepEqual(unity.fields,before.fields);
  assert(before.nodes.every(n=>!Object.hasOwn(n,'textAlignment')));
});

test('composition preserves a compatible title style and authored height, rejects conflicting style rather than losing it',async()=>{
  const a=await changed(plate),b=await createPanelBundle({...a.spec,id:'second-form'},catalog,core,a.state);
  const request={panelCompositionRequestVersion:'0.1',id:'titles-composite',title:'双面板',sources:[{namespace:'one',bundleSha256:a.sha256},{namespace:'two',bundleSha256:b.sha256}],layout:'column',width:420,canvasWidth:484,canvasHeight:640,maxHeight:560,surfaceFrom:null};
  const composition=await composePanelBundles(request,[a,b],core);await validatePanelComposition(composition,[a,b],core);
  assert.deepEqual(composition.bundle.spec.titleBar,plate);assert.equal(composition.bundle.spec.layout.titleHeight,56);
  const old=await createPanelBundle({...source.spec,id:'old-form'},catalog,core,source.state);
  await assert.rejects(composePanelBundles({...request,sources:[request.sources[0],{namespace:'two',bundleSha256:old.sha256}]},[a,old],core),/COMPOSITION_TITLE_BAR/);
});

test('ten-round budget and undo apply equally to title changes while entered form text is preserved',async()=>{
  const model=await createWorkbenchModel({catalog,pool:null},core);await model.importPanel(source);
  for(let i=0;i<10;i++)await model.patch(await patch(model.getSnapshot().panel.spec,[op({...plate,horizontalAlign:i%2?'left':'center'})]));
  assert.deepEqual(model.getSnapshot().panel.state,source.state);assert.equal(model.getEditBudget().used,10);await model.undo();
  await assert.rejects(model.patch(await patch(model.getSnapshot().panel.spec,[op(null)])),/WORKBENCH_EDIT_LIMIT/);model.dispose();
});
