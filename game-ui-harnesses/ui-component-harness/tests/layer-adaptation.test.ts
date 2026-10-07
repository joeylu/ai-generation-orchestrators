import test from 'node:test';
import assert from 'node:assert/strict';
import { layerAdaptationFixture } from './helpers/layer-adaptation-fixture.ts';
import { runLayerAutoDag, layerPlanningInput, validateLayerProposal } from '../src/layer-auto-dag.ts';
import { compileLayerComponents, LayerPlanResourcePathError } from '../src/layer-component.ts';
import { validateBundle } from '../src/bundle.ts';
import { LAYER_ADAPTATION_POLICY_V1 } from '../src/layer-adaptation.ts';
import { LayerPlanningUnresolvedError } from '../src/layer-planning-evidence.ts';

test('consumer crops, reordering and procedural controls survive source-bound build and reopen', async () => {
  const fixture = await layerAdaptationFixture();
  const result = await runLayerAutoDag(fixture.bytes, async input => {
    assert.deepEqual(input.adaptationPolicy, LAYER_ADAPTATION_POLICY_V1); return fixture.proposal;
  });
  assert.equal(result.plan.adaptations?.length, 6);
  assert.equal(result.bundle.resources.length, 4);
  assert.deepEqual(Buffer.from(result.bundle.layerSource!.base64, 'base64'), Buffer.from(fixture.bytes));
  const reopened = await validateBundle(JSON.parse(JSON.stringify(result.bundle)));
  assert.deepEqual(reopened.layerSource?.plan.adaptations, fixture.plan.adaptations);
  const altered = JSON.parse(JSON.stringify(reopened)); altered.layerSource.plan.adaptations[0].reason = 'Tampered recipe.';
  await assert.rejects(validateBundle(altered), /LAYER_PLAN_DIGEST/);
});

test('source adaptation rejects unknown layers, out-of-bounds crops, undeclared crops and false procedural recipes', async () => {
  const fixture = await layerAdaptationFixture();
  for (const change of [
    (plan: any) => { plan.adaptations[0].sourceLayerId = 'missing'; },
    (plan: any) => { plan.document.root.children[1].props.region.x = 100; },
    (plan: any) => { plan.adaptations.shift(); },
    (plan: any) => { plan.adaptations[4].componentId = 'background'; },
    (plan: any) => { plan.adaptations[5].componentId = 'fish'; },
    (plan: any) => { plan.adaptations[0].reason = 'C:/private/host/image.png'; },
  ]) {
    const bad = structuredClone(fixture.plan); change(bad);
    await assert.rejects(compileLayerComponents(fixture.bytes, bad), /LAYER_PLAN_(?:ADAPTATION_INVALID|CROP_BOUNDS|CROP_UNDECLARED)/);
  }
});

test('model adaptation requires explicit policy evidence and keeps genuine semantic gaps terminal', async () => {
  const fixture = await layerAdaptationFixture(), input = await layerPlanningInput(fixture.bytes);
  const bad = structuredClone(fixture.proposal); bad.findings = bad.findings.filter(finding => finding.pointer !== '/props/style');
  await assert.rejects(validateLayerProposal(fixture.bytes, input, bad), /LAYER_PLAN_ADAPTATION_EVIDENCE/);
  const order = structuredClone(fixture.proposal); order.findings = order.findings.filter(finding => finding.pointer !== '/children');
  await assert.rejects(validateLayerProposal(fixture.bytes, input, order), /LAYER_PLAN_ADAPTATION_EVIDENCE/);
  const undeclared = structuredClone(fixture.proposal); undeclared.plan.adaptations = undeclared.plan.adaptations?.filter(row => row.kind !== 'procedural-control');
  await assert.rejects(validateLayerProposal(fixture.bytes, input, undeclared), /LAYER_PLAN_PROCEDURAL_UNDECLARED/);
  const unresolved = { ...fixture.proposal, status: 'Unresolved', plan: null, summary: '按钮文字无法确认。', issues: ['请提供可读的按钮标签。'],
    reason: 'required-semantics-missing', missingInputs: [{ subject: '按钮', kind: 'unreadable-text', detail: '标签无法辨认。' }] };
  await assert.rejects(validateLayerProposal(fixture.bytes, input, unresolved), (error: unknown) => error instanceof LayerPlanningUnresolvedError
    && error.diagnostic.summary === unresolved.summary && error.diagnostic.issues[0] === unresolved.issues[0]);
  await assert.rejects(validateLayerProposal(fixture.bytes, input, { ...unresolved, issues: ['file:///private/log'] }), /LAYER_PLANNING_EVIDENCE_INVALID/);
});

test('layer ID used as a cropped image source stays rejected with exact portable field feedback', async () => {
  const fixture = await layerAdaptationFixture(), input = await layerPlanningInput(fixture.bytes);
  const bad = structuredClone(fixture.proposal);
  (bad.plan.document.root.children[1] as any).props.source = 'button';
  const before = JSON.stringify(bad);
  await assert.rejects(validateLayerProposal(fixture.bytes, input, bad), (error: unknown) => {
    assert.ok(error instanceof LayerPlanResourcePathError);
    assert.equal(error.message, 'LAYER_PLAN_ADAPTATION_INVALID');
    assert.deepEqual(error.issues, [{ path: '/document/root/children/1/props/source',
      code: 'LAYER_PLAN_RESOURCE_PATH_REQUIRED',
      message: 'Use the authenticated resource path "layers/layer-002.png" for this image field. Layer IDs belong in bindings[].layerId and adaptations[].sourceLayerId.' }]);
    return true;
  });
  assert.equal(JSON.stringify(bad), before);
  const bundle = await compileLayerComponents(fixture.bytes, fixture.plan);
  assert.deepEqual(Buffer.from(bundle.layerSource!.base64, 'base64'), Buffer.from(fixture.bytes));
});
