import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {compileGridTerrainFields} from '../src/grid-terrain.mjs';
import {compileCurveGeometry} from '../src/curves.mjs';
import {compileTerrainUnionMaterial,TERRAIN_UNION_MATERIAL_PROFILE} from '../src/terrain-union-material.mjs';
import {compileTerrainUnionEdges,validateTerrainEdges,GRID_TERRAIN_EDGE_PROFILE,NEAR_OPAQUE_JOIN_PROFILE,EXPOSED_SIDE_TERMINATION_PROFILE} from '../src/terrain-edges.mjs';
import {buildTerrainEdgeJunctions} from '../src/terrain-edge-junction.mjs';
import {buildTerrainEdgeDelivery,verifyTerrainEdgeDelivery} from '../src/terrain-edge-pipeline.mjs';
import {loadSceneKit,readMap,contextFor} from '../src/kit.mjs';
import {compileMap} from '../src/compile.mjs';
import {validateDocument} from '../src/schema.mjs';
import {encodeRgbaPng} from '../src/png.mjs';
import {hash} from '../src/generation/common.mjs';
import {terrainEdgesFixture} from './helpers/terrain-edges.mjs';
import {setupTerrainEdgeDelivery} from './helpers/terrain-edge-delivery.mjs';

const grid={width:64,height:64},world={x:0,y:0,width:512,height:512};
const rejects=(action,code)=>assert.throws(action,error=>error.errors?.some(issue=>issue.code===code));
function fixture(){
  const f=terrainEdgesFixture(),edges=structuredClone(f.edges);
  Object.assign(edges,{format:'ai_scene_terrain_edges_v5',gridProfile:GRID_TERRAIN_EDGE_PROFILE,joinProfile:NEAR_OPAQUE_JOIN_PROFILE});
  for(const side of ['left','right'])for(const part of ['wall','corner'])edges[side][part].inboardBlend=side==='left'?{fromX:32,toX:46}:{fromX:16,toX:2};
  // The 76-world opaque corner shoulder reproduces a real long native tail
  // crossing the bottom of a one-cell step. It is synthetic engineering art.
  for(const [index,side]of ['left','right'].entries()){
    const item=edges[side].corner,width=48,height=160,rgba=Buffer.alloc(width*height*4);
    for(let y=8;y<height-2;y++)for(let x=2;x<width-2;x++)rgba.set([140+index*20,90,35,255],(y*width+x)*4);
    const bytes=encodeRgbaPng(width,height,rgba);f.files.set(item.source.path,bytes);
    item.pixelSize={width,height};item.source={...item.source,sha256:hash(bytes),byteLength:bytes.length};
  }
  edges.junctions=buildTerrainEdgeJunctions(edges,{readAsset:path=>f.files.get(path)});
  Object.assign(edges,{format:'ai_scene_terrain_edges_v6',materialProfile:TERRAIN_UNION_MATERIAL_PROFILE});
  return {...f,edges,appearance:{...f.appearance,format:'ai_scene_continuous_terrain_appearance_v6',surfaceOriginInBodyPixels:{numerator:-40,denominator:1},
    capDepth:{numerator:36,denominator:1},capUvEnd:{numerator:1,denominator:1}}};
}
const curve=(id,left,right,top,bottom)=>({...compileCurveGeometry({curveId:id,familyId:'terrain.primary',baseY:bottom,
  points:[{x:left,y:top,slope:0},{x:right,y:top,slope:0}]},16),layerId:'ground'});
