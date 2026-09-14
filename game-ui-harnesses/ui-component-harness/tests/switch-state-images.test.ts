import { test } from 'node:test';
import assert from 'node:assert/strict';
import { switchStateImagesFixture } from './helpers/switch-state-images-fixture.ts';
import { applyAppearanceBinding } from '../src/appearance-apply.ts';
import { validateAppearanceBinding } from '../src/appearance-binding.ts';
import { validateBundle } from '../src/bundle.ts';
import { validateDocument } from '../src/tree-contract.ts';

test('versioned Switch images import and JSON save/reopen preserve all state resources', async () => {
 const f=await switchStateImagesFixture(); const b=await applyAppearanceBinding(f.target,f.imported,f.binding);
 assert.deepEqual(await validateBundle(JSON.parse(JSON.stringify(b))),b);
 const n:any=(b.document as any).root.children[1]; assert.equal(n.props.appearance.stateImages.version,'1.0');
 const paths=Object.values(n.props.appearance.stateImages.on);for(const path of paths) assert(b.resources.some(r=>r.path===path));
 const missing=structuredClone(b);missing.resources=missing.resources.filter(r=>r.path!==paths[0]);await assert.rejects(()=>validateBundle(missing));
 for(const mutate of [(a:any)=>delete a.off,(a:any)=>a.version='2.0',(a:any)=>a.on.trackImage='../bad.png']) {
  const d:any=structuredClone(b.document);mutate(d.root.children[1].props.appearance.stateImages);assert.throws(()=>validateDocument(d));
 }
 const legacy:any=structuredClone(f.binding);delete legacy.bindings[1].states.switch.stateImages;assert(!(await applyAppearanceBinding(f.target,f.imported,legacy)).document.root.children[1].props.appearance.stateImages);
});
test('state binding rejects unknown version, incomplete pairs, missing layers and wrong dimensions',async()=>{
 const f=await switchStateImagesFixture();
 for(const mutate of [(a:any)=>delete a.on,(a:any)=>a.version='2.0',(a:any)=>a.on.trackLayerId='missing',(a:any)=>a.on.thumbLayerId='switch-track']) {
  const b:any=structuredClone(f.binding);mutate(b.bindings[1].states.switch.stateImages);await assert.rejects(()=>validateAppearanceBinding(b,f.document,f.imported));
 }
});

import { referenceV2Fixture } from './helpers/reference-v2-fixture.ts';
import { importComponentHandoffWithReview } from '../src/component-handoff.ts';
import { exportReferenceHandoff } from '../src/reference-persistence.ts';
test('v2 complete ZIP import/save/export/reimport retains state images and original reference bytes',async()=>{
 const f=await referenceV2Fixture({stateImages:true});const first=await importComponentHandoffWithReview(f.zip);
 const reopened=await validateBundle(JSON.parse(JSON.stringify(first.bundle)));const zip=await exportReferenceHandoff(reopened);
 const last=await importComponentHandoffWithReview(zip);assert.deepEqual(last.bundle.document,first.bundle.document);assert.deepEqual(last.bundle.resources,first.bundle.resources);assert.deepEqual(last.referenceEvidence,first.referenceEvidence);
});
