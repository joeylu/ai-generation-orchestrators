import test from 'node:test';
import assert from 'node:assert/strict';
import { core, fixture, catalog, copy } from './helpers.mjs';
import { createPanelBundle, validatePanelBundle } from '../src/panel-bundle.mjs';
import { digestJson } from '../src/canonical.mjs';

test('panel envelope and unchanged component bundle each round-trip and compile deterministically', async () => {
  const a = await createPanelBundle(fixture, catalog, core), b = await createPanelBundle(fixture, catalog, core);
  assert.deepEqual(a, b);
  assert.deepEqual(await validatePanelBundle(JSON.parse(JSON.stringify(a)), core), a);
  assert.deepEqual(await core.validateBundle(a.componentBundle), a.componentBundle);
  assert.equal(a.componentBundle.bundleVersion, '0.1');
  assert.equal(a.componentBundle.document.schemaVersion, '0.2');
  assert.deepEqual(a.componentBundle.resources, []);
  assert.equal(a.capabilities.font, 'environment-family');
  assert.equal(a.verification.browser, 'NOT_RUN');
});

test('modified state must be recompiled; a proper saved state is portable and distinct from initial state', async () => {
  const saved = await createPanelBundle(fixture, catalog, core, { volume: 25, audioEnabled: false });
  assert.deepEqual((await validatePanelBundle(saved, core)).state, { volume: 25, audioEnabled: false });
  assert.equal(saved.spec.state[0].initial, 80);
  const tampered = copy(saved); tampered.state.volume = 90;
  await assert.rejects(validatePanelBundle(tampered, core), /MISMATCH/);
});

test('recomputed outer checksum cannot disguise a component tree inconsistent with PanelSpec', async () => {
  const bad = copy(await createPanelBundle(fixture, catalog, core));
  bad.componentBundle.document.root.children[0].layout.x += 1;
  const { sha256, ...payload } = bad; bad.sha256 = await digestJson(payload);
  await assert.rejects(validatePanelBundle(bad, core), /MISMATCH/);
});

test('unknown fields, unsupported versions, invented review success, wrong catalog and hashes are rejected', async () => {
  for (const change of [
    b => { b.extra = true; }, b => { b.panelBundleVersion = '9.0'; },
    b => { b.verification.humanVisualReview = 'PASS'; },
    b => { b.catalog.themes[0].tokens.text = '#FF0000'; },
    b => { b.sha256 = '0'.repeat(64); }, b => { delete b.state; },
  ]) { const bad = await createPanelBundle(fixture, catalog, core); change(bad); await assert.rejects(validatePanelBundle(bad, core)); }
});

test('library envelope rejects accessors, hidden fields, symbols and cycles before reading values', async () => {
  for (const change of [
    b => Object.defineProperty(b, 'hidden', { value: true }),
    b => { b[Symbol('unexpected')] = true; },
    b => Object.defineProperty(b, 'spec', { enumerable: true, get() { throw new Error('getter executed'); } }),
    b => { b.loop = b; },
  ]) {
    const input = copy(await createPanelBundle(fixture, catalog, core)); change(input);
    await assert.rejects(validatePanelBundle(input, core), error => !error.message.includes('getter executed'));
  }
});

test('agent authorship survives the legacy component adapter without claiming user authorship or overflowing its description', async () => {
  const spec = copy(fixture);
  spec.provenance.kind = 'agent-authored';
  spec.provenance.description = '长'.repeat(1000);
  const bundle = await createPanelBundle(spec, catalog, core);
  assert.deepEqual((await validatePanelBundle(bundle, core)).spec.provenance, spec.provenance);
  assert.equal(bundle.componentBundle.provenance.kind, 'user-provided');
  assert.match(bundle.componentBundle.provenance.description, /Agent-proposed.*not user-authored or reviewed/);
  assert.equal(bundle.verification.humanVisualReview, 'NOT_RUN');
});
