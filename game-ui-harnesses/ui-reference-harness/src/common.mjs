import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import path from 'node:path';
import { channel } from 'node:diagnostics_channel';

export const VERSION = '0.8.3';
export const requireThat = (condition, code) => { if (!condition) throw new Error(code); };
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const isDigest = value => typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/.test(value);
export const isId = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)
  && !/[\r\n]/.test(value)
  && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(value);
export function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  requireThat(value && Object.getPrototypeOf(value) === Object.prototype, 'JSON_REQUIRED');
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
export const jsonBytes = value => Buffer.from(canonical(value) + '\n');
export const digestJson = value => sha256(jsonBytes(value));
let validationCache = null;
const validationChannel = channel('ui-reference.validation');
export function validationEvent(type, dimensions = {}) {
  if (validationChannel.hasSubscribers) validationChannel.publish({ type, ...dimensions });
}
function dependency(key, matches) {
  for (const frame of validationCache?.frames ?? []) if (!frame.has(key)) frame.set(key, matches);
}
// A cache lives only for this synchronous traversal. Hits recheck exact source
// bytes and path safety, not timestamps; even same-size/mtime edits invalidate
// them. Nested memo dependencies propagate to their parents, including absences.
export function validationScope(operation) {
  const owner = !validationCache;
  if (owner) validationCache = { values: new Map(), frames: [] };
  try {
    const result = operation();
    requireThat(!result || typeof result.then !== 'function', 'VALIDATION_SCOPE_SYNC_REQUIRED');
    return result;
  } finally { if (owner) validationCache = null; }
}
export function validationMemo(key, operation) {
  if (!validationCache) return operation();
  const { values, frames } = validationCache, cached = values.get(key);
  if (cached && [...cached.dependencies.values()].every(matches => matches())) {
    for (const [name, matches] of cached.dependencies) dependency(name, matches);
    return cached.value;
  }
  values.delete(key);
  const dependencies = new Map(); frames.push(dependencies);
  try {
    const value = operation();
    requireThat(!value || typeof value.then !== 'function', 'VALIDATION_SCOPE_SYNC_REQUIRED');
    requireThat([...dependencies.values()].every(matches => matches()), 'VALIDATION_EVIDENCE_CHANGED');
    values.set(key, { value, dependencies }); return value;
  } finally { frames.pop(); }
}
export function fileExists(file) {
  const exists = fs.existsSync(file);
  dependency(`exists:${file}`, () => fs.existsSync(file) === exists);
  return exists;
}
export function readDirectory(directory) {
  const names = fs.readdirSync(directory).sort();
  dependency(`directory:${directory}`, () => canonical(fs.readdirSync(directory).sort()) === canonical(names));
  return names;
}
export function exact(value, required, optional = []) {
  requireThat(value && Object.getPrototypeOf(value) === Object.prototype, 'OBJECT_REQUIRED');
  requireThat(required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => [...required, ...optional].includes(key)), 'FIELDS_INVALID');
}
export function textValue(value, max = 8000, empty = false) {
  requireThat(typeof value === 'string' && value.length <= max && (empty || value.trim())
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), 'TEXT_INVALID');
  return value;
}
export function readBytes(file, max = 64 * 1024 * 1024) {
  const bytes = readFileBytes(file, max);
  if (validationCache?.frames.length) {
    const snapshot = Buffer.from(bytes);
    dependency(`bytes:${file}`, () => matchesFileBytes(file, max, snapshot));
  }
  return bytes;
}
function readFileBytes(file, max) {
  const stat = fs.statSync(file);
  requireThat(stat.isFile() && stat.size <= max, 'FILE_SIZE_OR_TYPE');
  return fs.readFileSync(file);
}
function matchesFileBytes(file, max, snapshot) {
  const stat = fs.statSync(file);
  requireThat(stat.isFile() && stat.size <= max, 'FILE_SIZE_OR_TYPE');
  if (stat.size !== snapshot.length) return false;
  // Still compare every byte on a hit. Reuse a bounded scratch buffer rather
  // than repeatedly allocating entire large PNGs while traversing dependencies.
  const scratch = validationCache.scratch ??= Buffer.allocUnsafe(1024 * 1024);
  const fd = fs.openSync(file, 'r');
  try {
    let offset = 0;
    while (offset < snapshot.length) {
      const length = Math.min(scratch.length, snapshot.length - offset);
      const read = fs.readSync(fd, scratch, 0, length, offset);
      if (read !== length || !scratch.subarray(0, read).equals(snapshot.subarray(offset, offset + read))) return false;
      offset += read;
    }
    return fs.readSync(fd, scratch, 0, 1, offset) === 0;
  } finally { fs.closeSync(fd); }
}
export function readJson(file) {
  try { return JSON.parse(readBytes(file, 16 * 1024 * 1024).toString('utf8')); }
  catch { throw new Error('JSON_READ_FAILED'); }
}
// All core-owned paths are portable and reject links, including junctions.
export function local(root, relative) {
  const file = resolveLocal(root, relative);
  dependency(`path:${file}`, () => resolveLocal(root, relative) === file);
  return file;
}
function resolveLocal(root, relative) {
  requireThat(typeof relative === 'string' && /^[A-Za-z0-9._/-]+$/.test(relative)
    && !/[^\x21-\x7e]/.test(relative)
    && relative.split('/').every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part)
      && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)), 'PATH_INVALID');
  const base = path.resolve(root);
  let ancestor = base;
  while (true) {
    requireThat(!fs.existsSync(ancestor) || !fs.lstatSync(ancestor).isSymbolicLink(), 'PATH_LINK');
    const parent = path.dirname(ancestor); if (parent === ancestor) break; ancestor = parent;
  }
  let cursor = base;
  for (const part of relative.split('/')) {
    cursor = path.join(cursor, part);
    requireThat(!fs.existsSync(cursor) || !fs.lstatSync(cursor).isSymbolicLink(), 'PATH_LINK');
  }
  return cursor;
}
export function writeNew(root, relative, bytes) {
  const file = local(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes, { flag: 'wx' });
}
export const writeJsonNew = (root, relative, value) => writeNew(root, relative, jsonBytes(value));
export function atomicJson(root, relative, value) {
  const temp = `${relative}.${randomUUID()}.tmp`;
  writeJsonNew(root, temp, value);
  fs.renameSync(local(root, temp), local(root, relative));
}
export function withLock(root, operation) {
  const lock = local(root, 'mutation.lock');
  let fd;
  try { fd = fs.openSync(lock, 'wx'); }
  catch { throw new Error('PROJECT_BUSY'); }
  const unlock = () => { fs.closeSync(fd); fs.unlinkSync(lock); };
  try {
    const result = operation();
    if (result && typeof result.then === 'function') return result.finally(unlock);
    unlock(); return result;
  } catch (error) { unlock(); throw error; }
}
export function storeBlob(root, bytes, extension) {
  requireThat(['png', 'json'].includes(extension), 'BLOB_TYPE');
  const digest = sha256(bytes), relative = `blobs/${digest}.${extension}`;
  const file = local(root, relative);
  if (fs.existsSync(file)) requireThat(sha256(readBytes(file)) === digest, 'BLOB_TAMPERED');
  else writeNew(root, relative, bytes);
  return { path: relative, sha256: digest, bytes: bytes.length };
}
export function verifyBlob(root, record) {
  return validationScope(() => Buffer.from(validationMemo(canonical(['blob', root, record]), () => verifyBlobEvidence(root, record))));
}
function verifyBlobEvidence(root, record) {
  exact(record, ['path', 'sha256', 'bytes']);
  requireThat(isDigest(record.sha256) && Number.isSafeInteger(record.bytes) && record.bytes > 0
    && record.path === `blobs/${record.sha256}.${record.path.endsWith('.png') ? 'png' : 'json'}`, 'BLOB_RECORD');
  const bytes = readBytes(local(root, record.path));
  requireThat(bytes.length === record.bytes && sha256(bytes) === record.sha256, 'BLOB_MISMATCH');
  return bytes;
}
export function seal(value) { return { ...value, sha256: digestJson(value) }; }
export function unseal(value) {
  const { sha256: digest, ...payload } = value;
  requireThat(isDigest(digest) && digestJson(payload) === digest, 'DIGEST_MISMATCH');
  return payload;
}
