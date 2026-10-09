import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, writeFile, unlink, symlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { harnessRoot } from '../src/io.mjs';
import { BUNDLED_CORE, loadBundledCoreAssets, isBundledCorePool } from '../src/bundled-core-assets.mjs';
import { workbenchRetrieval } from '../src/workbench-assets.mjs';

const source = resolve(harnessRoot, 'assets/core-v1');
await mkdir(resolve(harnessRoot, '.tmp'), { recursive: true });
const work = await mkdtemp(resolve(harnessRoot, '.tmp/bundled-core-'));
const manifest = JSON.parse(await readFile(resolve(source, 'delivery.json'), 'utf8'));
async function fixture(name) {
  const root = resolve(work, name); await cp(source, root, { recursive: true }); return root;
}

test('bundled core loads twelve exact icons without an image adapter or ignored outputs', async () => {
  const pool = await loadBundledCoreAssets();
  assert.equal(pool.sha256, BUNDLED_CORE.poolSha256); assert(isBundledCorePool(pool));
  assert.equal(pool.index.sha256, BUNDLED_CORE.librarySha256);
  assert.equal(pool.index.records.length, 12); assert.equal(pool.resources.length, 12);
  assert.deepEqual(pool.index.records.map(r => r.key), ['back', 'close', 'confirm', 'home', 'music', 'mute', 'pause', 'play', 'reset', 'settings', 'user', 'volume'].map(id => `panel-core/${id}@1.0.0`));
  const retrieval = workbenchRetrieval('角色命名，确认、取消、恢复默认和主音量', pool);
  assert(retrieval.candidates.length > 0); assert.equal(retrieval.library.sha256, BUNDLED_CORE.librarySha256);
  assert(Object.isFrozen(pool)); assert(Object.isFrozen(pool.index.records));
});

for (const type of ['asset-library.json', 'sources/', 'textures/', 'previews/']) {
  test(`bundled release rejects changed ${type} bytes`, async () => {
    const root = await fixture(`tamper-${type.replaceAll('/', '')}`);
    const file = manifest.files.find(f => f.path.startsWith(type)).path;
    const path = resolve(root, file), bytes = await readFile(path);
    bytes[bytes.length - 1] ^= 1; await writeFile(path, bytes);
    await assert.rejects(loadBundledCoreAssets(root), { code: 'WORKBENCH_BUNDLED_ASSET_DIGEST' });
  });
}

test('rewriting the manifest to match changed content cannot repin the bundled release', async () => {
  const root = await fixture('manifest'), path = resolve(root, 'delivery.json');
  const value = JSON.parse(await readFile(path, 'utf8')); value.files[0].sha256 = '0'.repeat(64);
  await writeFile(path, JSON.stringify(value));
  await assert.rejects(loadBundledCoreAssets(root), { code: 'WORKBENCH_BUNDLED_ASSET_DIGEST' });
});

test('missing bundled source does not silently fall back to an asset-free pool', async () => {
  const root = await fixture('missing'); await unlink(resolve(root, manifest.files.find(f => f.path.startsWith('sources/')).path));
  await assert.rejects(loadBundledCoreAssets(root), { code: 'ENOENT' });
});

test('linked bundled roots are rejected even when their files match', async t => {
  const path = resolve(work, 'linked');
  try { await symlink(source, path, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) return t.skip('Link creation unavailable'); throw error; }
  await assert.rejects(loadBundledCoreAssets(path), { code: 'WORKBENCH_BUNDLED_ASSET_LINK' });
});
