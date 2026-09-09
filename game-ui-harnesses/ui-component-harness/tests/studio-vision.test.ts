import test from 'node:test';
import assert from 'node:assert/strict';
import { compileVisionResult, recognizeReference } from '../src/studio-vision.ts';
import { fixtureInputs, fixtureStyle } from '../src/fixtures.ts';
import { walkNodes } from '../src/tree-contract.ts';

const source = { path: 'assets/reference.png', sha256: 'a'.repeat(64), width: 1024, height: 1024 };
function candidate(kind: 'composite' | 'gallery' = 'gallery') {
  const { intent, policy } = fixtureInputs(kind);
  function rewrite(node: typeof intent.root) {
    if (node.componentType === 'Image') node.props.source = source.path;
    if ('children' in node) node.children.forEach(rewrite);
  }
  rewrite(intent.root);
  return { version: '0.1', sourceSha256: source.sha256, status: 'Ready', summary: 'Explicit procedural semantic test double, not a vision result.', intent, policy };
}

test('observation-only boundary compiles without a model contract and preserves incomplete facts', () => {
  const observation = { version: '0.2', sourceSha256: source.sha256, status: 'Observed', summary: 'Visible toggle.', components: [
    { id: 'toggle', parentId: null, componentType: 'Switch', bounds: { x: 20, y: 20, width: 200, height: 60 }, evidence: 'Track and thumb.', visibleProps: { label: '音效', checked: false } },
  ] };
  const envelope = { version: '0.4', sourceSha256: source.sha256, status: observation.status, summary: observation.summary, observation };
  const before = structuredClone(envelope);
  const result = compileVisionResult(envelope, source);
  assert.equal(result.status, 'Ready');
  assert.deepEqual(envelope, before);
  const incomplete = structuredClone(envelope);
  delete (incomplete.observation.components[0].visibleProps as Record<string, unknown>).checked;
  const blocked = compileVisionResult(incomplete, source);
  assert.equal(blocked.status, 'Unresolved');
  assert.ok(blocked.missing?.some(item => item.componentId === 'toggle' && item.field === 'checked'));
  assert.throws(() => compileVisionResult({ ...envelope, contract: {} }, source));
  assert.throws(() => compileVisionResult({ ...envelope, summary: 'Unbound summary' }, source));
  assert.throws(() => compileVisionResult({ ...envelope, status: 'Ready' }, source));
});

test('semantic boundary compiles all sixteen types from explicit model-shaped fixtures', () => {
  const types = new Set<string>();
  for (const kind of ['composite', 'gallery'] as const) {
    const input = candidate(kind), before = structuredClone(input);
    const result = compileVisionResult(input, source);
    assert.equal(result.status, 'Ready');
    if (result.status === 'Ready') walkNodes(result.document).forEach(node => types.add(node.type));
    assert.deepEqual(input, before);
  }
  assert.equal(types.size, 16);
});

test('uncertain and unsupported semantic results cannot acquire a render document', () => {
  for (const status of ['Unresolved', 'Custom-required']) {
    const value = { version: '0.1', sourceSha256: source.sha256, status, summary: 'Visible state cannot be determined.' };
    assert.deepEqual(compileVisionResult(value, source), { status, summary: value.summary });
    assert.throws(() => compileVisionResult({ ...value, intent: candidate().intent }, source));
  }
});

test('semantic results reject stale source digests, invented resources and missing layout', () => {
  assert.throws(() => compileVisionResult({ ...candidate(), sourceSha256: 'b'.repeat(64) }, source));
  const missing = candidate(); delete missing.policy.layout[missing.intent.root.id];
  assert.throws(() => compileVisionResult(missing, source));
  const invented = candidate('composite');
  function rewrite(node: typeof invented.intent.root) {
    if (node.componentType === 'Image') node.props.source = 'https://example.invalid/unavailable.png';
    if ('children' in node) node.children.forEach(rewrite);
  }
  rewrite(invented.intent.root);
  assert.throws(() => compileVisionResult(invented, source), /VISION_UNAVAILABLE_RESOURCE/);
  assert.throws(() => compileVisionResult({ ...candidate(), providerSecret: 'forbidden' }, source));
});

test('a live-shaped root ID without a node object cannot publish a Ready document', () => {
  const value = candidate();
  const invalid = { ...value, intent: { intentVersion: '0.2', id: 'purchaseButtonImage', root: 'referenceImage' } };
  assert.throws(() => compileVisionResult(invalid, source));
});

test('recognition preserves semantic rejection codes without another provider request', async t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    return Response.json({ version: '0.2', sourceSha256: source.sha256, status: 'Ready', summary: 'A checkable control.',
      classification: 'control', observedTypes: ['CheckBox'], documentId: 'mismatch', canvas: { width: 100, height: 40 },
      styles: [{ id: 'base', ...fixtureStyle }], nodes: [{ id: 'picture', parentId: null, componentType: 'Image', styleId: 'base',
        props: { source: source.path, fit: 'stretch' }, layout: { x: 0, y: 0, width: 100, height: 40 } }] });
  });
  await assert.rejects(recognizeReference({ ...source, mime: 'image/png', base64: 'AA==' }, new AbortController().signal),
    { message: 'VISION_SEMANTIC_COVERAGE_MISMATCH' });
  assert.equal(requests, 1);
});

test('recognition distinguishes malformed component contracts from transport failures', async t => {
  const value = candidate();
  const malformed = { ...value, intent: { intentVersion: '0.2', id: 'invalid-tree', root: 'missing-node' } };
  t.mock.method(globalThis, 'fetch', async () => Response.json(malformed));
  await assert.rejects(recognizeReference({ ...source, mime: 'image/png', base64: 'AA==' }, new AbortController().signal),
    { message: 'VISION_CONTRACT_INVALID' });
});
