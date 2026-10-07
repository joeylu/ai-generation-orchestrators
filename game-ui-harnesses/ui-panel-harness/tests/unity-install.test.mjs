import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUnityRuntimeIdentity, UNITY_SOURCE_PATHS } from '../src/unity-kit.mjs';
import { readUnityAdapterSources } from '../src/unity-export-io.mjs';
import { checkUnityInstall } from '../scripts/check-unity-install.mjs';
import { readManagedUnityPackage } from '../scripts/unity-package-evidence.mjs';

// Archive/host fixtures only. No Unity, native acceptance, model or media generation.
const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(join(root, '.tmp'), { recursive: true });
const work = await mkdtemp(join(root, '.tmp', 'unity-install-'));
const sources = await readUnityAdapterSources(), runtime = await createUnityRuntimeIdentity(sources);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const guid = path => hash(Buffer.from(path)).slice(0, 32);
const font = Buffer.from('inert font test double'), fontSha = hash(font);
const sourceSha = revision => hash(Buffer.from(`panel revision ${revision}`));
const write = async (path, bytes) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes); };

function tarFixture(records) {
  const blocks = [];
  const entry = (name, body) => {
    const header = Buffer.alloc(512); header.write(name, 0, 100, 'ascii');
    header.write(body.length.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');
    header.fill(32, 148, 156); header[156] = 48;
    header.write('ustar\0', 257, 6, 'ascii');
    const checksum = [...header].reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
    blocks.push(header, body, Buffer.alloc((512 - body.length % 512) % 512));
  };
  for (const [path, record] of records) {
    entry(`${record.guid}/asset`, record.bytes); entry(`${record.guid}/asset.meta`, record.meta);
    entry(`${record.guid}/pathname`, Buffer.from(path + '\0'));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}

async function fixture({ panelId = 'audio-settings', revision = 1, salt = '', bomRuntime = false, mutateIdentity = () => {} } = {}) {
  const folder = `Assets/PanelHarness/Panels/${panelId}`, prefab = `${folder}/${panelId}.canvas.prefab`;
  const records = new Map();
  const add = (path, bytes) => {
    const id = guid(path + (path.startsWith(`${folder}/`) ? salt : ''));
    records.set(path, { bytes: Buffer.from(bytes), guid: id, meta: Buffer.from(`fileFormatVersion: 2\nguid: ${id}\n`) });
  };
  const packetSources = Object.fromEntries(Object.entries(sources).map(([name, text]) => [name, (bomRuntime && name.startsWith('Runtime/') ? '\uFEFF' : '') + text]));
  for (const name of UNITY_SOURCE_PATHS.filter(name => name.startsWith('Runtime/'))) add(`Assets/PanelHarness/${name}`, packetSources[name]);
  add(prefab, `INERT PREFAB TEST DOUBLE ${revision}\n`);
  add(`${folder}/Fonts/${fontSha}.otf`, font);
  const identity = { identityVersion: '0.1', panelId, panelSha256: sourceSha(revision), previousPanelSha256: revision === 1 ? '' : sourceSha(revision - 1),
    ...await createUnityRuntimeIdentity(packetSources), prefabGuid: records.get(prefab).guid, prefabSha256: hash(records.get(prefab).bytes), revision };
  mutateIdentity(identity); add(`${folder}/panel-identity.json`, JSON.stringify(identity));
  const bytes = tarFixture(records), delivery = await mkdtemp(join(work, 'delivery-'));
  await write(join(delivery, 'panel.unitypackage'), bytes);
  await write(join(delivery, 'delivery.json'), JSON.stringify({ unityDeliveryVersion: '0.1', status: 'COMPLETE', target: 'unity-ugui', panelSha256: identity.panelSha256,
    files: [{ path: 'panel.unitypackage', bytes: bytes.length, sha256: hash(bytes) }], sourceEvidence: { prefab: { path: `project/${prefab}` } } }));
  return { records, identity, bytes, delivery, folder, prefab };
}

async function host(fixture) {
  const project = await mkdtemp(join(work, 'project-'));
  await mkdir(join(project, 'Assets'));
  await write(join(project, 'ProjectSettings/ProjectVersion.txt'), 'm_EditorVersion: 6000.3.7f1\n');
  if (fixture) await applyFixture(project, fixture);
  return project;
}
async function applyFixture(project, fixture) {
  for (const [path, file] of fixture.records) {
    await write(join(project, path), file.bytes); await write(join(project, `${path}.meta`), file.meta);
  }
}
async function snapshot(project) {
  const values = {};
  const visit = async directory => {
    for (const entry of await readdir(join(project, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await visit(path); else values[path] = hash(await readFile(join(project, path)));
    }
  };
  await visit('Assets'); return values;
}

test('managed package verifies identity, Prefab digest and exact shared runtime bytes', async () => {
  const pack = await fixture(), checked = await readManagedUnityPackage(pack.bytes, pack.prefab);
  assert.deepEqual(checked.identity, pack.identity); assert.equal(checked.files.size, 8);
  assert.deepEqual(checked.files.get(pack.prefab).bytes, pack.records.get(pack.prefab).bytes);
  for (const mutateIdentity of [i => { i.runtimeSha256 = '0'.repeat(64); }, i => { i.prefabGuid = '0'.repeat(32); },
    i => { i.prefabSha256 = '0'.repeat(64); }, i => { i.adapterVersion = '0.1.0'; }, i => { i.revision = 0; }, i => { i.extra = 'field'; }]) {
    const invalid = await fixture({ mutateIdentity });
    await assert.rejects(readManagedUnityPackage(invalid.bytes, invalid.prefab), /UNITY_NATIVE_/);
  }
});

test('runtime fingerprints preserve UTF-8 BOM bytes in native package inspection', async () => {
  const pack = await fixture({ bomRuntime: true });
  assert.notEqual(pack.identity.runtimeSha256, runtime.runtimeSha256);
  assert.deepEqual((await readManagedUnityPackage(pack.bytes, pack.prefab)).identity, pack.identity);
});

test('new-panel and repeated-install preflights are read-only and preserve the host byte-for-byte', async () => {
  const pack = await fixture(), project = await host(), before = await snapshot(project);
  const fresh = await checkUnityInstall({ delivery: pack.delivery, project });
  assert.equal(fresh.action, 'NEW_PANEL'); assert.equal(fresh.writes, 0); assert.equal(fresh.providerCalls, 0);
  assert.deepEqual(await snapshot(project), before);
  await applyFixture(project, pack); const installed = await snapshot(project);
  assert.equal((await checkUnityInstall({ delivery: pack.delivery, project })).action, 'ALREADY_INSTALLED');
  assert.deepEqual(await snapshot(project), installed);
});

test('two different panels share the same five script paths and GUIDs', async () => {
  const first = await fixture(), second = await fixture({ panelId: 'pause-menu' }), project = await host(first);
  assert.equal((await checkUnityInstall({ delivery: second.delivery, project })).action, 'NEW_PANEL');
  await applyFixture(project, second);
  assert.equal((await readdir(join(project, 'Assets/PanelHarness/Runtime'))).filter(name => name.endsWith('.cs')).length, 5);
  for (const [path, file] of first.records) if (path.includes('/Runtime/')) assert.equal(second.records.get(path).guid, file.guid);
});

test('updates require the exact installed base and a consecutive revision', async () => {
  const first = await fixture(), second = await fixture({ revision: 2 }), project = await host(first), before = await snapshot(project);
  const checked = await checkUnityInstall({ delivery: second.delivery, project, expectedPanelSha256: first.identity.panelSha256 });
  assert.equal(checked.action, 'UPDATE_PANEL'); assert.equal(checked.prefabGuid, first.identity.prefabGuid);
  for (const expectedPanelSha256 of [undefined, '0'.repeat(64)]) await assert.rejects(checkUnityInstall({ delivery: second.delivery, project, expectedPanelSha256 }), /UNITY_INSTALL_EXPECTED_BASE_REQUIRED/);
  const stale = await fixture({ revision: 2, mutateIdentity: i => { i.previousPanelSha256 = '0'.repeat(64); } });
  await assert.rejects(checkUnityInstall({ delivery: stale.delivery, project, expectedPanelSha256: first.identity.panelSha256 }), /UNITY_INSTALL_STALE_BASE/);
  assert.deepEqual(await snapshot(project), before);
});

test('a fresh export with the same panel ID but different GUIDs cannot replace an installed panel', async () => {
  const first = await fixture(), unrelated = await fixture({ salt: 'another identity' }), project = await host(first);
  await assert.rejects(checkUnityInstall({ delivery: unrelated.delivery, project }), /UNITY_INSTALL_PANEL_ID_CONFLICT/);
});

test('local script, Prefab, immutable resource and GUID changes are rejected without writes', async () => {
  const first = await fixture(), second = await fixture({ revision: 2 });
  for (const [path, code, metadata] of [
    ['Assets/PanelHarness/Runtime/PanelController.cs', 'UNITY_INSTALL_RUNTIME_VERSION_MISMATCH', false],
    [first.prefab, 'UNITY_INSTALL_LOCAL_PREFAB_CHANGED', false],
    [`${first.folder}/Fonts/${fontSha}.otf`, 'UNITY_INSTALL_RESOURCE_CONFLICT', false],
    [first.prefab, 'UNITY_INSTALL_GUID_CONFLICT', true],
    ['Assets/PanelHarness/Runtime/PanelController.cs', 'UNITY_INSTALL_META_SETTINGS_CONFLICT', 'settings'],
  ]) {
    const project = await host(first), target = join(project, path + (metadata ? '.meta' : ''));
    await writeFile(target, metadata === 'settings' ? Buffer.concat([await readFile(target), Buffer.from('userData: changed\n')]) :
      metadata ? 'fileFormatVersion: 2\nguid: 00000000000000000000000000000000\n' : Buffer.concat([await readFile(target), Buffer.from('\nchanged')]));
    const before = await snapshot(project);
    await assert.rejects(checkUnityInstall({ delivery: second.delivery, project, expectedPanelSha256: first.identity.panelSha256 }), error => error.message === code);
    assert.deepEqual(await snapshot(project), before);
  }
});

test('a changed package cannot inherit its original delivery digest', async () => {
  const pack = await fixture(), project = await host();
  await writeFile(join(pack.delivery, 'panel.unitypackage'), Buffer.concat([pack.bytes, Buffer.from('changed')]));
  await assert.rejects(checkUnityInstall({ delivery: pack.delivery, project }), /UNITY_INSTALL_PACKAGE_INTEGRITY/);
});
