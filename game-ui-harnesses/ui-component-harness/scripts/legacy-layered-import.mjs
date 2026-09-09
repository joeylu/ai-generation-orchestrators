/**
 * Node-only compatibility reader for one bounded, historical layered-export
 * pilot. This is deliberately separate from the current decomposition import:
 * it keeps the experimental identity and does not manufacture a current scene,
 * delivery receipt, or review decision.
 */
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

export const MAX_LEGACY_ARCHIVE_BYTES = 32 * 1024 * 1024;
export const MAX_LEGACY_TOTAL_BYTES = 32 * 1024 * 1024;
export const MAX_LEGACY_ENTRY_BYTES = 16 * 1024 * 1024;

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const EXPECTED_PATHS = [
  'file-roundtrip.json', 'layer-inputs.json',
  'layers/base_dropdown_still_baked_in.png', 'layers/cancel.png', 'layers/cancel_native.png',
  'layers/close.png', 'layers/close_native.png', 'layers/confirm.png', 'layers/confirm_native.png',
  'layers/music_toggle.png', 'layers/music_toggle_native.png', 'layers/quality_dropdown_native.png',
  'layers/sound_toggle.png', 'layers/sound_toggle_native.png', 'manifest.json',
  'native-assets-preview.png', 'native-assets.png', 'native-assets.psd', 'photoshop-checks.json', 'README.md',
  'settings-reconstruction-preview.png', 'settings-reconstruction.png', 'settings-reconstruction.psd',
].sort();
const EXPECTED_DOCUMENTS = {
  'native-assets': {
    preview: 'native-assets.png',
    layers: ['cancel_native', 'confirm_native', 'close_native', 'music_toggle_native', 'sound_toggle_native', 'quality_dropdown_native'],
  },
  'settings-reconstruction': {
    preview: 'settings-reconstruction.png',
    layers: ['base_dropdown_still_baked_in', 'cancel', 'confirm', 'close', 'music_toggle', 'sound_toggle'],
  },
};

export class LegacyLayeredImportError extends Error {
  constructor(code) { super(code); this.name = 'LegacyLayeredImportError'; this.code = code; }
}

const fail = code => { throw new LegacyLayeredImportError(code); };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const isObject = value => typeof value === 'object' && value !== null && !Array.isArray(value);
const exactObject = (value, keys, code) => {
  if (!isObject(value)) fail(code);
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) fail(code);
  return value;
};
const hash = (value, code) => { if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) fail(code); return value; };
const integer = (value, code, minimum = 0) => { if (!Number.isSafeInteger(value) || value < minimum) fail(code); return value; };
const safePath = value => {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.includes('\\') || value.split('/').some(part => !part || part === '.' || part === '..')) fail('LEGACY_ZIP_PATH_INVALID');
  if (!/^[A-Za-z0-9._/-]+$/.test(value)) fail('LEGACY_ZIP_PATH_INVALID');
  return value;
};
const u16 = (bytes, offset) => {
  if (offset < 0 || offset + 2 > bytes.length) fail('LEGACY_ZIP_TRUNCATED');
  return bytes[offset] | (bytes[offset + 1] << 8);
};
const u32 = (bytes, offset) => {
  if (offset < 0 || offset + 4 > bytes.length) fail('LEGACY_ZIP_TRUNCATED');
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] * 0x1000000)) >>> 0;
};
const be32 = (bytes, offset, code) => {
  if (offset < 0 || offset + 4 > bytes.length) fail(code);
  return ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
};
const end = (start, length, maximum, code = 'LEGACY_ZIP_TRUNCATED') => {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 0 || start > maximum - length) fail(code);
  return start + length;
};
const ascii = (bytes, code) => {
  let output = '';
  for (const byte of bytes) { if (byte < 0x21 || byte > 0x7e) fail(code); output += String.fromCharCode(byte); }
  return output;
};
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let index = 0; index < 8; index += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

