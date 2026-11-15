import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectPng} from '../src/png.mjs';
import {hash,imageRef,unseal} from '../src/generation/common.mjs';
import {BACKGROUND_BAND_COVERAGE_BUDGET} from '../src/generation/background-band-coverage-guide.mjs';
import {backgroundBandIrregularValleyGuide as guide,BACKGROUND_BAND_IRREGULAR_VALLEY_GUIDE_PROFILE as profile,
  BACKGROUND_BAND_IRREGULAR_VALLEY_GUIDE_IMAGE_ROLE as imageRole} from '../src/generation/background-band-irregular-valley-guide.mjs';

const options=(aspect={numerator:52,denominator:21})=>({role:'valley',canvasAspect:aspect,coverageBudget:BACKGROUND_BAND_COVERAGE_BUDGET});
const at=(p,x,y)=>p.rgba[(y*p.width+x)*4+3];
const rejects=(fn,code)=>assert.throws(fn,e=>e.errors?.some(item=>item.code===code));

test('fixed valley guide has a pinned canonical image, recipe and fresh deterministic bytes',()=>{
  const first=guide(options()),again=guide(options()),p=inspectPng(first.bytes,{includePixels:true});
  assert.equal(profile,'open-valley-irregular-coverage-v3');assert.equal(first.profile,profile);
  assert.equal(first.recipe.imageRole,imageRole);assert.deepEqual(first.recipe.pixelSize,{width:1040,height:420});
  assert.equal(hash(first.bytes),'a65572b0a942841a1c04f7c280581992cc3a31584d93d85e5fb1946905c8d4fa');
  assert.equal(first.recipe.sha256,'2a94086442760a2563147aecf976227c8f3ef44456c87e60fe0e852fed87fb73');
  assert.deepEqual(first.artifact,imageRef(first.bytes));assert.deepEqual(first.bytes,again.bytes);assert.notStrictEqual(first.bytes,again.bytes);
  assert.equal(unseal(first.recipe).maximumNewImageCalls,0);assert.equal(p.width*21,p.height*52);
});

test('bounded aspects preserve real transparent top and finite material and void cuts',()=>{
  for(const aspect of [{numerator:52,denominator:21},{numerator:8,denominator:1},{numerator:1,denominator:1}]){
    const p=inspectPng(guide(options(aspect)).bytes,{includePixels:true});
    for(let y=0;y<2;y++)for(let x=0;x<p.width;x++)assert.equal(at(p,x,y),0);
    for(let y=0;y<p.height;y++)assert.equal(at(p,Math.floor(p.width/2),y),0,'this guide example has no drawn crossing');
    assert.equal(at(p,0,p.height-1),255);assert.equal(at(p,p.width-1,p.height-1),255);
    assert.equal(at(p,Math.floor(p.width/2),p.height-1),0);
    for(let i=0;i<p.rgba.length;i+=4){const a=p.rgba[i+3];
      assert(a===0||a===255);if(a===0)assert.deepEqual([...p.rgba.subarray(i,i+4)],[0,0,0,0]);}
  }
});

test('guide rejects other roles, invalid dimensions and modified coverage budget',()=>{
  for(const role of ['backdrop','foreground','ground'])rejects(()=>guide({...options(),role}),'BACKGROUND_BAND_IRREGULAR_VALLEY_ROLE');
  for(const aspect of [{numerator:0,denominator:1},{numerator:9,denominator:1},{numerator:Infinity,denominator:1}])
    rejects(()=>guide(options(aspect)),'BACKGROUND_BAND_IRREGULAR_VALLEY_ASPECT');
  const budget=structuredClone(BACKGROUND_BAND_COVERAGE_BUDGET);budget.majorFeatureWidthPercent.min=21;
  rejects(()=>guide({...options(),coverageBudget:budget}),'BACKGROUND_BAND_IRREGULAR_VALLEY_BUDGET');
});
