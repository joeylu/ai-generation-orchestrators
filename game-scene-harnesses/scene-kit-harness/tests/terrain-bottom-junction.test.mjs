import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {compileGridTerrainFields} from '../src/grid-terrain.mjs';
import {compileTerrainUnionMaterial,TERRAIN_UNION_MATERIAL_PROFILE} from '../src/terrain-union-material.mjs';
import {compileTerrainUnionEdges,validateTerrainEdges,buildTerrainEdgeJunctions,GRID_TERRAIN_EDGE_PROFILE,NEAR_OPAQUE_JOIN_PROFILE} from '../src/terrain-edges.mjs';
import {compileTerrainBottomEdges,validateTerrainBottomEdges,TERRAIN_BOTTOM_EDGE_PROFILE_V2,TERRAIN_BOTTOM_NATIVE_SIZE_PROFILE,TERRAIN_BOTTOM_RENDER_ENVELOPE_PROFILE} from '../src/terrain-bottom-edges.mjs';
import {paintCoherentMesh} from '../src/coherent-mesh-render.mjs';
import {inspectPng,encodeRgbaPng} from '../src/png.mjs';
import {canonicalJson} from '../src/document.mjs';

const grid={width:64,height:64},world={x:0,y:0,width:512,height:512},profile='native-bottom-endpoint-underlap-v1',
  background=[12,14,16],bodyColor=[210,30,40],sideColors={left:[2,3,4],right:[7,8,9]},hash=b=>createHash('sha256').update(b).digest('hex');
