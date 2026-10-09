import { snapshotJson } from './spec.mjs';
import { assetKey, validateAssetBatch } from './asset-descriptor.mjs';
import { canonicalJson } from './canonical.mjs';

const SLUG = /^[a-z][a-z0-9-]{0,63}$(?![\s\S])/;
const SYMBOL = /^[a-z0-9.-]{1,96}$(?![\s\S])/;
const HASH = /^[a-f0-9]{64}$(?![\s\S])/;
const LATIN_WORD = /[\p{Script=Latin}\p{N}\p{M}_]/u;
// Role/file labels describe the catalog, not the purpose of an asset.
const GENERIC_TERMS = new Set([
  '图标', 'icon', 'icons', '图片', 'image', 'images', '素材', 'asset', 'assets',
  '纹理', 'texture', 'textures', 'ui', 'png', 'svg', 'default', 'shape', 'shapes',
  'effect', 'effects', 'layout-primitive', 'animation-part', '样式', 'style',
]);
// These can refine a semantic match but cannot introduce an unrelated asset.
const APPEARANCE_TERMS = new Set(['filled', 'outline', 'outlined', 'solid', '描边', '填充', '空心', '实心', '线框']);
const ASSET_FIELDS = ['key', 'name', 'role', 'family', 'style', 'variant', 'tags', 'size', 'slice', 'sha256', 'bytes'];
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const normalize = text => text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();

export class AssetRetrievalError extends Error {
  constructor(code, path, message) {
    super(`${code} ${path}: ${message}`);
    this.name = 'AssetRetrievalError'; this.code = code; this.path = path;
  }
}
const fail = (code, path, message) => { throw new AssetRetrievalError(`ASSET_RETRIEVAL_${code}`, path, message); };
function snapshot(value) {
  try { return snapshotJson(value); }
  catch (error) { fail('JSON', error.path ?? '$', 'expected bounded plain JSON data'); }
}
function exact(value, required, optional, path) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) fail('FIELDS', path, 'expected a plain object');
  if (Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))
    || required.some(key => !Object.hasOwn(value, key))) fail('FIELDS', path, 'missing or unknown field');
}
function request(text) {
  if (typeof text !== 'string' || !text.trim() || [...text].length > 8000
    || /[\p{Cc}\p{Cs}]/u.test(text.replace(/[\r\n\t]/gu, ''))) {
    fail('REQUEST', '$.requestText', 'expected nonempty prose of at most 8000 Unicode characters; only newline and tab controls are allowed');
  }
  return normalize(text);
}
function styleFilter(style, path) {
  if (style !== null && (typeof style !== 'string' || !SYMBOL.test(style))) {
    fail('STYLE', path, 'expected null or a lowercase style symbol of at most 96 characters');
  }
}
function library(value) {
  exact(value, ['id', 'sha256'], [], '$.library');
  if (typeof value.id !== 'string' || !SLUG.test(value.id)
    || typeof value.sha256 !== 'string' || !HASH.test(value.sha256)) {
    fail('LIBRARY', '$.library', 'expected a bounded library slug and lowercase SHA-256');
  }
}
function keyParts(key, path) {
  if (typeof key !== 'string' || key.length > 153) fail('KEY', path, 'expected an exact asset key');
  const match = /^([^/@]+)\/([^/@]+)@([^/@]+)$(?![\s\S])/.exec(key);
  if (!match) fail('KEY', path, 'expected namespace/id@major.minor.patch');
  try { if (assetKey(match[1], match[2], match[3]) !== key) fail('KEY', path, 'invalid exact key'); }
  catch { fail('KEY', path, 'invalid namespace, ID or numeric version'); }
  return { namespace: match[1], id: match[2], version: match[3], identity: `${match[1]}/${match[2]}` };
}
function portableAsset(asset, path) {
  exact(asset, ASSET_FIELDS, [], path);
  const parts = keyParts(asset.key, `${path}.key`);
  const metadata = {
    id: parts.id, version: parts.version, file: 'asset.png', name: asset.name, role: asset.role,
    family: asset.family, style: asset.style, variant: asset.variant,
    tags: asset.tags, size: asset.size, slice: asset.slice,
  };
  let checked;
  try { checked = validateAssetBatch({ assetBatchVersion: '0.1', namespace: parts.namespace, assets: [metadata] }).assets[0]; }
  catch { fail('METADATA', path, 'invalid asset metadata, dimensions or slice'); }
  if (!same(checked, metadata)) fail('METADATA', path, 'metadata must already contain normalized tags and explicit defaults');
  if (typeof asset.sha256 !== 'string' || !HASH.test(asset.sha256)
    || !Number.isSafeInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > 16 * 1024 * 1024) {
    fail('FILE', path, 'expected a lowercase PNG digest and byte count from 1 through 16 MiB');
  }
  return parts;
}
function newer(a, b) {
  const aa = a.split('.').map(Number), bb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i] > bb[i];
  return false;
}
function slotFor(asset) {
  if (asset.role === 'icon') return 'row-icon';
  if (['shape', 'layout-primitive'].includes(asset.role) && asset.slice !== null) return 'panel-surface';
  return null;
}
function previousCodePoint(text, offset) {
  if (offset === 0) return '';
  const end = text.charCodeAt(offset - 1);
  return text.slice(end >= 0xDC00 && end <= 0xDFFF && offset >= 2 ? offset - 2 : offset - 1, offset);
}
function nextCodePoint(text, offset) {
  return offset >= text.length ? '' : String.fromCodePoint(text.codePointAt(offset));
}
function containsTerm(query, term) {
  if (!term || !/[\p{L}\p{N}]/u.test(term)) return false;
  const characters = [...term];
  const leftBoundary = LATIN_WORD.test(characters[0]), rightBoundary = LATIN_WORD.test(characters.at(-1));
  let offset = query.indexOf(term);
  while (offset !== -1) {
    if ((!leftBoundary || !LATIN_WORD.test(previousCodePoint(query, offset)))
      && (!rightBoundary || !LATIN_WORD.test(nextCodePoint(query, offset + term.length)))) return true;
    offset = query.indexOf(term, offset + 1);
  }
  return false;
}

