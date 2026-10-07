import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { resolveRecipe, resolveTheme, searchCatalog, validateCatalog } from '../src/catalog.mjs';

const catalog = JSON.parse(await readFile(new URL('../catalog/modern-core.json', import.meta.url), 'utf8'));
const fresh = () => structuredClone(catalog);

function freeze(value) {
  Object.values(value).forEach((entry) => {
    if (entry && typeof entry === 'object') freeze(entry);
  });
  return Object.freeze(value);
}

test('bundled catalog validates without modifying frozen input, with independent output', () => {
  const input = freeze(fresh());
  const output = validateCatalog(input);
  assert.deepEqual(output, input);
  output.themes[0].tokens.accent = '#000000';
  output.recipes[0].tags.push('changed');
  assert.equal(input.themes[0].tokens.accent, '#71DBC3');
  assert.equal(input.recipes[0].tags.includes('changed'), false);
});

test('references require exact versions, kinds, and known fields', () => {
  const input = freeze(fresh());
  const recipe = resolveRecipe(input, { id: 'settings.slider', version: '0.1.0' }, 'slider-row');
  assert.equal(recipe.kind, 'slider-row');
  recipe.tags.push('changed');
  assert.equal(input.recipes[2].tags.includes('changed'), false);
  const theme = resolveTheme(input, { id: 'modern-dark', version: '0.1.0' });
  theme.tokens.radius = 4;
  assert.equal(input.themes[0].tokens.radius, 12);
  assert.throws(() => resolveRecipe(input, { id: 'settings.slider', version: '0.2.0' }), /not found/);
  assert.throws(() => resolveRecipe(input, { id: 'settings.slider', version: '0.1.0' }, 'switch-row'), /expected switch-row/);
  assert.throws(() => resolveTheme(input, { id: 'modern-dark' }), /missing version/);
  assert.throws(() => resolveTheme(input, { id: 'modern-dark', version: 'latest' }), /invalid string/);
  assert.throws(() => resolveTheme(input, { id: 'modern-dark', version: '0.1.0', path: '/local' }), /unknown field/);
});

test('Chinese synonyms and English requests retrieve relevant recipes', () => {
  for (const query of ['音量', '声音大小', '帮我增加音量调节', 'volume', 'VOLUME', 'ＶＯＬＵＭＥ']) {
    assert.equal(searchCatalog(catalog, { query })[0].recipe.id, 'settings.slider', query);
  }
  for (const query of ['启用声音', '帮我加个声音开关', 'toggle', 'mute']) {
    assert.equal(searchCatalog(catalog, { query })[0].recipe.id, 'settings.switch', query);
  }
  assert.deepEqual(searchCatalog(catalog, { query: '帮我添加音量和声音开关' }).map((entry) => entry.recipe.id).sort(), ['settings.slider', 'settings.switch']);
});

test('filters are applied before ranking and irrelevant queries never return arbitrary recipes', () => {
  assert.deepEqual(searchCatalog(catalog, { query: 'volume', kind: 'switch-row' }), []);
  assert.deepEqual(searchCatalog(catalog, { query: 'volume', target: 'unity' }), []);
  assert.equal(searchCatalog(catalog, { query: 'volume', target: 'pixi' }).length, 1);
  for (const query of ['', '   ', '!!!', 'dragon inventory', 'panelist']) {
    assert.deepEqual(searchCatalog(catalog, { query }), [], query);
  }
  assert.throws(() => searchCatalog(catalog, { query: 'volume', mode: 'vector' }), /unknown field/);
  assert.throws(() => searchCatalog(catalog, { query: 'a'.repeat(513) }), /at most 512/);
  assert.throws(() => searchCatalog(catalog, { query: 'volume', kind: 'button' }), /unsupported recipe kind/);
});

