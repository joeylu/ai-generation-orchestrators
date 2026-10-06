import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assetKey } from '../src/asset-descriptor.mjs';
import { PanelSpecError, validatePanelSpec, validatePanelState } from '../src/spec.mjs';

const fixture = JSON.parse(readFileSync(new URL('../examples/audio-settings.panel.json', import.meta.url), 'utf8'));
const schema01 = JSON.parse(readFileSync(new URL('../schemas/panel-spec.schema.json', import.meta.url), 'utf8'));
const schema02 = JSON.parse(readFileSync(new URL('../schemas/panel-spec-v0.2.schema.json', import.meta.url), 'utf8'));
const fresh = () => ({
  ...structuredClone(fixture), panelSpecVersion: '0.2',
  assets: {
    library: { id: 'personal-ui', sha256: 'a3'.repeat(32) },
    panelSurface: 'surfaces/rounded-panel@1.0.0',
    rowIcons: [{ rowId: 'volume-row', asset: 'audio/speaker@1.2.3' }],
  },
});
function rejects(edit, code, path) {
  const value = fresh();
  edit(value);
  assert.throws(() => validatePanelSpec(value), error => {
    assert.ok(error instanceof PanelSpecError);
    assert.equal(error.code, code);
    if (path) assert.equal(error.path, path);
    return true;
  });
}

test('PanelSpec 0.2 isolates exact library and asset selections without modifying its caller', () => {
  const input = fresh();
  const output = validatePanelSpec(input);
  assert.deepEqual(output, input);
  output.assets.library.id = 'changed';
  output.assets.rowIcons[0].asset = 'audio/other@1.0.0';
  assert.equal(input.assets.library.id, 'personal-ui');
  assert.equal(input.assets.rowIcons[0].asset, 'audio/speaker@1.2.3');
  assert.deepEqual(validatePanelState(input, { volume: 0, audioEnabled: false }), { volume: 0, audioEnabled: false });
});

test('PanelSpec 0.1 retains its original contract and rejects assets; future versions still fail', () => {
  assert.deepEqual(validatePanelSpec(fixture), fixture);
  assert.equal(schema01.properties.panelSpecVersion.const, '0.1');
  assert.equal(Object.hasOwn(schema01.properties, 'assets'), false);
  assert.equal(schema01.required.includes('assets'), false);
  const legacyWithAssets = { ...structuredClone(fixture), assets: fresh().assets };
  assert.throws(() => validatePanelSpec(legacyWithAssets), { code: 'unknown-key', path: '$.assets' });
  const future = { ...structuredClone(fixture), panelSpecVersion: '0.8' };
  assert.throws(() => validatePanelSpec(future), { code: 'version', path: '$.panelSpecVersion' });
});

test('0.2 requires a complete asset object and rejects unknown fields at every level', () => {
  for (const [edit, path] of [
    [value => { delete value.assets; }, '$.assets'],
    [value => { delete value.assets.library; }, '$.assets.library'],
    [value => { delete value.assets.library.id; }, '$.assets.library.id'],
    [value => { delete value.assets.library.sha256; }, '$.assets.library.sha256'],
    [value => { delete value.assets.panelSurface; }, '$.assets.panelSurface'],
    [value => { delete value.assets.rowIcons; }, '$.assets.rowIcons'],
    [value => { delete value.assets.rowIcons[0].rowId; }, '$.assets.rowIcons[0].rowId'],
    [value => { delete value.assets.rowIcons[0].asset; }, '$.assets.rowIcons[0].asset'],
  ]) rejects(edit, 'required', path);
  for (const edit of [
    value => { value.assetLibrary = {}; },
    value => { value.assets.path = '/private/path'; },
    value => { value.assets.library.path = '/private/path'; },
    value => { value.assets.rowIcons[0].label = 'unexpected'; },
  ]) rejects(edit, 'unknown-key');
  rejects(value => { value.assets = null; }, 'object');
  rejects(value => { value.assets.library = []; }, 'object');
  rejects(value => { value.assets.rowIcons = {}; }, 'array');
  rejects(value => { value.assets.rowIcons[0] = null; }, 'object');
});

test('at least one explicit selection is required; surface-only and icon-only sources are accepted', () => {
  const surfaceOnly = fresh();
  surfaceOnly.assets.rowIcons = [];
  assert.deepEqual(validatePanelSpec(surfaceOnly).assets, surfaceOnly.assets);
  const iconOnly = fresh();
  iconOnly.assets.panelSurface = null;
  assert.deepEqual(validatePanelSpec(iconOnly).assets, iconOnly.assets);
  rejects(value => { value.assets.panelSurface = null; value.assets.rowIcons = []; }, 'asset-selection', '$.assets');
  rejects(value => { value.assets.panelSurface = ''; }, 'asset-key', '$.assets.panelSurface');
});

test('library slug and SHA-256 are exact, portable and bounded', () => {
  for (const id of ['', 'A', 'a_b', 'two words', 'a/b', 'a'.repeat(65), 'a\n', 'a\ud800', null, 12]) {
    rejects(value => { value.assets.library.id = id; }, 'identifier');
  }
  for (const hash of ['', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64), 'a'.repeat(64) + '\n', null, 12]) {
    rejects(value => { value.assets.library.sha256 = hash; }, 'asset-digest');
  }
  const boundary = fresh();
  boundary.assets.library.id = 'a'.repeat(64);
  boundary.assets.library.sha256 = '0'.repeat(64);
  assert.equal(validatePanelSpec(boundary).assets.library.id.length, 64);
});

