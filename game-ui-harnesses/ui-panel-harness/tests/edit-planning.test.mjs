import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { digestJson } from '../src/canonical.mjs';
import { applyPanelPatch } from '../src/patch.mjs';
import {
  PanelEditPlanningError, createPanelEditContext, validatePanelEditContext,
  validatePanelEditProposal, checkPanelEditProposal, requireReadyEditProposal,
} from '../src/index.mjs';

const fixture = JSON.parse(readFileSync(new URL('../examples/audio-settings.panel.json', import.meta.url), 'utf8'));
const catalog = JSON.parse(readFileSync(new URL('../catalog/modern-core.json', import.meta.url), 'utf8'));
const copy = value => structuredClone(value);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const request = (text = '将😀音量标签改为主音量，禁用音量控件，初值设为30，加入音乐音量并移除声音开关。') => ({ requestVersion: '0.1', id: 'edit-audio', text, target: 'pixi' });
const contextFor = (text) => createPanelEditContext(fixture, catalog, request(text));
const labelOp = () => ({ op: 'set-row-label', rowId: 'volume-row', label: '主音量' });
const sourceBasis = context => ({ kind: 'request-interpretation', start: 0, end: context.request.text.length, quote: context.request.text });
const designBasis = () => ({ kind: 'design-choice', reason: '保持主题一致并调整间距。' });
const unresolved = () => [{ id: 'desired-title', question: '面板标题应当是什么？' }];
function proposalFor(context, operations = [labelOp()]) {
  return {
    editProposalVersion: '0.1', contextSha256: context.sha256,
    patch: { patchVersion: '0.1', baseSpecSha256: context.baseSpecSha256, reason: '明确的局部面板修改', operations },
    decisions: operations.map((operation, operationIndex) => ({ operationIndex, basis: sourceBasis(context) })),
    unresolved: [],
  };
}
function addOp() {
  return {
    op: 'add-row', sectionId: 'audio', afterRowId: 'volume-row',
    row: { id: 'music-row', kind: 'slider', recipe: { id: 'settings.slider', version: '0.1.0' }, label: '音乐音量', bind: 'musicVolume', enabled: true, event: 'audio.musicVolumeChanged', format: { fractionDigits: 0, prefix: '', suffix: '%' } },
    state: { id: 'musicVolume', type: 'number', initial: 60, min: 0, max: 100, step: 1 },
  };
}
async function rehash(context) {
  const { sha256, ...payload } = context;
  return { ...payload, sha256: await digestJson(payload) };
}

test('context binds exact independent request, Spec and catalog with only bounded edit capabilities', async () => {
  const inputSpec = freeze(copy(fixture)), inputCatalog = freeze(copy(catalog));
  const inputRequest = freeze(request('  初值改为30\r\n\t😀  '));
  const context = await createPanelEditContext(inputSpec, inputCatalog, inputRequest);
  assert.deepEqual(Object.keys(context).sort(), ['editContextVersion', 'request', 'spec', 'catalog', 'baseSpecSha256', 'catalogSha256', 'capabilities', 'sha256'].sort());
  assert.equal(context.editContextVersion, '0.1');
  assert.deepEqual(context.request, inputRequest);
  assert.deepEqual(context.spec, inputSpec);
  assert.deepEqual(context.catalog, inputCatalog);
  assert.notEqual(context.request, inputRequest);
  assert.notEqual(context.spec, inputSpec);
  assert.notEqual(context.catalog, inputCatalog);
  assert.equal(context.baseSpecSha256, await digestJson(inputSpec));
  assert.equal(context.catalogSha256, await digestJson(inputCatalog));
  assert.deepEqual(context.capabilities, {
    operations: ['set-panel-title', 'set-theme', 'set-layout', 'set-row-label', 'set-row-enabled', 'set-state-initial', 'add-row', 'remove-row', 'set-button-label', 'set-button-action'],
    target: 'pixi', statePolicy: 'preserve-current-at-apply', semanticReview: 'NOT_RUN',
  });
  assert.deepEqual(await rehash(context), context);
  assert.deepEqual(await createPanelEditContext(inputSpec, inputCatalog, inputRequest), context);
  assert.deepEqual(await validatePanelEditContext(freeze(copy(context))), context);
  assert.equal(Object.hasOwn(context, 'state'), false);
  assert.equal(Object.hasOwn(context, 'liveState'), false);
  context.spec.state[0].initial = 30;
  assert.notEqual(context.spec.state[0].initial, fixture.state[0].initial);
  assert.deepEqual(inputSpec, fixture);
});

