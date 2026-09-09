/**
 * Offline importer for the public `ai_ui_decomposition` PNG ZIP delivery.
 *
 * The upstream writer deliberately uses ZIP_STORED and may put ZIP64 sizes in
 * each local header (`force_zip64=True`).  This parser reads the central
 * directory as the authoritative index and accepts that local-header form. It
 * intentionally does not implement decompression: archives using any other
 * compression method are rejected before resource bytes are exposed.
 */
import type { ResourceInput } from './bundle.ts';

export const MAX_DECOMPOSITION_ARCHIVE_BYTES = 256 * 1024 * 1024;
export const MAX_DECOMPOSITION_ENTRY_BYTES = 256 * 1024 * 1024;
export const MAX_DECOMPOSITION_JSON_BYTES = 2 * 1024 * 1024;
export const MAX_DECOMPOSITION_LAYERS = 256;
export const MAX_DECOMPOSITION_IMAGE_PIXELS = 67_108_864;
export const MAX_DECOMPOSITION_LAYER_PIXELS = 33_554_432;

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const ZIP_EOCD = 0x06054b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_LOCAL = 0x04034b50;
const ZIP64_EXTRA = 0x0001;
const REQUIRED_DELIVERY_GAPS = [
  'automatic_component_importance_selection',
  'automatic_visual_acceptance',
  'photoshop_application_open_validation',
  'hidden_pixel_recovery',
] as const;
const QA_CRITERIA = ['layout_fidelity', 'component_coverage', 'text_policy', 'cutout_cleanliness'] as const;

export class DecompositionImportError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = 'DecompositionImportError';
    this.code = code;
  }
}

export interface ImportedDecompositionLayer {
  readonly id: string;
  readonly asset: string;
  readonly groupId: string;
  readonly path: string;
  readonly sha256: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly role: 'background' | 'important_component';
}

export interface ImportedAutomatedQa {
  readonly digest: string;
  readonly outcome: 'passed' | 'rejected' | 'unavailable';
  readonly referenceSha256: string;
  readonly overallScore?: number;
  readonly checks?: Readonly<Record<(typeof QA_CRITERIA)[number], number>>;
  readonly issues?: readonly Readonly<{ criterion: (typeof QA_CRITERIA)[number]; severity: 'blocker' | 'major' | 'minor'; asset: string | null }>[];
  readonly unavailableReason?: string;
}

export interface ImportedDecomposition {
  readonly archiveSha256: string;
  readonly sceneSha256: string;
  readonly deliveryDigest: string;
  readonly canvas: Readonly<{ width: number; height: number }>;
  readonly layers: readonly ImportedDecompositionLayer[];
  /** A convenience immutable view for consumers binding appearance evidence. */
  readonly scene: Readonly<{ canvas: Readonly<{ width: number; height: number }>; layers: readonly ImportedDecompositionLayer[] }>;
  /** Layer PNGs, in the scene's group and child order. The preview is separate. */
  readonly resources: readonly ResourceInput[];
  readonly preview: ResourceInput;
  readonly review: Readonly<{
    deliveryPolicy: 'reviewed' | 'unreviewed_draft';
    humanVisualAcceptance: boolean;
    automatedQa?: ImportedAutomatedQa;
  }>;
}

interface ZipMember { name: string; bytes: Uint8Array }
interface ParsedZip { readonly members: ReadonlyMap<string, ZipMember>; readonly names: readonly string[] }
interface ImportState {
  readonly archive: Uint8Array;
  readonly resourceDigests: readonly string[];
  readonly previewDigest: string;
}

const trustedImports = new WeakMap<object, ImportState>();

