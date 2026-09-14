import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {referenceV2Fixture} from '../../ui-component-harness/tests/helpers/reference-v2-fixture.ts';
import {importComponentHandoffWithReview} from '../../ui-component-harness/src/component-handoff.ts';
import {exportReferenceHandoff} from '../../ui-component-harness/src/reference-persistence.ts';
import {componentHandoffEntries} from '../../ui-component-harness/src/decomposition-import.ts';
import {forceZip64Stored} from '../../ui-component-harness/tests/helpers/decomposition-fixture.ts';

test('producer 2.1 schema matches authenticated runtime bundle; invalid digest rejected',async()=>{
  const source=(await importComponentHandoffWithReview((await referenceV2Fixture()).zip)).bundle;
  const entries=await componentHandoffEntries(await exportReferenceHandoff(source));
  const manifest=JSON.parse(new TextDecoder().decode(entries.get('handoff.json')));
  const schema=JSON.parse(readFileSync(new URL('../references/component-handoff-v2.1.schema.json',import.meta.url)));
  assert.deepEqual(Object.keys(manifest).sort(),schema.required.slice().sort());
  assert.equal(manifest.schemaVersion,schema.properties.schemaVersion.const);
  assert.equal(manifest.runtime_bundle.path,schema.properties.runtime_bundle.properties.path.const);
  manifest.runtime_bundle.sha256='0'.repeat(64);
  entries.set('handoff.json',new TextEncoder().encode(JSON.stringify(manifest)));
  await assert.rejects(importComponentHandoffWithReview(forceZip64Stored([...entries].map(([name,bytes])=>({name,bytes})))),/RUNTIME_BUNDLE_DIGEST/);
});
