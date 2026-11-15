import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTerrainSurfaceSpanProfile,validateTerrainSurfaceSpanProfile,buildTerrainSurfaceSpanEnvelope,terrainSurfaceSpanRows} from '../src/terrain-surface-span-envelope.mjs';
import {compileTerrainUnionMaterial} from '../src/terrain-union-material.mjs';
import {compileGridTerrainFields} from '../src/grid-terrain.mjs';
import {compileCurveGeometry} from '../src/curves.mjs';
import {renderCoherentFrame} from '../src/coherent-render.mjs';
import {encodeRgbaPng,inspectPng} from '../src/png.mjs';
import {hash,seal,unseal} from '../src/generation/common.mjs';
const grid={width:64,height:64},options={shortWidthWorld:64,fullWidthWorld:128,capEndRow:32,fadeRows:16},
 surfaceInterface={profile:'world-body-native-lip-v1',capSourceSha256:'a'.repeat(64),capEndRow:56,fadeRows:12},
 appearance={format:'ai_scene_continuous_terrain_appearance_v6',surfaceOriginInBodyPixels:{numerator:-40,denominator:1},
  capDepth:{numerator:32,denominator:1},capUvEnd:{numerator:1,denominator:1},surfaceMappingSha256:'b'.repeat(64),
  cap:{source:{path:'cap.png',sha256:'a'.repeat(64),byteLength:1},pixelSize:{width:128,height:64}}},
 segment=(x1,x2,y1=0,y2=y1)=>({a:{x:x1,y:y1},b:{x:x2,y:y2}}),
 envelope=s=>buildTerrainSurfaceSpanEnvelope(s,{envelope:options,capEndRow:56,fadeRows:12});

test('span companion binds the exact effective cap and interface, and permits reduction only',()=>{
 const record=buildTerrainSurfaceSpanProfile(options,{appearance,surfaceInterface});assert.equal(validateTerrainSurfaceSpanProfile(record,{appearance,surfaceInterface}),record);
 assert.equal(record.generationCalls,0);assert.equal(record.visualAcceptance,'not-assessed');assert.equal(record.sourceCoordinatesWarped,false);
 for(const change of [{capEndRow:57},{capEndRow:55,fadeRows:0},{fullWidthWorld:64},{shortWidthWorld:0},{fadeRows:33},{extra:true}])
  assert.throws(()=>buildTerrainSurfaceSpanProfile({...options,...change},{appearance,surfaceInterface}));
 assert.throws(()=>validateTerrainSurfaceSpanProfile(seal({...unseal(record),capMappingSha256:'c'.repeat(64)}),{appearance,surfaceInterface}));
 assert.throws(()=>validateTerrainSurfaceSpanProfile(record,{appearance,surfaceInterface:{...surfaceInterface,capEndRow:55}}));
});

test('continuous exposed top is measured across segment and owner boundaries, while steps stay separate',()=>{
 const input=Array.from({length:8},(_,i)=>({...segment(i*64,(i+1)*64),owner:i})),before=structuredClone(input),r=envelope(input);
 assert.equal(r.spans.length,1);assert.equal(r.spans[0].widthWorld,512);assert.equal(r.spans[0].capEndRow,56);assert.equal(r.spans[0].segmentCount,8);
 assert(r.selection.every(x=>x===r.spans[0]));assert.deepEqual(input,before);
 const slope=envelope([segment(0,32,0,16),segment(32,96,16,32)]);assert.equal(slope.spans[0].widthWorld,96);assert.equal(slope.spans[0].capEndRow,44);
 const steps=envelope([segment(0,64,0),segment(64,128,32)]);assert.equal(steps.spans.length,2);assert(steps.spans.every(s=>s.capEndRow===32));
 const tolerance=envelope([segment(0,64),segment(64+1e-9,128)]);assert.equal(tolerance.spans.length,1);
});

test('interpolation is continuous and ambiguous topology, zero spans and excessive work inputs are rejected',()=>{
 const a=terrainSurfaceSpanRows(96,options,56,12),b=terrainSurfaceSpanRows(96.0001,options,56,12);
 assert.equal(a.capEndRow,44);assert.equal(a.fadeRows,14);assert(b.capEndRow>a.capEndRow&&b.capEndRow-a.capEndRow<.001);
 assert.throws(()=>envelope([segment(0,64),segment(0,96)]),e=>e.errors?.some(i=>i.code==='TERRAIN_SURFACE_SPAN_TOPOLOGY'));
 assert.throws(()=>envelope([segment(0,0)]));assert.throws(()=>envelope(Array.from({length:16385},(_,i)=>segment(i,i+1))));
});

