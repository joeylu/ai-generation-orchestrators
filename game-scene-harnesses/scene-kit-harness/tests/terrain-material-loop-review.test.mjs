import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeRgbaPng,inspectPng} from '../src/png.mjs';
import {hash,seal,unseal} from '../src/generation/common.mjs';
import {buildTerrainMaterialLoop} from '../src/terrain-material-loop.mjs';
import {reviewTerrainMaterialLoop} from '../src/terrain-material-loop-review.mjs';

function fixture({phases=1,xRamp=false,noise=false}={}){
  const W=64,H=160,rgba=Buffer.alloc(W*H*4);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++)rgba.set(noise?[(x*7+y*3)%256,(Math.floor(x/8)*19+Math.floor(y/9)*13)%256,(x*3+y*11)%256,255]:xRamp?[x*3,y,x*3,255]:[y,y,y,255],(y*W+x)*4);
  const input=encodeRgbaPng(W,H,rgba),source={path:'materials/body.png',sha256:hash(input),byteLength:input.length},
    built=buildTerrainMaterialLoop(input,{source,outputPath:'materials/loop.png',usableRows:144,overlapRows:48,phaseCount:phases}),
    files=new Map([[source.path,input],[built.record.output.source.path,built.png]]),
    options={appearance:{format:'ai_scene_continuous_terrain_appearance_v6',body:{source,pixelSize:{width:W,height:H}}},readAsset:p=>files.get(p)};
  return {input,files,options,...built};
}

test('a native-contiguous Y wrap does not conceal the distant-row stitch inside a body loop',()=>{
  const f=fixture(),before=Buffer.from(f.input),review=reviewTerrainMaterialLoop(f.record,f.options);
  assert.equal(review.outputWraps.vertical.mean,1);
  assert.equal(review.selectedSourceJumps.vertical.samples,64);
  assert.equal(review.selectedSourceJumps.vertical.mean,95);
  assert.equal(review.selectedSourceJumps.vertical.meanExcess,94);
  assert.equal(review.selectedSourceJumps.horizontal.samples,0);
  assert.equal(review.sourceHorizontalWraps.meanExcess,0);
  assert.equal(review.work.neighborPairs,2*64*96);
  assert.equal(review.work.nativeContiguous+review.work.selectedSourceJumps+review.work.sourceHorizontalWraps,review.work.neighborPairs);
  assert.equal(review.technicalOrArtQualification,false);assert.equal(review.semanticFeatureDetection,false);
  assert.equal(review.artAcceptance,'not-assessed');assert.equal(review.sourceProcessing,'none');assert.equal(review.generationCalls,0);
  assert.deepEqual(f.input,before);assert.deepEqual(reviewTerrainMaterialLoop(f.record,f.options),review);
});

test('phase offsets move source X wraps and do not change source density or certify large-form continuity',()=>{
  const a=fixture({xRamp:true}),b=fixture({xRamp:true,phases:3}),one=reviewTerrainMaterialLoop(a.record,a.options),three=reviewTerrainMaterialLoop(b.record,b.options);
  assert.deepEqual(one.sourcePixelWorld,three.sourcePixelWorld);
  assert(Math.abs(three.bodyPeriodWorld.height-one.bodyPeriodWorld.height*3)<1e-9);
  assert.equal(three.phaseStrideWorld,one.bodyPeriodWorld.height);
  assert.equal(three.phaseStrideIsRepeatPeriod,false);
  assert.equal(three.sourceHorizontalWraps.samples,288);
  assert(three.sourceHorizontalWraps.maximumExcess>100);
  assert(three.sourceHorizontalWraps.worst.some(v=>v.column>0));
  assert.equal(three.phaseHorizontalTranslationsWorld.length,3);
  assert.equal(three.automaticWindowSelection,false);
});

test('loop review replays exact source, output and provenance rather than trusting a resealed claim',()=>{
  const f=fixture();
  const forged=seal({...unseal(f.record),provenanceSha256:'f'.repeat(64)});
  assert.throws(()=>reviewTerrainMaterialLoop(forged,f.options));
  f.files.set(f.record.output.source.path,f.input);
  assert.throws(()=>reviewTerrainMaterialLoop(f.record,f.options));
});

test('changing cut rows exposes horizontal branches with contrast from the real output neighbor pixels',()=>{
  const f=fixture({noise:true,phases:3}),review=reviewTerrainMaterialLoop(f.record,f.options),image=inspectPng(f.png,{includePixels:true});
  assert(review.selectedSourceJumps.horizontal.samples>0);
  for(const [axis,stats]of Object.entries(review.selectedSourceJumps))for(const sample of stats.worst){
    const x=sample.column,y=sample.row,beforeX=axis==='horizontal'?(x+image.width-1)%image.width:x,
      beforeY=axis==='vertical'?(y+image.height-1)%image.height:y;
    let contrast=0;for(let c=0;c<3;c++)contrast+=Math.abs(image.rgba[(y*image.width+x)*4+c]-image.rgba[(beforeY*image.width+beforeX)*4+c]);
    assert(Math.abs(sample.contrast-contrast/3)<1e-6);
  }
});
