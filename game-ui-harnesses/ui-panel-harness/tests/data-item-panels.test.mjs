import test from 'node:test';
import assert from 'node:assert/strict';
import {readJson} from '../src/io.mjs';
import {core,nodesOf} from './helpers.mjs';
import {createPanelBundle} from '../src/panel-bundle.mjs';
import {arrangeIntentSpec} from '../src/panel-intent.mjs';
import {attachPanelSession} from '../src/state.mjs';
import {createUnityDocument} from '../src/unity-export.mjs';
import {loadBundledCoreAssets} from '../src/bundled-core-assets.mjs';
import {workbenchAssetInputs} from '../src/workbench-assets.mjs';
import {isDataItem} from '../src/data-item-panels.mjs';
import {createWorkbenchModel} from '../src/workbench-model.mjs';
import {buildCodexPlanningPrompt} from '../src/codex-planner.mjs';
const catalog=await readJson(new URL('../examples/modern-readable-game-data-panels.catalog.json',import.meta.url));
const fixture=await readJson(new URL('./fixtures/data-item-panels-regressions-v1.json',import.meta.url)),pool=await loadBundledCoreAssets();
const body=node=>node.kind==='section'?{kind:'section',sectionId:node.sectionId}:{kind:node.kind,children:node.children.map(body)};
function arrange(record,change=()=>{},settings={},themeId=record.spec.theme.id){
 const spec=structuredClone(record.spec),theme=catalog.themes.find(theme=>theme.id===themeId&&theme.headingStyle==='concise-v5');spec.theme={id:theme.id,version:theme.version};change(spec);
 return arrangeIntentSpec(spec,{width:null,canvasWidth:null,canvasHeight:null,maxHeight:null,overflow:'auto',body:body(spec.layout.body),sourceQuote:null,...settings},theme,catalog);
}
function hydrate(bundle,document=bundle.componentBundle.document){return attachPanelSession(bundle.spec,{getDocument:()=>structuredClone(document),subscribe:()=>()=>{},setValue(){},setEnabled(){},setVisible(){}},()=>{throw Error('UNEXPECTED_EVENT');},bundle.state,'minimal-v1',catalog);}
for(const record of fixture.records)test(`${record.id}: exact 0.43 replay; data Panels preserve content and bindings`,async()=>{
 const old=await createPanelBundle(record.spec,fixture.catalog,core,record.state,await workbenchAssetInputs(record.spec,pool));assert.equal(old.sha256,record.sourceSha256);
 const spec=arrange(record),bundle=await createPanelBundle(spec,catalog,core,record.state,await workbenchAssetInputs(spec,pool));assert.equal(bundle.compilerVersion,'0.44.0');
 assert.deepEqual(spec.sections,record.spec.sections);assert.deepEqual(spec.textLayouts,record.spec.textLayouts);assert.equal(spec.layout.width,record.spec.layout.width);
 for(const key of ['state','bindings','actions','assetClosure'])assert.deepEqual(bundle[key],old[key]);
 const nodes=nodesOf(bundle.componentBundle.document),rows=spec.sections.flatMap(section=>section.rows),cards=rows.filter(row=>isDataItem(row,catalog));
 assert.equal(nodes.filter(node=>node.id.endsWith('.data-content')).length,cards.length);
 for(const row of cards){const id=spec.id+'.row.'+row.id,card=nodes.find(node=>node.id===id);assert.equal(card.type,'Panel');assert.equal(card.props.title,'');assert.equal(card.props.style.borderWidth,1);
  const content=card.children.find(node=>node.id===id+'.data-content');assert.equal(content.type,'Container');assert.equal(content.layout.x,12);assert.equal(content.layout.y,12);
  assert(content.children.some(node=>node.id===id+'.label'));assert(content.children.some(node=>node.id===id+'.control'));
  for(const node of content.children.filter(node=>node.type==='Text')){assert(node.layout.x>=0&&node.layout.y>=0);assert(node.layout.x+node.layout.width<=content.layout.width);assert(node.layout.y+node.layout.height<=content.layout.height);assert.equal(node.props.style.fontSize,24);}
 }
 if(!cards.length)assert.deepEqual(bundle.componentBundle.document,old.componentBundle.document);
 const session=hydrate(bundle);assert.deepEqual(session.getState(),bundle.state);session.destroy();
 const native=await createUnityDocument(bundle,core);for(const row of cards){const node=native.nodes.find(node=>node.id===spec.id+'.row.'+row.id);assert(node);assert.equal(node.type,'Panel');}
});
test('wide data pairs share a baseline inside their own Panel; fixed dimensions remain explicit',async()=>{
 const record=fixture.records.find(item=>item.id==='G06'),spec=arrange(record,()=>{},{width:680,canvasWidth:744,canvasHeight:1000,maxHeight:800,overflow:'scroll'}),bundle=await createPanelBundle(spec,catalog,core,record.state),nodes=nodesOf(bundle.componentBundle.document);
 assert.equal(spec.layout.width,680);assert.equal(spec.canvas.height,1000);const starts=[];
 for(const row of spec.sections[0].rows){const label=nodes.find(node=>node.id===spec.id+'.row.'+row.id+'.label'),value=nodes.find(node=>node.id===spec.id+'.row.'+row.id+'.control');assert.equal(value.layout.y,label.layout.y);assert(value.layout.x>=label.layout.x+label.layout.width+16);starts.push(value.layout.x);}assert.equal(new Set(starts).size,1);
});
test('new Panel insets participate in auto sizing and reject incomplete fixed no-wrap data',async()=>{
 const record=fixture.records.find(item=>item.id==='G25'),change=spec=>{spec.sections[0].rows.find(row=>row.kind==='text').text='ABCDEFGHIJ'.repeat(4);};
 const spec=arrange(record,change);assert(spec.layout.width>420);await createPanelBundle(spec,catalog,core,record.state);
 assert.throws(()=>arrange(record,change,{width:420,canvasWidth:452}),{code:'DATA_TEXT_FIT'});
 assert.throws(()=>arrange(fixture.records.find(item=>item.id==='G06'),()=>{},{width:420,canvasWidth:452,canvasHeight:320,maxHeight:240,overflow:'error'}),{code:'LAYOUT_OVERFLOW'});
});
test('wrapped data reflows inside its Panel and hydration rejects a shifted or altered line',async()=>{
 const record=fixture.records.find(item=>item.id==='G06'),spec=arrange(record,spec=>{const row=spec.sections[0].rows[0];spec.textLayouts.push({rowId:row.id,wrap:'word'});row.text='这是一段保留明确换行要求的结算描述，完整显示。';});
 const bundle=await createPanelBundle(spec,catalog,core,record.state);hydrate(bundle).destroy();
 const bad=structuredClone(bundle.componentBundle.document),line=nodesOf(bad).find(node=>node.id.endsWith('.control.line1'));assert(line);line.layout.x+=1;assert.throws(()=>hydrate(bundle,bad),/PANEL_RUNTIME_MISMATCH/);
});
test('data Panels apply to all light/dark palettes; unlabeled and message Text are not data items',async()=>{
 const record=fixture.records.find(item=>item.id==='G06');
 for(const theme of catalog.themes.filter(theme=>theme.headingStyle==='concise-v5')){const spec=arrange(record,()=>{},{},theme.id),bundle=await createPanelBundle(spec,catalog,core,record.state),card=nodesOf(bundle.componentBundle.document).find(node=>node.id===spec.id+'.row.'+spec.sections[0].rows[0].id);assert.equal(card.props.style.backgroundColor,theme.tokens.surface);assert.notEqual(theme.tokens.surface,theme.tokens.control);hydrate(bundle).destroy();}
 assert.equal(isDataItem({...record.spec.sections[0].rows[0],label:''},catalog),false);
 const message=fixture.records.find(item=>item.id==='G54').spec.sections.flatMap(section=>section.rows).find(row=>row.kind==='text');assert.equal(isDataItem(message,catalog),false);
});
test('pinned 0.44 profile supplies data item Panels without extra user instructions',async()=>{
 const model=await createWorkbenchModel({catalog,pool},core);try{const {context}=await model.prepare({requestVersion:'0.1',id:'data-card-draft',target:'pixi',text:'做个通关结算面板'}),prompt=await buildCodexPlanningPrompt(context);assert(prompt.includes('game-readable-v5 single-column defaults'));assert(prompt.includes('Each labeled settings.text data item gets its own inner Panel'));assert(prompt.includes('message.text prose stays unboxed'));}finally{model.dispose();}
});
