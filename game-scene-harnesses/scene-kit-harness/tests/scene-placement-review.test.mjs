import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeRgbaPng } from '../src/png.mjs';
import { hash } from '../src/generation/common.mjs';
import { reviewScenePlacement } from '../src/scene-placement-review.mjs';

function fixture() {
  const images = new Map();
  function image(path, alpha) {
    const rgba = Buffer.alloc(16*16*4);
    for (let y=0;y<16;y++) for (let x=0;x<16;x++) rgba[(y*16+x)*4+3] = alpha(x,y);
    const bytes = encodeRgbaPng(16,16,rgba);
    images.set(path,bytes);
    return {path,sha256:hash(bytes)};
  }
  const subject = image('tower.png',() => 255);
  const opaque = image('wall.png',() => 255);
  const opening = image('opening.png',x => x<8?255:0);
  const makeNode = (nodeId,source) => ({kind:'sprite',nodeId,source,position:{x:16,y:16},size:{width:32,height:32}});
  const target = makeNode('visual/tower',subject);
  const wall = makeNode('visual/wall',opaque);
  const scene = { source:{kitSha256:'a'.repeat(64),authorSha256:'b'.repeat(64)},contentSha256:'c'.repeat(64),
    defaultCamera:{center:{x:32,y:32},viewport:{width:64,height:64},scale:1},layers:[
      {layerId:'distant',visible:true,nodes:[target]}, {layerId:'middle',visible:true,nodes:[wall]}, {layerId:'ground',visible:true,nodes:[]}]};
  const observations = [{observationId:'tower-silhouette',instanceId:'tower',sourceSha256:subject.sha256,
    sourceRegion:[0,0,16,16],frameRegion:[.2,.2,.6,.6],minimumVisibleFraction:.45}];
  return {scene,wall,target,opening,observations,run:() => reviewScenePlacement(scene,observations,path=>images.get(path))};
}

test('a correctly framed landmark can be blocked by an opaque layer and recovered through a true opening',()=>{
  const f=fixture(), first=f.run();
  assert.equal(first.status,'blocked');
  assert.equal(first.results[0].framedFraction,1);
  assert.deepEqual(first.results[0].blockedBy,[{layerId:'middle',fraction:1}]);
  f.wall.source=f.opening;
  const second=f.run();
  assert.equal(second.status,'pass');
  assert.equal(second.results[0].visibleFraction,.5);
  assert.notEqual(first.sha256,second.sha256);
  f.scene.layers[0].visible=false;
  assert.equal(f.run().results[0].framedFraction,1);
  assert.equal(f.run().results[0].visibleFraction,0);
});

test('moving or enlarging the same source can fail the intended frame even when all pixels are unoccluded',()=>{
  const f=fixture();
  f.scene.layers[1].visible=false;
  assert.equal(f.run().status,'pass');
  f.target.position.x=39;
  f.target.size.width=64;
  const {results,status}=f.run();
  assert.equal(status,'blocked');
  assert(results[0].framedFraction<.25);
  assert.deepEqual(results[0].blockedBy,[]);
});

test('report-only framing allows crops and reframing while still blocking in-view occlusion',()=>{
  const f=fixture();
  f.observations[0].framingPolicy='report-only';
  f.observations[0].frameRegion=[0,0,.1,.1];
  f.target.position.x=48;
  f.wall.position.x=48;
  const blocked=f.run().results[0];
  assert.equal(blocked.framedFraction,0);
  assert.equal(blocked.inFrameFraction,.5);
  assert.equal(blocked.inFrameVisibleFraction,0);
  assert.equal(blocked.status,'blocked');
  f.scene.layers[1].visible=false;
  const cropped=f.run().results[0];
  assert.equal(cropped.status,'pass');
  assert.equal(cropped.inFrameVisibleFraction,1);
  f.target.position.x=64;
  const outside=f.run();
  assert.equal(outside.status,'pass');
  assert.equal(outside.results[0].status,'outside-frame');
  assert.equal(outside.results[0].inFrameVisibleFraction,null);
});

test('the painted body blocks a landmark but its true air and degenerate triangles leave the landmark visible',()=>{
  const f=fixture();
  f.scene.layers[1].visible=false;
  f.scene.terrainSharedField={};
  f.scene.curveTerrains=[{layerId:'ground',body:{positions:[16,16,32,16,16,48,32,48,46,46],indices:[0,1,2,1,3,2,4,4,4]}}];
  const {results}=f.run();
  assert.equal(results[0].visibleFraction,.5);
  assert.deepEqual(results[0].blockedBy,[{layerId:'ground',fraction:.5}]);
  f.observations[0].sourceSha256='f'.repeat(64);
  assert.throws(f.run,error=>error.errors.some(item=>item.code==='PLACEMENT_TARGET_SOURCE'));
});
