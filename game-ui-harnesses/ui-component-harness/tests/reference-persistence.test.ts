import test from 'node:test';
import assert from 'node:assert/strict';
import { referenceV2Fixture } from './helpers/reference-v2-fixture.ts';
import { importComponentHandoffWithReview } from '../src/component-handoff.ts';
import { validateBundle } from '../src/bundle.ts';
import { exportReferenceHandoff, validatePersistedHandoff } from '../src/reference-persistence.ts';

test('v2 save/reopen/reexport retains original, derivative, mapping/state/scope bytes and digests', async () => {
  const f = await referenceV2Fixture(), first = await importComponentHandoffWithReview(f.zip);
  assert.equal(first.bundle.bundleVersion, '0.3');
  const reopened = await validateBundle(JSON.parse(JSON.stringify(first.bundle)));
  const copy: any = structuredClone(reopened); copy.document.root.children[0].props.checked = true;
  const edited = await validateBundle(copy), exported = await exportReferenceHandoff(edited);
  const last = await importComponentHandoffWithReview(exported);
  assert.deepEqual(last.referenceEvidence, first.referenceEvidence);
  assert.equal((last.bundle.document as any).root.children[0].props.checked, true);
  assert.equal(last.referenceEvidence.humanVisualAcceptance, false);
});
for (const [name, mutate] of [
  ['component ID', (b: any) => b.document.root.children[0].id = 'changed'],
  ['canvas', (b: any) => b.document.canvas.width++],
  ['layout', (b: any) => b.document.root.children[0].layout.x++],
  ['digest', (b: any) => b.componentHandoff.sha256 = '0'.repeat(64)],
] as const) test(`persisted reference rejects stale ${name}`, async () => {
  const { bundle } = await importComponentHandoffWithReview((await referenceV2Fixture()).zip);
  const copy = structuredClone(bundle); mutate(copy); await assert.rejects(validateBundle(copy), /REFERENCE_/);
});
test('unknown remains unknown across persistent roundtrip', async () => {
  const { bundle } = await importComponentHandoffWithReview((await referenceV2Fixture({ unknown: true })).zip);
  const saved = await validateBundle(JSON.parse(JSON.stringify(bundle)));
  const evidence = await validatePersistedHandoff(saved.componentHandoff, saved);
  assert.equal(evidence.visualComparisonReady, false); assert.deepEqual(evidence.unknownFields, ['apply-switch.checked']);
  const last = await importComponentHandoffWithReview(await exportReferenceHandoff(saved)); assert.deepEqual(last.referenceEvidence, evidence);
});
