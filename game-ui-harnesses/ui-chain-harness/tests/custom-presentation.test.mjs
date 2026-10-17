import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {customActionConfig} from '../src/panel/custom-panel.mjs';
import {customLayoutPolicy} from '../src/panel/custom-presentation.mjs';
import {editorData} from '../src/panel/data.mjs';
import {actionFixture} from '../src/panel/action-fixtures.mjs';
import {actionPresetFromIntent} from '../src/panel/action-intent.mjs';
import {settingsSkinGeometry} from '../src/panel/skin-geometry.mjs';
import {resourceClosure} from '../src/panel/document.mjs';
import {validateSizeEdit,sizeEditTargets} from '../src/panel/size-edit.mjs';
const read=async p=>JSON.parse(await readFile(new URL(p,import.meta.url)));
const config=customActionConfig(await read('../configs/action-presets.json')),catalog=await read('../../ui-panel-harness/examples/modern-all-components.catalog.json'),ctx=await editorData();
// Preserve the original v2 rendering as an explicit frozen policy regression.
config.presets.custom.layout.version='2.0';
const data=(label,text)=>({kind:'text',recipeKey:'settings.text@0.1.0',label,text,wrap:'none'});
const button={kind:'button',recipeKey:'settings.button.primary@0.1.0',label:'查看任务',enabled:true,action:'emit',resetRows:[],submitRows:[]};
const example={id:'adaptive-cards',presetId:'custom',title:'任务列表',request:'任务列表，三个任务卡片展示名称与状态，各有查看按钮，按画布安排列数。',overflow:'scroll',body:{kind:'grid',children:Array.from({length:3},(_,i)=>({kind:'section',title:'任务'+(i+1),rows:[data('任务名称','森林巡逻'),data('状态','进行中'),button]}))}};
const compile=async(e=example,context=ctx,policy=config)=>{const f=await actionFixture(e,catalog,policy);return actionPresetFromIntent(f.session,f.intent,policy,'custom',context);};
const node=(doc,id)=>doc.nodes.find(n=>n.id===id);

test('v2 uses real group/data Panels while keeping rows, actions, identity and editor contracts',async()=>{
 const r=await compile(),legacy=structuredClone(config);legacy.presets.custom.layout={version:'1.0',groupGap:20,groupPadding:0,maxDepth:8,gridColumns:2,minColumnWidth:160};
 const before=await compile(example,ctx,legacy);assert.deepEqual(r.behavior,before.behavior);assert.deepEqual(r.content,before.content);
 for(const doc of Object.values(r.documents)){
  assert.equal(node(doc,'group-0').recipeRef,'panel@1.0.0');assert.equal(node(doc,'row0-block').recipeRef,'panel@1.0.0');
  assert.equal(node(doc,'row0').props.text,'森林巡逻');assert.equal(node(doc,'row0').props.wrap,'none');
  assert.equal(node(doc,'group-0-content').slots.children.at(-1),'group-0-actions-2');
  assert.deepEqual(validateSizeEdit(doc,doc,ctx),doc);
  assert(resourceClosure(doc,ctx).roles.includes('skin.surface.panel'));
 }
 assert.equal(node(before.documents.landscape,'group-0').recipeRef,'container@1.0.0');
});

test('adaptive grid chooses three/two/one columns from canvas, content and explicit width; rows stay authoritative',async()=>{
 const r=await compile();assert.equal(node(r.documents.landscape,'layout-0').layout.columns,3);assert.equal(node(r.documents.portrait,'layout-0').layout.columns,1);
 const two=await compile({...example,layout:{width:640}},{...ctx,orientation:'landscape'});assert.equal(node(two.documents.landscape,'layout-0').layout.columns,2);assert.equal(node(two.documents.landscape,'surface').size.width,640);
 const one=await compile({...example,layout:{width:320}},{...ctx,orientation:'landscape'});assert.equal(node(one.documents.landscape,'layout-0').layout.columns,1);
 const explicit=await compile({...example,body:{...example.body,kind:'row'}},{...ctx,orientation:'landscape'});assert.equal(node(explicit.documents.landscape,'layout-0').layout.direction,'row');assert.equal(node(explicit.documents.landscape,'layout-0').slots.children.length,3);
 await assert.rejects(()=>compile({...example,layout:{width:320},body:{...example.body,kind:'row'}},{...ctx,orientation:'landscape'}),{code:'panel.action-layout-width'});
});

