import test from 'node:test';
import assert from 'node:assert/strict';
import * as panel from '../src/index.mjs';
import {readJson} from '../src/io.mjs';
import {core} from './helpers.mjs';
import {materializePanelIntent,buildNativePanelIntentResponseSchema} from '../src/panel-intent.mjs';
import {createWorkbenchModel} from '../src/workbench-model.mjs';
import {digestJson} from '../src/canonical.mjs';
import {flatten} from '../examples/section-headings-v1/fixture.mjs';

const catalog=await readJson(new URL('../examples/modern-image-slots.catalog.json',import.meta.url));
// Authored responses, never natural-language interpretation or a model substitute in production.
const cases=[
  {kind:'slider',label:'音量',recipeKey:'settings.slider@0.1.0',enabled:true,min:0,max:100,step:1,initial:57,prefix:'',suffix:'%'},
  {kind:'switch',label:'静音',recipeKey:'settings.switch@0.1.0',enabled:true,initial:false},
  {kind:'select',label:'性别',recipeKey:'settings.select@0.1.0',enabled:true,options:[{label:'男',initial:true},{label:'女',initial:false}]},
  {kind:'button',label:'确认',recipeKey:'settings.button.primary@0.1.0',enabled:true,action:'emit',resetRows:[],submitRows:[]},
  {kind:'text',label:'说明',recipeKey:'settings.text@0.1.0',text:'请选择角色',wrap:'word'},
  {kind:'progress',label:'下载进度',recipeKey:'settings.progress@0.1.0',max:100,initial:57,display:'percent',fractionDigits:0},
  {kind:'input',label:'角色名',recipeKey:'forms.input@0.1.0',enabled:true,initial:'小蓝莓',placeholder:'请输入角色名',inputType:'text',readOnly:false,maxLength:12,required:true,minLength:2},
  {kind:'image',label:'待添加肖像',recipeKey:'content.image@0.1.0',source:null,width:'fill',height:180,fit:'contain'},
];
const expectedKinds=['slider','switch','select','button','text','progress','input','image'];
const request={requestVersion:'0.1',id:'current-controls',target:'pixi',text:'确定性控件夹具：音量0到100步长1默认57；静音默认关闭；性别选项男、女，默认男；确认按钮通知宿主；说明为请选择角色；下载进度57/100；角色名单行输入默认小蓝莓，必填2到12字符；暂无肖像，保留180高的图片槽。'};
const section=(title,rows)=>({kind:'section',title,actionLayout:null,rows:rows.map(row=>({...row,sourceRef:'request',icon:null}))});
function intent(context,rows,mode='light'){
  const theme=catalog.themes.find(theme=>theme.id===`modern-mint-${mode}`&&theme.headingStyle==='concise-v2');
  return {panelIntentVersion:'0.11',contextSha256:context.sha256,unresolved:[],panel:{id:context.request.id,title:'控件验收',themeKey:`${theme.id}@${theme.version}`,panelSurface:null,
    layout:{width:null,canvasWidth:null,canvasHeight:null,maxHeight:360,overflow:'auto'},body:{kind:'column',children:[section('控件',rows)]}}};
}
const rowTypes={slider:'Slider',switch:'Switch',select:'Select',button:'Button',text:'Text',progress:'ProgressBar',input:'Input',image:'Container'};
for(const item of cases)test(`current default ${item.kind}: native proposal, single-row geometry, roundtrip and UGUI in both modes`,async()=>{
  for(const mode of ['light','dark']){
    const model=await createWorkbenchModel({catalog,pool:null},core);
    try{
      const {context}=await model.prepare(request),proposal=await materializePanelIntent(context,intent(context,[item],mode));
      assert.equal((await panel.checkPanelProposal(context,proposal)).status,'READY_TO_COMPILE');
      const snapshot=await model.acceptProposal(proposal),bundle=snapshot.panel,nodes=flatten(bundle.componentBundle.document.root);
      assert.equal(snapshot.phase,'ready');assert.equal(bundle.panelBundleVersion,'0.15');assert.equal(bundle.compilerVersion,'0.29.0');
      assert.equal(nodes.find(node=>node.id===panel.controlId(bundle.spec.id,'row0')).type,rowTypes[item.kind]);
      assert.equal(nodes.filter(node=>/\.section\.[^.]+\.title$/.test(node.id)).length,0);
      assert(nodes.find(node=>node.id.endsWith('.section.section0')).layout.height>=80);
      if(['slider','switch','progress','input'].includes(item.kind))assert.equal(bundle.state.row0,item.initial);
      if(item.kind==='select'){const field=bundle.spec.state[0];assert.deepEqual(field.options.map(option=>option.label),['男','女']);assert.equal(field.options.find(option=>option.id===bundle.state.row0).label,'男');}
      if(['button','text','image'].includes(item.kind))assert.deepEqual(bundle.state,{});
      assert.deepEqual(await panel.validatePanelBundle(JSON.parse(JSON.stringify(bundle)),core),bundle);
      const native=await panel.createUnityDocument(bundle,core);
      assert.equal(native.controls.length,['text','image'].includes(item.kind)?0:1);
      assert.equal(model.getEditBudget().used,0);
    }finally{model.dispose();}
  }
});

