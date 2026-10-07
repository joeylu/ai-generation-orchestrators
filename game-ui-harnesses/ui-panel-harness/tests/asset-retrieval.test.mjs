import assert from 'node:assert/strict';
import test from 'node:test';
import { createAssetRetrieval, validateAssetRetrieval } from '../src/asset-retrieval.mjs';

const slice = { left: 8, right: 8, top: 8, bottom: 8 };
function record(id, options = {}) {
  const { namespace = 'game-ui', version = '1.0.0', name = '音量', role = 'icon', family = 'audio.volume',
    style = 'mint', variant = 'outline', tags = ['音量', 'volume'], size = { width: 64, height: 64 },
    slice: border = null, sha256 = 'b'.repeat(64), bytes = 256 } = options;
  return {
    key: `${namespace}/${id}@${version}`, namespace,
    metadata: { id, version, name, role, family, style, variant, tags, size, slice: border },
    file: { path: `textures/${sha256}.png`, sha256, bytes },
  };
}
const index = (records = [record('volume')]) => ({ assetLibraryVersion: '0.1', id: 'fixture-assets', sha256: 'a'.repeat(64), records });
const fixtures = () => index([
  record('volume'),
  record('mute', { name: '静音', tags: ['静音', 'mute'], family: 'audio.mute' }),
  record('panel', { name: '面板背景', role: 'shape', family: 'ui.panel', tags: ['面板', 'panel'], slice }),
]);
function assertCode(fn, code) {
  assert.throws(fn, error => error.code === `ASSET_RETRIEVAL_${code}`);
}
function forged(edit, code = 'MISMATCH') {
  const text = '面板含音量和静音', result = createAssetRetrieval(text, fixtures());
  edit(result);
  assertCode(() => validateAssetRetrieval(text, result), code);
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

test('Chinese and NFKC English requests produce portable per-slot candidates without paths', () => {
  const result = createAssetRetrieval('帮我生成面板，包含音量和静音', fixtures());
  assert.deepEqual(result.library, { id: 'fixture-assets', sha256: 'a'.repeat(64) });
  assert.deepEqual(result.policy, { algorithm: 'lexical-v1', latestOnly: true, limitPerSlot: 16, style: null });
  assert.deepEqual(result.candidates.map(x => [x.slot, x.asset.key]), [
    ['panel-surface', 'game-ui/panel@1.0.0'], ['row-icon', 'game-ui/mute@1.0.0'], ['row-icon', 'game-ui/volume@1.0.0'],
  ]);
  assert.deepEqual(result.candidates[2].matchedTerms, ['音量']);
  assert.deepEqual(Object.keys(result.candidates[2].asset).sort(), ['key', 'name', 'role', 'family', 'style', 'variant', 'tags', 'size', 'slice', 'sha256', 'bytes'].sort());
  assert.equal(JSON.stringify(result).includes('textures/'), false);
  const english = createAssetRetrieval('Please add ＶＯＬＵＭＥ and MUTE controls', fixtures());
  assert.deepEqual(english.candidates.map(x => x.matchedTerms), [['mute'], ['volume']]);
  assert.deepEqual(validateAssetRetrieval('帮我生成面板，包含音量和静音', result), result);
});

test('lexical-v1 fixes distinct-term weights, exact-query bonus and sorted evidence', () => {
  const named = record('named'), tagged = record('tagged', { name: '旋钮' });
  const equal = createAssetRetrieval('音量', index([tagged, named]));
  assert.deepEqual(equal.candidates.map(x => [x.asset.key, x.score]), [['game-ui/named@1.0.0', 12], ['game-ui/tagged@1.0.0', 8]]);
  assert.equal(createAssetRetrieval('音量音量音量', index([named])).candidates[0].score, 8);
  const terms = createAssetRetrieval('音量 volume audio.volume', index([named])).candidates[0];
  assert.deepEqual(terms.matchedTerms, ['audio.volume', 'volume', '音量']);
  assert.equal(terms.score, 14);
});

test('Latin whole-word boundaries avoid partial matches while Han matches within prose', () => {
  for (const query of ['volumetric', 'prevolume', 'volume2', 'volume_name', 'volumeé', 'évolume', 'dragon']) {
    assert.deepEqual(createAssetRetrieval(query, index()).candidates, [], query);
  }
  for (const query of ['音量设置', '添加volume滑条', '(volume)', 'volume-setting', 'VOLUME']) {
    assert.equal(createAssetRetrieval(query, index()).candidates.length, 1, query);
  }
  assert.deepEqual(createAssetRetrieval('!!!', index()).candidates, []);
});

test('generic icon/file labels never retrieve unrelated assets; appearance terms only refine matches', () => {
  const input = index([
    record('volume', { tags: ['音量', 'volume', '图标', 'icon', 'outline'] }),
    record('trash', { name: '垃圾桶', tags: ['图标', 'icon', '垃圾桶', 'outline'], family: 'system.trash' }),
    record('monitor', { name: '显示器', tags: ['图标', '图片', '纹理', '素材', 'ui', 'png', 'svg', 'default', 'shape', 'filled'], family: 'device.monitor' }),
  ]);
  for (const text of ['给我图标', 'UI png svg image texture icon icons default shape asset', 'outline filled 描边 填充']) {
    assert.deepEqual(createAssetRetrieval(text, input).candidates, [], text);
  }
  for (const text of ['音量图标', 'volume icon', '音量图片素材']) {
    const result = createAssetRetrieval(text, input);
    assert.deepEqual(result.candidates.map(candidate => candidate.asset.key), ['game-ui/volume@1.0.0']);
    assert.equal(result.candidates[0].matchedTerms.some(term => ['图标', 'icon', '图片', '素材'].includes(term)), false);
    assert.deepEqual(validateAssetRetrieval(text, result), result);
  }
  const refined = createAssetRetrieval('volume outline', input);
  assert.deepEqual(refined.candidates.map(candidate => candidate.asset.key), ['game-ui/volume@1.0.0']);
  assert.deepEqual(refined.candidates[0].matchedTerms, ['outline', 'volume']);
});

test('latest numeric version is selected before role, style and keyword filters', () => {
  const old = record('volume', { version: '1.9.0' }), latest = record('volume', { version: '1.10.0' });
  assert.equal(createAssetRetrieval('音量', index([latest, old])).candidates[0].asset.key, latest.key);
  const changedStyle = record('volume', { version: '2.0.0', style: 'dark' });
  assert.deepEqual(createAssetRetrieval('音量', index([old, changedStyle]), { style: 'mint' }).candidates, []);
  const changedRole = record('volume', { version: '2.0.0', role: 'effect' });
  assert.deepEqual(createAssetRetrieval('音量', index([old, changedRole])).candidates, []);
  const changedTerms = record('volume', { version: '2.0.0', name: '相机', family: 'media.camera', tags: ['相机'] });
  assert.deepEqual(createAssetRetrieval('音量', index([old, changedTerms])).candidates, []);
  const anotherNamespace = record('volume', { namespace: 'other', version: '0.1.0' });
  assert.equal(createAssetRetrieval('音量', index([old, anotherNamespace])).candidates.length, 2);
});

test('only icons and sliced shape/layout assets enter the two planning slots', () => {
  const inputs = [record('icon'), record('sliced-shape', { role: 'shape', slice }),
    record('sliced-layout', { role: 'layout-primitive', slice }), record('unsliced-shape', { role: 'shape' }),
    record('unsliced-layout', { role: 'layout-primitive' }), record('part', { role: 'animation-part', slice }),
    record('effect', { role: 'effect', slice })];
  assert.deepEqual(createAssetRetrieval('音量', index(inputs)).candidates.map(x => x.asset.key), [
    'game-ui/sliced-layout@1.0.0', 'game-ui/sliced-shape@1.0.0', 'game-ui/icon@1.0.0',
  ]);
  assert.deepEqual(createAssetRetrieval('音量', index([])).candidates, []);
  assert.deepEqual(createAssetRetrieval('音量', index([record('effect', { role: 'effect' })])).candidates, []);
});

test('complete multiline requests retain late terms and respect Unicode character bounds', () => {
  const text = `${'前'.repeat(7000)}\r\n\t请添加 volume 和静音`;
  assert.equal(createAssetRetrieval(text, fixtures()).candidates.length, 2);
  const exact = `${'😀'.repeat(7998)}音量`;
  assert.equal([...exact].length, 8000);
  assert.equal(createAssetRetrieval(exact, index()).candidates.length, 1);
  for (const text of ['', '\t\r\n', 'x'.repeat(8001), 'volume\u0000', 'volume\u0085', 'volume\ud800', null, 1]) {
    assertCode(() => createAssetRetrieval(text, index()), 'REQUEST');
  }
  const longName = 'ﷺ'.repeat(120);
  const result = createAssetRetrieval(longName, index([record('long-name', { name: longName })]));
  assert.equal(validateAssetRetrieval(longName, result).candidates.length, 1, 'NFKC expansions remain valid embedded evidence');
});

test('ties, ordering and 16-per-slot limits are deterministic regardless of index order', () => {
  const entries = Array.from({ length: 20 }, (_, n) => record(`icon-${String(n).padStart(2, '0')}`));
  entries.push(...Array.from({ length: 20 }, (_, n) => record(`surface-${String(n).padStart(2, '0')}`, { role: 'shape', slice })));
  const forward = createAssetRetrieval('音量', index(entries)), reverse = createAssetRetrieval('音量', index([...entries].reverse()));
  assert.deepEqual(forward, reverse);
  assert.equal(forward.candidates.length, 32);
  assert.equal(forward.candidates.filter(x => x.slot === 'row-icon').length, 16);
  assert.equal(forward.candidates.filter(x => x.slot === 'panel-surface').length, 16);
  assert.equal(forward.candidates.at(-1).asset.key, 'game-ui/icon-15@1.0.0');
  assert.deepEqual(validateAssetRetrieval('音量', forward), forward);
});

test('offline validation rejects forged scores, terms, ordering, policies and unknown fields', () => {
  forged(value => { value.candidates[0].score++; });
  forged(value => { value.candidates[0].matchedTerms = ['missing']; });
  forged(value => { value.candidates.reverse(); });
  forged(value => { value.candidates[0].matchedTerms.push(value.candidates[0].matchedTerms[0]); });
  forged(value => { value.candidates[0].score = 0; }, 'SCORE');
  forged(value => { value.candidates[0].slot = 'row-icon'; }, 'SLOT');
  forged(value => { value.policy.limitPerSlot = 15; }, 'POLICY');
  forged(value => { value.policy.algorithm = 'vectors'; }, 'POLICY');
  forged(value => { value.policy.latestOnly = false; }, 'POLICY');
  forged(value => { value.policy.style = 'other-style'; });
  forged(value => { value.summary = { count: 3 }; }, 'FIELDS');
  forged(value => { value.candidates[0].asset.path = '/private/file.png'; }, 'FIELDS');
  forged(value => { value.policy.extra = true; }, 'FIELDS');
  forged(value => { delete value.policy.style; }, 'FIELDS');
  forged(value => { value.candidates.push(structuredClone(value.candidates[0])); }, 'DUPLICATE');
});

test('metadata, portable keys, dimensions, slices and byte limits are checked offline', () => {
  forged(value => { value.library.sha256 = 'A'.repeat(64); }, 'LIBRARY');
  forged(value => { value.library.id = 'Upper'; }, 'LIBRARY');
  forged(value => { value.candidates[0].asset.key = 'game-ui/panel@01.0.0'; }, 'KEY');
  forged(value => { value.candidates[0].asset.key = 'game-ui/panel@1000001.0.0'; }, 'KEY');
  forged(value => { value.candidates[0].asset.sha256 = 'z'.repeat(64); }, 'FILE');
  forged(value => { value.candidates[0].asset.bytes = 16 * 1024 * 1024 + 1; }, 'FILE');
  forged(value => { value.candidates[0].asset.bytes = 0; }, 'FILE');
  forged(value => { value.candidates[0].asset.size.width = 4097; }, 'METADATA');
  forged(value => { value.candidates[0].asset.slice.left = 64; }, 'METADATA');
  forged(value => { value.candidates[0].asset.tags = [' Panel ']; }, 'METADATA');
  forged(value => { value.candidates[0].asset.role = 'unknown'; }, 'METADATA');
  forged(value => { delete value.candidates[0].asset.slice; }, 'FIELDS');
});

test('offline replay rejects candidate overflow and multiple embedded versions of one asset', () => {
  const candidates = createAssetRetrieval('音量', index(Array.from({ length: 16 }, (_, n) => record(`icon-${n}`))));
  const extra = structuredClone(candidates.candidates[0]);
  extra.asset.key = 'game-ui/extra@1.0.0'; candidates.candidates.push(extra);
  assertCode(() => validateAssetRetrieval('音量', candidates), 'CANDIDATES');
  const versions = createAssetRetrieval('音量', index());
  const newer = structuredClone(versions.candidates[0]); newer.asset.key = 'game-ui/volume@2.0.0';
  versions.candidates.push(newer);
  assertCode(() => validateAssetRetrieval('音量', versions), 'MISMATCH');
});

test('offline checks do not pretend to prove omitted results or actual library membership', () => {
  const text = '面板含音量和静音', result = createAssetRetrieval(text, fixtures());
  result.candidates[0].asset.sha256 = 'c'.repeat(64);
  assert.deepEqual(validateAssetRetrieval(text, result), result, 'only rebuilding from the verified bound library can detect a substituted well-formed digest');
  result.candidates = [];
  assert.deepEqual(validateAssetRetrieval(text, result), result, 'the library replay, not this local document, proves completeness');
});

test('frozen inputs stay unchanged and returned metadata is isolated', () => {
  const input = freeze(fixtures()), options = freeze({ style: 'mint' });
  const result = createAssetRetrieval('音量', input, options);
  result.candidates[0].asset.tags.push('changed');
  assert.equal(input.records[0].metadata.tags.includes('changed'), false);
  const embedded = freeze(createAssetRetrieval('音量', input));
  const checked = validateAssetRetrieval('音量', embedded);
  checked.candidates[0].asset.name = 'changed';
  assert.equal(embedded.candidates[0].asset.name, '音量');
});

test('getters and malformed index containers fail without executing accessors', () => {
  let invoked = false;
  const poison = () => { invoked = true; return 'unexpected'; };
  const input = index();
  Object.defineProperty(input, 'records', { enumerable: true, get: poison });
  assertCode(() => createAssetRetrieval('音量', input), 'JSON');
  const input2 = index();
  Object.defineProperty(input2.records[0].metadata, 'name', { enumerable: true, get: poison });
  assertCode(() => createAssetRetrieval('音量', input2), 'JSON');
  const options = {};
  Object.defineProperty(options, 'style', { enumerable: true, get: poison });
  assertCode(() => createAssetRetrieval('音量', index(), options), 'JSON');
  const result = createAssetRetrieval('音量', index());
  Object.defineProperty(result.candidates[0].asset, 'name', { enumerable: true, get: poison });
  assertCode(() => validateAssetRetrieval('音量', result), 'JSON');
  assert.equal(invoked, false);
  const sparse = index(); delete sparse.records[0];
  assertCode(() => createAssetRetrieval('音量', sparse), 'INDEX');
  assertCode(() => createAssetRetrieval('音量', index([record('a'), record('a')])), 'DUPLICATE');
  for (const options of [{ style: 'UPPER' }, { style: '' }, { style: 5 }]) assertCode(() => createAssetRetrieval('音量', index(), options), 'STYLE');
  assertCode(() => createAssetRetrieval('音量', index(), { role: 'icon' }), 'FIELDS');
});

test('verified libraries can exceed the generic 1024-entry JSON array cap', () => {
  const entries = Array.from({ length: 1030 }, (_, n) => record(`icon-${String(n).padStart(4, '0')}`));
  assert.equal(createAssetRetrieval('音量', index(entries)).candidates.length, 16);
  const tooMany = index(Array.from({ length: 4097 }, () => record('same')));
  assertCode(() => createAssetRetrieval('音量', tooMany), 'INDEX');
});
