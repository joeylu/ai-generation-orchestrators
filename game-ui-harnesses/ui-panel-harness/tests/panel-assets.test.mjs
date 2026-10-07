import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { core, fixture, catalog, copy, nodesOf } from './helpers.mjs';
import { validatePanelSpec } from '../src/spec.mjs';
import { compilePanel } from '../src/compiler.mjs';
import { digestBytes, digestJson } from '../src/canonical.mjs';
import { panelAssetKeys, panelAssetPath, validatePanelAssetClosure, validatePanelAssetInputs } from '../src/panel-assets.mjs';
import { createPanelBundle, validatePanelBundle, panelBundleAssetInputs } from '../src/panel-bundle.mjs';
import { applyPanelPatch } from '../src/patch.mjs';

const surfaceBytes = new Uint8Array(await readFile(new URL('../examples/custom-assets/panel-surface.png', import.meta.url)));
// Explicit header-only fixture exercises byte/hash/geometry contracts, not PNG decoding or visual acceptance.
const iconBytes = new Uint8Array(45);
iconBytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
const iconView = new DataView(iconBytes.buffer);
iconView.setUint32(8, 13); iconBytes.set([73, 72, 68, 82], 12);
iconView.setUint32(16, 24); iconView.setUint32(20, 24); iconBytes[24] = 8; iconBytes[25] = 6;
const surfaceKey = 'test-kit/panel-surface@1.2.3', iconKey = 'test-kit/mute@2.0.0';
const surfaceHash = await digestBytes(surfaceBytes), iconHash = await digestBytes(iconBytes);
const margins = { left: 7, top: 11, right: 9, bottom: 13 };

function assetFixture() {
  const spec = copy(fixture); spec.panelSpecVersion = '0.2';
  spec.assets = { library: { id: 'test-assets', sha256: 'a'.repeat(64) }, panelSurface: surfaceKey,
    rowIcons: [{ rowId: 'volume-row', asset: iconKey }, { rowId: 'audio-enabled-row', asset: iconKey }] };
  const records = [
    { key: surfaceKey, role: 'shape', width: 64, height: 64, slice: copy(margins), sha256: surfaceHash, bytes: surfaceBytes.length },
    { key: iconKey, role: 'icon', width: 24, height: 24, slice: null, sha256: iconHash, bytes: iconBytes.length },
  ].sort((a, b) => a.key < b.key ? -1 : 1);
  const closure = { assetClosureVersion: '0.1', library: copy(spec.assets.library), records };
  const resources = [
    { path: `textures/${surfaceHash}.png`, mime: 'image/png', bytes: new Uint8Array(surfaceBytes) },
    { path: `textures/${iconHash}.png`, mime: 'image/png', bytes: new Uint8Array(iconBytes) },
  ];
  return { spec, closure, resources };
}
const find = (document, id) => nodesOf(document).find(node => node.id === id);
const surf = input => input.closure.records.find(record => record.key === surfaceKey);
const ico = input => input.closure.records.find(record => record.key === iconKey);
const makeBundle = input => createPanelBundle(input.spec, catalog, core, undefined, { closure: input.closure, resources: input.resources });

test('PanelSpec 0.2 binds only exact asset versions and existing row IDs', () => {
  const input = assetFixture();
  assert.deepEqual(validatePanelSpec(input.spec), input.spec);
  assert.deepEqual(panelAssetKeys(input.spec), [iconKey, surfaceKey]);
  for (const change of [
    spec => { spec.assets.panelSurface = 'test-kit/panel-surface@latest'; },
    spec => { spec.assets.panelSurface = 'test-kit/panel-surface'; },
    spec => { spec.assets.panelSurface = 'test-kit/panel-surface@1.2'; },
    spec => { spec.assets.library.sha256 = 'not-a-digest'; },
    spec => { spec.assets.rowIcons[0].rowId = 'missing-row'; },
    spec => { spec.assets.rowIcons.push(copy(spec.assets.rowIcons[0])); },
  ]) { const spec = copy(input.spec); change(spec); assert.throws(() => validatePanelSpec(spec)); }
});

