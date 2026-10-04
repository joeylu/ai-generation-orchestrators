import test from 'node:test';
import assert from 'node:assert/strict';
import { layerPlanningFixture, fixtureFindings, fixtureProceduralAdaptations } from './helpers/layer-planning-fixture.ts';
import { LayerAutoDagError, runLayerAutoDag } from '../src/layer-auto-dag.ts';
import { validateBundle } from '../src/bundle.ts';
import { fixtureDocument } from '../src/fixtures.ts';
import { walkNodes } from '../src/tree-contract.ts';

test('one planning dispatch accepts a complete plan and persists portable inference evidence', async () => {
  const fixture = await layerPlanningFixture(); let calls = 0;
  const result = await runLayerAutoDag(fixture.bytes, async input => {
    calls++; assert.equal(input.reference.sha256, fixture.proposal.referenceSha256);
    assert.equal(input.layers.length, 2); assert.equal(input.canvas.width, 200);
    return fixture.proposal;
  });
  assert.equal(calls, 1); assert.equal(result.status, 'draft_pending_visual_review');
  assert.equal(result.humanVisualAcceptance, false); assert.equal(result.automaticRetries, 0);
  assert.deepEqual(result.nodes.map(node => node.stage), ['intake', 'session-plan', 'validate', 'compile']);
  assert.equal(result.plan.basis, 'model-proposed');
  assert.deepEqual(result.plan.document, fixture.plan.document);
  assert.equal(result.bundle.layerSource?.sha256, fixture.plan.archiveSha256);
  assert.ok(result.plan.planningEvidence?.findings.some(item => item.pointer === '/props/style/fontSize' && item.basis === 'inferred'));
  assert.equal(result.plan.planningEvidence?.referenceSha256, fixture.proposal.referenceSha256);
  assert.equal(result.responseSha256.length, 64);
  assert.ok(!JSON.stringify(result.bundle).includes('sessionId'));
  assert.equal((await validateBundle(result.bundle)).bundleVersion, '0.4');
});

