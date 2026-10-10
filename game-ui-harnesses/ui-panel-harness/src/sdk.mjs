/** Installed SDK entry. Loading validates local bytes and never invokes a model. */
import { readFile, lstat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import * as panel from './index.mjs';
import * as transport from './codex-planner.mjs';
import { createWorkbenchModel } from './workbench-model.mjs';
import { createComponentCore } from './workspace/component-contract.mjs';
import { loadBundledCoreAssets } from './bundled-core-assets.mjs';
import { validateCatalog } from './catalog.mjs';
import { digestBytes } from './canonical.mjs';
import { createUnityKitFiles } from './unity-kit.mjs';
import { readUnityAdapterSources } from './unity-export-io.mjs';
import { createStoredZip } from './zip-store.mjs';

const root = new URL('../', import.meta.url);
const fail = code => { throw new Error(code); };

export async function verifyPanelSdk() {
  let manifest;
  try { manifest = JSON.parse(await readFile(new URL('release-manifest.json', root), 'utf8')); }
  catch { fail('SDK_RELEASE_REQUIRED'); }
  if (manifest.releaseManifestVersion !== '0.1' || manifest.package.name !== 'ai-ui-panel-harness'
    || !Array.isArray(manifest.files) || !manifest.files.length) fail('SDK_MANIFEST_INVALID');
  const names = new Set();
  for (const file of manifest.files) {
    if (typeof file.path !== 'string' || !/^[A-Za-z0-9_.@/-]+$/.test(file.path)
      || file.path.split('/').some(part => !part || part === '.' || part === '..')
      || names.has(file.path)) fail('SDK_MANIFEST_INVALID');
    names.add(file.path);
    const url = new URL(file.path, root);
    let bytes;
    try {
      if (!(await lstat(url)).isFile() || (await lstat(url)).isSymbolicLink()) fail('SDK_FILE_INVALID');
      bytes = await readFile(url);
    } catch { fail('SDK_FILE_INVALID'); }
    if (bytes.length !== file.bytes || await digestBytes(bytes) !== file.sha256) fail('SDK_FILE_INTEGRITY');
  }
  return manifest;
}

export async function loadPanelSdk() {
  const manifest = await verifyPanelSdk();
  const [compiler, contract, bundle] = await Promise.all([
    import('../vendor/component/lib/tree-compiler.js'), import('../vendor/component/lib/tree-contract.js'),
    import('../vendor/component/lib/bundle.js'),
  ]);
  const core = createComponentCore(compiler, contract, bundle);
  const seed = { catalog: validateCatalog(JSON.parse(await readFile(new URL('examples/modern-menu.catalog.json', root), 'utf8'))),
    pool: await loadBundledCoreAssets() };
  const [code, notices, sources] = await Promise.all([
    readFile(new URL('runtime/panel-runtime.js', root), 'utf8'), readFile(new URL('THIRD_PARTY_NOTICES.txt', root), 'utf8'),
    readUnityAdapterSources(),
  ]);
  const runtime = { version: '0.1.0', code, notices, sha256: await digestBytes(new TextEncoder().encode(code)) };
  const invoke = operation => (context, options = {}) => {
    if (typeof options.outputRoot !== 'string' || !isAbsolute(options.outputRoot)) fail('SDK_OUTPUT_ROOT_REQUIRED');
    return operation(context, { ...options, writableRoot: options.outputRoot });
  };
  return { manifest, panel, core, seed, createWorkbenchModel,
    planner: { planWithCodex: invoke(transport.planWithCodex), editWithCodex: invoke(transport.editWithCodex),
      model: transport.CODEX_MODEL, effort: transport.CODEX_EFFORT },
    delivery: { createPanelDelivery: panel.createPanelDelivery, createUnityKitFiles, createStoredZip, runtime, sources } };
}
