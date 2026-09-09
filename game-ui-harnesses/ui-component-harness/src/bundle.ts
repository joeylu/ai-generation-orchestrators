import { validateButton, type ButtonContract } from './contract.ts';
import { validateMotion, type MotionDocument } from './motion.ts';
import { validateMotionSystem, type MotionSystemDocument } from './motion-system.ts';
import { validateResourceReference, ResourceReferenceError } from './resource-reference.ts';
import { validateDocument, walkNodes, type UiDocument } from './tree-contract.ts';

/** These caps make imported browser bundles bounded before any bytes are used. */
export const MAX_BUNDLE_RESOURCES = 256;
export const MAX_BUNDLE_RESOURCE_BYTES = 16 * 1024 * 1024;
export const MAX_BUNDLE_TOTAL_BYTES = 64 * 1024 * 1024;

export interface ResourceInput {
  path: string;
  mime: string;
  bytes: Uint8Array;
}
export type ResourceInputCollection = ReadonlyArray<ResourceInput> | ReadonlyMap<string, ResourceInput>;
export interface BundleResource {
  id: string;
  path: string;
  mime: string;
  sha256: string;
  /** Canonical base64 is portable JSON; object URLs are never stored here. */
  base64: string;
}
export interface BundleProvenance {
  kind: 'programmatic-fixture' | 'user-provided' | 'vision-reviewed';
  description: string;
}
export interface UiBundle {
  bundleVersion: '0.1' | '0.2';
  document: ButtonContract | UiDocument;
  resources: BundleResource[];
  provenance: BundleProvenance;
  motion?: MotionDocument;
  motionSystem?: MotionSystemDocument;
}
export interface BundleIssue { path: string; code: string; message: string }
export class BundleError extends Error {
  readonly issues: BundleIssue[];
  constructor(issues: BundleIssue[]) {
    super(issues.map(issue => `${issue.path}: ${issue.message} [${issue.code}]`).join('\n'));
    this.name = 'BundleError';
    this.issues = issues;
  }
}

const verifiedBundles = new WeakSet<object>();
const MAX_RESOURCE_BASE64_LENGTH = Math.ceil(MAX_BUNDLE_RESOURCE_BYTES / 3) * 4;

function fail(path: string, code: string, message: string): never {
  throw new BundleError([{ path, code, message }]);
}
function record(value: unknown, path: string, keys: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'OBJECT_REQUIRED', '必须是对象');
  const data = value as Record<string, unknown>;
  for (const key of keys) if (!Object.hasOwn(data, key)) fail(`${path}.${key}`, 'REQUIRED', '缺少必需字段');
  for (const key of Object.keys(data)) if (!keys.includes(key) && !optional.includes(key)) fail(`${path}.${key}`, 'UNSUPPORTED_FIELD', '不支持此字段');
  return data;
}
function nonempty(value: unknown, path: string, code = 'NONEMPTY_STRING_REQUIRED'): string {
  if (typeof value !== 'string' || !value.trim() || value.trim() !== value) fail(path, code, '必须为非空且无首尾空白的字符串');
  return value;
}
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let start = 0; start < bytes.length; start += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(start, Math.min(bytes.length, start + chunkSize)));
  }
  return btoa(binary);
}
function isBase64Symbol(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 43 || code === 47;
}
function decodedBase64Length(base64: string, path: string): number {
  if (base64.length > MAX_RESOURCE_BASE64_LENGTH) fail(path, 'RESOURCE_SIZE_LIMIT', '资源字节大小超出限制');
  if (base64.length % 4 !== 0) fail(path, 'INVALID_BASE64', '资源字节不是规范 Base64');
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  for (let index = 0; index < base64.length - padding; index += 1) {
    if (!isBase64Symbol(base64.charCodeAt(index))) fail(path, 'INVALID_BASE64', '资源字节不是规范 Base64');
  }
  for (let index = base64.length - padding; index < base64.length; index += 1) {
    if (base64.charCodeAt(index) !== 61) fail(path, 'INVALID_BASE64', '资源字节不是规范 Base64');
  }
  const length = (base64.length / 4) * 3 - padding;
  if (length > MAX_BUNDLE_RESOURCE_BYTES) fail(path, 'RESOURCE_SIZE_LIMIT', '资源字节大小超出限制');
  return length;
}
function base64ToBytes(base64: string, path: string): Uint8Array {
  const expectedLength = decodedBase64Length(base64, path);
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    if (bytes.length !== expectedLength) fail(path, 'INVALID_BASE64', '资源字节长度无效');
    if (bytesToBase64(bytes) !== base64) fail(path, 'INVALID_BASE64', '资源字节不是规范 Base64');
    return bytes;
  } catch (error) {
    if (error instanceof BundleError) throw error;
    return fail(path, 'INVALID_BASE64', '资源字节不是有效 Base64');
  }
}
async function sha256(bytes: Uint8Array, path: string): Promise<string> {
  if (!globalThis.crypto?.subtle) fail(path, 'CRYPTO_UNAVAILABLE', '当前环境不支持 SHA-256 校验');
  const copied = new Uint8Array(bytes.length);
  copied.set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copied.buffer);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
