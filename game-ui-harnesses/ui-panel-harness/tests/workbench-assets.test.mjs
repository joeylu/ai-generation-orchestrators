import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canonicalJson, digestBytes, digestJson } from '../src/canonical.mjs';
import { snapshotJson } from '../src/spec.mjs';
import { createPlanningContext, validatePlanningContext } from '../src/planning-context.mjs';
import { createWorkbenchAssetPool, validateWorkbenchAssetPool, workbenchRetrieval,
  workbenchAssetInputs, verifyWorkbenchContextPool } from '../src/workbench-assets.mjs';

const png = new Uint8Array(await readFile(new URL('../examples/custom-assets/panel-surface.png', import.meta.url)));
const fixture = JSON.parse(await readFile(new URL('../examples/audio-settings.panel.json', import.meta.url), 'utf8'));
const catalog = JSON.parse(await readFile(new URL('../catalog/modern-core.json', import.meta.url), 'utf8'));
const copy = value => structuredClone(value);
const MIB = 1024 * 1024;
const roles = ['icon', 'shape', 'effect', 'layout-primitive', 'animation-part'];
const request = { requestVersion: '0.1', id: 'audio', target: 'pixi', text: '设置面板，音量和声音使用图标。' };

// Synthetic index evidence tests the browser envelope, not source rendering or
// alpha decoding. The normal resources are a tiny actual repository PNG.
async function library(entries = [
  { id: 'volume', version: '1.0.0' }, { id: 'volume', version: '2.0.0' }, { id: 'mute' },
  { id: 'surface', role: 'shape', slice: { left: 8, top: 8, right: 8, bottom: 8 } },
  { id: 'glow', role: 'effect' },
]) {
  const resources = new Map(), records = [];
  for (const entry of entries) {
    const bytes = entry.bytes ?? png, sha256 = await digestBytes(bytes), path = `textures/${sha256}.png`;
    resources.set(path, { path, mime: 'image/png', bytes });
    const metadata = { id: entry.id, version: entry.version ?? '1.0.0', name: entry.id,
      role: entry.role ?? 'icon', tags: ['音量', '声音', '面板'], size: { width: 64, height: 64 },
      family: entry.id, style: 'mint', variant: 'default', slice: entry.slice ?? null };
    const body = { key: `workbench-kit/${metadata.id}@${metadata.version}`, namespace: 'workbench-kit', metadata,
      source: { format: 'png', file: { path: `sources/${sha256}.png`, sha256, bytes: bytes.length } },
      file: { path, sha256, bytes: bytes.length },
      image: { width: 64, height: 64, channels: 4, alpha: { mode: 'opaque', opaquePixels: 4096, softPixels: 0,
        transparentPixels: 0, hiddenRgbPixels: 0, visibleBounds: { x: 0, y: 0, width: 64, height: 64 } } } };
    const revision = await digestJson(body);
    records.push({ ...body, revision, preview: { path: `previews/${revision}.png`, sha256, bytes: bytes.length } });
  }
  records.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const payload = { assetLibraryVersion: '0.1', id: 'workbench-assets', parent: null,
    renderer: { name: 'explicit-png-envelope-fixture', version: '1' }, records,
    summary: { versions: records.length, assets: new Set(records.map(record => `${record.namespace}/${record.metadata.id}`)).size,
      pngFiles: resources.size, sourceFiles: resources.size,
      roles: Object.fromEntries(roles.map(role => [role, records.filter(record => record.metadata.role === role).length])) },
    changes: { added: records.map(record => record.key), reused: [], retained: [] },
    verification: { files: 'HASHED', images: 'DECODED_NONEMPTY_ALPHA_CLEAN', semanticReview: 'NOT_RUN',
      visualReview: 'NOT_RUN', nativeEngines: 'NOT_RUN' } };
  return { index: { ...payload, sha256: await digestJson(payload) }, resources: [...resources.values()] };
}
async function rehash(value) { const { sha256, ...payload } = value; value.sha256 = await digestJson(payload); return value; }
function specFor(pool) {
  return { ...copy(fixture), panelSpecVersion: '0.2', assets: {
    library: { id: pool.index.id, sha256: pool.index.sha256 }, panelSurface: 'workbench-kit/surface@1.0.0',
    rowIcons: [{ rowId: 'volume-row', asset: 'workbench-kit/volume@1.0.0' },
      { rowId: 'audio-enabled-row', asset: 'workbench-kit/mute@1.0.0' }] } };
}
const source = await library();
const pool = await createWorkbenchAssetPool(source.index, source.resources);