/** A bounded parser for the legacy ZIP_STORED/deflate ZIP variant. */
function readZip(input) {
  if (!(input instanceof Uint8Array) || input.length < 22 || input.length > MAX_LEGACY_ARCHIVE_BYTES) fail('LEGACY_ZIP_SIZE_LIMIT');
  const bytes = new Uint8Array(input); const searchStart = Math.max(0, bytes.length - 0xffff - 22); let eocd = -1;
  for (let offset = bytes.length - 22; offset >= searchStart; offset -= 1) {
    if (u32(bytes, offset) === EOCD && offset + 22 + u16(bytes, offset + 20) === bytes.length) { eocd = offset; break; }
  }
  if (eocd < 0) fail('LEGACY_ZIP_EOCD_REQUIRED');
  if (u16(bytes, eocd + 20) !== 0 || u16(bytes, eocd + 4) !== 0 || u16(bytes, eocd + 6) !== 0) fail('LEGACY_ZIP_FEATURE_UNSUPPORTED');
  const onDisk = u16(bytes, eocd + 8); const count = u16(bytes, eocd + 10); const centralSize = u32(bytes, eocd + 12); const centralOffset = u32(bytes, eocd + 16);
  if (count !== onDisk || count !== EXPECTED_PATHS.length || count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff || end(centralOffset, centralSize, bytes.length) !== eocd) fail('LEGACY_ZIP_INVENTORY_INVALID');
  const entries = []; let offset = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (u32(bytes, offset) !== CENTRAL) fail('LEGACY_ZIP_CENTRAL_INVALID');
    const flags = u16(bytes, offset + 8); const method = u16(bytes, offset + 10); const crc = u32(bytes, offset + 16); const compressed = u32(bytes, offset + 20); const uncompressed = u32(bytes, offset + 24);
    const nameLength = u16(bytes, offset + 28); const extraLength = u16(bytes, offset + 30); const commentLength = u16(bytes, offset + 32); const disk = u16(bytes, offset + 34); const external = u32(bytes, offset + 38); const localOffset = u32(bytes, offset + 42);
    const fixedEnd = end(offset, 46, centralOffset + centralSize, 'LEGACY_ZIP_CENTRAL_INVALID'); const nameEnd = end(fixedEnd, nameLength, centralOffset + centralSize, 'LEGACY_ZIP_CENTRAL_INVALID'); const extraEnd = end(nameEnd, extraLength, centralOffset + centralSize, 'LEGACY_ZIP_CENTRAL_INVALID'); const next = end(extraEnd, commentLength, centralOffset + centralSize, 'LEGACY_ZIP_CENTRAL_INVALID');
    const host = u16(bytes, offset + 4) >>> 8; const unixMode = external >>> 16;
    if (flags !== 0 || (method !== 0 && method !== 8) || disk !== 0 || commentLength !== 0 || uncompressed > MAX_LEGACY_ENTRY_BYTES || (external & 0x10) !== 0 || (host === 3 && (unixMode & 0xf000) !== 0x8000) || (unixMode & 0xf000) === 0xa000) fail('LEGACY_ZIP_FEATURE_UNSUPPORTED');
    entries.push({ name: safePath(ascii(bytes.subarray(fixedEnd, nameEnd), 'LEGACY_ZIP_PATH_INVALID')), method, crc, compressed, uncompressed, localOffset });
    offset = next;
  }
  if (offset !== centralOffset + centralSize) fail('LEGACY_ZIP_CENTRAL_INVALID');
  const members = new Map(); let priorEnd = 0; let total = 0;
  for (const entry of entries) {
    if (members.has(entry.name)) fail('LEGACY_ZIP_DUPLICATE');
    if (entry.localOffset !== priorEnd || u32(bytes, entry.localOffset) !== LOCAL) fail('LEGACY_ZIP_LOCAL_INVALID');
    const flags = u16(bytes, entry.localOffset + 6); const method = u16(bytes, entry.localOffset + 8); const crc = u32(bytes, entry.localOffset + 14); const compressed = u32(bytes, entry.localOffset + 18); const uncompressed = u32(bytes, entry.localOffset + 22); const nameLength = u16(bytes, entry.localOffset + 26); const extraLength = u16(bytes, entry.localOffset + 28);
    const nameStart = end(entry.localOffset, 30, centralOffset, 'LEGACY_ZIP_LOCAL_INVALID'); const nameEnd = end(nameStart, nameLength, centralOffset, 'LEGACY_ZIP_LOCAL_INVALID'); const payloadStart = end(nameEnd, extraLength, centralOffset, 'LEGACY_ZIP_LOCAL_INVALID'); const payloadEnd = end(payloadStart, entry.compressed, centralOffset, 'LEGACY_ZIP_LOCAL_INVALID');
    if (flags !== 0 || method !== entry.method || crc !== entry.crc || compressed !== entry.compressed || uncompressed !== entry.uncompressed || ascii(bytes.subarray(nameStart, nameEnd), 'LEGACY_ZIP_PATH_INVALID') !== entry.name) fail('LEGACY_ZIP_LOCAL_INVALID');
    let decoded;
    try { decoded = entry.method === 0 ? new Uint8Array(bytes.subarray(payloadStart, payloadEnd)) : new Uint8Array(inflateRawSync(bytes.subarray(payloadStart, payloadEnd), { maxOutputLength: entry.uncompressed })); }
    catch { fail('LEGACY_ZIP_DEFLATE_INVALID'); }
    if (decoded.length !== entry.uncompressed || crc32(decoded) !== entry.crc) fail('LEGACY_ZIP_CRC_MISMATCH');
    total += decoded.length; if (total > MAX_LEGACY_TOTAL_BYTES) fail('LEGACY_ZIP_UNCOMPRESSED_LIMIT');
    members.set(entry.name, decoded); priorEnd = payloadEnd;
  }
  if (priorEnd !== centralOffset || members.size !== EXPECTED_PATHS.length || EXPECTED_PATHS.some(name => !members.has(name))) fail('LEGACY_ZIP_INVENTORY_INVALID');
  return { archive: bytes, members };
}