test('context validates all inputs and rejects malformed versions, exact fields and forged evidence', async () => {
  const original = await contextFor();
  const invalidSpec = copy(fixture); invalidSpec.state[0].initial = 101;
  await assert.rejects(createPanelEditContext(invalidSpec, catalog, request()), { code: 'EDIT_SPEC' });
  await assert.rejects(createPanelEditContext(fixture, { ...catalog, catalogVersion: '9' }, request()), { code: 'EDIT_CATALOG' });
  await assert.rejects(createPanelEditContext(fixture, catalog, request(' ')), { code: 'EDIT_REQUEST' });
  await assert.rejects(validatePanelEditContext(null), { code: 'EDIT_OBJECT' });
  await assert.rejects(validatePanelEditContext({ ...original, liveState: { volume: 10 } }), { code: 'EDIT_FIELDS' });
  await assert.rejects(validatePanelEditContext({ ...original, editContextVersion: '0.2' }), { code: 'EDIT_CONTEXT_VERSION' });
  for (const mutate of [
    value => { value.spec.title = 'changed'; },
    value => { value.spec.state[0].initial = 30; },
    value => { value.catalog.recipes[0].description += ' changed'; },
    value => { value.baseSpecSha256 = '0'.repeat(64); },
    value => { value.catalogSha256 = '0'.repeat(64); },
    value => { value.capabilities.operations.reverse(); },
    value => { value.capabilities.operations.push('set-canvas'); },
    value => { value.capabilities.semanticReview = 'PASS'; },
    value => { value.capabilities.statePolicy = 'reset-to-initial'; },
  ]) {
    const changed = copy(original); mutate(changed);
    await assert.rejects(validatePanelEditContext(await rehash(changed)), { code: 'EDIT_CONTEXT_MISMATCH' });
  }
  for (const mutate of [value => { value.request.text += ' changed'; }, value => { value.sha256 = '0'.repeat(64); }]) {
    const changed = copy(original); mutate(changed);
    await assert.rejects(validatePanelEditContext(changed), { code: 'EDIT_CONTEXT_MISMATCH' });
  }
});

test('report still binds the legacy eight patch operations without claiming compilation, semantic or visual review', async () => {
  const context = await contextFor();
  const operations = [
    { op: 'set-panel-title', title: '音频偏好' },
    { op: 'set-theme', theme: { id: 'unresolved-at-compilation', version: '0.1.0' } },
    { op: 'set-layout', layout: { ...fixture.layout, gap: 24 } },
    labelOp(), { op: 'set-row-enabled', rowId: 'volume-row', enabled: false },
    { op: 'set-state-initial', fieldId: 'volume', value: 30 },
    addOp(), { op: 'remove-row', rowId: 'audio-enabled-row' },
  ];
  const proposal = proposalFor(context, operations);
  for (const index of [1, 2]) proposal.decisions[index].basis = designBasis();
  const expected = await applyPanelPatch(context.spec, proposal.patch);
  const checked = await validatePanelEditProposal(freeze(copy(context)), freeze(copy(proposal)));
  assert.deepEqual(checked, proposal);
  assert.notEqual(checked, proposal);
  const report = await checkPanelEditProposal(context, proposal);
  assert.deepEqual(report, {
    editPlanningReportVersion: '0.1', contextSha256: context.sha256, proposalSha256: await digestJson(proposal),
    baseSpecSha256: context.baseSpecSha256, status: 'READY_TO_APPLY', unresolvedCount: 0, operationCount: 8,
    resultSpecSha256: await digestJson(expected.spec), changedRowIds: ['audio-enabled-row', 'music-row', 'volume-row'],
    semanticReview: 'NOT_RUN', humanVisualReview: 'NOT_RUN', compilation: 'NOT_RUN',
  });
  assert.deepEqual(await requireReadyEditProposal(context, proposal), { proposal, report });
  assert.deepEqual(context.spec, fixture);
  assert.equal(expected.spec.state.find(field => field.id === 'volume').initial, 30);
  assert.equal(Object.hasOwn(checked.patch, 'provenance'), false);
});