test('complete pool round-trips with original evidence and deduplicated canonical PNG paths', async () => {
  const restored = await validateWorkbenchAssetPool(JSON.parse(JSON.stringify(pool)));
  assert.deepEqual(restored, pool);
  assert.deepEqual(restored.index, source.index);
  assert.equal(pool.index.records.length, 5); assert.equal(pool.resources.length, 1);
  assert.deepEqual(Object.keys(pool).sort(), ['index', 'resources', 'sha256', 'workbenchAssetPoolVersion']);
  assert.equal(pool.assetBuildVerificationVersion, undefined);
  const { sha256, ...payload } = pool; assert.equal(sha256, await digestJson(payload));
  const large = await library(Array.from({ length: 512 }, (_, i) => ({ id: `asset-${String(i).padStart(3, '0')}` })));
  assert.throws(() => snapshotJson(large.index), error => error.code === 'structure-limit');
  const largePool = await createWorkbenchAssetPool(large.index, large.resources);
  assert.equal((await validateWorkbenchAssetPool(largePool)).index.records.length, 512);
});

test('validated snapshots cannot be changed or substituted after validation', async () => {
  const mutable = copy(source.index), resources = source.resources.map(resource => ({ ...resource, bytes: new Uint8Array(resource.bytes) }));
  const pending = createWorkbenchAssetPool(mutable, resources);
  mutable.records[0].metadata.name = 'mutated during hashing'; resources[0].bytes.fill(0);
  const checked = await pending;
  assert.deepEqual(checked, pool);
  assert.ok(Object.isFrozen(checked.index.records[0].metadata.tags));
  assert.throws(() => { checked.index.records[0].metadata.name = 'changed'; }, TypeError);
  assert.throws(() => workbenchRetrieval('音量', copy(checked)), { code: 'WORKBENCH_ASSET_VALIDATION_REQUIRED' });
  await assert.rejects(workbenchAssetInputs(specFor(checked), copy(checked)), { code: 'WORKBENCH_ASSET_VALIDATION_REQUIRED' });
  const retrieved = workbenchRetrieval('音量', checked);
  retrieved.candidates[0].asset.tags.push('independent');
  assert.ok(!canonicalJson(checked).includes('independent'));
});

test('index and resources reject getters without invoking them', async () => {
  let calls = 0;
  for (const property of ['records', 'renderer']) {
    const bad = copy(source.index); Object.defineProperty(bad, property, { enumerable: true, get() { calls++; return []; } });
    await assert.rejects(createWorkbenchAssetPool(bad, source.resources), { code: 'WORKBENCH_ASSET_JSON' });
  }
  const nested = copy(source.index);
  Object.defineProperty(nested.records[0].metadata, 'name', { enumerable: true, get() { calls++; return 'name'; } });
  await assert.rejects(createWorkbenchAssetPool(nested, source.resources), { code: 'WORKBENCH_ASSET_JSON' });
  const encoded = copy(pool);
  Object.defineProperty(encoded.resources[0], 'base64', { enumerable: true, get() { calls++; return ''; } });
  await assert.rejects(validateWorkbenchAssetPool(encoded), { code: 'WORKBENCH_ASSET_JSON' });
  assert.equal(calls, 0);
});

test('record omission, index digest changes and pool digest changes are rejected', async () => {
  const omitted = copy(pool); omitted.index.records.pop(); await rehash(omitted);
  await assert.rejects(validateWorkbenchAssetPool(omitted), { code: 'WORKBENCH_ASSET_INDEX_DIGEST' });
  const changed = copy(pool); changed.index.renderer.version = '2'; await rehash(changed);
  await assert.rejects(validateWorkbenchAssetPool(changed), { code: 'WORKBENCH_ASSET_INDEX_DIGEST' });
  const wrong = copy(pool); wrong.sha256 = 'f'.repeat(64);
  await assert.rejects(validateWorkbenchAssetPool(wrong), { code: 'WORKBENCH_ASSET_DIGEST' });
});

