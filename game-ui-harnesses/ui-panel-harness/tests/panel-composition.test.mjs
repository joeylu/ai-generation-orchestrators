import test from 'node:test';
import assert from 'node:assert/strict';
import { composePanelBundles, validatePanelComposition } from '../src/panel-composition.mjs';
import { PANEL_EVALUATION_SUITE as suite } from '../examples/panel-evaluation/suite.mjs';
import { intentFixture } from '../examples/panel-evaluation/intent-fixture.mjs';
import { createPlanningContext } from '../src/planning-context.mjs';
import { materializePanelIntent } from '../src/panel-intent.mjs';
import { createPanelBundle } from '../src/panel-bundle.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { readJson } from '../src/io.mjs';
import { projectPanelEvent } from '../src/state.mjs';
import { controlId } from '../src/compiler.mjs';
import { readFile } from 'node:fs/promises';
import { digestBytes } from '../src/canonical.mjs';
const catalog = await readJson(new URL('../examples/modern-mint-layout.catalog.json', import.meta.url)), core = await loadWorkspaceCore();
const bundles = await Promise.all(suite.cases.map(async item => {
  const context = await createPlanningContext(item.request, catalog), { spec } = await materializePanelIntent(context, intentFixture(context, item));
  spec.provenance = { kind: 'programmatic-fixture', description: 'Composition regression fixture; never a model result.', assumptions: [] };
  return createPanelBundle(spec, catalog, core);
}));
const request = (sources, layout = 'grid') => ({ panelCompositionRequestVersion: '0.1', id: 'combined', title: '组合面板',
  sources: sources.map((bundle, i) => ({ namespace: `part${i}`, bundleSha256: bundle.sha256 })), layout,
  width: layout === 'row' ? 1500 : 1280, canvasWidth: null, canvasHeight: null, maxHeight: 480, surfaceFrom: null });
test('all 16 fixture panels compose with preserved source state, unique names and full deterministic replay', async () => {
  const result = await composePanelBundles(request(bundles), bundles, core);
  assert.equal(result.bundle.spec.sections.flatMap(s => s.rows).length, bundles.reduce((n, b) => n + b.spec.sections.flatMap(s => s.rows).length, 0));
  assert.equal(result.bundle.spec.state.length, bundles.reduce((n, b) => n + b.spec.state.length, 0));
  const ids = result.bundle.spec.sections.flatMap(s => s.rows.map(r => r.id)); assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(await validatePanelComposition(result, bundles, core), result);
  for (const [i, mapping] of result.receipt.mappings.entries()) for (const field of mapping.fields) {
    assert.equal(result.bundle.state[field.target], bundles[i].state[field.source]);
    assert.deepEqual({ ...result.bundle.spec.state.find(f => f.id === field.target), id: field.source }, bundles[i].spec.state.find(f => f.id === field.source));
  }
});
test('colliding source IDs/events and current values remain isolated; reset changes only mapped source fields', async () => {
  const spec = bundles[0].spec, a = await createPanelBundle(spec, catalog, core, { row0: 20, row1: true });
  const b = await createPanelBundle(spec, catalog, core, { row0: 30, row1: true });
  for (const layout of ['column', 'row', 'grid']) {
    const result = await composePanelBundles(request([a, b], layout), [a, b], core), combined = result.bundle.spec;
    const reset = combined.sections[0].rows.find(row => row.kind === 'button');
    const updated = projectPanelEvent(combined, result.bundle.state, { id: controlId(combined.id, reset.id), type: 'activate', source: 'keyboard' });
    assert.equal(updated.state.part0_f_row0, 70); assert.equal(updated.state.part0_f_row1, false);
    assert.equal(updated.state.part1_f_row0, 30); assert.equal(updated.state.part1_f_row1, true);
    assert.equal(new Set(combined.sections.flatMap(s => s.rows.filter(r => r.event).map(r => r.event))).size, 6);
  }
});
test('composition rejects source tampering, stale digests, ambiguous namespace, incompatible catalogs and replay tampering', async () => {
  const sources = bundles.slice(0, 2), req = request(sources);
  for (const mutate of [r => { r.sources[1].namespace = r.sources[0].namespace; }, r => { r.sources[0].bundleSha256 = '0'.repeat(64); },
    r => { r.surfaceFrom = 'missing'; }, r => { r.width = 1; }]) {
    const changed = structuredClone(req); mutate(changed); await assert.rejects(composePanelBundles(changed, sources, core));
  }
  const bad = structuredClone(sources); bad[0].spec.state[0].initial = 50; await assert.rejects(composePanelBundles(req, bad, core));
  const result = await composePanelBundles(req, sources, core); result.receipt.mappings[0].fields.reverse();
  await assert.rejects(validatePanelComposition(result, sources, core), { code: 'COMPOSITION_REPLAY_MISMATCH' });
});

