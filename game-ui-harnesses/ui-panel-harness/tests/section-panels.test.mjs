import test from 'node:test';
import assert from 'node:assert/strict';
import {readJson} from '../src/io.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {loadBundledCoreAssets} from '../src/bundled-core-assets.mjs';
import {workbenchAssetInputs} from '../src/workbench-assets.mjs';
import {createPanelBundle,validatePanelBundle} from '../src/panel-bundle.mjs';
import {arrangeIntentSpec} from '../src/panel-intent.mjs';
import {createUnityDocument} from '../src/unity-export.mjs';
import {headingThemeTarget} from '../src/section-headings.mjs';
import {themePlanningGuide} from '../src/theme-planning.mjs';
import {validateCatalog} from '../src/catalog.mjs';
import {createPlanningContext} from '../src/planning-context.mjs';
import {materializePanelIntent} from '../src/panel-intent.mjs';
import {createWorkbenchModel} from '../src/workbench-model.mjs';
import {digestJson} from '../src/canonical.mjs';
import {imageIntent,imageRequest} from '../examples/image-slots-v1/fixture.mjs';
const core=await loadWorkspaceCore(),pool=await loadBundledCoreAssets(),catalog=await readJson(new URL('../examples/modern-readable-game-section-panels.catalog.json',import.meta.url)),oldCatalog=await readJson(new URL('../examples/modern-readable-game-heading-panels.catalog.json',import.meta.url)),{records}=await readJson(new URL('./fixtures/heading-panels-regressions-v1.json',import.meta.url));
const flat=node=>[node,...(node.children??[]).flatMap(flat)],body=node=>node.kind==='section'?{kind:'section',sectionId:node.sectionId}:{kind:node.kind,children:node.children.map(body)};
function arrange(record,selected=catalog,change=()=>{},settings={}){
 const spec=structuredClone(record.spec),theme=selected.themes.find(theme=>theme.id===spec.theme.id&&theme.headingStyle==='concise-v5');spec.theme={id:theme.id,version:theme.version};change(spec);
 return arrangeIntentSpec(spec,{width:record.spec.layout.width,canvasWidth:record.spec.canvas.width,canvasHeight:null,maxHeight:null,overflow:'auto',body:body(spec.layout.body),sourceQuote:null,...settings},theme,selected);
}
const originalHashes={G03:'5a9efd2948c01c0ae28d88fae51efae7fe0242977cfa7a8b394e635e71fccf6a',G22:'1582e57416c03b803b532b914f6bd2c6237b76224fbb67fd90bfe5901edc5c18',G17:'da2f29d2c7ee14602426fff3819d75f6807fd7bb83c6b4a031abfb7d4c4d62b9',G54:'e443e11ef84896ee475eeff345e3de665c5ccc9eec0dfa7b395fe3b7dc37e4f6'};
for(const record of records)test(`${record.id}: old title-panel bytes stay exact; group surfaces preserve all content, state and host bindings`,async()=>{
 const oldSpec=arrange(record,oldCatalog),old=await createPanelBundle(oldSpec,oldCatalog,core,record.state,await workbenchAssetInputs(oldSpec,pool));assert.equal(old.sha256,originalHashes[record.id]);
 const spec=arrange(record),bundle=await createPanelBundle(spec,catalog,core,record.state,await workbenchAssetInputs(spec,pool));assert.equal(bundle.compilerVersion,'0.41.0');await validatePanelBundle(bundle,core);
 assert.deepEqual(bundle.spec.sections,old.spec.sections);for(const key of ['state','actions','bindings','assetClosure'])assert.deepEqual(bundle[key],old[key]);
 assert.equal(spec.layout.width,oldSpec.layout.width);assert.equal(spec.canvas.width,oldSpec.canvas.width);
 const nodes=flat(bundle.componentBundle.document.root),groups=nodes.filter(node=>node.type==='Panel'&&/\.section\.[^.]+$/.test(node.id));
 assert.equal(groups.length,record.id==='G03'?2:record.id==='G54'?0:1);
 for(const group of groups){assert.equal(group.props.title,'');const descendants=flat(group);assert(!descendants.some(node=>node.id.endsWith('.title-panel')));assert(!bundle.actions.some(action=>action.nodeId===group.id));
  const section=spec.sections.find(section=>group.id===spec.id+'.section.'+section.id);for(const row of section.rows)assert(descendants.some(node=>node.id===spec.id+'.row.'+row.id+'.control'));
  const native=await createUnityDocument(bundle,core);assert.equal(native.nodes.find(node=>node.id===group.id).type,'Panel');
 }
 assert.deepEqual(nodes.filter(node=>/\.section\.[^.]+\.title$/.test(node.id)).map(node=>node.props.text),record.id==='G03'?['音频','画面']:[]);
});
test('explicit section headings share the content surface; action headings retain the title-only treatment',async()=>{
 const record=records.find(record=>record.id==='G03'),spec=arrange(record);spec.theme=headingThemeTarget(spec,catalog,catalog,'show');
 const bundle=await createPanelBundle(spec,catalog,core,record.state,await workbenchAssetInputs(spec,pool)),nodes=flat(bundle.componentBundle.document.root);
 assert.deepEqual(nodes.filter(node=>/\.section\.[^.]+\.title$/.test(node.id)).map(node=>node.props.text),spec.sections.map(section=>section.title));assert.equal(nodes.filter(node=>node.id.endsWith('.title-panel')).length,1);
});
test('auto width includes group padding while short audio settings remain compact',async()=>{
 const record=records.find(record=>record.id==='G03'),spec=arrange(record,catalog,()=>{},{width:null,canvasWidth:null});assert(spec.layout.width<=420);
 await createPanelBundle(spec,catalog,core,record.state,await workbenchAssetInputs(spec,pool));
 const long=arrange(record,catalog,spec=>{spec.sections[0].title='这是一个需要完整展示的音频分组标题';},{width:null,canvasWidth:null});assert(long.layout.width>420);await createPanelBundle(long,catalog,core,record.state,await workbenchAssetInputs(long,pool));
});
test('explicit geometry stays binding and insufficient space fails instead of shrinking fonts',async()=>{
 const record=records.find(record=>record.id==='G03'),spec=arrange(record,catalog,()=>{},{width:500,canvasWidth:560,canvasHeight:900,maxHeight:700,overflow:'scroll'});
 assert.equal(spec.layout.width,500);assert.equal(spec.canvas.width,560);assert.equal(spec.canvas.height,900);assert.equal(spec.layout.maxHeight,700);await createPanelBundle(spec,catalog,core,record.state,await workbenchAssetInputs(spec,pool));
 await assert.rejects(async()=>{const small=arrange(record,catalog,()=>{},{width:300,canvasWidth:340});await createPanelBundle(small,catalog,core,record.state,await workbenchAssetInputs(small,pool));});
});
test('group surfaces require compatible heading profiles and advertise semantic grouping without decorative rows',()=>{
 for(const change of [theme=>theme.sectionSurface='automatic',theme=>delete theme.headingSurface]){const bad=structuredClone(catalog);change(bad.themes[0]);assert.throws(()=>validateCatalog(bad),/sectionSurface/);}
 const guide=themePlanningGuide(catalog);assert(guide.includes('Content categories share one compiler-owned Panel'));assert(guide.includes('do not split every control into a section'));
});
test('fixed image-card edits account for group padding and reject overflow atomically',async()=>{
 const context=await createPlanningContext(imageRequest,catalog);
 for(const extra of [0,24]){
  const intent={...imageIntent(context),panelIntentVersion:'0.12'};intent.panel.layout.maxHeight+=extra;intent.panel.layout.canvasHeight+=extra;
  const proposal=await materializePanelIntent(context,intent),bundle=await createPanelBundle(proposal.spec,catalog,core),model=await createWorkbenchModel({catalog,pool:null},core);
  try{await model.importPanel(bundle);const row=bundle.spec.sections[0].rows[0],patch={patchVersion:'0.1',baseSpecSha256:await digestJson(bundle.spec),reason:'把战士肖像高度改成200，其他不变。',operations:[{op:'set-image-properties',rowId:row.id,source:null,width:'fill',height:200,fit:'contain',assetLibrary:null}]};
   if(extra===0){await assert.rejects(model.patch(patch),{code:'LAYOUT_OVERFLOW'});assert.equal(model.getSnapshot().panel.sha256,bundle.sha256);assert.equal(model.getEditBudget().used,0);}
   else{await model.patch(patch);const result=model.getSnapshot().panel;assert.equal(result.spec.sections[0].rows[0].height,200);assert.equal(result.spec.canvas.height,bundle.spec.canvas.height);assert.equal(result.spec.layout.maxHeight,bundle.spec.layout.maxHeight);assert.equal(model.getEditBudget().used,1);}
  }finally{model.dispose();}
 }
});
