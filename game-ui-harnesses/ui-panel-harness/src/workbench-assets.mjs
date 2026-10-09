import { canonicalJson, digestBytes, digestJson } from './canonical.mjs';
import { snapshotJson, validatePanelSpec } from './spec.mjs';
import { createAssetRetrieval } from './asset-retrieval.mjs';
import { validatePlanningContext } from './planning-context.mjs';
import { panelAssetKeys, validatePanelAssetInputs } from './panel-assets.mjs';

const MIB = 1024 * 1024;
const HASH = /^[a-f0-9]{64}$(?![\s\S])/;
const INDEX_FIELDS = ['assetLibraryVersion', 'id', 'parent', 'renderer', 'records', 'summary', 'changes', 'verification', 'sha256'];
const RECORD_FIELDS = ['key', 'namespace', 'metadata', 'source', 'file', 'image', 'revision', 'preview'];
const validated = new WeakSet();
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const poolFail = suffix => fail(`WORKBENCH_ASSET_${suffix}`);

// Inspect descriptors before reading data. The index is deliberately copied per
// record: a legitimate full index can exceed snapshotJson's 20,000-node budget.
function fields(value, array = false) {
  if (!value || Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) poolFail('JSON');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key];
    if (typeof key !== 'string' || !Object.hasOwn(descriptor, 'value')
      || (!(array && key === 'length') && !descriptor.enumerable)) poolFail('JSON');
  }
  return descriptors;
}
function exactFields(value, names) {
  const descriptors = fields(value);
  if (!same(Object.keys(descriptors).sort(), [...names].sort())) poolFail('FIELDS');
  return descriptors;
}
function items(value, minimum = 0) {
  const descriptors = fields(value, true), length = descriptors.length.value;
  if (length < minimum || length > 512 || Object.keys(descriptors).length !== length + 1) poolFail('COUNT_LIMIT');
  const result = [];
  for (let i = 0; i < length; i++) {
    if (!Object.hasOwn(descriptors, String(i))) poolFail('JSON');
    result.push(descriptors[String(i)].value);
  }
  return result;
}
function json(value) {
  try { return snapshotJson(value); } catch { poolFail('JSON'); }
}
function snapshotIndex(input) {
  const descriptors = exactFields(input, INDEX_FIELDS);
  const records = items(descriptors.records.value, 1);
  let budget = 4 * MIB;
  const part = value => {
    const result = json(value);
    const text = canonicalJson(result);
    if (text.length > budget) poolFail('INDEX_LIMIT');
    budget -= new TextEncoder().encode(text).length;
    if (budget < 0) poolFail('INDEX_LIMIT');
    return result;
  };
  const index = Object.fromEntries(INDEX_FIELDS.map(key => [key, key === 'records' ? records.map(part) : part(descriptors[key].value)]));
  if (new TextEncoder().encode(canonicalJson(index)).length > 4 * MIB) poolFail('INDEX_LIMIT');
  if (index.assetLibraryVersion !== '0.1' || typeof index.sha256 !== 'string' || !HASH.test(index.sha256)) poolFail('INDEX');
  // This validates every record's normalized metadata and identity, even when
  // the word 'pool' returns no retrieval candidates.
  createAssetRetrieval('pool', index);
  const expected = new Map();
  let previous = '';
  for (const record of index.records) {
    exactFields(record, RECORD_FIELDS);
    if (record.key <= previous) poolFail('RECORD_ORDER');
    previous = record.key;
    exactFields(record.file, ['path', 'sha256', 'bytes']);
    const file = record.file, size = record.metadata.size;
    if (file.path !== `textures/${file.sha256}.png` || !Number.isSafeInteger(file.bytes)
      || file.bytes < 45 || file.bytes > MIB) poolFail('FILE');
    if (!record.image || record.image.width !== size.width || record.image.height !== size.height) poolFail('DIMENSIONS');
    const facts = { sha256: file.sha256, bytes: file.bytes, width: size.width, height: size.height };
    if (expected.has(file.path) && !same(expected.get(file.path), facts)) poolFail('FILE_FACTS');
    expected.set(file.path, facts);
  }
  if ([...expected.values()].reduce((sum, file) => sum + file.bytes, 0) > 16 * MIB) poolFail('TOTAL_LIMIT');
  return { index, expected };
}
function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
function fromBase64(value) {
  if (typeof value !== 'string' || value.length < 60 || value.length > Math.ceil(MIB / 3) * 4
    || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$(?![\s\S])/.test(value)) poolFail('BASE64');
  let binary;
  try { binary = atob(value); } catch { poolFail('BASE64'); }
  if (binary.length > MIB || btoa(binary) !== value) poolFail('BASE64');
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
function snapshotResources(input, encoded) {
  let total = 0;
  const resources = items(input).map(value => {
    const d = exactFields(value, ['path', 'mime', encoded ? 'base64' : 'bytes']);
    const path = d.path.value, mime = d.mime.value;
    if (typeof path !== 'string' || !/^textures\/[a-f0-9]{64}\.png$(?![\s\S])/.test(path) || mime !== 'image/png') poolFail('RESOURCE');
    let bytes;
    if (encoded) bytes = fromBase64(d.base64.value);
    else {
      if (!(d.bytes.value instanceof Uint8Array) || d.bytes.value.byteLength < 45 || d.bytes.value.byteLength > MIB) poolFail('BYTES');
      bytes = new Uint8Array(d.bytes.value);
    }
    total += bytes.length;
    if (total > 16 * MIB) poolFail('TOTAL_LIMIT');
    return { path, mime, base64: encoded ? d.base64.value : toBase64(bytes), bytes };
  });
  if (!encoded) resources.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  for (let i = 1; i < resources.length; i++) if (resources[i - 1].path >= resources[i].path) poolFail('RESOURCE_ORDER');
  return resources;
}
function freeze(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function requirePool(pool) {
  if (!validated.has(pool)) poolFail('VALIDATION_REQUIRED');
  return pool;
}
async function finish(snapshot, resources, providedHash) {
  const { index, expected } = snapshot;
  const { sha256: indexHash, ...indexPayload } = index;
  if (await digestJson(indexPayload) !== indexHash) poolFail('INDEX_DIGEST');
  if (resources.length !== expected.size) poolFail('RESOURCE_SET');
  for (const resource of resources) {
    const file = expected.get(resource.path);
    if (!file) poolFail('RESOURCE_SET');
    if (resource.bytes.length !== file.bytes || await digestBytes(resource.bytes) !== file.sha256) poolFail('PNG_DIGEST');
    const bytes = resource.bytes, view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (!same([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]) || view.getUint32(8) !== 13
      || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR'
      || view.getUint32(16) !== file.width || view.getUint32(20) !== file.height) poolFail('PNG_HEADER');
  }
  const payload = { workbenchAssetPoolVersion: '0.1', index,
    resources: resources.map(({ path, mime, base64 }) => ({ path, mime, base64 })) };
  const sha256 = await digestJson(payload);
  if (providedHash !== undefined && providedHash !== sha256) poolFail('DIGEST');
  const pool = freeze({ ...payload, sha256 });
  validated.add(pool);
  return pool;
}

/** Package a complete PNG pool. The Node builder first replays verifyAssetLibrary
 * or authenticates the exact previously verified bundled release.
 * Source, renderer, alpha and preview evidence is retained, not replayed here. */
export async function createWorkbenchAssetPool(index, resources) {
  const snapshot = snapshotIndex(index), copiedResources = snapshotResources(resources, false);
  return finish(snapshot, copiedResources);
}

/** Browser checks cover complete index identity and embedded PNG hashes/headers.
 * They do not decode images or repeat SVG/Sharp source rendering. */
export async function validateWorkbenchAssetPool(input) {
  const d = exactFields(input, ['workbenchAssetPoolVersion', 'index', 'resources', 'sha256']);
  if (d.workbenchAssetPoolVersion.value !== '0.1' || typeof d.sha256.value !== 'string' || !HASH.test(d.sha256.value)) poolFail('VERSION');
  const snapshot = snapshotIndex(d.index.value), resources = snapshotResources(d.resources.value, true);
  return finish(snapshot, resources, d.sha256.value);
}

export function workbenchRetrieval(requestText, pool, options = { style: null }) {
  requirePool(pool);
  return createAssetRetrieval(requestText, pool.index, options);
}

/** Select exact versions from the full pool; retain the stricter 1 MiB panel gate. */
export async function workbenchAssetInputs(specInput, pool) {
  requirePool(pool);
  const spec = validatePanelSpec(specInput);
  if (!spec.assets) return undefined;
  if (!same(spec.assets.library, { id: pool.index.id, sha256: pool.index.sha256 })) fail('PANEL_ASSET_LIBRARY_MISMATCH');
  const byKey = new Map(pool.index.records.map(record => [record.key, record]));
  const records = panelAssetKeys(spec).map(key => {
    const record = byKey.get(key);
    if (!record) fail('PANEL_ASSET_SELECTION');
    return { key, role: record.metadata.role, width: record.metadata.size.width, height: record.metadata.size.height,
      slice: record.metadata.slice, sha256: record.file.sha256, bytes: record.file.bytes };
  });
  const paths = new Set(records.map(record => `textures/${record.sha256}.png`));
  const resources = pool.resources.filter(resource => paths.has(resource.path))
    .map(resource => ({ path: resource.path, mime: resource.mime, bytes: fromBase64(resource.base64) }));
  return validatePanelAssetInputs(spec, { closure: { assetClosureVersion: '0.1', library: spec.assets.library, records }, resources });
}

/** Recompute candidates against every pool record. No Node build-verification
 * receipt is produced: this returns the matching portable retrieval only. */
export async function verifyWorkbenchContextPool(contextInput, pool) {
  requirePool(pool);
  const context = await validatePlanningContext(contextInput);
  if (!context.assetRetrieval) fail('PLAN_ASSET_CONTEXT_REQUIRED');
  const retrieval = workbenchRetrieval(context.request.text, pool, { style: context.assetRetrieval.policy.style });
  if (!same(retrieval, context.assetRetrieval)) fail('PLAN_ASSET_RETRIEVAL_MISMATCH');
  return retrieval;
}
