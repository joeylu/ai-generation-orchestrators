import test from 'node:test';
import assert from 'node:assert/strict';
import {compileTerrainStepCorners} from '../src/terrain-step-corners.mjs';
import {buildTerrainStepSurface,validateTerrainStepSurface,TERRAIN_STEP_LINEAR_SURFACE_PROFILE} from '../src/terrain-step-surface.mjs';
import {validateMeshCoverage} from '../src/mesh-coverage.mjs';
import {paintCoherentMesh} from '../src/coherent-mesh-render.mjs';
import {seal,unseal} from '../src/generation/common.mjs';
import {validateDocument} from '../src/schema.mjs';
import {stepSurfaceFixture} from './helpers/terrain-step-surface.mjs';

function linearFixture(){const f=stepSurfaceFixture();f.surfaceBinding=buildTerrainStepSurface({appearance:f.appearance,surfaceInterface:f.surfaceInterface,
  surfaceSpanEnvelope:f.surfaceSpanEnvelope,stepCorners:f.profile,profile:TERRAIN_STEP_LINEAR_SURFACE_PROFILE});return f;}
const quads=meshes=>meshes.flatMap(m=>Array.from({length:m.positions.length/8},(_,i)=>({positions:m.positions.slice(i*8,i*8+8),uvs:m.uvs.slice(i*8,i*8+8)})))
  .map(q=>JSON.stringify(q)).sort();

test('linear wall ends retain every source quad/UV and triangle while pooling the original overlap meshes',()=>{
  const input=linearFixture(),before=structuredClone(input),result=compileTerrainStepCorners(input),old=compileTerrainStepCorners(stepSurfaceFixture()),
    fresh=result.gridTerrains[0].cornerMeshes,prior=old.gridTerrains[0].cornerMeshes;
  assert.deepEqual(input,before);assert.deepEqual(result.gridTerrains[0].body,old.gridTerrains[0].body);
  const owned=structuredClone(input),reused=compileTerrainStepCorners(owned,{ownedMeshes:true});
  assert.equal(reused.gridTerrains,owned.gridTerrains);
  assert.deepEqual(reused,result);
  assert.deepEqual(fresh.filter(m=>m.materialKind==='body'),prior.filter(m=>m.materialKind==='body'));
  assert.deepEqual(quads(fresh.filter(m=>m.materialKind==='cap')),quads(prior.filter(m=>m.materialKind==='cap')));
  assert.deepEqual(fresh.filter(m=>m.capWallEndCoverage===1),prior.filter(m=>m.capWallEndCoverage===1));
  assert.equal(result.report.triangles,old.report.triangles);assert(result.report.cornerMeshes<old.report.cornerMeshes);
  assert.deepEqual(result.report.limits,old.report.limits);assert.equal(result.report.alphaDistributionChangedWithinWallOverlap,true);
  const walls=fresh.filter(m=>m.vertexCoverage);assert.equal(walls.length,2);
  for(const m of walls){assert(validateMeshCoverage(m));assert.equal(m.vertexCoverage.length,400);assert.equal(m.coverageOpacity,1);
    const {fromWorld,toWorld}=m.wallFade,span=Math.abs(toWorld-fromWorld);assert.equal(span,8);
    assert.equal(Math.min(...m.vertexCoverage),0);assert.equal(Math.max(...m.vertexCoverage),1);
    assert(m.vertexCoverage.some((v,i)=>v===1&&m.positions[i*2]===fromWorld));assert(m.vertexCoverage.every((v,i)=>m.positions[i*2]!==toWorld||v===0));
  }
});

test('CPU interpolation follows the linear endpoint law with native premultiplied alpha and no diagonal double draw',()=>{
  const width=16,height=4,pixels=Buffer.alloc(width*height*4,255),data={positions:[0,0,0,4,16,0,16,4],uvs:[0,0,0,1,1,0,1,1],indices:[0,1,2,2,1,3],
    vertexCoverage:[1,1,0,0],coverageInterpolation:'linear-vertex-coverage-v1'},rgba=Buffer.from([200,100,50,128]),original=Buffer.from(rgba);
  paintCoherentMesh(pixels,{width,height},data,{width:1,height:1,rgba},{cap:true,topLeftRule:true});
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<3;c++){
    const a=128/255*(1-(x+.5)/16),expected=Math.round(rgba[c]*a+255*(1-a));assert.equal(pixels[(y*width+x)*4+c],expected);
  }assert.deepEqual(rgba,original);
});

test('invalid optional coverage fields fail before painting; absent fields retain the old uniform-opacity path',()=>{
  const data={positions:[0,0,0,2,2,0,2,2],uvs:[0,0,0,1,1,0,1,1],indices:[0,1,2,2,1,3]};assert.equal(validateMeshCoverage(data),false);
  for(const vertexCoverage of [[1,0],[1,1,NaN,0],[1,1,-.1,0],[1,1,1.1,0],null]){
    const pixels=Buffer.alloc(16,255),before=Buffer.from(pixels);assert.throws(()=>paintCoherentMesh(pixels,{width:2,height:2},{...data,vertexCoverage,coverageInterpolation:'linear-vertex-coverage-v1'},
      {width:1,height:1,rgba:Buffer.from([20,30,40,255])}));assert.deepEqual(pixels,before);
  }assert.throws(()=>validateMeshCoverage({...data,vertexCoverage:[1,1,0,0],coverageInterpolation:'unknown'}));
});

test('v2 explicitly binds its renderer semantics and rejects resealed cross-version or fade claims',()=>{
  const f=linearFixture(),inputs={appearance:f.appearance,surfaceInterface:f.surfaceInterface,surfaceSpanEnvelope:f.surfaceSpanEnvelope,stepCorners:f.profile},r=f.surfaceBinding;
  assert.equal(r.format,'ai_scene_terrain_step_surface_v2');assert.equal(r.endFade.compiledFormat,'ai_scene_compiled_v8');assert.deepEqual(validateDocument(r.format,r),[]);
  assert.deepEqual(validateTerrainStepSurface(r,inputs),r);
  for(const edit of [v=>{v.format='ai_scene_terrain_step_surface_v1';},v=>{v.endFade.opacityAtEnd=1;},v=>{v.endFade.overlapWorld=16;},v=>{v.coveragePolicy='crop-within-legacy-opaque-cap-v1';}]){
    const value=structuredClone(unseal(r));edit(value);assert.throws(()=>validateTerrainStepSurface(seal(value),inputs));
  }
});
