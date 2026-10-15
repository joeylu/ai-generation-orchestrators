import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {customActionConfig} from '../src/panel/custom-panel.mjs';
import {editorData} from '../src/panel/data.mjs';
import {actionFixture} from '../src/panel/action-fixtures.mjs';
import {actionPresetFromIntent} from '../src/panel/action-intent.mjs';
import {customIntentLayout} from '../src/panel/custom-layout.mjs';
import {indexDocument} from '../src/panel/document.mjs';
import {documentLayout} from '../src/panel/layout.mjs';
import {recipeRef} from '../src/contracts/props.mjs';
import {settingsSkinGeometry} from '../src/panel/skin-geometry.mjs';
import {pngGeometry} from '../src/runtime/png-geometry.mjs';

const read=async p=>JSON.parse(await readFile(new URL(p,import.meta.url)));
const config=customActionConfig(await read('../configs/action-presets.json')),catalog=await read('../../ui-panel-harness/examples/modern-all-components.catalog.json'),examples=await read('../examples/custom-layout.json'),ctx=await editorData();
// Frozen v1 policy remains a regression contract after the default opts into v2.
config.presets.custom.layout={version:'1.0',groupGap:20,groupPadding:0,maxDepth:8,gridColumns:2,minColumnWidth:160};
const fixture=async(example=examples[0])=>actionFixture(example,catalog,config);
const convert=async(f,context=ctx,policy=config)=>actionPresetFromIntent(f.session,f.intent,policy,'custom',context);
const layout=doc=>{const i=indexDocument(doc),recipes=new Map(doc.nodes.map(n=>[n.id,ctx.registry.recipes.find(r=>recipeRef(r)===n.recipeRef)]));return documentLayout(i.nodes,recipes,i.parents,ctx.profile);};
const button=label=>({kind:'button',recipeKey:'settings.button.primary@0.1.0',label,enabled:true,action:'emit',resetRows:[],submitRows:[]});
const text=copy=>({kind:'text',recipeKey:'settings.text@0.1.0',label:'说明内容',text:copy,wrap:'word'});

// Minimal public geometry double, not a generated skin or delivery manifest.
const geometryContext=(mutate=()=>{})=>{
  const roles=ctx.usage.bindings.map(({role,assetId})=>({role,assetId}));
  const assets=[...new Set(roles.map(r=>r.assetId))].map(assetId=>({assetId,width:512,height:512,stretch:'nine-slice',nineSlice:{left:0,right:0,top:0,bottom:0},contentInsets:{left:0,right:0,top:0,bottom:0},minSize:{width:1,height:1}}));
  const pack={scale:1,roles,assets};mutate(pack);
  return {...ctx,...settingsSkinGeometry(pack),binding:{sourceKind:'imported',sha256:'a'.repeat(64)}};
};

test('custom preserves nested structure, section titles, global targets and deterministic row/column geometry',async()=>{
  const f=await fixture(),r=await convert(f);assert.deepEqual(await convert(f),r);
  assert.equal(r.content.layoutBody.children[0].kind,'row');
  assert.equal(r.content.layoutBody.children[0].children[1].kind,'column');
  assert.deepEqual(r.behavior.actions[0].targets,['row0','row1','row2']);
  assert.deepEqual(r.behavior.actions[1].targets,['row0']);
  for(const doc of Object.values(r.documents)){
    const computed=layout(doc),a=computed.get('group-0'),b=computed.get('layout-2');
    assert(Math.abs(a.y-b.y)<.05);assert(b.x>a.x+a.width);assert(Math.abs(a.width-b.width)<.05);
    assert(doc.nodes.filter(n=>n.id.match(/^group-\d+-heading$/)).length===4);
    assert(doc.nodes.some(n=>n.sizing?.widthMode==='fill'));assert(doc.nodes.some(n=>n.sizing?.heightMode==='content'));
    const actions=doc.nodes.find(n=>n.id==='group-3-actions');assert.equal(actions.layout.justify,'center');
    assert.equal(doc.nodes.find(n=>n.id==='row4').size.width,160);assert.equal(doc.nodes.find(n=>n.id==='row4').size.height,48);
  }
});

