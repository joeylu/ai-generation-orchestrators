import { createHash } from 'node:crypto';

const digest = text => createHash('sha256').update(text).digest('hex');
const object = value => value && typeof value === 'object' && !Array.isArray(value);

/** One lossless syntax correction; never fills fields or repairs semantic nodes. */
export function parseVisionJson(raw) {
  const text = raw.trim();
  try { return { value: JSON.parse(text), normalization: null }; } catch { /* Check the one documented wire defect. */ }
  let depth = 0, quoted = false, escaped = false, boundary = -1;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) { boundary = index; break; }
  }
  if (boundary < 0 || !/^\s*,\s*"policy"\s*:/.test(text.slice(boundary + 1))) throw new Error('VISION_ENVELOPE_INVALID');
  const prefix = JSON.parse(text.slice(0, boundary + 1));
  const keys = ['version', 'sourceSha256', 'status', 'summary', 'intent'];
  if (!object(prefix) || prefix.status !== 'Ready' || Object.keys(prefix).length !== keys.length || keys.some(key => !Object.hasOwn(prefix, key))) throw new Error('VISION_ENVELOPE_INVALID');
  const normalized = text.slice(0, boundary) + text.slice(boundary + 1);
  const value = JSON.parse(normalized);
  if (!object(value.policy) || Object.keys(value).length !== keys.length + 1 || keys.some(key => JSON.stringify(value[key]) !== JSON.stringify(prefix[key]))) throw new Error('VISION_ENVELOPE_INVALID');
  return { value, normalization: { kind: 'remove-premature-envelope-close', offset: boundary, rawSha256: digest(raw), normalizedSha256: digest(normalized) } };
}