test('nine-slice lowering preserves fixed border sizes, source regions, full coverage and panel placement', () => {
  const { spec, closure } = assetFixture();
  const compiled = compilePanel(spec, catalog, core, undefined, closure);
  const panel = find(compiled.document, 'audio-settings.panel');
  const previous = find(compilePanel(fixture, catalog, core).document, 'audio-settings.panel');
  assert.deepEqual(panel.layout, previous.layout);
  const slices = panel.children.filter(node => node.id.startsWith('audio-settings.panel.surface.'));
  assert.equal(slices.length, 9);
  assert.deepEqual(panel.children.slice(0, 9), slices);
  const sx = [0, 7, 55, 64], sy = [0, 11, 51, 64];
  const dx = [0, 7, panel.layout.width - 9, panel.layout.width], dy = [0, 11, panel.layout.height - 13, panel.layout.height];
  let area = 0;
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
    const node = slices.find(item => item.id.endsWith(`.${y}.${x}`));
    assert.equal(node.type, 'Image'); assert.equal(node.props.source, `textures/${surfaceHash}.png`);
    assert.equal(node.props.fit, 'stretch');
    assert.deepEqual(node.props.region, { x: sx[x], y: sy[y], width: sx[x + 1] - sx[x], height: sy[y + 1] - sy[y] });
    assert.deepEqual(node.layout, { x: dx[x], y: dy[y], width: dx[x + 1] - dx[x], height: dy[y + 1] - dy[y] });
    area += node.layout.width * node.layout.height;
  }
  assert.equal(area, panel.layout.width * panel.layout.height);
});

test('row icons reserve label space without moving controls or changing event bindings', () => {
  const { spec, closure } = assetFixture();
  const compiled = compilePanel(spec, catalog, core, undefined, closure), original = compilePanel(fixture, catalog, core);
  for (const rowId of ['volume-row', 'audio-enabled-row']) {
    const prefix = `audio-settings.row.${rowId}`, icon = find(compiled.document, `${prefix}.icon`);
    assert.equal(icon.type, 'Image'); assert.equal(icon.props.source, `textures/${iconHash}.png`);
    assert.equal(icon.props.fit, 'contain'); assert.equal(icon.layout.width, 28); assert.equal(icon.layout.height, 28);
    assert.deepEqual(find(compiled.document, `${prefix}.control`), find(original.document, `${prefix}.control`));
    const oldLabel = find(original.document, `${prefix}.label`), label = find(compiled.document, `${prefix}.label`);
    assert.equal(label.layout.x - oldLabel.layout.x, 40);
    assert.equal(oldLabel.layout.width - label.layout.width, 40);
  }
  assert.deepEqual(compiled.bindings, original.bindings);
});

test('zero slice margins do not emit zero-size image nodes and icons may be omitted', () => {
  const input = assetFixture();
  input.spec.assets.rowIcons = []; input.closure.records = [surf(input)];
  surf(input).slice = { left: 0, top: 0, right: 0, bottom: 0 };
  const compiled = compilePanel(input.spec, catalog, core, undefined, input.closure);
  const images = nodesOf(compiled.document).filter(node => node.type === 'Image');
  assert.equal(images.length, 1);
  assert.deepEqual(images[0].props.region, { x: 0, y: 0, width: 64, height: 64 });
  assert.ok(images.every(node => node.layout.width > 0 && node.layout.height > 0));
});

test('embedded asset bundle and saved state restore without accessing the source library', async () => {
  const input = assetFixture(), state = { volume: 37, audioEnabled: false };
  const bundle = await createPanelBundle(input.spec, catalog, core, state, input);
  assert.equal(bundle.panelBundleVersion, '0.2'); assert.equal(bundle.compilerVersion, '0.2.0');
  assert.equal(bundle.componentBundle.resources.length, 2);
  assert.deepEqual(bundle.assetClosure, input.closure);
  const serialized = JSON.parse(JSON.stringify(bundle));
  assert.throws(() => core.bundleResources(serialized.componentBundle), /BUNDLE_NOT_VALIDATED/);
  const offlineCore = { ...core, loadPanelAssets() { throw new Error('source library must not be accessed'); } };
  const restored = await validatePanelBundle(serialized, offlineCore);
  assert.deepEqual(restored, bundle); assert.deepEqual(restored.state, state);
  assert.equal(core.bundleResources(restored.componentBundle).length, 2);
  const embedded = panelBundleAssetInputs(restored, offlineCore);
  const rebuilt = await createPanelBundle(restored.spec, restored.catalog, offlineCore, restored.state, embedded);
  assert.deepEqual(rebuilt, restored);
  assert.equal(restored.verification.browser, 'NOT_RUN');
  assert.equal(restored.verification.nativeEngines, 'NOT_RUN');
  assert.ok(!JSON.stringify(restored).includes('examples/custom-assets'));
});

