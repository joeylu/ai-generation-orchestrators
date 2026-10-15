import test from 'node:test';
import assert from 'node:assert/strict';
import {readJson} from '../src/io.mjs';
import * as panel from '../src/index.mjs';
import {materializePanelIntent,buildNativePanelIntentResponseSchema} from '../src/panel-intent.mjs';
import {core,nodesOf} from './helpers.mjs';
import {createWorkbenchModel} from '../src/workbench-model.mjs';
import {imageAssetPool} from '../examples/image-slots-v1/assets.mjs';
import {request as fullRequest,intent as fullIntent,expectedTypes} from '../examples/all-components-v1/fixture.mjs';
import {buildCodexEditResponseSchema} from '../src/codex-edit-schema.mjs';
import {digestJson} from '../src/canonical.mjs';
import {explicitComponentRequirements} from '../src/component-capabilities.mjs';
import {previewSelectionTargets,selectionLabel} from '../src/workbench-selection.mjs';
const catalog=await readJson(new URL('../examples/modern-all-components.catalog.json',import.meta.url));
const rows=[
  {kind:'checkbox',label:'提示',recipeKey:'content.checkbox@0.1.0',enabled:true,initial:false},
  {kind:'radio',label:'画质',recipeKey:'content.radio@0.1.0',enabled:true,options:[{label:'低',initial:false},{label:'高',initial:true}]},
  {kind:'list',label:'背包',recipeKey:'content.list@0.1.0',enabled:true,options:[{label:'药水',initial:true},{label:'钥匙',initial:false}],itemHeight:40,visibleItems:3},
  {kind:'dialog',label:'打开说明',recipeKey:'content.dialog@0.1.0',enabled:true,initial:false,title:'说明',text:'确认后继续操作。',closeLabel:'关闭',modal:true,dialogWidth:400,dialogHeight:240},
];
const request={requestVersion:'0.1',id:'all-components-audit',target:'pixi',text:'需要 CheckBox 提示，初始未勾选；RadioGroup 画质选项低、高，默认高；可选择的 List 背包有药水、钥匙，默认药水；Dialog 初始关闭，模态，标题说明，正文确认后继续操作。，打开说明按钮打开，关闭按钮关闭。'};
function intent(context,items=rows){return {panelIntentVersion:'0.12',contextSha256:context.sha256,unresolved:[],panel:{id:context.request.id,title:'组件集',themeKey:'modern-mint-light@0.21.0',panelSurface:null,layout:{width:640,canvasWidth:720,canvasHeight:900,maxHeight:800,overflow:'auto'},body:{kind:'column',children:[{kind:'section',title:'内容',actionLayout:null,rows:items.map(row=>({...row,sourceRef:'request',icon:null}))}]}}};}
async function make(){const context=await panel.createPlanningContext(request,catalog);const proposal=await materializePanelIntent(context,intent(context));return {context,proposal,bundle:await panel.createPanelBundle(proposal.spec,catalog,core)};}

test('full catalog exposes twelve content rows and compiles four independent native types with Panel',async()=>{
 const {context,proposal,bundle}=await make();
 assert.equal(context.planningContextVersion,'0.11');assert.equal(context.capabilities.rowKinds.length,12);
 assert.deepEqual(buildNativePanelIntentResponseSchema(context).properties.panelIntentVersion.enum,['0.12']);
 assert.equal(proposal.spec.panelSpecVersion,'0.16');assert.equal(bundle.panelBundleVersion,'0.16');assert.equal(bundle.compilerVersion,'0.32.0');
 const nodes=nodesOf(bundle.componentBundle.document);
 for(const type of ['CheckBox','RadioGroup','List','Dialog','Panel'])assert(nodes.some(node=>node.type===type),type);
 assert.deepEqual(await panel.validatePanelBundle(JSON.parse(JSON.stringify(bundle)),core),bundle);
});

