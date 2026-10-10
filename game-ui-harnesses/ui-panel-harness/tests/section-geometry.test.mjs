import test from 'node:test';
import assert from 'node:assert/strict';
import * as panel from '../src/index.mjs';
import {readJson} from '../src/io.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {createWorkbenchModel} from '../src/workbench-model.mjs';
import {createPresentationPolicy} from '../src/panel-presentation.mjs';
import {measureFlowLayout} from '../src/flow-layout.mjs';
import {materializePanelIntent} from '../src/panel-intent.mjs';
import {digestJson} from '../src/canonical.mjs';
import {headingSpec,headingCases} from '../examples/section-headings-v1/fixture.mjs';
import {singleControlSpec,geometryCases,selectRequest,selectIntent,flatten} from '../examples/section-geometry-v2/fixture.mjs';
const catalog=await readJson(new URL('../examples/modern-menu-headings-v2.catalog.json',import.meta.url));
const oldCatalog=await readJson(new URL('../examples/modern-menu-headings.catalog.json',import.meta.url));
const core=await loadWorkspaceCore();
const find=(bundle,id)=>flatten(bundle.componentBundle.document.root).find(node=>node.id===id);
const titleNodes=bundle=>flatten(bundle.componentBundle.document.root).filter(node=>/\.section\.[^.]+\.title$/.test(node.id));
test('v2 catalog changes only the versioned heading policy; recipes and all visual tokens remain identical',()=>{
  assert.deepEqual(catalog.recipes,oldCatalog.recipes);
  const visual=({version,headingStyle,...theme})=>theme;
  assert.equal(catalog.themes.length,oldCatalog.themes.length);
  for(const theme of catalog.themes){
    const old=oldCatalog.themes.find(value=>value.id===theme.id&&value.headingStyle===theme.headingStyle.replace('-v2','-v1'));
    assert(old);assert.deepEqual(visual(theme),visual(old));
  }
});
for(const kind of geometryCases)test(`recipe-aware no-title section: ${kind}`,async()=>{
  const spec=singleControlSpec(panel,catalog,kind),bundle=await panel.createPanelBundle(spec,catalog,core);
  assert.equal(bundle.compilerVersion,'0.28.0');assert.equal(titleNodes(bundle).length,0);
  const theme=catalog.themes.find(theme=>theme.id===spec.theme.id&&theme.version===spec.theme.version);
  const measured=createPresentationPolicy(spec,theme.tokens,theme.presentationStyle,theme.surfaceStyle,theme.headingStyle,catalog)(spec.sections[0],496);
  assert.equal(measured.rows[0].y,0);
  if(kind!=='button')assert.equal(find(bundle,'heading-fixture.row.row0').layout.y,0);
  assert(find(bundle,'heading-fixture.section.section0').layout.height>=80);
  assert.deepEqual(bundle.spec,spec);assert.deepEqual(await panel.validatePanelBundle(JSON.parse(JSON.stringify(bundle)),core),bundle);
  if(kind==='select'){assert.deepEqual(spec.state[0].options,[{id:'male',label:'男'},{id:'female',label:'女'}]);assert.equal(bundle.state.row0,'male');assert.equal(find(bundle,'heading-fixture.section.section0').layout.height,80);}
  if(kind==='slider')assert.equal(bundle.state.row0,57);
  const native=await panel.createUnityDocument(bundle,core);assert.equal(native.nodes.filter(node=>/\.section\.[^.]+\.title$/.test(node.id)).length,0);
});
for(const fixture of headingCases)test(`v2 retains heading policy: ${fixture.id}`,async()=>{
  const bundle=await panel.createPanelBundle(headingSpec(panel,catalog,fixture),catalog,core);
  assert.deepEqual(titleNodes(bundle).map(node=>node.props.text),fixture.headings);
  assert.equal(bundle.state.row0,57);assert.equal(bundle.compilerVersion,'0.28.0');
});
test('recipe minimum is shared by measurement and compilation; width/control gates remain strict',async()=>{
  const custom=structuredClone(catalog);custom.recipes.find(recipe=>recipe.id==='settings.section').minHeight=140;
  const spec=singleControlSpec(panel,custom),theme=custom.themes[0];
  const measured=measureFlowLayout(spec,createPresentationPolicy(spec,theme.tokens,theme.presentationStyle,theme.surfaceStyle,theme.headingStyle,custom));
  const bundle=await panel.createPanelBundle(spec,custom,core);assert.equal(measured.sections[0].height,140);
  assert.equal(find(bundle,'heading-fixture.section.section0').layout.height,140);assert.equal(measured.sections[0].presentation.rows[0].y,0);
  const narrow=structuredClone(spec);narrow.layout.width=320;
  assert.throws(()=>panel.compilePanel(narrow,custom,core),{code:'RECIPE_GEOMETRY'});
  const tooSmall=structuredClone(custom);tooSmall.recipes.find(recipe=>recipe.id==='settings.select').minHeight=100;
  assert.throws(()=>panel.compilePanel(spec,tooSmall,core),{code:'RECIPE_GEOMETRY'});
});
test('reported request reaches acceptProposal with automatic geometry and unchanged choices',async()=>{
  const model=await createWorkbenchModel({catalog,pool:null},core),prepared=await model.prepare(selectRequest);
  const proposal=await materializePanelIntent(prepared.context,selectIntent(prepared.context));
  const result=await model.acceptProposal(proposal);assert.equal(result.phase,'ready');
  const field=result.panel.spec.state.find(field=>field.type==='enum');assert.deepEqual(field.options.map(option=>option.label),['男','女']);
  assert.equal(result.panel.state[field.id],field.options[0].id);assert.equal(titleNodes(result.panel).length,0);
  assert.equal(model.getEditBudget().used,0);model.dispose();
});
test('actual rc.2 bundles recompile identically; unrelated old edits preserve compiler, choices and play state',async()=>{
  for(const[name,sha]of[['rc2-slider','30bbc84be312eb6cbfec2e5aaed2c9737ed392f075814d0f02f54bed8f3e419e'],['rc2-select-visible','ab7c2193d1a10e5c10da04086cb51baa59656354a9a6cbb78f45771363c1be5e']]){
    const old=await readJson(new URL(`./fixtures/section-geometry/${name}.bundle.json`,import.meta.url));
    assert.equal(old.sha256,sha);assert.deepEqual(await panel.validatePanelBundle(old,core),old);
    assert.deepEqual(await panel.createPanelBundle(old.spec,old.catalog,core,old.state,undefined,'0.27.0'),old);
    if(name==='rc2-select-visible'){
      const model=await createWorkbenchModel({catalog,pool:null},core);await model.importPanel(old,{row0:'female'});
      await model.patch({patchVersion:'0.1',baseSpecSha256:await digestJson(old.spec),reason:'只修改面板标题',operations:[{op:'set-panel-title',title:'选择角色'}]});
      const current=model.getSnapshot().panel;assert.equal(current.compilerVersion,'0.27.0');assert.deepEqual(current.catalog,old.catalog);
      assert.deepEqual(current.spec.sections,old.spec.sections);assert.deepEqual(current.spec.state,old.spec.state);assert.deepEqual(current.state,{row0:'female'});assert.deepEqual(current.bindings,old.bindings);assert.equal(model.getEditBudget().used,1);model.dispose();
    }
  }
  assert.throws(()=>panel.compilePanel(singleControlSpec(panel,oldCatalog),oldCatalog,core),{code:'RECIPE_GEOMETRY'});
  assert.throws(()=>panel.compilePanel(singleControlSpec(panel,catalog),catalog,core,undefined,undefined,'0.27.0'),{code:'COMPILER_VERSION'});
});
test('new Select edits and explicit rc.2 adoption preserve legal state and non-refundable usage',async()=>{
  const model=await createWorkbenchModel({catalog,pool:null},core),spec=singleControlSpec(panel,catalog);
  await model.importPanel(await panel.createPanelBundle(spec,catalog,core,{row0:'female'}));
  await model.patch({patchVersion:'0.1',baseSpecSha256:await digestJson(spec),reason:'只修改标题',operations:[{op:'set-panel-title',title:'选择角色'}]});
  assert.deepEqual(model.getSnapshot().panel.state,{row0:'female'});assert.deepEqual(model.getSnapshot().panel.spec.sections,spec.sections);assert.deepEqual(model.getSnapshot().panel.spec.state,spec.state);
  const old=await readJson(new URL('./fixtures/section-geometry/rc2-slider.bundle.json',import.meta.url));await model.importPanel(old);
  await model.adoptSectionHeadings('auto');assert.equal(model.getSnapshot().panel.compilerVersion,'0.28.0');assert.deepEqual(model.getSnapshot().panel.state,{row0:57});
  assert.equal(model.getEditBudget().used,2);await model.undo();assert.deepEqual(model.getSnapshot().panel,old);assert.equal(model.getEditBudget().used,2);model.dispose();
});

test('failed rc.2 Select spec can explicitly adopt the fix through the existing patch contract without a model',async()=>{
  const original=singleControlSpec(panel,oldCatalog),theme=catalog.themes.find(theme=>theme.id===original.theme.id&&theme.headingStyle==='concise-v2');
  const {spec,receipt}=await panel.applyPanelPatch(original,{patchVersion:'0.1',baseSpecSha256:await digestJson(original),reason:'显式采用修复后的分组尺寸版本',operations:[{op:'set-theme',theme:{id:theme.id,version:theme.version}}]});
  assert.deepEqual({...spec,theme:original.theme},original);assert.equal(receipt.status,'APPLIED');
  const bundle=await panel.createPanelBundle(spec,catalog,core,{row0:'female'});
  assert.equal(bundle.compilerVersion,'0.28.0');assert.deepEqual(bundle.state,{row0:'female'});assert.equal(titleNodes(bundle).length,0);
});
