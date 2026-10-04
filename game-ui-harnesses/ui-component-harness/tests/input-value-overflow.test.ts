import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDocument, type InputNode } from '../src/tree-contract.ts';
import { assertLayerTextRendering, type LayerTextInspection } from '../src/layer-preview.ts';
import { LayerLayoutRenderError } from '../src/layer-layout-checks.ts';
import { validateLayerPlanningEvidence } from '../src/layer-planning-evidence.ts';
import { layerLayoutFixture } from './helpers/layer-layout-fixture.ts';
import { fixtureFindings } from './helpers/layer-planning-fixture.ts';
import { fixtureStyle } from '../src/fixtures.ts';

async function fixture() {
  const { plan } = await layerLayoutFixture();
  plan.basis = 'model-proposed';
  const input: InputNode = { id: 'input', type: 'Input', layout: { x: 10, y: 70, width: 40, height: 28 },
    props: { value: '12345678901234567890', placeholder: '', inputType: 'text', readOnly: false,
      enabled: true, maxLength: 20, valueOverflow: 'ellipsis', style: fixtureStyle } };
  plan.document.root.children.push(input);
  const inspection: LayerTextInspection = { nodes: [
    { id: 'spacing-icon', bounds: { x: 79, y: 25, width: 12, height: 14 } },
    { id: 'name', renderedTextBounds: [{ text: 'Name', bounds: { x: 95, y: 25, width: 35, height: 14 } }] },
    { id: 'count', renderedTextBounds: [{ text: '4/4', bounds: { x: 95, y: 43, width: 20, height: 14 } }] },
    { id: 'input', value: input.props.value, renderedTextBounds: [{ text: '12…', bounds: { x: 20, y: 75, width: 20, height: 18 },
      implicitTruncation: { textId: 'input.label', requestedText: input.props.value, overflowAxis: 'x', ellipsisFits: true } }] },
  ] };
  inspection.nodes.forEach(node => node.visible = true);
  return { plan, input, inspection };
}

test('explicit Input overflow is optional and cannot enlarge capacity or accept unknown policies', async () => {
  const { plan, input } = await fixture();
  assert.equal(validateDocument(plan.document).root.children.length, 6);
  delete input.props.valueOverflow;
  assert.doesNotThrow(() => validateDocument(plan.document));
  for (const policy of ['clip', 'error', null]) {
    (input.props as any).valueOverflow = policy;
    assert.throws(() => validateDocument(plan.document), /UNSUPPORTED_VALUE/);
  }
  input.props.valueOverflow = 'ellipsis'; input.props.value += 'x';
  assert.throws(() => validateDocument(plan.document), /VALUE_TOO_LONG/);
});

test('declared Input horizontal ellipsis retains strict placeholder, height, capacity and label gates', async () => {
  const { plan, input, inspection } = await fixture();
  assert.equal(assertLayerTextRendering(plan, inspection)?.status, 'pass');
  for (const mutation of ['undeclared', 'vertical', 'both', 'ellipsis-does-not-fit', 'missing-axis', 'placeholder', 'wrong-text', 'wrong-id', 'over-capacity', 'button'] as const) {
    const changed = structuredClone(inspection), proposal = structuredClone(plan);
    const target = proposal.document.root.children.find(node => node.id === input.id) as InputNode;
    const node = changed.nodes[3], truncation = node.renderedTextBounds![0].implicitTruncation!;
    if (mutation === 'undeclared') delete target.props.valueOverflow;
    if (mutation === 'vertical') truncation.overflowAxis = 'y';
    if (mutation === 'both') truncation.overflowAxis = 'both';
    if (mutation === 'ellipsis-does-not-fit') truncation.ellipsisFits = false;
    if (mutation === 'missing-axis') delete truncation.overflowAxis;
    if (mutation === 'placeholder') node.value = '';
    if (mutation === 'wrong-text') truncation.requestedText = 'guessed';
    if (mutation === 'wrong-id') truncation.textId = 'input.title';
    if (mutation === 'over-capacity') { node.value = input.props.value + 'x'; truncation.requestedText = node.value; }
    if (mutation === 'button') { node.id = 'action'; truncation.textId = 'action.label'; }
    assert.throws(() => assertLayerTextRendering(proposal, changed), /LAYER_PLAN_TEXT_OVERFLOW/, mutation);
  }
});

test('declared Input policy still fails actual overlapping or missing layout measurement', async () => {
  const { plan, inspection } = await fixture();
  inspection.nodes[2].renderedTextBounds![0].bounds!.y = 37;
  assert.throws(() => assertLayerTextRendering(plan, inspection), LayerLayoutRenderError);
  inspection.nodes[1].renderedTextBounds = [];
  assert.throws(() => assertLayerTextRendering(plan, inspection), /LAYER_RENDER_MEASUREMENT_INVALID/);
});

test('model Input overflow requires an authenticated explicit-policy finding', async () => {
  const { plan } = await fixture();
  const findings = fixtureFindings(plan.document);
  const finding = findings.find(row => row.componentId === 'input' && row.pointer === '/props/valueOverflow')!;
  const evidence = { version: '1.0', referenceSha256: 'a'.repeat(64), responseSha256: 'b'.repeat(64), findings, issues: [] };
  assert.throws(() => validateLayerPlanningEvidence(evidence, plan.document), /EVIDENCE_INVALID/);
  finding.basis = 'explicit-policy';
  assert.doesNotThrow(() => validateLayerPlanningEvidence(evidence, plan.document));
  findings.splice(findings.indexOf(finding), 1);
  assert.throws(() => validateLayerPlanningEvidence(evidence, plan.document), /EVIDENCE_INVALID/);
});