function fail(code: string): never { throw new DecompositionImportError(code); }
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exactObject(value: unknown, keys: readonly string[], code: string): Record<string, unknown> {
  if (!isObject(value)) fail(code);
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) fail(code);
  return value;
}
function hasExactStrings(value: unknown, expected: readonly string[], code: string): void {
  if (!Array.isArray(value) || value.length !== expected.length || value.some((item, index) => item !== expected[index])) fail(code);
}
function sha(value: unknown, code: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) fail(code);
  return value;
}
function integer(value: unknown, code: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) fail(code);
  return value;
}
function boolean(value: unknown, code: string): boolean {
  if (typeof value !== 'boolean') fail(code);
  return value;
}
function identifier(value: unknown, code: string): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(value)) fail(code);
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value)) fail(code);
  return value;
}
function size(value: unknown, code: string): readonly [number, number] {
  if (!Array.isArray(value) || value.length !== 2) fail(code);
  const width = integer(value[0], code, 1); const height = integer(value[1], code, 1);
  if (width * height > MAX_DECOMPOSITION_IMAGE_PIXELS) fail(code);
  return [width, height];
}
function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return false;
  return true;
}
function ascii(bytes: Uint8Array, code: string): string {
  let value = '';
  for (const byte of bytes) {
    if (byte < 0x21 || byte > 0x7e) fail(code);
    value += String.fromCharCode(byte);
  }
  return value;
}
function safeZipPath(value: string): void {
  if (value.startsWith('/') || value.includes('\\') || value.split('/').some(part => part.length === 0 || part === '.' || part === '..')) fail('ZIP_PATH_INVALID');
}
function u16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.length) fail('ZIP_TRUNCATED');
  return bytes[offset] | (bytes[offset + 1] << 8);
}
function u32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) fail('ZIP_TRUNCATED');
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] * 0x1000000)) >>> 0;
}
function be32(bytes: Uint8Array, offset: number, code: string): number {
  if (offset < 0 || offset + 4 > bytes.length) fail(code);
  return ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
}
function u64(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 8 > bytes.length) fail('ZIP_TRUNCATED');
  const low = BigInt(u32(bytes, offset)); const high = BigInt(u32(bytes, offset + 4));
  const value = low | (high << 32n);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) fail('ZIP64_VALUE_UNSUPPORTED');
  return Number(value);
}
function checkedEnd(start: number, count: number, maximum: number, code = 'ZIP_TRUNCATED'): number {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(count) || start < 0 || count < 0 || start > maximum - count) fail(code);
  return start + count;
}
function zip64Size(extra: Uint8Array, wantsUncompressed: boolean, wantsCompressed: boolean): readonly [number | undefined, number | undefined] {
  let offset = 0;
  while (offset < extra.length) {
    const tag = u16(extra, offset); const length = u16(extra, offset + 2); offset += 4;
    const end = checkedEnd(offset, length, extra.length, 'ZIP_EXTRA_INVALID');
    if (tag === ZIP64_EXTRA) {
      let cursor = offset; let uncompressed: number | undefined; let compressed: number | undefined;
      if (wantsUncompressed) { uncompressed = u64(extra, cursor); cursor += 8; }
      if (wantsCompressed) { compressed = u64(extra, cursor); cursor += 8; }
      return [uncompressed, compressed];
    }
    offset = end;
  }
  if (offset !== extra.length) fail('ZIP_EXTRA_INVALID');
  return [undefined, undefined];
}
function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function parseZip(source: Uint8Array): ParsedZip {
  if (!(source instanceof Uint8Array) || source.length < 22 || source.length > MAX_DECOMPOSITION_ARCHIVE_BYTES) fail('ZIP_SIZE_LIMIT');
  const copy = new Uint8Array(source);
  const searchStart = Math.max(0, copy.length - 0xffff - 22);
  let eocd = -1;
  for (let offset = copy.length - 22; offset >= searchStart; offset -= 1) {
    if (u32(copy, offset) === ZIP_EOCD && offset + 22 + u16(copy, offset + 20) === copy.length) { eocd = offset; break; }
  }
  if (eocd < 0) fail('ZIP_EOCD_REQUIRED');
  if (u16(copy, eocd + 20) !== 0) fail('ZIP_COMMENT_FORBIDDEN');
  if (u16(copy, eocd + 4) !== 0 || u16(copy, eocd + 6) !== 0) fail('ZIP_MULTIDISK_FORBIDDEN');
  const entriesOnDisk = u16(copy, eocd + 8); const entries = u16(copy, eocd + 10);
  const centralSize = u32(copy, eocd + 12); const centralOffset = u32(copy, eocd + 16);
  if (entries !== entriesOnDisk || entries === 0 || entries > MAX_DECOMPOSITION_LAYERS + 4) fail('ZIP_ENTRY_LIMIT');
  if (entries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) fail('ZIP64_CENTRAL_DIRECTORY_UNSUPPORTED');
  if (checkedEnd(centralOffset, centralSize, copy.length) !== eocd) fail('ZIP_CENTRAL_DIRECTORY_INVALID');

  const parsed: Array<{ name: string; localOffset: number; size: number; crc: number; flags: number; method: number; external: number }> = [];
  let offset = centralOffset;
  for (let index = 0; index < entries; index += 1) {
    if (u32(copy, offset) !== ZIP_CENTRAL) fail('ZIP_CENTRAL_DIRECTORY_INVALID');
    const flags = u16(copy, offset + 8); const method = u16(copy, offset + 10);
    const crc = u32(copy, offset + 16); const compressed = u32(copy, offset + 20); const uncompressed = u32(copy, offset + 24);
    const nameLength = u16(copy, offset + 28); const extraLength = u16(copy, offset + 30); const commentLength = u16(copy, offset + 32);
    const disk = u16(copy, offset + 34); const external = u32(copy, offset + 38); const localOffset = u32(copy, offset + 42);
    const fixedEnd = checkedEnd(offset, 46, centralOffset + centralSize, 'ZIP_CENTRAL_DIRECTORY_INVALID');
    const nameEnd = checkedEnd(fixedEnd, nameLength, centralOffset + centralSize, 'ZIP_CENTRAL_DIRECTORY_INVALID');
    const extraEnd = checkedEnd(nameEnd, extraLength, centralOffset + centralSize, 'ZIP_CENTRAL_DIRECTORY_INVALID');
    const end = checkedEnd(extraEnd, commentLength, centralOffset + centralSize, 'ZIP_CENTRAL_DIRECTORY_INVALID');
    if (flags !== 0 || method !== 0 || disk !== 0 || commentLength !== 0 || compressed !== uncompressed || uncompressed > MAX_DECOMPOSITION_ENTRY_BYTES) fail('ZIP_FEATURE_UNSUPPORTED');
    const host = u16(copy, offset + 4) >>> 8;
    const unixMode = external >>> 16;
    if ((external & 0x10) !== 0 || (host === 3 && (unixMode & 0xf000) !== 0x8000) || (unixMode & 0xf000) === 0xa000) fail('ZIP_SPECIAL_ENTRY_FORBIDDEN');
    const name = ascii(copy.subarray(fixedEnd, nameEnd), 'ZIP_PATH_INVALID');
    safeZipPath(name);
    parsed.push({ name, localOffset, size: uncompressed, crc, flags, method, external });
    offset = end;
  }
  if (offset !== centralOffset + centralSize) fail('ZIP_CENTRAL_DIRECTORY_INVALID');
  const seen = new Set<string>(); const portable = new Set<string>();
  let previousName = ''; let previousLocalEnd = 0; let total = 0;
  const members = new Map<string, ZipMember>();
  for (const entry of parsed) {
    if (entry.name <= previousName || seen.has(entry.name) || portable.has(entry.name.toLocaleLowerCase('en-US'))) fail('ZIP_DUPLICATE_OR_UNSORTED_ENTRY');
    seen.add(entry.name); portable.add(entry.name.toLocaleLowerCase('en-US')); previousName = entry.name;
    if (entry.localOffset !== previousLocalEnd || u32(copy, entry.localOffset) !== ZIP_LOCAL) fail('ZIP_LOCAL_HEADER_INVALID');
    const flags = u16(copy, entry.localOffset + 6); const method = u16(copy, entry.localOffset + 8);
    const crc = u32(copy, entry.localOffset + 14); const compressed = u32(copy, entry.localOffset + 18); const uncompressed = u32(copy, entry.localOffset + 22);
    const nameLength = u16(copy, entry.localOffset + 26); const extraLength = u16(copy, entry.localOffset + 28);
    const localNameStart = checkedEnd(entry.localOffset, 30, centralOffset, 'ZIP_LOCAL_HEADER_INVALID');
    const localNameEnd = checkedEnd(localNameStart, nameLength, centralOffset, 'ZIP_LOCAL_HEADER_INVALID');
    const localExtraEnd = checkedEnd(localNameEnd, extraLength, centralOffset, 'ZIP_LOCAL_HEADER_INVALID');
    if (flags !== entry.flags || method !== entry.method || crc !== entry.crc || !equalBytes(copy.subarray(localNameStart, localNameEnd), new TextEncoder().encode(entry.name))) fail('ZIP_LOCAL_HEADER_INVALID');
    const needsUncompressed = uncompressed === 0xffffffff; const needsCompressed = compressed === 0xffffffff;
    if ((uncompressed !== entry.size && !needsUncompressed) || (compressed !== entry.size && !needsCompressed)) fail('ZIP_LOCAL_HEADER_INVALID');
    if (needsUncompressed || needsCompressed) {
      const [zip64Uncompressed, zip64Compressed] = zip64Size(copy.subarray(localNameEnd, localExtraEnd), needsUncompressed, needsCompressed);
      if ((needsUncompressed && zip64Uncompressed !== entry.size) || (needsCompressed && zip64Compressed !== entry.size)) fail('ZIP_LOCAL_HEADER_INVALID');
    }
    const dataEnd = checkedEnd(localExtraEnd, entry.size, centralOffset, 'ZIP_LOCAL_HEADER_INVALID');
    if (crc32(copy.subarray(localExtraEnd, dataEnd)) !== entry.crc) fail('ZIP_CRC_MISMATCH');
    previousLocalEnd = dataEnd; total += entry.size;
    if (total > MAX_DECOMPOSITION_ARCHIVE_BYTES) fail('ZIP_UNCOMPRESSED_SIZE_LIMIT');
    members.set(entry.name, { name: entry.name, bytes: new Uint8Array(copy.subarray(localExtraEnd, dataEnd)) });
  }
  if (previousLocalEnd !== centralOffset) fail('ZIP_LOCAL_LAYOUT_INVALID');
  return { members, names: Object.freeze(parsed.map(entry => entry.name)) };
}

