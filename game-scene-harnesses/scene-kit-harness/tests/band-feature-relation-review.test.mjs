import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {digest,imageRef,seal} from '../src/generation/common.mjs';
import {reviewBandFeatureRelations,assertBandFeatureRelations} from '../src/generation/band-feature-relation-review.mjs';

const rawBytes=readFileSync(new URL('./fixtures/synthetic/assets/terrain-000.png',import.meta.url));
const rel={format:'ai_scene_band_feature_relations_v1',referenceRawSha256:'a'.repeat(64),features:[{featureId:'peak',description:'peak'},{featureId:'tower',description:'tower'}],relations:[{from:'peak',to:'tower',axis:'x',min:.25,max:.5}]};
function input(){const scope=seal({bandFeatureRelations:rel}),plan=seal({format:'ai_scene_generation_plan_v27',recipe:{sourceScope:scope},sourceScope:{definition:scope,bandFeatureRelationsSha256:digest(rel)}}),image=imageRef(rawBytes,{allowHiddenRgb:true,allowCabx:true}),technical=seal({format:'ai_scene_coherent_source_qa_v1',planSha256:plan.sha256,rawSha256:image.sha256,image,status:'pass'});
 return {plan,technical,rawBytes,observations:[{featureId:'peak',x:[.25,.375],y:[0,0]},{featureId:'tower',x:[.75,.75],y:[0,0]}]};}
test('conservative interval arithmetic evaluates edges, violation, overlap and missing observations',()=>{
 const a=input();let r=reviewBandFeatureRelations(a);assert.equal(r.status,'reviewed');assert.equal(r.findings[0].status,'satisfied');assert.deepEqual(r.findings[0].observedDelta,[.375,.5]);assert.deepEqual(assertBandFeatureRelations(a,r),r);
 const b=input();b.observations[1].x=[.625,.875];r=reviewBandFeatureRelations(b);assert.equal(r.findings[0].status,'uncertain');assert.equal(r.status,'blocked');assert.throws(()=>assertBandFeatureRelations(b,r));
 const c=input();c.observations[1].x=[.9375,1];r=reviewBandFeatureRelations(c);assert.equal(r.findings[0].status,'violated');assert.equal(r.status,'blocked');
 const d=input();d.observations.pop();r=reviewBandFeatureRelations(d);assert.equal(r.findings[0].status,'missing');assert.equal(r.status,'blocked');
 const e=input();e.observations[0].x=[.25,.25];e.observations[1].x=[.5,.5];assert.equal(reviewBandFeatureRelations(e).findings[0].status,'satisfied');
});
test('rejects stale evidence, changed image, mismatched plan, duplicate and invalid observations',()=>{
 const a=input(),r=reviewBandFeatureRelations(a);assert.equal(r.automaticImageUnderstanding,false);assert.equal(r.humanArtAcceptance,'not-assessed');
 const b=input();b.observations[1].x=[.625,.75];assert.throws(()=>assertBandFeatureRelations(b,r));
 assert.throws(()=>assertBandFeatureRelations(a,{...r,status:'blocked'}));
 const c=input();c.rawBytes=Buffer.concat([rawBytes,Buffer.from([0])]);assert.throws(()=>reviewBandFeatureRelations(c));
 const d=input();d.technical=seal({...d.technical,sha256:undefined,planSha256:'b'.repeat(64)});assert.throws(()=>reviewBandFeatureRelations(d));
 const e=input();e.observations.push(e.observations[0]);assert.throws(()=>reviewBandFeatureRelations(e));
 const f=input();f.observations[0].x=[.8,.2];assert.throws(()=>reviewBandFeatureRelations(f));
});