function setup(){
 const files=new Map(),image=(path,w,h,color)=>{const rgba=Buffer.alloc(w*h*4);for(let i=0;i<rgba.length;i+=4)rgba.set(color,i);const bytes=encodeRgbaPng(w,h,rgba);files.set(path,bytes);return {source:{path,sha256:hash(bytes),byteLength:bytes.length},pixelSize:{width:w,height:h}};},
  app={...structuredClone(appearance),body:image('body.png',128,128,[90,60,40,255]),cap:image('cap.png',128,64,[230,240,250,255])},
  intf={...surfaceInterface,capSourceSha256:app.cap.source.sha256},profile=buildTerrainSurfaceSpanProfile(options,{appearance:app,surfaceInterface:intf}),
  fields=points=>compileGridTerrainFields(new Map(points.map(([x,y])=>[x+','+y,'terrain.primary'])),{grid,appearance:app,layerId:'ground'}),
  curve=(id,a,b,top=64)=>({...compileCurveGeometry({curveId:id,familyId:'terrain.primary',points:[{x:a,y:top,slope:0},{x:b,y:top,slope:0}],baseY:128},16),layerId:'ground'}),
  compile=(points,curves=[],adaptive=true)=>compileTerrainUnionMaterial({gridTerrains:fields(points),curveTerrains:curves,appearance:app,grid,surfaceInterface:intf,...(adaptive?{surfaceSpanEnvelope:profile}:{})}),
  render=result=>renderCoherentFrame({defaultCamera:{center:{x:160,y:96},viewport:{width:320,height:128}},layers:[{layerId:'ground',visible:true,nodes:[]}],terrainMaterial:app,gridTerrains:result.gridTerrains,curveTerrains:result.curveTerrains},p=>files.get(p));
 return {files,app,intf,profile,fields,curve,compile,render};
}

test('short coverage clips native depth without compressing UVs or adding paint; full spans retain the old pixels',()=>{
 const f=setup(),sourceHashes=[...f.files].map(([p,b])=>[p,hash(b)]),short=f.compile([[1,1]]),old=f.compile([[1,1]],[],false),
  p=short.gridTerrains[0],before=old.gridTerrains[0];assert.deepEqual(p.body,before.body);
 assert.equal(Math.max(...p.capBands.map(b=>b.localDepth.toWorld)),16);assert.equal(Math.max(...before.capBands.map(b=>b.localDepth.toWorld)),28);
 for(const band of p.capBands)for(let i=0;i<band.positions.length;i+=2){assert(Math.abs(band.uvs[i]-band.positions[i]/512)<1e-10);assert(Math.abs(band.uvs[i+1]-(band.positions[i+1]-64)/32)<1e-10);}
 const a=inspectPng(f.render(short),{includePixels:true}),b=inspectPng(f.render(old),{includePixels:true});
 for(let i=0;i<a.rgba.length;i+=4)for(let c=0;c<3;c++)assert(a.rgba[i+c]<=b.rgba[i+c],'synthetic bright cover cannot increase anywhere');
 const longPoints=Array.from({length:8},(_,i)=>[i+1,1]);assert.deepEqual(f.render(f.compile(longPoints)),f.render(f.compile(longPoints,[],false)));
 assert.deepEqual([...f.files].map(([p,b])=>[p,hash(b)]),sourceHashes);
});

test('touching grid and curve share one span instead of restarting short coverage per author owner',()=>{
 const f=setup(),c=f.curve('touching',128,192),input=structuredClone(c),result=f.compile([[1,1]],[c]);
 assert.deepEqual(c,input);assert.equal(result.report.groups.length,1);
 const spans=result.report.groups[0].surfaceSpanEnvelope.spans;assert.equal(spans.length,1);assert.equal(spans[0].widthWorld,128);assert.equal(spans[0].capEndRow,56);
 assert.deepEqual(f.render(result),f.render(f.compile([[1,1]],[c],false)));
 const gap=f.compile([[1,1]],[f.curve('separate',144,208)]);assert.equal(gap.report.groups.length,2);assert(gap.report.groups.every(g=>g.surfaceSpanEnvelope.spans.every(s=>s.capEndRow===32)));
});
