import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { assetKey, validateAssetBatch } from '../src/asset-descriptor.mjs';

const fixture = () => ({ assetBatchVersion: '0.1', namespace: 'my-kit', assets: [{
  id: 'settings', version: '1.0.0', file: 'icons/Settings.svg', name: '设置', role: 'icon',
  tags: [' 设置 ', 'ＳＥＴＴＩＮＧＳ', 'settings'], size: { width: 64, height: 64 },
}] });
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
const expectCode = (action, code) => assert.throws(action, error => error.code === code && typeof error.path === 'string');

test('descriptors normalize explicit defaults and tags without mutating input or sharing references', () => {
  const input = freeze(fixture());
  const result = validateAssetBatch(input);
  assert.deepEqual(result.assets[0].tags, ['设置', 'settings']);
  assert.equal(result.assets[0].family, 'settings');
  assert.equal(result.assets[0].style, 'custom');
  assert.equal(result.assets[0].variant, 'default');
  assert.equal(result.assets[0].slice, null);
  assert.equal(Object.hasOwn(input.assets[0], 'family'), false);
  assert.deepEqual(input.assets[0].tags, [' 设置 ', 'ＳＥＴＴＩＮＧＳ', 'settings']);
  result.assets[0].size.width = 32;
  assert.equal(input.assets[0].size.width, 64);
  assert.deepEqual(validateAssetBatch(validateAssetBatch(input)), validateAssetBatch(input));
});

test('exact asset identity rejects malformed identifiers or versions but allows versioned variants', () => {
  assert.equal(assetKey('my-kit', 'settings', '0.1.1000000'), 'my-kit/settings@0.1.1000000');
  for (const id of ['A', '0abc', 'a_b', 'a.b', 'a/b', 'a@b', 'a'.repeat(65), 'a\n']) expectCode(() => assetKey('kit', id, '1.0.0'), 'ASSET_IDENTIFIER');
  expectCode(() => assetKey('Uppercase', 'settings', '1.0.0'), 'ASSET_IDENTIFIER');
  for (const version of ['01.0.0', '1.00.0', '1.0.01', '1.0', '1.0.0-beta', '1.0.0+build', '1000001.0.0', '1.0.0\n', 1]) {
    expectCode(() => assetKey('kit', 'settings', version), 'ASSET_VERSION');
  }
  const valid = fixture();
  valid.assets.push({ ...structuredClone(valid.assets[0]), version: '2.0.0' });
  assert.equal(validateAssetBatch(valid).assets.length, 2);
  valid.assets[1].version = '1.0.0';
  expectCode(() => validateAssetBatch(valid), 'ASSET_DUPLICATE_KEY');
});

test('batch and entries reject missing or unknown keys and enforce asset count', () => {
  for (const mutate of [value => { value.extra = true; }, value => { value.assets[0].extra = true; }, value => { value.assets[0].size.extra = true; }]) {
    const value = fixture(); mutate(value); expectCode(() => validateAssetBatch(value), 'ASSET_UNKNOWN_FIELD');
  }
  for (const field of ['id', 'version', 'file', 'name', 'role', 'tags', 'size']) {
    const value = fixture(); delete value.assets[0][field]; expectCode(() => validateAssetBatch(value), 'ASSET_REQUIRED_FIELD');
  }
  const wrongVersion = fixture(); wrongVersion.assetBatchVersion = '0.2'; expectCode(() => validateAssetBatch(wrongVersion), 'ASSET_BATCH_VERSION');
  for (const count of [0, 129]) {
    const value = fixture(); value.assets = Array.from({ length: count }, (_, index) => ({ ...value.assets[0], id: `item-${index}` }));
    expectCode(() => validateAssetBatch(value), 'ASSET_BATCH_SIZE');
  }
  const max = fixture(); max.assets = Array.from({ length: 128 }, (_, index) => ({ ...max.assets[0], id: `item-${index}` }));
  assert.equal(validateAssetBatch(max).assets.length, 128);
});

test('only portable relative PNG and SVG paths are accepted', () => {
  for (const file of ['icons/设置.png', 'icons/Settings.PNG', 'my kit/gear.SvG', 'icons/COM10.svg', 'icons/auxiliary.png']) {
    const value = fixture(); value.assets[0].file = file; assert.equal(validateAssetBatch(value).assets[0].file, file);
  }
  for (const file of ['/icons/a.png', 'C:/icons/a.png', '//server/a.png', '../a.png', 'icons/../a.png', 'icons/./a.png', 'icons//a.png', 'icons\\a.png', 'a.png:stream', 'a?.png', 'a*.png', 'a<.png', 'a|.png', 'a".png', 'a.gif', 'a.png\n', 'icons /a.png', 'icons./a.png', 'icons/a.png ', 'icons/CON.png', 'con/a.svg', 'NUL.SVG', 'PRN.png', 'AUX.png', 'COM1.png', 'LPT9.svg', 'COM¹.svg', 'LPT².svg', 'CONIN$.png', 'CONOUT$.svg', 'CON .png', 'a'.repeat(237) + '.png']) {
    const value = fixture(); value.assets[0].file = file; expectCode(() => validateAssetBatch(value), 'ASSET_FILE_PATH');
  }
});