/** JSON.parse does not preserve the upstream rejection of duplicate keys. */
class JsonReader {
  constructor(text) { this.text = text; this.index = 0; this.depth = 0; }
  read() { const result = this.value(); this.space(); if (this.index !== this.text.length) fail('LEGACY_JSON_INVALID'); return result; }
  space() { while (this.index < this.text.length && /[ \t\r\n]/.test(this.text[this.index])) this.index += 1; }
  value() {
    this.space(); const current = this.text[this.index];
    if (current === '{' || current === '[') { if (this.depth >= 64) fail('LEGACY_JSON_DEPTH_LIMIT'); this.depth += 1; try { return current === '{' ? this.object() : this.array(); } finally { this.depth -= 1; } }
    if (current === '"') return this.string();
    if (this.text.startsWith('true', this.index)) { this.index += 4; return true; }
    if (this.text.startsWith('false', this.index)) { this.index += 5; return false; }
    if (this.text.startsWith('null', this.index)) { this.index += 4; return null; }
    const found = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(this.text.slice(this.index));
    if (!found || found.index !== 0) fail('LEGACY_JSON_INVALID'); this.index += found[0].length; const value = Number(found[0]); if (!Number.isFinite(value)) fail('LEGACY_JSON_NUMBER'); return value;
  }
  object() {
    const output = Object.create(null); const keys = new Set(); this.index += 1; this.space(); if (this.text[this.index] === '}') { this.index += 1; return output; }
    while (true) {
      this.space(); if (this.text[this.index] !== '"') fail('LEGACY_JSON_INVALID'); const key = this.string(); if (keys.has(key)) fail('LEGACY_JSON_DUPLICATE_KEY'); keys.add(key); this.space(); if (this.text[this.index] !== ':') fail('LEGACY_JSON_INVALID'); this.index += 1; output[key] = this.value(); this.space();
      if (this.text[this.index] === '}') { this.index += 1; return output; } if (this.text[this.index] !== ',') fail('LEGACY_JSON_INVALID'); this.index += 1;
    }
  }
  array() {
    const output = []; this.index += 1; this.space(); if (this.text[this.index] === ']') { this.index += 1; return output; }
    while (true) { output.push(this.value()); this.space(); if (this.text[this.index] === ']') { this.index += 1; return output; } if (this.text[this.index] !== ',') fail('LEGACY_JSON_INVALID'); this.index += 1; }
  }
  string() {
    const start = this.index; this.index += 1;
    while (this.index < this.text.length) {
      if (this.text.charCodeAt(this.index) < 0x20) fail('LEGACY_JSON_INVALID');
      if (this.text[this.index] === '"') { this.index += 1; try { return JSON.parse(this.text.slice(start, this.index)); } catch { fail('LEGACY_JSON_INVALID'); } }
      if (this.text[this.index] === '\\') { this.index += 1; const escape = this.text[this.index]; if (escape === undefined) fail('LEGACY_JSON_INVALID'); if (escape === 'u') this.index += 4; this.index += 1; } else this.index += 1;
    }
    fail('LEGACY_JSON_INVALID');
  }
}
function readJson(bytes, code) {
  if (!bytes || bytes.length === 0 || bytes.length > 2 * 1024 * 1024) fail(code);
  let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail(code); }
  const value = new JsonReader(text).read(); if (!isObject(value)) fail(code); return value;
}
function pngSize(bytes, code) {
  if (bytes.length < 45 || !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) fail(code);
  const length = be32(bytes, 8, code); if (length !== 13 || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') fail(code);
  const width = be32(bytes, 16, code); const height = be32(bytes, 20, code);
  if (!width || !height || width * height > 67_108_864 || bytes[24] !== 8 || bytes[25] !== 6 || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] !== 0 || crc32(bytes.subarray(12, 29)) !== be32(bytes, 29, code)) fail(code);
  return [width, height];
}
function resource(path, bytes) { return Object.freeze({ path, mime: 'image/png', bytes: new Uint8Array(bytes) }); }
function flattenTree(tree, output) {
  if (!Array.isArray(tree) || tree.length === 0) fail('LEGACY_TREE_INVALID');
  for (const item of tree) {
    if (!isObject(item) || typeof item.kind !== 'string') fail('LEGACY_TREE_INVALID');
    if (item.kind === 'group') { const group = exactObject(item, ['kind', 'name', 'children'], 'LEGACY_GROUP_FIELDS'); if (typeof group.name !== 'string' || !group.name || group.name !== group.name.trim()) fail('LEGACY_GROUP_FIELDS'); flattenTree(group.children, output); }
    else if (item.kind === 'pixel') output.push(item);
    else fail('LEGACY_TREE_INVALID');
  }
}
function validateManifest(manifest, members) {
  const value = exactObject(manifest, ['kind', 'status', 'format', 'fonts_recovered', 'new_generation', 'photoshop_version', 'files'], 'LEGACY_MANIFEST_FIELDS');
  if (value.kind !== 'experimental_ui_layered_export_delivery_v1' || value.status !== 'verified_pilot' || value.format !== 'psd' || value.fonts_recovered !== false || value.new_generation !== false || typeof value.photoshop_version !== 'string' || !/^\d+\.\d+\.\d+$/.test(value.photoshop_version) || !Array.isArray(value.files) || value.files.length !== EXPECTED_PATHS.length - 1) fail('LEGACY_MANIFEST_INVALID');
  const expected = new Set(EXPECTED_PATHS.filter(path => path !== 'manifest.json')); const seen = new Set();
  for (const [index, item] of value.files.entries()) {
    const row = exactObject(item, ['file', 'bytes', 'sha256'], 'LEGACY_MANIFEST_FILE'); const path = safePath(row.file);
    if (!expected.has(path) || seen.has(path) || integer(row.bytes, 'LEGACY_MANIFEST_FILE', 1) !== members.get(path)?.length || hash(row.sha256, 'LEGACY_MANIFEST_FILE') !== sha256(members.get(path))) fail('LEGACY_MANIFEST_FILE');
    seen.add(path);
  }
  if (seen.size !== expected.size) fail('LEGACY_MANIFEST_FILE');
  return Object.freeze({ kind: value.kind, status: value.status, format: value.format, fontsRecovered: value.fonts_recovered, newGeneration: value.new_generation, photoshopVersion: value.photoshop_version });
}