function canonicalBundlePath(source: string, path: string): string {
  try { validateResourceReference(source, path, 'contract'); }
  catch (error) {
    if (error instanceof ResourceReferenceError) fail(path, error.code, error.message);
    throw error;
  }
  if (/^https?:\/\//i.test(source)) fail(path, 'EXTERNAL_RESOURCE_FORBIDDEN', '离线 bundle 不能引用网络资源');
  const canonical = source.startsWith('./') ? source.slice(2) : source;
  try { validateResourceReference(canonical, path, 'contract'); }
  catch (error) {
    if (error instanceof ResourceReferenceError) fail(path, error.code, error.message);
    throw error;
  }
  if (canonical.startsWith('./')) fail(path, 'NON_CANONICAL_PATH', 'bundle 资源路径不能以 ./ 开头');
  return canonical;
}
function validateMime(value: unknown, path: string): string {
  const mime = nonempty(value, path, 'MIME_REQUIRED');
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(mime)) fail(path, 'INVALID_MIME', 'MIME 必须为 type/subtype');
  return mime;
}
function validateProvenance(input: unknown): BundleProvenance {
  const data = record(input, '$.provenance', ['kind', 'description']);
  if (data.kind !== 'programmatic-fixture' && data.kind !== 'user-provided' && data.kind !== 'vision-reviewed') {
    fail('$.provenance.kind', 'UNSUPPORTED_PROVENANCE', '必须明确资源来源');
  }
  const description = nonempty(data.description, '$.provenance.description');
  if (description.length > 1000) fail('$.provenance.description', 'DESCRIPTION_TOO_LONG', '来源说明不能超过 1000 个字符');
  return { kind: data.kind as BundleProvenance['kind'], description };
}
function validateDocumentForBundle(input: unknown): ButtonContract | UiDocument {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('$.document', 'OBJECT_REQUIRED', '必须是对象');
  const source = input as Record<string, unknown>;
  // v0.1 has a top-level `type`; validateButton gives its familiar field errors.
  if (source.schemaVersion === '0.1') return validateButton(input);
  return validateDocument(input);
}
function requiredSources(document: ButtonContract | UiDocument): string[] {
  if (document.schemaVersion === '0.1') return [document.slots.visual.props.source];
  const sources: string[] = [];
  for (const node of walkNodes(document)) {
    const props = node.props as unknown as Record<string, unknown>;
    for (const field of ['source', 'fontSource', 'backgroundImage']) {
      const source = props[field];
      if (source !== undefined) {
        if (typeof source !== 'string') fail(`$.document.${node.id}.props.${field}`, 'SOURCE_REQUIRED', '资源引用必须为字符串');
        sources.push(source);
      }
    }
    if (node.type === 'Switch' && node.props.appearance) {
      sources.push(node.props.appearance.trackImage, node.props.appearance.thumbImage);
    }
    if (node.type === 'Button' && node.props.appearance) sources.push(node.props.appearance.backgroundImage);
    if (node.type === 'Select' && node.props.appearance) {
      sources.push(node.props.appearance.fieldImage, node.props.appearance.arrowImage, node.props.appearance.popupImage);
    }
    if (node.type === 'CheckBox' && node.props.appearance) sources.push(node.props.appearance.box.image, node.props.appearance.mark.image);
    if (node.type === 'RadioGroup' && node.props.appearance) for (const item of node.props.appearance.items) sources.push(item.option.image, item.indicator.image);
    if (node.type === 'Input' && node.props.appearance) sources.push(node.props.appearance.backgroundImage);
    if (node.type === 'ProgressBar' && node.props.appearance) sources.push(node.props.appearance.track.image, node.props.appearance.fill.image);
    if (node.type === 'Slider' && node.props.appearance) sources.push(node.props.appearance.track.image, node.props.appearance.fill.image, node.props.appearance.thumbImage);
    if (node.type === 'Container' && node.props.appearance) sources.push(node.props.appearance.background.image);
    if (node.type === 'Panel' && node.props.appearance) {
      sources.push(node.props.appearance.background.image, node.props.appearance.header.image);
      if (node.props.appearance.body) sources.push(node.props.appearance.body.image);
    }
  }
  return sources;
}
function assertResourceInput(value: unknown, path: string): ResourceInput {
  const data = record(value, path, ['path', 'mime', 'bytes']);
  const declaredPath = nonempty(data.path, `${path}.path`);
  if (declaredPath.startsWith('./')) fail(`${path}.path`, 'NON_CANONICAL_PATH', 'bundle 资源路径不能以 ./ 开头');
  const resourcePath = canonicalBundlePath(declaredPath, `${path}.path`);
  const mime = validateMime(data.mime, `${path}.mime`);
  if (!(data.bytes instanceof Uint8Array)) fail(`${path}.bytes`, 'BYTES_REQUIRED', '资源 bytes 必须为 Uint8Array');
  const bytes = new Uint8Array(data.bytes);
  if (bytes.length === 0 || bytes.length > MAX_BUNDLE_RESOURCE_BYTES) fail(`${path}.bytes`, 'RESOURCE_SIZE_LIMIT', '资源字节大小超出限制');
  return { path: resourcePath, mime, bytes };
}
function portablePathKey(path: string): string { return path.toLocaleLowerCase('en-US'); }
function inputResources(resources: ResourceInputCollection): ResourceInput[] {
  let entries: readonly ResourceInput[];
  if (resources instanceof Map) entries = [...resources.values()];
  else if (Array.isArray(resources)) entries = resources;
  else return fail('$.resources', 'RESOURCES_REQUIRED', '资源必须是数组或 Map');
  if (entries.length > MAX_BUNDLE_RESOURCES) fail('$.resources', 'RESOURCE_LIMIT', `资源数量不能超过 ${MAX_BUNDLE_RESOURCES}`);
  const paths = new Set<string>(); const portablePathKeys = new Set<string>(); let total = 0;
  const result = entries.map((entry, index) => {
    const resource = assertResourceInput(entry, `$.resources[${index}]`);
    if (paths.has(resource.path)) fail(`$.resources[${index}].path`, 'DUPLICATE_RESOURCE_PATH', '资源路径重复');
    if (portablePathKeys.has(portablePathKey(resource.path))) fail(`$.resources[${index}].path`, 'CASE_INSENSITIVE_PATH_COLLISION', '资源路径在不区分大小写的文件系统中冲突');
    paths.add(resource.path); portablePathKeys.add(portablePathKey(resource.path)); total += resource.bytes.length;
    if (total > MAX_BUNDLE_TOTAL_BYTES) fail('$.resources', 'TOTAL_SIZE_LIMIT', '资源总大小超出限制');
    return resource;
  });
  return result;
}
function assertEncodedBundleTotal(resources: unknown[]): void {
  let total = 0;
  for (const [index, value] of resources.entries()) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const base64 = (value as Record<string, unknown>).base64;
    if (typeof base64 !== 'string' || !base64.trim() || base64.trim() !== base64) continue;
    total += decodedBase64Length(base64, `$.resources[${index}].base64`);
    if (total > MAX_BUNDLE_TOTAL_BYTES) fail('$.resources', 'TOTAL_SIZE_LIMIT', '资源总大小超出限制');
  }
}
function assertRequiredSources(document: ButtonContract | UiDocument, paths: ReadonlySet<string>): void {
  for (const [index, source] of requiredSources(document).entries()) {
    const path = canonicalBundlePath(source, `$.document.resources[${index}]`);
    if (!paths.has(path)) fail(`$.document.resources[${index}]`, 'MISSING_RESOURCE', `bundle 缺少资源：${path}`);
  }
}
function sourceMapKey(resource: ResourceInput): string { return resource.path; }
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

