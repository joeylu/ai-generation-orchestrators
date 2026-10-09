import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadBundledCoreAssets } from '../src/bundled-core-assets.mjs';
import { workbenchRetrieval, workbenchAssetInputs } from '../src/workbench-assets.mjs';
import { createAssetRetrieval, rankPortableAssets } from '../src/asset-retrieval.mjs';
import { recommendPanelIcons } from '../src/asset-usage.mjs';
import { assetUsageFixtures } from '../examples/asset-usage-v1/fixture.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { createPanelBundle, validatePanelBundle } from '../src/panel-bundle.mjs';

const json = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const catalog = await json('../examples/modern-navigation.catalog.json'), base = await json('../examples/settings-controls.panel.json');
const pool = await loadBundledCoreAssets(), fixtures = await assetUsageFixtures(catalog, base, pool);
const keys = name => fixtures[name].usage.rows.filter(r => r.recommendedAsset).map(r => r.recommendedAsset);
const key = id => `panel-core/${id}@1.0.0`;
const menu = labels => {
  const spec = structuredClone(fixtures.pause.spec), row = spec.sections[0].rows[0];
  spec.sections[0].rows = labels.map((buttonLabel, i) => ({ ...row, id: `action${i}`, event: `menu.action${i}`, buttonLabel })); return spec;
};
const recommend = (spec, text) => recommendPanelIcons(spec, text, workbenchRetrieval(text, pool));

test('six purposes choose relevant menu/settings/input icons and retain text-only dialogs/loading', () => {
  assert.deepEqual(keys('settings'), ['volume', 'music', 'mute'].map(key));
  assert.deepEqual(keys('role'), ['user'].map(key));
  assert.deepEqual(keys('pause'), ['play', 'settings', 'home'].map(key));
  assert.deepEqual(keys('menu'), []);
  assert.deepEqual(keys('dialog'), []); assert.deepEqual(keys('loading'), []);
  assert.equal(fixtures.menu.usage.rows.at(-1).reason, 'NO_MATCH');
});

test('whole-request hits cannot decorate an unrelated row, glyph or body copy', () => {
  const spec = menu(['退出游戏', '⏯', '设置']);
  const result = recommend(spec, '暂停设置，主音量、静音和继续游戏。');
  assert.deepEqual(result.rows.map(r => r.reason), ['NO_MATCH', 'INLINE_GLYPH', 'MENU_TEXT_FALLBACK']);
  assert(result.rows.every(r => r.recommendedAsset === null));
});

test('IDs and events never count as visible row semantics', () => {
  const spec = menu(['退出游戏']); spec.sections[0].rows[0].event = 'volume.mute.settings';
  spec.sections[0].rows[0].id = 'settings-volume';
  assert.equal(recommend(spec, '音量静音设置').rows[0].recommendedAsset, null);
});

test('inline symbols, duplicates and section budgets do not trigger weaker substitutes', () => {
  const result = recommend(menu(['继续游戏', '设置', '设置', '主菜单', '暂停']), '继续游戏、设置、主菜单、暂停');
  assert.deepEqual(result.rows.map(r => r.reason), ['MENU_TEXT_FALLBACK', 'MENU_TEXT_FALLBACK', 'REPEATED_ICON', 'MENU_TEXT_FALLBACK', 'SECTION_BUDGET']);
  assert(result.rows.every(r => r.recommendedAsset === null));
});

test('equally specific conflicting meanings remain text-only instead of picking by asset key', () => {
  const result = recommend(menu(['音量静音']), '音量静音');
  assert.equal(result.rows[0].reason, 'AMBIGUOUS_MATCH'); assert.equal(result.rows[0].recommendedAsset, null);
});

test('a longer equally scored visible term chooses home for 返回主菜单', () => {
  assert.equal(recommend(menu(['返回主菜单']), '返回主菜单').rows[0].recommendedAsset, key('home'));
});

test('separate action sections in a mixed settings panel are still text actions', () => {
  const spec = structuredClone(fixtures.settings.spec); spec.actionLayouts = [];
  const report = recommend(spec, fixtures.settings.requestText);
  assert(report.rows.filter(r => r.sectionId === 'actions').every(r => r.reason === 'TEXT_ACTION' && !r.recommendedAsset));
});

test('explicit standalone action arrangements never acquire external row icons', () => {
  assert(fixtures.settings.usage.rows.filter(r => r.sectionId === 'actions').every(r => r.reason === 'EXPLICIT_ACTION_LAYOUT'));
});

