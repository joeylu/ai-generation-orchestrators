import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { canonicalJson, digestJson } from '../src/canonical.mjs';
import { searchCatalog } from '../src/catalog.mjs';
import { createPlanningContext, validatePanelRequest, validatePlanningContext } from '../src/planning-context.mjs';

const catalog = JSON.parse(await readFile(new URL('../catalog/modern-core.json', import.meta.url), 'utf8'));
const request = (text = '帮我生成一个设置面板，要包含音量和声音开关。') => ({ requestVersion: '0.1', id: 'audio-settings', text, target: 'pixi' });
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
async function rehash(context) {
  const { sha256: ignored, ...payload } = context;
  context.sha256 = await digestJson(payload);
  return context;
}

test('context deterministically binds exact frozen request and catalog without interpreting prose', async () => {
  const input = freeze(request('  音量\r\n\t声音开关 😀  '));
  const sourceCatalog = freeze(structuredClone(catalog));
  const context = await createPlanningContext(input, sourceCatalog);
  assert.deepEqual(context.request, input);
  assert.notEqual(context.request, input);
  assert.notEqual(context.catalog, sourceCatalog);
  assert.equal(context.requestSha256, await digestJson(input));
  assert.equal(context.catalogSha256, await digestJson(sourceCatalog));
  const { sha256, ...payload } = context;
  assert.equal(sha256, await digestJson(payload));
  assert.deepEqual(context.capabilities, {
    rowKinds: ['slider', 'switch'], layout: 'fixed-viewport-stacks', target: 'pixi',
    naturalLanguageInterpreter: 'external-agent', semanticReview: 'NOT_RUN',
  });
  assert.deepEqual(context.candidates.map(item => item.id).sort(), ['settings.slider', 'settings.switch']);
  assert.equal(canonicalJson(await createPlanningContext(input, sourceCatalog)), canonicalJson(context));
  const validated = await validatePlanningContext(freeze(context));
  assert.deepEqual(validated, context);
  validated.request.text = 'changed';
  validated.catalog.recipes[0].tags.push('changed');
  assert.equal(input.text, '  音量\r\n\t声音开关 😀  ');
  assert.equal(sourceCatalog.recipes[0].tags.includes('changed'), false);
});

test('short-request candidates are the complete lexical result, not probabilities or fabricated fallbacks', async () => {
  const input = request('settings panel section volume mute');
  const context = await createPlanningContext(input, catalog);
  assert.deepEqual(context.candidates, searchCatalog(catalog, { query: input.text, target: 'pixi' })
    .map(({ recipe, score }) => ({ id: recipe.id, version: recipe.version, kind: recipe.kind, score })));
  assert.equal(context.candidates.length, 4);
  assert.ok(context.candidates.some(item => item.score > 1));
  for (const text of ['galactic spaceship', '!!!', '😀']) {
    assert.deepEqual((await createPlanningContext(request(text), catalog)).candidates, []);
  }
});

test('new recipe retrieval is digest-bound while frozen legacy contexts retain their original ranking', async () => {
  const input = request('做个能拖的条，最低0最高100每格1，一开始40。');
  const current = await createPlanningContext(input, catalog);
  assert.equal(current.recipeRetrievalVersion, '0.2');
  assert(current.candidates.some(candidate => candidate.kind === 'slider-row'));
  assert.deepEqual(current.request, input);
  assert.deepEqual(current.catalog, catalog);
  assert.deepEqual(await validatePlanningContext(current), current);
  const legacy = structuredClone(current);
  delete legacy.recipeRetrievalVersion;
  legacy.candidates = searchCatalog(catalog, { query: input.text, target: 'pixi', retrievalVersion: '0.1' })
    .map(({ recipe, score }) => ({ id: recipe.id, version: recipe.version, kind: recipe.kind, score }));
  await rehash(legacy);
  assert.deepEqual(await validatePlanningContext(legacy), legacy);
  assert.notEqual(legacy.sha256, current.sha256);
  const forged = structuredClone(current); delete forged.recipeRetrievalVersion;
  await assert.rejects(validatePlanningContext(await rehash(forged)), /PLANNING_CONTEXT_MISMATCH/);
  await assert.rejects(validatePlanningContext({ ...current, recipeRetrievalVersion: '0.3' }), { code: 'retrieval-version' });
});

test('all 16 colloquial requests retrieve every explicitly needed recipe kind with untouched source evidence', async () => {
  const { COLLOQUIAL_SUITE } = await import('../examples/real-input-evaluation-v1/suite.mjs');
  const formsCatalog = JSON.parse(await readFile(new URL('../examples/modern-mint-forms.catalog.json', import.meta.url), 'utf8'));
  for (const item of COLLOQUIAL_SUITE.cases) {
    const context = await createPlanningContext(item.request, formsCatalog);
    for (const kind of new Set(item.expected.rows.map(row => `${row.kind}-row`))) {
      assert(context.candidates.some(candidate => candidate.kind === kind), `${item.id}: ${kind}`);
    }
    assert.deepEqual(context.request, item.request);
    assert.equal(context.catalogSha256, await digestJson(formsCatalog));
  }
});

test('retrieval processes late text and multiline input beyond the search API limit', async () => {
  const text = `${'无关说明。'.repeat(1450)}\r\n\t音量\n声音开关`;
  const context = await createPlanningContext(request(text), catalog);
  assert.equal(context.request.text, text);
  assert.deepEqual(context.candidates.map(item => item.id).sort(), ['settings.slider', 'settings.switch']);
  // The complete tag crosses the first 480-unit boundary and must still be found.
  const crossing = await createPlanningContext(request(`${'。'.repeat(478)}声音开关`), catalog);
  assert.deepEqual(crossing.candidates.map(item => item.id), ['settings.switch']);
});

