import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {compileGridTerrainFields} from '../src/grid-terrain.mjs';
import {compileCurveGeometry} from '../src/curves.mjs';
import {compileTerrainUnionMaterial} from '../src/terrain-union-material.mjs';
import {compileTerrainBottomEdges,validateTerrainBottomEdges,TERRAIN_BOTTOM_EDGE_PROFILE,TERRAIN_BOTTOM_EDGE_PROFILE_V2,
  TERRAIN_BOTTOM_NATIVE_SIZE_PROFILE,TERRAIN_BOTTOM_RENDER_ENVELOPE_PROFILE} from '../src/terrain-bottom-edges.mjs';
import {paintCoherentMesh} from '../src/coherent-mesh-render.mjs';
import {inspectPng,encodeRgbaPng} from '../src/png.mjs';
import {canonicalJson} from '../src/document.mjs';
import {terrainEdgesFixture} from './helpers/terrain-edges.mjs';

const grid={width:64,height:64},world={x:0,y:0,width:512,height:384},background=[12,14,16],edgeColor=[40,120,180],endCapColor=[245,5,180],
  hash=b=>createHash('sha256').update(b).digest('hex');
function fixture(version=2){
  const f=terrainEdgesFixture();f.edges={...f.edges,format:'ai_scene_terrain_edges_v6',materialProfile:'union-world-body-local-surface-v1'};
  f.appearance={...f.appearance,format:'ai_scene_continuous_terrain_appearance_v6',surfaceOriginInBodyPixels:{numerator:-40,denominator:1},
    capDepth:{numerator:8,denominator:1},capUvEnd:{numerator:1,denominator:1}};
  const bottom={format:`ai_scene_terrain_bottom_edges_v${version}`,profile:version===1?TERRAIN_BOTTOM_EDGE_PROFILE:TERRAIN_BOTTOM_EDGE_PROFILE_V2,
    ...(version===2?{nativeSizeProfile:TERRAIN_BOTTOM_NATIVE_SIZE_PROFILE,renderEnvelopeProfile:TERRAIN_BOTTOM_RENDER_ENVELOPE_PROFILE}:{}),
    sourceBinding:{materialSourceSha256:f.appearance.sourceSha256,surfaceMappingSha256:f.appearance.surfaceMappingSha256}};
  for(const [index,key]of ['edge','leftCorner','rightCorner'].entries()){
    const width=key==='edge'?80:64,height=64,rgba=Buffer.alloc(width*height*4);
    for(let y=2;y<height-2;y++)for(let x=2;x<width-2;x++){
      // A complete isolated native strip has genuine terminal caps outside its
      // chosen repeat window. Repeating the whole image paints those caps into
      // the middle of a wall, even though the source itself is perfectly valid.
      const color=key==='edge'?(x<16||x>=64?endCapColor:edgeColor):[150+index*20,110+index*10,55+index*10];
      rgba.set([...color,255],(y*width+x)*4);
    }
    const bytes=encodeRgbaPng(width,height,rgba),path=`bottom-window/${key}.png`;f.files.set(path,bytes);
    bottom[key]={source:{path,sha256:hash(bytes),byteLength:bytes.length},pixelSize:{width,height},scale:{numerator:1,denominator:2},
      boundaryY:48,innerY:32,inboardBlend:{fromY:32,toY:24},...(key==='edge'?{repeatX:{from:16,to:64}}:
        key==='leftCorner'?{boundaryX:16,innerX:32,stripStartX:40,wallStartY:16}:{boundaryX:48,innerX:32,stripStartX:24,wallStartY:16})};
  }
  validateTerrainBottomEdges(bottom,f.appearance,{terrainEdges:f.edges,readAsset:p=>f.files.get(p)});return {...f,bottom};
}
function compile(f,points,curves=[]){
  const cells=new Map(points.map(([x,y])=>[`${x},${y}`,'terrain.primary'])),input=compileTerrainUnionMaterial({
    gridTerrains:compileGridTerrainFields(cells,{grid,appearance:f.appearance,layerId:'ground'}),curveTerrains:curves,appearance:f.appearance,grid}),
    mapped=input.curveTerrains;
  for(const owner of mapped){owner.materialMapping={bodyMapping:'fixed-world-x512-y256-v1',bodyPeriod:{width:512,height:256}};
    owner.body.uvs=owner.body.positions.map((p,i)=>p/(i%2?256:512));}
  const before=structuredClone(input),result=compileTerrainBottomEdges({...input,bottomEdges:f.bottom,terrainEdges:f.edges,world,grid,cells});
  assert.deepEqual(input,before,'window sampling cannot change its input material or author geometry');return result;
}
const owners=r=>[...r.gridTerrains,...r.curveTerrains];
function render(f,result){
  const {width,height}=world,pixels=Buffer.alloc(width*height*4);for(let i=0;i<pixels.length;i+=4)pixels.set([...background,255],i);
  const body={width:2,height:2,rgba:Buffer.from(Array.from({length:4},()=>[210,30,40,255]).flat())};
  for(const owner of owners(result)){
    paintCoherentMesh(pixels,{width,height},owner.body,body,{topLeftRule:true});
    for(const band of owner.capBands??[])paintCoherentMesh(pixels,{width,height},band,body,{topLeftRule:true,clampV:true,opacity:band.coverageOpacity??1});
    for(const m of owner.edgeMeshes??[])paintCoherentMesh(pixels,{width,height},m,inspectPng(f.files.get(m.source.path),{includePixels:true}),
      {topLeftRule:true,clampU:true,clampV:true,opacity:m.coverageOpacity??1});
  }
  return {width,height,pixels};
}
const rgb=(image,x,y)=>[...image.pixels.subarray((y*image.width+x)*4,(y*image.width+x)*4+3)];
const line=(image,y,from,to)=>Array.from({length:to-from},(_,i)=>rgb(image,from+i,y));
const matches=(a,b)=>a.every((v,i)=>v===b[i]);
const cells=()=>Array.from({length:4},(_,i)=>[i+2,2]);
const curve=(left,right)=>({...compileCurveGeometry({curveId:'short.window',familyId:'terrain.primary',baseY:192,
  points:[{x:left,y:128,slope:0},{x:right,y:128,slope:0}]},8),layerId:'ground'});