function compile(f,points,curves=[],termination){
  const cells=new Map(points.map(([x,y])=>[`${x},${y}`,'terrain.primary'])),fields=compileGridTerrainFields(cells,{grid,appearance:f.appearance,layerId:'ground'}),
    material=compileTerrainUnionMaterial({gridTerrains:fields,curveTerrains:curves,appearance:f.appearance,grid}),before=structuredClone(material),edges=structuredClone(f.edges);
  if(termination)edges.sideTerminationProfile=termination;
  validateTerrainEdges(edges,f.appearance,{readAsset:path=>f.files.get(path)});
  const result=compileTerrainUnionEdges(material.gridTerrains,material.curveTerrains,edges,{world,grid,cells});
  assert.deepEqual(material,before);return result;
}
const meshes=result=>[...result.gridTerrains,...result.curves].flatMap(owner=>owner.edgeMeshes??[]);
function covers(mesh,x,y){
  for(let i=0;i<mesh.indices.length;i+=3){
    const [a,b,c]=mesh.indices.slice(i,i+3).map(n=>({x:mesh.positions[n*2],y:mesh.positions[n*2+1]})),
      den=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);
    if(Math.abs(den)<1e-9)continue;
    const u=((b.y-c.y)*(x-c.x)+(c.x-b.x)*(y-c.y))/den,v=((c.y-a.y)*(x-c.x)+(a.x-c.x)*(y-c.y))/den;
    if(Math.min(u,v,1-u-v)>1e-7)return true;
  }return false;
}

test('explicit exposed-side trim ends at real step contact instead of painting its long native shoulder on the buried support',()=>{
  const f=fixture(),points=[[2,2],[3,2],[1,3],[2,3],[3,3],[4,3],[1,4],[2,4],[3,4],[4,4]],
    old=compile(f,points),strict=compile(f,points,[],EXPOSED_SIDE_TERMINATION_PROFILE);
  for(const [side,x]of [['left',130],['right',254]]){
    const atStep=result=>meshes(result).filter(m=>m.side===side&&m.unionSide.fromY===128&&m.unionSide.toY===192);
    assert(atStep(old).some(m=>m.part==='corner'&&covers(m,x+.5,197.5)),'legacy fixture must reproduce the supported tail below the exposed end');
    assert(!atStep(strict).some(m=>covers(m,x+.5,197.5)),'a manufactured vertical trim must not mark the filled support below its exposed interval');
    assert(atStep(strict).some(m=>m.part==='corner'&&covers(m,x+.5,188.5)),'the last truly exposed corner rows remain painted');
    assert(atStep(strict).every(m=>m.positions.every((p,i)=>!(i%2)||p<=192+1e-6)),'clip all bands on both sides at the actual union boundary');
    const retainedBody=strict.gridTerrains.flatMap(p=>[p.body,...(p.capBands??[])]);
    assert(retainedBody.some(m=>covers(m,x+.5,197.5)),'the unexposed supporting body remains intact beneath the trimmed edge');
  }
  assert.equal(strict.report.sideTerminationProfile,EXPOSED_SIDE_TERMINATION_PROFILE);
  assert(strict.report.placed.every(p=>p.cornerEndOverlap==='clipped-to-exposed-union-side'));
  assert(old.report.placed.every(p=>p.cornerEndOverlap==='original-corner-tail-inside-same-union-support-only'));
  assert.equal(Object.hasOwn(old.report,'sideTerminationProfile'),false);
  assert.deepEqual(f.edges.junctions,fixture().edges.junctions,'termination never rewrites native junction calibration or source identity');
});

test('exposed-side termination crosses author joins when the same side remains exposed, and leaves genuine gaps empty',()=>{
  const f=fixture(),result=compile(f,[[2,3],[3,3],[2,4],[3,4]],[curve('short.curve',128,256,174,192)],EXPOSED_SIDE_TERMINATION_PROFILE);
  for(const row of result.report.placed){assert.equal(row.fromY,174);assert.equal(row.toY,320);assert.equal(row.ownerIds.length,2);}
  for(const [side,x]of [['left',130],['right',254]])assert(meshes(result).some(m=>m.side===side&&m.part==='corner'&&covers(m,x+.5,197.5)),
    'the corner may cross the author base because the actual union side continues below it');
  const detached=compile(f,[[2,4],[3,4]],[curve('detached.curve',128,256,128,192)],EXPOSED_SIDE_TERMINATION_PROFILE);
  assert(!meshes(detached).some(m=>covers(m,130.5,224.5)),'termination cannot extend trim across empty author space');
});

