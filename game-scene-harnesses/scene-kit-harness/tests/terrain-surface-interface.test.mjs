import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {compileCurveGeometry} from '../src/curves.mjs';
import {compileGridTerrainFields} from '../src/grid-terrain.mjs';
import {compileTerrainUnionMaterial,validateTerrainSurfaceInterface,TERRAIN_SURFACE_INTERFACE_PROFILE,TERRAIN_UNION_MATERIAL_PROFILE} from '../src/terrain-union-material.mjs';
import {paintCoherentMesh} from '../src/coherent-mesh-render.mjs';
import {encodeRgbaPng} from '../src/png.mjs';
import {hash} from '../src/generation/common.mjs';
import {validateTerrainEdges,GRID_TERRAIN_EDGE_PROFILE,NEAR_OPAQUE_JOIN_PROFILE} from '../src/terrain-edges.mjs';
import {terrainEdgesFixture} from './helpers/terrain-edges.mjs';
import {setupTerrainEdgeDelivery} from './helpers/terrain-edge-delivery.mjs';
import {buildTerrainEdgeDelivery,verifyTerrainEdgeDelivery} from '../src/terrain-edge-pipeline.mjs';
import {loadSceneKit,contextFor,readMap} from '../src/kit.mjs';
import {compileMap} from '../src/compile.mjs';

const grid={width:64,height:64},near=(a,b)=>assert(Math.abs(a-b)<1e-9),rejects=(action,code)=>assert.throws(action,e=>e.errors?.some(i=>i.code===code));
function fixture(){
  const raster=kind=>{const width=32,height=128,rgba=Buffer.alloc(width*height*4);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)rgba.set(kind==='cap'?(y<16?[15,210,225,255]:[175,100+y%50,75,255]):[35+y,55+y,75+y,255],(y*width+x)*4);
    return {width,height,rgba};};
  const body=raster('body'),cap=raster('cap'),bytes=encodeRgbaPng(cap.width,cap.height,cap.rgba),appearance={format:'ai_scene_continuous_terrain_appearance_v6',
    surfaceOriginInBodyPixels:{numerator:-40,denominator:1},capDepth:{numerator:64,denominator:1},capUvEnd:{numerator:1,denominator:1},surfaceMappingSha256:'a'.repeat(64),
    cap:{pixelSize:{width:cap.width,height:cap.height},source:{path:'cap.png',sha256:hash(bytes),byteLength:bytes.length}}},
    surfaceInterface={profile:TERRAIN_SURFACE_INTERFACE_PROFILE,capSourceSha256:hash(bytes),capEndRow:20,fadeRows:4};
  return {body,cap,bytes,appearance,surfaceInterface};
}
function curve(id='lower',left=0,right=336,top=256,bottom=576){return {...compileCurveGeometry({curveId:id,familyId:'terrain.primary',
  points:[{x:left,y:top,slope:0},{x:right,y:top,slope:0}],baseY:bottom},16),layerId:'ground'};}
function compile(f,points,curves=[curve()],selected=true){
  const cells=new Map(points.map(([x,y])=>[`${x},${y}`,'terrain.primary'])),gridTerrains=compileGridTerrainFields(cells,{grid,appearance:f.appearance,layerId:'ground'});
  return compileTerrainUnionMaterial({gridTerrains,curveTerrains:curves,appearance:f.appearance,grid,...(selected?{surfaceInterface:f.surfaceInterface}:{})});
}
function render(f,result){const width=384,height=384,pixels=Buffer.alloc(width*height*4);for(let p=0;p<pixels.length;p+=4)pixels.set([0,0,0,255],p);
  for(const owner of [...result.gridTerrains,...result.curveTerrains]){
    paintCoherentMesh(pixels,{width,height},owner.body,f.body,{topLeftRule:true});
    for(const band of owner.capBands??[owner.cap])paintCoherentMesh(pixels,{width,height},band,f.cap,{cap:true,opacity:band.coverageOpacity??1,topLeftRule:true});
  }return {width,height,pixels};}