/** JSON.parse does not report duplicate object keys; upstream read_json does. */
class JsonReader {
  private index = 0;
  private depth = 0;
  private readonly text: string;
  constructor(text: string) { this.text = text; }
  read(): unknown { const value = this.value(); this.space(); if (this.index !== this.text.length) fail('JSON_INVALID'); return value; }
  private space(): void { while (this.index < this.text.length && /[ \n\r\t]/.test(this.text[this.index]!)) this.index += 1; }
  private value(): unknown {
    this.space(); const current = this.text[this.index];
    if (current === '{' || current === '[') {
      if (this.depth >= 64) fail('JSON_DEPTH_LIMIT'); this.depth += 1;
      try { return current === '{' ? this.object() : this.array(); } finally { this.depth -= 1; }
    }
    if (current === '"') return this.string();
    if (this.text.startsWith('true', this.index)) { this.index += 4; return true; }
    if (this.text.startsWith('false', this.index)) { this.index += 5; return false; }
    if (this.text.startsWith('null', this.index)) { this.index += 4; return null; }
    const match = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(this.text.slice(this.index));
    if (!match || match.index !== 0) fail('JSON_INVALID');
    this.index += match[0].length; const value = Number(match[0]); if (!Number.isFinite(value)) fail('JSON_NONFINITE_NUMBER'); return value;
  }
  private object(): Record<string, unknown> {
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>; const keys = new Set<string>(); this.index += 1; this.space();
    if (this.text[this.index] === '}') { this.index += 1; return result; }
    while (true) {
      this.space(); if (this.text[this.index] !== '"') fail('JSON_INVALID'); const key = this.string();
      if (keys.has(key)) fail('DUPLICATE_JSON_KEY'); keys.add(key); this.space(); if (this.text[this.index] !== ':') fail('JSON_INVALID'); this.index += 1;
      result[key] = this.value(); this.space(); const separator = this.text[this.index];
      if (separator === '}') { this.index += 1; return result; }
      if (separator !== ',') fail('JSON_INVALID'); this.index += 1;
    }
  }
  private array(): unknown[] {
    const result: unknown[] = []; this.index += 1; this.space(); if (this.text[this.index] === ']') { this.index += 1; return result; }
    while (true) {
      result.push(this.value()); this.space(); const separator = this.text[this.index];
      if (separator === ']') { this.index += 1; return result; }
      if (separator !== ',') fail('JSON_INVALID'); this.index += 1;
    }
  }
  private string(): string {
    const start = this.index; this.index += 1;
    while (this.index < this.text.length) {
      const code = this.text.charCodeAt(this.index);
      if (code < 0x20) fail('JSON_INVALID');
      if (this.text[this.index] === '"') { this.index += 1; try { return JSON.parse(this.text.slice(start, this.index)) as string; } catch { return fail('JSON_INVALID'); } }
      if (this.text[this.index] === '\\') { this.index += 1; const escape = this.text[this.index]; if (escape === undefined) fail('JSON_INVALID'); if (escape === 'u') this.index += 4; this.index += 1; }
      else this.index += 1;
    }
    return fail('JSON_INVALID');
  }
}

