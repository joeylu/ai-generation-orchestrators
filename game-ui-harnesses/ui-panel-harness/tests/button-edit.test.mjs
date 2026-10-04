import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { core, fixture, catalog, copy, freeze, nodesOf } from './helpers.mjs';
import { digestJson } from '../src/canonical.mjs';
import { applyPanelPatch } from '../src/patch.mjs';
import { createPanelEditContext, validatePanelEditContext, checkPanelEditProposal } from '../src/edit-planning.mjs';
import { createPanelBundle, validatePanelBundle } from '../src/panel-bundle.mjs';
import { createWorkbenchModel } from '../src/workbench-model.mjs';
import { projectPanelEvent } from '../src/state.mjs';
import { controlId } from '../src/compiler.mjs';
import { buildCodexEditResponseSchema } from '../src/codex-edit-schema.mjs';

const controlsCatalog = copy(catalog);
controlsCatalog.recipes.push({ id: 'test.button', version: '1.0.0', kind: 'button-row',
  description: 'Deterministic button edit regression fixture', tags: ['button'],
  states: ['idle', 'hover', 'disabled'], supports: ['pixi'], minWidth: 280, minHeight: 40 });
function sourceSpec() {
  const spec = copy(fixture); spec.panelSpecVersion = '0.3'; spec.assets = null;
  spec.sections[0].rows.push({ id: 'reset-row', kind: 'button', recipe: { id: 'test.button', version: '1.0.0' },
    label: '音量操作', buttonLabel: '恢复音量', enabled: true, event: 'audio.reset',
    action: { kind: 'reset-initial', fields: ['volume'] } });
  return spec;
}
const reset = spec => spec.sections[0].rows.find(row => row.id === 'reset-row');
const patch = async (spec, operations) => ({ patchVersion: '0.1', baseSpecSha256: await digestJson(spec),
  reason: 'Explicit regression edit, not a model output.', operations });
const request = text => ({ requestVersion: '0.1', id: 'button-edit', text, target: 'pixi' });
const proposal = (context, operations) => ({ editProposalVersion: '0.1', contextSha256: context.sha256,
  patch: { patchVersion: '0.1', baseSpecSha256: context.baseSpecSha256, reason: 'Explicit regression proposal.', operations },
  decisions: operations.map((_, operationIndex) => ({ operationIndex,
    basis: { kind: 'request-interpretation', start: 0, end: context.request.text.length, quote: context.request.text } })), unresolved: [] });
const add = () => ({ op: 'add-row', sectionId: 'audio', afterRowId: 'audio-enabled-row',
  row: { id: 'ui-row', kind: 'slider', recipe: { id: 'settings.slider', version: '0.1.0' }, label: '界面音量',
    bind: 'uiVolume', enabled: true, event: 'audio.uiChanged', format: { fractionDigits: 0, prefix: '', suffix: '%' } },
  state: { id: 'uiVolume', type: 'number', initial: 30, min: 0, max: 100, step: 1 } });
const label = () => ({ op: 'set-button-label', rowId: 'reset-row', buttonLabel: '恢复声音' });
const action = fields => ({ op: 'set-button-action', rowId: 'reset-row', action: { kind: 'reset-initial', fields } });
const activation = spec => ({ type: 'activate', id: controlId(spec.id, 'reset-row'), source: 'keyboard' });

test('button text and enabled edit preserve identity, row label and action, and compile the displayed text', async () => {
  const original = freeze(sourceSpec());
  const result = await applyPanelPatch(original, await patch(original, [label(),
    { op: 'set-row-enabled', rowId: 'reset-row', enabled: false }]));
  assert.deepEqual(reset(result.spec), { ...reset(original), buttonLabel: '恢复声音', enabled: false });
  assert.deepEqual(result.spec.state, original.state);
  assert.deepEqual(result.receipt.changedRowIds, ['reset-row']);
  const bundle = await validatePanelBundle(await createPanelBundle(result.spec, controlsCatalog, core), core);
  assert(nodesOf(bundle.componentBundle.document).some(node => node.type === 'Button' && node.props.label === '恢复声音'));
  const current = { volume: 12, audioEnabled: false };
  assert.deepEqual(projectPanelEvent(result.spec, current, activation(result.spec)), { state: current, event: null });
});