const rgb=(image,x,y)=>[...image.pixels.subarray((y*image.width+x)*4,(y*image.width+x)*4+3)];
function uvAt(mesh,x,y){for(let i=0;i<mesh.indices.length;i+=3){const ids=mesh.indices.slice(i,i+3),[a,b,c]=ids.map(n=>({x:mesh.positions[n*2],y:mesh.positions[n*2+1]})),
  den=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);if(Math.abs(den)<1e-10)continue;
  const u=((b.y-c.y)*(x-c.x)+(c.x-b.x)*(y-c.y))/den,v=((c.y-a.y)*(x-c.x)+(a.x-c.x)*(y-c.y))/den,w=[u,v,1-u-v];
  if(Math.min(...w)>=-1e-8)return [0,1].map(axis=>ids.reduce((s,n,j)=>s+mesh.uvs[n*2+axis]*w[j],0));}return null;}

test('native lip removes the full fascia rectangle at a high grid to low curve contact in final source-over pixels',()=>{
  const f=fixture(),points=[[1,3],[2,3],[3,3]],legacy=compile(f,points,undefined,false),fixed=compile(f,points),oldPixels=render(f,legacy),pixels=render(f,fixed);
  assert.notDeepEqual(rgb(oldPixels,48,280),rgb(oldPixels,112,280),'legacy broad local cap must reproduce the abrupt rectangular face color');
  for(const y of [270,280,296,310])assert.deepEqual(rgb(pixels,48,y),rgb(pixels,112,y),'below the thin lip one world body owns both sides of the buried cap edge');
  assert.deepEqual(rgb(pixels,48,257),[15,210,225],'the exposed native cyan lip stays present');
  const row=fixed.curveTerrains[0];assert.equal(row.capBands.flatMap(b=>uvAt(b,112,257)?[1]:[]).length,0,'the covered lower lip remains buried');
  near(fixed.report.surfaceOverlayDepthWorld,10);near(fixed.report.capFadeWorld,2);
  for(const band of row.capBands)for(let i=0;i<band.positions.length;i+=2){
    const x=band.positions[i],y=band.positions[i+1];assert(y<=266+1e-9);near(band.uvs[i],x/512);near(band.uvs[i+1],(y-256)/64);
  }
  assert.deepEqual(row.materialMapping.capDepth,f.appearance.capDepth,'full measured UV depth is not stretched to the new overlay depth');
  assert.deepEqual(row.materialMapping.surfaceInterface,f.surfaceInterface);assert.equal(hash(f.bytes),f.surfaceInterface.capSourceSha256);
});

test('an explicit native interface gives standalone curves the same body phase before and after painting grid above them',()=>{
  const f=fixture(),input=curve(),before=structuredClone(input),standalone=compile(f,[],[input]),joined=compile(f,[[1,3],[2,3],[3,3]],[input]);
  for(const p of [[40,280],[112,300],[200,340]])assert.deepEqual(uvAt(standalone.curveTerrains[0].body,...p),uvAt(joined.curveTerrains[0].body,...p));
  assert.equal(standalone.report.standaloneWorldBody,true);assert.deepEqual(input,before);
  for(const owner of [standalone.curveTerrains[0],joined.curveTerrains[0]]){
    assert.deepEqual(owner.contour,input.contour);assert.deepEqual(owner.surface,input.surface);assert.deepEqual(owner.bounds,input.bounds);
    assert.deepEqual(owner.materialMapping.bodyJacobian,{dUdX:1/512,dUdY:0,dVdX:0,dVdY:1/256});
  }
  const legacy=compile(f,[],[input],false);assert.deepEqual(legacy.curveTerrains,[input]);assert.equal(Object.hasOwn(legacy.report,'surfaceInterface'),false);
  const noFade=compile({...f,surfaceInterface:{...f.surfaceInterface,fadeRows:0}},[[1,3]]);assert(noFade.gridTerrains[0].capBands.every(b=>b.coverageOpacity===1));
});