// lexical-v1: each distinct normalized term contributes its strongest source
// weight (name=8, tag=4, family=2); equality with the whole request adds 4.
// Generic role/file terms are ignored; appearance terms need a semantic match.
// Repeated words never multiply scores. Matching is over the complete request.
function rank(query, assets, style) {
  const latest = new Map();
  for (const asset of assets) {
    const parts = keyParts(asset.key, '$.asset.key'), old = latest.get(parts.identity);
    if (!old || newer(parts.version, old.parts.version)) latest.set(parts.identity, { asset, parts });
  }
  const matched = new Map(), candidates = [];
  for (const { asset } of latest.values()) {
    const slot = slotFor(asset);
    if (!slot || (style !== null && asset.style !== style)) continue;
    const terms = new Map();
    for (const [raw, weight] of [[asset.name, 8], ...asset.tags.map(tag => [tag, 4]), [asset.family, 2]]) {
      const term = normalize(raw);
      if (GENERIC_TERMS.has(term)) continue;
      terms.set(term, Math.max(weight, terms.get(term) ?? 0));
    }
    const matchedTerms = [...terms.keys()].filter(term => {
      if (!matched.has(term)) matched.set(term, containsTerm(query, term));
      return matched.get(term);
    }).sort(compare);
    if (!matchedTerms.some(term => !APPEARANCE_TERMS.has(term))) continue;
    const score = matchedTerms.reduce((sum, term) => sum + terms.get(term) + (query === term ? 4 : 0), 0);
    candidates.push({ slot, score, matchedTerms, asset });
  }
  candidates.sort((a, b) => compare(a.slot, b.slot) || b.score - a.score || compare(a.asset.key, b.asset.key));
  const counts = new Map();
  return candidates.filter(candidate => {
    const count = (counts.get(candidate.slot) ?? 0) + 1;
    counts.set(candidate.slot, count);
    return count <= 16;
  });
}

// A verified index may contain 4096 records, exceeding snapshotJson's generic
// array cap. Inspect its descriptors first, then snapshot each bounded record.
function dataFields(value, array, path) {
  if (!value || Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) fail('JSON', path, 'plain data required');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    const d = descriptors[key];
    if (typeof key !== 'string' || !Object.hasOwn(d, 'value') || (!(array && key === 'length') && !d.enumerable)) {
      fail('JSON', path, 'accessors, symbols and hidden fields are not accepted');
    }
  }
  return descriptors;
}

/** Rank only supplied portable assets, using the unchanged lexical-v1 rules.
 * This does not establish library membership or expand a planning candidate set. */
export function rankPortableAssets(requestText, input, style = null) {
  const query = request(requestText), assets = snapshot(input);
  if (!Array.isArray(assets) || assets.length > 32) fail('CANDIDATES', '$.assets', 'expected at most 32 portable assets');
  styleFilter(style, '$.style');
  const keys = new Set();
  for (const [index, asset] of assets.entries()) {
    portableAsset(asset, `$.assets[${index}]`);
    if (keys.has(asset.key)) fail('DUPLICATE', '$.assets', 'duplicate asset key');
    keys.add(asset.key);
  }
  return rank(query, assets, style);
}