test('asset keys share descriptor grammar, bounded versions and strict terminal matching', () => {
  const valid = [assetKey('a', 'b', '0.0.0'), assetKey('audio-ui', 'speaker-filled', '1.20.300'),
    assetKey('a'.repeat(64), 'b'.repeat(64), '1000000.1000000.1000000')];
  const pattern = new RegExp(schema02.$defs.exactAssetKey.pattern, 'u');
  for (const key of valid) {
    const value = fresh(); value.assets.panelSurface = key; value.assets.rowIcons[0].asset = key;
    assert.equal(validatePanelSpec(value).assets.panelSurface, key);
    assert.equal(pattern.test(key), true);
  }
  const invalid = ['', 'audio/speaker', 'audio/speaker@latest', 'Audio/speaker@1.0.0', 'audio/speaker_icon@1.0.0',
    'audio/speaker@01.0.0', 'audio/speaker@1.0.0-beta', 'audio/speaker@1.0.0+build', 'audio/speaker@1.0',
    'audio/speaker@1e2.0.0', 'audio/speaker@-1.0.0', 'audio/speaker@1000001.0.0',
    'audio/speaker@0.1000001.0', 'audio/speaker@0.0.1000001',
    `${'a'.repeat(65)}/b@1.0.0`, `a/${'b'.repeat(65)}@1.0.0`,
    '../speaker@1.0.0', 'https://host/speaker@1.0.0', 'audio\\speaker@1.0.0', 'audio/speaker@1.0.0\n'];
  for (const key of invalid) {
    rejects(value => { value.assets.panelSurface = key; }, 'asset-key');
    rejects(value => { value.assets.rowIcons[0].asset = key; }, 'asset-key');
    assert.equal(pattern.test(key), false, key);
  }
  for (const key of [null, 1, {}, []]) rejects(value => { value.assets.rowIcons[0].asset = key; }, 'asset-key');
});

test('row icons require existing unique stable row IDs, while a shared icon is allowed', () => {
  rejects(value => { value.assets.rowIcons[0].rowId = 'missing-row'; }, 'asset-binding');
  rejects(value => { value.assets.rowIcons[0].rowId = 'volume'; }, 'asset-binding');
  rejects(value => { value.assets.rowIcons[0].rowId = '../volume-row'; }, 'identifier');
  rejects(value => { value.assets.rowIcons.push({ rowId: 'volume-row', asset: 'audio/other@1.0.0' }); }, 'duplicate');
  const value = fresh();
  value.assets.rowIcons.push({ rowId: 'audio-enabled-row', asset: value.assets.rowIcons[0].asset });
  assert.equal(validatePanelSpec(value).assets.rowIcons.length, 2);
});

test('row icon count accepts all 128 supported rows and rejects oversized selections', () => {
  const value = fresh();
  value.state = Array.from({ length: 128 }, (_, index) => ({ id: `state-${index}`, type: 'boolean', initial: false }));
  value.sections[0].rows = value.state.map((field, index) => ({
    id: `row-${index}`, kind: 'switch', recipe: { id: 'settings.switch', version: '0.1.0' },
    label: `Option ${index}`, bind: field.id, enabled: true, event: `option${index}.changed`,
  }));
  value.assets.rowIcons = value.sections[0].rows.map(row => ({ rowId: row.id, asset: 'ui/check@1.0.0' }));
  assert.equal(validatePanelSpec(value).assets.rowIcons.length, 128);
  value.assets.rowIcons.push({ rowId: 'row-0', asset: 'ui/check@1.0.0' });
  assert.throws(() => validatePanelSpec(value), { code: 'array', path: '$.assets.rowIcons' });
});

test('asset subtrees preserve JSON safety, rejecting getters without invoking them', () => {
  let invoked = false;
  rejects(value => {
    Object.defineProperty(value.assets.library, 'sha256', { enumerable: true, get() { invoked = true; return 'a'.repeat(64); } });
  }, 'accessor');
  assert.equal(invoked, false);
  rejects(value => { Object.setPrototypeOf(value.assets.library, { id: 'inherited' }); }, 'prototype');
  rejects(value => { value.assets.rowIcons[0].asset = undefined; }, 'json-type');
  rejects(value => { value.assets.library.extra = value.assets; }, 'cycle');
});

test('0.2 schema adds only versioned asset structure and documents cross-reference limits', () => {
  assert.equal(schema02.properties.panelSpecVersion.const, '0.2');
  assert.equal(schema02.additionalProperties, false);
  assert.equal(schema02.required.includes('assets'), true);
  assert.deepEqual(schema02.$defs.assets.required, ['library', 'panelSurface', 'rowIcons']);
  assert.equal(schema02.$defs.assets.properties.rowIcons.maxItems, 128);
  for (const name of ['id', 'symbol', 'reference', 'text', 'sliderRow', 'switchRow', 'numberState', 'booleanState']) {
    assert.deepEqual(schema02.$defs[name], schema01.$defs[name]);
  }
  assert.match(schema02.$comment, /existing, unique row ID/);
  assert.match(schema02.$comment, /compatible roles are resolved outside/);
  for (const definition of [schema02.$defs.assetSlug, schema02.$defs.assets.properties.library.properties.sha256]) {
    assert.equal(new RegExp(definition.pattern, 'u').test('a'.repeat(64) + '\n'), false);
  }
});