test('grid keeps two columns including the trailing cell, while column padding and group gaps are frozen policy',async()=>{
  const f=await fixture(examples[1]),policy=structuredClone(config);policy.presets.custom.layout.groupPadding=10;policy.presets.custom.layout.groupGap=24;
  const r=await convert(f,ctx,policy);
  for(const doc of Object.values(r.documents)){
    const grid=doc.nodes.find(n=>n.id==='layout-0');assert.equal(grid.layout.columns,2);assert.equal(grid.layout.gap,24);
    assert.equal(doc.nodes.find(n=>n.id==='group-0').layout.padding,10);
    const computed=layout(doc);assert(Math.abs(computed.get('layout-0-cell-0').width-computed.get('layout-0-cell-1').width)<.05);
    assert(computed.get('layout-0-cell-2').y>computed.get('layout-0-cell-0').y);
  }
  const narrow=structuredClone(f);narrow.intent.panel.layout.width=250;
  await assert.rejects(()=>convert(narrow),{code:'panel.action-layout-width'});
});

test('explicit width/maxHeight and selected orientation are honored; fixed canvas, auto and unknown semantics reject',async()=>{
  const f=await fixture();f.intent.panel.layout.width=640;f.intent.panel.layout.maxHeight=650;
  const r=await convert(f,{...ctx,orientation:'landscape'});assert.deepEqual(Object.keys(r.documents),['landscape']);
  assert.equal(r.documents.landscape.nodes.find(n=>n.id==='surface').size.width,640);
  assert(r.documents.landscape.nodes.find(n=>n.id==='surface').size.height<=650);
  for(const mutate of [i=>i.panel.layout.width=2000,i=>i.panel.layout.maxHeight=100,i=>i.panel.layout.canvasWidth=1280,i=>i.panel.layout.overflow='auto',i=>i.panel.body.children[0].children[0].actionLayout={direction:'row',align:'start',gap:0,buttonWidth:100,buttonHeight:44,shape:'default',sourceRef:'request'},i=>i.panel.body.children[1].actionLayout.shape='circle',i=>i.panel.body.children[0].ratio=[1,2]]){
    const next=structuredClone(f);mutate(next.intent);await assert.rejects(()=>convert(next,{...ctx,orientation:'landscape'}));
  }
  const tabs=structuredClone(f);tabs.intent.panel.body={kind:'tabs',enabled:true,sourceRef:'request',pages:[true,false].map((initial,i)=>({label:'页'+i,initial,sourceRef:'request',body:structuredClone(f.intent.panel.body)}))};
  await assert.rejects(()=>convert(tabs),{code:'panel.action-grouping'});
  const unknown=await fixture({...examples[0],body:{...examples[0].body,widthRatios:[1,2]}});
  await assert.rejects(()=>convert(unknown),{code:'panel.intent-schema'});
});

test('default width grows for consecutive wide buttons and rejects captions in explicit undersized controls',async()=>{
  const e={...examples[0],body:{kind:'column',children:[{kind:'section',title:'操作',rows:[button('WWWWWWWWWWWWWWWWWWWW'),button('@@@@@@@@@@@@@@@@@@@@')]}]}};
  const f=await fixture(e),r=await convert(f,{...ctx,orientation:'landscape'});
  const doc=r.documents.landscape;assert(doc.nodes.find(n=>n.id==='surface').size.width>760);
  const tooNarrow=structuredClone(f);tooNarrow.intent.panel.layout.width=640;await assert.rejects(()=>convert(tooNarrow),{code:'panel.action-layout-width'});
  const single={...e,body:{kind:'column',children:[{kind:'section',title:'操作',actionLayout:{direction:'row',align:'center',gap:8,buttonWidth:160,buttonHeight:48,shape:'default'},rows:[button('WWWWWWWWWWWWWWWW')]}]}};
  await assert.rejects(async()=>convert(await fixture(single)),{code:'panel.action-action-size'});
});

