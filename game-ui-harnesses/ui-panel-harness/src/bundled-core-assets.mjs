/** Exact, previously source-replayed release. Startup checks bytes; it does not rerender images. */
import { lstat, open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digestBytes } from './canonical.mjs';
import { createWorkbenchAssetPool } from './workbench-assets.mjs';

export const BUNDLED_CORE = Object.freeze({
  version: '1.0.0', id: 'panel-core-assets',
  deliverySha256: '58318f52efdd5fb913177cfa19c47ec92a5dbc3bbc3e8cc66810e81c493fab2f',
  librarySha256: '3eab8e6982d15ee4d4ea65e11573863376458b366a20bce17c5dc10a91adcefd',
  poolSha256: 'adec5027d1ffbd0b89621674600749e67e0eb4c32b28c47dee5387703f2a7e3c',
});
const directory = fileURLToPath(new URL('../assets/core-v1/', import.meta.url));
const fail = code => { throw Object.assign(new Error(code), { code }); };
async function readPinnedFile(path) {
  for (let current = resolve(path); ; current = dirname(current)) {
    if ((await lstat(current)).isSymbolicLink()) fail('WORKBENCH_BUNDLED_ASSET_LINK');
    if (dirname(current) === current) break;
  }
  const before = await lstat(path);
  if (!before.isFile() || before.size > 256 * 1024) fail('WORKBENCH_BUNDLED_ASSET_LIMIT');
  const handle = await open(path, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.ino !== before.ino || info.dev !== before.dev || info.size !== before.size)
      fail('WORKBENCH_BUNDLED_ASSET_CHANGED');
    const bytes = Buffer.alloc(info.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const result = await handle.read(bytes, size, bytes.length - size, size);
      if (!result.bytesRead) break;
      size += result.bytesRead;
    }
    if (size !== info.size) fail('WORKBENCH_BUNDLED_ASSET_CHANGED');
    return bytes.subarray(0, size);
  } finally { await handle.close(); }
}

/** Only call after validating the pool envelope and its content digest. */
export function isBundledCorePool(pool) {
  return pool?.sha256 === BUNDLED_CORE.poolSha256 && pool.index.id === BUNDLED_CORE.id
    && pool.index.sha256 === BUNDLED_CORE.librarySha256;
}

export async function loadBundledCoreAssets(root = directory) {
  const delivery = await readPinnedFile(resolve(root, 'delivery.json'));
  if (await digestBytes(delivery) !== BUNDLED_CORE.deliverySha256) fail('WORKBENCH_BUNDLED_ASSET_DIGEST');
  // Authenticate the immutable manifest before reading any paths from it.
  const manifest = JSON.parse(delivery.toString('utf8')), blobs = new Map();
  for (const file of manifest.files) {
    if (!/^(?:asset-library\.json|(?:sources|textures|previews)\/[a-f0-9]{64}\.(?:svg|png))$/.test(file.path))
      fail('WORKBENCH_BUNDLED_ASSET_PATH');
    const bytes = await readPinnedFile(resolve(root, file.path));
    if (bytes.length !== file.bytes || await digestBytes(bytes) !== file.sha256) fail('WORKBENCH_BUNDLED_ASSET_DIGEST');
    blobs.set(file.path, bytes);
  }
  const index = JSON.parse(blobs.get('asset-library.json').toString('utf8'));
  const resources = [...new Map(index.records.map(record => [record.file.path,
    { path: record.file.path, mime: 'image/png', bytes: blobs.get(record.file.path) }])).values()];
  const pool = await createWorkbenchAssetPool(index, resources);
  if (!isBundledCorePool(pool)) fail('WORKBENCH_BUNDLED_ASSET_DIGEST');
  return pool;
}