test('composition deduplicates verified embedded PNGs and preserves mapped icons and explicit surface selection', async () => {
  const bytes = new Uint8Array(await readFile(new URL('../examples/custom-assets/panel-surface.png', import.meta.url))), sha256 = await digestBytes(bytes);
  const icon = 'test-kit/icon@1.0.0', surface = 'test-kit/surface@1.0.0', library = { id: 'composition-assets', sha256: 'a'.repeat(64) };
  const spec = structuredClone(bundles[0].spec); spec.assets = { library, panelSurface: surface, rowIcons: [{ rowId: 'row1', asset: icon }] };
  const records = [{ key: icon, role: 'icon', width: 64, height: 64, slice: null, sha256, bytes: bytes.length },
    { key: surface, role: 'shape', width: 64, height: 64, slice: { left: 8, top: 8, right: 8, bottom: 8 }, sha256, bytes: bytes.length }];
  const assets = { closure: { assetClosureVersion: '0.1', library, records }, resources: [{ path: `textures/${sha256}.png`, mime: 'image/png', bytes }] };
  const a = await createPanelBundle(spec, catalog, core, undefined, assets), sources = [a, a], req = { ...request(sources), surfaceFrom: 'part1' };
  const result = await composePanelBundles(req, sources, core);
  assert.equal(result.bundle.componentBundle.resources.length, 1); assert.equal(result.bundle.assetClosure.records.length, 2);
  assert.equal(result.bundle.spec.assets.panelSurface, surface);
  assert.deepEqual(result.bundle.spec.assets.rowIcons.map(icon => icon.rowId), ['part0_r_row1', 'part1_r_row1']);
  await validatePanelComposition(result, sources, core);
  const incompatibleSpec = structuredClone(spec), incompatibleAssets = structuredClone(assets);
  incompatibleSpec.assets.library.sha256 = 'b'.repeat(64); incompatibleAssets.closure.library.sha256 = 'b'.repeat(64);
  const b = await createPanelBundle(incompatibleSpec, catalog, core, undefined, incompatibleAssets);
  await assert.rejects(composePanelBundles(request([a, b]), [a, b], core), { code: 'COMPOSITION_LIBRARY' });
  const conflictAssets = structuredClone(assets); conflictAssets.closure.records[0].slice = { left: 1, top: 1, right: 1, bottom: 1 };
  const conflict = await createPanelBundle(spec, catalog, core, undefined, conflictAssets);
  await assert.rejects(composePanelBundles(request([a, conflict]), [a, conflict], core), { code: 'COMPOSITION_ASSET_CONFLICT' });
});

test('catalog and theme changes remain explicit and cannot be silently reconciled by composition', async () => {
  const different = structuredClone(catalog); different.themes[0].tokens.accent = '#123456';
  const b = await createPanelBundle(bundles[1].spec, different, core);
  await assert.rejects(composePanelBundles(request([bundles[0], b]), [bundles[0], b], core), { code: 'COMPOSITION_CATALOG' });
  const richer = structuredClone(catalog); richer.themes.push({ ...structuredClone(catalog.themes[0]), id: 'alternate' });
  const first = await createPanelBundle(bundles[0].spec, richer, core), secondSpec = structuredClone(bundles[1].spec); secondSpec.theme.id = 'alternate';
  const second = await createPanelBundle(secondSpec, richer, core);
  await assert.rejects(composePanelBundles(request([first, second]), [first, second], core), { code: 'COMPOSITION_THEME' });
});