test('proposal binds both context and exact base Spec; caller changes require a new context', async () => {
  const context = await contextFor(), proposal = proposalFor(context);
  await assert.rejects(validatePanelEditProposal(context, { ...proposal, contextSha256: '0'.repeat(64) }), { code: 'EDIT_CONTEXT_MISMATCH' });
  const stale = copy(proposal); stale.patch.baseSpecSha256 = '0'.repeat(64);
  await assert.rejects(validatePanelEditProposal(context, stale), { code: 'EDIT_BASE_MISMATCH' });
  const changedSpec = copy(fixture); changedSpec.state[0].initial = 30;
  const changedContext = await createPanelEditContext(changedSpec, catalog, request());
  assert.notEqual(changedContext.sha256, context.sha256);
  assert.notEqual(changedContext.baseSpecSha256, context.baseSpecSha256);
  await assert.rejects(requireReadyEditProposal(changedContext, proposal), { code: 'EDIT_CONTEXT_MISMATCH' });
  const changedRequest = await contextFor('把音量改为主音量。');
  await assert.rejects(validatePanelEditProposal(changedRequest, proposal), { code: 'EDIT_CONTEXT_MISMATCH' });
});

test('patch rejection preserves unsupported operations, conflicting writes and invalid result Spec failures', async () => {
  const context = await contextFor();
  for (const operations of [
    [{ op: 'set-canvas', canvas: { width: 1000, height: 1000 } }],
    [{ op: 'set-button-action', rowId: 'volume-row', action: { type: 'emit', event: 'custom' } }],
    [{ op: 'set-assets', assets: {} }], [{ op: 'execute', script: 'run()' }],
    [labelOp(), labelOp()], [labelOp(), { op: 'remove-row', rowId: 'volume-row' }],
    [{ ...labelOp(), path: '/sections/0/rows/0' }],
  ]) await assert.rejects(validatePanelEditProposal(context, proposalFor(context, operations)), { code: 'EDIT_PATCH' });
  for (const operations of [
    [{ op: 'set-state-initial', fieldId: 'volume', value: 101 }],
    [{ ...labelOp(), label: '' }], [{ op: 'set-layout', layout: { gap: 24 } }],
    [{ op: 'remove-row', rowId: 'volume-row' }, { op: 'remove-row', rowId: 'audio-enabled-row' }],
  ]) await assert.rejects(validatePanelEditProposal(context, proposalFor(context, operations)), { code: 'EDIT_RESULT_SPEC' });
  const extended = proposalFor(context); extended.patch.provenance = { kind: 'agent-authored' };
  await assert.rejects(validatePanelEditProposal(context, extended), { code: 'EDIT_PATCH' });
});

test('every operation requires one exact indexed decision and business operations forbid design defaults', async () => {
  const context = await contextFor();
  for (const [mutate, code] of [
    [value => { value.decisions = []; }, 'EDIT_COVERAGE'],
    [value => { value.decisions.push(copy(value.decisions[0])); }, 'EDIT_OPERATION_INDEX'],
    [value => { value.decisions[0].operationIndex = -1; }, 'EDIT_OPERATION_INDEX'],
    [value => { value.decisions[0].operationIndex = 1; }, 'EDIT_OPERATION_INDEX'],
    [value => { value.decisions[0].operationIndex = 0.5; }, 'EDIT_OPERATION_INDEX'],
    [value => { value.decisions[0].operationIndex = '0'; }, 'EDIT_OPERATION_INDEX'],
    [value => { value.decisions[0].basis = { kind: 'inferred' }; }, 'EDIT_BASIS'],
    [value => { value.decisions[0].extra = true; }, 'EDIT_FIELDS'],
    [value => { value.extra = true; }, 'EDIT_FIELDS'],
    [value => { value.editProposalVersion = '0.2'; }, 'EDIT_PROPOSAL_VERSION'],
  ]) {
    const proposal = proposalFor(context); mutate(proposal);
    await assert.rejects(validatePanelEditProposal(context, proposal), { code });
  }
  for (const operation of [
    { op: 'set-panel-title', title: '音频' }, labelOp(),
    { op: 'set-row-enabled', rowId: 'volume-row', enabled: false },
    { op: 'set-state-initial', fieldId: 'volume', value: 30 }, addOp(),
    { op: 'remove-row', rowId: 'audio-enabled-row' },
  ]) {
    const proposal = proposalFor(context, [operation]); proposal.decisions[0].basis = designBasis();
    await assert.rejects(validatePanelEditProposal(context, proposal), { code: 'EDIT_BUSINESS_ORIGIN' });
  }
  const reordered = proposalFor(context, [labelOp(), { op: 'set-state-initial', fieldId: 'volume', value: 30 }]);
  reordered.decisions.reverse();
  assert.deepEqual(await validatePanelEditProposal(context, reordered), reordered);
});

