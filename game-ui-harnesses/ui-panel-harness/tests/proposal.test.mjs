import assert from 'node:assert/strict';
import test from 'node:test';
import { catalog, copy, fixture, freeze } from './helpers.mjs';
import { digestJson } from '../src/canonical.mjs';
import { createPlanningContext } from '../src/planning-context.mjs';
import { checkPanelProposal, proposalTargets, requireReadyProposal, validatePanelProposal } from '../src/proposal.mjs';

const requestText = '😀 帮我生成设置面板，包含音频分组。\n音量范围 0 到 100、步长 1、初值 80，显示整数百分比，事件 audio.volumeChanged。\n启用声音开关初值 true，事件 audio.enabledChanged，两个控件都启用。';
const panelRequest = text => ({ requestVersion: '0.1', id: 'audio-settings-request', text, target: 'pixi' });
const unknown = { id: 'initial-volume', question: '音量初值应为多少？' };
function authoredSpec() {
  const spec = copy(fixture);
  spec.provenance = { kind: 'agent-authored', description: 'Agent proposal for an explicit request; no semantic or visual approval claimed.', assumptions: [] };
  return spec;
}
function wholeRequest(context) {
  return { kind: 'request-interpretation', start: 0, end: context.request.text.length, quote: context.request.text };
}
function proposalFor(context) {
  const spec = authoredSpec();
  return {
    proposalVersion: '0.1', contextSha256: context.sha256, spec,
    decisions: proposalTargets(spec).map(target => ({ target, basis: wholeRequest(context) })),
    unresolved: [],
  };
}
async function inputs(text = requestText, sourceCatalog = catalog) {
  const context = await createPlanningContext(panelRequest(text), sourceCatalog);
  return { context, proposal: proposalFor(context) };
}
const rejectsCode = (promise, code) => assert.rejects(promise, error => error.code === code);

test('ready proposal preserves agent authorship and reports only source-span validation', async () => {
  const { context, proposal } = await inputs();
  const layoutDecision = proposal.decisions.find(item => item.target === 'layout');
  layoutDecision.basis = { kind: 'design-choice', reason: 'Use the existing fixed-viewport stack layout and spacing.' };
  const validated = await validatePanelProposal(context, proposal);
  assert.equal(validated.spec.provenance.kind, 'agent-authored');
  assert.deepEqual(validated, proposal);
  const report = await checkPanelProposal(context, proposal);
  assert.equal(report.status, 'READY_TO_COMPILE');
  assert.equal(report.sourceEvidence, 'EXACT_SPANS_ONLY');
  assert.equal(report.semanticReview, 'NOT_RUN');
  assert.equal(report.humanVisualReview, 'NOT_RUN');
  assert.equal(report.requestSha256, context.requestSha256);
  assert.equal(report.contextSha256, context.sha256);
  assert.equal(report.proposalSha256, await digestJson(proposal));
  assert.equal(report.specSha256, await digestJson(proposal.spec));
  assert.deepEqual(report.designChoices, [layoutDecision]);
  assert.deepEqual(await requireReadyProposal(context, proposal), { proposal: validated, report });
});

test('null spec can record unresolved questions and can never pass the ready gate', async () => {
  const context = await createPlanningContext(panelRequest('帮我做音量设置'), catalog);
  const proposal = { proposalVersion: '0.1', contextSha256: context.sha256, spec: null, decisions: [], unresolved: [copy(unknown)] };
  assert.deepEqual(await validatePanelProposal(context, proposal), proposal);
  const report = await checkPanelProposal(context, proposal);
  assert.equal(report.status, 'NEEDS_INPUT');
  assert.equal(report.specSha256, null);
  assert.equal(report.semanticReview, 'NOT_RUN');
  assert.deepEqual(report.unresolved, proposal.unresolved);
  await rejectsCode(requireReadyProposal(context, proposal), 'PLAN_NEEDS_INPUT');
  await rejectsCode(validatePanelProposal(context, { ...proposal, unresolved: [] }), 'PLAN_EMPTY_SPEC');
  await rejectsCode(validatePanelProposal(context, { ...proposal, decisions: [{ target: 'panel', basis: wholeRequest(context) }] }), 'PLAN_EMPTY_SPEC');
});

test('a full valid spec remains blocked while any question is unresolved', async () => {
  const { context, proposal } = await inputs();
  proposal.unresolved = [copy(unknown)];
  assert.equal((await checkPanelProposal(context, proposal)).status, 'NEEDS_INPUT');
  await rejectsCode(requireReadyProposal(context, proposal), 'PLAN_NEEDS_INPUT');
});