test('default catalog makes all sixteen native types in both render/export documents, preserving imported image bytes',async()=>{
 for(const mode of ['light','dark']){
  const model=await createWorkbenchModel({catalog,pool:await imageAssetPool()},core);
  try{const {context}=await model.prepare(fullRequest),proposal=await materializePanelIntent(context,fullIntent(context,{mode}));
   const {panel:bundle}=await model.acceptProposal(proposal);
   assert.deepEqual([...new Set(nodesOf(bundle.componentBundle.document).map(node=>node.type))].sort(),expectedTypes);
   const native=await panel.createUnityDocument(bundle,core);
   assert.deepEqual([...new Set(native.nodes.map(node=>node.type))].sort(),expectedTypes);
   const parents=new Map(native.nodes.map(node=>[node.id,node]));
   for(const node of native.nodes){const parent=parents.get(node.parentId);if(!parent)continue;assert(node.x+node.width<=(parent.type==='ScrollView'?parent.contentWidth:parent.width)+.01,node.id+' width');assert(node.y+node.height<=(parent.type==='ScrollView'?parent.contentHeight:parent.height)+.01,node.id+' height');}
   const list=nodesOf(bundle.componentBundle.document).find(node=>node.type==='List');
   const luminance=hex=>{const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
   for(const background of ['#FFFFFF','#E3F1EC']){const a=luminance(list.props.style.textColor),b=luminance(background);assert((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,'List choice contrast '+mode);}
   assert.equal(native.adapterVersion,'0.1.8');assert.equal(native.controls.length,11);
   const dialog=native.controls.find(control=>control.kind==='dialog');
   assert.equal(native.nodes.filter(node=>node.dialogTargetId===dialog.nodeId).length,2);
   assert.deepEqual(await panel.validatePanelBundle(JSON.parse(JSON.stringify(bundle)),core),bundle);
   const reopened=await createWorkbenchModel({catalog,pool:null},core);try{await reopened.importPanel(bundle);assert.deepEqual(await reopened.exportPanel(),bundle);}finally{reopened.dispose();}
  }finally{model.dispose();}
 }
});

test('closed Dialog remains selectable through its opener and composition preserves every new type',async()=>{
 const {bundle}=await make(),document=bundle.componentBundle.document;
 const inspection={nodes:nodesOf(document).map(node=>({id:node.id,type:node.type,visible:node.type!=='Dialog',bounds:{x:0,y:0,width:100,height:40}}))};
 assert(previewSelectionTargets(bundle.spec,document,inspection).some(target=>target.rowId==='row3'));assert.match(selectionLabel(bundle.spec.sections[0].rows[3]),/弹窗/);
 const other=await panel.createPanelBundle({...bundle.spec,id:'other-components'},catalog,core);
 const composition={panelCompositionRequestVersion:'0.1',id:'combined-components',title:'组合',sources:[{namespace:'one',bundleSha256:bundle.sha256},{namespace:'two',bundleSha256:other.sha256}],layout:'tabs',width:640,canvasWidth:720,canvasHeight:900,maxHeight:800,surfaceFrom:null};
 const result=await panel.composePanelBundles(composition,[bundle,other],core);assert.equal(result.bundle.spec.panelSpecVersion,'0.16');
 assert.deepEqual(result.bundle.spec.sections.flatMap(section=>section.rows.map(row=>row.kind)),['checkbox','radio','list','dialog','checkbox','radio','list','dialog']);await panel.validatePanelBundle(result.bundle,core);
});

test('editing exposes native add and property operations; list edits preserve valid live selection and reject deleting it atomically',async()=>{
 const {bundle}=await make(),model=await createWorkbenchModel({catalog,pool:null},core);
 try{
  const live={...bundle.state,row2:'option1'};await model.importPanel(bundle,live);
  const {context}=await model.prepareEdit({...request,text:'修改背包列表的选项文字。'},{rowId:'row2'});
  assert.equal(context.editContextVersion,'0.16');assert(context.capabilities.operations.includes('set-choice-options'));
  assert(context.capabilities.operations.includes('set-list-properties'));assert(!context.capabilities.operations.includes('set-dialog-properties'));
  const schema=await buildCodexEditResponseSchema({draft:true,context});assert(Object.values(schema.$defs).some(def=>def.properties?.op?.enum?.includes('set-choice-options')));
  const global=await panel.createPanelEditContext(bundle.spec,catalog,{...request,text:'添加新的复选框。'});
  const globalSchema=await buildCodexEditResponseSchema({draft:true,context:global});
  for(const kind of ['checkbox','radio','list','dialog'])assert(Object.values(globalSchema.$defs).some(def=>def.properties?.kind?.enum?.includes(kind)),kind);
  const patch=async operations=>({patchVersion:'0.1',baseSpecSha256:await digestJson(model.getSnapshot().panel.spec),reason:'确定性组件编辑',operations});
  const options=[{id:'option0',label:'治疗药水'},{id:'option1',label:'银钥匙'},{id:'extra',label:'金币'}];
  await model.patch(await patch([{op:'set-choice-options',rowId:'row2',options,initial:'option0'},{op:'set-list-properties',rowId:'row2',itemHeight:48,visibleItems:2}]));
  const edited=await model.exportPanel();assert.equal(edited.state.row2,'option1');assert.equal(edited.spec.panelSpecVersion,'0.16');
  await assert.rejects(model.patch(await patch([{op:'set-choice-options',rowId:'row2',options:[options[0]],initial:'option0'}])));
  assert.deepEqual(await model.exportPanel(),edited);await model.undo();assert.deepEqual((await model.exportPanel()).state,live);
 }finally{model.dispose();}
});

test('choice limits and modal event boundary are enforced without generic substitutions',async()=>{
 const {context,bundle}=await make();
 for(const [kind,count,passes] of [['radio',8,true],['radio',9,false],['list',64,true],['list',65,false]]){
  const items=structuredClone(rows),index=kind==='radio'?1:2;items[index].options=Array.from({length:count},(_,i)=>({label:'选项'+i,initial:i===0}));
  const work=materializePanelIntent(context,intent(context,items));if(passes)await work;else await assert.rejects(work);
 }
 const open={...bundle.state,row3:true};
 assert.deepEqual(panel.projectPanelEvent(bundle.spec,open,{id:panel.controlId(bundle.spec.id,'row0'),type:'change',value:true,source:'keyboard'}),{state:open,event:null});
 assert.deepEqual(explicitComponentRequirements('不需要 CheckBox，也不要 Dialog；只用普通长列表设置。'),[]);
 assert.deepEqual(explicitComponentRequirements('CheckBox、RadioGroup、List 和 Dialog'),['checkbox','radio','list','dialog']);
});

test('explicit required component substitution is rejected before workbench publication',async()=>{
 const context=await panel.createPlanningContext(request,catalog);
 for(const [index,replacement] of [[0,{kind:'switch',label:'提示',recipeKey:'settings.switch@0.1.0',enabled:true,initial:false}],[1,{...rows[1],kind:'select',recipeKey:'settings.select@0.1.0'}],[2,{kind:'text',label:'背包',recipeKey:'settings.text@0.1.0',text:'药水',wrap:'none'}],[3,{kind:'button',label:'说明',recipeKey:'settings.button.primary@0.1.0',enabled:true,action:'emit',resetRows:[],submitRows:[]}]]){
   const items=structuredClone(rows);items[index]=replacement;
   await assert.rejects(materializePanelIntent(context,intent(context,items)),{code:'PLAN_COMPONENT_REQUIREMENT'});
 }
});

test('new component events have distinct types and choice IDs; dialog open/close updates saved state',async()=>{
 const {bundle}=await make(),spec=bundle.spec;
 let state=bundle.state;
 const project=(id,type,value)=>{const result=panel.projectPanelEvent(spec,state,{id,type,value,source:'mouse'});state=result.state;return result;};
 assert.equal(project(panel.controlId(spec.id,'row0'),'change',true).event.value,true);
 assert.equal(project(panel.controlId(spec.id,'row1'),'change',panel.choiceId(spec.id,'row1','option0')).event.value,'option0');
 assert.equal(project(panel.controlId(spec.id,'row2'),'change',panel.choiceId(spec.id,'row2','option1')).event.value,'option1');
 assert.equal(project(panel.controlId(spec.id,'row3')+'.open','activate').event.value,true);
 assert.equal(project(panel.controlId(spec.id,'row3')+'.close','activate').event.value,false);
 const saved=await panel.createPanelBundle(spec,catalog,core,state);assert.deepEqual((await panel.validatePanelBundle(saved,core)).state,state);
});
