import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkRecompositionReview, assertRecompositionReview} from '../src/generation/recomposition-review.mjs';
import {crc32} from '../src/png.mjs';
import {hash} from '../src/generation/common.mjs';

const png = readFileSync(new URL('./fixtures/synthetic/assets/terrain-000.png', import.meta.url));
const make = () => ({referenceBytes:png,studioCaptureBytes:png,mapSha256:'a'.repeat(64),kitSha256:'b'.repeat(64),observations:
  [['background','depth'],['background','composition'],['background','source-content'],['midground','composition'],['midground','source-content'],['foreground','composition'],['foreground','source-content'],['midground','joins'],['foreground','brush']].map(([area,check],i)=>({
    observationId:`o${i}`,area,check,referenceRegion:[0,0,1,1],captureRegion:[0,0,1,1],referenceFinding:'Synthetic reference evidence',captureFinding:'Synthetic capture evidence',verdict:'match'
  }))});
test('explicit review binds input but does not imply automated vision or human acceptance',()=>{
  const input=make(), report=checkRecompositionReview(input);
  assert.equal(report.status,'reviewed'); assert.equal(report.automaticImageUnderstanding,false);
  assert.equal(report.captureProvenance,'not-verified'); assert.equal(report.brushInteraction,'not-verified');
  assert.equal(report.humanArtAcceptance,'not-assessed'); assert.deepEqual(assertRecompositionReview(input,report),report);
  assert.throws(()=>assertRecompositionReview({...input,mapSha256:'c'.repeat(64)},report));
  assert.throws(()=>assertRecompositionReview({...input,observations:input.observations.slice(1)},report));
  assert.throws(()=>assertRecompositionReview(input,{...report,status:'blocked'}));
});
test('missing areas or criteria and adverse or uncertain observations block',()=>{
  const input=make(); input.observations[1].verdict='mismatch'; input.observations[3].verdict='uncertain'; input.observations.pop();
  const report=checkRecompositionReview(input);
  assert.equal(report.status,'blocked');
  assert.deepEqual(new Set(report.findings.map(f=>f.code)),new Set(['VISUAL_MISMATCH','VISUAL_UNCERTAIN','CHECK_NOT_REVIEWED']));
  assert.throws(()=>assertRecompositionReview(input,report));
  const empty=checkRecompositionReview({...input,observations:[]});
  assert.equal(empty.findings.filter(f=>f.code==='AREA_NOT_REVIEWED').length,3);
  assert.equal(empty.findings.filter(f=>f.code==='CHECK_NOT_REVIEWED').length,5);
});
test('invalid evidence is rejected rather than silently counted',()=>{
  const input=make(); input.observations[0].captureRegion=[0,0,2,1];
  assert.throws(()=>checkRecompositionReview(input));
  input.observations[0].captureRegion=[0,0,1,1]; input.observations[0].captureFinding='';
  assert.throws(()=>checkRecompositionReview(input));
  input.observations[0].captureFinding='detail'; input.observations[1].observationId=input.observations[0].observationId;
  assert.throws(()=>checkRecompositionReview(input));
});

test('review binds the original reference bytes including checked native caBX metadata',()=>{
  const chunk=Buffer.alloc(13);
  chunk.writeUInt32BE(1,0); chunk.write('caBX',4,'ascii'); chunk[8]=1;
  chunk.writeUInt32BE(crc32(chunk.subarray(4,9)),9);
  const referenceBytes=Buffer.concat([png.subarray(0,33),chunk,png.subarray(33)]);
  const input={...make(),referenceBytes},report=checkRecompositionReview(input);
  assert.equal(report.reference.sha256,hash(referenceBytes));
  assert.deepEqual(assertRecompositionReview(input,report),report);
  assert.throws(()=>assertRecompositionReview(make(),report));
  const corrupted=Buffer.from(referenceBytes); corrupted[41]^=1;
  assert.throws(()=>checkRecompositionReview({...input,referenceBytes:corrupted}));
});
