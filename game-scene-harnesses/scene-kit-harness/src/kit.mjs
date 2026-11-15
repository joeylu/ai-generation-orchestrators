import { loadBundleRevisionSnapshot, loadBundleSnapshot, sha256 } from './validate.mjs';
import { clone, deepFreeze } from './document.mjs';
import { demand } from './errors.mjs';

const contexts = new WeakMap();

export function loadSceneKit(root) {
  return registerKit(loadBundleSnapshot(root));
}

export function loadRevisedSceneKit(handle, files) {
  return registerKit(loadBundleRevisionSnapshot(contextFor(handle).sourceRoot, files));
}

function registerKit(context) {
  context.bundleSha256 = sha256(context.files.get('kit.json'));
  context.modules = new Map(context.catalog.modules.map(module => [module.assetId, module]));
  context.entries = new Map(context.rules.entries.map(entry => [entry.signature,
    ['ai_scene_kit_v2', 'ai_scene_kit_v3', 'ai_scene_kit_v4'].includes(context.kit.format) ? [...entry.variantAssetIds] : [...entry.variantAssetIds].sort()]));
  const handle = deepFreeze({
    kitId: context.kit.kitId, revision: context.kit.revision,
    purpose: context.kit.purpose, bundleSha256: context.bundleSha256,
  });
  contexts.set(handle, context);
  return handle;
}

// Internal bridge; the public index only exports opaque handles and cloned documents.
export function contextFor(handle) {
  const context = handle && typeof handle === 'object' ? contexts.get(handle) : undefined;
  demand(context, 'KIT_HANDLE', 'scene.document.json', '/kitRef', 'Use a handle returned by loadSceneKit');
  return context;
}

export function readMap(handle, role = 'default') {
  const context = contextFor(handle);
  demand(['default', 'inspection'].includes(role), 'MAP_ROLE', 'scene.document.json', '/', 'Map role must be default or inspection');
  return clone(context.maps[role]);
}
