import test from 'node:test';
import assert from 'node:assert/strict';
import { compileVisionResult } from '../src/studio-vision.ts';
import { fixtureInputs } from '../src/fixtures.ts';
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