/** Requires an already verified library index; this pure function does not verify files or the library digest. */
export function createAssetRetrieval(requestText, verifiedIndex, options = {}) {
  const query = request(requestText), checkedOptions = snapshot(options);
  exact(checkedOptions, [], ['style'], '$.options');
  const style = Object.hasOwn(checkedOptions, 'style') ? checkedOptions.style : null;
  styleFilter(style, '$.options.style');
  const fields = dataFields(verifiedIndex, false, '$.index');
  if (fields.assetLibraryVersion?.value !== '0.1' || !fields.records) fail('INDEX', '$.index', 'expected a verified asset library 0.1 index');
  const selectedLibrary = snapshot({ id: fields.id?.value, sha256: fields.sha256?.value });
  library(selectedLibrary);
  const items = dataFields(fields.records.value, true, '$.index.records');
  const length = items.length.value;
  if (length > 4096 || Object.keys(items).length !== length + 1) fail('INDEX', '$.index.records', 'expected at most 4096 dense records');
  const assets = [], keys = new Set();
  for (let i = 0; i < length; i++) {
    if (!items[String(i)]) fail('INDEX', '$.index.records', 'sparse arrays are not accepted');
    const record = snapshot(items[String(i)].value), path = `$.index.records[${i}]`;
    if (!record || Object.getPrototypeOf(record) !== Object.prototype || !record.metadata || !record.file) fail('INDEX', path, 'record metadata and file facts are required');
    const m = record.metadata;
    const asset = {
      key: record.key, name: m.name, role: m.role, family: m.family, style: m.style, variant: m.variant,
      tags: m.tags, size: m.size, slice: m.slice, sha256: record.file.sha256, bytes: record.file.bytes,
    };
    const parts = portableAsset(asset, path);
    if (record.namespace !== parts.namespace || m.id !== parts.id || m.version !== parts.version) fail('INDEX', path, 'record identity does not match its exact key');
    if (keys.has(asset.key)) fail('DUPLICATE', path, 'duplicate asset key');
    keys.add(asset.key); assets.push(asset);
  }
  return {
    assetRetrievalVersion: '0.1', library: selectedLibrary,
    policy: { algorithm: 'lexical-v1', latestOnly: true, limitPerSlot: 16, style },
    candidates: rank(query, assets, style),
  };
}

/**
 * Check embedded facts and recompute their scores/order, returning an isolated
 * snapshot. This cannot prove library membership, omitted newer versions or the
 * global top 16. Build must verify the bound library and recompute its retrieval.
 */
export function validateAssetRetrieval(requestText, input) {
  const query = request(requestText), value = snapshot(input);
  exact(value, ['assetRetrievalVersion', 'library', 'policy', 'candidates'], [], '$');
  if (value.assetRetrievalVersion !== '0.1') fail('VERSION', '$.assetRetrievalVersion', 'only retrieval 0.1 is supported');
  library(value.library);
  exact(value.policy, ['algorithm', 'latestOnly', 'limitPerSlot', 'style'], [], '$.policy');
  if (value.policy.algorithm !== 'lexical-v1' || value.policy.latestOnly !== true || value.policy.limitPerSlot !== 16) {
    fail('POLICY', '$.policy', 'only fixed lexical-v1 latest-only retrieval with 16 results per slot is supported');
  }
  styleFilter(value.policy.style, '$.policy.style');
  if (!Array.isArray(value.candidates) || value.candidates.length > 32) fail('CANDIDATES', '$.candidates', 'expected at most 32 candidates');
  const keys = new Set(), counts = new Map();
  for (const [index, candidate] of value.candidates.entries()) {
    const path = `$.candidates[${index}]`;
    exact(candidate, ['slot', 'score', 'matchedTerms', 'asset'], [], path);
    portableAsset(candidate.asset, `${path}.asset`);
    if (!['row-icon', 'panel-surface'].includes(candidate.slot) || slotFor(candidate.asset) !== candidate.slot) fail('SLOT', `${path}.slot`, 'asset is not eligible for this slot');
    if (keys.has(candidate.asset.key)) fail('DUPLICATE', path, 'candidate asset key is duplicated');
    keys.add(candidate.asset.key);
    counts.set(candidate.slot, (counts.get(candidate.slot) ?? 0) + 1);
    if (counts.get(candidate.slot) > 16) fail('CANDIDATES', '$.candidates', 'at most 16 candidates per slot');
    if (!Number.isSafeInteger(candidate.score) || candidate.score < 1) fail('SCORE', `${path}.score`, 'positive integer score required');
    if (!Array.isArray(candidate.matchedTerms) || candidate.matchedTerms.length < 1 || candidate.matchedTerms.length > 34
      || candidate.matchedTerms.some(term => typeof term !== 'string' || !term.length || [...term].length > 4096)) {
      fail('TERMS', `${path}.matchedTerms`, 'expected a bounded list of matching normalized terms');
    }
  }
  const expected = rank(query, value.candidates.map(candidate => candidate.asset), value.policy.style);
  if (!same(expected, value.candidates)) fail('MISMATCH', '$.candidates', 'embedded candidate scores, terms, latest versions or order do not follow the retrieval policy');
  return value;
}
