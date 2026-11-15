import test from 'node:test';
import assert from 'node:assert/strict';
import {paintCoherentMesh} from '../src/coherent-mesh-render.mjs';
import {compileCurveGeometry} from '../src/curves.mjs';
import {renderCoherentFrame} from '../src/coherent-render.mjs';
import {encodeRgbaPng,inspectPng} from '../src/png.mjs';
import {hash} from '../src/generation/common.mjs';

test('joined edge crops its source UV at a shallow base instead of compressing the full transition',()=>{
  const geometry=compileCurveGeometry({curveId:'shallow',familyId:'rock',points:[{x:0,y:16,slope:0},{x:64,y:16,slope:0}],baseY:32},32);
  assert.equal(geometry.profile.capWidth,32);
  assert(geometry.samples.every(sample=>sample.inner.y===32&&sample.capFraction===.5));
  assert(geometry.cap.uvs.filter((_,index)=>index%4===3).every(v=>v===.5));
  assert(geometry.cap.positions.filter((_,index)=>index%2===1).every(y=>y>=16&&y<=32));
});

test('transparent mesh triangles composite once across a shared diagonal with premultiplied linear filtering',()=>{
  const pixels=Buffer.alloc(4*4*4);for(let p=0;p<pixels.length;p+=4)pixels.set([0,0,0,255],p);
  const quad={positions:[0,0,4,0,0,4,4,4],uvs:[0,0,1,0,0,1,1,1],indices:[0,1,2,2,1,3]};
  paintCoherentMesh(pixels,{width:4,height:4},quad,{width:1,height:1,rgba:Buffer.from([200,100,50,128])},{cap:true});
  for(let p=0;p<pixels.length;p+=4)assert.deepEqual([...pixels.subarray(p,p+4)],[100,50,25,255]);
});

test('deeper source transition does not introduce folds in previously valid slopes and hills',()=>{
  let compared=0;
  for(let y=32;y<=160;y+=16)for(const slope of [-1,-.5,0,.5,1]){
    const curve={curveId:'slope',familyId:'rock',baseY:256,points:[{x:0,y:96,slope:0},{x:64,y,slope},{x:128,y:96,slope:0}]};
    try{compileCurveGeometry(curve,8);}catch{continue;}
    const joined=compileCurveGeometry(curve,32);compared++;
    assert.equal(joined.profile.capDirection,'vertical-source-depth-v1');
    assert(joined.samples.every(sample=>sample.inner.x===sample.x&&sample.inner.y>sample.y));
  }assert(compared>=40);
});

test('measured surface depth is explicit and fractional without changing legacy edge widths',()=>{
  const curve={curveId:'measured',familyId:'rock',baseY:64,points:[{x:0,y:16,slope:0},{x:64,y:16,slope:0}]};
  const full=compileCurveGeometry(curve,37.25,{profile:'measured-source-depth-v1'});
  assert.equal(full.profile.capWidth,37.25);assert.equal(full.profile.surfaceProfile,'measured-source-depth-v1');
  assert(full.samples.every(sample=>sample.inner.y===53.25&&sample.capFraction===1));
  const shallow=compileCurveGeometry({...curve,baseY:32},37.25,{profile:'measured-source-depth-v1'});
  assert(shallow.samples.every(sample=>sample.inner.y===32&&Math.abs(sample.capFraction-16/37.25)<1e-6));
  assert.throws(()=>compileCurveGeometry(curve,37.25));
  assert.throws(()=>compileCurveGeometry(curve,37.25,{profile:'unversioned'}));
});

test('diagnostic render keeps terrain body and alpha edge in the same layer before later foreground sprites',()=>{
  const png=(color)=>encodeRgbaPng(1,1,Buffer.from(color));
  const files=new Map([['body.png',png([120,60,30,255])],['cap.png',png([40,140,20,128])],['front.png',png([10,20,30,255])]]);
  const source=path=>({path,sha256:hash(files.get(path))});
  const quad={positions:[0,0,4,0,0,4,4,4],uvs:[0,0,1,0,0,1,1,1],indices:[0,1,2,2,1,3]};
  const scene={defaultCamera:{center:{x:2,y:2},viewport:{width:4,height:4}},
    layers:[{layerId:'terrain',visible:true,nodes:[]},{layerId:'front',visible:true,nodes:[{kind:'sprite',position:{x:3,y:3},size:{width:1,height:1},source:source('front.png')}]}],
    curveTerrains:[{curveId:'test',layerId:'terrain',body:quad,cap:quad}],terrainMaterial:{body:{source:source('body.png')},cap:{source:source('cap.png')}}};
  const result=inspectPng(renderCoherentFrame(scene,path=>files.get(path)),{includePixels:true});
  assert.deepEqual([...result.rgba.subarray(0,4)],[80,100,25,255]);
  assert.deepEqual([...result.rgba.subarray(60,64)],[10,20,30,255]);
});
