import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {editorData} from '../src/panel/data.mjs';
import {customActionConfig} from '../src/panel/custom-panel.mjs';
import {actionFixture} from '../src/panel/action-fixtures.mjs';
import {actionPresetFromIntent} from '../src/panel/action-intent.mjs';
import {referencePresetList,referenceExample,referenceActionConfig,referenceSettingsPolicy} from '../src/panel/reference-presets.mjs';
import {settingsFromIntent} from '../src/panel/settings-intent.mjs';
import {inventoryActionConfig,inventoryPlanningCatalog,inventoryPresetFromIntent} from '../src/panel/inventory-intent.mjs';
import {inventoryIntentFixture} from '../src/panel/inventory-fixtures.mjs';
import {planningClient} from '../src/panel/planning-client.mjs';
import {compilationSurfaceVersion,surfaceCompileContext} from '../src/panel/surface-presentation.mjs';
import {actionPlanningFiles} from '../src/panel/action-model.mjs';
import {readPanelSdkJson} from '../src/panel/sdk.mjs';
import {headingPresentation} from '../src/panel/headings.mjs';
import {settingsSkinGeometry} from '../src/panel/skin-geometry.mjs';
import {surfaceLayerInfo} from '../src/skins/surface-styles.mjs';

const read=async path=>JSON.parse(await readFile(new URL(path,import.meta.url))),base=await read('../configs/action-presets.json'),ctx=await editorData(),catalog=await readPanelSdkJson('examples/modern-all-components.catalog.json');
base.presentation.version='2.0';
const frozenSettingsLayout=await read('../configs/settings-layout.json');frozenSettingsLayout.presentation.version='2.0';
const legacyCustom=()=>{const config=customActionConfig(base);config.presets.custom.layout.version='3.0';return config;};
const text=(label,copy)=>({kind:'text',recipeKey:'settings.text@0.1.0',label,text:copy,wrap:'word'}),button={kind:'button',recipeKey:'settings.button.primary@0.1.0',label:'查看',enabled:true,action:'emit',resetRows:[],submitRows:[]};
const example={id:'surface-layers',presetId:'custom',title:'资料与说明',request:'展示完整资料和说明，按钮只发本地事件。',overflow:'scroll',body:{kind:'column',children:[
 {kind:'section',title:'说明',rows:[text('欢迎来到云海','欢迎来到云海')]},
 {kind:'section',title:'资料',rows:[text('姓名','阿青'),text('等级','12')]},
 {kind:'section',title:'偏好',rows:[text('当前状态','探索中'),{kind:'switch',recipeKey:'settings.switch@0.1.0',label:'音乐',enabled:true,initial:true},button]},
 {kind:'section',title:'操作',rows:[button]},
]}};
const convert=async(config,context=ctx)=>{const fixture=await actionFixture(example,catalog,config);return actionPresetFromIntent(fixture.session,fixture.intent,config,'custom',context);};

test('custom v3 assigns one meaningful surface per information group and leaves layout transparent',async()=>{
 const config=legacyCustom(),result=await convert(config),legacy=structuredClone(config);legacy.presets.custom.layout.version='2.0';
 const old=await convert(legacy);assert.deepEqual(result.content,old.content);assert.deepEqual(result.behavior,old.behavior);
 for(const [orientation,doc]of Object.entries(result.documents)){
  const node=id=>doc.nodes.find(n=>n.id===id);assert.equal(node('surface').surfaceLayer,'frame');assert.equal(node('group-0').surfaceLayer,'content');
  assert.equal(node('group-1').recipeRef,'container@1.0.0');assert.equal(node('row1-block').surfaceLayer,'inset');assert.equal(node('row2-block').surfaceLayer,'inset');
  assert.equal(node('group-2').surfaceLayer,'content');assert.equal(node('row3-block').recipeRef,'container@1.0.0');assert.equal(node('group-3').recipeRef,'container@1.0.0');
  assert.equal(node('custom-scroll').surfaceLayer,'content');assert.ok(doc.nodes.filter(n=>n.recipeRef==='container@1.0.0').every(n=>!n.surfaceLayer));
  assert.ok(old.documents[orientation].nodes.every(n=>!n.surfaceLayer));assert.equal(old.documents[orientation].nodes.find(n=>n.id==='group-0').recipeRef,'container@1.0.0');
 }
});