test('every authored target is listed once and missing, duplicate or unknown decisions fail', async () => {
  const { context, proposal } = await inputs();
  assert.deepEqual(proposalTargets(proposal.spec), [
    'panel', 'theme', 'canvas', 'layout', 'section:audio', 'row:volume-row', 'row:audio-enabled-row', 'state:volume', 'state:audioEnabled',
  ]);
  const missing = copy(proposal); missing.decisions.pop();
  await rejectsCode(validatePanelProposal(context, missing), 'PLAN_COVERAGE');
  const duplicate = copy(proposal); duplicate.decisions.push(copy(duplicate.decisions[0]));
  await rejectsCode(validatePanelProposal(context, duplicate), 'PLAN_TARGET');
  const unexpected = copy(proposal); unexpected.decisions[0].target = 'row:nonexistent';
  await rejectsCode(validatePanelProposal(context, unexpected), 'PLAN_TARGET');
  const wrongType = copy(proposal); wrongType.decisions[0].target = 1;
  await rejectsCode(validatePanelProposal(context, wrongType), 'PLAN_TARGET');
});

test('request evidence uses exact UTF-16 offsets and preserves multiline source quotes', async () => {
  const { context, proposal } = await inputs();
  const start = context.request.text.indexOf('音量范围');
  const end = context.request.text.indexOf('\n启用声音');
  proposal.decisions.find(item => item.target === 'row:volume-row').basis = {
    kind: 'request-interpretation', start, end, quote: context.request.text.slice(start, end),
  };
  const validated = await validatePanelProposal(context, proposal);
  assert.deepEqual(validated.decisions, proposal.decisions);
  assert.equal(validated.decisions[0].basis.quote, requestText);
  const staleQuote = copy(proposal); staleQuote.decisions[0].basis.quote = requestText.trim().replace('\n', ' ');
  await rejectsCode(validatePanelProposal(context, staleQuote), 'PLAN_QUOTE');
  const codepointOffsets = copy(proposal);
  codepointOffsets.decisions[0].basis = { kind: 'request-interpretation', start: start - 1, end: end - 1, quote: context.request.text.slice(start, end) };
  await rejectsCode(validatePanelProposal(context, codepointOffsets), 'PLAN_QUOTE');
});

test('source spans reject surrogate splits, invalid bounds, whitespace-only quotes and invented text', async () => {
  const { context, proposal } = await inputs();
  const ranges = [[1, 2], [0, 1], [-1, 3], [0, requestText.length + 1], [2, 2], [3, 2], [0.5, 2]];
  for (const [start, end] of ranges) {
    const changed = copy(proposal);
    changed.decisions[0].basis = { kind: 'request-interpretation', start, end, quote: requestText.slice(start, end) };
    await rejectsCode(validatePanelProposal(context, changed), 'PLAN_SPAN');
  }
  const whitespace = copy(proposal);
  whitespace.decisions[0].basis = { kind: 'request-interpretation', start: 2, end: 3, quote: ' ' };
  await rejectsCode(validatePanelProposal(context, whitespace), 'PLAN_QUOTE');
  const invented = copy(proposal); invented.decisions[0].basis.quote = 'This sentence was never requested.';
  await rejectsCode(validatePanelProposal(context, invented), 'PLAN_QUOTE');
  const completeEmoji = copy(proposal);
  completeEmoji.decisions[0].basis = { kind: 'request-interpretation', start: 0, end: 2, quote: '😀' };
  assert.equal((await checkPanelProposal(context, completeEmoji)).semanticReview, 'NOT_RUN');
});

test('design choices may arrange or style the panel but cannot invent row or state business semantics', async () => {
  const { context, proposal } = await inputs();
  for (const target of ['row:volume-row', 'row:audio-enabled-row', 'state:volume', 'state:audioEnabled']) {
    const changed = copy(proposal);
    changed.decisions.find(item => item.target === target).basis = { kind: 'design-choice', reason: 'Assume a convenient initial value.' };
    await rejectsCode(validatePanelProposal(context, changed), 'PLAN_BUSINESS_ORIGIN');
  }
  for (const target of ['panel', 'theme', 'canvas', 'layout', 'section:audio']) {
    proposal.decisions.find(item => item.target === target).basis = { kind: 'design-choice', reason: 'Apply the chosen design system.' };
  }
  assert.equal((await checkPanelProposal(context, proposal)).designChoices.length, 5);
});

test('proposal references require catalog presence, exact versions, and compatible recipe kinds', async () => {
  const { context, proposal } = await inputs();
  const mutations = [
    value => { value.spec.theme.id = 'missing-theme'; },
    value => { value.spec.theme.version = '9.9.9'; },
    value => { value.spec.sections[0].rows[0].recipe.id = 'missing-recipe'; },
    value => { value.spec.sections[0].rows[0].recipe.version = '9.9.9'; },
    value => { value.spec.sections[0].rows[0].recipe.id = 'settings.switch'; },
  ];
  for (const mutate of mutations) {
    const changed = copy(proposal); mutate(changed);
    await assert.rejects(validatePanelProposal(context, changed), /not found|expected slider-row/);
  }
});

test('fixed panel and section recipes must resolve before a proposal can be ready', async () => {
  for (const id of ['settings.panel', 'settings.section']) {
    const missing = copy(catalog);
    missing.recipes = missing.recipes.filter(recipe => recipe.id !== id);
    const { context, proposal } = await inputs(requestText, missing);
    await assert.rejects(checkPanelProposal(context, proposal), /not found/);
    const wrongVersion = copy(catalog);
    wrongVersion.recipes.find(recipe => recipe.id === id).version = '0.2.0';
    const next = await inputs(requestText, wrongVersion);
    await assert.rejects(checkPanelProposal(next.context, next.proposal), /not found/);
  }
});