test('v2 repeats only the measured central source window, so terminal native caps never enter a long lower edge',()=>{
  const old=fixture(1),f=fixture(2),before=new Map([...f.files].map(([p,b])=>[p,Buffer.from(b)])),controls=structuredClone(f.bottom),
    legacy=compile(old,cells()),fixed=compile(f,cells()),oldPixels=render(old,legacy),pixels=render(f,fixed);
  assert(line(oldPixels,190,144,368).some(p=>matches(p,endCapColor)),'the old full-PNG overlap must reproduce the unwanted interior cap');
  assert(line(pixels,190,144,368).every(p=>matches(p,edgeColor)),'the final wall underside must contain only the native central strip paint');
  assert.equal(fixed.report.horizontalRepeatSampling,'native-central-repeat-window-v1');assert(fixed.report.nativeWindowClips>0);
  for(const owner of owners(fixed))for(const m of owner.edgeMeshes??[])if(m.bottomPart==='edge'){
    for(let i=0;i<m.uvs.length;i+=2){assert(m.uvs[i]>=16/80-1e-10&&m.uvs[i]<=64/80+1e-10,'no source end-cap texels may enter the repeat mesh');
      assert(Math.abs(m.uvs[i]-(m.positions[i]-m.nativeSourceOriginWorld.x)/40)<1e-10,'the source scale and original tile origin stay intact');}
  }
  assert.deepEqual(f.bottom,controls);for(const [p,b]of before)assert.deepEqual(f.files.get(p),b,'source PNG bytes must remain untouched');
});

test('a sub-period lower edge stays covered at both native corner joins without rescaling the source window',()=>{
  const f=fixture(),result=compile(f,[],[curve(128,144)]),pixels=render(f,result);
  for(const y of [186,190,194])for(const p of line(pixels,y,129,143))assert(!matches(p,background),'short-segment joins must not open a hole');
  const edges=owners(result).flatMap(o=>o.edgeMeshes??[]),native=new Set(edges.map(m=>m.bottomPart));
  assert(native.has('edge')&&native.has('leftCorner')&&native.has('rightCorner'));
  for(const m of edges)assert.deepEqual(m.nativeScale,{numerator:1,denominator:2});
  for(const owner of owners(result))for(let i=0;i<owner.body.positions.length;i++)assert.equal(owner.body.uvs[i],owner.body.positions[i]/(i%2?256:512));
  assert(result.report.shortSpanClips>0);
});

test('v1 complete-source overlap and its compiled byte identity remain unchanged',()=>{
  const f=fixture(1),result=compile(f,cells());
  assert.equal(hash(canonicalJson(result)),'67b714354d4d98ccdd92c33c8a9bbc6bd601a20cc34246bb894dd262c0b0e05d');
  assert.equal(Object.hasOwn(result.report,'horizontalRepeatSampling'),false);assert.equal(Object.hasOwn(result.report,'nativeWindowClips'),false);
});
