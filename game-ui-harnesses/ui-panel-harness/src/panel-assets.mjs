import { snapshotJson, validatePanelSpec } from './spec.mjs';
import { canonicalJson, digestBytes } from './canonical.mjs';

const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const fail = code => { throw new Error(code); };
const exact = (v, keys) => {
  if (!v || Object.getPrototypeOf(v) !== Object.prototype || !same(Object.keys(v).sort(), [...keys].sort())) fail('PANEL_ASSET_FIELDS');
};
export const panelAssetPath = record => `textures/${record.sha256}.png`;
export function panelAssetKeys(spec) {
  return spec.assets ? [...new Set([spec.assets.panelSurface, ...spec.assets.rowIcons.map(x => x.asset)].filter(Boolean))].sort() : [];
}

/** Portable selection only. Library membership is checked by the filesystem loader at compile time. */
export function validatePanelAssetClosure(specInput, input) {
  const spec = validatePanelSpec(specInput);
  if (!spec.assets) { if (input !== undefined) fail('PANEL_ASSETS_UNEXPECTED'); return undefined; }
  const closure = snapshotJson(input);
  exact(closure, ['assetClosureVersion', 'library', 'records']);
  if (closure.assetClosureVersion !== '0.1' || !same(closure.library, spec.assets.library)) fail('PANEL_ASSET_LIBRARY_MISMATCH');
  const keys = panelAssetKeys(spec);
  if (!Array.isArray(closure.records) || !same(closure.records.map(r => r?.key), keys)) fail('PANEL_ASSET_SELECTION');
  const images = new Map();
  for (const r of closure.records) {
    exact(r, ['key', 'role', 'width', 'height', 'slice', 'sha256', 'bytes']);
    if (!['icon', 'shape', 'effect', 'layout-primitive', 'animation-part'].includes(r.role)
      || !/^[a-f0-9]{64}$(?![\s\S])/.test(r.sha256)
      || ![r.width, r.height].every(n => Number.isInteger(n) && n >= 1 && n <= 4096)
      || !Number.isInteger(r.bytes) || r.bytes < 45 || r.bytes > 1024 * 1024) fail('PANEL_ASSET_RECORD');
    if (r.slice !== null) {
      exact(r.slice, ['left', 'top', 'right', 'bottom']);
      if (!Object.values(r.slice).every(n => Number.isInteger(n) && n >= 0)
        || r.slice.left + r.slice.right >= r.width || r.slice.top + r.slice.bottom >= r.height) fail('PANEL_ASSET_SLICE');
    }
    const previous = images.get(r.sha256);
    if (previous && !same([previous.width, previous.height, previous.bytes], [r.width, r.height, r.bytes])) fail('PANEL_ASSET_FACTS');
    images.set(r.sha256, r);
  }
  const byKey = new Map(closure.records.map(r => [r.key, r]));
  if (spec.assets.panelSurface !== null) {
    const r = byKey.get(spec.assets.panelSurface);
    if (!['shape', 'layout-primitive'].includes(r.role) || r.slice === null) fail('PANEL_ASSET_SURFACE');
  }
  for (const icon of spec.assets.rowIcons) if (byKey.get(icon.asset).role !== 'icon') fail('PANEL_ASSET_ICON');
  if ([...images.values()].reduce((sum, r) => sum + r.bytes, 0) > 1024 * 1024) fail('PANEL_ASSET_TOTAL_LIMIT');
  return closure;
}

/** Copy and hash embedded bytes; restore never opens the original asset library. */
export async function validatePanelAssetInputs(spec, input) {
  if (!spec.assets) { if (input !== undefined) fail('PANEL_ASSETS_UNEXPECTED'); return { closure: undefined, resources: [] }; }
  if (!input || !Array.isArray(input.resources)) fail('PANEL_ASSETS_REQUIRED');
  const closure = validatePanelAssetClosure(spec, input.closure);
  if (input.resources.length > closure.records.length) fail('PANEL_ASSET_RESOURCES');
  // Take every byte snapshot before yielding to prevent mutation during hashing.
  const resources = input.resources.map(r => {
    if (!r || !(r.bytes instanceof Uint8Array) || r.bytes.byteLength > 1024 * 1024) fail('PANEL_ASSET_BYTES');
    return { path: r.path, mime: r.mime, bytes: new Uint8Array(r.bytes) };
  });
  const expected = new Map(closure.records.map(r => [panelAssetPath(r), r]));
  if (resources.length !== expected.size) fail('PANEL_ASSET_RESOURCES');
  for (const r of resources) {
    const record = expected.get(r.path); expected.delete(r.path);
    if (!record || r.mime !== 'image/png' || r.bytes.length !== record.bytes || await digestBytes(r.bytes) !== record.sha256) fail('PANEL_ASSET_BYTES');
    const data = r.bytes, view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (!same([...data.subarray(0, 8)], [137,80,78,71,13,10,26,10]) || view.getUint32(8) !== 13
      || String.fromCharCode(...data.subarray(12,16)) !== 'IHDR'
      || view.getUint32(16) !== record.width || view.getUint32(20) !== record.height) fail('PANEL_ASSET_PNG_HEADER');
  }
  resources.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { closure, resources };
}