/** Create a portable, verified JSON bundle. It performs no fetches or DOM IO. */
export async function createBundle(
  document: unknown,
  resources: ResourceInputCollection,
  provenance: BundleProvenance,
  motion?: unknown,
  motionSystem?: unknown,
): Promise<UiBundle> {
  const validatedDocument = validateDocumentForBundle(document);
  const inputs = inputResources(resources);
  assertRequiredSources(validatedDocument, new Set(inputs.map(sourceMapKey)));
  const output: UiBundle = {
    bundleVersion: motionSystem === undefined ? '0.1' : '0.2',
    document: validatedDocument,
    resources: await Promise.all(inputs.map(async resource => ({
      id: resource.path,
      path: resource.path,
      mime: resource.mime,
      base64: bytesToBase64(resource.bytes),
      sha256: await sha256(resource.bytes, `$.resources.${resource.path}`),
    }))),
    provenance: validateProvenance(provenance),
  };
  if (motion !== undefined) {
    if (validatedDocument.schemaVersion !== '0.2') fail('$.motion', 'MOTION_REQUIRES_V02', '动效只能附着在 v0.2 UI 文档');
    output.motion = validateMotion(motion, validatedDocument);
  }
  if (motionSystem !== undefined) {
    if (validatedDocument.schemaVersion !== '0.2') fail('$.motionSystem', 'MOTION_REQUIRES_V02', '动效体系只能附着在 v0.2 UI 文档');
    output.motionSystem = validateMotionSystem(motionSystem, validatedDocument);
  }
  return validateBundle(output);
}

