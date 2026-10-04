import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { digestJson } from '../src/canonical.mjs';
import { applyPanelPatch, PanelPatchError } from '../src/patch.mjs';

const fixture = JSON.parse(readFileSync(new URL('../examples/audio-settings.panel.json', import.meta.url), 'utf8'));
const fresh = () => structuredClone(fixture);
const rowIds = spec => spec.sections.flatMap(section => section.rows.map(row => row.id));
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const patchFor = async (spec, operations) => ({ patchVersion: '0.1', baseSpecSha256: await digestJson(spec), reason: '明确的局部面板修改', operations });
const labelOp = () => ({ op: 'set-row-label', rowId: 'volume-row', label: '主音量' });
function addOp() {
  return {
    op: 'add-row', sectionId: 'audio', afterRowId: 'volume-row',
    row: { id: 'music-row', kind: 'slider', recipe: { id: 'settings.slider', version: '0.1.0' }, label: '音乐音量', bind: 'musicVolume', enabled: true, event: 'audio.musicVolumeChanged', format: { fractionDigits: 0, prefix: '', suffix: '%' } },
    state: { id: 'musicVolume', type: 'number', initial: 60, min: 0, max: 100, step: 1 },
  };
}

test('adding a slider preserves every existing row/state and records exact source, patch and result digests', async () => {
  const spec = freeze(fresh());
  const patch = freeze(await patchFor(spec, [addOp()]));
  const result = await applyPanelPatch(spec, patch);
  assert.deepEqual(rowIds(result.spec), ['volume-row', 'music-row', 'audio-enabled-row']);
  assert.deepEqual(result.spec.sections[0].rows[0], spec.sections[0].rows[0]);
  assert.deepEqual(result.spec.sections[0].rows[2], spec.sections[0].rows[1]);
  assert.deepEqual(result.spec.state.slice(0, 2), spec.state);
  assert.deepEqual(result.spec.provenance, spec.provenance);
  assert.deepEqual(result.receipt, {
    patchVersion: '0.1', baseSpecSha256: await digestJson(spec), patchSha256: await digestJson(patch),
    resultSpecSha256: await digestJson(result.spec), changedRowIds: ['music-row'], status: 'APPLIED',
  });
  result.spec.sections[0].rows[1].format.suffix = 'modified';
  assert.equal(patch.operations[0].row.format.suffix, '%');
  assert.deepEqual(spec, fixture);
});

test('null insertion anchor adds first and stable-ID removal deletes only the paired state', async () => {
  const spec = fresh();
  const operation = addOp();
  operation.afterRowId = null;
  const added = await applyPanelPatch(spec, await patchFor(spec, [operation]));
  assert.deepEqual(rowIds(added.spec), ['music-row', 'volume-row', 'audio-enabled-row']);
  const removed = await applyPanelPatch(added.spec, await patchFor(added.spec, [{ op: 'remove-row', rowId: 'music-row' }]));
  assert.deepEqual(removed.spec, spec);
  assert.deepEqual(removed.receipt.changedRowIds, ['music-row']);
});

test('a stale digest or reordered source rejects before any candidate can be returned', async () => {
  const spec = fresh();
  const patch = await patchFor(spec, [labelOp()]);
  spec.sections[0].rows.reverse();
  await assert.rejects(applyPanelPatch(spec, patch), error => error instanceof PanelPatchError && error.code === 'base-digest');
  patch.baseSpecSha256 = '0'.repeat(64);
  await assert.rejects(applyPanelPatch(fixture, patch), { code: 'base-digest' });
});

test('source and patch are snapshotted before asynchronous digest computation', async () => {
  const spec = fresh();
  const patch = await patchFor(spec, [labelOp()]);
  const pending = applyPanelPatch(spec, patch);
  spec.title = 'caller mutation';
  patch.operations[0].label = 'caller mutation';
  const result = await pending;
  assert.equal(result.spec.title, fixture.title);
  assert.equal(result.spec.sections[0].rows[0].label, '主音量');
});

test('different row properties and paired initial value can change together with sorted unique changed IDs', async () => {
  const spec = fresh();
  const result = await applyPanelPatch(spec, await patchFor(spec, [
    labelOp(), { op: 'set-row-enabled', rowId: 'volume-row', enabled: false },
    { op: 'set-state-initial', fieldId: 'volume', value: 0 },
    { op: 'set-state-initial', fieldId: 'audioEnabled', value: false },
  ]));
  assert.equal(result.spec.sections[0].rows[0].label, '主音量');
  assert.equal(result.spec.sections[0].rows[0].enabled, false);
  assert.equal(result.spec.state[0].initial, 0);
  assert.equal(result.spec.state[1].initial, false);
  assert.deepEqual(result.receipt.changedRowIds, ['audio-enabled-row', 'volume-row']);
});