test('all eight reference presets opt into frame/content/data presentation without changing their shape',async()=>{
 for(const {id}of referencePresetList()){
  const config=id==='sdk-settings'?base:referenceActionConfig(base,id),fixture=await actionFixture(referenceExample(id),catalog,config);
  const result=id==='sdk-settings'?await settingsFromIntent(fixture.session,fixture.intent,referenceSettingsPolicy(await read('../configs/settings-planning-policy.json')),frozenSettingsLayout,ctx):await actionPresetFromIntent(fixture.session,fixture.intent,config,id,ctx);
  for(const doc of Object.values(result.documents)){
   assert.equal(doc.nodes.filter(n=>n.surfaceLayer==='frame').length,1,id);
   if(id.startsWith('sdk-result'))assert.equal(doc.nodes.filter(n=>n.surfaceLayer==='inset').length,3,id);
   if(id==='sdk-settings'||id.startsWith('sdk-loading'))assert.ok(doc.nodes.some(n=>n.surfaceLayer==='content'),id);
  }
 }
});

test('inventory presentation is frozen separately from fixed-cell scrolling and old prompts stay selectable',async()=>{
 const context={...ctx,orientation:'landscape'},config=inventoryActionConfig(base,context);
 config.inventoryPlanning.version='1.2';config.inventoryPlanning.layout.version='1.3';config.inventoryPlanning.layout.surfaceLayer='content';delete config.inventoryPlanning.layout.frameScale;config.inventoryPlanning.capabilities.version='1.2';config.inventoryPlanning.capabilities.surfaceLayer='content';delete config.inventoryPlanning.capabilities.frameScale;
 const legacy=structuredClone(config),policy=legacy.inventoryPlanning;
 policy.version='1.1';policy.layout.version='1.2';delete policy.layout.surfaceLayer;policy.capabilities.version='1.1';delete policy.capabilities.surfaceLayer;
 assert.equal(actionPlanningFiles('inventory',legacy).instructions,'prompts/inventory-planner-v2.md');assert.equal(actionPlanningFiles('inventory',config).instructions,'prompts/inventory-planner.md');
 for(const [input,layered]of [[config,true],[legacy,false]]){
  const session=await planningClient().prepare({request:{requestVersion:'0.1',id:'surface-inventory',text:'空仓库',target:'pixi'},catalog:inventoryPlanningCatalog(input)}),intent=inventoryIntentFixture(session,input,{items:[],selectedSlot:null}),result=await inventoryPresetFromIntent(session,intent,input,'inventory',context),list=result.documents.landscape.nodes.find(n=>n.id==='inventory-grid');
  assert.equal(list.surfaceLayer,layered?'content':undefined);assert.deepEqual(list.props.items,[]);assert.equal(list.props.inventory.cellSize,input.inventoryPlanning.programGrid.cellWidth);
 }
});

test('surface recipe markers and exact custom prompt versions preserve old replay contracts',()=>{
 const next=legacyCustom(),old=structuredClone(next);old.presets.custom.layout.version='2.0';
 assert.equal(compilationSurfaceVersion(next,'custom'),2);assert.equal(compilationSurfaceVersion(old,'custom'),1);assert.equal(compilationSurfaceVersion(next,'custom',{surfaceStylesEnabled:false}),0);
 assert.equal(actionPlanningFiles('custom',old).instructions,'prompts/custom-panel-planner-v2.md');assert.equal(actionPlanningFiles('custom',next).instructions,'prompts/custom-panel-planner.md');
 assert.deepEqual(surfaceCompileContext({},0),{surfaceStylesEnabled:false,surfaceLayersEnabled:false,surfaceCompositionEnabled:false});assert.deepEqual(surfaceCompileContext({},1),{surfaceStylesEnabled:true,surfaceLayersEnabled:false,surfaceCompositionEnabled:false});assert.throws(()=>surfaceCompileContext({},4));
});