test('asset closure rejects missing, extra, wrong-version, reordered and mismatched-library selections', () => {
  for (const mutate of [
    input => input.closure.records.pop(),
    input => input.closure.records.push({ ...copy(ico(input)), key: 'test-kit/extra@1.0.0' }),
    input => { ico(input).key = 'test-kit/mute@2.0.1'; },
    input => input.closure.records.reverse(),
    input => { input.closure.library.sha256 = 'b'.repeat(64); },
    input => { input.closure.library.id = 'wrong-library'; },
    input => { input.closure.assetClosureVersion = '9.0'; },
  ]) { const input = assetFixture(); mutate(input); assert.throws(() => validatePanelAssetClosure(input.spec, input.closure)); }
});

test('surface and icon roles, slice geometry, and repeated-image facts cannot be forged', () => {
  for (const mutate of [
    input => { surf(input).role = 'icon'; },
    input => { surf(input).slice = null; },
    input => { ico(input).role = 'shape'; },
    input => { surf(input).slice.left = -1; },
    input => { surf(input).slice.left = 55; },
    input => { surf(input).slice.left = 1.5; },
    input => { ico(input).width = 0; },
    input => { ico(input).sha256 = 'bad'; },
    input => { ico(input).sha256 = surfaceHash; },
  ]) { const input = assetFixture(); mutate(input); assert.throws(() => validatePanelAssetClosure(input.spec, input.closure)); }
});

test('byte validation rejects missing, extra, duplicate, modified and incorrectly labeled resources', async () => {
  for (const mutate of [
    input => input.resources.pop(),
    input => input.resources.push(copy(input.resources[0])),
    input => { input.resources[1] = copy(input.resources[0]); },
    input => { input.resources[0].bytes[40] ^= 1; },
    input => { input.resources[0].mime = 'image/jpeg'; },
    input => { input.resources[0].path = '../outside.png'; },
    input => { surf(input).bytes += 1; },
  ]) {
    const input = assetFixture(); mutate(input);
    await assert.rejects(validatePanelAssetInputs(input.spec, input));
  }
});

test('matching checksums do not hide malformed PNG headers or incorrect declared dimensions', async () => {
  for (const mutate of [
    bytes => { bytes[0] = 0; },
    bytes => { new DataView(bytes.buffer).setUint32(8, 12); },
    bytes => { bytes[12] = 0; },
    bytes => { new DataView(bytes.buffer).setUint32(16, 25); },
  ]) {
    const input = assetFixture(), resource = input.resources.find(item => item.path === `textures/${iconHash}.png`);
    mutate(resource.bytes); const hash = await digestBytes(resource.bytes);
    ico(input).sha256 = hash; resource.path = `textures/${hash}.png`;
    await assert.rejects(validatePanelAssetInputs(input.spec, input), /PANEL_ASSET_PNG_HEADER/);
  }
});

test('byte snapshots prevent caller mutation during asynchronous hashing', async () => {
  const input = assetFixture(), before = input.resources.map(resource => new Uint8Array(resource.bytes));
  const pending = validatePanelAssetInputs(input.spec, input);
  for (const resource of input.resources) resource.bytes.fill(0);
  const checked = await pending;
  for (const original of before) assert.ok(checked.resources.some(resource => Buffer.from(resource.bytes).equals(Buffer.from(original))));
  assert.deepEqual(checked.closure, input.closure);
});

test('tampered bundle resources or closure fail even after the outer digest is recomputed', async () => {
  const valid = await makeBundle(assetFixture());
  for (const mutate of [
    bundle => { bundle.assetClosure.records[0].role = 'shape'; },
    bundle => { bundle.assetClosure.library.sha256 = 'b'.repeat(64); },
    bundle => { bundle.componentBundle.resources[0].base64 = Buffer.from('tampered bytes').toString('base64'); },
    bundle => { bundle.spec.assets.rowIcons[0].asset = 'test-kit/mute@2.0.1'; },
    bundle => { bundle.componentBundle.document.root.children[0].children[0].layout.width += 1; },
  ]) {
    const bad = copy(valid); mutate(bad);
    const { sha256: ignored, ...payload } = bad; bad.sha256 = await digestJson(payload);
    await assert.rejects(validatePanelBundle(bad, core));
  }
});

