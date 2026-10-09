import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { core, nodesOf } from './helpers.mjs';
import { loadBundledCoreAssets } from '../src/bundled-core-assets.mjs';
import { assetUsageFixtures } from '../examples/asset-usage-v1/fixture.mjs';
import { workbenchAssetInputs } from '../src/workbench-assets.mjs';
import { createPanelBundle, validatePanelBundle } from '../src/panel-bundle.mjs';
import { compilePanel } from '../src/compiler.mjs';
import { createUnityDocument } from '../src/unity-export.mjs';
import { validateCatalog } from '../src/catalog.mjs';
import { APPEARANCE_KEYS } from '../src/appearance.mjs';
import { createPresentationPolicy } from '../src/panel-presentation.mjs';
import { arrangeIntentSpec } from '../src/panel-intent.mjs';
import { measureFlowLayout } from '../src/flow-layout.mjs';
import { layoutSettings } from '../examples/focused-layout-v1/fixture.mjs';
import { themePlanningGuide } from '../src/theme-planning.mjs';
import { navigationFixture } from '../examples/navigation-v1/fixture.mjs';
const json = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const [catalog, oldCatalog, base, pool] = await Promise.all([json('../examples/modern-refined.catalog.json'),
  json('../examples/modern-navigation.catalog.json'), json('../examples/settings-controls.panel.json'), loadBundledCoreAssets()]);