test('source offsets are strict UTF-16 half-open spans and cannot split surrogate pairs or rewrite quotes', async () => {
  const context = await contextFor('将😀音量\r\n\t改为主音量。');
  const emoji = { kind: 'request-interpretation', start: 1, end: 3, quote: '😀' };
  const proposal = proposalFor(context); proposal.decisions[0].basis = emoji;
  assert.deepEqual(await validatePanelEditProposal(context, proposal), proposal);
  for (const [basis, code] of [
    [{ ...emoji, start: 2, quote: '\ude00' }, 'EDIT_SPAN'],
    [{ ...emoji, end: 2, quote: '\ud83d' }, 'EDIT_SPAN'],
    [{ ...emoji, start: -1 }, 'EDIT_SPAN'], [{ ...emoji, start: 1.5 }, 'EDIT_SPAN'],
    [{ ...emoji, end: 100 }, 'EDIT_SPAN'], [{ ...emoji, start: 3 }, 'EDIT_SPAN'],
    [{ ...emoji, quote: '音量' }, 'EDIT_QUOTE'], [{ ...emoji, quote: 1 }, 'EDIT_QUOTE'],
    [{ kind: 'request-interpretation', start: 5, end: 8, quote: '\r\n\t' }, 'EDIT_QUOTE'],
    [{ ...emoji, reason: 'extra' }, 'EDIT_FIELDS'],
  ]) {
    const changed = copy(proposal); changed.decisions[0].basis = basis;
    await assert.rejects(validatePanelEditProposal(context, changed), { code });
  }
});

test('questions permit a null patch but block readiness even when a valid patch is supplied', async () => {
  const context = await contextFor();
  const proposal = { ...proposalFor(context), patch: null, decisions: [], unresolved: unresolved() };
  assert.deepEqual(await validatePanelEditProposal(context, proposal), proposal);
  const report = await checkPanelEditProposal(context, proposal);
  assert.equal(report.status, 'NEEDS_INPUT');
  assert.equal(report.unresolvedCount, 1);
  assert.equal(report.operationCount, 0);
  assert.equal(report.resultSpecSha256, null);
  assert.deepEqual(report.changedRowIds, []);
  await assert.rejects(requireReadyEditProposal(context, proposal), error => error instanceof PanelEditPlanningError && error.code === 'EDIT_PLAN_NEEDS_INPUT');
  await assert.rejects(validatePanelEditProposal(context, { ...proposal, unresolved: [] }), { code: 'EDIT_EMPTY_PATCH' });
  await assert.rejects(validatePanelEditProposal(context, { ...proposal, decisions: proposalFor(context).decisions }), { code: 'EDIT_EMPTY_PATCH' });
  const partial = { ...proposalFor(context), unresolved: unresolved() };
  const partialReport = await checkPanelEditProposal(context, partial);
  assert.equal(partialReport.status, 'NEEDS_INPUT');
  assert.equal(partialReport.operationCount, 1);
  assert.match(partialReport.resultSpecSha256, /^[a-f0-9]{64}$/);
  await assert.rejects(requireReadyEditProposal(context, partial), { code: 'EDIT_PLAN_NEEDS_INPUT' });
});

