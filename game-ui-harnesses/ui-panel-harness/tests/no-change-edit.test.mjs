import test from 'node:test';
import assert from 'node:assert/strict';
import { core, fixture, catalog, copy } from './helpers.mjs';
import { digestJson } from '../src/canonical.mjs';
import { createPanelEditContext, checkPanelEditProposal, validatePanelEditProposal, requireReadyEditProposal } from '../src/edit-planning.mjs';
import { materializeCodexEditDraft } from '../src/codex-edit-draft.mjs';
import { createWorkbenchModel } from '../src/workbench-model.mjs';
import { createPanelBundle } from '../src/panel-bundle.mjs';
import { validateCodexEditReceipt, validateCodexReceipt } from '../src/codex-planner.mjs';
import { createCodexDiagnostic, validateCodexDiagnostic } from '../src/codex-diagnostics.mjs';

const request = { requestVersion: '0.1', id: 'no-change', target: 'pixi', text: '😀 保持当前面板完全一样，这次不用修改任何内容。' };
const contextFor = () => createPanelEditContext(fixture, catalog, request);
const draftFor = context => ({ codexEditDraftVersion: '0.3', contextSha256: context.sha256, patch: null, bases: null,
  unresolved: [], noChange: { reason: '用户明确要求保持当前面板。', quote: request.text } });
const proposalFor = context => ({ editProposalVersion: '0.2', contextSha256: context.sha256, patch: null, decisions: [], unresolved: [],
  noChange: { reason: '用户明确要求保持当前面板。', basis: { kind: 'request-interpretation', start: 0, end: request.text.length, quote: request.text } } });

test('explicit no-change results are request-bound and distinct from applicable patches or semantic approval', async () => {
  const context = await contextFor(), draft = draftFor(context), proposal = proposalFor(context);
  assert.deepEqual(await materializeCodexEditDraft(context, draft), proposal);
  assert.deepEqual(await validatePanelEditProposal(context, proposal), proposal);
  const report = await checkPanelEditProposal(context, proposal);
  assert.deepEqual(report, { editPlanningReportVersion: '0.2', contextSha256: context.sha256,
    proposalSha256: await digestJson(proposal), baseSpecSha256: context.baseSpecSha256, status: 'NO_CHANGES',
    unresolvedCount: 0, operationCount: 0, resultSpecSha256: null, changedRowIds: [],
    semanticReview: 'NOT_RUN', humanVisualReview: 'NOT_RUN', compilation: 'NOT_RUN' });
  await assert.rejects(requireReadyEditProposal(context, proposal), { code: 'EDIT_PLAN_NO_CHANGES' });
  assert.deepEqual(draft, draftFor(context)); assert.deepEqual(context.spec, fixture);
});

test('no-change evidence cannot hide operations/questions or fabricate current request evidence', async () => {
  const context = await contextFor();
  for (const [mutate, code] of [
    [p => { p.patch = {}; }, 'EDIT_NO_CHANGE'],
    [p => { p.decisions = [{}]; }, 'EDIT_NO_CHANGE'],
    [p => { p.unresolved = [{ id: 'q0', question: '需要改什么？' }]; }, 'EDIT_NO_CHANGE'],
    [p => { p.noChange.reason = ''; }, 'EDIT_TEXT'],
    [p => { p.noChange.reason = 'a'.repeat(501); }, 'EDIT_TEXT'],
    [p => { p.noChange.basis = { kind: 'design-choice', reason: '猜测无需修改。' }; }, 'EDIT_BASIS'],
    [p => { p.noChange.basis.quote = '旧请求'; }, 'EDIT_QUOTE'],
    [p => { p.noChange.basis.end = 1; p.noChange.basis.quote = '\ud83d'; }, 'EDIT_SPAN'],
    [p => { p.contextSha256 = '0'.repeat(64); }, 'EDIT_CONTEXT_MISMATCH'],
    [p => { delete p.noChange; }, 'EDIT_FIELDS'],
    [p => { p.noChange.approved = true; }, 'EDIT_FIELDS'],
  ]) {
    const proposal = proposalFor(context); mutate(proposal);
    await assert.rejects(validatePanelEditProposal(context, proposal), { code });
  }
  for (const [mutate, code] of [
    [d => { d.bases = []; }, 'EDIT_FIELDS'],
    [d => { d.noChange.quote = '以前的请求'; }, 'EDIT_QUOTE'],
    [d => { d.noChange.quote = ' '; }, 'EDIT_QUOTE'],
    [d => { d.noChange.start = 0; }, 'EDIT_FIELDS'],
    [d => { d.noChange = null; }, 'EDIT_EMPTY_PATCH'],
  ]) {
    const draft = draftFor(context); mutate(draft);
    await assert.rejects(materializeCodexEditDraft(context, draft), { code });
  }
});

