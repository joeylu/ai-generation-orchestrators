import test from 'node:test';
import assert from 'node:assert/strict';
import { compileDecompositionAssets } from '../src/component-handoff.ts';
import { appearanceApplicationFixture } from './helpers/appearance-application-fixture.ts';

test('independent assets compile with explicit semantics and preserve upstream review', async () => {
  const { fixture, target, binding, imported } = await appearanceApplicationFixture();
  const result = await compileDecompositionAssets(fixture.zip, target, binding);
  assert.equal(result.archiveSha256, imported.archiveSha256);
  assert.deepEqual(result.review, imported.review);
  assert.equal(result.bundle.document.schemaVersion, '0.2');
  assert.ok(result.bundle.resources.length > 0);
  assert.equal('componentHandoff' in result.bundle, false);
});

test('independent assets reject incomplete component and state-role coverage', async () => {
  const { fixture, target, binding } = await appearanceApplicationFixture();
  await assert.rejects(compileDecompositionAssets(fixture.zip, target,
    { ...binding, bindings: binding.bindings.slice(0, 1) }), /INTERACTIVE_BINDING_REQUIRED/);
  const missing = structuredClone(binding) as any;
  missing.bindings[1].parts = missing.bindings[1].parts.filter((part: any) => part.role !== 'thumb');
  await assert.rejects(compileDecompositionAssets(fixture.zip, target, missing));
});

test('independent assets reject stale binding identities and unsafe geometry', async () => {
  const { fixture, target, binding } = await appearanceApplicationFixture();
  await assert.rejects(compileDecompositionAssets(fixture.zip, target, { ...binding, archiveSha256: '0'.repeat(64) }));
  const shifted = { ...binding, registration: { ...binding.registration,
    transform: { scale: 1, offset: { x: 20, y: 0 } } } };
  await assert.rejects(compileDecompositionAssets(fixture.zip, target, shifted));
});
