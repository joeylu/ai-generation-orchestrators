import test from 'node:test';
import assert from 'node:assert/strict';
import { layerPlanningFixture } from './helpers/layer-planning-fixture.ts';
import { layerPlanningInput, validateLayerProposal } from '../src/layer-auto-dag.ts';
import { LayerPlanningIncompleteError, LayerPlanningUnresolvedError } from '../src/layer-planning-evidence.ts';

test('structured construction reason remains repairable even when status says Unresolved', async () => {
  const fixture = await layerPlanningFixture(), input = await layerPlanningInput(fixture.bytes);
  const proposal = { ...fixture.proposal, reason: 'construction-incomplete', status: 'Unresolved', plan: null,
    findings: [], summary: '业务文字可读，但完整方案未写完。', issues: ['图层绑定和逐节点证据尚未完成。'] };
  await assert.rejects(validateLayerProposal(fixture.bytes, input, proposal), (error: unknown) =>
    error instanceof LayerPlanningIncompleteError && error.diagnostic.reason === 'construction-incomplete'
      && error.diagnostic.missingInputs?.length === 0);
  for (const invalid of [
    { ...proposal, reason: 'unknown' },
    { ...proposal, missingInputs: [{ subject: '按钮', kind: 'unreadable-text', detail: '标签不可辨认。' }] },
    { ...proposal, issues: ['file:///private/session'] },
  ]) await assert.rejects(validateLayerProposal(fixture.bytes, input, invalid), error => !(error instanceof LayerPlanningIncompleteError));
});

test('missing semantic reason requires specific portable inputs and never becomes unfinished construction', async () => {
  const fixture = await layerPlanningFixture(), input = await layerPlanningInput(fixture.bytes);
  const proposal = { ...fixture.proposal, reason: 'required-semantics-missing', status: 'Unresolved', plan: null,
    summary: '按钮标签不可辨认。', missingInputs: [{ subject: '底部按钮', kind: 'unreadable-text', detail: '参考图的标签无法辨认，需提供文字。' }] };
  await assert.rejects(validateLayerProposal(fixture.bytes, input, proposal), (error: unknown) =>
    error instanceof LayerPlanningUnresolvedError && error.diagnostic.missingInputs?.[0].subject === '底部按钮');
  for (const missingInputs of [[], [{ subject: '按钮', kind: 'missing-font', detail: '字号未知。' }],
    [{ subject: 'C:/private/session', kind: 'unreadable-text', detail: '标签未知。' }]]) {
    await assert.rejects(validateLayerProposal(fixture.bytes, input, { ...proposal, missingInputs }), /LAYER_PLANNING_EVIDENCE_INVALID/);
  }
});

test('legacy proposal remains readable and legacy Unresolved remains terminal without text classification', async () => {
  const fixture = await layerPlanningFixture(), input = await layerPlanningInput(fixture.bytes);
  const { reason: _reason, missingInputs: _missingInputs, ...legacy } = fixture.proposal;
  assert.equal((await validateLayerProposal(fixture.bytes, input, { ...legacy, version: '1.0' })).basis, 'model-proposed');
  await assert.rejects(validateLayerProposal(fixture.bytes, input, { ...legacy, version: '1.0', status: 'Unresolved', plan: null,
    summary: 'Incomplete work, not missing semantics.' }), LayerPlanningUnresolvedError);
});