test('custom scroll retains legacy fixed footer but rich group buttons stay in their authored section',async()=>{
  const [legacy]=await read('../examples/custom-panel.json'),r=await convert(await fixture(legacy));
  for(const doc of Object.values(r.documents)){
    const nodes=new Map(doc.nodes.map(n=>[n.id,n]));assert.deepEqual(nodes.get('actions').slots.children,['row7','row8']);
    assert(!nodes.get('body').slots.children.includes('row7'));
    assert(nodes.get('body').slots.children.includes('actions'));
  }
  const rich=await fixture({...examples[0],overflow:'scroll'}),compiled=await convert(rich);
  for(const doc of Object.values(compiled.documents)){
    assert(!doc.nodes.some(n=>n.id==='actions'));assert(doc.nodes.find(n=>n.id==='group-3-actions').slots.children.includes('row4'));
  }
  // 2 x 200px captions fit the full-width footer, while the scroll viewport is
  // narrower. Measuring these fixed actions against the viewport would reject.
  const narrow={...examples[0],overflow:'scroll',layout:{width:488},body:{kind:'column',children:[{kind:'section',title:'说明',rows:[text('简短说明'),button('WWWWWWWWWW'),button('@@@@@@@@@@')]}]}};
  const fitted=await convert(await fixture(narrow));
  assert.equal(fitted.documents.portrait.nodes.find(n=>n.id==='surface').size.width,488);
});

test('long wrapped copy expands content without reducing font size, and explicit height remains a hard cap',async()=>{
  const copy='完整保留段落和显示文案。'.repeat(50),e={...examples[0],body:{kind:'column',children:[{kind:'section',title:'说明',rows:[text(copy)]}]},overflow:'scroll'};
  const r=await convert(await fixture(e));
  for(const doc of Object.values(r.documents)){const node=doc.nodes.find(n=>n.id==='row0');assert.equal(node.props.text,copy);assert(node.size.height>config.geometry.textHeight);assert.equal(node.props.overflow,'error');}
  await assert.rejects(async()=>convert(await fixture({...e,overflow:'error',layout:{maxHeight:300}})),{code:'panel.action-canvas-capacity'});
});

test('PNG safe insets, field sizes, nine-slice and explicit button sizes use the shared renderer gate',async()=>{
  const f=await fixture(),context=geometryContext(pack=>{const panel=pack.assets.find(a=>a.assetId===pack.roles.find(r=>r.role==='skin.surface.panel').assetId);panel.contentInsets={left:40,right:44,top:38,bottom:36};});
  const r=await convert(f,context);
  for(const doc of Object.values(r.documents)){assert.deepEqual(doc.nodes.find(n=>n.id==='surface').props.contentPadding,{left:40,right:44,top:38,bottom:36});assert.equal(doc.bindings.sha256,context.binding.sha256);}
  await assert.rejects(()=>convert(f,{...context,skinGeometry:undefined}),{code:'panel.action-skin-geometry'});
  const tall=geometryContext(pack=>{for(const a of pack.assets)if(a.assetId.startsWith('button.'))a.contentInsets={left:0,right:0,top:24,bottom:24};});
  await assert.rejects(()=>convert(f,tall),{code:'panel.action-action-size'});
  const unsafe=geometryContext(pack=>{const panel=pack.assets.find(a=>a.assetId===pack.roles.find(r=>r.role==='skin.surface.panel').assetId);panel.minSize.height=2000;});
  await assert.rejects(()=>convert(f,unsafe),{code:'panel.action-canvas-capacity'});
  const popup=geometryContext(pack=>{const asset=pack.assets.find(a=>a.assetId===pack.roles.find(r=>r.role==='skin.surface.popup').assetId);asset.minSize.height=2000;});
  await assert.rejects(async()=>convert(await fixture(examples[1]),popup),{code:'skin.minimum'});
  const skin=pngGeometry(context.skinGeometry,ctx.profile);assert.throws(()=>skin.assertComponent('Panel',{title:'',contentPadding:{left:0,right:0,top:0,bottom:0}},640,400),{code:'panel.padding'});
});

test('structure depth and node count preserve upstream limits rather than emitting oversized trees',async()=>{
  const f=await fixture();let body=f.intent.panel.body;
  for(let i=0;i<8;i++)body={kind:'column',children:[body]};
  assert.throws(()=>customIntentLayout({...f.intent.panel,body},config.presets.custom),{code:'panel.action-layout-depth'});
  body={kind:'column',children:Array.from({length:32},()=>({kind:'column',children:[{kind:'column',children:[structuredClone(f.intent.panel.body.children[1])]}]}))};
  assert.throws(()=>customIntentLayout({...f.intent.panel,body},config.presets.custom),{code:'panel.action-layout-count'});
});
