import test from 'node:test';
import assert from 'node:assert/strict';
import {compileGridTerrainFields} from '../src/grid-terrain.mjs';
import {compileCurveGeometry} from '../src/curves.mjs';
import {compileTerrainUnionMaterial,TERRAIN_UNION_MATERIAL_PROFILE} from '../src/terrain-union-material.mjs';
import {compileTerrainUnionEdges,GRID_TERRAIN_EDGE_PROFILE,NEAR_OPAQUE_JOIN_PROFILE} from '../src/terrain-edges.mjs';
import {buildTerrainEdgeJunctions} from '../src/terrain-edge-junction.mjs';
import {paintCoherentMesh} from '../src/coherent-mesh-render.mjs';
import {inspectPng,encodeRgbaPng} from '../src/png.mjs';
import {hash} from '../src/generation/common.mjs';
import {terrainEdgesFixture} from './helpers/terrain-edges.mjs';

const grid={width:64,height:64},world={x:0,y:0,width:512,height:512};
function fixture(){
  const f=terrainEdgesFixture(),edges=structuredClone(f.edges);
  Object.assign(edges,{format:'ai_scene_terrain_edges_v5',gridProfile:GRID_TERRAIN_EDGE_PROFILE,joinProfile:NEAR_OPAQUE_JOIN_PROFILE});
  for(const side of ['left','right'])for(const part of ['wall','corner'])edges[side][part].inboardBlend=side==='left'?{fromX:32,toX:46}:{fromX:16,toX:2};
  edges.junctions=buildTerrainEdgeJunctions(edges,{readAsset:path=>f.files.get(path)});
  Object.assign(edges,{format:'ai_scene_terrain_edges_v6',materialProfile:TERRAIN_UNION_MATERIAL_PROFILE});
  const appearance={...f.appearance,format:'ai_scene_continuous_terrain_appearance_v6',surfaceOriginInBodyPixels:{numerator:-40,denominator:1},
    capDepth:{numerator:36,denominator:1},capUvEnd:{numerator:1,denominator:1}};
  return {...f,edges,appearance};
}
const occupancy=points=>new Map(points.map(([x,y])=>[`${x},${y}`,'terrain.primary']));
const curve=(id,left,right,top,bottom)=>({...compileCurveGeometry({curveId:id,familyId:'terrain.primary',baseY:bottom,
  points:[{x:left,y:top,slope:0},{x:right,y:top,slope:0}]},16),layerId:'ground'});
function compile(points,curves=[],f=fixture(),options={}){
  const cells=occupancy(points),fields=compileGridTerrainFields(cells,{grid,appearance:f.appearance,layerId:'ground'}),
    material=compileTerrainUnionMaterial({gridTerrains:fields,curveTerrains:curves,appearance:f.appearance,grid}),
    before=structuredClone(material),result=compileTerrainUnionEdges(material.gridTerrains,material.curveTerrains,f.edges,{world,grid,cells,...options});
  assert.deepEqual(material,before,'edge placement must not mutate material source meshes');
  return {...result,material,f};
}
const allOwners=result=>[...result.gridTerrains,...result.curves];
const allEdges=result=>allOwners(result).flatMap(owner=>owner.edgeMeshes??[]);
function longCornerFixture(){
  const f=fixture();
  for(const [index,side]of ['left','right'].entries()){
    const item=f.edges[side].corner,width=48,height=160,rgba=Buffer.alloc(width*height*4);
    for(let y=8;y<height-2;y++)for(let x=2;x<width-2;x++){
      const boundary=12+Math.floor(y/4)%8;
      if(side==='left'?x>=boundary:x<width-boundary)rgba.set([140+index*20,90,35,255],(y*width+x)*4);
    }
    const bytes=encodeRgbaPng(width,height,rgba);f.files.set(item.source.path,bytes);
    item.pixelSize={width,height};item.source={...item.source,sha256:hash(bytes),byteLength:bytes.length};
  }
  f.edges.junctions=buildTerrainEdgeJunctions(f.edges,{readAsset:path=>f.files.get(path)});return f;
}
function covers(mesh,x,y){
  for(let i=0;i<mesh.indices.length;i+=3){const [a,b,c]=mesh.indices.slice(i,i+3).map(n=>({x:mesh.positions[n*2],y:mesh.positions[n*2+1]})),
    den=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);if(Math.abs(den)<1e-9)continue;
    const u=((b.y-c.y)*(x-c.x)+(c.x-b.x)*(y-c.y))/den,v=((c.y-a.y)*(x-c.x)+(a.x-c.x)*(y-c.y))/den;
    if(Math.min(u,v,1-u-v)>1e-7)return true;
  }return false;
}

test('a curve stacked over grid has one exterior side sequence and no native corners at the buried grid top',()=>{
  const result=compile([[2,3],[3,3],[2,4],[3,4]],[curve('curve.above',128,256,128,192)]);
  assert.equal(result.report.placed.length,2);
  for(const row of result.report.placed){assert.equal(row.fromY,128);assert.equal(row.toY,320);assert.equal(row.cornerApplied,true);
    assert.equal(row.ownerIds.length,2);assert.equal(row.coalescedAcrossAuthorOwners,true);assert.equal(row.authorBoundaryRestarts,0);}
  assert(!allEdges(result).some(edge=>edge.unionSide.fromY===192),'author boundary must not start another grass corner');
  for(const side of ['left','right'])assert.equal(new Set(allEdges(result).filter(edge=>edge.side===side&&edge.part==='corner').map(edge=>edge.nativeOriginWorld)).size,1);
  assert(result.gridTerrains.every(p=>p.capBands.every(band=>!covers(band,192,192))));
});

