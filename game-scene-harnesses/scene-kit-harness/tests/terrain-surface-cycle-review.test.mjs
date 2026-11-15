import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTerrainSurfaceCycle,reviewTerrainSurfaceCycle} from '../src/terrain-surface-cycle.mjs';
import {inspectPng,encodeRgbaPng} from '../src/png.mjs';
import {hash,seal,unseal} from '../src/generation/common.mjs';

function fixture(ramp=true){
  const W=128,H=64,rgba=Buffer.alloc(W*H*4);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++)rgba.set([ramp?x*2:y*2,y*3,ramp?x*2:y,255],(y*W+x)*4);
  const input=encodeRgbaPng(W,H,rgba),source={path:'materials/cap.png',sha256:hash(input),byteLength:input.length},
    derived=buildTerrainSurfaceCycle(input,{source,outputPath:'materials/cycle.png',fromColumn:8,usableColumns:96,overlapColumns:32}),
    files=new Map([[source.path,input],[derived.record.output.source.path,derived.png]]),options={readAsset:p=>files.get(p),display:{capEndRow:32,fadeRows:0,widthWorld:512}};
  return {input,files,options,...derived};
}

test('a native-contiguous repeat wrap does not hide a distant-column internal stitch',()=>{
  const f=fixture(),before=Buffer.from(f.input),review=reviewTerrainSurfaceCycle(f.record,f.options),image=inspectPng(f.png,{includePixels:true});
  let wrap=0;for(let c=0;c<3;c++)wrap+=Math.abs(image.rgba[c]-image.rgba[(image.width-1)*4+c]);
  assert(wrap/3<2);assert.equal(review.horizontalStitches.mean,84);assert(review.horizontalStitches.meanExcess>82);
  assert.equal(review.horizontalStitches.samples,32);assert.equal(review.subperiodWorld,256);assert.equal(review.repeatCount,2);
  assert.equal(review.cycleSha256,f.record.sha256);assert.equal(review.technicalOrArtQualification,false);
  assert.equal(review.semanticCoverDetection,false);assert.equal(review.automaticWindowSelection,false);
  assert.equal(review.artAcceptance,'not-assessed');assert.equal(review.productionKit,false);assert.equal(review.generationCalls,0);
  assert.deepEqual(f.input,before);assert.deepEqual(reviewTerrainSurfaceCycle(f.record,f.options),review);
});

test('native row variation is retained without inventing a stitch defect or an artwork pass',()=>{
  const f=fixture(false),review=reviewTerrainSurfaceCycle(f.record,{...f.options,display:{capEndRow:48,fadeRows:12,widthWorld:320}});
  assert.equal(review.horizontalStitches.meanExcess,0);assert.equal(review.verticalBranchStitches.samples,0);
  assert.equal(review.subperiodWorld,160);assert.equal(review.technicalOrArtQualification,false);
  assert.deepEqual(review.display,{capEndRow:48,fadeRows:12,widthWorld:320});
});

test('review replays the source/output and rejects forged records or invalid display bindings',()=>{
  const f=fixture();
  for(const display of [{capEndRow:65,fadeRows:0,widthWorld:512},{capEndRow:32,fadeRows:33,widthWorld:512},
    {capEndRow:32,fadeRows:0,widthWorld:0},{capEndRow:32,fadeRows:0,widthWorld:Infinity},{capEndRow:32,fadeRows:0,widthWorld:512,artAccepted:true}])
    assert.throws(()=>reviewTerrainSurfaceCycle(f.record,{...f.options,display}));
  const forged=seal({...unseal(f.record),provenanceSha256:'f'.repeat(64)});assert.throws(()=>reviewTerrainSurfaceCycle(forged,f.options));
  f.files.set(f.record.output.source.path,f.input);assert.throws(()=>reviewTerrainSurfaceCycle(f.record,f.options));
});
