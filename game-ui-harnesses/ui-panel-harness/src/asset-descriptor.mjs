import { snapshotJson } from './spec.mjs';

const SLUG = /^[a-z][a-z0-9-]{0,63}$(?![\s\S])/;
const SYMBOL = /^[a-z0-9.-]{1,96}$(?![\s\S])/;
const VERSION = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$(?![\s\S])/;
const CONTROL = /[\p{Cc}\p{Cs}]/u;
const ROLES = new Set(['icon', 'shape', 'effect', 'layout-primitive', 'animation-part']);
const REQUIRED = ['id', 'version', 'file', 'name', 'role', 'tags', 'size'];
const OPTIONAL = ['family', 'style', 'variant', 'slice'];

function fail(code, path, message) {
  const error = new Error(`${code} ${path}: ${message}`);
  error.code = code;
  error.path = path;
  throw error;
}

function object(value, required, optional, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('ASSET_OBJECT', path, 'expected an object');
  const allowed = new Set([...required, ...optional]);
  if (Object.keys(value).some(key => !allowed.has(key))) fail('ASSET_UNKNOWN_FIELD', path, 'unknown field');
  if (required.some(key => !Object.hasOwn(value, key))) fail('ASSET_REQUIRED_FIELD', path, 'missing required field');
}

function text(value, max, path) {
  if (typeof value !== 'string' || !value.trim() || [...value].length > max || CONTROL.test(value)) {
    fail('ASSET_TEXT', path, `expected nonempty text of at most ${max} characters without controls`);
  }
}

function slug(value, path) {
  if (typeof value !== 'string' || !SLUG.test(value)) fail('ASSET_IDENTIFIER', path, 'expected a lowercase slug of at most 64 characters');
}

function version(value, path) {
  if (typeof value !== 'string' || value.length > 23 || !VERSION.test(value)
      || value.split('.').some(part => Number(part) > 1000000)) {
    fail('ASSET_VERSION', path, 'expected exact numeric major.minor.patch, each at most 1000000');
  }
}

/** A stable exact-version identity; it does not resolve or choose versions. */
export function assetKey(namespace, id, assetVersion) {
  slug(namespace, '$.namespace');
  slug(id, '$.id');
  version(assetVersion, '$.version');
  return `${namespace}/${id}@${assetVersion}`;
}

function sourceFile(value, path) {
  if (typeof value !== 'string' || !value.length || [...value].length > 240 || CONTROL.test(value)
      || /[\\:<>"|?*]/u.test(value) || !/\.(?:png|svg)$(?![\s\S])/i.test(value)) {
    fail('ASSET_FILE_PATH', path, 'expected a portable relative PNG or SVG path of at most 240 characters');
  }
  const segments = value.split('/');
  for (const segment of segments) {
    const stem = segment.split('.')[0].replace(/[ .]+$/, '');
    if (!segment || segment === '.' || segment === '..' || /[ .]$/.test(segment)
        || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]|conin\$|conout\$)$/i.test(stem)) {
      fail('ASSET_FILE_PATH', path, 'path contains an unsafe segment or reserved Windows device name');
    }
  }
}

function integer(value, min, max, path) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('ASSET_INTEGER', path, `expected integer ${min}..${max}`);
}

/** Validate bounded data and return an isolated snapshot with explicit defaults and normalized tags. */
export function validateAssetBatch(input) {
  let batch;
  try { batch = snapshotJson(input); }
  catch (error) { fail('ASSET_JSON', error.path ?? '$', 'expected bounded plain JSON data'); }
  object(batch, ['assetBatchVersion', 'namespace', 'assets'], [], '$');
  if (batch.assetBatchVersion !== '0.1') fail('ASSET_BATCH_VERSION', '$.assetBatchVersion', 'only 0.1 is supported');
  slug(batch.namespace, '$.namespace');
  if (!Array.isArray(batch.assets) || batch.assets.length < 1 || batch.assets.length > 128) {
    fail('ASSET_BATCH_SIZE', '$.assets', 'expected 1..128 assets');
  }
  const keys = new Set();
  for (const [index, asset] of batch.assets.entries()) {
    const path = `$.assets[${index}]`;
    object(asset, REQUIRED, OPTIONAL, path);
    slug(asset.id, `${path}.id`);
    version(asset.version, `${path}.version`);
    const key = assetKey(batch.namespace, asset.id, asset.version);
    if (keys.has(key)) fail('ASSET_DUPLICATE_KEY', path, 'asset identity repeats within batch');
    keys.add(key);
    sourceFile(asset.file, `${path}.file`);
    text(asset.name, 120, `${path}.name`);
    if (!ROLES.has(asset.role)) fail('ASSET_ROLE', `${path}.role`, 'unsupported resource role');
    if (!Array.isArray(asset.tags) || asset.tags.length < 1 || asset.tags.length > 32) {
      fail('ASSET_TAGS', `${path}.tags`, 'expected 1..32 tags');
    }
    asset.tags = [...new Set(asset.tags.map((tag, tagIndex) => {
      const tagPath = `${path}.tags[${tagIndex}]`;
      text(tag, 64, tagPath);
      const normalized = tag.normalize('NFKC').trim().toLowerCase();
      text(normalized, 64, tagPath);
      return normalized;
    }))];
    object(asset.size, ['width', 'height'], [], `${path}.size`);
    integer(asset.size.width, 1, 4096, `${path}.size.width`);
    integer(asset.size.height, 1, 4096, `${path}.size.height`);
    if (asset.size.width * asset.size.height > 16 * 1024 * 1024) fail('ASSET_PIXEL_LIMIT', `${path}.size`, 'size exceeds 16 megapixels');
    for (const [field, fallback] of [['family', asset.id], ['style', 'custom'], ['variant', 'default']]) {
      if (!Object.hasOwn(asset, field)) asset[field] = fallback;
      if (typeof asset[field] !== 'string' || !SYMBOL.test(asset[field])) {
        fail('ASSET_SYMBOL', `${path}.${field}`, 'expected a lowercase symbol using a-z, 0-9, dot and hyphen, at most 96 characters');
      }
    }
    if (!Object.hasOwn(asset, 'slice')) asset.slice = null;
    if (asset.slice !== null) {
      object(asset.slice, ['left', 'top', 'right', 'bottom'], [], `${path}.slice`);
      for (const field of ['left', 'top', 'right', 'bottom']) integer(asset.slice[field], 0, 4095, `${path}.slice.${field}`);
      if (asset.slice.left + asset.slice.right >= asset.size.width || asset.slice.top + asset.slice.bottom >= asset.size.height) {
        fail('ASSET_SLICE_GEOMETRY', `${path}.slice`, 'slice must leave a positive center width and height');
      }
    }
  }
  return batch;
}