test('colloquial dragging aliases retrieve sliders without confusing host-owned loading or mutating catalog identity', () => {
  const original = fresh();
  for (const query of ['能拖的条', '做个滑块', '滑动条', '可以拖动的条', '拖动条']) {
    assert.equal(searchCatalog(original, { query })[0].recipe.kind, 'slider-row', query);
    assert.deepEqual(searchCatalog(original, { query, retrievalVersion: '0.1' }), [], query);
    assert.deepEqual(searchCatalog(original, { query, kind: 'switch-row' }), [], query);
  }
  for (const query of ['加载条', '进度条', '显示加载进度', '不要滑块', '不需要能拖的条', '去掉滑动条']) {
    assert.equal(searchCatalog(original, { query }).some(result => result.recipe.kind === 'slider-row'), false, query);
  }
  assert.equal(searchCatalog(original, { query: '不要滑块，但是需要能拖的条' })[0].recipe.kind, 'slider-row');
  assert.deepEqual(original, catalog);
  assert.throws(() => searchCatalog(original, { query: '滑块', retrievalVersion: '0.3' }), /unsupported retrieval version/);
});

test('retrieval order is deterministic across catalog record order and returns independent records', () => {
  const input = fresh();
  const clone = structuredClone(input.recipes[2]);
  clone.id = 'settings.volume-copy';
  input.recipes.push(clone);
  const expected = searchCatalog(freeze(input), { query: 'volume' });
  const reordered = fresh();
  reordered.recipes = [...input.recipes].reverse();
  assert.deepEqual(searchCatalog(reordered, { query: 'volume' }), expected);
  expected[0].recipe.tags.push('changed');
  assert.equal(input.recipes.some((entry) => entry.tags.includes('changed')), false);
});

test('catalog rejects unknown fields, nonplain values, getters, duplicate identities and invalid data', () => {
  const mutations = [
    (value) => { value.extra = true; },
    (value) => { value.catalogVersion = '0.2'; },
    (value) => { value.themes[0].tokens.accent = 'red'; },
    (value) => { value.themes[0].tokens.spacing = Infinity; },
    (value) => { value.themes[0].tokens.fontSize = 0; },
    (value) => { value.themes[0].tokens.path = 'private'; },
    (value) => { value.themes.push(value.themes[0]); },
    (value) => { value.recipes.push(value.recipes[0]); },
    (value) => { value.recipes[0].kind = 'button'; },
    (value) => { value.recipes[0].supports = ['unity']; },
    (value) => { value.recipes[0].states = ['imaginary']; },
    (value) => { value.recipes[0].tags = ['volume', 'VOLUME']; },
    (value) => { value.recipes[0].minWidth = -1; },
    (value) => { value.recipes[0].minHeight = '56'; },
    (value) => { value.recipes[0].id = '../escape'; },
    (value) => { value.recipes[0].version = '01.0.0'; },
    (value) => { value.recipes[0].description = 'invalid\ntext'; },
    (value) => { value.recipes = []; },
    (value) => { value.themes[0].tokens = new Date(); },
    (value) => { value.recipes[0].tags = new Array(2); },
    (value) => { value.recipes[0].tags.secret = 'hidden'; },
    (value) => { Object.defineProperty(value, 'id', { get() { throw new Error('getter must not execute'); }, enumerable: true }); },
  ];
  for (const mutate of mutations) {
    const input = fresh();
    mutate(input);
    assert.throws(() => validateCatalog(input), (error) => error instanceof Error && error.message !== 'getter must not execute');
  }
  assert.throws(() => validateCatalog(Object.assign(Object.create({ inherited: true }), fresh())), /plain object/);
});

test('catalog size limits and explicit external font family are supported', () => {
  const input = fresh();
  input.themes[0].tokens.fontFamily = 'Example Game Font';
  assert.equal(validateCatalog(input).themes[0].tokens.fontFamily, 'Example Game Font');
  input.recipes = Array.from({ length: 257 }, (_, index) => ({ ...catalog.recipes[0], id: `recipe-${index}` }));
  assert.throws(() => validateCatalog(input), /256 entries/);
});