test('label/value pairs switch arrangement together without truncation, source edits or font reduction',async()=>{
 const e={...example,overflow:'error',body:{kind:'column',children:[{kind:'section',title:'任务详情',rows:[data('当前任务名称','已经完成森林巡逻'),data('任务状态','已完成')]}]}};
 const wide=await compile({...e,layout:{width:460}},{...ctx,orientation:'landscape'}),narrow=await compile({...e,layout:{width:320}},{...ctx,orientation:'landscape'});
 for(const id of ['row0','row1']){
  assert.equal(node(wide.documents.landscape,id+'-data-content').layout.direction,'row');
  assert.equal(node(narrow.documents.landscape,id+'-data-content').layout.direction,'column');
  assert.deepEqual(node(wide.documents.landscape,id).props,node(narrow.documents.landscape,id).props);
  assert.equal(node(narrow.documents.landscape,id).props.overflow,'error');assert.equal(node(narrow.documents.landscape,id).props.fontSize,undefined);
 }
 await assert.rejects(()=>compile({...e,layout:{width:200}},{...ctx,orientation:'landscape'}),{code:'panel.action-layout-width'});
});

test('content cards honor verified asymmetric skin insets; prose and action sections remain plain',async()=>{
 const roles=ctx.usage.bindings.map(({role,assetId})=>({role,assetId})),assets=[...new Set(roles.map(r=>r.assetId))].map(assetId=>({assetId,width:512,height:512,stretch:'nine-slice',nineSlice:{left:4,right:4,top:4,bottom:4},contentInsets:{left:0,right:0,top:0,bottom:0},minSize:{width:9,height:9}}));
 const safe={left:28,right:34,top:18,bottom:20};assets.find(a=>a.assetId===roles.find(r=>r.role==='skin.surface.panel').assetId).contentInsets=safe;
 const imported={...ctx,...settingsSkinGeometry({scale:1,roles,assets}),binding:{sourceKind:'imported',sha256:'b'.repeat(64)},orientation:'landscape'};
 const e={...example,overflow:'error',body:{kind:'column',children:[{kind:'section',title:'资料',rows:[data('姓名','旅行者')]},{kind:'section',title:'说明',rows:[{...data('欢迎查看资料','欢迎查看资料'),wrap:'word'}]},{kind:'section',title:'操作',rows:[button]}]}};
 const doc=(await compile(e,imported)).documents.landscape;
 assert.deepEqual(node(doc,'group-0').props.contentPadding,safe);assert.deepEqual(node(doc,'row0-block').props.contentPadding,safe);
 assert.equal(node(doc,'group-1').recipeRef,'container@1.0.0');assert.equal(node(doc,'group-2').recipeRef,'container@1.0.0');
 assert.equal(doc.nodes.filter(n=>n.props.text==='欢迎查看资料').length,1);
});

test('presentation policy rejects unknown knobs, invalid capacity and blank surface modes',()=>{
 for(const change of [l=>l.maxColumns=4,l=>l.minCardWidth=0,l=>l.groupSurfaces='yes',l=>l.minColumnWidth=0,l=>l.columnRatios=[1,2]]){
  const p=structuredClone(config.presets.custom);change(p.layout);assert.throws(()=>customLayoutPolicy(p),{code:'panel.action-layout-policy'});
 }
});

test('mixed Panel and Container columns keep equal resolved widths and fit their content slots',async()=>{
 const [nested]=await read('../examples/custom-layout.json'),doc=(await compile(nested,{...ctx,orientation:'landscape'})).documents.landscape;
 const peers=node(doc,'layout-1').slots.children.map(id=>sizeEditTargets(doc,ctx).find(n=>n.id===id));
 assert.deepEqual(new Set(peers.map(n=>n.type)),new Set(['Panel','Container']));
 assert(Math.abs(peers[0].width-peers[1].width)<.1);
 assert.deepEqual(validateSizeEdit(doc,doc,ctx),doc);
});
