/** A local, data-only catalog. No downloads, model calls, or implicit version selection. */
const KINDS = new Set(['panel', 'section', 'slider-row', 'switch-row', 'select-row', 'button-row', 'text-row', 'progress-row', 'input-row', 'tabs']);
const STATES = new Set(['idle', 'hover', 'pressed', 'disabled', 'dragging', 'checked']);
const ID = /^[a-z][a-z0-9._-]{0,95}$/;
const VERSION = /^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/;
const COLOR_KEYS = ['background', 'surface', 'control', 'accent', 'text', 'muted', 'border'];
const TOKEN_KEYS = [...COLOR_KEYS, 'fontFamily', 'fontSize', 'headingSize', 'titleSize', 'spacing', 'radius'];

function fail(path, message) {
  throw new Error(`${path}: ${message}`);
}

function object(value, path, required, optional = []) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail(path, 'expected a plain object');
  }
  const allowed = new Set([...required, ...optional]);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.has(key)) fail(path, `unknown field ${String(key)}`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail(`${path}.${key}`, 'expected a data field');
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail(path, `missing ${key}`);
  }
}

function string(value, path, max, pattern) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value !== value.trim()
      || /[\u0000-\u001f\u007f]/u.test(value) || (pattern && !pattern.test(value))) {
    fail(path, 'invalid string');
  }
}

function number(value, path, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(path, `expected a finite number between ${min} and ${max}`);
  }
}

function array(value, path, min, max) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
      || value.length < min || value.length > max) fail(path, `expected ${min}–${max} entries`);
  // Only dense JSON arrays: reject accessor elements and invisible/custom properties.
  if (Reflect.ownKeys(value).length !== value.length + 1) fail(path, 'expected a dense JSON array');
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail(path, 'expected a dense data array');
  }
}

function strings(value, path, max, allowed) {
  array(value, path, 1, max);
  const seen = new Set();
  value.forEach((entry, index) => {
    string(entry, `${path}[${index}]`, 80);
    if (allowed && !allowed.has(entry)) fail(`${path}[${index}]`, 'unsupported value');
    const key = entry.normalize('NFKC').toLowerCase();
    if (seen.has(key)) fail(path, `duplicate entry ${entry}`);
    seen.add(key);
  });
}

function identity(value, path) {
  string(value.id, `${path}.id`, 96, ID);
  string(value.version, `${path}.version`, 20, VERSION);
}

function uniqueIdentity(records, path) {
  const seen = new Set();
  records.forEach((record) => {
    const key = `${record.id}@${record.version}`;
    if (seen.has(key)) fail(path, `duplicate identity ${key}`);
    seen.add(key);
  });
}