test('native interface rejects unknown profiles, stale cap identity, out-of-range rows and non-v6 edges',()=>{
  const f=fixture();
  for(const value of [{...f.surfaceInterface,profile:'arbitrary-paint'},null,{...f.surfaceInterface,extra:1}])rejects(()=>validateTerrainSurfaceInterface(value,f.appearance),'TERRAIN_SURFACE_INTERFACE_PROFILE');
  rejects(()=>validateTerrainSurfaceInterface({...f.surfaceInterface,capSourceSha256:'f'.repeat(64)},f.appearance),'TERRAIN_SURFACE_INTERFACE_BINDING');
  for(const value of [{capEndRow:0},{capEndRow:129},{capEndRow:1.5},{fadeRows:-1},{fadeRows:21}])rejects(()=>validateTerrainSurfaceInterface({...f.surfaceInterface,...value},f.appearance),'TERRAIN_SURFACE_INTERFACE_ROWS');
  const e=terrainEdgesFixture();rejects(()=>validateTerrainEdges({...e.edges,surfaceInterface:f.surfaceInterface},f.appearance),'TERRAIN_SURFACE_INTERFACE_PROFILE');
  rejects(()=>compileTerrainUnionMaterial({gridTerrains:[],curveTerrains:[],appearance:f.appearance,surfaceInterface:{...f.surfaceInterface,fadeRows:100}}),'TERRAIN_SURFACE_INTERFACE_ROWS');
  rejects(()=>validateTerrainSurfaceInterface(f.surfaceInterface,{...f.appearance,capUvEnd:{numerator:1,denominator:1000}}),'TERRAIN_SURFACE_INTERFACE_ROWS');
});

test('new native-lip delivery binds the checked cap, replays independently and preserves original artwork, geometry and collisions',{timeout:360000},t=>{
  const f=setupTerrainEdgeDelivery(t),controls={...structuredClone(f.controls),joinProfile:NEAR_OPAQUE_JOIN_PROFILE,gridProfile:GRID_TERRAIN_EDGE_PROFILE,junctions:{},materialProfile:TERRAIN_UNION_MATERIAL_PROFILE};
  for(const side of ['left','right'])for(const part of ['wall','corner'])controls[side][part].inboardBlend={fromX:controls[side][part].innerX,toX:side==='left'?264:24};
  const oldOptions={...f.deliveryOptions,controls,output:join(f.parent,'old-interface')},oldReport=buildTerrainEdgeDelivery(oldOptions),oldHandle=loadSceneKit(join(oldOptions.output,'candidate/kit')),
    oldContext=contextFor(oldHandle),oldMap=readMap(oldHandle),oldScene=compileMap(oldHandle,oldMap),appearance=oldContext.kit.terrainAppearance,
    surfaceInterface={profile:TERRAIN_SURFACE_INTERFACE_PROFILE,capSourceSha256:appearance.cap.source.sha256,capEndRow:Math.min(20,appearance.cap.pixelSize.height),fadeRows:4},
    options={...f.deliveryOptions,controls:{...controls,surfaceInterface},output:join(f.parent,'native-lip-interface')},report=buildTerrainEdgeDelivery(options),
    handle=loadSceneKit(join(options.output,'candidate/kit')),context=contextFor(handle),map=readMap(handle),scene=compileMap(handle,map),readiness=JSON.parse(readFileSync(join(options.output,'candidate/readiness.json')));
  assert.deepEqual(context.kit.terrainEdges.surfaceInterface,surfaceInterface);assert.deepEqual(scene.terrainUnionMaterial.surfaceInterface,surfaceInterface);
  assert.deepEqual(readiness.unionMaterial.surfaceInterface,surfaceInterface);assert.notEqual(report.kitSha256,oldReport.kitSha256);
  assert.deepEqual(scene.collisionSuggestions,oldScene.collisionSuggestions);const plain=({kitRef,...author})=>author;assert.deepEqual(plain(map),plain(oldMap));
  for(const [path,bytes]of oldContext.files)if(path.endsWith('.png'))assert.deepEqual(context.files.get(path),bytes,path);
  assert.equal(verifyTerrainEdgeDelivery(options).reportSha256,report.sha256);assert.equal(verifyTerrainEdgeDelivery(oldOptions).reportSha256,oldReport.sha256);
  const bad={...options,output:join(f.parent,'bad-interface'),controls:{...controls,surfaceInterface:{...surfaceInterface,capSourceSha256:'e'.repeat(64)}}};
  rejects(()=>buildTerrainEdgeDelivery(bad),'TERRAIN_SURFACE_INTERFACE_BINDING');assert.equal(report.generationCalls,0);
});
