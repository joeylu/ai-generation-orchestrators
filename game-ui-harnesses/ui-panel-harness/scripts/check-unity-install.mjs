#!/usr/bin/env node
/** Read-only preflight. Never imports assets or changes a host Unity project. */
import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseNativeJson, readManagedUnityPackage, readNativeFile, validateNativeIdentity } from './unity-package-evidence.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const requireThat = (value, code) => { if (!value) throw new Error(code); };
const exists = async path => { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const metaGuid = bytes => /^guid: ([a-f0-9]{32})$/m.exec(new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r\n/g, '\n'))?.[1];

export async function checkUnityInstall({ delivery, project, expectedPanelSha256 }) {
  requireThat(typeof delivery === 'string' && typeof project === 'string', 'UNITY_INSTALL_ARGUMENTS');
  const directory = resolve(delivery), host = resolve(project);
  requireThat((await lstat(join(host, 'Assets'))).isDirectory() && await exists(join(host, 'ProjectSettings', 'ProjectVersion.txt')), 'UNITY_INSTALL_PROJECT_REQUIRED');
  const manifest = parseNativeJson(await readNativeFile(join(directory, 'delivery.json'), 2 * 1024 * 1024));
  requireThat(manifest.status === 'COMPLETE' && manifest.unityDeliveryVersion === '0.1' && manifest.target === 'unity-ugui', 'UNITY_INSTALL_DELIVERY_REQUIRED');
  const evidence = manifest.files?.find(file => file.path === 'panel.unitypackage'), prefab = manifest.sourceEvidence?.prefab?.path;
  requireThat(evidence && typeof prefab === 'string' && prefab.startsWith('project/'), 'UNITY_INSTALL_PACKAGE_EVIDENCE');
  const bytes = await readNativeFile(join(directory, 'panel.unitypackage'));
  requireThat(evidence.bytes === bytes.length && evidence.sha256 === hash(bytes), 'UNITY_INSTALL_PACKAGE_INTEGRITY');
  const prefabPath = prefab.slice('project/'.length), incoming = await readManagedUnityPackage(bytes, prefabPath);
  requireThat(incoming.identity.panelSha256 === manifest.panelSha256, 'UNITY_INSTALL_PANEL_IDENTITY');
  const identityPath = join(host, incoming.layout.panelFolder, 'panel-identity.json');
  let status = 'NEW_PANEL', installed;
  if (await exists(identityPath)) {
    installed = validateNativeIdentity(parseNativeJson(await readNativeFile(identityPath, 8192)), prefabPath);
    requireThat(hash(await readNativeFile(join(host, prefabPath))) === installed.prefabSha256, 'UNITY_INSTALL_LOCAL_PREFAB_CHANGED');
    requireThat(installed.panelId === incoming.identity.panelId && installed.prefabGuid === incoming.identity.prefabGuid, 'UNITY_INSTALL_PANEL_ID_CONFLICT');
    requireThat(installed.runtimeSha256 === incoming.identity.runtimeSha256, 'UNITY_INSTALL_RUNTIME_VERSION_MISMATCH');
    if (installed.panelSha256 === incoming.identity.panelSha256 && installed.revision === incoming.identity.revision) status = 'ALREADY_INSTALLED';
    else {
      requireThat(expectedPanelSha256 === installed.panelSha256, 'UNITY_INSTALL_EXPECTED_BASE_REQUIRED');
      requireThat(incoming.identity.previousPanelSha256 === installed.panelSha256 && incoming.identity.revision === installed.revision + 1, 'UNITY_INSTALL_STALE_BASE');
      status = 'UPDATE_PANEL';
    }
  } else requireThat(!await exists(join(host, prefabPath)) && !expectedPanelSha256, 'UNITY_INSTALL_UNMANAGED_PANEL_CONFLICT');
  for (const [path, file] of incoming.files) {
    const target = join(host, path), hasAsset = await exists(target), hasMeta = await exists(`${target}.meta`);
    requireThat(hasAsset === hasMeta, 'UNITY_INSTALL_ASSET_META_PAIR_REQUIRED');
    if (!hasAsset) continue;
    const existing = await readNativeFile(target), meta = await readNativeFile(`${target}.meta`, 1024 * 1024);
    requireThat(metaGuid(meta) === file.guid, 'UNITY_INSTALL_GUID_CONFLICT');
    const metaText = value => new TextDecoder('utf-8', { fatal: true }).decode(value).replace(/\r\n/g, '\n');
    requireThat(metaText(meta) === metaText(file.meta), 'UNITY_INSTALL_META_SETTINGS_CONFLICT');
    if (path.startsWith('Assets/PanelHarness/Runtime/')) requireThat(hash(existing) === hash(file.bytes), 'UNITY_INSTALL_RUNTIME_VERSION_MISMATCH');
    else if (path !== prefabPath && !path.endsWith('/panel-identity.json')) requireThat(hash(existing) === hash(file.bytes), 'UNITY_INSTALL_RESOURCE_CONFLICT');
  }
  return { status: 'PASS', action: status, panelId: incoming.identity.panelId, revision: incoming.identity.revision,
    adapterVersion: incoming.identity.adapterVersion, runtimeSha256: incoming.identity.runtimeSha256,
    prefabGuid: incoming.identity.prefabGuid, panelSha256: incoming.identity.panelSha256,
    previousPanelSha256: installed?.panelSha256 ?? null, assets: incoming.files.size, providerCalls: 0, writes: 0 };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === pathToFileURL(fileURLToPath(import.meta.url)).href) {
  const options = {}, args = process.argv.slice(2);
  try {
    for (let index = 0; index < args.length; index += 2) {
      const key = { '--delivery': 'delivery', '--project': 'project', '--expected-panel-sha': 'expectedPanelSha256' }[args[index]];
      requireThat(key && args[index + 1] && !Object.hasOwn(options, key), 'UNITY_INSTALL_ARGUMENTS'); options[key] = args[index + 1];
    }
    process.stdout.write(`${JSON.stringify(await checkUnityInstall(options))}\n`);
  } catch (error) {
    const code = /^UNITY_[A-Z_]+$/.test(error.message) ? error.message : 'UNITY_INSTALL_FAILED';
    process.stderr.write(`${JSON.stringify({ status: 'FAIL', code, writes: 0, providerCalls: 0 })}\n`); process.exitCode = 1;
  }
}
