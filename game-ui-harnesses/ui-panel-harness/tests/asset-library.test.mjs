import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, stat, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importAssetBatch, verifyAssetLibrary, resolveAsset, searchAssets } from '../src/asset-library.mjs';
import { digestBytes } from '../src/canonical.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(join(root, '.tmp'), { recursive: true });
const work = await mkdtemp(join(root, '.tmp', 'asset-import-'));
const vector = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="8" fill="#FFFFFF"/></svg>';
// Explicit byte fixtures and deterministic adapter double. No real images or model services in unit tests.
const adapter = {
  evidence: { name: 'fixture-double', version: '1' },
  async analyze(bytes) {
    if (bytes.toString().includes('invalid-source')) throw new Error('INVALID_PNG_FIXTURE');
    return { width: 64, height: 64, channels: 4, alpha: { mode: 'opaque', opaquePixels: 4096, transparentPixels: 0,
      softPixels: 0, hiddenRgbPixels: 0, visibleBounds: { x: 0, y: 0, width: 64, height: 64 } } };
  },
  normalizePng: async bytes => Buffer.from(`normalized:${bytes}`),
  render: async svg => Buffer.from(`rendered:${svg}`),
  gallery: async (items, options) => {
    assert.equal(options.labels, false, 'generic thumbnails must not depend on environment fonts');
    assert(items.every(item => item.label === ''));
    return Buffer.from((await Promise.all(items.map(item => digestBytes(item.bytes)))).join(','));
  },
};
const entry = (id, file = 'icon.png', role = 'icon', version = '1.0.0') => ({ id, version, file, name: id,
  role, tags: ['测试', '音量'], size: { width: 64, height: 64 }, family: 'audio.volume', style: 'custom' });
async function batch(name, assets, files = { 'icon.png': 'source-pixels-v1', 'shape.svg': vector }) {
  const dir = join(work, name); await mkdir(dir);
  for (const [path, bytes] of Object.entries(files)) { await mkdir(join(dir, path, '..'), { recursive: true }); await writeFile(join(dir, path), bytes); }
  const path = join(dir, 'assets.json');
  await writeFile(path, JSON.stringify({ assetBatchVersion: '0.1', namespace: 'test-ui', assets }));
  return path;
}
async function initial(name) {
  const manifest = await batch(name, [entry('volume'), entry('background', 'shape.svg', 'shape')]);
  const output = join(work, `${name}-package`), index = await importAssetBatch(manifest, output, adapter);
  return { manifest, output, index };
}

test('independent PNG/SVG import preserves source bytes, metadata and content deduplication', async () => {
  const input = await batch('source-dedup', [entry('first'), entry('second'), entry('surface', 'shape.svg', 'shape')]);
  const output = join(work, 'source-dedup-package'), index = await importAssetBatch(input, output, adapter);
  assert.equal(index.records.length, 3); assert.equal(index.summary.pngFiles, 2); assert.equal(index.summary.sourceFiles, 2);
  const first = resolveAsset(index, 'test-ui/first@1.0.0');
  assert.equal((await readFile(join(output, first.source.file.path))).toString(), 'source-pixels-v1');
  assert.equal((await readFile(join(output, first.file.path))).toString(), 'normalized:source-pixels-v1');
  assert.equal(first.metadata.slice, null); assert.equal(index.parent, null);
  assert.equal((await verifyAssetLibrary(output, adapter)).index.sha256, index.sha256);
  assert.equal(index.verification.nativeEngines, 'NOT_RUN');
});

