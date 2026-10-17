import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compareCrops} from '../src/skins/crop-comparison.mjs';
test('crop difference accounts alpha on each side, ignoring hidden RGB',()=>{
  const im={width:4,height:1,pixels:Buffer.from([255,255,255,0,0,0,0,1,0,0,0,128,0,0,0,255])};
  const r=compareCrops(im,[0,0,3,1],[2,0,2,1]);
  assert.deepEqual(r.baselineOnly,{nonzeroPixels:1,alphaSum:1,maxAlpha:1});
  assert.equal(r.shared.alphaSum,128);assert.equal(r.proposalOnly.alphaSum,255);
  const same=compareCrops(im,[0,0,4,1],[0,0,4,1]);assert.equal(same.shared.alphaSum,384);assert.equal(same.baselineOnly.nonzeroPixels,0);
  assert.throws(()=>compareCrops(im,[-1,0,2,1],[0,0,1,1]),/bounds/);
});