test('the resource set must cover the full index exactly with sorted unique paths', async () => {
  await assert.rejects(createWorkbenchAssetPool(source.index, []), { code: 'WORKBENCH_ASSET_RESOURCE_SET' });
  await assert.rejects(createWorkbenchAssetPool(source.index, [...source.resources, ...source.resources]), { code: 'WORKBENCH_ASSET_RESOURCE_ORDER' });
  const extra = { ...source.resources[0], path: `textures/${'a'.repeat(64)}.png` };
  await assert.rejects(createWorkbenchAssetPool(source.index, [...source.resources, extra]), { code: 'WORKBENCH_ASSET_RESOURCE_SET' });
  await assert.rejects(createWorkbenchAssetPool(source.index, [{ ...source.resources[0], path: '../image.png' }]), { code: 'WORKBENCH_ASSET_RESOURCE' });
  const alternative = new Uint8Array(png); alternative[alternative.length - 1] ^= 1;
  const pair = await library([{ id: 'first' }, { id: 'second', bytes: alternative }]);
  const sorted = await createWorkbenchAssetPool(pair.index, [...pair.resources].reverse());
  assert.deepEqual(sorted.resources.map(resource => resource.path), sorted.resources.map(resource => resource.path).sort());
  const reversed = copy(sorted); reversed.resources.reverse(); await rehash(reversed);
  await assert.rejects(validateWorkbenchAssetPool(reversed), { code: 'WORKBENCH_ASSET_RESOURCE_ORDER' });
});

test('canonical base64, PNG hashes, byte counts and header dimensions are checked', async () => {
  for (const text of [`${pool.resources[0].base64}\n`, ` ${pool.resources[0].base64}`, pool.resources[0].base64.replace(/.$/u, '!')]) {
    const bad = copy(pool); bad.resources[0].base64 = text;
    await assert.rejects(validateWorkbenchAssetPool(bad), { code: 'WORKBENCH_ASSET_BASE64' });
  }
  // Alter only unused padding bits: atob would decode the same bytes.
  const padded = new Uint8Array(png.length + ((1 - png.length % 3 + 3) % 3)); padded.set(png);
  const paddedSource = await library([{ id: 'padded', bytes: padded }]);
  const noncanonical = copy(await createWorkbenchAssetPool(paddedSource.index, paddedSource.resources));
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const text = noncanonical.resources[0].base64, position = text.length - 3;
  noncanonical.resources[0].base64 = text.slice(0, position) + alphabet[alphabet.indexOf(text[position]) + 1] + '==';
  await assert.rejects(validateWorkbenchAssetPool(noncanonical), { code: 'WORKBENCH_ASSET_BASE64' });
  const changedBytes = source.resources.map(resource => ({ ...resource, bytes: new Uint8Array(resource.bytes) }));
  changedBytes[0].bytes[40] ^= 1;
  await assert.rejects(createWorkbenchAssetPool(source.index, changedBytes), { code: 'WORKBENCH_ASSET_PNG_DIGEST' });
  const length = copy(source.index); for (const record of length.records) record.file.bytes += 1; await rehash(length);
  await assert.rejects(createWorkbenchAssetPool(length, source.resources), { code: 'WORKBENCH_ASSET_PNG_DIGEST' });
  const header = copy(source.index);
  for (const record of header.records) { record.metadata.size.width = 65; record.image.width = 65; }
  await rehash(header);
  await assert.rejects(createWorkbenchAssetPool(header, source.resources), { code: 'WORKBENCH_ASSET_PNG_HEADER' });
});

test('identity, metadata, PNG path and image dimensions must agree for every record', async () => {
  for (const [mutate, expected] of [
    [index => { index.records[0].namespace = 'wrong'; }, 'ASSET_RETRIEVAL_INDEX'],
    [index => { index.records[0].metadata.role = 'demo'; }, 'ASSET_RETRIEVAL_METADATA'],
    [index => { index.records[0].file.path = `textures/${'a'.repeat(64)}.png`; }, 'WORKBENCH_ASSET_FILE'],
    [index => { index.records[0].image.width = 65; }, 'WORKBENCH_ASSET_DIMENSIONS'],
    [index => { index.records[0].metadata.size.width = 65; index.records[0].image.width = 65; }, 'WORKBENCH_ASSET_FILE_FACTS'],
  ]) {
    const changed = copy(source.index); mutate(changed); await rehash(changed);
    await assert.rejects(createWorkbenchAssetPool(changed, source.resources), { code: expected });
  }
});