test('current native schema exposes exactly eight content kinds and rejects unsupported direct node intents',async()=>{
  const context=await panel.createPlanningContext(request,catalog),schema=buildNativePanelIntentResponseSchema(context);
  assert.deepEqual(context.capabilities.rowKinds,expectedKinds);assert.deepEqual(schema.properties.panelIntentVersion.enum,['0.11']);
  const branches=schema.$defs.body.anyOf.find(branch=>branch.properties?.rows).properties.rows.items.anyOf;
  assert.deepEqual(branches.map(branch=>branch.properties.kind.enum[0]),expectedKinds);
  for(const kind of ['CheckBox','RadioGroup','List','Dialog']){
    const unsupported=intent(context,[{...cases[0],kind}]);
    await assert.rejects(materializePanelIntent(context,unsupported),{code:'row-kind'});
  }
});

test('all eight content kinds coexist in scrolling Tabs and ordinary edits preserve values, actions and navigation',async()=>{
  const context=await panel.createPlanningContext(request,catalog),draft=intent(context,[]);
  draft.panel.body={kind:'tabs',enabled:true,sourceRef:'request',pages:[
    {label:'设置',initial:true,sourceRef:'request',body:{kind:'column',children:[section('设置',cases.slice(0,4))]}},
    {label:'角色',initial:false,sourceRef:'request',body:{kind:'column',children:[section('角色',cases.slice(4))]}},
  ]};
  const proposal=await materializePanelIntent(context,draft);
  assert.equal((await panel.checkPanelProposal(context,proposal)).status,'READY_TO_COMPILE');
  const bundle=await panel.createPanelBundle(proposal.spec,catalog,core);
  assert.deepEqual(bundle.spec.sections.flatMap(section=>section.rows.map(row=>row.kind)),expectedKinds);
  assert.equal(bundle.spec.tabs.pages.length,2);assert(flatten(bundle.componentBundle.document.root).some(node=>node.type==='ScrollView'));
  const trial={...bundle.state,row0:31,row1:true,row6:'新名字'},model=await createWorkbenchModel({catalog,pool:null},core);
  try{
    await model.importPanel(bundle,trial);const before=await model.exportPanel();
    await model.patch({patchVersion:'0.1',baseSpecSha256:await digestJson(before.spec),reason:'只改标题',operations:[{op:'set-panel-title',title:'组合控件验收'}]});
    const after=await model.exportPanel();assert.deepEqual(after.state,trial);
    for(const key of ['bindings','actions','assetClosure'])assert.deepEqual(after[key],before[key]);
    assert.deepEqual(after.spec.sections,before.spec.sections);assert.deepEqual(after.spec.tabs,before.spec.tabs);
    await panel.validatePanelBundle(JSON.parse(JSON.stringify(after)),core);
    const native=await panel.createUnityDocument(after,core);assert.equal(native.controls.length,7);
    assert.equal(model.getEditBudget().used,1);
  }finally{model.dispose();}
});