test('grid stacked over a curve carries the original corner and wall sequence through the horizontal author join',()=>{
  const result=compile([[2,2],[3,2]],[curve('curve.below',128,256,192,384)]);
  assert.equal(result.report.placed.length,2);
  for(const row of result.report.placed){assert.equal(row.fromY,128);assert.equal(row.toY,384);assert.equal(row.ownerIds.length,2);assert.equal(row.authorBoundaryRestarts,0);}
  assert(!allEdges(result).some(edge=>edge.unionSide.fromY===192));
  assert(result.curves[0].capBands.every(band=>!covers(band,192,192)));
});

test('complete original corner-tail pixels remain visible below the original curve base across the grid owner',()=>{
  const result=compile([[2,3],[3,3],[2,4],[3,4]],[curve('curve.short.top',128,256,174,192)]),viewport={width:180,height:100},left=100,top=160,
    pixels=Buffer.alloc(viewport.width*viewport.height*4);
  for(const edge of allEdges(result))paintCoherentMesh(pixels,viewport,edge,inspectPng(result.f.files.get(edge.source.path),{includePixels:true}),
    {left,top,clampU:true,clampV:true,opacity:edge.coverageOpacity??1,topLeftRule:true});
  for(const [side,x,color]of [['left',130,[140,90,35]],['right',254,[160,90,35]]]){
    assert(allEdges(result).some(edge=>edge.side===side&&edge.part==='corner'&&covers(edge,x+.5,200.5)),'the same native corner geometry crosses curve base192');
    const p=((200-top)*viewport.width+x-left)*4;assert.deepEqual([...pixels.subarray(p,p+3)],color,'source-over must retain original source corner RGB after the author join');
  }
});

test('same-X disconnected solids retain separate native origins and cannot bridge an empty vertical gap',()=>{
  const result=compile([[2,4],[3,4]],[curve('curve.detached.above',128,256,128,192)]);
  assert.equal(result.report.placed.length,4);assert(result.report.placed.every(row=>row.ownerIds.length===1));
  assert(!allEdges(result).some(edge=>covers(edge,130.25,224.25)),'empty author space must stay empty');
  assert(result.report.placed.some(row=>row.fromY===128&&row.toY===192));assert(result.report.placed.some(row=>row.fromY===256&&row.toY===320));
});

test('a staircase keeps the complete corner tail across its short vertical end only where the same union has real support below',()=>{
  const f=longCornerFixture(),supported=compile([[2,2],[3,2],[1,3],[2,3],[3,3],[4,3],[1,4],[2,4],[3,4],[4,4]],[],f),
    viewport={width:180,height:100},left=100,top=160,pixels=Buffer.alloc(viewport.width*viewport.height*4);
  for(const edge of allEdges(supported))paintCoherentMesh(pixels,viewport,edge,inspectPng(f.files.get(edge.source.path),{includePixels:true}),
    {left,top,clampU:true,clampV:true,opacity:edge.coverageOpacity??1,topLeftRule:true});
  for(const [side,x,color]of [['left',130,[140,90,35]],['right',254,[160,90,35]]]){
    const tails=allEdges(supported).filter(edge=>edge.side===side&&edge.part==='corner'&&edge.unionSide.fromY===128&&edge.unionSide.toY===192);
    assert(tails.some(edge=>covers(edge,x+.5,197.5)),'native tail must continue into the real filled row below the 64-world step');
    const p=((197-top)*viewport.width+x-left)*4;assert.deepEqual([...pixels.subarray(p,p+3)],color);
  }
  const unsupported=compile([[2,2],[3,2],[3,3],[3,4]],[],f);
  assert(!allEdges(unsupported).some(edge=>edge.side==='left'&&edge.part==='corner'&&edge.unionSide.x===128&&covers(edge,130.5,197.5)),
    'the long original corner may not fill the genuine air below a one-cell overhang');
});

test('holes keep wall-only inner faces while world-border sides are skipped and cap bands follow retained body cutback',()=>{
  const ring=[];for(let y=2;y<=4;y++)for(let x=2;x<=4;x++)if(x!==3||y!==3)ring.push([x,y]);
  const result=compile(ring),inner=result.report.placed.filter(row=>row.fromY===192&&row.toY===256);
  assert.equal(inner.length,2);assert(inner.every(row=>!row.cornerApplied));
  for(const owner of allOwners(result)){
    assert(!covers(owner.body,224.25,224.25));assert(!owner.capBands.some(band=>covers(band,224.25,224.25)));
    for(const band of owner.capBands)for(let i=0;i<band.indices.length;i+=3){const ids=band.indices.slice(i,i+3),
      x=ids.reduce((s,n)=>s+band.positions[n*2],0)/3,y=ids.reduce((s,n)=>s+band.positions[n*2+1],0)/3;
      assert(covers(owner.body,x,y),'trimmed local cap must remain over its retained body');}
  }
  const border=compile([[0,2],[7,2]]);assert(border.report.skipped.some(row=>row.x===0&&row.reason==='world-boundary'));
  assert(border.report.skipped.some(row=>row.x===512&&row.reason==='world-boundary'));
});
