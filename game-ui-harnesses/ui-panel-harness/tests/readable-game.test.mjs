import test from 'node:test';
import assert from 'node:assert/strict';
import {readJson} from '../src/io.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {createPanelBundle,validatePanelBundle} from '../src/panel-bundle.mjs';
import {arrangeIntentSpec} from '../src/panel-intent.mjs';
import {fitDraftPanelLayout} from '../src/draft-layout.mjs';
import {validateCatalog} from '../src/catalog.mjs';
import {effectivePanelTitleStyle} from '../src/title-bar.mjs';
import {createUnityDocument} from '../src/unity-export.mjs';
import {createPlanningContext} from '../src/planning-context.mjs';
import {materializePanelIntent} from '../src/panel-intent.mjs';
import {request as fullRequest,intent as fullIntent} from '../examples/all-components-v1/fixture.mjs';
import {createWorkbenchModel} from '../src/workbench-model.mjs';
import {imageAssetPool} from '../examples/image-slots-v1/assets.mjs';
const {records}=await readJson(new URL('./fixtures/readable-game-regressions-v1.json',import.meta.url)),catalog=await readJson(new URL('../examples/modern-readable-game.catalog.json',import.meta.url)),core=await loadWorkspaceCore();
const body=node=>node.kind==='section'?{kind:'section',sectionId:node.sectionId}:{kind:node.kind,children:node.children.map(body)},flat=node=>[node,...(node.children??[]).flatMap(flat)];
const prepare=(record,{wrap=true,...settings}={})=>{const spec=structuredClone(record.spec),theme=catalog.themes.find(theme=>theme.id===spec.theme.id);spec.theme={id:theme.id,version:theme.version};if(wrap){spec.textLayouts??=[];for(const row of spec.sections.flatMap(section=>section.rows).filter(row=>row.kind==='text'))if(!spec.textLayouts.some(entry=>entry.rowId===row.id))spec.textLayouts.push({rowId:row.id,wrap:'word'});}return arrangeIntentSpec(spec,{width:null,canvasWidth:null,canvasHeight:null,maxHeight:null,overflow:'auto',body:body(spec.layout.body),sourceQuote:null,...settings},theme,catalog);};
for(const record of records)test(`${record.id}: old delivery digest remains exact; explicit readable variant reduces width with intact content and actions`,async()=>{
 const before=await createPanelBundle(record.spec,record.catalog,core,record.state);assert.equal(before.sha256,record.originalBundleSha256);await validatePanelBundle(before,core);
 const spec=prepare(record),fitted=fitDraftPanelLayout(spec,catalog,core,{policy:'draft-content-fit-v2',mutableDimensions:['width','canvasWidth','maxHeight','canvasHeight']}),after=await createPanelBundle(fitted.spec,catalog,core,record.state);
 assert.equal(after.compilerVersion,'0.37.0');assert(after.spec.layout.width<before.spec.layout.width);assert.equal(after.spec.canvas.width,after.spec.layout.width+32);
 assert.deepEqual(after.spec.sections,before.spec.sections);for(const key of ['actions','bindings','state','assetClosure'])assert.deepEqual(after[key],before[key]);
 assert.equal(after.catalog.themes[0].tokens.fontSize,24);assert.equal(effectivePanelTitleStyle(after).horizontalAlign,'center');await validatePanelBundle(after,core);
});
test('explicit panel/canvas dimensions remain binding and explicit scrolling is not removed',()=>{
 const record=records.find(record=>record.id==='G22'),spec=prepare(record,{width:600,canvasWidth:700,canvasHeight:500,maxHeight:350,overflow:'scroll'});
 assert.equal(spec.layout.width,600);assert.equal(spec.canvas.width,700);assert.equal(spec.canvas.height,500);assert.equal(spec.layout.maxHeight,350);assert.equal(spec.layout.overflow,'scroll');
});
test('single-line content is preserved when wrap is explicitly off; its required width is allowed to grow',()=>{
 const record=records.find(record=>record.id==='G25'),spec=prepare(record,{wrap:false});assert(spec.layout.width>420);assert.deepEqual(spec.textLayouts,record.spec.textLayouts);assert.deepEqual(spec.sections,record.spec.sections);
});
test('explicit button height and font overrides win over the readable default',async()=>{
 const record=records.find(record=>record.id==='G22'),spec=prepare(record),button=spec.sections[0].rows.find(row=>row.kind==='button');spec.buttonStyles=[{rowId:button.id,style:{width:160,height:52,shape:null,cornerRadius:null,backgroundColor:null,textColor:null,borderColor:null,borderWidth:null}}];spec.buttonFonts=[{rowId:button.id,fontSize:20}];
 const bundle=await createPanelBundle(spec,catalog,core,record.state),nodes=flat(bundle.componentBundle.document.root),node=nodes.find(node=>node.id===spec.id+'.row.'+button.id+'.control');assert.equal(node.layout.height,52);assert.equal(node.layout.width,160);assert.equal(node.props.style.fontSize,20);assert.deepEqual(bundle.actions,(await createPanelBundle(record.spec,record.catalog,core,record.state)).actions);
});
test('radio rows have enough intrinsic height for larger fonts; value and event identity remain intact',async()=>{
 const record=records.find(record=>record.id==='G17'),bundle=await createPanelBundle(prepare(record),catalog,core,record.state),radio=flat(bundle.componentBundle.document.root).find(node=>node.type==='RadioGroup');assert.equal(radio.layout.height,radio.props.options.length*64);assert.equal(radio.props.style.fontSize,24);assert.deepEqual(bundle.state,record.state);
 const native=await createUnityDocument(bundle,core);assert.equal(native.nodes.find(node=>node.id===bundle.spec.id+'.title').textAlignment,'MiddleCenter');
});
test('readable metadata cannot silently activate on incompatible or legacy theme families',()=>{
 for(const change of [theme=>theme.draftSizing='auto',theme=>theme.headingStyle='concise-v2',theme=>theme.surfaceStyle='refined-v1']){const bad=structuredClone(catalog);change(bad.themes[0]);assert.throws(()=>validateCatalog(bad),/draftSizing/);}
});
test('the full sixteen-component public intent still compiles and exports with the readable theme',async()=>{
 const model=await createWorkbenchModel({catalog,pool:await imageAssetPool()},core),{context}=await model.prepare(fullRequest),proposal=await materializePanelIntent(context,fullIntent(context));await model.acceptProposal(proposal);const bundle=await model.exportPanel();model.dispose();
 const expected=['Panel','CheckBox','RadioGroup','List','Dialog','Container','Text','Image','Slider','Switch','Select','Button','ProgressBar','ScrollView','Tabs','Input'].sort();
 assert.deepEqual([...new Set(flat(bundle.componentBundle.document.root).map(node=>node.type))].sort(),expected);assert.equal(bundle.compilerVersion,'0.37.0');const native=await createUnityDocument(bundle,core);assert.deepEqual([...new Set(native.nodes.map(node=>node.type))].sort(),expected);await validatePanelBundle(bundle,core);
});
