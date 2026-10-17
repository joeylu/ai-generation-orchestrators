import test from 'node:test';
import assert from 'node:assert/strict';
import {canvasResolution} from '../src/studio/canvas-resolution.mjs';
const base={width:1440,height:1120};
test('zoomed preview covers device pixels at fractional and high screen densities',()=>{
 for(const devicePixelRatio of [1,1.25,2])for(const scale of [.47,1,1.5,2]){
  const q=canvasResolution({...base,scale,devicePixelRatio});
  assert.ok(q.resolution>=scale*devicePixelRatio);assert.equal(q.limited,false);
 }
 assert.equal(canvasResolution({...base,scale:1.5,devicePixelRatio:1.25}).resolution,2);
});
test('extreme zoom and density obey the GPU dimension and pixel budget',()=>{
 for(const maxDimension of [2048,4096,8192]){
  const q=canvasResolution({...base,scale:2.5,devicePixelRatio:4,maxDimension});
  assert.equal(q.limited,true);assert.ok(base.width*q.resolution<=maxDimension);assert.ok(base.height*q.resolution<=maxDimension);
  assert.ok(base.width*base.height*q.resolution**2<=32*1024*1024);
 }
 assert.throws(()=>canvasResolution({...base,scale:NaN}));
 assert.throws(()=>canvasResolution({...base,scale:1,maxPixels:1}));
});