function readJson(member: ZipMember, code: string): Record<string, unknown> {
  if (member.bytes.length === 0 || member.bytes.length > MAX_DECOMPOSITION_JSON_BYTES) fail(code);
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(member.bytes); } catch { return fail(code); }
  const parsed = new JsonReader(text).read();
  if (!isObject(parsed)) fail(code);
  return parsed;
}
function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail('CANONICAL_JSON_INVALID'); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return fail('CANONICAL_JSON_INVALID');
}
async function sha256(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) fail('CRYPTO_UNAVAILABLE');
  const copy = new Uint8Array(bytes); const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
async function verifyDigest(bytes: Uint8Array, expected: string, code: string): Promise<void> {
  if (await sha256(bytes) !== expected) fail(code);
}
function png(bytes: Uint8Array, expected: readonly [number, number], code: string): void {
  if (bytes.length < 45 || !equalBytes(bytes.subarray(0, 8), PNG_SIGNATURE)) fail(code);
  let offset = 8; let first = true; let hasIdat = false; let ended = false;
  while (offset < bytes.length) {
    const length = be32(bytes, offset, code); const typeStart = checkedEnd(offset, 4, bytes.length, code); const payloadStart = checkedEnd(typeStart, 4, bytes.length, code);
    const payloadEnd = checkedEnd(payloadStart, length, bytes.length, code); const crcOffset = checkedEnd(payloadEnd, 4, bytes.length, code);
    const type = ascii(bytes.subarray(typeStart, payloadStart), code);
    if (crc32(bytes.subarray(typeStart, payloadEnd)) !== be32(bytes, payloadEnd, code)) fail(code);
    if (first) {
      first = false;
      if (type !== 'IHDR' || length !== 13) fail(code);
      const width = be32(bytes, payloadStart, code); const height = be32(bytes, payloadStart + 4, code);
      if (width !== expected[0] || height !== expected[1] || width === 0 || height === 0 || width * height > MAX_DECOMPOSITION_IMAGE_PIXELS
        || bytes[payloadStart + 8] !== 8 || bytes[payloadStart + 9] !== 6 || bytes[payloadStart + 10] !== 0 || bytes[payloadStart + 11] !== 0 || bytes[payloadStart + 12] !== 0) fail(code);
    } else if (type === 'IDAT') hasIdat = true;
    else if (type === 'IEND') { if (length !== 0 || ended || !hasIdat || crcOffset !== bytes.length) fail(code); ended = true; }
    else if (ended) fail(code);
    // The scene checksum binds bytes. Structural PNG checks avoid depending on a browser decoder.
    offset = crcOffset;
  }
  if (!ended) fail(code);
}
function publicResource(path: string, bytes: Uint8Array): ResourceInput {
  return Object.freeze({ path, mime: 'image/png', bytes: new Uint8Array(bytes) });
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !ArrayBuffer.isView(value) && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

interface ValidatedScene {
  readonly canvas: Readonly<{ width: number; height: number }>;
  readonly layers: readonly ImportedDecompositionLayer[];
  readonly planDigest: string;
  readonly materialsDigest: string;
  readonly previewSha256: string;
  readonly policy: 'reviewed' | 'unreviewed_draft';
  readonly reviewSha256: string | null;
}

function validateScene(value: unknown): ValidatedScene {
  const scene = exactObject(value, ['kind', 'canvas', 'tree', 'preview', 'preview_sha256', 'document', 'plan_digest', 'materials_digest', 'review_sha256', 'delivery_policy'], 'SCENE_FIELDS');
  if (scene.kind !== 'ai_ui_decomposition_scene_v1') fail('SCENE_KIND');
  const [width, height] = size(scene.canvas, 'SCENE_CANVAS');
  if (scene.preview !== 'preview.png') fail('SCENE_PREVIEW_PATH'); const previewSha256 = sha(scene.preview_sha256, 'SCENE_PREVIEW_SHA256');
  const document = exactObject(scene.document, ['name', 'format'], 'SCENE_DOCUMENT'); identifier(document.name, 'SCENE_DOCUMENT');
  if (document.format !== 'auto' && document.format !== 'psd' && document.format !== 'psb' && document.format !== 'png_zip') fail('SCENE_DOCUMENT');
  const planDigest = sha(scene.plan_digest, 'SCENE_PLAN_DIGEST'); const materialsDigest = sha(scene.materials_digest, 'SCENE_MATERIALS_DIGEST');
  if (scene.delivery_policy !== 'reviewed' && scene.delivery_policy !== 'unreviewed_draft') fail('SCENE_DELIVERY_POLICY');
  const policy = scene.delivery_policy;
  const reviewSha256 = scene.review_sha256 === null ? null : sha(scene.review_sha256, 'SCENE_REVIEW_SHA256');
  if ((policy === 'reviewed' && reviewSha256 === null) || (policy === 'unreviewed_draft' && reviewSha256 !== null)) fail('SCENE_REVIEW_POLICY');
  if (!Array.isArray(scene.tree) || scene.tree.length === 0 || scene.tree.length > MAX_DECOMPOSITION_LAYERS) fail('SCENE_TREE');
  const groupIds = new Set<string>(); const layerIds = new Set<string>(); const layers: ImportedDecompositionLayer[] = []; let pixels = 0; let backgrounds = 0;
  for (const [groupIndex, rawGroup] of scene.tree.entries()) {
    const group = exactObject(rawGroup, ['id', 'name', 'kind', 'children'], 'SCENE_GROUP_FIELDS');
    const groupId = identifier(group.id, 'SCENE_GROUP_ID');
    if (groupIds.has(groupId) || group.name !== groupId || group.kind !== 'group' || !Array.isArray(group.children) || group.children.length === 0) fail('SCENE_GROUP');
    groupIds.add(groupId);
    for (const [layerIndex, rawLayer] of group.children.entries()) {
      if (layers.length >= MAX_DECOMPOSITION_LAYERS) fail('SCENE_LAYER_LIMIT');
      const layer = exactObject(rawLayer, ['id', 'name', 'kind', 'role', 'asset', 'png', 'sha256', 'left', 'top', 'size', 'visible', 'opacity', 'blend_mode'], 'SCENE_LAYER_FIELDS');
      const id = identifier(layer.id, 'SCENE_LAYER_ID'); const asset = identifier(layer.asset, 'SCENE_ASSET_ID');
      if (layerIds.has(id) || layer.name !== id || layer.kind !== 'pixel' || layer.png !== `layers/${id}.png`) fail('SCENE_LAYER');
      if (layer.role !== 'background' && layer.role !== 'important_component') fail('SCENE_LAYER_ROLE');
      const left = integer(layer.left, 'SCENE_LAYER_POSITION'); const top = integer(layer.top, 'SCENE_LAYER_POSITION'); const [layerWidth, layerHeight] = size(layer.size, 'SCENE_LAYER_SIZE');
      if (left + layerWidth > width || top + layerHeight > height) fail('SCENE_LAYER_OUTSIDE_CANVAS');
      if (layer.visible !== true || layer.opacity !== 255 || layer.blend_mode !== 'normal') fail('SCENE_LAYER_RENDER_FIELDS');
      pixels += layerWidth * layerHeight; if (pixels > MAX_DECOMPOSITION_LAYER_PIXELS) fail('SCENE_LAYER_PIXEL_LIMIT');
      if (layer.role === 'background') { backgrounds += 1; if (left !== 0 || top !== 0 || layerWidth !== width || layerHeight !== height) fail('SCENE_BACKGROUND_POSITION'); }
      layerIds.add(id); layers.push(Object.freeze({ id, asset, groupId, path: layer.png as string, sha256: sha(layer.sha256, 'SCENE_LAYER_SHA256'), left, top, width: layerWidth, height: layerHeight, role: layer.role }));
      void groupIndex; void layerIndex;
    }
  }
  if (backgrounds !== 1) fail('SCENE_BACKGROUND_COUNT');
  return Object.freeze({ canvas: Object.freeze({ width, height }), layers: Object.freeze(layers), planDigest, materialsDigest, previewSha256, policy, reviewSha256 });
}

function validateDelivery(value: unknown, scene: ValidatedScene, sceneSha256: string): string {
  const delivery = exactObject(value, ['kind', 'status', 'delivery_policy', 'human_visual_acceptance', 'scene_sha256', 'plan_digest', 'batch_digest', 'materials_digest', 'pixel_layers', 'groups', 'preview_sha256', 'automatic_retries', 'automatic_semantic_inference', 'automatic_visual_acceptance', 'not_established', 'digest'], 'DELIVERY_FIELDS');
  const draft = delivery.kind === 'ai_ui_decomposition_draft_delivery_v1'; const reviewed = delivery.kind === 'ai_ui_decomposition_delivery_v1';
  if (!draft && !reviewed) fail('DELIVERY_KIND');
  sha(delivery.batch_digest, 'DELIVERY_BATCH_DIGEST');
  if (delivery.status !== (draft ? 'assembled_unreviewed_draft' : 'assembled_visual_review_bound') || delivery.delivery_policy !== scene.policy
    || boolean(delivery.human_visual_acceptance, 'DELIVERY_HUMAN_REVIEW') !== reviewed || sha(delivery.scene_sha256, 'DELIVERY_SCENE_SHA256') !== sceneSha256
    || sha(delivery.plan_digest, 'DELIVERY_PLAN_DIGEST') !== scene.planDigest || sha(delivery.materials_digest, 'DELIVERY_MATERIALS_DIGEST') !== scene.materialsDigest
    || integer(delivery.pixel_layers, 'DELIVERY_COUNTS') !== scene.layers.length
    || integer(delivery.groups, 'DELIVERY_COUNTS') <= 0 || integer(delivery.groups, 'DELIVERY_COUNTS') !== new Set(scene.layers.map(layer => layer.groupId)).size
    || sha(delivery.preview_sha256, 'DELIVERY_PREVIEW_SHA256') !== scene.previewSha256 || integer(delivery.automatic_retries, 'DELIVERY_RETRIES') !== 0
    || delivery.automatic_semantic_inference !== false || delivery.automatic_visual_acceptance !== false) fail('DELIVERY_BINDING');
  if ((draft && (scene.policy !== 'unreviewed_draft' || scene.reviewSha256 !== null)) || (reviewed && (scene.policy !== 'reviewed' || scene.reviewSha256 === null))) fail('DELIVERY_REVIEW_POLICY');
  hasExactStrings(delivery.not_established, REQUIRED_DELIVERY_GAPS, 'DELIVERY_NOT_ESTABLISHED');
  return sha(delivery.digest, 'DELIVERY_DIGEST');
}

function validateQa(value: unknown, scene: ValidatedScene, assets: ReadonlySet<string>): ImportedAutomatedQa {
  const qa = exactObject(value, ['kind', 'plan_digest', 'materials_digest', 'reference_sha256', 'preview_sha256', 'contact_sheet_sha256', 'policy', 'outcome', 'assessment', 'reason', 'automatic_retries', 'human_visual_acceptance', 'digest'], 'QA_FIELDS');
  if (qa.kind !== 'ai_ui_decomposition_automated_visual_qa_v1' || sha(qa.plan_digest, 'QA_PLAN_DIGEST') !== scene.planDigest || sha(qa.materials_digest, 'QA_MATERIALS_DIGEST') !== scene.materialsDigest || sha(qa.preview_sha256, 'QA_PREVIEW_SHA256') !== scene.previewSha256
    || integer(qa.automatic_retries, 'QA_RETRIES') !== 0 || qa.human_visual_acceptance !== false) fail('QA_BINDING');
  const referenceSha256 = sha(qa.reference_sha256, 'QA_REFERENCE_SHA256'); sha(qa.contact_sheet_sha256, 'QA_CONTACT_SHEET_SHA256');
  const policy = exactObject(qa.policy, ['minimum_overall_score', 'minimum_criterion_score', 'blocker_issues_allowed'], 'QA_POLICY');
  if (integer(policy.minimum_overall_score, 'QA_POLICY') !== 80 || integer(policy.minimum_criterion_score, 'QA_POLICY') !== 70 || integer(policy.blocker_issues_allowed, 'QA_POLICY') !== 0) fail('QA_POLICY');
  const digest = sha(qa.digest, 'QA_DIGEST');
  if (qa.outcome === 'unavailable') {
    if (qa.assessment !== null || typeof qa.reason !== 'string' || !qa.reason.match(/^[A-Z_]{1,80}$/)) fail('QA_UNAVAILABLE');
    return Object.freeze({ digest, outcome: 'unavailable', referenceSha256, unavailableReason: qa.reason });
  }
  if (qa.outcome !== 'passed' && qa.outcome !== 'rejected') fail('QA_OUTCOME');
  if (qa.reason !== null) fail('QA_REASON');
  const assessment = exactObject(qa.assessment, ['decision', 'passed', 'overall_score', 'checks', 'issues'], 'QA_ASSESSMENT');
  if (assessment.decision !== 'accept' && assessment.decision !== 'reject' || boolean(assessment.passed, 'QA_ASSESSMENT') !== (assessment.decision === 'accept')) fail('QA_ASSESSMENT');
  const overallScore = integer(assessment.overall_score, 'QA_SCORE'); if (overallScore > 100) fail('QA_SCORE');
  const checks = exactObject(assessment.checks, QA_CRITERIA, 'QA_CHECKS'); const safeChecks = {} as Record<(typeof QA_CRITERIA)[number], number>;
  for (const criterion of QA_CRITERIA) { const score = integer(checks[criterion], 'QA_SCORE'); if (score > 100) fail('QA_SCORE'); safeChecks[criterion] = score; }
  if (!Array.isArray(assessment.issues) || assessment.issues.length > 32) fail('QA_ISSUES');
  const issues: Array<{ criterion: (typeof QA_CRITERIA)[number]; severity: 'blocker' | 'major' | 'minor'; asset: string | null }> = [];
  for (const issue of assessment.issues) {
    const item = exactObject(issue, ['criterion', 'severity', 'asset'], 'QA_ISSUE');
    if (!QA_CRITERIA.includes(item.criterion as (typeof QA_CRITERIA)[number]) || (item.severity !== 'blocker' && item.severity !== 'major' && item.severity !== 'minor') || (item.asset !== null && (typeof item.asset !== 'string' || !assets.has(item.asset)))) fail('QA_ISSUE');
    issues.push(Object.freeze({ criterion: item.criterion as (typeof QA_CRITERIA)[number], severity: item.severity as 'blocker' | 'major' | 'minor', asset: item.asset as string | null }));
  }
  const passed = assessment.decision === 'accept';
  if ((qa.outcome === 'passed') !== passed || (passed && (overallScore < 80 || QA_CRITERIA.some(criterion => safeChecks[criterion] < 70) || issues.some(issue => issue.severity === 'blocker')))) fail('QA_OUTCOME');
  return Object.freeze({ digest, outcome: qa.outcome, referenceSha256, overallScore, checks: Object.freeze(safeChecks), issues: Object.freeze(issues) });
}

/**
 * Parse and authenticate one public PNG ZIP delivery without filesystem, DOM,
 * image decoding, provider, or network access. Only current ZIP_STORED public
 * exports are supported; compressed and ZIP64-central-directory inputs fail.
 */
export async function importDecompositionZip(input: Uint8Array): Promise<ImportedDecomposition> {
  if (!(input instanceof Uint8Array) || input.length > MAX_DECOMPOSITION_ARCHIVE_BYTES) fail('ZIP_SIZE_LIMIT');
  // Take the evidence copy before the first await so a caller cannot race a
  // mutable Uint8Array after parsing but before its archive digest is bound.
  const rawArchive = new Uint8Array(input);
  const archive = parseZip(rawArchive);
  const sceneMember = archive.members.get('scene.json'); const deliveryMember = archive.members.get('delivery.json'); const previewMember = archive.members.get('preview.png');
  if (!sceneMember || !deliveryMember || !previewMember) fail('ZIP_REQUIRED_MEMBER_MISSING');
  const sceneRaw = readJson(sceneMember, 'SCENE_JSON_INVALID'); const scene = validateScene(sceneRaw);
  const expected = new Set<string>(['scene.json', 'delivery.json', 'preview.png']);
  for (const layer of scene.layers) expected.add(layer.path);
  const qaMember = archive.members.get('automated-visual-qa.json'); if (qaMember) expected.add('automated-visual-qa.json');
  const names = [...expected].sort();
  if (archive.names.length !== names.length || archive.names.some((name, index) => name !== names[index])) fail('ZIP_INVENTORY_MISMATCH');
  const archiveSha256 = await sha256(rawArchive); const sceneSha256 = await sha256(sceneMember.bytes); await verifyDigest(sceneMember.bytes, sceneSha256, 'SCENE_SHA256');
  const deliveryRaw = readJson(deliveryMember, 'DELIVERY_JSON_INVALID'); const deliveryDigest = validateDelivery(deliveryRaw, scene, sceneSha256);
  const deliveryBody = { ...deliveryRaw }; delete deliveryBody.digest;
  if (await sha256(new TextEncoder().encode(canonicalJson(deliveryBody))) !== deliveryDigest) fail('DELIVERY_DIGEST');
  await verifyDigest(previewMember.bytes, scene.previewSha256, 'PREVIEW_CHECKSUM_MISMATCH'); png(previewMember.bytes, [scene.canvas.width, scene.canvas.height], 'PREVIEW_PNG_INVALID');
  const resources: ResourceInput[] = [];
  for (const layer of scene.layers) {
    const member = archive.members.get(layer.path); if (!member) fail('LAYER_MEMBER_MISSING');
    await verifyDigest(member.bytes, layer.sha256, 'LAYER_CHECKSUM_MISMATCH'); png(member.bytes, [layer.width, layer.height], 'LAYER_PNG_INVALID');
    resources.push(publicResource(layer.path, member.bytes));
  }
  const preview = publicResource('preview.png', previewMember.bytes);
  let automatedQa: ImportedAutomatedQa | undefined;
  if (qaMember) {
    const qaRaw = readJson(qaMember, 'QA_JSON_INVALID'); automatedQa = validateQa(qaRaw, scene, new Set(scene.layers.map(layer => layer.asset)));
    const qaBody = { ...qaRaw }; delete qaBody.digest;
    if (await sha256(new TextEncoder().encode(canonicalJson(qaBody))) !== automatedQa.digest) fail('QA_DIGEST');
  }
  const canvas = scene.canvas; const layers = scene.layers;
  const result: ImportedDecomposition = freeze({
    archiveSha256, sceneSha256, deliveryDigest, canvas, layers,
    scene: { canvas, layers }, resources, preview,
    review: { deliveryPolicy: scene.policy, humanVisualAcceptance: scene.policy === 'reviewed', ...(automatedQa ? { automatedQa } : {}) },
  });
  trustedImports.set(result, { archive: rawArchive, resourceDigests: layers.map(layer => layer.sha256), previewDigest: scene.previewSha256 });
  return result;
}

/**
 * Reject a fabricated typed object and rehash all exposed PNG byte arrays.
 * Call this before handing imported resources to another rendering/runtime
 * boundary; `Uint8Array` payloads cannot be made immutable by JavaScript.
 */
export async function assertValidImportedDecomposition(value: ImportedDecomposition): Promise<ImportedDecomposition> {
  const state = trustedImports.get(value as object); if (!state) fail('IMPORTED_DECOMPOSITION_NOT_VALIDATED');
  if (!Object.isFrozen(value) || await sha256(state.archive) !== value.archiveSha256 || value.resources.length !== state.resourceDigests.length) fail('IMPORTED_DECOMPOSITION_TAMPERED');
  for (const [index, resource] of value.resources.entries()) {
    if (await sha256(resource.bytes) !== state.resourceDigests[index]) fail('IMPORTED_RESOURCE_TAMPERED');
  }
  if (await sha256(value.preview.bytes) !== state.previewDigest) fail('IMPORTED_PREVIEW_TAMPERED');
  return value;
}
