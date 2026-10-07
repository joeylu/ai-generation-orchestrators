import test from 'node:test';
import assert from 'node:assert/strict';
import { bindLayerSemanticInputs, assertLayerSemanticInputs, validateLayerSemanticInputs,
  validateBoundLayerSemanticInputs } from '../src/layer-semantic-inputs.ts';
import { runLayerAutoDag, layerPlanningInput, validateLayerProposal } from '../src/layer-auto-dag.ts';
import { compileLayerComponents } from '../src/layer-component.ts';
import { validateBundle } from '../src/bundle.ts';
import { layerPlanningFixture } from './helpers/layer-planning-fixture.ts';

test('semantic facts bind canonical bytes and reject execution fields, duplicate targets, bad types and oversized data', async () => {
  const facts = { version: '1.0', controls: [{ subject: 'volume', target: { type: 'Slider' }, values: { min: 0, max: 100, step: 1, value: 60 } }] };
  const first = await bindLayerSemanticInputs(facts);
  const reordered = await bindLayerSemanticInputs({ controls: facts.controls.map(c => ({ values: c.values, target: c.target, subject: c.subject })), version: '1.0' });
  assert.equal(first.sha256, reordered.sha256); assert.equal(JSON.stringify(first.value), JSON.stringify(reordered.value));
  facts.controls[0].values.value = 5; assert.equal(first.value.controls[0].values.value, 60);
  await assert.rejects(validateBoundLayerSemanticInputs({ ...first, sha256: '0'.repeat(64) }), /DIGEST/);
  for (const bad of [{ ...facts, model: 'private' }, { ...facts, controls: [...facts.controls, facts.controls[0]] },
    { version: '1.0', controls: [{ subject: 'x', target: { type: 'Slider' }, values: { step: 0 } }] },
    { version: '1.0', controls: [{ subject: 'x', target: { type: 'Switch' }, values: { checked: 'ON' } }] },
    { version: '1.0', controls: [{ subject: 'x', target: { type: 'Button', path: 'private' }, values: { enabled: true } }] }]) {
    assert.throws(() => validateLayerSemanticInputs(bad), /INVALID/);
  }
  const tooLarge = { version: '1.0', controls: Array.from({ length: 20 }, (_, i) => ({ subject: 'input'+i,
    target: { type: 'Input', id: 'input'+i }, values: { value: '中'.repeat(1000) } })) };
  assert.throws(() => validateLayerSemanticInputs(tooLarge), /LIMIT/);
});

test('declared initial facts survive model DAG and source-bound bundle, wrong model values cannot compile', async () => {
  const fixture = await layerPlanningFixture();
  const button = fixture.proposal.plan.document.root.children.find(node => node.type === 'Button')!;
  const facts = { version: '1.0', controls: [{ subject: 'button state', target: { type: 'Button', id: button.id }, values: { enabled: true } }] };
  const input = await layerPlanningInput(fixture.bytes, { semanticInputs: facts });
  assert.equal(input.semanticInputs?.value.controls[0].values.enabled, true);
  const result = await runLayerAutoDag(fixture.bytes, async frozen => {
    frozen.semanticInputs!.value.controls[0].values.enabled = false;
    return fixture.proposal;
  }, { semanticInputs: facts });
  assert.equal(result.plan.semanticInputs?.value.controls[0].values.enabled, true);
  assert.equal((await validateBundle(result.bundle)).layerSource?.plan.semanticInputs?.sha256, input.semanticInputs?.sha256);
  const wrong = structuredClone(fixture.proposal);
  (wrong.plan.document.root.children.find(node => node.id === button.id)!.props as any).enabled = false;
  await assert.rejects(validateLayerProposal(fixture.bytes, input, wrong), /SEMANTIC_MISMATCH/);
  const forged = { ...fixture.proposal, plan: { ...fixture.proposal.plan, semanticInputs: input.semanticInputs } };
  await assert.rejects(validateLayerProposal(fixture.bytes, input, forged), /PLAN_INVALID/);
  const brokenPlan = structuredClone(result.plan); brokenPlan.semanticInputs!.sha256 = '0'.repeat(64);
  await assert.rejects(compileLayerComponents(fixture.bytes, brokenPlan), /DIGEST/);
});

test('choice labels resolve exactly, null selection and ambiguous targets remain explicit', async () => {
  const fixture = await layerPlanningFixture(), document = structuredClone(fixture.plan.document) as any;
  const radio = { id: 'quality', type: 'RadioGroup', layout: { x: 0, y: 0, width: 100, height: 60 },
    props: { options: [{ id: 'l', label: 'LOW' }, { id: 'm', label: 'MEDIUM' }], selectedId: 'm' } };
  document.root.children.push(radio);
  const facts = await bindLayerSemanticInputs({ version: '1.0', controls: [{ subject: 'quality', target: { type: 'RadioGroup' },
    values: { optionLabels: ['LOW', 'MEDIUM'], selectedLabel: 'MEDIUM' } }] });
  assertLayerSemanticInputs(facts, document);
  radio.props.selectedId = 'l'; assert.throws(() => assertLayerSemanticInputs(facts, document), /MISMATCH/);
  radio.props.selectedId = null as any;
  assertLayerSemanticInputs(await bindLayerSemanticInputs({ version: '1.0', controls: [{ subject: 'quality', target: { type: 'RadioGroup' }, values: { selectedLabel: null } }] }), document);
  document.root.children.push({ ...radio, id: 'duplicate' });
  assert.throws(() => assertLayerSemanticInputs(facts, document), /SEMANTIC_TARGET/);
});