test('file rename reuses immutable versions, new versions retain every old record and exact reference', async () => {
  const old = await initial('incremental');
  const oldIndexBytes = await readFile(join(old.output, 'asset-library.json'));
  const update = await batch('incremental-update', [entry('volume', 'moved.png'), entry('volume', 'new.png', 'icon', '1.2.0')],
    { 'moved.png': 'source-pixels-v1', 'new.png': 'source-pixels-v2' });
  const output = join(work, 'incremental-v2'), index = await importAssetBatch(update, output, adapter, { base: old.output });
  assert.deepEqual(index.changes, { added: ['test-ui/volume@1.2.0'], reused: ['test-ui/volume@1.0.0'], retained: ['test-ui/background@1.0.0'] });
  assert.deepEqual(resolveAsset(index, 'test-ui/volume@1.0.0'), resolveAsset(old.index, 'test-ui/volume@1.0.0'));
  assert.equal(index.parent.sha256, old.index.sha256);
  assert.deepEqual(await readFile(join(old.output, 'asset-library.json')), oldIndexBytes);
  assert.equal((await verifyAssetLibrary(output, adapter)).index.sha256, index.sha256);
  assert.equal(searchAssets(index, '音量')[0].variants[0].version, '1.2.0');
  assert.equal(searchAssets(index, '音量', { allVersions: true })[0].variants.length, 2);
  assert.equal(searchAssets(index, '音量', { role: 'shape' })[0].variants[0].key, 'test-ui/background@1.0.0');
  assert.deepEqual(searchAssets(index, 'no-matching-token'), []);
  assert.throws(() => resolveAsset(index, 'test-ui/volume@latest'), /ASSET_EXACT_KEY_REQUIRED/);
  assert.throws(() => resolveAsset(index, 'test-ui/volume@9.0.0'), /ASSET_NOT_FOUND/);
});

test('replacing content or metadata within the same version fails without publishing output', async () => {
  const old = await initial('conflicts');
  for (const [suffix, assets, files] of [
    ['pixels', [entry('volume')], { 'icon.png': 'new-pixel-content' }],
    ['metadata', [{ ...entry('volume'), name: 'Changed name' }], { 'icon.png': 'source-pixels-v1' }],
  ]) {
    const input = await batch(`conflict-${suffix}`, assets, files), output = join(work, `conflict-${suffix}-package`);
    await assert.rejects(importAssetBatch(input, output, adapter, { base: old.output }), /ASSET_VERSION_CONFLICT/);
    await assert.rejects(stat(output), { code: 'ENOENT' });
  }
});

test('highest numeric version is selected before filters and roles never leak into icon results', async () => {
  const input = await batch('latest', [entry('volume', 'icon.png', 'icon', '1.2.0'), entry('volume', 'icon.png', 'effect', '1.10.0')]);
  const index = await importAssetBatch(input, join(work, 'latest-package'), adapter);
  assert.deepEqual(searchAssets(index, '音量'), []);
  assert.equal(searchAssets(index, '音量', { role: 'effect' })[0].variants[0].version, '1.10.0');
  assert.equal(searchAssets(index, '音量', { allVersions: true })[0].variants[0].version, '1.2.0');
  assert.throws(() => searchAssets(index, '音量', { role: 'demo' }), /ASSET_SEARCH_FILTER/);
});

test('invalid sources, dimensions, traversal and linked ancestors fail without publishing', async () => {
  const cases = [
    ['bad-png', [entry('icon')], { 'icon.png': 'invalid-source' }, /INVALID_PNG_FIXTURE/],
    ['bad-size', [{ ...entry('icon'), size: { width: 32, height: 64 } }], { 'icon.png': 'pixels' }, /ASSET_SOURCE_DIMENSIONS/],
    ['bad-svg', [entry('icon', 'icon.svg')], { 'icon.svg': vector.replace('<rect', '<script/><rect') }, /ASSET_SVG_TAG/],
    ['traversal', [entry('icon', '../icon.png')], {}, /ASSET_FILE_PATH/],
  ];
  for (const [name, entries, files, error] of cases) {
    const input = await batch(name, entries, files), output = join(work, `${name}-package`);
    await assert.rejects(importAssetBatch(input, output, adapter), error);
    await assert.rejects(stat(output), { code: 'ENOENT' });
  }
  const linked = await batch('linked', [entry('icon', 'redirect/icon.png')], {});
  const target = await batch('linked-target', [entry('icon')]);
  await symlink(dirname(target), join(dirname(linked), 'redirect'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(importAssetBatch(linked, join(work, 'linked-package'), adapter), /ASSET_LINK_FORBIDDEN/);
});
test('package bytes are checked and output directories cannot be overwritten or escape this Harness', async () => {
  const ready = await initial('integrity');
  await assert.rejects(importAssetBatch(ready.manifest, ready.output, adapter), /OUTPUT_EXISTS/);
  await assert.rejects(importAssetBatch(ready.manifest, join(root, '..', 'escaped-asset-package'), adapter), /OUTPUT_OUTSIDE_HARNESS/);
  const record = ready.index.records[0]; await writeFile(join(ready.output, record.file.path), 'changed-pixels');
  await assert.rejects(verifyAssetLibrary(ready.output, adapter), /ASSET_FILE_MISMATCH/);
});