test('names and tags are bounded text, with tag deduplication after Unicode normalization', () => {
  for (const name of ['', ' ', 'x'.repeat(121), 'name\t', '\ud800']) {
    const value = fixture(); value.assets[0].name = name; expectCode(() => validateAssetBatch(value), 'ASSET_TEXT');
  }
  const unicode = fixture(); unicode.assets[0].name = '🫐'.repeat(120); assert.equal(validateAssetBatch(unicode).assets[0].name, unicode.assets[0].name);
  for (const tags of [[], Array(33).fill('valid')]) {
    const value = fixture(); value.assets[0].tags = tags; expectCode(() => validateAssetBatch(value), 'ASSET_TAGS');
  }
  for (const tags of [[''], [' '], ['x'.repeat(65)], ['ok\n'], ['\ud800'], ['ﬄ'.repeat(32)]]) {
    const value = fixture(); value.assets[0].tags = tags; expectCode(() => validateAssetBatch(value), 'ASSET_TEXT');
  }
  const value = fixture(); value.assets[0].tags = ['  ＶＯＬＵＭＥ ', 'volume', 'Volume', '音量'];
  assert.deepEqual(validateAssetBatch(value).assets[0].tags, ['volume', '音量']);
});

test('roles and symbolic variants are explicit while supplied null defaults are not silently repaired', () => {
  for (const role of ['icon', 'shape', 'effect', 'layout-primitive', 'animation-part']) {
    const value = fixture(); value.assets[0].role = role; assert.equal(validateAssetBatch(value).assets[0].role, role);
  }
  for (const role of ['excluded', 'demo', 'button', null]) {
    const value = fixture(); value.assets[0].role = role; expectCode(() => validateAssetBatch(value), 'ASSET_ROLE');
  }
  for (const field of ['family', 'style', 'variant']) {
    for (const invalid of [null, '', 'Uppercase', 'a_b', 'a@b', 'a/b', 'a'.repeat(97), 'a\n']) {
      const value = fixture(); value.assets[0][field] = invalid; expectCode(() => validateAssetBatch(value), 'ASSET_SYMBOL');
    }
    const value = fixture(); value.assets[0][field] = 'family.variant-2'; assert.equal(validateAssetBatch(value).assets[0][field], 'family.variant-2');
  }
});

test('size and nine slice must use bounded integer dimensions with a positive center', () => {
  for (const size of [{ width: 0, height: 64 }, { width: 4097, height: 64 }, { width: 1.5, height: 64 }]) {
    const value = fixture(); value.assets[0].size = size; expectCode(() => validateAssetBatch(value), 'ASSET_INTEGER');
  }
  const max = fixture(); max.assets[0].size = { width: 4096, height: 4096 }; assert.deepEqual(validateAssetBatch(max).assets[0].size, max.assets[0].size);
  const valid = fixture(); valid.assets[0].slice = { left: 8, top: 4, right: 8, bottom: 4 }; assert.deepEqual(validateAssetBatch(valid).assets[0].slice, valid.assets[0].slice);
  for (const slice of [{ left: 32, top: 0, right: 32, bottom: 0 }, { left: 0, top: 33, right: 0, bottom: 32 }]) {
    const value = fixture(); value.assets[0].slice = slice; expectCode(() => validateAssetBatch(value), 'ASSET_SLICE_GEOMETRY');
  }
  for (const left of [-1, 0.5, 4096]) {
    const value = fixture(); value.assets[0].slice = { left, top: 0, right: 0, bottom: 0 }; expectCode(() => validateAssetBatch(value), 'ASSET_INTEGER');
  }
  const missing = fixture(); missing.assets[0].slice = { left: 1, top: 1, right: 1 }; expectCode(() => validateAssetBatch(missing), 'ASSET_REQUIRED_FIELD');
  const extra = fixture(); extra.assets[0].slice = { left: 1, top: 1, right: 1, bottom: 1, extra: 1 }; expectCode(() => validateAssetBatch(extra), 'ASSET_UNKNOWN_FIELD');
});

test('plain JSON snapshot rejects getters without invoking them and rejects non-data structures', () => {
  let invoked = false;
  const getter = fixture(); Object.defineProperty(getter.assets[0], 'name', { enumerable: true, get() { invoked = true; throw new Error('must not execute'); } });
  expectCode(() => validateAssetBatch(getter), 'ASSET_JSON'); assert.equal(invoked, false);
  const values = [];
  const cycle = fixture(); cycle.extra = cycle; values.push(cycle);
  const symbol = fixture(); symbol[Symbol('secret')] = true; values.push(symbol);
  const hidden = fixture(); Object.defineProperty(hidden, 'hidden', { value: true }); values.push(hidden);
  const prototype = fixture(); Object.setPrototypeOf(prototype, { inherited: true }); values.push(prototype);
  const sparse = fixture(); sparse.assets = Array(2); values.push(sparse);
  const nonfinite = fixture(); nonfinite.assets[0].size.width = Infinity; values.push(nonfinite);
  const undefinedField = fixture(); undefinedField.assets[0].family = undefined; values.push(undefinedField);
  for (const value of values) expectCode(() => validateAssetBatch(value), 'ASSET_JSON');
});

test('published schema declares strict shape, bounded versions and annotation-only defaults', async () => {
  const schema = JSON.parse(await readFile(new URL('../schemas/asset-batch.schema.json', import.meta.url), 'utf8'));
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.$defs.asset.additionalProperties, false);
  assert.equal(schema.$defs.asset.properties.style.default, 'custom');
  assert.equal(schema.$defs.asset.properties.variant.default, 'default');
  assert.equal(schema.$defs.slice.default, null);
  assert.match(schema.$comment, /annotations and do not mutate/);
  const pattern = new RegExp(schema.$defs.version.pattern, 'u');
  assert.equal(pattern.test('1000000.0.999999'), true);
  assert.equal(pattern.test('1000001.0.0'), false);
  assert.equal(pattern.test('01.0.0'), false);
});
