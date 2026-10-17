import Ajv from 'ajv';
import sliceSchema from '../../../schemas/slice-document.schema.json' with { type: 'json' };
import backgroundSchema from '../../../schemas/panel-background.schema.json' with { type: 'json' };
import { sides, measureSlices, sliceError } from './geometry.mjs';
import { validateSliceDocument } from './document.mjs';

// Portable editor assets are deliberately bounded separately from the PNG
// workbench. Original bytes are preserved, never resized to fit this budget.
export const maxBackgroundBytes = 8 * 1024 * 1024;
export const maxPanelJsonBytes = 12 * 1024 * 1024;
const ajv = new Ajv({ allErrors: true, strict: true }).addSchema(sliceSchema).addSchema(backgroundSchema);
const checkPackage = ajv.getSchema(backgroundSchema.$id);
const checkAsset = ajv.compile({ $ref: backgroundSchema.$id + '#/definitions/asset' });
export function backgroundGeometry(asset, size, multiplier = 1) {
  return {
    sourceWidth: asset.source.width / asset.density,
    sourceHeight: asset.source.height / asset.density,
    borders: Object.fromEntries(sides.map(k => [k, asset.bordersPx[k] / asset.density])),
    ...size, multiplier, resizePolicy: asset.resizePolicy,
  };
}
export function validateBackgroundAsset(asset) {
  if (!checkAsset(asset)) sliceError('background.schema', ajv.errorsText(checkAsset.errors));
  const value = asset.pngBase64;
  // Avoid a nested/repeated regex on multi-megabyte input.
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  if (value.length % 4 || /[^A-Za-z0-9+/]/.test(value.slice(0, value.length - padding)))
    sliceError('background.encoding', '背景 PNG 必须是有效的 Base64 原始字节。');
  const bytes = value.length / 4 * 3 - padding;
  if (bytes > maxBackgroundBytes) sliceError('background.size', '画布背景原图总计最多 8 MiB。');
  measureSlices(backgroundGeometry(asset, { width: asset.source.width / asset.density, height: asset.source.height / asset.density }));
  return bytes;
}
export function validateBackgroundPackage(input) {
  if (!checkPackage(input)) sliceError('background.package', ajv.errorsText(checkPackage.errors));
  validateBackgroundAsset(input.asset);
  return structuredClone(input);
}
export function encodePng(bytes) {
  const view = new Uint8Array(bytes);
  if (view.byteLength > maxBackgroundBytes) sliceError('background.size', '画布背景原图最多 8 MiB，请保留原图并选择更小的素材。');
  let binary = '';
  for (let i = 0; i < view.length; i += 32768) binary += String.fromCharCode(...view.subarray(i, i + 32768));
  return btoa(binary);
}
export function decodePng(base64) {
  const binary = atob(base64);
  if (btoa(binary) !== base64) sliceError('background.encoding', '背景 PNG 编码不规范。');
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
export async function createBackgroundPackage(doc, blob) {
  validateSliceDocument(doc);
  const { source, density, bordersPx, multiplier, resizePolicy } = doc;
  return validateBackgroundPackage({ kind: 'ui_panel_background', version: '1.0',
    asset: { source, density, bordersPx, ...(resizePolicy ? { resizePolicy } : {}), pngBase64: encodePng(await blob.arrayBuffer()) }, defaultMultiplier: multiplier });
}
