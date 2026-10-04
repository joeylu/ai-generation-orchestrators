/** Bounded native evidence inspection shared by preparation and read-only install checks. */
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { inspectUnityPackage } from './publish-unity-export.mjs';
import { createUnityRuntimeIdentity, UNITY_SOURCE_PATHS } from '../src/unity-kit.mjs';
import { UNITY_ADAPTER_VERSION } from '../src/unity-export.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const requireThat = (value, code) => { if (!value) throw new Error(code); };
const SHA = /^[a-f0-9]{64}$(?![\s\S])/;
const GUID = /^[a-f0-9]{32}$(?![\s\S])/;
export const parseNativeJson = bytes => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));

export async function readNativeFile(path, maximum = 64 * 1024 * 1024) {
  for (let current = resolve(path); ; current = dirname(current)) {
    const info = await lstat(current);
    requireThat(!info.isSymbolicLink(), 'UNITY_NATIVE_INPUT_LINK');
    if (current === resolve(path)) requireThat(info.isFile() && info.size > 0 && info.size <= maximum, 'UNITY_NATIVE_INPUT_FILE');
    if (dirname(current) === current) break;
  }
  return readFile(path);
}

export function validateNativeIdentity(identity, prefabPath) {
  const names = ['identityVersion', 'panelId', 'panelSha256', 'previousPanelSha256', 'adapterVersion', 'runtimeSha256', 'prefabGuid', 'prefabSha256', 'revision'];
  requireThat(identity && Object.keys(identity).length === names.length && names.every(name => Object.hasOwn(identity, name)), 'UNITY_NATIVE_IDENTITY_FIELDS');
  requireThat(names.filter(name => name !== 'revision').every(name => typeof identity[name] === 'string'), 'UNITY_NATIVE_IDENTITY_FIELDS');
  requireThat(identity.identityVersion === '0.1' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$(?![\s\S])/.test(identity.panelId)
    && !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(identity.panelId)
    && SHA.test(identity.panelSha256) && SHA.test(identity.runtimeSha256) && SHA.test(identity.prefabSha256) && GUID.test(identity.prefabGuid)
    && Number.isSafeInteger(identity.revision) && identity.revision >= 1 && identity.revision <= 1000000
    && (identity.revision === 1 ? identity.previousPanelSha256 === '' : SHA.test(identity.previousPanelSha256)), 'UNITY_NATIVE_IDENTITY_INVALID');
  requireThat(identity.adapterVersion === UNITY_ADAPTER_VERSION, 'UNITY_NATIVE_ADAPTER_VERSION');
  requireThat(prefabPath === `Assets/PanelHarness/Panels/${identity.panelId}/${identity.panelId}.canvas.prefab`, 'UNITY_NATIVE_PANEL_PATH');
  return identity;
}

export async function readManagedUnityPackage(bytes, prefabPath) {
  const { layout, files } = inspectUnityPackage(bytes, prefabPath, { includeAssets: true });
  const record = files.get(`${layout.panelFolder}/panel-identity.json`);
  requireThat(record && record.bytes.length <= 8192, 'UNITY_NATIVE_IDENTITY_REQUIRED');
  const identity = validateNativeIdentity(parseNativeJson(record.bytes), prefabPath);
  requireThat(identity.prefabGuid === files.get(prefabPath).guid, 'UNITY_NATIVE_PREFAB_GUID');
  requireThat(identity.prefabSha256 === hash(files.get(prefabPath).bytes), 'UNITY_NATIVE_PREFAB_INTEGRITY');
  const sources = {};
  for (const name of UNITY_SOURCE_PATHS.filter(name => name.startsWith('Runtime/'))) {
    const source = files.get(`Assets/PanelHarness/${name}`);
    requireThat(source && source.bytes.length <= 1024 * 1024, 'UNITY_NATIVE_RUNTIME_SOURCE');
    sources[name] = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(source.bytes);
  }
  requireThat((await createUnityRuntimeIdentity(sources)).runtimeSha256 === identity.runtimeSha256, 'UNITY_NATIVE_RUNTIME_INTEGRITY');
  for (const [path, file] of files) {
    const content = /\/(?:Fonts|Textures)\/([a-f0-9]{64})\.(?:otf|ttf|png)$/.exec(path);
    if (content) requireThat(hash(file.bytes) === content[1], 'UNITY_NATIVE_CONTENT_INTEGRITY');
  }
  return { layout, files, identity };
}
