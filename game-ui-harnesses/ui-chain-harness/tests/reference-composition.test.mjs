import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {editorData} from '../src/panel/data.mjs';
import {customActionConfig} from '../src/panel/custom-panel.mjs';
import {actionFixture} from '../src/panel/action-fixtures.mjs';
import {actionPresetFromIntent} from '../src/panel/action-intent.mjs';
import {referencePresetList,referenceExample,referenceActionConfig,referenceSettingsPolicy} from '../src/panel/reference-presets.mjs';
import {settingsFromIntent} from '../src/panel/settings-intent.mjs';
import {compilationSurfaceVersion,surfaceCompileContext} from '../src/panel/surface-presentation.mjs';
import {surfaceVersion} from '../src/acceptance/replay.mjs';
import {validateDocument} from '../src/panel/document.mjs';
import {validateSizeEdit} from '../src/panel/size-edit.mjs';
const read=async p=>JSON.parse(await readFile(new URL(p,import.meta.url))),base=await read('../configs/action-presets.json'),data=await editorData(),catalog=await read('../../ui-panel-harness/examples/modern-all-components.catalog.json');
const roles=data.usage.bindings.map(({role,assetId})=>({role,assetId})),assets=[...new Set(roles.map(r=>r.assetId))].map(assetId=>({assetId,width:512,height:256,density:1,stretch:'nine-slice',nineSlice:{left:10,right:10,top:10,bottom:10},contentInsets:{left:14,right:14,top:14,bottom:14},minSize:{width:29,height:29}}));
const ctx={...data,skinGeometry:{version:'1.0',scale:1,roles,assets},panelInsets:{left:14,right:14,top:14,bottom:14},scrollInsets:{left:14,right:14,top:14,bottom:14}};
const prose=value=>({kind:'text',recipeKey:'settings.text@0.1.0',label:value,text:value,wrap:'word'});
const make=async(example,config=customActionConfig(base))=>{const fixture=await actionFixture(example,catalog,config);return actionPresetFromIntent(fixture.session,fixture.intent,config,'custom',ctx);};
const notice={id:'reference-notice',presetId:'custom',title:'公告面板',sectionTitle:'正文',request:'公告面板，正文“欢迎来到云海小镇，愿你今天有所收获。”',rows:[prose('欢迎来到云海小镇，愿你今天有所收获。')]};
test('a simple announcement is one main board with a larger heading and continuous body',async()=>{
 const result=await make(notice),oldConfig=customActionConfig(base);oldConfig.presets.custom.layout.version='3.0';const old=await make(notice,oldConfig);
 assert.deepEqual(result.content.fields,old.content.fields);assert.deepEqual(result.behavior,old.behavior);
 for(const doc of Object.values(result.documents)){
  assert.equal(doc.nodes.filter(n=>n.recipeRef==='panel@1.0.0').length,1);assert.equal(doc.nodes.find(n=>n.id==='surface').surfaceScale,3);
  const heading=doc.nodes.find(n=>n.id==='heading');assert.equal(heading.surfaceBand,'reference-v1');assert(heading.surfaceFontSize>ctx.profile.fontSize);assert(heading.size.height>=64);
  assert.equal(doc.nodes.find(n=>n.id==='row0').props.text,notice.rows[0].text);assert(!doc.nodes.some(n=>n.id==='group-0-heading'));
  assert.deepEqual(validateSizeEdit(doc,doc,ctx),doc);
 }
 assert(old.documents.landscape.nodes.filter(n=>n.recipeRef==='panel@1.0.0').length>1);
});
test('explicit groups keep their names while invented wrappers and multiple gold frames are removed',async()=>{
 const e={...notice,request:'移动“拖动摇杆移动。”、交互“点击目标查看。”，底部关闭。',body:{kind:'column',children:[
  {kind:'section',title:'移动',rows:[prose('拖动摇杆移动。')]},{kind:'section',title:'交互',rows:[prose('点击目标查看。')]},
  {kind:'section',title:'操作',rows:[{kind:'button',recipeKey:'settings.button.primary@0.1.0',label:'关闭',enabled:true,action:'emit',resetRows:[],submitRows:[]}]},
 ]}};
 const result=await make(e);for(const doc of Object.values(result.documents)){
  assert.deepEqual(doc.nodes.filter(n=>n.surfaceLayer==='frame').map(n=>n.id),['surface']);assert(!doc.nodes.some(n=>n.surfaceLayer==='content'));
  for(const id of ['group-0','group-1'])assert.equal(doc.nodes.find(n=>n.id===id).surfaceLayer,'inset');
  assert.equal(doc.nodes.find(n=>n.id==='group-0-heading').props.text,'移动');assert.equal(doc.nodes.find(n=>n.id==='group-1-heading').props.text,'交互');assert(!doc.nodes.some(n=>n.id==='group-2-heading'));
  assert(doc.nodes.find(n=>n.id==='heading').surfaceFontSize>doc.nodes.find(n=>n.id==='group-0-heading').surfaceFontSize);
 }assert.equal(result.behavior.actions[0].action,'emit');
});
test('every current reference preset uses one stronger main frame and quieter sections',async()=>{
 for(const {id}of referencePresetList()){
  const config=id==='sdk-settings'?base:referenceActionConfig(base,id),fixture=await actionFixture(referenceExample(id),catalog,config);
  const result=id==='sdk-settings'?await settingsFromIntent(fixture.session,fixture.intent,referenceSettingsPolicy(await read('../configs/settings-planning-policy.json')),await read('../configs/settings-layout.json'),ctx):await actionPresetFromIntent(fixture.session,fixture.intent,config,id,ctx);
  for(const doc of Object.values(result.documents)){
   const frames=doc.nodes.filter(n=>n.surfaceLayer==='frame');assert.equal(frames.length,1,id);assert.equal(frames[0].surfaceScale,3,id);
   assert(!doc.nodes.some(n=>n.surfaceLayer==='content'),id);assert.equal(doc.nodes.find(n=>n.id==='heading').surfaceBand,'reference-v1',id);
  }
 }
});
test('new display markers are validated and old consumer/conversion choices stay explicit',async()=>{
 const {documents}=await make(notice),doc=documents.landscape,bad=structuredClone(doc);bad.nodes.find(n=>n.id==='row0').surfaceScale=3;
 assert.throws(()=>validateDocument(bad,ctx),{code:'panel.surface-layer'});const band=structuredClone(doc);band.nodes.find(n=>n.id==='surface').surfaceBand='reference-v1';assert.throws(()=>validateDocument(band,ctx),{code:'panel.surface-style'});
 const current=customActionConfig(base),old=structuredClone(current);old.presets.custom.layout.version='3.0';assert.equal(compilationSurfaceVersion(current,'custom'),3);assert.equal(compilationSurfaceVersion(old,'custom'),2);
 for(const marker of [0,1,2,3])assert.equal(surfaceVersion({config:current,presetId:'custom'},{status:'COMPILED',surfaceRecipesVersion:marker}),marker);
 assert.equal(surfaceCompileContext({},2).surfaceCompositionEnabled,false);assert.equal(surfaceCompileContext({},3).surfaceCompositionEnabled,true);
});

test('reference heading typography is independent of frozen component props contracts',async()=>{
 const result=await make(notice),oldRegistry=structuredClone(ctx.registry);
 const textRecipe=oldRegistry.recipes.find(r=>r.type==='Text');
 const strip=value=>{if(!value||typeof value!=='object')return;for(const [key,child]of Object.entries(value)){if(key==='properties'&&child?.fontSize)delete child.fontSize;else strip(child);}};
 strip(textRecipe);
 for(const doc of Object.values(result.documents)){
  const heading=doc.nodes.find(n=>n.id==='heading');assert.equal(heading.props.fontSize,undefined);assert(heading.surfaceFontSize>ctx.profile.fontSize);
  assert.doesNotThrow(()=>validateDocument(doc,{...ctx,registry:oldRegistry}));
  const bad=structuredClone(doc);bad.nodes.find(n=>n.id==='heading').surfaceBand=undefined;assert.throws(()=>validateDocument(bad,ctx),{code:'panel.surface-style'});
 }
});