test('add slider and update existing reset scope commit together, preserve trial values and undo together', async () => {
  const original = await createPanelBundle(sourceSpec(), controlsCatalog, core);
  const controller = await createWorkbenchModel({ catalog: controlsCatalog, pool: null }, core);
  await controller.importPanel(original);
  const context = (await controller.prepareEdit(request('新增界面音量，0到100步进1默认30；恢复音量同时重置它；主音量默认50；其他不变。'))).context;
  // Reset may refer to the same-batch addition before it appears in the operation list.
  const operations = [action(['volume', 'uiVolume']), add(), { op: 'set-state-initial', fieldId: 'volume', value: 50 }];
  const current = { volume: 12, audioEnabled: false };
  const edited = await controller.acceptEditProposal(proposal(context, operations), current);
  assert.deepEqual(edited.panel.state, { ...current, uiVolume: 30 });
  assert.deepEqual(edited.panel.spec.sections[0].rows.map(row => row.id), ['volume-row', 'audio-enabled-row', 'ui-row', 'reset-row']);
  assert.deepEqual(reset(edited.panel.spec), { ...reset(original.spec), action: { kind: 'reset-initial', fields: ['volume', 'uiVolume'] } });
  assert.deepEqual(edited.history[0].receipt.changedRowIds, ['reset-row', 'ui-row', 'volume-row']);
  const pressed = projectPanelEvent(edited.panel.spec, { ...current, uiVolume: 88 }, activation(edited.panel.spec));
  assert.deepEqual(pressed.state, { volume: 50, audioEnabled: false, uiVolume: 30 });
  assert.equal(pressed.event.name, reset(original.spec).event);
  const exported = await validatePanelBundle(await controller.exportPanel(pressed.state), core);
  assert.deepEqual(exported.spec, edited.panel.spec); assert.deepEqual(exported.state, pressed.state);
  const undone = await controller.undo();
  assert.deepEqual(undone.panel.spec, original.spec); assert.deepEqual(undone.panel.state, current);
});

test('explicit removal plus reset scope update is valid; omitted dependency adjustment fails atomically', async () => {
  const original = freeze(sourceSpec()), remove = { op: 'remove-row', rowId: 'volume-row' };
  await assert.rejects(applyPanelPatch(original, await patch(original, [label(), remove])), { code: 'action-field' });
  const result = await applyPanelPatch(original, await patch(original, [remove, action(['audioEnabled'])]));
  assert.deepEqual(result.spec.state.map(field => field.id), ['audioEnabled']);
  assert.deepEqual(reset(result.spec).action.fields, ['audioEnabled']);
  assert.deepEqual(original, sourceSpec());
});

test('existing button can switch emit/reset only within the existing declarative action contract', async () => {
  const original = sourceSpec();
  const emitted = await applyPanelPatch(original, await patch(original, [{ op: 'set-button-action', rowId: 'reset-row', action: { kind: 'emit' } }]));
  const current = { volume: 12, audioEnabled: false };
  const pressed = projectPanelEvent(emitted.spec, current, activation(emitted.spec));
  assert.deepEqual(pressed.state, current); assert.equal(pressed.event.action, 'emit');
  const restored = await applyPanelPatch(emitted.spec, await patch(emitted.spec, [action(['volume'])]));
  assert.deepEqual(restored.spec, original);
});