test('new short prose shrinks to content while old v2 retains its frozen height floor',async()=>{
 const config=legacyCustom(),old=structuredClone(config);old.presets.custom.layout.version='2.0';
 const e={...example,overflow:'error',body:{kind:'column',children:[{kind:'section',title:'说明',rows:[text('欢迎来到云海','欢迎来到云海')]}]}};
 const compile=async policy=>{const fixture=await actionFixture(e,catalog,policy);return actionPresetFromIntent(fixture.session,fixture.intent,policy,'custom',ctx);};
 const next=await compile(config),legacy=await compile(old);
 assert.deepEqual(next.content,legacy.content);assert.deepEqual(next.behavior,legacy.behavior);
 assert.ok(next.documents.landscape.nodes.find(n=>n.id==='surface').size.height<620);assert.equal(legacy.documents.landscape.nodes.find(n=>n.id==='surface').size.height,620);
});

test('new heading ornament insets are explicit and measured while legacy heading output stays unchanged',()=>{
 const geometry={roles:[{role:'skin.surface.bar',assetId:'title'}],assets:[{assetId:'title',width:200,height:40,minSize:{width:31,height:24},contentInsets:{left:0,right:0,top:0,bottom:0},nineSlice:{left:15,right:15,top:11,bottom:12}}]},context={...ctx,skinGeometry:geometry};
 const old=headingPresentation(context,'title',800,32),before=structuredClone(old),next=headingPresentation(context,'title',800,32,{layered:true});
 assert.equal(old.surfaceTextInsets,undefined);assert.ok(next.surfaceTextInsets.left>=88);assert.ok(next.surfaceTextInsets.top>=17);assert.ok(next.height>old.height);assert.deepEqual(headingPresentation(context,'title',800,32),before);
});

test('compact scrolling includes the actual decorated content insets in width and natural height',async()=>{
 const roles=ctx.usage.bindings.map(({role,assetId})=>({role,assetId})),assets=[...new Set(roles.map(r=>r.assetId))].map(assetId=>({assetId,width:512,height:512,stretch:'nine-slice',nineSlice:{left:0,right:0,top:0,bottom:0},contentInsets:{left:0,right:0,top:0,bottom:0},minSize:{width:1,height:1}}));
 Object.assign(assets.find(a=>a.assetId===roles.find(r=>r.role==='skin.surface.content').assetId),{nineSlice:{left:15,right:15,top:11,bottom:12},minSize:{width:31,height:24}});
 const context={...ctx,...settingsSkinGeometry({scale:1,roles,assets}),orientation:'landscape',binding:{sourceKind:'imported',sha256:'a'.repeat(64)}};
 const e={...example,body:{kind:'column',children:[{kind:'section',title:'说明',rows:[text('欢迎来到云海','欢迎来到云海')]}]}},config=legacyCustom(),fixture=await actionFixture(e,catalog,config),result=await actionPresetFromIntent(fixture.session,fixture.intent,config,'custom',context),doc=result.documents.landscape,scroll=doc.nodes.find(n=>n.id==='custom-scroll'),content=doc.nodes.find(n=>n.id===scroll.slots.content[0]),safe=surfaceLayerInfo(context.skinGeometry,'content').insets;
 const pad=Object.fromEntries(Object.entries(safe).map(([key,value])=>[key,Math.max(value,ctx.profile.padding)]));
 assert.ok(scroll.size.height-pad.top-pad.bottom>=content.size.height-.01);assert.ok(scroll.size.width-pad.left-pad.right-ctx.profile.geometry.scrollbarWidth-ctx.profile.geometry.scrollbarGap>=content.size.width-.01);
});