/** Validate bytes, checksum, path safety, document and optional motion. */
export async function validateBundle(input: unknown): Promise<UiBundle> {
  const data = record(input, '$', ['bundleVersion', 'document', 'resources', 'provenance'], ['motion', 'motionSystem']);
  if (data.bundleVersion !== '0.1' && data.bundleVersion !== '0.2') fail('$.bundleVersion', 'UNSUPPORTED_VERSION', '仅支持 bundle 0.1 / 0.2');
  if (data.bundleVersion === '0.1' && Object.hasOwn(data, 'motionSystem')) fail('$.motionSystem', 'BUNDLE_VERSION_REQUIRED', '动效体系需要 bundle 0.2');
  if (data.bundleVersion === '0.2' && !Object.hasOwn(data, 'motionSystem')) fail('$.motionSystem', 'REQUIRED', 'bundle 0.2 必须包含动效体系');
  const document = validateDocumentForBundle(data.document);
  if (!Array.isArray(data.resources)) fail('$.resources', 'RESOURCES_REQUIRED', '资源必须是数组');
  if (data.resources.length > MAX_BUNDLE_RESOURCES) fail('$.resources', 'RESOURCE_LIMIT', `资源数量不能超过 ${MAX_BUNDLE_RESOURCES}`);
  assertEncodedBundleTotal(data.resources);
  const resources: BundleResource[] = [];
  const ids = new Set<string>(); const paths = new Set<string>(); const portablePathKeys = new Set<string>(); let total = 0;
  for (const [index, value] of data.resources.entries()) {
    const path = `$.resources[${index}]`;
    const resource = record(value, path, ['id', 'path', 'mime', 'sha256', 'base64']);
    const id = nonempty(resource.id, `${path}.id`, 'RESOURCE_ID_REQUIRED');
    if (ids.has(id)) fail(`${path}.id`, 'DUPLICATE_RESOURCE_ID', '资源 ID 重复');
    ids.add(id);
    const resourcePath = canonicalBundlePath(nonempty(resource.path, `${path}.path`), `${path}.path`);
    if (resourcePath !== resource.path) fail(`${path}.path`, 'NON_CANONICAL_PATH', 'bundle 资源路径必须是规范相对路径');
    if (paths.has(resourcePath)) fail(`${path}.path`, 'DUPLICATE_RESOURCE_PATH', '资源路径重复');
    if (portablePathKeys.has(portablePathKey(resourcePath))) fail(`${path}.path`, 'CASE_INSENSITIVE_PATH_COLLISION', '资源路径在不区分大小写的文件系统中冲突');
    paths.add(resourcePath); portablePathKeys.add(portablePathKey(resourcePath));
    const mime = validateMime(resource.mime, `${path}.mime`);
    if (typeof resource.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(resource.sha256)) fail(`${path}.sha256`, 'INVALID_SHA256', 'SHA-256 必须是 64 位小写十六进制');
    const sha256Value = resource.sha256;
    const base64 = nonempty(resource.base64, `${path}.base64`, 'BYTES_REQUIRED');
    const decodedLength = decodedBase64Length(base64, `${path}.base64`);
    if (decodedLength > MAX_BUNDLE_TOTAL_BYTES - total) fail('$.resources', 'TOTAL_SIZE_LIMIT', '资源总大小超出限制');
    const bytes = base64ToBytes(base64, `${path}.base64`);
    if (bytes.length === 0 || bytes.length > MAX_BUNDLE_RESOURCE_BYTES) fail(`${path}.base64`, 'RESOURCE_SIZE_LIMIT', '资源字节大小超出限制');
    total += bytes.length;
    if (total > MAX_BUNDLE_TOTAL_BYTES) fail('$.resources', 'TOTAL_SIZE_LIMIT', '资源总大小超出限制');
    if (await sha256(bytes, `${path}.base64`) !== sha256Value) fail(`${path}.sha256`, 'CHECKSUM_MISMATCH', '资源 SHA-256 与嵌入字节不一致');
    resources.push({ id, path: resourcePath, mime, sha256: sha256Value, base64: resource.base64 as string });
  }
  assertRequiredSources(document, paths);
  const output: UiBundle = { bundleVersion: data.bundleVersion, document, resources, provenance: validateProvenance(data.provenance) };
  if (Object.hasOwn(data, 'motion')) {
    if (document.schemaVersion !== '0.2') fail('$.motion', 'MOTION_REQUIRES_V02', '动效只能附着在 v0.2 UI 文档');
    output.motion = validateMotion(data.motion, document);
  }
  if (Object.hasOwn(data, 'motionSystem')) {
    if (document.schemaVersion !== '0.2') fail('$.motionSystem', 'MOTION_REQUIRES_V02', '动效体系只能附着在 v0.2 UI 文档');
    output.motionSystem = validateMotionSystem(data.motionSystem, document);
  }
  const verified = deepFreeze(output);
  verifiedBundles.add(verified);
  return verified;
}

/**
 * Materialize fresh, verified byte arrays. Call this only with the value
 * returned by createBundle or validateBundle; raw JSON must be validated first.
 */
export function bundleResources(bundle: UiBundle): ResourceInput[] {
  if (!verifiedBundles.has(bundle)) fail('$', 'BUNDLE_NOT_VALIDATED', '必须先通过 validateBundle 校验 bundle');
  return bundle.resources.map((resource, index) => ({
    path: resource.path,
    mime: resource.mime,
    bytes: base64ToBytes(resource.base64, `$.resources[${index}].base64`),
  }));
}