function fixture(enabled=true){
 const files=new Map(),appearance={format:'ai_scene_continuous_terrain_appearance_v6',sourceSha256:'a'.repeat(64),surfaceMappingSha256:'b'.repeat(64),
  surfaceOriginInBodyPixels:{numerator:-40,denominator:1},capDepth:{numerator:8,denominator:1},capUvEnd:{numerator:1,denominator:1}},
  asset=(path,width,height,color)=>{const rgba=Buffer.alloc(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++)rgba.set(color(x,y),4*(y*width+x));
   const bytes=encodeRgbaPng(width,height,rgba);files.set(path,bytes);return {source:{path,sha256:hash(bytes),byteLength:bytes.length},pixelSize:{width,height}};},
  edges={format:'ai_scene_terrain_edges_v5',profile:'curve-vertical-exposed-native-v1',gridProfile:GRID_TERRAIN_EDGE_PROFILE,joinProfile:NEAR_OPAQUE_JOIN_PROFILE,
   sourceBinding:{materialSourceSha256:appearance.sourceSha256,surfaceMappingSha256:appearance.surfaceMappingSha256}},
  bottom={format:'ai_scene_terrain_bottom_edges_v2',profile:TERRAIN_BOTTOM_EDGE_PROFILE_V2,nativeSizeProfile:TERRAIN_BOTTOM_NATIVE_SIZE_PROFILE,
   renderEnvelopeProfile:TERRAIN_BOTTOM_RENDER_ENVELOPE_PROFILE,...(enabled?{junctionProfile:profile}:{}),sourceBinding:{...edges.sourceBinding}};
 for(const side of ['left','right']){
  edges[side]={};for(const part of ['wall','corner']){
   edges[side][part]={...asset(`junction/${side}-${part}.png`,64,128,(x,y)=>x>=(side==='left'?12:24)&&x<(side==='left'?40:52)&&y>=2&&y<126
     ?[...sideColors[side].map((v,i)=>v+(part==='corner'&&i===2?1:0)),255]:[0,0,0,0]),
    scale:{numerator:1,denominator:2},boundaryX:side==='left'?16:48,innerX:32,
    inboardBlend:{fromX:32,toX:side==='left'?40:24},...(part==='wall'?{repeatY:{from:32,to:112}}:{surfaceY:16,wallStartY:80})};
  }
 }
 edges.junctions=buildTerrainEdgeJunctions(edges,{readAsset:p=>files.get(p)});edges.format='ai_scene_terrain_edges_v6';edges.materialProfile=TERRAIN_UNION_MATERIAL_PROFILE;
 bottom.edge={...asset('junction/bottom-edge.png',80,80,(x,y)=>x>=2&&x<78&&y>=2&&y<76?[40,120,180,255]:[0,0,0,0]),
  scale:{numerator:1,denominator:2},boundaryY:64,innerY:48,repeatX:{from:16,to:64},inboardBlend:{fromY:48,toY:42}};
 for(const [i,key]of ['leftCorner','rightCorner'].entries())bottom[key]={...asset(`junction/${key}.png`,80,80,(x,y)=>{
  const inwardBoundary=20+Math.max(0,y-30)*.65,inside=key==='leftCorner'?x>=inwardBoundary&&x<76:x<80-inwardBoundary&&x>=4;
  return inside&&y>=2&&y<76?[110+i*30,170+i*10,55,255]:[0,0,0,0];}),scale:{numerator:1,denominator:2},
  boundaryY:64,innerY:48,inboardBlend:{fromY:48,toY:42},boundaryX:i?56:24,innerX:40,stripStartX:i?32:48,wallStartY:28};
 validateTerrainEdges(edges,appearance,{readAsset:p=>files.get(p)});return {files,appearance,edges,bottom};
}
function compile(f,points){
 const cells=new Map(points.map(([x,y])=>[`${x},${y}`,'terrain.primary'])),material=compileTerrainUnionMaterial({
  gridTerrains:compileGridTerrainFields(cells,{grid,appearance:f.appearance,layerId:'ground'}),curveTerrains:[],appearance:f.appearance,grid}),
  sides=compileTerrainUnionEdges(material.gridTerrains,material.curveTerrains,f.edges,{world,grid,cells}),
  result=compileTerrainBottomEdges({gridTerrains:sides.gridTerrains,curveTerrains:sides.curves,bottomEdges:f.bottom,terrainEdges:f.edges,world,grid,cells});
 return {sides,result};
}
const owners=r=>[...r.gridTerrains,...r.curveTerrains];
function render(f,r){
 const {width,height}=world,pixels=Buffer.alloc(width*height*4);for(let i=0;i<pixels.length;i+=4)pixels.set([...background,255],i);
 const body={width:2,height:2,rgba:Buffer.from(Array.from({length:4},()=>[...bodyColor,255]).flat())};
 for(const o of owners(r)){
  paintCoherentMesh(pixels,{width,height},o.body,body,{topLeftRule:true});
  for(const b of o.capBands??[])paintCoherentMesh(pixels,{width,height},b,body,{topLeftRule:true,opacity:b.coverageOpacity??1});
  for(const m of o.edgeMeshes??[])paintCoherentMesh(pixels,{width,height},m,inspectPng(f.files.get(m.source.path),{includePixels:true}),
   {topLeftRule:true,clampU:true,clampV:true,opacity:m.coverageOpacity??1});
 }
 return (x,y)=>[...pixels.subarray((y*width+x)*4,(y*width+x)*4+3)];
}
const bridge=()=>[...[2,3,4,5].map(x=>[x,2]),...[3,4,5].flatMap(y=>[[2,y],[5,y]])];
const rejects=(fn,code)=>assert.throws(fn,e=>e.errors?.some(v=>v.code===code));

test('an explicit endpoint handoff removes the old side trace behind the native lower shoulder',()=>{
 const old=fixture(false),f=fixture(),a=compile(old,[[2,2]]).result,b=compile(f,[[2,2]]).result,oldRgb=render(old,a),rgb=render(f,b);
 assert.notDeepEqual(oldRgb(127,190),background,'legacy side paint reproduces the thin trace beside the diagonal native shoulder');
 assert.deepEqual(rgb(127,190),background,'the native lower corner must own its transparent exterior shoulder');
 assert.deepEqual(rgb(192,190),background,'the right lower corner owns the opposite shoulder as well');
 assert.notDeepEqual(rgb(139,190),background,'native diagonal paint stays present');
 assert.equal(b.report.junctionProfile,profile);assert.equal(b.report.endpointHandoffs.length,2);
 for(const p of b.report.endpointHandoffs)assert.equal(p.handoffWorldY,176);
});

