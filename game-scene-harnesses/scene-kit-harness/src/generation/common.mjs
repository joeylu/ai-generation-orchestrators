import { createHash } from 'node:crypto';
import { canonicalJson, clone, deepFreeze } from '../document.mjs';
import { demand } from '../errors.mjs';
import { validateDocument } from '../schema.mjs';
import { inspectPng } from '../png.mjs';

export { clone, deepFreeze };
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const digest = value => hash(canonicalJson(value));
export const jsonBytes = value => Buffer.from(`${canonicalJson(value, true)}\n`);
export const isDigest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) && value.length === 64;
export const check = (condition, code, message = code) => demand(condition, code, 'workflow', '/', message);
export function exact(value, fields) {
  check(value && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value))
    && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key)), 'WORKFLOW_SHAPE');
}
export function id(value) { check(typeof value === 'string' && value.length <= 100 && /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value) && !/[\r\n]/.test(value), 'WORKFLOW_ID'); }
export function text(value, { empty = false, limit = 8000 } = {}) {
  check(typeof value === 'string' && value.length <= limit && (empty || value.trim().length > 0)
    && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value), 'WORKFLOW_TEXT');
  check(!/(?:https?:\/\/|[a-z]:[\\/]|\\\\[^\s]+|\/(?:home|Users)\/)/i.test(value), 'PRIVATE_OPERATIONAL_TEXT', 'Operational URLs and host paths do not belong in public task data');
}
export function contract(value) {
  const errors = validateDocument(value?.format, value);
  check(!errors.length, 'WORKFLOW_CONTRACT', errors[0] ? `${errors[0].code} at ${errors[0].path}` : 'Invalid workflow document');
}
export const seal = value => ({ ...clone(value), sha256: digest(value) });
export function unseal(value) {
  check(value && typeof value === 'object' && isDigest(value.sha256), 'RECORD_INTEGRITY');
  const { sha256, ...body } = value;
  check(digest(body) === sha256, 'RECORD_INTEGRITY'); return body;
}
export function imageRef(bytes, options = {}) {
  check(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= 16777216, 'IMAGE_BYTES');
  let image;
  try { image = inspectPng(Buffer.from(bytes), options); } catch { check(false, 'IMAGE_PNG_UNSUPPORTED'); }
  check(image.nonzeroAlphaPixels > 0, 'IMAGE_EMPTY');
  return { sha256: hash(bytes), byteLength: bytes.length, pixelSize: { width: image.width, height: image.height } };
}
export function verifyImage(store, ref, options = {}) {
  exact(ref, ['sha256', 'byteLength', 'pixelSize']);
  check(isDigest(ref.sha256), 'IMAGE_REFERENCE');
  const bytes = store.readBlob(ref.sha256);
  check(digest(imageRef(bytes, options)) === digest(ref), 'IMAGE_REFERENCE'); return bytes;
}
export function receipt(value, kind) {
  exact(value, ['decisionId', 'decision', 'targetSha256', 'notes']);
  id(value.decisionId); text(value.notes, { empty: true, limit: 2000 });
  check(isDigest(value.targetSha256), 'REVIEW_TARGET');
  check((kind === 'compute' ? ['approve-compute'] : ['accept', 'reject']).includes(value.decision), 'DECISION_INVALID');
}