test('global edits require full layout and preserve all stable IDs; catalog resolution remains separate', async () => {
  const spec = fresh();
  const result = await applyPanelPatch(spec, await patchFor(spec, [
    { op: 'set-panel-title', title: '音频设置' },
    { op: 'set-theme', theme: { id: 'custom-theme', version: '2.3.4' } },
    { op: 'set-layout', layout: { ...spec.layout, gap: 24 } },
  ]));
  assert.deepEqual(rowIds(result.spec), rowIds(spec));
  assert.equal(result.spec.title, '音频设置');
  assert.equal(result.spec.theme.id, 'custom-theme');
  assert.equal(result.spec.layout.gap, 24);
  assert.deepEqual(result.receipt.changedRowIds, []);
  await assert.rejects(applyPanelPatch(spec, await patchFor(spec, [{ op: 'set-layout', layout: { gap: 24 } }])), { code: 'required' });
});

test('removing a last section row fails atomically without deleting the section or earlier edits', async () => {
  const spec = fresh();
  spec.sections.push({ id: 'secondary', title: '其他', rows: [spec.sections[0].rows.pop()] });
  const original = structuredClone(spec);
  const patch = await patchFor(spec, [labelOp(), { op: 'remove-row', rowId: 'audio-enabled-row' }]);
  await assert.rejects(applyPanelPatch(spec, patch), { code: 'array', path: '$.sections[1].rows' });
  assert.deepEqual(spec, original);
  assert.deepEqual(patch.operations[0], labelOp());
});

test('invalid initial types, bounds, steps, labels and enabled values cannot pass final validation', async () => {
  const spec = fresh();
  for (const [operation, code] of [
    [{ op: 'set-state-initial', fieldId: 'volume', value: 0.5 }, 'step'],
    [{ op: 'set-state-initial', fieldId: 'volume', value: 101 }, 'range'],
    [{ op: 'set-state-initial', fieldId: 'audioEnabled', value: 1 }, 'boolean'],
    [{ op: 'set-row-label', rowId: 'volume-row', label: ' ' }, 'text'],
    [{ op: 'set-row-enabled', rowId: 'volume-row', enabled: 'false' }, 'boolean'],
  ]) await assert.rejects(applyPanelPatch(spec, await patchFor(spec, [operation])), { code });
  assert.deepEqual(spec, fixture);
});

test('duplicate events, IDs, missing row fields and incompatible added state are rejected', async () => {
  const spec = fresh();
  for (const [edit, code] of [
    [op => { op.row.event = 'audio.volumeChanged'; }, 'duplicate'],
    [op => { op.row.id = 'volume-row'; }, 'duplicate'],
    [op => { op.state.id = op.row.bind = 'volume'; }, 'duplicate'],
    [op => { op.row.bind = 'volume'; }, 'binding'],
    [op => { op.state = { id: 'musicVolume', type: 'boolean', initial: true }; }, 'binding-type'],
    [op => { delete op.row.format; }, 'required'],
    [op => { op.row.script = 'execute()'; }, 'unknown-key'],
  ]) {
    const operation = addOp();
    edit(operation);
    await assert.rejects(applyPanelPatch(spec, await patchFor(spec, [operation])), { code });
  }
});

test('unknown target IDs and anchors are rejected, including an anchor from another section', async () => {
  const spec = fresh();
  for (const [operation, code] of [
    [{ ...labelOp(), rowId: 'absent' }, 'missing-row'],
    [{ op: 'set-state-initial', fieldId: 'absent', value: 1 }, 'missing-state'],
    [{ ...addOp(), sectionId: 'absent' }, 'missing-section'],
    [{ ...addOp(), afterRowId: 'absent' }, 'missing-anchor'],
    [{ op: 'remove-row', rowId: 'absent' }, 'missing-row'],
  ]) await assert.rejects(applyPanelPatch(spec, await patchFor(spec, [operation])), { code });
  spec.sections.push({ id: 'secondary', title: '其他', rows: [spec.sections[0].rows.pop()] });
  await assert.rejects(applyPanelPatch(spec, await patchFor(spec, [{ ...addOp(), afterRowId: 'audio-enabled-row' }])), { code: 'missing-anchor' });
});