test('pool enforces record, index, image and aggregate size limits', async () => {
  const tooMany = copy(source.index); tooMany.records = Array(513).fill(tooMany.records[0]);
  await assert.rejects(createWorkbenchAssetPool(tooMany, source.resources), { code: 'WORKBENCH_ASSET_COUNT_LIMIT' });
  await assert.rejects(createWorkbenchAssetPool(source.index, Array(513).fill(source.resources[0])), { code: 'WORKBENCH_ASSET_COUNT_LIMIT' });
  const oversized = copy(source.index); oversized.renderer.description = 'x'.repeat(4 * MIB);
  await assert.rejects(createWorkbenchAssetPool(oversized, source.resources), { code: 'WORKBENCH_ASSET_INDEX_LIMIT' });
  await assert.rejects(createWorkbenchAssetPool(source.index, [{ ...source.resources[0], bytes: new Uint8Array(MIB + 1) }]), { code: 'WORKBENCH_ASSET_BYTES' });
  // Header-only padded contract fixtures exercise envelopes, not image decoding.
  const manyImages = await library(Array.from({ length: 17 }, (_, i) => {
    const bytes = new Uint8Array(MIB); bytes.set(png); bytes[bytes.length - 1] = i;
    return { id: `asset-${i}`, bytes };
  }));
  await assert.rejects(createWorkbenchAssetPool(manyImages.index, manyImages.resources), { code: 'WORKBENCH_ASSET_TOTAL_LIMIT' });
});

test('retrieval uses all versions and panel selection retains exact older keys and deduplicates bytes', async () => {
  const retrieval = workbenchRetrieval(request.text, pool, { style: 'mint' });
  const keys = retrieval.candidates.map(candidate => candidate.asset.key);
  assert.ok(keys.includes('workbench-kit/volume@2.0.0'));
  assert.ok(!keys.includes('workbench-kit/volume@1.0.0')); assert.ok(!keys.includes('workbench-kit/glow@1.0.0'));
  const assets = await workbenchAssetInputs(specFor(pool), pool);
  assert.ok(assets.closure.records.some(record => record.key === 'workbench-kit/volume@1.0.0'));
  assert.equal(assets.closure.records.length, 3); assert.equal(assets.resources.length, 1);
  assets.resources[0].bytes.fill(0);
  assert.deepEqual((await workbenchAssetInputs(specFor(pool), pool)).resources[0].bytes, png);
  assert.equal(await workbenchAssetInputs(fixture, pool), undefined);
  assert.equal(await workbenchAssetInputs({ ...copy(fixture), panelSpecVersion: '0.3', assets: null }, pool), undefined);
});

test('panel selection rejects wrong library, absent exact keys, wrong roles and oversized closures', async () => {
  for (const [mutate, code] of [
    [spec => { spec.assets.library.sha256 = 'f'.repeat(64); }, 'PANEL_ASSET_LIBRARY_MISMATCH'],
    [spec => { spec.assets.rowIcons[0].asset = 'workbench-kit/volume@9.0.0'; }, 'PANEL_ASSET_SELECTION'],
    [spec => { spec.assets.rowIcons[0].asset = 'workbench-kit/surface@1.0.0'; }, 'PANEL_ASSET_ICON'],
    [spec => { spec.assets.panelSurface = 'workbench-kit/mute@1.0.0'; }, 'PANEL_ASSET_SURFACE'],
  ]) {
    const spec = specFor(pool); mutate(spec);
    await assert.rejects(workbenchAssetInputs(spec, pool), new RegExp(code, 'u'));
  }
  const first = new Uint8Array(600 * 1024); first.set(png);
  const second = new Uint8Array(first); second[second.length - 1] = 1;
  const source = await library([{ id: 'volume', bytes: first }, { id: 'mute', bytes: second }]);
  const largerPool = await createWorkbenchAssetPool(source.index, source.resources);
  const spec = specFor(largerPool); spec.assets.panelSurface = null;
  await assert.rejects(workbenchAssetInputs(spec, largerPool), /PANEL_ASSET_TOTAL_LIMIT/u);
});

test('context verification replays full retrieval to reject plausible omission and rehashed metadata forgery', async () => {
  const retrieval = workbenchRetrieval(request.text, pool, { style: 'mint' });
  const context = await createPlanningContext(request, catalog, retrieval);
  assert.deepEqual(await verifyWorkbenchContextPool(context, pool), retrieval);
  const missing = await createPlanningContext(request, catalog);
  await assert.rejects(verifyWorkbenchContextPool(missing, pool), { code: 'PLAN_ASSET_CONTEXT_REQUIRED' });
  for (const mutate of [
    value => { value.candidates.pop(); },
    value => { value.candidates[0].asset.sha256 = 'b'.repeat(64); },
    value => { value.library.sha256 = 'c'.repeat(64); },
  ]) {
    const altered = copy(retrieval); mutate(altered);
    const forged = await createPlanningContext(request, catalog, altered);
    assert.deepEqual(await validatePlanningContext(forged), forged);
    await assert.rejects(verifyWorkbenchContextPool(forged, pool), { code: 'PLAN_ASSET_RETRIEVAL_MISMATCH' });
  }
});
