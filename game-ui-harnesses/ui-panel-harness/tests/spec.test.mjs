import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PanelSpecError, validatePanelSpec, validatePanelState } from '../src/spec.mjs';

const fixture = JSON.parse(readFileSync(new URL('../examples/audio-settings.panel.json', import.meta.url), 'utf8'));
const fresh = () => structuredClone(fixture);
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

test('fixture is fully explicit and validator isolates nested caller data', () => {
  const input = fresh();
  const output = validatePanelSpec(input);
  assert.deepEqual(output, input);
  output.sections[0].rows[0].label = 'Changed';
  output.provenance.assumptions.push('New assumption');
  assert.equal(input.sections[0].rows[0].label, '音量');
  assert.equal(input.provenance.assumptions.length, fixture.provenance.assumptions.length);
});

test('required fields, future fields and future versions fail without inferred defaults', () => {
  rejects(value => { delete value.layout.gap; }, 'required', '$.layout.gap');
  rejects(value => { value.sections[0].rows[0].script = 'arbitrary()'; }, 'unknown-key');
  rejects(value => { value.sections[0].rows[1].format = {}; }, 'unknown-key');
  rejects(value => { value.panelSpecVersion = '0.6'; }, 'version');
  rejects(value => { value.theme.version = 'latest'; }, 'version');
  rejects(value => { value.sections[0].rows[0].recipe.version = 'latest'; }, 'version');
  rejects(value => { value.sections[0].rows[0].recipe.id = '../recipe'; }, 'identifier');
  const alternative = fresh();
  alternative.sections[0].rows[0].recipe = { id: 'custom.slider.alternative', version: '2.3.4' };
  assert.deepEqual(validatePanelSpec(alternative).sections[0].rows[0].recipe, alternative.sections[0].rows[0].recipe);
});

test('bindings require unique typed declared state and all state must be used', () => {
  rejects(value => { value.sections[0].rows[0].bind = 'missing'; }, 'binding');
  rejects(value => { value.sections[0].rows[0].bind = 'audioEnabled'; }, 'binding-type');
  rejects(value => { value.state.push({ id: 'extra', type: 'boolean', initial: false }); }, 'unused-state');
  rejects(value => { value.state.push({ ...value.state[0] }); }, 'duplicate');
  rejects(value => {
    const row = structuredClone(value.sections[0].rows[0]);
    row.id = 'second-volume';
    row.event = 'second.changed';
    value.sections[0].rows.push(row);
  }, 'duplicate');
});

test('row and section IDs are globally unique; event channels cannot collide or execute code', () => {
  rejects(value => { value.sections[0].rows[1].id = value.sections[0].rows[0].id; }, 'duplicate');
  rejects(value => { value.sections.push(structuredClone(value.sections[0])); }, 'duplicate');
  rejects(value => { value.sections[0].rows[1].event = value.sections[0].rows[0].event; }, 'duplicate');
  rejects(value => { value.sections[0].rows[0].event = 'doSomething()'; }, 'identifier');
  rejects(value => { value.id = '../escape'; }, 'identifier');
});

test('numeric state validates ranges, initial values and max/initial step alignment', () => {
  rejects(value => { value.state[0].max = value.state[0].min; }, 'range');
  rejects(value => { value.state[0].initial = 101; }, 'range');
  rejects(value => { value.state[0].initial = 0.5; }, 'step');
  rejects(value => { value.state[0].step = 3; }, 'step');
  rejects(value => { value.state[0].step = 0; }, 'step');
  rejects(value => { value.state[0].step = Infinity; }, 'number');
  rejects(value => { value.state[0].initial = '80'; }, 'number');
  rejects(value => { value.state[1].initial = 1; }, 'boolean');
  const value = fresh();
  Object.assign(value.state[0], { min: -0.1, max: 0.9, step: 0.1, initial: 0.2 });
  assert.equal(validatePanelSpec(value).state[0].initial, 0.2);
  assert.equal(validatePanelState(value, { volume: 0.30000000000000004, audioEnabled: true }).volume, 0.30000000000000004);
  assert.throws(() => validatePanelState(value, { volume: 0.30001, audioEnabled: true }), { code: 'step' });
  rejects(value => { Object.assign(value.state[0], { max: 1e15, initial: 1e15 - 0.5 }); }, 'step');
});