test('the advisory leaves explicit saved icon choices and all input data unchanged', () => {
  const spec = structuredClone(fixtures.role.chosen);
  spec.assets.rowIcons.push({ rowId: spec.sections[0].rows[1].id, asset: key('confirm') });
  const original = structuredClone(spec), retrieval = workbenchRetrieval(fixtures.role.requestText, pool), before = structuredClone(retrieval);
  const report = recommendPanelIcons(spec, fixtures.role.requestText, retrieval);
  assert.equal(report.status, 'ADVISORY_ONLY'); assert.equal(report.rows[1].selectedAsset, key('confirm'));
  assert.equal(report.rows[1].recommendedAsset, null);
  assert.deepEqual(spec, original); assert.deepEqual(retrieval, before);
});

test('recommendations cannot expand the context candidate set or switch the bound library', () => {
  const spec = menu(['继续游戏']);
  assert.equal(recommend(spec, '设置').rows[0].recommendedAsset, null);
  const chosen = structuredClone(fixtures.role.chosen); chosen.assets.library.sha256 = '0'.repeat(64);
  assert.throws(() => recommend(chosen, fixtures.role.requestText), { code: 'ASSET_USAGE_LIBRARY_MISMATCH' });
  const retrieval = workbenchRetrieval('设置', pool); retrieval.candidates[0].score++;
  assert.throws(() => recommendPanelIcons(spec, '设置', retrieval), { code: 'ASSET_RETRIEVAL_MISMATCH' });
});

test('style selection maximizes row coverage while preserving the pinned candidate identities', () => {
  const index = structuredClone(pool.index);
  index.records.find(r => r.key === key('music')).metadata.style = 'other';
  const retrieval = createAssetRetrieval(fixtures.settings.requestText, index);
  const report = recommendPanelIcons(fixtures.settings.spec, fixtures.settings.requestText, retrieval);
  assert.equal(report.style, 'modern-core'); assert.equal(report.rows[1].reason, 'STYLE_FALLBACK');
  assert.deepEqual(report.rows.slice(0, 3).map(r => r.recommendedAsset), [key('volume'), null, key('mute')]);
});

test('portable reranking preserves lexical-v1 and validates its bounded metadata input', () => {
  const full = workbenchRetrieval('volume 音量', pool), assets = full.candidates.map(c => c.asset);
  assert.deepEqual(rankPortableAssets('volume 音量', assets), full.candidates);
  assert.throws(() => rankPortableAssets('volume', [...assets, ...assets]), { code: 'ASSET_RETRIEVAL_DUPLICATE' });
  assert.throws(() => rankPortableAssets('volume', Array(33).fill(assets[0])), { code: 'ASSET_RETRIEVAL_CANDIDATES' });
});

test('equally relevant alternatives prefer a shared variant without borrowing a weaker meaning', () => {
  const index = structuredClone(pool.index), original = index.records.find(r => r.key === key('volume'));
  const alternate = structuredClone(original); alternate.key = 'panel-core/aaa-volume@1.0.0';
  alternate.metadata.id = 'aaa-volume'; alternate.metadata.variant = 'outline'; index.records.push(alternate);
  const retrieval = createAssetRetrieval(fixtures.settings.requestText, index);
  const report = recommendPanelIcons(fixtures.settings.spec, fixtures.settings.requestText, retrieval);
  assert.equal(report.variantPreference, 'default'); assert.equal(report.rows[0].recommendedAsset, key('volume'));
});

test('all six recommended fixtures compile in both modes without changing business or saved baselines', async () => {
  const core = await loadWorkspaceCore();
  for (const entry of Object.values(fixtures)) for (const mode of ['light', 'dark']) {
    const theme = catalog.themes.find(t => t.id === (mode === 'light' ? 'modern-mint-light' : 'modern-blue-dark'));
    const beforeSpec = structuredClone(entry.spec), afterSpec = structuredClone(entry.chosen);
    beforeSpec.theme = afterSpec.theme = { id: theme.id, version: theme.version };
    const before = await createPanelBundle(beforeSpec, catalog, core);
    const after = await createPanelBundle(afterSpec, catalog, core, before.state, afterSpec.assets ? await workbenchAssetInputs(afterSpec, pool) : undefined);
    await validatePanelBundle(after, core);
    for (const field of ['state', 'bindings', 'actions']) assert.deepEqual(after[field], before[field]);
    assert.deepEqual(after.spec.sections, before.spec.sections); assert.deepEqual(after.spec.layout, before.spec.layout);
  }
});