const fixtures = await assetUsageFixtures(oldCatalog, base, pool);
const nodes = bundle => nodesOf(bundle.componentBundle.document);
const ref = theme => ({ id: theme.id, version: theme.version });
function contrast(a, b) {
  const luminance = color => [1,3,5].map(i => parseInt(color.slice(i,i+2),16)/255)
    .map(v => v <= .04045 ? v / 12.92 : ((v + .055)/1.055)**2.4)
    .reduce((sum,v,i) => sum + v * [.2126,.7152,.0722][i], 0);
  const x = luminance(a), y = luminance(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
for (const theme of catalog.themes) test(`${theme.id}: six refined surfaces replay with unchanged business and readable text`, async () => {
  const t = theme.tokens;
  for (const [fg,bg] of [[t.text,t.surface],[t.text,t.control],[t.muted,t.surface],[t.accent,t.surface]])
    assert(contrast(fg,bg) >= 4.5, `${fg}/${bg}`);
  if (theme.id.endsWith('-dark')) assert(contrast('#75869A',t.control) >= 4.5, 'shared placeholder remains readable on dark fields');
  for (const fixture of Object.values(fixtures)) {
    const before = await createPanelBundle(fixture.chosen, oldCatalog, core, undefined, await workbenchAssetInputs(fixture.chosen,pool));
    const spec = structuredClone(before.spec); spec.theme = ref(theme);
    const after = await createPanelBundle(spec, catalog, core, before.state, await workbenchAssetInputs(spec,pool));
    assert.equal(after.compilerVersion,'0.18.0'); await validatePanelBundle(after,core);
    for (const key of ['state','bindings','actions','assetClosure']) assert.deepEqual(after[key],before[key]);
    assert.deepEqual(after.spec.sections,before.spec.sections);
    assert.deepEqual(after.spec.layout,before.spec.layout);
    for (const n of nodes(after).filter(n => n.type === 'Button')) assert(contrast(n.props.style.textColor,n.props.style.backgroundColor) >= 4.5);
    for (const n of nodes(after).filter(n => n.type === 'Image' && n.id.endsWith('.icon'))) assert(contrast('#FFFFFF',n.props.style.backgroundColor) >= 4.5);
    const unity = await createUnityDocument(after,core);
    assert(!unity.nodes.some(n => n.id.endsWith('.center-label')));
    for (const n of nodes(after).filter(n => n.type === 'Button' || n.id.includes('.panel-shadow.')))
      assert(unity.nodes.some(u => u.id === n.id), n.id);
  }
});

test('refined first heading is suppressed only when redundant; measured generation uses the same policy', async () => {
  const theme = catalog.themes[0], spec = structuredClone(fixtures.settings.spec); spec.theme = ref(theme);
  const bundle = await createPanelBundle(spec,catalog,core), list = nodes(bundle);
  assert(!list.some(n => n.id === `${spec.id}.section.${spec.sections[0].id}.title`));
  assert(list.some(n => n.id === `${spec.id}.section.${spec.sections[1].id}.title`));
  const arranged = arrangeIntentSpec(spec,layoutSettings(760),theme);
  const measured = measureFlowLayout(arranged,createPresentationPolicy(arranged,theme.tokens,theme.presentationStyle,theme.surfaceStyle));
  assert.equal(arranged.canvas.height,measured.panelHeight+64);
  spec.sections[0].title='音频输出'; assert(nodes(await createPanelBundle(spec,catalog,core)).some(n => n.props.text === '音频输出'));
});

test('explicit local appearance and source artwork override refined defaults', async () => {
  const spec = structuredClone(fixtures.settings.chosen); spec.theme=ref(catalog.themes[1]);
  spec.appearance = Object.assign(Object.fromEntries(APPEARANCE_KEYS.map(k => [k,null])),{panelColor:'#253343',controlColor:'#31445A',panelRadius:0,buttonColor:'#FADE90'});
  const bundle = await createPanelBundle(spec,catalog,core,undefined,await workbenchAssetInputs(spec,pool)), list=nodes(bundle);
  assert(!list.some(n => n.id.includes('.panel-shadow.')));
  const panel=list.find(n => n.id===`${spec.id}.panel`); assert.equal(panel.props.style.backgroundColor,'#253343'); assert.equal(panel.props.style.cornerRadius,0);
  for (const n of list.filter(n => ['Slider','Switch'].includes(n.type))) assert.equal(n.props.style.backgroundColor,'#31445A');
  for (const n of list.filter(n => n.type==='Button')) assert.equal(n.props.style.backgroundColor,'#FADE90');
  assert.deepEqual(bundle.spec.assets,spec.assets); await validatePanelBundle(bundle,core);
});

test('refined version is explicit; old catalog replay and compiler pinning remain independent', async () => {
  const old = await createPanelBundle(fixtures.settings.spec,oldCatalog,core);
  assert.equal(old.compilerVersion,'0.17.0'); assert(!nodes(old).some(n => n.id.endsWith('.title-accent') || n.id.includes('.panel-shadow.')));
  assert.deepEqual(await validatePanelBundle(old,core),old);
  assert.throws(() => compilePanel(old.spec,oldCatalog,core,undefined,undefined,'0.18.0'),{code:'COMPILER_VERSION'});
  const next=structuredClone(old.spec); next.theme=ref(catalog.themes[0]);
  assert.throws(() => compilePanel(next,catalog,core,undefined,undefined,'0.17.0'),{code:'COMPILER_VERSION'});
  for (const mutate of [c => c.themes[0].surfaceStyle='unknown', c => delete c.themes[0].navigationStyle]) {
    const c=structuredClone(catalog); mutate(c); assert.throws(() => validateCatalog(c));
  }
  assert(themePlanningGuide(catalog).includes('surfaceStyle')); assert(themePlanningGuide(catalog).includes('extra text rows'));
});

test('refined tabs, select and composed scrolling pages retain theme resources and portable state',async()=>{
  for(const themeId of ['modern-mint-light','modern-blue-dark']) {
    const {bundle,composition}=await navigationFixture(catalog,base,core,themeId);
    assert.equal(bundle.compilerVersion,'0.18.0');await validatePanelBundle(bundle,core);
    assert(nodes(bundle).some(n=>n.type==='Tabs'&&n.props.appearance));
    assert(nodes(bundle).some(n=>n.type==='Select'&&n.props.appearance));
    const unity=await createUnityDocument(bundle,core);
    const tabs=unity.nodes.find(n=>n.type==='Tabs');assert(tabs.tabIndicatorColor);assert(!unity.nodes.some(n=>n.id.endsWith('.center-label')));
    const volume=composition.receipt.mappings[1].fields.find(f=>f.source==='volume').target;
    assert.equal(bundle.state[volume],65);assert.equal(bundle.spec.state.find(s=>s.id===volume).initial,80);
  }
});
