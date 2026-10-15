import test from 'node:test';
import assert from 'node:assert/strict';
import {readJson} from '../src/io.mjs';
import {core,nodesOf} from './helpers.mjs';
import {loadBundledCoreAssets} from '../src/bundled-core-assets.mjs';
import {workbenchAssetInputs} from '../src/workbench-assets.mjs';
import {createPanelBundle} from '../src/panel-bundle.mjs';
import {arrangeIntentSpec} from '../src/panel-intent.mjs';
import {createUnityDocument} from '../src/unity-export.mjs';
import {attachPanelSession} from '../src/state.mjs';
import {createWorkbenchModel} from '../src/workbench-model.mjs';
import {buildCodexPlanningPrompt} from '../src/codex-planner.mjs';
import {validateCatalog} from '../src/catalog.mjs';
const catalog=await readJson(new URL('../examples/modern-readable-game-data-layout.catalog.json',import.meta.url)),fixture=await readJson(new URL('./fixtures/readable-data-regressions-v1.json',import.meta.url)),pool=await loadBundledCoreAssets();
const body=node=>node.kind==='section'?{kind:'section',sectionId:node.sectionId}:{kind:node.kind,children:node.children.map(body)};
function arrange(record,change=()=>{},settings={}){const spec=structuredClone(record.spec),theme=catalog.themes.find(theme=>theme.id===spec.theme.id&&theme.headingStyle==='concise-v5');spec.theme={id:theme.id,version:theme.version};change(spec);return arrangeIntentSpec(spec,{width:null,canvasWidth:null,canvasHeight:null,maxHeight:null,overflow:'auto',body:body(spec.layout.body),sourceQuote:null,...settings},theme,catalog);}
for(const record of fixture.records)test(`${record.id}: exact 0.42 replay and compact 0.43 retain source text, wrap, state and host semantics`,async()=>{
 const old=await createPanelBundle(record.spec,fixture.catalog,core,record.state,await workbenchAssetInputs(record.spec,pool));assert.equal(old.sha256,record.sourceSha256);
 const spec=arrange(record),bundle=await createPanelBundle(spec,catalog,core,record.state,await workbenchAssetInputs(spec,pool));assert.equal(bundle.compilerVersion,'0.43.0');
 assert.deepEqual(spec.sections,record.spec.sections);assert.deepEqual(spec.textLayouts,record.spec.textLayouts);for(const key of ['state','bindings','actions','assetClosure'])assert.deepEqual(bundle[key],old[key]);
 if(['G25','G06'].includes(record.id)){assert.equal(spec.layout.width,420);const nodes=nodesOf(bundle.componentBundle.document);for(const row of spec.sections.flatMap(section=>section.rows).filter(row=>row.kind==='text')){const label=nodes.find(node=>node.id===spec.id+'.row.'+row.id+'.label'),value=nodes.find(node=>node.id===spec.id+'.row.'+row.id+'.control');assert.equal(value.props.text,row.text);assert.equal(value.props.wrap,'none');assert(value.layout.y>=label.layout.y+label.layout.height+12);assert.equal(value.props.style.fontSize,24);}}
 else {assert.equal(spec.layout.width,record.spec.layout.width);assert.deepEqual(bundle.componentBundle.document,old.componentBundle.document);}
 const session=attachPanelSession(spec,{getDocument:()=>structuredClone(bundle.componentBundle.document),subscribe:()=>()=>{},setValue(){},setEnabled(){},setVisible(){}},()=>{throw Error('UNEXPECTED_EVENT');},bundle.state,'minimal-v1',catalog);assert.deepEqual(session.getState(),bundle.state);session.destroy();
 const native=await createUnityDocument(bundle,core);for(const node of nodesOf(bundle.componentBundle.document).filter(node=>node.type==='Text')){const target=native.nodes.find(item=>item.id===node.id);if(target)assert.equal(target.text,node.props.text);}
});
test('explicit wide geometry keeps single-line data aligned on a shared baseline',async()=>{
 const record=fixture.records.find(item=>item.id==='G06'),spec=arrange(record,()=>{},{width:680,canvasWidth:744,canvasHeight:1000,maxHeight:800,overflow:'scroll'}),bundle=await createPanelBundle(spec,catalog,core,record.state),nodes=nodesOf(bundle.componentBundle.document);assert.equal(spec.layout.width,680);assert.equal(spec.canvas.height,1000);assert.equal(spec.layout.maxHeight,800);
 const starts=[];for(const row of spec.sections[0].rows){const label=nodes.find(node=>node.id===spec.id+'.row.'+row.id+'.label'),value=nodes.find(node=>node.id===spec.id+'.row.'+row.id+'.control');assert.equal(value.layout.y,label.layout.y);assert(value.layout.x>=label.layout.x+label.layout.width+16);starts.push(value.layout.x);}assert.equal(new Set(starts).size,1);
});
test('explicit no-wrap long values grow auto width or fail fixed width without line rewriting or font shrink',async()=>{
 const record=fixture.records.find(item=>item.id==='G25'),change=spec=>{spec.sections[0].rows.find(row=>row.kind==='text').text='ABCDEFGHIJ'.repeat(4);};
 const spec=arrange(record,change);assert(spec.layout.width>420);const bundle=await createPanelBundle(spec,catalog,core,record.state),value=nodesOf(bundle.componentBundle.document).find(node=>node.id===spec.id+'.row.row0.control');assert.equal(value.props.text,'ABCDEFGHIJ'.repeat(4));assert.equal(value.props.style.fontSize,24);assert.equal(value.props.wrap,'none');
 assert.throws(()=>arrange(record,change,{width:420,canvasWidth:452}),{code:'DATA_TEXT_FIT'});
 assert.throws(()=>arrange(fixture.records.find(item=>item.id==='G06'),()=>{},{width:420,canvasWidth:452,canvasHeight:320,maxHeight:240,overflow:'error'}),{code:'LAYOUT_OVERFLOW'});
});
test('single-line labeled data may coexist with wrapped prose and messages retain exact layout',async()=>{
 const record=fixture.records.find(item=>item.id==='G06'),spec=arrange(record,spec=>{const row=spec.sections[0].rows[0];spec.textLayouts.push({rowId:row.id,wrap:'word'});row.text='这是一段保留明确换行要求的结算描述，完整显示。';});
 const bundle=await createPanelBundle(spec,catalog,core,record.state);assert(spec.textLayouts.some(item=>item.rowId===spec.sections[0].rows[0].id));assert(nodesOf(bundle.componentBundle.document).some(node=>node.id.endsWith('.line1')));
});
test('production default advertises arrangement without converting no-wrap into mandatory horizontal pairs',async()=>{
 const model=await createWorkbenchModel({catalog,pool},core);try{const {context}=await model.prepare({requestVersion:'0.1',id:'data-draft',target:'pixi',text:'做个通关结算面板'}),prompt=await buildCodexPlanningPrompt(context);for(const text of ['game-readable-v4 single-column defaults','labels and values sit side by side when they fit','wrap:none preserves a complete single-line value'])assert(prompt.includes(text));}finally{model.dispose();}
});
test('only supported data sizing revisions may pair with the current group surfaces',()=>{for(const sizing of ['game-readable-v1','future']){const bad=structuredClone(catalog);bad.themes[0].draftSizing=sizing;assert.throws(()=>validateCatalog(bad));}});