test('unresolved planning, stale source and omitted typography evidence block without retry', async () => {
  const fixture = await layerPlanningFixture();
  for (const proposal of [
    { ...fixture.proposal, status: 'Unresolved', plan: null, reason: 'required-semantics-missing',
      missingInputs: [{ subject: '按钮', kind: 'unreadable-text', detail: '标签无法辨认。' }] },
    { ...fixture.proposal, referenceSha256: '0'.repeat(64) },
    { ...fixture.proposal, findings: fixture.proposal.findings.filter(item => item.pointer !== '/props/style/fontSize') },
    { ...fixture.proposal, findings: fixture.proposal.findings.map(item => item.pointer === '/props/label' ? { ...item, basis: 'inferred' } : item) },
    { ...fixture.proposal, findings: fixture.proposal.findings.map(item => ({ ...item, note: 'C:/Users/private/state.json' })) },
    { ...fixture.proposal, plan: { ...fixture.proposal.plan, requirements: 'C:/Users/private/session.json' } },
    { ...fixture.proposal, plan: { ...fixture.proposal.plan, bindings: [] } },
  ]) {
    let calls = 0;
    await assert.rejects(runLayerAutoDag(fixture.bytes, async () => { calls++; return proposal; }),
      (error: unknown) => error instanceof LayerAutoDagError && error.stage === 'validate' && error.nodes.at(-1)?.status === 'blocked');
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(runLayerAutoDag(fixture.bytes, async () => { calls++; throw new Error('SESSION_TIMEOUT_NO_RETRY'); }),
    (error: unknown) => error instanceof LayerAutoDagError && error.stage === 'session-plan');
  assert.equal(calls, 1);
});
test('caller mutations during planning cannot change authenticated source or expected context', async () => {
  const fixture = await layerPlanningFixture();
  const result = await runLayerAutoDag(fixture.bytes, async input => {
    fixture.bytes.fill(0); input.reference.bytes.fill(0);
    input.archiveSha256 = '0'.repeat(64); input.reference.sha256 = '0'.repeat(64);
    return fixture.proposal;
  });
  assert.equal(result.archiveSha256, fixture.plan.archiveSha256);
  assert.equal(result.referenceSha256, fixture.proposal.referenceSha256);
  assert.equal((await validateBundle(result.bundle)).bundleVersion, '0.4');
});

test('explicit aligned label lines need observed text and per-line typography/layout evidence', async () => {
  const fixture = await layerPlanningFixture(), proposal = structuredClone(fixture.proposal);
  const button = proposal.plan.document.root.children[1];
  if (button.type !== 'Button' || !button.props.appearance) throw new Error('fixture button');
  button.props.appearance.labelLines = { version: '1.0', coordinateSpace: 'target-component-local', lines: [
    { text: 'PLAY', fontSize: 12, fontWeight: 'bold', align: 'center', layout: { x: 2, y: 2, width: 56, height: 26 } },
  ] };
  proposal.findings = fixtureFindings(proposal.plan.document);
  assert.equal((await runLayerAutoDag(fixture.bytes, async () => proposal)).bundle.bundleVersion, '0.4');
  for (const findings of [
    proposal.findings.filter(item => !item.pointer.endsWith('/align')),
    proposal.findings.map(item => item.pointer.endsWith('/lines/0/text') ? { ...item, basis: 'inferred' } : item),
  ]) await assert.rejects(runLayerAutoDag(fixture.bytes, async () => ({ ...proposal, findings })),
    (error: unknown) => error instanceof LayerAutoDagError && error.stage === 'validate');
});

test('planning gate supports all sixteen types using complete explicit contract fixtures', async () => {
  const fixture = await layerPlanningFixture(), types = new Set<string>();
  for (const kind of ['gallery', 'composite'] as const) {
    const document = fixtureDocument(kind);
    const originalCanvas = document.canvas;
    const root = document.root;
    if (!('children' in root)) throw new Error('fixture must be composite');
    // Retain all explicit semantics; adapt authenticated artwork and canvas for this ZIP.
    document.canvas = { width: 200, height: 100 }; root.layout.width = 200; root.layout.height = 100;
    const imageNodes = walkNodes(document).filter(node => node.type === 'Image');
    for (const node of imageNodes) if (node.type === 'Image') { node.props.source = 'layers/layer-001.png'; delete node.props.region; }
    // Keep geometry inside the smaller source fixture without altering component types.
    const scale = Math.min(200 / originalCanvas.width, 100 / originalCanvas.height);
    for (const node of walkNodes(document)) {
      types.add(node.type);
      if (node !== root) { node.layout.x *= scale; node.layout.y *= scale; node.layout.width *= scale; node.layout.height *= scale; }
    }
    function imagePointers(value: unknown, pointer = ''): string[] {
      if (!value || typeof value !== 'object') return [];
      return Object.entries(value).flatMap(([key, child]) => child === 'layers/layer-001.png'
        ? [`${pointer}/${key}`] : imagePointers(child, `${pointer}/${key}`));
    }
    const pointers = imagePointers(document);
    const proposal = { ...fixture.proposal, plan: { ...fixture.proposal.plan, document,
      adaptations: fixtureProceduralAdaptations(document),
      layoutChecks: { version: '1.0', separations: [], unpairedText: walkNodes(document)
        .filter(node => node.type === 'Text' && node.props.text.length > 0)
        .map(node => ({ componentId: node.id, reason: 'Independent synthetic gallery text; no adjacent spacing relation claimed.' })) },
      bindings: pointers.map(pointer => ({ layerId: 'back', pointer })), unusedLayers: [{ layerId: 'button', reason: 'Not used by this gallery fixture.' }] },
      findings: fixtureFindings(document) };
    const result = await runLayerAutoDag(fixture.bytes, async () => proposal);
    assert.equal(result.bundle.bundleVersion, '0.4');
  }
  assert.equal(types.size, 16);
});