test('legacy unqualified empty results remain invalid; current normal edits and questions use noChange:null', async () => {
  const context = await contextFor(), draft = draftFor(context);
  for (const version of ['0.1', '0.2']) {
    const legacy = { ...draft, codexEditDraftVersion: version }; delete legacy.noChange;
    await assert.rejects(materializeCodexEditDraft(context, legacy), { code: version === '0.2' ? 'EDIT_PROPOSAL_VERSION' : 'EDIT_EMPTY_PATCH' });
  }
  const legacyProposal = { ...proposalFor(context), editProposalVersion: '0.1' }; delete legacyProposal.noChange;
  await assert.rejects(validatePanelEditProposal(context, legacyProposal), { code: 'EDIT_EMPTY_PATCH' });
  const questions = { ...draft, noChange: null, unresolved: [{ id: 'q0', question: '新标题是什么？' }] };
  assert.equal((await checkPanelEditProposal(context, await materializeCodexEditDraft(context, questions))).status, 'NEEDS_INPUT');
  const ordinary = { ...draft, noChange: null, patch: { patchVersion: '0.1', baseSpecSha256: context.baseSpecSha256,
    reason: 'Strict transport fixture, not semantic approval.', operations: [{ op: 'set-panel-title', title: '测试标题' }] },
    bases: [{ kind: 'request-interpretation', quote: request.text }] };
  assert.equal((await materializeCodexEditDraft(context, ordinary)).editProposalVersion, '0.1');
});

test('no-change workbench handling preserves an existing undo entry without compiling or rendering', async () => {
  let builds = 0, renders = 0;
  const counting = { ...core, createBundle(...args) { builds++; return core.createBundle(...args); } };
  const controller = await createWorkbenchModel({ catalog, pool: null }, counting, async () => { renders++; });
  await controller.importPanel(await createPanelBundle(fixture, catalog, core));
  await controller.patch({ patchVersion: '0.1', baseSpecSha256: await digestJson(fixture), reason: 'Existing undo fixture.',
    operations: [{ op: 'set-panel-title', title: '已编辑' }] }, { volume: 25, audioEnabled: false });
  const prepared = await controller.prepareEdit(request), before = controller.getSnapshot(), counts = [builds, renders];
  const state = { volume: 31, audioEnabled: false }, input = copy(state);
  const result = await controller.acceptEditProposal(proposalFor(prepared.context), state);
  assert.equal(result.report.status, 'NO_CHANGES'); assert.deepEqual(controller.getSnapshot(), before);
  assert.deepEqual([builds, renders], counts); assert.deepEqual(state, input); assert.equal(before.history.length, 1);
  const undone = await controller.undo();
  assert.deepEqual(undone.panel.spec, fixture); assert.deepEqual(undone.panel.state, { volume: 25, audioEnabled: false });
});

test('no-change receipts require the new edit version and cannot masquerade as generation or application', async () => {
  const context = await contextFor(), report = await checkPanelEditProposal(context, proposalFor(context));
  const receipt = { codexEditingReceiptVersion: '0.2', model: 'gpt-6-luna', effort: 'xhigh', contextSha256: context.sha256,
    proposalSha256: report.proposalSha256, status: 'NO_CHANGES', failureCode: null, invocationCount: 1, automaticRetries: 0,
    elapsedMs: 1, usage: null };
  assert.deepEqual(validateCodexEditReceipt(receipt), receipt);
  for (const change of [{ codexEditingReceiptVersion: '0.1' }, { status: 'READY_TO_APPLY' }, { automaticRetries: 1 }, { invocationCount: 0 }]) {
    assert.throws(() => validateCodexEditReceipt({ ...receipt, ...change }), { code: 'CODEX_RECEIPT_INVALID' });
  }
  const generation = { ...receipt, codexPlanningReceiptVersion: '0.1' }; delete generation.codexEditingReceiptVersion;
  assert.throws(() => validateCodexReceipt(generation), { code: 'CODEX_RECEIPT_INVALID' });
  const diagnostic = createCodexDiagnostic({ code: 'EDIT_NO_CHANGE', path: '$.noChange' }, {
    operation: 'edit', contextSha256: context.sha256, proposalJsonSha256: report.proposalSha256, stage: 'proposal-validation' });
  assert.equal(validateCodexDiagnostic(diagnostic).path, '$.noChange');
});