test('proposal provenance distinguishes generated agent content and programmatic fixtures from user documents', async () => {
  const { context, proposal } = await inputs();
  assert.equal((await validatePanelProposal(context, proposal)).spec.provenance.kind, 'agent-authored');
  proposal.spec.provenance.kind = 'programmatic-fixture';
  assert.equal((await validatePanelProposal(context, proposal)).spec.provenance.kind, 'programmatic-fixture');
  proposal.spec.provenance.kind = 'user-authored';
  await rejectsCode(validatePanelProposal(context, proposal), 'PLAN_PROVENANCE');
});

test('proposal context binding and context integrity reject changed requests and forged retrieval', async () => {
  const { context, proposal } = await inputs();
  const another = await createPlanningContext(panelRequest(`${requestText}\n使用另一个标题。`), catalog);
  await rejectsCode(validatePanelProposal(another, proposal), 'PLAN_CONTEXT_MISMATCH');
  const changed = copy(context); changed.candidates[0].score += 100;
  const { sha256: ignored, ...payload } = changed; changed.sha256 = await digestJson(payload);
  const matchingOuterHash = { ...proposal, contextSha256: changed.sha256 };
  await assert.rejects(validatePanelProposal(changed, matchingOuterHash), /PLANNING_CONTEXT_MISMATCH/);
});

test('validation and reports do not mutate frozen input or expose mutable aliases', async () => {
  const { context, proposal } = await inputs();
  freeze(context); freeze(proposal);
  const contextBefore = JSON.stringify(context), proposalBefore = JSON.stringify(proposal);
  const validated = await validatePanelProposal(context, proposal);
  const report = await checkPanelProposal(context, proposal);
  const ready = await requireReadyProposal(context, proposal);
  validated.spec.title = 'Changed';
  validated.decisions[0].basis.quote = 'Changed';
  report.unresolved.push(copy(unknown));
  ready.proposal.spec.provenance.description = 'Changed';
  assert.equal(JSON.stringify(context), contextBefore);
  assert.equal(JSON.stringify(proposal), proposalBefore);
});

test('all async proposal entry points snapshot both inputs before their first await', async () => {
  for (const entry of [validatePanelProposal, checkPanelProposal, requireReadyProposal]) {
    const { context, proposal } = await inputs();
    const expected = await entry(copy(context), copy(proposal));
    const pending = entry(context, proposal);
    context.request.text = 'An entirely different request.';
    context.catalog.themes[0].tokens.accent = '#000000';
    context.candidates = [];
    proposal.contextSha256 = '0'.repeat(64);
    proposal.spec.title = 'Edited after invocation';
    proposal.decisions[0].basis.quote = 'Edited after invocation';
    proposal.unresolved.push(copy(unknown));
    assert.deepEqual(await pending, expected, entry.name);
  }
});

test('strict proposal fields reject unsupported versions, injected approval fields and malformed evidence', async () => {
  const { context, proposal } = await inputs();
  const cases = [
    [value => { value.proposalVersion = '0.8'; }, 'PLAN_VERSION'],
    [value => { value.userApproved = true; }, 'PLAN_FIELDS'],
    [value => { value.decisions[0].approved = true; }, 'PLAN_FIELDS'],
    [value => { value.decisions[0].basis.kind = 'model-confidence'; }, 'PLAN_BASIS'],
    [value => { value.decisions[0].basis.confidence = 1; }, 'PLAN_FIELDS'],
    [value => { value.decisions[0].basis = { kind: 'design-choice', reason: '' }; }, 'PLAN_TEXT'],
    [value => { value.unresolved = [copy(unknown), copy(unknown)]; }, 'PLAN_UNRESOLVED_ID'],
    [value => { value.unresolved = [{ id: '../escape', question: 'What?' }]; }, 'PLAN_UNRESOLVED_ID'],
    [value => { value.unresolved = [{ id: 'missing', question: '' }]; }, 'PLAN_TEXT'],
    [value => { value.decisions = []; }, 'PLAN_COVERAGE'],
  ];
  for (const [mutate, code] of cases) {
    const changed = copy(proposal); mutate(changed);
    await rejectsCode(validatePanelProposal(context, changed), code);
  }
});

test('proposal input rejects getters and cycles before executing user code', async () => {
  const { context, proposal } = await inputs();
  let reads = 0;
  const accessor = copy(proposal);
  Object.defineProperty(accessor, 'spec', { enumerable: true, get() { reads += 1; return proposal.spec; } });
  await assert.rejects(validatePanelProposal(context, accessor), /accessors/);
  const cyclic = copy(proposal); cyclic.decisions[0].basis = cyclic;
  await assert.rejects(validatePanelProposal(context, cyclic), /cyclic/);
  assert.equal(reads, 0);
});