test('side termination rejects unknown values and non-union edge contracts before reading workflow or source files',()=>{
  const f=fixture();
  rejects(()=>validateTerrainEdges({...f.edges,sideTerminationProfile:'arbitrary-crop'},f.appearance),'TERRAIN_EDGE_TERMINATION_PROFILE');
  rejects(()=>validateTerrainEdges({...f.edges,format:'ai_scene_terrain_edges_v5',sideTerminationProfile:EXPOSED_SIDE_TERMINATION_PROFILE},f.appearance),'TERRAIN_EDGE_TERMINATION_PROFILE');
  for(const sideTerminationProfile of [EXPOSED_SIDE_TERMINATION_PROFILE,'arbitrary-crop'])rejects(()=>buildTerrainEdgeDelivery({
    workflow:join('not-read','workflow'),baseKitRoot:join('not-read','base','kit'),batchSha256:'a'.repeat(64),output:join('not-read','output'),controls:{left:{},right:{},sideTerminationProfile}}),
    'TERRAIN_EDGE_TERMINATION_PROFILE');
});

test('delivery carries the explicit termination profile into a separately verified kit without changing native PNGs or author collision',
  {timeout:360000},t=>{
    const f=setupTerrainEdgeDelivery(t),controls={...structuredClone(f.controls),joinProfile:NEAR_OPAQUE_JOIN_PROFILE,
      gridProfile:GRID_TERRAIN_EDGE_PROFILE,junctions:{},materialProfile:TERRAIN_UNION_MATERIAL_PROFILE};
    for(const side of ['left','right'])for(const part of ['wall','corner'])controls[side][part].inboardBlend={
      fromX:controls[side][part].innerX,toX:side==='left'?264:24};
    const oldOptions={...f.deliveryOptions,controls,output:join(f.parent,'legacy-union')},oldReport=buildTerrainEdgeDelivery(oldOptions),
      oldHandle=loadSceneKit(join(oldOptions.output,'candidate/kit')),oldContext=contextFor(oldHandle),oldMap=readMap(oldHandle),oldScene=compileMap(oldHandle,oldMap),
      options={...f.deliveryOptions,controls:{...controls,sideTerminationProfile:EXPOSED_SIDE_TERMINATION_PROFILE},output:join(f.parent,'exposed-only')},
      report=buildTerrainEdgeDelivery(options),handle=loadSceneKit(join(options.output,'candidate/kit')),context=contextFor(handle),map=readMap(handle),scene=compileMap(handle,map),
      readiness=JSON.parse(readFileSync(join(options.output,'candidate/readiness.json'),'utf8'));
    assert.equal(context.kit.terrainEdges.sideTerminationProfile,EXPOSED_SIDE_TERMINATION_PROFILE);
    assert.equal(readiness.renderingPolicy.sideTerminationProfile,EXPOSED_SIDE_TERMINATION_PROFILE);
    assert.equal(scene.terrainEdgePlacement.sideTerminationProfile,EXPOSED_SIDE_TERMINATION_PROFILE);
    assert.notEqual(report.kitSha256,oldReport.kitSha256);assert.deepEqual(scene.collisionSuggestions,oldScene.collisionSuggestions);
    const plain=({kitRef,...author})=>author;assert.deepEqual(plain(map),plain(oldMap));
    for(const [path,bytes]of oldContext.files)if(path.endsWith('.png'))assert.deepEqual(context.files.get(path),bytes,path);
    for(const side of ['left','right'])for(const part of ['wall','corner']){
      const role=side+'-'+(part==='wall'?'wall':'top-corner');assert.deepEqual(readFileSync(join(options.output,'candidate/source',role+'-native.png')),f.raws.get(role));
    }
    assert.deepEqual(context.kit.terrainEdges.junctions,oldContext.kit.terrainEdges.junctions);
    assert.equal(validateDocument('ai_scene_kit_v4',context.kit).length,0);
    const invalid=structuredClone(context.kit);invalid.terrainEdges.sideTerminationProfile='arbitrary-crop';
    assert(validateDocument('ai_scene_kit_v4',invalid).some(e=>e.code==='SCHEMA_CONST'&&e.path.endsWith('/sideTerminationProfile')));
    assert.equal(verifyTerrainEdgeDelivery(options).reportSha256,report.sha256);
    assert.equal(verifyTerrainEdgeDelivery(oldOptions).reportSha256,oldReport.sha256,'old default delivery still replays after opting in separately');
    assert.equal(report.generationCalls,0);assert.equal(report.finalHumanArtReview,'pending');
  });
