import assert from 'node:assert/strict';
import test from 'node:test';
import { componentHandoffFixture } from './helpers/component-handoff-fixture.ts';
import { importComponentHandoffWithReview } from '../src/component-handoff.ts';
import { componentHandoffEntries } from '../src/decomposition-import.ts';
import { exportReferenceHandoff, zip, referenceSha256 } from '../src/reference-persistence.ts';
import { validateBundle } from '../src/bundle.ts';
const decode=(bytes:Uint8Array)=>JSON.parse(new TextDecoder().decode(bytes));
const encode=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v));
test('legacy handoff saves runtime values without inventing reference evidence or changing source members',async()=>{
 const source=await componentHandoffFixture(), imported=await importComponentHandoffWithReview(source);
 assert.equal(imported.bundle.bundleVersion,'0.3');assert.equal(imported.referenceEvidence.status,'missing_reference_evidence');
 const saved:any=structuredClone(imported.bundle);saved.document.root.children.find((n:any)=>n.id==='apply-switch').props.checked=true;
 const validated=await validateBundle(saved),out=await exportReferenceHandoff(validated),members=await componentHandoffEntries(out),original=await componentHandoffEntries(source);
 for(const[name,bytes]of original)if(name!=='handoff.json')assert.deepEqual(members.get(name),bytes);
 const manifest=decode(members.get('handoff.json')!);assert.equal(manifest.schemaVersion,'1.1');assert.equal(manifest.kind,'ai_ui_component_handoff_v1');assert.equal(manifest.reference,undefined);
 const reopened=await importComponentHandoffWithReview(out);assert.deepEqual(reopened.bundle.document,validated.document);assert.equal(reopened.referenceEvidence.visualComparisonReady,false);assert.equal(reopened.referenceEvidence.humanVisualAcceptance,false);
 assert.deepEqual((await importComponentHandoffWithReview(await exportReferenceHandoff(reopened.bundle))).bundle.document,validated.document);
 const stale:any=structuredClone(saved);stale.document.root.children[0].layout.x++;
 await assert.rejects(()=>validateBundle(stale),/REFERENCE_EVIDENCE_STALE/);
 const runtime=decode(members.get('runtime.ui-bundle.json')!);runtime.document.root.children[0].layout.x++;members.set('runtime.ui-bundle.json',encode(runtime));manifest.runtime_bundle.sha256=await referenceSha256(members.get('runtime.ui-bundle.json')!);members.set('handoff.json',encode(manifest));
 await assert.rejects(()=>importComponentHandoffWithReview(zip(members)),/RUNTIME_BUNDLE/);
});
test('legacy runtime revision rejects unknown version, omitted snapshot and bad digest',async()=>{
 const imported=await importComponentHandoffWithReview(await componentHandoffFixture()),bytes=await exportReferenceHandoff(imported.bundle);
 for(const change of ['version','missing','digest']){const members=await componentHandoffEntries(bytes),m=decode(members.get('handoff.json')!);if(change==='version')m.schemaVersion='1.2';if(change==='missing')delete m.runtime_bundle;if(change==='digest')m.runtime_bundle.sha256='0'.repeat(64);members.set('handoff.json',encode(m));await assert.rejects(()=>importComponentHandoffWithReview(zip(members)));}
});