test('dimensions, text, Unicode and format are bounded', () => {
  rejects(value => { value.canvas.width = 4097; }, 'integer');
  rejects(value => { value.layout.rowHeight = 0; }, 'integer');
  rejects(value => { value.layout.gap = -1; }, 'integer');
  rejects(value => { value.title = ' '; }, 'text');
  rejects(value => { value.title = 'line\nbreak'; }, 'text');
  rejects(value => { value.title = '\ud800'; }, 'text');
  rejects(value => { value.sections[0].rows[0].format.fractionDigits = 7; }, 'integer');
  const value = fresh();
  value.title = '设置 🎧';
  value.layout.gap = 0;
  assert.equal(validatePanelSpec(value).title, '设置 🎧');
});

test('accessors, prototypes, cycles and non-JSON structures fail without invoking getters', () => {
  let invoked = false;
  rejects(value => {
    Object.defineProperty(value, 'title', { enumerable: true, get() { invoked = true; return 'unsafe'; } });
  }, 'accessor');
  assert.equal(invoked, false);
  rejects(value => { Object.setPrototypeOf(value.theme, { inherited: 'data' }); }, 'prototype');
  rejects(value => { value.extra = value; }, 'cycle');
  rejects(value => { value.state[0].initial = NaN; }, 'number');
  rejects(value => { value.extra = undefined; }, 'json-type');
  rejects(value => { value[Symbol('hidden')] = 'data'; }, 'json-type');
  rejects(value => { Object.defineProperty(value, 'hidden', { value: 'data' }); }, 'json-type');
  rejects(value => { delete value.sections[0].rows[0]; }, 'json-type');
  rejects(value => { value.sections[0].rows.extra = 'data'; }, 'json-type');
});

test('complete state snapshots preserve false/zero and reject extra or absent keys', () => {
  const values = { volume: 0, audioEnabled: false };
  const output = validatePanelState(fixture, values);
  assert.deepEqual(output, values);
  assert.notEqual(output, values);
  assert.throws(() => validatePanelState(fixture, { volume: 80 }), { code: 'required', path: '$.state.audioEnabled' });
  assert.throws(() => validatePanelState(fixture, { volume: 80, audioEnabled: true, extra: false }), { code: 'unknown-key' });
  assert.throws(() => validatePanelState(fixture, { volume: 101, audioEnabled: true }), { code: 'range' });
  assert.throws(() => validatePanelState(fixture, { volume: 80, audioEnabled: 'true' }), { code: 'boolean' });
  const poisoned = JSON.parse('{"volume":80,"audioEnabled":true,"__proto__":{"polluted":true}}');
  assert.throws(() => validatePanelState(fixture, poisoned), { code: 'unknown-key' });
  assert.equal({}.polluted, undefined);
});

test('section/row caps reject oversized documents', () => {
  rejects(value => { value.sections = Array.from({ length: 33 }, () => value.sections[0]); }, 'array');
  rejects(value => { value.sections[0].rows = Array.from({ length: 129 }, () => value.sections[0].rows[0]); }, 'array');
  rejects(value => { value.provenance.assumptions = Array(33).fill('explicit'); }, 'array');
});

test('schema is local JSON and documents secondary semantic validation', () => {
  const schema = JSON.parse(readFileSync(new URL('../schemas/panel-spec.schema.json', import.meta.url), 'utf8'));
  assert.equal(schema.properties.panelSpecVersion.const, fixture.panelSpecVersion);
  assert.equal(schema.additionalProperties, false);
  assert.match(schema.$comment, /cross-reference/);
  for (const definition of [schema.$defs.id, schema.$defs.symbol, schema.$defs.printable, schema.$defs.reference.properties.version]) {
    const pattern = new RegExp(definition.pattern, 'u');
    assert.equal(pattern.test('valid\n'), false);
  }
  const printable = new RegExp(schema.$defs.printable.pattern, 'u');
  assert.equal(printable.test('设置 🎧'), true);
  assert.equal(printable.test('\ud800'), false);
});
