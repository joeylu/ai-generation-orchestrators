import test from 'node:test';
import assert from 'node:assert/strict';
import * as panel from '../src/index.mjs';
import { readJson } from '../src/io.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { createWorkbenchModel } from '../src/workbench-model.mjs';
import { createPresentationPolicy } from '../src/panel-presentation.mjs';
import { buildNativePanelIntentResponseSchema } from '../src/panel-intent.mjs';
import { themePlanningGuide } from '../src/theme-planning.mjs';
import { digestJson } from '../src/canonical.mjs';
import { loadBundledCoreAssets } from '../src/bundled-core-assets.mjs';
import { workbenchAssetInputs } from '../src/workbench-assets.mjs';
import { headingSpec, headingCases, flatten } from '../examples/section-headings-v1/fixture.mjs';

const catalog = await readJson(new URL('../examples/modern-menu-headings.catalog.json', import.meta.url));
const legacy = await readJson(new URL('./fixtures/section-headings/rc1-single.bundle.json', import.meta.url));
const core = await loadWorkspaceCore();
const headings = bundle => flatten(bundle.componentBundle.document.root).filter(node => /\.section\.[^.]+\.title$/.test(node.id));

for (const fixture of headingCases) test(`heading v1: ${fixture.id} keeps semantic titles and state`, async () => {
  const spec = headingSpec(panel, catalog, fixture), bundle = await panel.createPanelBundle(spec, catalog, core);
  assert.equal(bundle.compilerVersion, '0.27.0');
  assert.deepEqual(headings(bundle).map(node => node.props.text), fixture.headings);
  assert.deepEqual(bundle.spec.sections, spec.sections);
  assert.equal(bundle.state.row0, 57);
  assert.equal(flatten(bundle.componentBundle.document.root).find(node => node.id.endsWith('.row.row0.label')).props.text, spec.sections[0].rows[0].label);
  assert.deepEqual(await panel.validatePanelBundle(JSON.parse(JSON.stringify(bundle)), core), bundle);
  const native = await panel.createUnityDocument(bundle, core);
  assert.deepEqual(native.nodes.filter(node => /\.section\.[^.]+\.title$/.test(node.id)).map(node => node.text), fixture.headings);
  if (fixture.tabs) assert.deepEqual(bundle.spec.tabs.pages.map(page => page.label), ['音乐页', '音效页']);
});

test('old actual rc.1 bundle replays byte-for-byte and rejects a compiler version rewrite', async () => {
  assert.equal(legacy.sha256, 'b15470714c9b2718b5366b3aeba4b2bdcb7b82fa14f5b60b47fb4deb66acf4ef');
  assert.deepEqual(await panel.validatePanelBundle(legacy, core), legacy);
  assert.deepEqual(await panel.createPanelBundle(legacy.spec, legacy.catalog, core, legacy.state, undefined, '0.26.0'), legacy);
  assert.equal(headings(legacy)[0].props.text, '音量');
  assert.throws(() => panel.compilePanel(legacy.spec, legacy.catalog, core, legacy.state, undefined, '0.27.0'), {code:'COMPILER_VERSION'});
  const spec = headingSpec(panel, catalog);
  assert.throws(() => panel.compilePanel(spec, catalog, core, undefined, undefined, '0.26.0'), {code:'COMPILER_VERSION'});
});

test('the missing title band is removed from section, control and panel geometry', async () => {
  const auto = await panel.createPanelBundle(headingSpec(panel, catalog), catalog, core);
  const shown = await panel.createPanelBundle(headingSpec(panel, catalog, {mode:'show'}), catalog, core);
  const node = (bundle, id) => flatten(bundle.componentBundle.document.root).find(node => node.id === id);
  const section = 'heading-fixture.section.section0', row = 'heading-fixture.row.row0';
  assert.equal(node(auto, row).layout.y, 0);
  assert.equal(node(shown, row).layout.y, 44);
  assert.equal(node(shown, section).layout.height - node(auto, section).layout.height, 44);
  const theme = catalog.themes[0], tokens = theme.tokens;
  for (const surface of ['refined-v1','minimal-v1','minimal-v2','crafted-v1','grouped-v1','grouped-v2','grouped-v3']) {
    const spec = headingSpec(panel, catalog);
    const hidden = createPresentationPolicy(spec,tokens,'focused-v1',surface,'concise-v1')(spec.sections[0],496);
    const visible = createPresentationPolicy(spec,tokens,'focused-v1',surface,'visible-v1')(spec.sections[0],496);
    assert.equal(hidden.showTitle,false,surface); assert(hidden.rows[0].y <= 16,surface);
    assert(visible.rows[0].y > hidden.rows[0].y,surface);
    assert(visible.height > hidden.height,surface);
  }
});