test('PanelSpec 0.1 keeps the original resource-free bundle contract and rejects unsolicited assets', async () => {
  const bundle = await createPanelBundle(fixture, catalog, core);
  assert.equal(bundle.panelBundleVersion, '0.1'); assert.equal(bundle.compilerVersion, '0.1.0');
  assert.equal(bundle.assetClosure, undefined); assert.deepEqual(bundle.componentBundle.resources, []);
  assert.deepEqual(await validatePanelBundle(bundle, core), bundle);
  const input = assetFixture();
  assert.throws(() => compilePanel(fixture, catalog, core, undefined, input.closure), /PANEL_ASSETS_UNEXPECTED/);
  await assert.rejects(createPanelBundle(fixture, catalog, core, undefined, input), /PANEL_ASSETS_UNEXPECTED/);
  await assert.rejects(createPanelBundle(input.spec, catalog, core), /PANEL_ASSETS_REQUIRED/);
  const downgraded = copy(input.spec); downgraded.panelSpecVersion = '0.1';
  assert.throws(() => validatePanelSpec(downgraded));
});

test('a shared PNG is embedded once while distinct exact asset identities remain in the closure', async () => {
  const input = assetFixture();
  Object.assign(ico(input), { width: 64, height: 64, sha256: surfaceHash, bytes: surfaceBytes.length });
  input.resources = input.resources.filter(resource => resource.path === panelAssetPath(surf(input)));
  const bundle = await makeBundle(input);
  assert.equal(bundle.assetClosure.records.length, 2);
  assert.equal(bundle.componentBundle.resources.length, 1);
  assert.deepEqual(await validatePanelBundle(bundle, core), bundle);
});

test('removing an icon-bearing row clears its asset assignment and keeps the independent surface usable', async () => {
  const input = assetFixture();
  input.spec.assets.rowIcons = [{ rowId: 'volume-row', asset: iconKey }];
  const before = copy(input.spec);
  const patch = { patchVersion: '0.1', baseSpecSha256: await digestJson(input.spec), reason: 'Remove volume row',
    operations: [{ op: 'remove-row', rowId: 'volume-row' }] };
  const result = await applyPanelPatch(input.spec, patch);
  assert.deepEqual(input.spec, before);
  assert.deepEqual(result.spec.assets.rowIcons, []);
  assert.equal(result.spec.assets.panelSurface, surfaceKey);
  assert.deepEqual(result.spec.state.map(field => field.id), ['audioEnabled']);
  assert.deepEqual(panelAssetKeys(result.spec), [surfaceKey]);
  const closure = { ...input.closure, records: [surf(input)] };
  const resources = input.resources.filter(resource => resource.path === panelAssetPath(surf(input)));
  const bundle = await createPanelBundle(result.spec, catalog, core, undefined, { closure, resources });
  assert.equal(bundle.componentBundle.resources.length, 1);
  assert.deepEqual(await validatePanelBundle(bundle, core), bundle);
});

test('removing the final asset selection fails atomically instead of silently downgrading the spec', async () => {
  const input = assetFixture(); input.spec.assets.panelSurface = null;
  input.spec.assets.rowIcons = [{ rowId: 'volume-row', asset: iconKey }];
  const before = copy(input.spec);
  const patch = { patchVersion: '0.1', baseSpecSha256: await digestJson(input.spec), reason: 'Remove volume row',
    operations: [{ op: 'remove-row', rowId: 'volume-row' }] };
  await assert.rejects(applyPanelPatch(input.spec, patch), { code: 'asset-selection' });
  assert.deepEqual(input.spec, before);
});

test('asset-specific geometry rejects fixed borders larger than the panel and icons with unreadable labels', () => {
  const wide = assetFixture();
  Object.assign(surf(wide), { width: 1024, slice: { left: 400, right: 400, top: 11, bottom: 13 } });
  assert.throws(() => compilePanel(wide.spec, catalog, core, undefined, wide.closure), { code: 'SURFACE_GEOMETRY' });
  const narrow = assetFixture(); narrow.spec.layout.labelWidth = 60;
  assert.throws(() => compilePanel(narrow.spec, catalog, core, undefined, narrow.closure), { code: 'ICON_GEOMETRY' });
});