test('overlapping writes cannot mask invalid values or replace existing identities', async () => {
  const spec = fresh();
  for (const operations of [
    [labelOp(), labelOp()],
    [{ op: 'set-panel-title', title: '' }, { op: 'set-panel-title', title: 'valid' }],
    [labelOp(), { op: 'remove-row', rowId: 'volume-row' }],
    [{ op: 'set-state-initial', fieldId: 'volume', value: -1 }, { op: 'remove-row', rowId: 'volume-row' }],
    [addOp(), { op: 'set-row-enabled', rowId: 'music-row', enabled: false }],
    [addOp(), { op: 'set-state-initial', fieldId: 'musicVolume', value: 20 }],
    [addOp(), { op: 'remove-row', rowId: 'music-row' }],
    [{ op: 'remove-row', rowId: 'volume-row' }, { ...addOp(), row: { ...addOp().row, id: 'volume-row' } }],
  ]) await assert.rejects(applyPanelPatch(spec, await patchFor(spec, operations)), { code: 'overlap' });
});

test('patch structure rejects path/index addressing, unknown fields, receipt injection and unsupported operations', async () => {
  const spec = fresh();
  for (const [edit, code] of [
    [patch => { patch.receipt = { status: 'APPLIED' }; }, 'unknown-key'],
    [patch => { patch.operations[0].path = '/sections/0/rows/0'; }, 'unknown-key'],
    [patch => { patch.operations[0].rowId = 0; }, 'text'],
    [patch => { patch.operations[0].rowId = 'sections[0].rows[0]'; }, 'identifier'],
    [patch => { patch.operations[0].op = 'constructor'; }, 'operation'],
    [patch => { patch.operations[0].op = 'replace'; }, 'operation'],
    [patch => { delete patch.operations[0].label; }, 'required'],
    [patch => { patch.patchVersion = '0.2'; }, 'version'],
    [patch => { patch.baseSpecSha256 = 'a'.repeat(64) + '\n'; }, 'digest'],
    [patch => { patch.operations = []; }, 'array'],
    [patch => { patch.operations = Array(33).fill(labelOp()); }, 'array'],
    [patch => { patch.reason = ' '; }, 'text'],
    [patch => { patch.reason = 'x'.repeat(1001); }, 'text'],
  ]) {
    const patch = await patchFor(spec, [labelOp()]);
    edit(patch);
    await assert.rejects(applyPanelPatch(spec, patch), { code });
  }
});

test('getters and malformed object graphs fail without invoking code or polluting prototypes', async () => {
  const spec = fresh();
  let invoked = false;
  for (const [edit, code] of [
    [patch => { Object.defineProperty(patch.operations[0], 'label', { enumerable: true, get() { invoked = true; return 'unsafe'; } }); }, 'accessor'],
    [patch => { Object.setPrototypeOf(patch.operations[0], { inherited: true }); }, 'prototype'],
    [patch => { patch.reason = patch; }, 'cycle'],
    [patch => { patch.operations[0].label = undefined; }, 'json-type'],
    [patch => { patch.operations[0][Symbol('hidden')] = true; }, 'json-type'],
    [patch => { delete patch.operations[0]; }, 'json-type'],
  ]) {
    const patch = await patchFor(spec, [labelOp()]);
    edit(patch);
    await assert.rejects(applyPanelPatch(spec, patch), { code });
  }
  const patch = await patchFor(spec, [JSON.parse('{"op":"set-row-label","rowId":"volume-row","label":"volume","__proto__":{"polluted":true}}')]);
  await assert.rejects(applyPanelPatch(spec, patch), { code: 'unknown-key' });
  assert.equal(invoked, false);
  assert.equal({}.polluted, undefined);
});

test('invalid source cannot be repaired through a patch and repeated no-op values do not claim row changes', async () => {
  const spec = fresh();
  const patch = await patchFor(spec, [{ ...labelOp(), label: spec.sections[0].rows[0].label }]);
  const result = await applyPanelPatch(spec, patch);
  assert.deepEqual(result.receipt.changedRowIds, []);
  assert.equal(result.receipt.resultSpecSha256, result.receipt.baseSpecSha256);
  spec.state[0].initial = 101;
  await assert.rejects(applyPanelPatch(spec, await patchFor(spec, [{ op: 'set-state-initial', fieldId: 'volume', value: 80 }])), { code: 'range' });
});

test('patch schema lists the exact operation surface and points to the existing PanelSpec definitions', () => {
  const schema = JSON.parse(readFileSync(new URL('../schemas/panel-patch.schema.json', import.meta.url), 'utf8'));
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.operations.maxItems, 32);
  assert.equal(schema.properties.operations.items.oneOf.length, 10);
  assert.match(schema.$comment, /overlap/);
  const digestPattern = new RegExp(schema.properties.baseSpecSha256.pattern, 'u');
  assert.equal(digestPattern.test('a'.repeat(64)), true);
  assert.equal(digestPattern.test('a'.repeat(64) + '\n'), false);
  for (const { $ref } of schema.properties.operations.items.oneOf) {
    const operation = schema.$defs[$ref.split('/').at(-1)];
    assert.equal(operation.additionalProperties, false);
    assert.ok(operation.required.includes('op'));
  }
});