test('explicit adoption retains old history, stable identities, state, and non-refundable edit usage', async () => {
  const model = await createWorkbenchModel({catalog,pool:null},core);
  await model.importPanel(legacy);
  assert.deepEqual(model.getSnapshot().panel,legacy);
  const adopted = await model.adoptSectionHeadings('auto',{row0:57});
  assert.equal(adopted.panel.compilerVersion,'0.27.0'); assert.equal(headings(adopted.panel).length,0);
  assert.deepEqual(adopted.panel.spec.sections,legacy.spec.sections); assert.deepEqual(adopted.panel.spec.state,legacy.spec.state);
  assert.deepEqual(adopted.panel.bindings,legacy.bindings); assert.deepEqual(adopted.panel.actions,legacy.actions);
  assert.deepEqual(adopted.panel.state,{row0:57}); assert.equal(model.getEditBudget().used,1);
  await model.adoptSectionHeadings('auto'); assert.equal(model.getEditBudget().used,1);
  await model.undo(); assert.deepEqual(model.getSnapshot().panel,legacy); assert.equal(model.getEditBudget().used,1);
  await model.importPanel(legacy); assert.equal(model.getEditBudget().used,1);
  model.restoreEditUsage({[legacy.spec.id]:0}); assert.equal(model.getEditBudget().used,1);
  await model.adoptSectionHeadings('auto');
  for(let used=3;used<=10;used++) await model.adoptSectionHeadings(used%2 ? 'show' : 'auto');
  assert.equal(model.getEditBudget().used,10);
  const before=model.getSnapshot(); await assert.rejects(model.adoptSectionHeadings('show'),/WORKBENCH_EDIT_LIMIT/);
  assert.deepEqual(model.getSnapshot(),before); model.dispose();
});

test('failed adoption retains the current bundle and consumes no edit', async () => {
  let rejectPresentation=false;
  const model=await createWorkbenchModel({catalog,pool:null},core,()=>{if(rejectPresentation)throw Error('render-failed');});
  await model.importPanel(legacy);rejectPresentation=true;
  await assert.rejects(model.adoptSectionHeadings('auto'),/render-failed/);
  assert.deepEqual(model.getSnapshot().panel,legacy);assert.equal(model.getEditBudget().used,0);model.dispose();
  const plain=await createWorkbenchModel({catalog,pool:null},core);await plain.importPanel(legacy);
  await assert.rejects(plain.adoptSectionHeadings('hide'),/HEADING_MODE_INVALID/);
  assert.deepEqual(plain.getSnapshot().panel,legacy);assert.equal(plain.getEditBudget().used,0);plain.dispose();
});

test('explicit adoption without a library preserves embedded icon bytes and prior edit history', async () => {
  const pool=await loadBundledCoreAssets(),spec=structuredClone(legacy.spec),asset=pool.index.records[0].key;
  spec.assets={library:{id:pool.index.id,sha256:pool.index.sha256},panelSurface:null,rowIcons:[{rowId:'row0',asset}]};
  const original=await panel.createPanelBundle(spec,legacy.catalog,core,{row0:57},await workbenchAssetInputs(spec,pool));
  const model=await createWorkbenchModel({catalog,pool:null},core);await model.importPanel(original);
  await model.patch({patchVersion:'0.1',baseSpecSha256:await digestJson(spec),reason:'Rename only',operations:[{op:'set-panel-title',title:'音量偏好'}]});
  const before=model.getSnapshot(),adopted=await model.adoptSectionHeadings('auto');
  assert.deepEqual(adopted.panel.spec.assets,before.panel.spec.assets);
  assert.deepEqual(adopted.panel.assetClosure,before.panel.assetClosure);
  for(const resource of before.panel.componentBundle.resources) assert.deepEqual(adopted.panel.componentBundle.resources.find(value=>value.path===resource.path),resource);
  assert.deepEqual(adopted.history.slice(0,-1),before.history);assert.equal(adopted.history.length,2);
  assert.deepEqual(adopted.panel.state,{row0:57});assert.equal(model.getEditBudget().used,2);
  await model.undo();assert.deepEqual(model.getSnapshot().panel,before.panel);assert.equal(model.getEditBudget().used,2);model.dispose();
});

test('matching colors keep default concise and explicitly visible choices in generation and edit guidance', async () => {
  const guide=themePlanningGuide(catalog);assert(guide.includes('concise-v1'));assert(guide.includes('visible-v1'));
  const context=await panel.createPlanningContext({requestVersion:'0.1',id:'heading-request',text:'音量控制面板，一个音量滑块，初始57。',target:'pixi'},catalog,null,{actionLayouts:true,textWrap:true});
  const schema=buildNativePanelIntentResponseSchema(context);
  assert(schema.$defs.body.anyOf[0].properties.title.description.includes('semantic'));
  const model=await createWorkbenchModel({catalog,pool:null},core);await model.importPanel(await panel.createPanelBundle(headingSpec(panel,catalog),catalog,core));
  const spec=model.getSnapshot().panel.spec,target=catalog.themes.find(theme=>theme.id===spec.theme.id&&theme.headingStyle==='visible-v1');
  await model.patch({patchVersion:'0.1',baseSpecSha256:await digestJson(spec),reason:'明确要求保留分组标题',operations:[{op:'set-theme',theme:{id:target.id,version:target.version}}]});
  assert.equal(headings(model.getSnapshot().panel).length,1);assert.equal(model.getEditBudget().used,1);model.dispose();
});
