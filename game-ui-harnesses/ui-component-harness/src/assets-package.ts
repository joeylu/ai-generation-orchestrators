/** Consumer validator for the producer-owned assets-package-v2 contract. No alternate schema. */
import type { ImportedDecompositionLayer } from './decomposition-import.ts';
import type { ResourceInput } from './bundle.ts';
import { imageSize, validateReferenceMapping } from './reference-evidence.ts';
import { pngVisibleBounds } from './png-visible-bounds.ts';

type Row = Record<string, any>;
export interface AssetsPackageEvidence {
  readonly manifestSha256: string;
  readonly manifest: Row;
  readonly original: ResourceInput;
}
const check = (ok: unknown, code: string): void => { if (!ok) throw new Error(code); };
function exact(value: any, keys: string[], code = 'ASSETS_MANIFEST_FIELDS'): asserts value is Row {
  check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), code);
}
function hash(value: any): void { check(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'ASSETS_SHA256'); }
function text(value: any): void { check(typeof value === 'string' && value.trim().length > 0, 'ASSETS_TEXT'); }
function rectangle(value: any, width: number, height: number, integers = false): void {
  check(Array.isArray(value) && value.length === 4 && value.every((v: any) => typeof v === 'number' && Number.isFinite(v) && (!integers || Number.isSafeInteger(v))), 'ASSETS_RECTANGLE');
  const [x,y,w,h] = value; check(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= width && y + h <= height, 'ASSETS_RECTANGLE_BOUNDS');
}
async function digest(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer))].map(v => v.toString(16).padStart(2, '0')).join('');
}
/** Called before inventory construction; unknown kind/version never falls back to legacy. */
export function assetsOriginalPath(m: Row): string {
  check(m.kind === 'ai_ui_assets_package' && m.schemaVersion === '2.0', 'ASSETS_PACKAGE_VERSION');
  exact(m, ['kind','schemaVersion','files','scene','delivery','preview','reference','scope','previewPurpose','human_visual_acceptance','assets','stateRelations','missingParts','lineage']);
  exact(m.reference, ['original','mapping']);
  check(typeof m.reference.original === 'string' && /^reference\/original\.(png|jpe?g|webp|gif|bmp)$/i.test(m.reference.original), 'ASSETS_ORIGINAL_PATH');
  return m.reference.original;
}
function mediaType(bytes: Uint8Array): string {
  const ascii = (start: number, count: number) => String.fromCharCode(...bytes.subarray(start,start+count));
  if (bytes[0] === 137 && ascii(1,3) === 'PNG') return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216) return 'image/jpeg';
  if (ascii(0,6) === 'GIF87a' || ascii(0,6) === 'GIF89a') return 'image/gif';
  if (ascii(0,2) === 'BM') return 'image/bmp';
  if (ascii(0,4) === 'RIFF' && ascii(8,4) === 'WEBP') return 'image/webp';
  throw new Error('ASSETS_IMAGE_FORMAT');
}
export async function validateAssetsPackage(m: Row, manifestBytes: Uint8Array, members: ReadonlyMap<string,{bytes:Uint8Array}>, layers: readonly ImportedDecompositionLayer[], canvas: {width:number;height:number}): Promise<AssetsPackageEvidence> {
  const originalPath = assetsOriginalPath(m);
  check(canvas.width * canvas.height <= 16_777_216, 'ASSETS_CANVAS_LIMIT');
  check(m.scene === 'scene.json' && m.delivery === 'delivery.json' && m.preview === 'preview.png' && m.previewPurpose === 'decomposition-composite' && m.human_visual_acceptance === false, 'ASSETS_PACKAGE_PURPOSE');
  check(Array.isArray(m.files) && m.files.length === members.size - 1, 'ASSETS_FILES');
  const files = new Map<string, Row>();
  for (const row of m.files) {
    exact(row, ['path','sha256','bytes','mediaType', ...(row?.mediaType === 'application/json' ? [] : ['width','height'])], 'ASSETS_FILE_FIELDS');
    check(typeof row.path === 'string' && row.path !== 'manifest.json' && !files.has(row.path) && members.has(row.path), 'ASSETS_FILE_INVENTORY');
    hash(row.sha256); const bytes = members.get(row.path)!.bytes;
    check(Number.isSafeInteger(row.bytes) && row.bytes > 0 && row.bytes === bytes.length, 'ASSETS_FILE_SIZE');
    check(await digest(bytes) === row.sha256, 'ASSETS_FILE_DIGEST');
    if (row.path.endsWith('.json')) check(row.mediaType === 'application/json', 'ASSETS_FILE_MEDIA_TYPE');
    else {
      check(row.mediaType === mediaType(bytes), 'ASSETS_FILE_MEDIA_TYPE');
      const dimensions = imageSize(bytes);
      check(Number.isSafeInteger(row.width) && row.width > 0 && Number.isSafeInteger(row.height) && row.height > 0 && row.width * row.height <= 67_108_864 && dimensions[0] === row.width && dimensions[1] === row.height, 'ASSETS_IMAGE_SIZE');
      const extension = row.path.split('.').at(-1).toLowerCase();
      check(({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',bmp:'image/bmp'} as Row)[extension] === row.mediaType, 'ASSETS_IMAGE_EXTENSION');
    }
    files.set(row.path, row);
  }
  const original = files.get(originalPath)!;
  check(!!original, 'ASSETS_ORIGINAL_MISSING');
  validateReferenceMapping(m.reference.mapping, [original.width,original.height], canvas);
  exact(m.scope, ['type','description','base']); text(m.scope.description);
  check(['complete','supplemental'].includes(m.scope.type), 'ASSETS_SCOPE');
  if (m.scope.type === 'complete') check(m.scope.base === null, 'ASSETS_BASE');
  else { exact(m.scope.base,['zipSha256','manifestSha256']); hash(m.scope.base.zipSha256); hash(m.scope.base.manifestSha256); }
  check(Array.isArray(m.assets) && m.assets.length === layers.length, 'ASSETS_LAYER_COVERAGE');
  const ids = new Set<string>(), targets = new Set<string>();
  for (const row of m.assets) {
    exact(row,['layerId','assetId','path','visibleBounds','sourceRegions','bakedContent','relation']);
    const layer = layers.find(layer => layer.id === row.layerId);
    check(layer && !ids.has(row.layerId) && layer.asset === row.assetId && layer.path === row.path, 'ASSETS_LAYER_IDENTITY'); ids.add(row.layerId);
    rectangle(row.visibleBounds,layer!.width,layer!.height,true);
    check(JSON.stringify(await pngVisibleBounds(members.get(row.path)!.bytes,layer!.width,layer!.height)) === JSON.stringify(row.visibleBounds), 'ASSETS_VISIBLE_BOUNDS');
    if (row.sourceRegions !== null) { check(Array.isArray(row.sourceRegions) && row.sourceRegions.length > 0, 'ASSETS_SOURCE_REGIONS'); for (const r of row.sourceRegions) rectangle(r,original.width,original.height); }
    if (row.bakedContent !== null) { exact(row.bakedContent,['text','icons','parentBackground','evidence']); for (const k of ['text','icons','parentBackground']) check(typeof row.bakedContent[k] === 'string','ASSETS_BAKED_CONTENT'); text(row.bakedContent.evidence); }
    exact(row.relation,['action','targetLayerId']);
    check((m.scope.type === 'complete' ? ['included'] : ['add','replace','context']).includes(row.relation.action), 'ASSETS_RELATION');
    if (row.relation.action === 'replace') { check(typeof row.relation.targetLayerId === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(row.relation.targetLayerId) && !targets.has(row.relation.targetLayerId), 'ASSETS_REPLACEMENT'); targets.add(row.relation.targetLayerId); }
    else check(row.relation.targetLayerId === null, 'ASSETS_RELATION_TARGET');
  }
  check(Array.isArray(m.stateRelations) && Array.isArray(m.missingParts) && Array.isArray(m.lineage), 'ASSETS_OBSERVATIONS');
  for (const row of m.stateRelations) { exact(row,['layerIds','label','evidence']); check(Array.isArray(row.layerIds) && row.layerIds.length > 0 && new Set(row.layerIds).size === row.layerIds.length && row.layerIds.every((id: any) => ids.has(id)), 'ASSETS_STATE_LAYERS'); text(row.label); text(row.evidence); }
  for (const row of m.missingParts) { exact(row,['description','evidence']); text(row.description); text(row.evidence); }
  for (const row of m.lineage) { exact(row,['relation','zipSha256','manifestSha256']); check(['base','supplement'].includes(row.relation), 'ASSETS_LINEAGE'); hash(row.zipSha256); hash(row.manifestSha256); }
  return {manifestSha256:await digest(manifestBytes),manifest:m,original:{path:originalPath,mime:original.mediaType,bytes:new Uint8Array(members.get(originalPath)!.bytes)}};
}