test('a concave underside extends the same native wall phase only through real supported solid',()=>{
 const old=fixture(false),f=fixture(),before=compile(old,bridge()),after=compile(f,bridge()),oldRgb=render(old,before.result),rgb=render(f,after.result);
 assert.deepEqual(oldRgb(191,190),bodyColor,'legacy concave endpoint exposes the body between the two native edge responsibilities');
 assert.deepEqual(rgb(191,190),sideColors.right,'the existing right wall must continue upward to meet the underside');
 assert.deepEqual(rgb(191,185),oldRgb(191,185),'the retained body above the cutback band cannot receive a new flat-ended native side stub');
 assert.deepEqual(rgb(256,224),background,'the hole interior must remain empty');
 const native=owners(after.result).flatMap(o=>o.edgeMeshes??[]).filter(m=>m.bottomJunction?.kind==='concave-side-underlap');assert(native.length>0);
 for(const m of native){
  assert.equal(m.nativeOriginWorld,176,'the first native source origin remains bottom minus the existing repeat offset');
  assert.equal(m.bottomJunction.fromY,186);assert.equal(m.bottomJunction.renderRegion,'bottom-cutback-band-only');
  for(let i=1;i<m.positions.length;i+=2){assert(m.positions[i]<=192+1e-8&&m.positions[i]>=186-1e-8);
   assert(Math.abs(m.uvs[i]-(m.positions[i]-m.nativeOriginWorld)/64)<1e-9,'extension source rows retain original native phase');}
 }
 assert(after.result.report.nativeSideExtensions.some(p=>p.side==='right'&&p.x===192&&p.phaseReset===false));
 for(const o of owners(after.result))for(let i=0;i<o.body.positions.length;i++)assert.equal(o.body.uvs[i],o.body.positions[i]/(i%2?256:512));
});

test('new endpoint joins require native upstream collar coverage and reject unknown or non-v2 profiles',()=>{
 const f=fixture();validateTerrainBottomEdges(f.bottom,f.appearance,{terrainEdges:f.edges,readAsset:p=>f.files.get(p)});
 rejects(()=>validateTerrainBottomEdges({...f.bottom,junctionProfile:'arbitrary-cap-repair'},f.appearance,{terrainEdges:f.edges}),'TERRAIN_BOTTOM_JUNCTION_PROFILE');
 rejects(()=>validateTerrainBottomEdges({...f.bottom,format:'ai_scene_terrain_bottom_edges_v1'},f.appearance,{terrainEdges:f.edges}),'TERRAIN_BOTTOM_JUNCTION_PROFILE');
 const item=f.edges.right.wall,png=inspectPng(f.files.get(item.source.path),{includePixels:true}),rgba=Buffer.from(png.rgba);rgba.fill(0,(18*png.width+32)*4,(18*png.width+32)*4+4);
 const bytes=encodeRgbaPng(png.width,png.height,rgba);f.files.set(item.source.path,bytes);item.source={...item.source,sha256:hash(bytes),byteLength:bytes.length};
 rejects(()=>validateTerrainBottomEdges(f.bottom,f.appearance,{terrainEdges:f.edges,readAsset:p=>f.files.get(p)}),'TERRAIN_BOTTOM_JUNCTION_COLLAR');
});

test('a v2 kit without the explicit endpoint profile retains its exact previous compiled identity',()=>{
 const f=fixture(false),result=compile(f,bridge()).result;assert.equal(hash(canonicalJson(result)),'0fcdf39af84f5a1b2300972fbc6424a7797deab8982350c6b9c658ae663b950c');
 assert.equal(Object.hasOwn(result.report,'endpointHandoffs'),false);assert.equal(Object.hasOwn(result.report,'nativeSideExtensions'),false);
});
