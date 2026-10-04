import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, catalog, copy, freeze } from './helpers.mjs';
import { createPanelEditContext, checkPanelEditProposal } from '../src/edit-planning.mjs';
import { materializeCodexEditDraft } from '../src/codex-edit-draft.mjs';
import { buildCodexEditResponseSchema } from '../src/codex-edit-schema.mjs';

const request = text => ({ requestVersion: '0.1', id: 'draft-edit', text, target: 'pixi' });
const contextFor = () => createPanelEditContext(fixture, catalog, request('😀 保持音量，标题改成夜间设置。标题改成夜间设置。'));
const draftFor = context => ({ codexEditDraftVersion: '0.1', contextSha256: context.sha256,
  patch: { patchVersion: '0.1', baseSpecSha256: context.baseSpecSha256, reason: 'Explicit literal quote regression.',
    operations: [{ op: 'set-panel-title', title: '夜间设置' }] },
  bases: [{ kind: 'request-interpretation', quote: '标题改成夜间设置。' }], unresolved: [] });

test('edit draft derives UTF-16 indices from exact current quotes without changing any operation or quote', async () => {
  const context = freeze(await contextFor()), draft = freeze(draftFor(context));
  const result = await materializeCodexEditDraft(context, draft);
  assert.deepEqual(result.patch, draft.patch); assert.deepEqual(result.unresolved, draft.unresolved);
  assert.deepEqual(result.decisions, [{ operationIndex: 0, basis: {
    kind: 'request-interpretation', quote: '标题改成夜间设置。', start: 8, end: 17 } }]);
  assert.equal(context.request.text.slice(8, 17), draft.bases[0].quote);
  assert.equal((await checkPanelEditProposal(context, result)).status, 'READY_TO_APPLY');
  assert.deepEqual(draft, draftFor(context));
});

test('edit draft cannot fabricate quotes, offset repairs, missing evidence, stale digests or unsupported values', async () => {
  const context = await contextFor();
  for (const [mutate, code] of [
    [draft => { draft.bases[0].quote = '旧需求里的内容'; }, 'EDIT_QUOTE'],
    [draft => { draft.bases[0].quote = ' '; }, 'EDIT_QUOTE'],
    [draft => { draft.bases[0].start = 9; draft.bases[0].end = 18; }, 'EDIT_FIELDS'],
    [draft => { draft.bases = []; }, 'EDIT_COVERAGE'],
    [draft => { draft.bases.push(copy(draft.bases[0])); }, 'EDIT_COVERAGE'],
    [draft => { draft.contextSha256 = '0'.repeat(64); }, 'EDIT_CONTEXT_MISMATCH'],
    [draft => { draft.patch.baseSpecSha256 = '0'.repeat(64); }, 'EDIT_BASE_MISMATCH'],
    [draft => { draft.patch.operations[0] = { op: 'set-canvas', width: 800 }; }, 'EDIT_PATCH'],
    [draft => { draft.patch.operations[0] = { op: 'set-state-initial', fieldId: 'volume', value: 101 }; }, 'EDIT_RESULT_SPEC'],
    [draft => { draft.bases[0] = { kind: 'design-choice', reason: '不允许推测标题。' }; }, 'EDIT_BUSINESS_ORIGIN'],
    [draft => { draft.approval = true; }, 'EDIT_FIELDS'],
  ]) {
    const draft = draftFor(context); mutate(draft);
    await assert.rejects(materializeCodexEditDraft(context, draft), { code });
  }
});

test('edit draft never permits a quote to split a surrogate pair', async () => {
  const context = await contextFor(), draft = draftFor(context); draft.bases[0].quote = '\ud83d';
  await assert.rejects(materializeCodexEditDraft(context, draft), { code: 'EDIT_SPAN' });
});

test('draft null patch and unresolved questions remain unapplied and strictly aligned', async () => {
  const context = await contextFor(), draft = { ...draftFor(context), patch: null, bases: null,
    unresolved: [{ id: 'title', question: '标题具体是什么？' }] };
  const proposal = await materializeCodexEditDraft(context, draft);
  assert.equal((await checkPanelEditProposal(context, proposal)).status, 'NEEDS_INPUT');
  await assert.rejects(materializeCodexEditDraft(context, { ...draft, bases: [] }), { code: 'EDIT_FIELDS' });
  await assert.rejects(materializeCodexEditDraft(context, { ...draft, unresolved: [] }), { code: 'EDIT_EMPTY_PATCH' });
});

test('draft design choices remain restricted to complete theme/layout operations', async () => {
  const context = await contextFor(), draft = draftFor(context);
  draft.patch.operations = [{ op: 'set-layout', layout: { ...fixture.layout, gap: 24 } }];
  draft.bases = [{ kind: 'design-choice', reason: '请求允许的完整布局调整。' }];
  assert.equal((await checkPanelEditProposal(context, await materializeCodexEditDraft(context, draft))).status, 'READY_TO_APPLY');
});

test('draft inputs are isolated before awaits and getters are never invoked', async () => {
  const context = await contextFor(), draft = draftFor(context);
  const pending = materializeCodexEditDraft(context, draft); draft.patch.operations[0].title = 'changed'; context.request.text = 'changed';
  assert.equal((await pending).patch.operations[0].title, '夜间设置');
  let reads = 0; const accessor = draftFor(await contextFor());
  Object.defineProperty(accessor, 'bases', { enumerable: true, get() { reads++; return []; } });
  await assert.rejects(materializeCodexEditDraft(await contextFor(), accessor), { code: 'accessor' }); assert.equal(reads, 0);
});

test('native draft schema omits model-authored positions and retains strict operation shapes', async () => {
  const schema = await buildCodexEditResponseSchema({ draft: true });
  assert.deepEqual(schema.required, ['codexEditDraftVersion', 'contextSha256', 'patch', 'bases', 'unresolved']);
  assert.equal(schema.additionalProperties, false);
  const basisShape = JSON.stringify(schema.properties.bases);
  assert(!basisShape.includes('operationIndex'));
  const requestBasis = schema.properties.bases.anyOf[1].items.anyOf[0];
  assert.deepEqual(requestBasis.required, ['kind', 'quote']); assert.equal(requestBasis.additionalProperties, false);
});
