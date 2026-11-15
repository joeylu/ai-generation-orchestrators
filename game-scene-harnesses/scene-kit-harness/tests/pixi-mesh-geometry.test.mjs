import test from 'node:test';
import assert from 'node:assert/strict';
import {hasDrawableTriangles} from '../src/pixi/mesh-geometry.mjs';

const triangle=()=>({positions:[0,0,1,0,0,1],uvs:[0,0,1,0,0,1],indices:[0,1,2]});
test('terrain draw guard skips genuine zero-triangle clips without changing retained attributes',()=>{
  for(const data of [{positions:[],uvs:[],indices:[]},{positions:[0,0,1,0],uvs:[0,0,1,0],indices:[]}]){
    const before=structuredClone(data);assert.equal(hasDrawableTriangles(data),false);assert.deepEqual(data,before);
  }
  const data=triangle(),before=structuredClone(data);assert.equal(hasDrawableTriangles(data),true);assert.deepEqual(data,before);
  assert.equal(hasDrawableTriangles({positions:new Float32Array(data.positions),uvs:new Float32Array(data.uvs),indices:new Uint32Array(data.indices)}),true);
});
test('terrain draw guard rejects real buffer violations instead of manufacturing a triangle',()=>{
  for(const patch of [{uvs:[0,0]},{indices:[0,1,3]},{indices:[0,1,-1]},{indices:[0,1,.5]},{indices:[0,1]},
    {positions:[0,0,1,0,Infinity,1]},{uvs:[0,0,1,0,NaN,1]},{positions:[0,0,1,0,1e100,1]}]){
    assert.throws(()=>hasDrawableTriangles({...triangle(),...patch}),/TERRAIN_MESH_GEOMETRY/);
  }
});