test('question lists require unique bounded ASCII identifiers and bounded nonempty control-free text', async () => {
  const context = await contextFor();
  for (const [questions, code] of [
    [Array(65).fill(unresolved()[0]), 'EDIT_LIST'],
    [[...unresolved(), ...unresolved()], 'EDIT_UNRESOLVED_ID'],
    [[{ id: '不确定', question: '哪一项？' }], 'EDIT_UNRESOLVED_ID'],
    [[{ id: '0question', question: '哪一项？' }], 'EDIT_UNRESOLVED_ID'],
    [[{ id: 'a'.repeat(65), question: '哪一项？' }], 'EDIT_TEXT'],
    [[{ id: 'question', question: ' ' }], 'EDIT_TEXT'],
    [[{ id: 'question', question: '😀'.repeat(501) }], 'EDIT_TEXT'],
    [[{ id: 'question', question: '第一行\n第二行' }], 'EDIT_TEXT'],
    [[{ id: 'question', question: '\ud800' }], 'EDIT_TEXT'],
    [[{ id: 'question', question: '哪一项？', answer: '猜测' }], 'EDIT_FIELDS'],
  ]) {
    await assert.rejects(validatePanelEditProposal(context, { ...proposalFor(context), unresolved: questions }), { code });
  }
  const bounded = { ...proposalFor(context), unresolved: [{ id: 'a'.repeat(64), question: '😀'.repeat(500) }] };
  assert.deepEqual(await validatePanelEditProposal(context, bounded), bounded);
});

test('all public asynchronous boundaries snapshot inputs before the first await', async () => {
  const inputSpec = copy(fixture), inputCatalog = copy(catalog), inputRequest = request();
  const pendingContext = createPanelEditContext(inputSpec, inputCatalog, inputRequest);
  inputSpec.title = 'caller mutation'; inputCatalog.recipes[0].description = 'caller mutation'; inputRequest.text = 'caller mutation';
  const context = await pendingContext;
  assert.deepEqual(context.spec, fixture);
  assert.deepEqual(context.catalog, catalog);
  assert.deepEqual(context.request, request());
  const toValidate = copy(context), pendingValidation = validatePanelEditContext(toValidate);
  toValidate.spec.title = 'caller mutation';
  assert.deepEqual(await pendingValidation, context);
  for (const operation of [validatePanelEditProposal, checkPanelEditProposal, requireReadyEditProposal]) {
    const callerContext = copy(context), callerProposal = proposalFor(context);
    const expected = await operation(context, copy(callerProposal));
    const pending = operation(callerContext, callerProposal);
    callerContext.request.text = 'caller mutation'; callerContext.spec.state[0].initial = 99;
    callerProposal.patch.operations[0].label = 'caller mutation'; callerProposal.decisions[0].basis.quote = 'caller mutation';
    assert.deepEqual(await pending, expected);
  }
});

test('input descriptors reject accessors, Symbol keys, prototypes and cycles without invoking getters', async () => {
  let reads = 0;
  function getter(value, key) { Object.defineProperty(value, key, { enumerable: true, get() { reads += 1; return 'unsafe'; } }); return value; }
  await assert.rejects(createPanelEditContext(getter(copy(fixture), 'title'), catalog, request()), { code: 'EDIT_JSON' });
  await assert.rejects(createPanelEditContext(fixture, getter(copy(catalog), 'id'), request()), { code: 'EDIT_JSON' });
  await assert.rejects(createPanelEditContext(fixture, catalog, getter(request(), 'text')), { code: 'EDIT_JSON' });
  const context = await contextFor();
  await assert.rejects(validatePanelEditContext(getter(copy(context), 'sha256')), { code: 'EDIT_JSON' });
  for (const operation of [validatePanelEditProposal, checkPanelEditProposal, requireReadyEditProposal]) {
    await assert.rejects(operation(getter(copy(context), 'spec'), proposalFor(context)), { code: 'EDIT_JSON' });
    for (const mutate of [
      value => { getter(value.patch.operations[0], 'label'); },
      value => { value[Symbol('hidden')] = true; },
      value => { value.patch.reason = value; },
      value => { Object.setPrototypeOf(value.decisions[0], { inherited: true }); },
      value => { delete value.decisions[0]; },
    ]) {
      const proposal = proposalFor(context); mutate(proposal);
      await assert.rejects(operation(context, proposal), { code: 'EDIT_JSON' });
    }
  }
  assert.equal(reads, 0);
});
