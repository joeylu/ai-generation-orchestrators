import test from 'node:test';
import assert from 'node:assert/strict';
import {compileCurveGeometry} from '../src/curves.mjs';
import {createSharedTerrainFieldProfile,SHARED_TERRAIN_UNION_PROFILE} from '../src/shared-terrain-field.mjs';
import {compileSharedTerrainUnion} from '../src/shared-terrain-union.mjs';
import {validateDocument} from '../src/schema.mjs';
const source={path:'synthetic.png',sha256:'a'.repeat(64),byteLength:100};
const appearance={format:'ai_scene_continuous_terrain_appearance_v7',body:{source,pixelSize:{width:64,height:64}},cap:{source,pixelSize:{width:64,height:64}},
  surfaceOriginInBodyPixels:{numerator:0,denominator:1},bodyLoopSha256:'b'.repeat(64),capDepth:{numerator:32,denominator:1},capUvEnd:{numerator:1,denominator:1},bodyPeriod:{width:{numerator:128,denominator:1},height:{numerator:128,denominator:1}}};
const profile=createSharedTerrainFieldProfile(appearance,{geometryProfile:SHARED_TERRAIN_UNION_PROFILE,outline:{maximumInsetWorld:12,sampleStepWorld:8,wavelengthWorld:64,seed:731},surfaceInterface:{profile:'world-body-native-lip-v1',capSourceSha256:source.sha256,capEndRow:24,fadeRows:8},lighting:{bandWorld:6,fadeBands:4,leftShade:.95,rightShade:.72,bottomShade:.64}});
const cells=points=>new Map(points.map(([x,y])=>[`${x},${y}`,'terrain.primary']));
const curve=(x0,x1,y0,base)=>({...compileCurveGeometry({curveId:'curve.sample',familyId:'terrain.primary',points:[{x:x0,y:y0,slope:0},{x:x1,y:y0,slope:0}],baseY:base},16),layerId:'ground'});
const compile=(points,curves)=>compileSharedTerrainUnion(cells(points),{grid:{width:64,height:64},appearance,layerId:'ground',profile,curves});
function uvAt(mesh,x,y){for(let i=0;i<mesh.indices.length;i+=3){const ids=mesh.indices.slice(i,i+3),p=ids.map(n=>({x:mesh.positions[n*2],y:mesh.positions[n*2+1]})),[a,b,c]=p,d=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);if(Math.abs(d)<1e-9)continue;
  const u=((b.y-c.y)*(x-c.x)+(c.x-b.x)*(y-c.y))/d,v=((c.y-a.y)*(x-c.x)+(a.x-c.x)*(y-c.y))/d,w=[u,v,1-u-v];
  if(Math.min(...w)>=-1e-7)return [0,1].map(axis=>ids.reduce((n,id,j)=>n+mesh.uvs[id*2+axis]*w[j],0));}return null;}
test('v2 profile is schema-bound and side contacts have no relief gap or UV phase jump',()=>{
  assert.deepEqual(validateDocument(profile.format,profile),[]);const c=curve(128,256,64,192),copy=structuredClone(c),r=compile([[1,1],[1,2]],[c]);
  for(let y=65;y<190;y+=3.25){const a=uvAt(r.gridTerrains[0].body,128,y),b=uvAt(r.curveTerrains[0].body,128,y);assert(a&&b,`gap at ${y}`);for(let n=0;n<2;n++)assert(Math.abs(a[n]-b[n])<1e-6);}
  assert.deepEqual(r.curveTerrains[0].body.positions,c.body.positions);assert.deepEqual(r.curveTerrains[0].body.indices,c.body.indices);assert.deepEqual(c,copy);
});
test('stacked grid and curve remove buried caps while keeping the exposed ledge and true air',()=>{
  const r=compile([[0,1]],[curve(0,128,128,256)]),c=r.curveTerrains[0];
  assert(c.capBands.every(b=>!uvAt(b,32,129)));assert(c.capBands.some(b=>uvAt(b,96,129)));
  assert(uvAt(r.gridTerrains[0].body,32,128));assert(uvAt(c.body,32,128));assert(!uvAt(r.gridTerrains[0].body,96,90));
  const over=compile([[0,2]],[curve(0,64,64,128)]);assert(over.gridTerrains[0].capBands.every(b=>!uvAt(b,32,129)));
});
test('paint order is deterministic and a wide grid stays within the unchanged union work budget',()=>{
  const points=Array.from({length:84},(_,i)=>[i%12,Math.floor(i/12)+1]),a=compile(points,[]),b=compile([...points].reverse(),[]);
  assert.deepEqual(a,b);assert(a.gridTerrains[0].capBands.length>0);assert(a.report.generationCalls===0);
});
test('curve relief trims detached sides without clipping the walkable top, base, cap or painted contact',()=>{
  const relief=createSharedTerrainFieldProfile(appearance,{geometryProfile:SHARED_TERRAIN_UNION_PROFILE,outline:profile.outline,
    surfaceInterface:profile.surfaceInterface,curveSideRelief:'exposed-inset-v1'});
  assert.deepEqual(validateDocument(relief.format,relief),[]);
  const c=curve(128,256,64,192),before=structuredClone(c);
  const r=compileSharedTerrainUnion(cells([[1,1],[1,2]]),{grid:{width:64,height:64},appearance,layerId:'ground',profile:relief,curves:[c]});
  const [trimmed]=r.curveTerrains;
  assert.equal(r.report.curveSideRelief.exposedSides,1);
  assert.deepEqual(c,before);
  assert.deepEqual(trimmed.surface,c.surface);
  assert.deepEqual(trimmed.contour,c.contour);
  assert(uvAt(trimmed.body,255.99,64));
  assert(uvAt(trimmed.body,255.99,192));
  assert(uvAt(trimmed.body,245,120));
  assert(!uvAt(trimmed.body,255.99,120));
  assert(!trimmed.capBands.some(b=>uvAt(b,255.99,81)));
  for(let y=66;y<191;y+=3.25){
    const a=uvAt(r.gridTerrains[0].body,128,y),b=uvAt(trimmed.body,128,y);
    assert(a&&b,`gap at ${y}`);
    assert(Math.abs(a[0]-b[0])<1e-6&&Math.abs(a[1]-b[1])<1e-6);
  }
  const flush=compileSharedTerrainUnion(cells([]),{grid:{width:64,height:64},appearance,layerId:'ground',profile:relief,
    curves:[c],world:{x:0,y:0,width:256,height:256}});
  assert.equal(flush.report.curveSideRelief.exposedSides,1);
  assert(uvAt(flush.curveTerrains[0].body,255.99,120));
  assert(!uvAt(flush.curveTerrains[0].body,128.01,120));
});