test('unicode limits count code points and retrieval windows never split surrogate pairs', async () => {
  const text = `${'😀'.repeat(7989)}\n音量\t声音开关`;
  assert.equal([...text].length, 7997);
  const context = await createPlanningContext(request(text), catalog);
  assert.equal(context.request.text, text);
  assert.deepEqual(context.candidates.map(item => item.id).sort(), ['settings.slider', 'settings.switch']);
  assert.equal(validatePanelRequest(request('😀'.repeat(8000))).text.length, 16000);
  assert.throws(() => validatePanelRequest(request('😀'.repeat(8001))), /8000/);
});

test('candidate aggregation keeps best score once and has stable identity tie breaks', async () => {
  const expanded = structuredClone(catalog);
  expanded.recipes.push({ ...structuredClone(catalog.recipes[2]), id: 'settings.volume-copy' });
  const input = request(`${'volume '.repeat(150)}\n${'。'.repeat(500)}\nvolume`);
  const original = await createPlanningContext(input, expanded);
  const reversed = await createPlanningContext(input, { ...expanded, recipes: [...expanded.recipes].reverse() });
  assert.deepEqual(reversed.candidates, original.candidates);
  assert.deepEqual(original.candidates.map(item => item.id), ['settings.volume-copy', 'settings.slider']);
  assert.equal(new Set(original.candidates.map(item => `${item.id}@${item.version}`)).size, original.candidates.length);
  assert.equal(original.candidates.find(item => item.id === 'settings.slider').score,
    searchCatalog(catalog, { query: 'volume' })[0].score);
});

test('request rejects missing or extra fields, bad IDs, wrong versions, targets, sizes and controls', () => {
  const mutations = [
    value => { delete value.text; }, value => { value.extra = true; },
    value => { value.requestVersion = '0.2'; }, value => { value.target = 'unity'; },
    value => { value.id = 'x'.repeat(65); }, value => { value.id = 'bad.id'; },
    value => { value.id = '1bad'; }, value => { value.id = '中文'; },
    value => { value.id = 'audio\n'; }, value => { value.id = 'audio\r'; },
    value => { value.text = ''; }, value => { value.text = ' \r\n\t'; },
    value => { value.text = 'x'.repeat(8001); }, value => { value.text = 123; },
    value => { value.text = 'volume\u0000'; }, value => { value.text = 'volume\u000b'; },
    value => { value.text = 'volume\u0085'; }, value => { value.text = '\ud800'; },
  ];
  for (const mutate of mutations) {
    const input = request(); mutate(input);
    assert.throws(() => validatePanelRequest(input));
  }
  assert.equal(validatePanelRequest({ ...request(), id: 'A'.repeat(64) }).id.length, 64);
  for (const input of [null, [], false]) assert.throws(() => validatePanelRequest(input));
});

test('request and catalog boundaries reject getters and cycles without invoking user code', async () => {
  let reads = 0;
  const getterRequest = request();
  Object.defineProperty(getterRequest, 'text', { enumerable: true, get() { reads += 1; return 'volume'; } });
  assert.throws(() => validatePanelRequest(getterRequest), /accessors/);
  const getterCatalog = structuredClone(catalog);
  Object.defineProperty(getterCatalog.recipes[0], 'description', { enumerable: true, get() { reads += 1; return 'volume'; } });
  await assert.rejects(createPlanningContext(request(), getterCatalog), /accessors/);
  const cyclic = request(); cyclic.text = cyclic;
  assert.throws(() => validatePanelRequest(cyclic), /cyclic/);
  const cyclicCatalog = structuredClone(catalog); cyclicCatalog.recipes[0].description = cyclicCatalog;
  await assert.rejects(createPlanningContext(request(), cyclicCatalog), /cyclic/);
  assert.equal(reads, 0);
});

test('validator rejects forged candidates, capabilities and fingerprints even after outer rehash', async () => {
  const original = await createPlanningContext(request(), catalog);
  const mutations = [
    value => { value.candidates[0].score += 1; },
    value => { value.candidates[0].kind = 'forged-kind'; },
    value => { value.candidates = []; },
    value => { value.candidates.push({ id: 'made-up', version: '0.1.0', kind: 'slider-row', score: 50 }); },
    value => { value.candidates.reverse(); },
    value => { value.capabilities.semanticReview = 'PASS'; },
    value => { value.requestSha256 = '0'.repeat(64); },
    value => { value.catalogSha256 = '0'.repeat(64); },
    value => { value.catalog.recipes[0].description += ' edited'; },
    value => { value.request.text += ' changed'; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(original); mutate(changed);
    await assert.rejects(validatePlanningContext(await rehash(changed)), /PLANNING_CONTEXT_MISMATCH/);
  }
  await assert.rejects(validatePlanningContext({ ...original, sha256: '0'.repeat(64) }), /PLANNING_CONTEXT_MISMATCH/);
  await assert.rejects(validatePlanningContext({ ...original, unexpected: true }), /unknown field/);
  await assert.rejects(validatePlanningContext({ ...original, planningContextVersion: '0.8' }), /only planning context/);
});

test('validator rejects non-JSON context evidence before touching getters or cyclic values', async () => {
  const original = await createPlanningContext(request(), catalog);
  let reads = 0;
  const withGetter = structuredClone(original);
  Object.defineProperty(withGetter.candidates[0], 'score', { enumerable: true, get() { reads += 1; return 99; } });
  await assert.rejects(validatePlanningContext(withGetter), /accessors/);
  const cycle = structuredClone(original); cycle.candidates.push(cycle);
  await assert.rejects(validatePlanningContext(cycle), /cyclic/);
  assert.equal(reads, 0);
  await assert.rejects(validatePlanningContext(null), /must be an object/);
});
