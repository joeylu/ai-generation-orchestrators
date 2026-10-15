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
const catalog=await readJson(new URL('../examples/modern-readable-game-grouped-layout.catalog.json',import.meta.url)),fixture=await readJson(new URL('./fixtures/grouped-readable-regressions-v1.json',import.meta.url)),pool=await loadBundledCoreAssets();
const body=node=>node.kind==='section'?{kind:'section',sectionId:node.sectionId}:{kind:node.kind,children:node.children.map(body)};
function arrange(record,change=()=>{},settings={}){
 const spec=structuredClone(record.spec),theme=catalog.themes.find(theme=>theme.id===spec.theme.id&&theme.headingStyle==='concise-v5');spec.theme={id:theme.id,version:theme.version};change(spec);
 return arrangeIntentSpec(spec,{width:null,canvasWidth:null,canvasHeight:null,maxHeight:null,overflow:'auto',body:body(spec.layout.body),sourceQuote:null,...settings},theme,catalog);
}
for(const record of fixture.records)test(`${record.id}: old 0.41 bytes replay exactly and new compact groups preserve business fields and complete labels`,async()=>{
 const old=await createPanelBundle(record.spec,fixture.catalog,core,record.state,await workbenchAssetInputs(record.spec,pool));assert.equal(old.sha256,record.sourceSha256);
 const spec=arrange(record),bundle=await createPanelBundle(spec,catalog,core,record.state,await workbenchAssetInputs(spec,pool));assert.equal(bundle.compilerVersion,'0.42.0');
 assert.equal(spec.layout.width,record.id==='G05'?360:420);assert.deepEqual(spec.sections,record.spec.sections);
 for(const key of ['state','actions','bindings','assetClosure'])assert.deepEqual(bundle[key],old[key]);
 const document=bundle.componentBundle.document,nodes=nodesOf(document),native=await createUnityDocument(bundle,core);
 for(const row of spec.sections.flatMap(section=>section.rows).filter(row=>['select','list','radio'].includes(row.kind))){
  const node=nodes.find(node=>node.id===spec.id+'.row.'+row.id+'.control'),labels=node.props.items??node.props.options,field=spec.state.find(field=>field.id===row.bind);
  assert.deepEqual(labels.map(option=>option.label.replace(/\s/gu,'')),field.options.map(option=>option.label.replace(/\s/gu,'')));
  assert.deepEqual(native.fields.find(item=>item.id===field.id).options.map(option=>option.label),labels.map(option=>option.label));
  if(record.id==='G25'||record.id==='G16')assert(labels.some(option=>option.label.includes('\n')));
 }
 const runtime={getDocument:()=>structuredClone(document),subscribe:()=>()=>{},setValue(){},setVisible(){},setEnabled(){}};
 const session=attachPanelSession(spec,runtime,()=>{throw Error('UNEXPECTED_HOST_EVENT');},bundle.state,'minimal-v1',catalog);assert.deepEqual(session.getState(),bundle.state);session.destroy();
 if(['G31','G06'].includes(record.id))assert.equal(nodes.find(node=>node.id===spec.id+'.section.section0').type,'Panel');
 if(['G54','G05'].includes(record.id))assert.equal(nodes.filter(node=>node.type==='Panel'&&/\.section\.[^.]+$/.test(node.id)).length,0);
});
test('the actual shared short-request prompt distinguishes content groups, labeled summaries and standalone actions',async()=>{
 const model=await createWorkbenchModel({catalog,pool},core);try{const {context}=await model.prepare({requestVersion:'0.1',id:'short-group-proof',target:'pixi',text:'帮我做个设置面板'}),prompt=await buildCodexPlanningPrompt(context);
  for(const text of ['game-readable-v3 single-column defaults','Each meaningful content category gets one semantic section','audio volume sliders belong together','graphics quality and fullscreen','Button-only section','settings.text for labeled read-only summaries'])assert(prompt.includes(text),text);
 }finally{model.dispose();}
});
test('new profile does not guess semantic sections from labels; an explicit reviewed grouping retains all rows',async()=>{
 const record=fixture.records.find(record=>record.id==='G03'),plain=arrange(record);assert.equal(plain.sections.length,1);
 const spec=arrange(record,spec=>{const rows=spec.sections[0].rows;spec.sections=[{id:'section0',title:'音频',rows:rows.slice(0,2)},{id:'display',title:'画面',rows:rows.slice(2,4)},{id:'actions',title:'操作',rows:rows.slice(4)}];spec.layout.body={kind:'column',children:spec.sections.map(section=>({kind:'section',sectionId:section.id}))};});
 const bundle=await createPanelBundle(spec,catalog,core,record.state,await workbenchAssetInputs(spec,pool)),nodes=nodesOf(bundle.componentBundle.document);
 assert.deepEqual(nodes.filter(node=>/\.section\.[^.]+\.title$/.test(node.id)).map(node=>node.props.text),['音频','画面']);
 assert.equal(nodes.filter(node=>node.type==='Panel'&&/\.section\.[^.]+$/.test(node.id)).length,2);assert.deepEqual(spec.sections.flatMap(section=>section.rows),record.spec.sections[0].rows);
});
test('explicit dimensions remain binding; cell overflow fails without clipping or source changes',async()=>{
 const record=fixture.records.find(record=>record.id==='G16'),spec=arrange(record,()=>{},{width:540,canvasWidth:600,canvasHeight:1000,maxHeight:800,overflow:'scroll'});
 assert.equal(spec.layout.width,540);assert.equal(spec.canvas.height,1000);assert.equal(spec.layout.maxHeight,800);await createPanelBundle(spec,catalog,core,record.state);
 assert.throws(()=>arrange(record,spec=>{spec.state.find(field=>field.type==='enum').options[0].label='完整显示长成就说明'.repeat(5);}),{code:'CHOICE_WRAP_HEIGHT'});
});
test('wrapped choice labels still reject display tampering before session attachment',async()=>{
 const record=fixture.records.find(record=>record.id==='G25'),spec=arrange(record),bundle=await createPanelBundle(spec,catalog,core,record.state),document=structuredClone(bundle.componentBundle.document);
 nodesOf(document).find(node=>node.type==='Select').props.options[0].label='短标签';
 assert.throws(()=>attachPanelSession(spec,{getDocument:()=>document,subscribe:()=>()=>{},setValue(){}},()=>{},bundle.state,'minimal-v1',catalog),/PANEL_RUNTIME_MISMATCH/);
});
test('data-group profile cannot be mixed with an older draft sizing revision',()=>{
 const bad=structuredClone(catalog);bad.themes[0].draftSizing='game-readable-v2';assert.throws(()=>validateCatalog(bad),/sectionSurface/);
});