/** Import exactly the legacy r002 pilot archive and preserve its legacy facts. */
export function importLegacyLayeredZip(input) {
  const { archive, members } = readZip(input);
  const legacy = validateManifest(readJson(members.get('manifest.json'), 'LEGACY_MANIFEST_JSON'), members);
  const inputs = exactObject(readJson(members.get('layer-inputs.json'), 'LEGACY_INPUTS_JSON'), ['kind', 'status', 'no_new_generation', 'fonts_and_editable_text', 'program_sha256', 'environment', 'source_fingerprints', 'documents', 'validation_contract', 'limitations'], 'LEGACY_INPUTS_FIELDS');
  if (inputs.kind !== 'experimental_export_input_bundle_v1' || inputs.status !== 'inputs_prepared_not_exported' || inputs.no_new_generation !== true || inputs.fonts_and_editable_text !== false || !Array.isArray(inputs.documents) || inputs.documents.length !== 2 || !Array.isArray(inputs.source_fingerprints) || inputs.source_fingerprints.length === 0 || !Array.isArray(inputs.limitations) || inputs.limitations.length === 0) fail('LEGACY_INPUTS_INVALID');
  hash(inputs.program_sha256, 'LEGACY_INPUTS_INVALID');
  const environment = exactObject(inputs.environment, ['python', 'pillow', 'numpy'], 'LEGACY_INPUTS_ENVIRONMENT');
  if (![environment.python, environment.pillow, environment.numpy].every(value => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value))) fail('LEGACY_INPUTS_ENVIRONMENT');
  for (const fingerprint of inputs.source_fingerprints) { const item = exactObject(fingerprint, ['path', 'sha256'], 'LEGACY_SOURCE_FINGERPRINT'); safePath(item.path); hash(item.sha256, 'LEGACY_SOURCE_FINGERPRINT'); }
  const contract = exactObject(inputs.validation_contract, ['pixel_layer_roundtrip_max_error', 'merged_preview_max_channel_error', 'independent_opaque_preview_decoder', 'photoshop_open_check'], 'LEGACY_VALIDATION_CONTRACT');
  if (integer(contract.pixel_layer_roundtrip_max_error, 'LEGACY_VALIDATION_CONTRACT') !== 0 || integer(contract.merged_preview_max_channel_error, 'LEGACY_VALIDATION_CONTRACT') !== 1 || contract.independent_opaque_preview_decoder !== 'Pillow' || contract.photoshop_open_check !== 'not_run') fail('LEGACY_VALIDATION_CONTRACT');
  if (inputs.limitations.some(value => typeof value !== 'string' || !value.trim() || value !== value.trim())) fail('LEGACY_LIMITATIONS');

  const resources = []; const documents = []; const seenDocumentIds = new Set(); const seenResources = new Set();
  for (const rawDocument of inputs.documents) {
    const document = exactObject(rawDocument, ['id', 'size', 'format', 'order', 'tree', 'comparison_source', 'preview', 'preview_sha256', 'preview_rgba_sha256', 'matches_prior_pixels_exactly'], 'LEGACY_DOCUMENT_FIELDS');
    const expected = typeof document.id === 'string' && Object.hasOwn(EXPECTED_DOCUMENTS, document.id) ? EXPECTED_DOCUMENTS[document.id] : undefined; if (!expected || seenDocumentIds.has(document.id) || document.format !== 'psd' || document.order !== 'bottom_to_top' || typeof document.comparison_source !== 'string' || !document.comparison_source.trim() || document.matches_prior_pixels_exactly !== true) fail('LEGACY_DOCUMENT_INVALID');
    seenDocumentIds.add(document.id); const size = document.size; if (!Array.isArray(size) || size.length !== 2) fail('LEGACY_DOCUMENT_SIZE'); const width = integer(size[0], 'LEGACY_DOCUMENT_SIZE', 1); const height = integer(size[1], 'LEGACY_DOCUMENT_SIZE', 1); if (width * height > 67_108_864) fail('LEGACY_DOCUMENT_SIZE');
    if (document.preview !== expected.preview || !members.has(document.preview)) fail('LEGACY_PREVIEW_HASH'); hash(document.preview_rgba_sha256, 'LEGACY_PREVIEW_HASH');
    if (hash(document.preview_sha256, 'LEGACY_PREVIEW_HASH') !== sha256(members.get(document.preview))) fail('LEGACY_PREVIEW_HASH');
    const previewBytes = members.get(document.preview); const previewSize = pngSize(previewBytes, 'LEGACY_PREVIEW_PNG'); if (previewSize[0] !== width || previewSize[1] !== height) fail('LEGACY_PREVIEW_SIZE'); const preview = resource(document.preview, previewBytes); if (!seenResources.has(document.preview)) { seenResources.add(document.preview); resources.push(preview); }
    const pixels = []; flattenTree(document.tree, pixels); if (pixels.length !== expected.layers.length) fail('LEGACY_LAYER_COUNT'); const layers = [];
    for (const [index, rawLayer] of pixels.entries()) {
      const layer = exactObject(rawLayer, ['kind', 'name', 'png', 'sha256', 'rgba_sha256', 'size', 'left', 'top', 'visible', 'opacity', 'blend_mode', 'alpha'], 'LEGACY_LAYER_FIELDS');
      if (layer.name !== expected.layers[index] || layer.png !== `layers/${layer.name}.png` || layer.visible !== true || integer(layer.opacity, 'LEGACY_LAYER_FIELDS') !== 255 || layer.blend_mode !== 'normal') fail('LEGACY_LAYER_FIELDS');
      const layerBytes = members.get(layer.png); if (!layerBytes || hash(layer.sha256, 'LEGACY_LAYER_HASH') !== sha256(layerBytes)) fail('LEGACY_LAYER_HASH'); const layerSize = layer.size; if (!Array.isArray(layerSize) || layerSize.length !== 2) fail('LEGACY_LAYER_SIZE'); const layerWidth = integer(layerSize[0], 'LEGACY_LAYER_SIZE', 1); const layerHeight = integer(layerSize[1], 'LEGACY_LAYER_SIZE', 1); const left = integer(layer.left, 'LEGACY_LAYER_POSITION'); const top = integer(layer.top, 'LEGACY_LAYER_POSITION'); if (left + layerWidth > width || top + layerHeight > height) fail('LEGACY_LAYER_OUTSIDE_DOCUMENT'); const decodedSize = pngSize(layerBytes, 'LEGACY_LAYER_PNG'); if (decodedSize[0] !== layerWidth || decodedSize[1] !== layerHeight) fail('LEGACY_LAYER_SIZE');
      const alpha = exactObject(layer.alpha, ['transparent_pixels', 'soft_alpha_pixels', 'opaque_pixels', 'transparent_nonzero_rgb_pixels'], 'LEGACY_LAYER_ALPHA'); for (const value of Object.values(alpha)) integer(value, 'LEGACY_LAYER_ALPHA'); hash(layer.rgba_sha256, 'LEGACY_LAYER_HASH');
      const input = resource(layer.png, layerBytes); if (seenResources.has(layer.png)) fail('LEGACY_RESOURCE_DUPLICATE'); seenResources.add(layer.png); resources.push(input);
      layers.push(Object.freeze({ id: layer.name, path: layer.png, sha256: layer.sha256, rgbaSha256: layer.rgba_sha256, left, top, width: layerWidth, height: layerHeight, visible: layer.visible, opacity: layer.opacity, blendMode: layer.blend_mode, resource: input }));
    }
    documents.push(Object.freeze({ id: document.id, width, height, order: document.order, layers: Object.freeze(layers), preview }));
  }
  if (seenDocumentIds.size !== Object.keys(EXPECTED_DOCUMENTS).length || resources.length !== 14) fail('LEGACY_DOCUMENT_COVERAGE');
  return Object.freeze({ archiveSha256: sha256(archive), legacy, documents: Object.freeze(documents), resources: Object.freeze(resources) });
}
