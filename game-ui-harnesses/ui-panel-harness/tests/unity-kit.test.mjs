import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { core, fixture, catalog, copy } from './helpers.mjs';
import { createPanelBundle } from '../src/panel-bundle.mjs';
import { createUnityKitFiles, createUnityRuntimeIdentity, UNITY_SOURCE_PATHS } from '../src/unity-kit.mjs';
import { exportUnityKit, readUnityAdapterSources } from '../src/unity-export-io.mjs';
import { createStoredZip } from '../src/zip-store.mjs';
import { digestBytes } from '../src/canonical.mjs';
import { readStoredZip } from './unity-kit-helpers.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(join(root, '.tmp'), { recursive: true });
const work = await mkdtemp(join(root, '.tmp', 'unity-kit-'));
const sources = await readUnityAdapterSources(), bundle = await createPanelBundle(fixture, catalog, core);

test('portable kit and CLI write exactly the same bytes, stable GUIDs and verification status', async () => {
  const before = copy(bundle), kit = await createUnityKitFiles(bundle, core, sources);
  const output = join(work, 'cli'); await exportUnityKit(bundle, core, output);
  for (const [path, bytes] of kit.contents) assert.deepEqual(Buffer.from(bytes), await readFile(join(output, path)));
  assert.deepEqual(bundle, before); assert.equal(kit.contents.size, 17);
  assert.deepEqual(kit.manifest.verification, { sourceBundle: 'PASS', unityImport: 'NOT_RUN', nativeInteraction: 'NOT_RUN', humanVisualReview: 'NOT_RUN' });
  for (const file of kit.manifest.files) {
    assert.equal(kit.contents.get(file.path).length, file.bytes);
    assert.equal(await digestBytes(kit.contents.get(file.path)), file.sha256);
  }
  assert.equal(kit.manifest.files.some(f => /Tests|Smoke|TestFont/.test(f.path)), false);
});

test('shared runtime identity is panel-independent, changes with runtime bytes and excludes Editor code', async () => {
  const first = await createUnityRuntimeIdentity(sources);
  const changedRuntime = { ...sources, 'Runtime/PanelController.cs': sources['Runtime/PanelController.cs'] + '\n// fixture change' };
  const changedEditor = { ...sources, 'Editor/PanelPrefabBuilder.cs': sources['Editor/PanelPrefabBuilder.cs'] + '\n// fixture change' };
  assert.notDeepEqual(await createUnityRuntimeIdentity(changedRuntime), first);
  assert.deepEqual(await createUnityRuntimeIdentity(changedEditor), first);
  const spec = copy(fixture); spec.id = 'other-panel';
  const other = await createUnityKitFiles(await createPanelBundle(spec, catalog, core), core, sources);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(other.contents.get('unity-runtime.json'))), first);
  assert.equal(first.adapterVersion, '0.1.2');
});

test('portable kit requires the exact allowlisted adapter set and rejects source bundle tampering', async () => {
  for (const invalid of [null, {}, { ...sources, 'Tests/Smoke.cs': 'test' },
    Object.fromEntries(Object.entries(sources).slice(1)), { ...sources, [UNITY_SOURCE_PATHS[0]]: '' }])
    await assert.rejects(createUnityKitFiles(bundle, core, invalid), /UNITY_ADAPTER_SOURCES/);
  const forged = copy(bundle); forged.spec.title = 'forged';
  await assert.rejects(createUnityKitFiles(forged, core, sources));
});

test('ZIP round-trip retains binary PNG, CJK text, empty files and standard CRC with fixed timestamps', () => {
  const content = new Map([['Assets/a.txt', new TextEncoder().encode('音量设置')],
    ['b.png', Uint8Array.from([137, 80, 78, 71, 0, 255])], ['empty', new Uint8Array()],
    ['crc.txt', new TextEncoder().encode('123456789')]]);
  const archive = createStoredZip(content), parsed = readStoredZip(archive);
  assert.deepEqual([...parsed.keys()], ['Assets/a.txt', 'b.png', 'crc.txt', 'empty']);
  for (const [path, bytes] of content) assert.deepEqual(parsed.get(path), Buffer.from(bytes));
  const crcHeader = Buffer.from(archive).indexOf(Buffer.from('crc.txt')) - 30;
  assert.equal(Buffer.from(archive).readUInt32LE(crcHeader + 14), 0xcbf43926);
  assert.deepEqual(archive, createStoredZip(new Map([...content].reverse())));
});

test('ZIP refuses unsafe names, case collisions, file-directory conflicts and excessive sizes', () => {
  const small = new Uint8Array();
  for (const name of ['../file', '/file', 'a//file', 'a/./file', 'C:/file', 'a\\file', 'file\n', 'file\r', 'x'.repeat(241)])
    assert.throws(() => createStoredZip(new Map([[name, small]])), /ZIP_FILE_PATH/);
  assert.throws(() => createStoredZip(new Map([['File', small], ['file', small]])), /ZIP_FILE_PATH/);
  assert.throws(() => createStoredZip(new Map([['a', small], ['a/b', small]])), /ZIP_FILE_PATH/);
  assert.throws(() => createStoredZip(new Map()), /ZIP_FILE_COUNT/);
  assert.throws(() => createStoredZip(new Map([['file', 'text']])), /ZIP_FILE_BYTES/);
  assert.throws(() => createStoredZip(new Map([['file', new Uint8Array(64 * 1024 * 1024)]])), /ZIP_SIZE_LIMIT/);
});

test('full portable kit ZIP round-trip preserves every manifest fingerprint', async () => {
  const kit = await createUnityKitFiles(bundle, core, sources), zip = createStoredZip(kit.contents);
  const parsed = readStoredZip(zip);
  assert.deepEqual(JSON.parse(parsed.get('export-manifest.json')), kit.manifest);
  for (const [path, bytes] of kit.contents) assert.deepEqual(parsed.get(path), Buffer.from(bytes));
  assert.deepEqual(zip, createStoredZip((await createUnityKitFiles(bundle, core, sources)).contents));
});
