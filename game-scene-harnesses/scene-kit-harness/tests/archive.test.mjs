import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { crc32 } from '../src/png.mjs';
import { storeArchive } from '../src/archive.mjs';
import { loadSceneKit, readMap, exportSceneArchive, openSceneExport } from '../src/index.mjs';
import { setup, fixtureRoot } from './helpers/generation.mjs';
import { unpackStored } from './helpers/archive.mjs';
import { canonicalJson, canonicalMap } from '../src/document.mjs';

test('stored archive is deterministic, has standard CRC32 and rejects paths or counts outside its bounded format', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  const entries = new Map([['b.png', Buffer.from([1, 2, 3])], ['nested/a.json', Buffer.from('{}\n')]]);
  const bytes = storeArchive(entries); assert.deepEqual(storeArchive(new Map([...entries].reverse())), bytes);
  assert.deepEqual([...unpackStored(bytes)].sort(), [...entries].sort());
  for (const path of ['../outside.png', '/absolute.png', 'C:/secret.png', 'nested/../../escape.json', 'line\n.png']) assert.throws(() => storeArchive(new Map([[path, Buffer.from('x')]])));
  assert.throws(() => storeArchive(new Map(Array.from({ length: 8193 }, (_, i) => [`a${i}.png`, Buffer.from('x')]))));
});
test('archive export contains the exact kit/document dependency closure and opens through the ordinary strict loader', t => {
  const c = setup(t), kit = loadSceneKit(fixtureRoot), map = readMap(kit), bytes = exportSceneArchive(kit, map), root = join(c.parent, 'unpacked');
  const entries = unpackStored(bytes, root); assert.equal(entries.size, 58);
  assert.deepEqual(exportSceneArchive(kit, map), bytes);
  const restored = openSceneExport(root); assert.deepEqual(restored.document, canonicalMap(map)); assert.equal(restored.handle.bundleSha256, kit.bundleSha256);
  const { contentSha256, ...scene } = restored.compiled;
  assert.equal(contentSha256, createHash('sha256').update(canonicalJson(scene)).digest('hex'));
});