/** Validate the complete strict catalog and return an independent JSON copy. */
export function validateCatalog(value) {
  object(value, 'catalog', ['catalogVersion', 'id', 'version', 'themes', 'recipes']);
  if (value.catalogVersion !== '0.1') fail('catalog.catalogVersion', 'only 0.1 is supported');
  identity(value, 'catalog');
  array(value.themes, 'catalog.themes', 1, 32);
  array(value.recipes, 'catalog.recipes', 1, 256);
  value.themes.forEach((theme, index) => {
    const path = `catalog.themes[${index}]`;
    object(theme, path, ['id', 'version', 'tokens'], ['visualStyle', 'controlStyle', 'presentationStyle', 'navigationStyle', 'surfaceStyle', 'iconStyle', 'sliderStyle', 'menuTokens', 'headingStyle']);
    identity(theme, path);
    if (Object.hasOwn(theme, 'visualStyle') && !['modern-v1', 'modern-v2', 'modern-v3'].includes(theme.visualStyle)) fail(`${path}.visualStyle`, 'unsupported visual style');
    if (Object.hasOwn(theme, 'controlStyle') && (theme.controlStyle !== 'semantic-v1' || theme.visualStyle !== 'modern-v3')) fail(`${path}.controlStyle`, 'semantic-v1 requires modern-v3');
    if (Object.hasOwn(theme, 'presentationStyle') && (theme.presentationStyle !== 'focused-v1' || theme.controlStyle !== 'semantic-v1')) fail(`${path}.presentationStyle`, 'focused-v1 requires semantic-v1 controls');
    if (Object.hasOwn(theme, 'headingStyle') && (!['concise-v1', 'visible-v1', 'concise-v2', 'visible-v2'].includes(theme.headingStyle) || theme.controlStyle !== 'semantic-v1' || theme.surfaceStyle !== 'minimal-v2'))
      fail(`${path}.headingStyle`, 'Versioned heading presentation requires semantic-v1 and minimal-v2');
    if (Object.hasOwn(theme, 'navigationStyle') && (theme.navigationStyle !== 'tabs-v1' || theme.presentationStyle !== 'focused-v1')) fail(`${path}.navigationStyle`, 'tabs-v1 requires focused-v1 presentation');
    if (Object.hasOwn(theme, 'surfaceStyle') && (!['refined-v1','minimal-v1','minimal-v2','crafted-v1','grouped-v1','grouped-v2','grouped-v3'].includes(theme.surfaceStyle) || theme.navigationStyle !== 'tabs-v1')) fail(`${path}.surfaceStyle`, 'Surface styles require tabs-v1 navigation');
    if ((theme.surfaceStyle === 'minimal-v2') !== Object.hasOwn(theme, 'menuTokens')) fail(`${path}.menuTokens`, 'minimal-v2 requires its exact menu token set');
    if (Object.hasOwn(theme, 'menuTokens')) {
      object(theme.menuTokens, `${path}.menuTokens`, TOKEN_KEYS);
      for (const key of COLOR_KEYS) string(theme.menuTokens[key], `${path}.menuTokens.${key}`, 7, /^#[0-9a-fA-F]{6}$/);
      string(theme.menuTokens.fontFamily, `${path}.menuTokens.fontFamily`, 128);
      for (const key of ['fontSize','headingSize','titleSize']) number(theme.menuTokens[key], `${path}.menuTokens.${key}`, 8, 128);
      number(theme.menuTokens.spacing, `${path}.menuTokens.spacing`, 0, 128);
      number(theme.menuTokens.radius, `${path}.menuTokens.radius`, 0, 128);
    }
    if (Object.hasOwn(theme, 'iconStyle') && (theme.iconStyle !== 'plain-v1' || !['grouped-v1','grouped-v2','grouped-v3'].includes(theme.surfaceStyle))) fail(`${path}.iconStyle`, 'plain-v1 icons require grouped surfaces');
    if (Object.hasOwn(theme, 'sliderStyle') && (theme.sliderStyle !== 'raised-v1' || !['grouped-v1','grouped-v2','grouped-v3'].includes(theme.surfaceStyle))) fail(`${path}.sliderStyle`, 'raised-v1 sliders require grouped surfaces');
    if(theme.surfaceStyle==='grouped-v3'&&theme.sliderStyle!=='raised-v1')fail(`${path}.sliderStyle`,'grouped-v3 requires raised-v1 slider geometry');
    object(theme.tokens, `${path}.tokens`, TOKEN_KEYS);
    for (const key of COLOR_KEYS) string(theme.tokens[key], `${path}.tokens.${key}`, 7, /^#[0-9a-fA-F]{6}$/);
    string(theme.tokens.fontFamily, `${path}.tokens.fontFamily`, 128);
    for (const key of ['fontSize', 'headingSize', 'titleSize']) number(theme.tokens[key], `${path}.tokens.${key}`, 8, 128);
    number(theme.tokens.spacing, `${path}.tokens.spacing`, 0, 128);
    number(theme.tokens.radius, `${path}.tokens.radius`, 0, 128);
  });
  value.recipes.forEach((recipe, index) => {
    const path = `catalog.recipes[${index}]`;
    object(recipe, path, ['id', 'version', 'kind', 'description', 'tags', 'states', 'supports', 'minWidth', 'minHeight'], ['buttonRole']);
    identity(recipe, path);
    if (!KINDS.has(recipe.kind)) fail(`${path}.kind`, 'unsupported recipe kind');
    if (Object.hasOwn(recipe, 'buttonRole') && (recipe.kind !== 'button-row' || !['primary', 'secondary', 'danger'].includes(recipe.buttonRole))) fail(`${path}.buttonRole`, 'explicit button role requires a button-row recipe');
    string(recipe.description, `${path}.description`, 512);
    strings(recipe.tags, `${path}.tags`, 32);
    strings(recipe.states, `${path}.states`, STATES.size, STATES);
    strings(recipe.supports, `${path}.supports`, 1, new Set(['pixi']));
    number(recipe.minWidth, `${path}.minWidth`, 1, 8192);
    number(recipe.minHeight, `${path}.minHeight`, 1, 8192);
  });
  uniqueIdentity(value.themes, 'catalog.themes');
  uniqueIdentity(value.recipes, 'catalog.recipes');
  return JSON.parse(JSON.stringify(value));
}

function reference(value) {
  object(value, 'reference', ['id', 'version']);
  identity(value, 'reference');
}

/** Resolve an exact recipe version; mismatch and missing records are errors. */
export function resolveRecipe(catalog, ref, expectedKind) {
  const copy = validateCatalog(catalog);
  reference(ref);
  if (expectedKind !== undefined && !KINDS.has(expectedKind)) fail('expectedKind', 'unsupported recipe kind');
  const recipe = copy.recipes.find((entry) => entry.id === ref.id && entry.version === ref.version);
  if (!recipe) fail('reference', `recipe ${ref.id}@${ref.version} was not found`);
  if (expectedKind !== undefined && recipe.kind !== expectedKind) fail('reference', `expected ${expectedKind}, received ${recipe.kind}`);
  return recipe;
}

/** Resolve an exact theme version; there is no fallback theme. */
export function resolveTheme(catalog, ref) {
  const copy = validateCatalog(catalog);
  reference(ref);
  const theme = copy.themes.find((entry) => entry.id === ref.id && entry.version === ref.version);
  if (!theme) fail('reference', `theme ${ref.id}@${ref.version} was not found`);
  return theme;
}

const normalize = (value) => value.normalize('NFKC').toLowerCase();
const words = (value) => normalize(value).match(/[\p{L}\p{N}]+/gu) ?? [];
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
// Versioned lexical hints only: never change the catalog, request or business facts.
const RECIPE_ALIASES = { 'slider-row': ['滑块', '滑动条', '拖动条', '拖动滑条', '能拖的条',
  '可以拖的条', '可拖动的条', '可以拖动的条', '能拖动的条'] };
function includesAlias(query, aliases) {
  return aliases.some(alias => {
    let start = query.indexOf(alias);
    while (start >= 0) {
      const prefix = query.slice(Math.max(0, start - 12), start);
      if (!/(?:不要|不需要|不包含|不用|没有|删除|去掉)[^，。；！？,.;!?]{0,6}$/u.test(prefix)) return true;
      start = query.indexOf(alias, start + alias.length);
    }
    return false;
  });
}

function includesTerm(text, term) {
  // Chinese phrases have no whitespace boundaries; Latin terms require word boundaries.
  if (/\p{Script=Han}/u.test(term)) return text.includes(term);
  const needle = words(term).join(' ');
  return ` ${words(text).join(' ')} `.includes(` ${needle} `);
}

/** Local lexical retrieval. Scores are ranking evidence, not confidence probabilities. */
export function searchCatalog(catalog, options) {
  const copy = validateCatalog(catalog);
  object(options, 'search', ['query'], ['kind', 'target', 'retrievalVersion']);
  if (typeof options.query !== 'string' || options.query.length > 512 || /[\u0000-\u001f\u007f]/u.test(options.query)) {
    fail('search.query', 'expected a string of at most 512 characters without control characters');
  }
  if (Object.hasOwn(options, 'kind') && !KINDS.has(options.kind)) fail('search.kind', 'unsupported recipe kind');
  if (Object.hasOwn(options, 'target')) string(options.target, 'search.target', 40, ID);
  const retrievalVersion = options.retrievalVersion ?? '0.2';
  if (!['0.1', '0.2'].includes(retrievalVersion)) fail('search.retrievalVersion', 'unsupported retrieval version');
  const query = normalize(options.query.trim());
  const terms = [...new Set(words(query))];
  if (terms.length === 0) return [];
  const results = [];
  for (const recipe of copy.recipes) {
    if (options.kind && recipe.kind !== options.kind) continue;
    if (options.target && !recipe.supports.includes(options.target)) continue;
    let score = 0;
    for (const tag of recipe.tags.map(normalize)) {
      if (includesTerm(query, tag)) score += 12;
      else if (terms.some((term) => includesTerm(tag, term))) score += 6;
    }
    for (const term of terms) {
      if (includesTerm(normalize(recipe.id), term)) score += 3;
      if (includesTerm(normalize(recipe.description), term)) score += 1;
    }
    if (retrievalVersion === '0.2' && includesAlias(query, RECIPE_ALIASES[recipe.kind] ?? [])) score += 12;
    if (score > 0) results.push({ recipe, score });
  }
  return results.sort((left, right) => right.score - left.score
    || compare(left.recipe.id, right.recipe.id) || compare(left.recipe.version, right.recipe.version));
}