test('invalid button targets, labels, action fields and repeated writes cannot hide behind later edits', async () => {
  const original = freeze(sourceSpec());
  for (const [operations, code] of [
    [[{ ...label(), rowId: 'volume-row' }], 'row-kind'],
    [[{ ...action(['volume']), rowId: 'audio-enabled-row' }], 'row-kind'],
    [[{ ...label(), rowId: 'absent' }], 'missing-row'],
    [[{ ...label(), label: 'unknown' }], 'unknown-key'],
    [[{ ...label(), buttonLabel: '' }], 'text'],
    [[{ ...label(), buttonLabel: 'a\nb' }], 'text'],
    [[action([])], 'array'],
    [[action(['volume', 'volume'])], 'duplicate'],
    [[action(['missing'])], 'action-field'],
    [[{ op: 'set-button-action', rowId: 'reset-row', action: { kind: 'execute', script: 'code()' } }], 'action-kind'],
    [[{ op: 'set-button-action', rowId: 'reset-row', action: { kind: 'emit', fields: ['volume'] } }], 'unknown-key'],
    [[label(), label()], 'overlap'],
    [[action(['missing']), action(['volume'])], 'overlap'],
    [[label(), { op: 'remove-row', rowId: 'reset-row' }], 'overlap'],
  ]) {
    await assert.rejects(applyPanelPatch(original, await patch(original, operations)), { code });
    assert.deepEqual(original, sourceSpec());
  }
});

test('button edits still need exact request evidence; legacy contexts keep their hashes and eight operations', async () => {
  const spec = sourceSpec(), context = await createPanelEditContext(spec, controlsCatalog, request('恢复按钮文字改为恢复声音。'));
  const proposed = proposal(context, [label()]);
  assert.equal((await checkPanelEditProposal(context, proposed)).status, 'READY_TO_APPLY');
  proposed.decisions[0].basis = { kind: 'design-choice', reason: '按钮业务行为不是布局。' };
  await assert.rejects(checkPanelEditProposal(context, proposed), { code: 'EDIT_BUSINESS_ORIGIN' });
  const legacy = copy(context); legacy.capabilities.operations.splice(8);
  const { sha256, ...payload } = legacy; legacy.sha256 = await digestJson(payload);
  assert.deepEqual(await validatePanelEditContext(legacy), legacy);
  assert.notEqual(legacy.sha256, context.sha256);
  assert.equal((await checkPanelEditProposal(legacy, proposal(legacy, [{ op: 'set-panel-title', title: '旧协议' }]))).status, 'READY_TO_APPLY');
  await assert.rejects(checkPanelEditProposal(legacy, proposal(legacy, [label()])), { code: 'EDIT_PATCH' });
});

test('failed reset dependency proposal preserves the complete workbench, history and trial snapshot', async () => {
  const controller = await createWorkbenchModel({ catalog: controlsCatalog, pool: null }, core);
  const current = { volume: 12, audioEnabled: false };
  await controller.importPanel(await createPanelBundle(sourceSpec(), controlsCatalog, core, current));
  const before = controller.getSnapshot();
  const context = (await controller.prepareEdit(request('按钮改为恢复声音并删除主音量，其他不变。'))).context;
  await assert.rejects(controller.acceptEditProposal(proposal(context, [label(), { op: 'remove-row', rowId: 'volume-row' }]), current), { code: 'EDIT_RESULT_SPEC' });
  assert.deepEqual(controller.getSnapshot(), before);
});

test('public and native schemas retain exact button keys and only emit/reset action shapes', async () => {
  const schema = JSON.parse(await readFile(new URL('../schemas/panel-patch.schema.json', import.meta.url), 'utf8'));
  assert.deepEqual(schema.$defs.setButtonLabel.required, ['op', 'rowId', 'buttonLabel']);
  assert.deepEqual(schema.$defs.setButtonAction.required, ['op', 'rowId', 'action']);
  assert.equal(schema.$defs.setButtonAction.additionalProperties, false);
  const native = await buildCodexEditResponseSchema();
  const shapes = Object.values(native.$defs);
  for (const [op, keys] of [['set-button-label', ['op', 'rowId', 'buttonLabel']], ['set-button-action', ['op', 'rowId', 'action']]]) {
    const shape = shapes.find(value => value.properties?.op?.enum?.[0] === op);
    assert(shape); assert.deepEqual(shape.required, keys); assert.equal(shape.additionalProperties, false);
  }
  const actionSchema = shapes.find(value => value.properties?.op?.enum?.[0] === 'set-button-action').properties.action;
  const variants = native.$defs[actionSchema.$ref.slice('#/$defs/'.length)].anyOf;
  assert.deepEqual(variants.map(value => value.properties.kind.enum[0]).sort(), ['emit', 'reset-initial']);
  assert(variants.every(value => value.additionalProperties === false));
});
