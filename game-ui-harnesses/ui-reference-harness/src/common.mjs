import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import path from 'node:path';

export const VERSION = '0.8.0';
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
// Reuse immutable evidence only within one synchronous validation traversal.
// Nothing survives a request, a mutation or an await; subsequent checks reread
// and rehash the files, so external tampering cannot hide behind a stale cache.
export function validationScope(operation) {
  if (validationCache) return operation();
  validationCache = new Map();
  try {
    const result = operation();
    requireThat(!result || typeof result.then !== 'function', 'VALIDATION_SCOPE_SYNC_REQUIRED');
    return result;
  } finally { validationCache = null; }
}
export function validationMemo(key, operation) {
  if (!validationCache) return operation();
  if (validationCache.has(key)) return validationCache.get(key);
  const value = operation(); validationCache.set(key, value); return value;
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
  const stat = fs.statSync(file);
  requireThat(stat.isFile() && stat.size <= max, 'FILE_SIZE_OR_TYPE');
  return fs.readFileSync(file);
}
export function readJson(file) {
  try { return JSON.parse(readBytes(file, 16 * 1024 * 1024).toString('utf8')); }
  catch { throw new Error('JSON_READ_FAILED'); }
}
// All core-owned paths are portable and reject links, including junctions.
export function local(root, relative) {
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
