import test from 'node:test';
import assert from 'node:assert/strict';
import {compileGridTerrainFields} from '../src/grid-terrain.mjs';
import {compileCurveGeometry} from '../src/curves.mjs';
import {compileTerrainUnionMaterial,TERRAIN_UNION_MATERIAL_PROFILE,TERRAIN_SURFACE_INTERFACE_PROFILE} from '../src/terrain-union-material.mjs';
import {compileTerrainUnionEdges,validateTerrainEdges,GRID_TERRAIN_EDGE_PROFILE,NEAR_OPAQUE_JOIN_PROFILE,EXPOSED_SIDE_TERMINATION_PROFILE} from '../src/terrain-edges.mjs';
import {buildTerrainEdgeJunctions} from '../src/terrain-edge-junction.mjs';
import {encodeRgbaPng,inspectPng} from '../src/png.mjs';
import {hash} from '../src/generation/common.mjs';
import {terrainEdgesFixture} from './helpers/terrain-edges.mjs';

const grid={width:64,height:64},world={x:0,y:0,width:512,height:512},key=(x,y)=>`${x},${y}`;
const ratio=value=>value.numerator/value.denominator;
function fixture(){
  const f=terrainEdgesFixture(),edges=structuredClone(f.edges),images=new Map();
  Object.assign(edges,{format:'ai_scene_terrain_edges_v5',gridProfile:GRID_TERRAIN_EDGE_PROFILE,joinProfile:NEAR_OPAQUE_JOIN_PROFILE});
  for(const side of ['left','right'])for(const part of ['wall','corner'])edges[side][part].inboardBlend=side==='left'?{fromX:32,toX:46}:{fromX:16,toX:2};
  edges.junctions=buildTerrainEdgeJunctions(edges,{readAsset:path=>f.files.get(path)});
  const field=(path,width,height,color)=>{
    const rgba=Buffer.alloc(width*height*4);for(let i=0;i<rgba.length;i+=4)rgba.set([...color,255],i);
    const bytes=encodeRgbaPng(width,height,rgba);f.files.set(path,bytes);return {source:{path,sha256:hash(bytes),byteLength:bytes.length},pixelSize:{width,height}};
  };
  const base={...f.appearance,format:'ai_scene_continuous_terrain_appearance_v6',surfaceOriginInBodyPixels:{numerator:-40,denominator:1},
    capDepth:{numerator:64,denominator:1},capUvEnd:{numerator:1,denominator:1},
    body:field('body.png',32,128,[40,70,110]),cap:field('cap.png',32,128,[25,220,235])};
  const surfaceInterface={profile:TERRAIN_SURFACE_INTERFACE_PROFILE,capSourceSha256:base.cap.source.sha256,capEndRow:20,fadeRows:4};
  Object.assign(edges,{format:'ai_scene_terrain_edges_v6',materialProfile:TERRAIN_UNION_MATERIAL_PROFILE,
    sideTerminationProfile:EXPOSED_SIDE_TERMINATION_PROFILE,surfaceInterface});
  validateTerrainEdges(edges,base,{readAsset:path=>f.files.get(path)});
  const appearance={...base,format:'ai_scene_continuous_terrain_appearance_v8',bodyRepeatSha256:'c'.repeat(64),
    bodyPeriod:{width:{numerator:512,denominator:1},height:{numerator:40960,denominator:253}},
    bodyOriginWorldY:{numerator:18688,denominator:253}};
  for(const [path,bytes]of f.files)images.set(path,inspectPng(bytes,{includePixels:true}));
  return {edges,base,appearance,images,surfaceInterface};
}
function compile(f,points,curves=[]){
  const cells=new Map(points.map(([x,y])=>[key(x,y),'terrain.primary'])),
    fields=compileGridTerrainFields(cells,{grid,appearance:f.base,layerId:'ground'}),
    material=compileTerrainUnionMaterial({gridTerrains:fields,curveTerrains:curves,appearance:f.appearance,grid,surfaceInterface:f.surfaceInterface}),
    result=compileTerrainUnionEdges(material.gridTerrains,material.curveTerrains,f.edges,{world,grid,cells});
  return {...result,material,cells};
}
const owners=result=>[...result.gridTerrains,...result.curves];
function uvAt(mesh,x,y){
  for(let i=0;i<mesh.indices.length;i+=3){
    const ids=mesh.indices.slice(i,i+3),[a,b,c]=ids.map(n=>({x:mesh.positions[n*2],y:mesh.positions[n*2+1]})),
      den=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);
    if(Math.abs(den)<1e-9)continue;
    const u=((b.y-c.y)*(x-c.x)+(c.x-b.x)*(y-c.y))/den,v=((c.y-a.y)*(x-c.x)+(a.x-c.x)*(y-c.y))/den,w=[u,v,1-u-v];
    if(Math.min(...w)>=-1e-8)return [0,1].map(axis=>ids.reduce((sum,n,j)=>sum+mesh.uvs[n*2+axis]*w[j],0));
  }return null;
}
function alphaAt(f,result,x,y){
  let alpha=0;
  for(const owner of owners(result))for(const [mesh,source,clamp]of [
    [owner.body,f.appearance.body.source,false],...(owner.capBands??[owner.cap]).map(b=>[b,f.appearance.cap.source,false]),
    ...(owner.edgeMeshes??[]).map(m=>[m,m.source,true])]){
    const uv=uvAt(mesh,x,y);if(!uv)continue;
    const image=f.images.get(source.path),coordinate=(u,size)=>clamp?Math.min(size-1,Math.max(0,Math.floor(u*size))):((Math.floor(u*size)%size)+size)%size,
      sx=coordinate(uv[0],image.width),sy=coordinate(uv[1],image.height),a=image.rgba[(sy*image.width+sx)*4+3]/255*(mesh.coverageOpacity??1);
    alpha=a+alpha*(1-a);
  }return alpha;
}
function components(points){
  const unseen=new Set(points.map(([x,y])=>key(x,y)));let count=0;
  for(const [x,y]of points){if(!unseen.delete(key(x,y)))continue;count++;const queue=[[x,y]];
    for(let i=0;i<queue.length;i++){const [cx,cy]=queue[i];for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]])if(unseen.delete(key(cx+dx,cy+dy)))queue.push([cx+dx,cy+dy]);}}
  return count;
}
function assertWorldUv(f,result,label){
  const H=ratio(f.appearance.bodyPeriod.height),origin=ratio(f.appearance.bodyOriginWorldY);
  for(const owner of owners(result))for(let i=0;i<owner.body.positions.length;i+=2){
    assert(Math.abs(owner.body.uvs[i]-owner.body.positions[i]/512)<1e-8,`${label}: final clipped body has one world X phase`);
    assert(Math.abs(owner.body.uvs[i+1]-(owner.body.positions[i+1]-origin)/H)<1e-8,`${label}: final clipped body retains rational period and phase origin`);
  }
}
const curve=(id,left,right,top,bottom)=>({...compileCurveGeometry({curveId:id,familyId:'terrain.primary',baseY:bottom,
  points:[{x:left,y:top,slope:0},{x:right,y:top,slope:0}]},16),layerId:'ground'});

test('all 511 nonempty 3x3 grid combinations retain solids, holes, point-contact separation and exact world material phase',{timeout:120000},()=>{
  const f=fixture();let shapes=0,samples=0;
  for(let mask=1;mask<512;mask++){
    const points=Array.from({length:9},(_,i)=>mask&(1<<i)?[2+i%3,2+Math.floor(i/3)]:null).filter(Boolean),result=compile(f,points),label=`mask ${mask}`;
    assert.equal(result.gridTerrains.length,components(points),`${label}: diagonal contacts cannot merge separate solids`);
    assert.equal(result.curves.length,0);assertWorldUv(f,result,label);
    // Probe every occupied and empty cell in and around the 3x3 domain. Native
    // contour overhangs are narrower than the half-cell sample distance.
    for(let y=1;y<=5;y++)for(let x=1;x<=5;x++){
      const alpha=alphaAt(f,result,x*64+32,y*64+32),solid=result.cells.has(key(x,y));
      assert(solid?alpha>.999:alpha===0,`${label}: ${solid?'solid coverage':'empty-space preservation'} at cell ${x},${y}`);samples++;
    }
    const verticalFaces=points.reduce((n,[x,y])=>n+Number(!result.cells.has(key(x-1,y)))+Number(!result.cells.has(key(x+1,y))),0),
      placedLength=result.report.placed.reduce((n,side)=>n+side.toY-side.fromY,0);
    assert.equal(placedLength,verticalFaces*64,`${label}: native trims cover exactly the exposed vertical intervals, including interior holes`);
    assert(result.report.placed.every(side=>side.authorBoundaryRestarts===0&&side.cornerEndOverlap==='clipped-to-exposed-union-side'));
    shapes++;
  }
  assert.equal(shapes,511);assert.equal(samples,12775);
});

test('one-cell bridge, enclosed hole and a thin U-channel do not grow trim or lip across the empty opening',()=>{
  const f=fixture(),rect=(x,y,w,h)=>Array.from({length:h},(_,j)=>Array.from({length:w},(_,i)=>[x+i,y+j])).flat(),
    cases=[
      {label:'bridge',points:[...rect(2,2,4,1),...rect(2,3,1,3),...rect(5,3,1,3)],empty:[[3,3],[4,3],[3,4],[4,4]]},
      {label:'hole',points:rect(2,2,4,4).filter(([x,y])=>!(x>=3&&x<=4&&y>=3&&y<=4)),empty:[[3,3],[4,3],[3,4],[4,4]]},
      {label:'one-cell channel',points:rect(2,2,4,4).filter(([x,y])=>!(x===3&&y<5)),empty:[[3,2],[3,3],[3,4]]},
    ];
  for(const c of cases){const result=compile(f,c.points);assertWorldUv(f,result,c.label);
    for(const [x,y]of c.empty)for(const dx of [16,32,48])for(const dy of [16,32,48])
      assert.equal(alphaAt(f,result,x*64+dx,y*64+dy),0,`${c.label}: native layers cannot fill the opening`);
    for(const [x,y]of c.points)for(const dx of [16,32,48])for(const dy of [16,32,48])
      assert(alphaAt(f,result,x*64+dx,y*64+dy)>.999,`${c.label}: retain original solid front face`);
  }
});

test('grid and curve contacts above, below, left and right keep a single wall field and suppress only buried lips',()=>{
  const f=fixture(),cases=[
    {label:'grid above',cells:[[2,2],[3,2]],curves:[curve('below',128,256,192,384)],inside:[[192,160],[192,208],[192,320]],buried:[192,192],sideLength:512},
    {label:'curve above',cells:[[2,3],[3,3],[2,4],[3,4]],curves:[curve('above',128,256,128,192)],inside:[[192,160],[192,208],[192,288]],buried:[192,192],sideLength:384},
    {label:'curve right',cells:[[2,2],[2,3],[2,4]],curves:[curve('right',192,320,128,320)],inside:[[160,224],[208,224],[288,224]],sideLength:384},
    {label:'curve left',cells:[[4,2],[4,3],[4,4]],curves:[curve('left',128,256,128,320)],inside:[[160,224],[240,224],[288,224]],sideLength:384},
  ];
  for(const c of cases){const result=compile(f,c.cells,c.curves);assertWorldUv(f,result,c.label);
    assert.equal(result.material.report.groups.length,1,`${c.label}: positive shared boundary joins the material group`);
    assert.equal(result.report.placed.reduce((n,p)=>n+p.toY-p.fromY,0),c.sideLength,`${c.label}: no buried author-side trim remains`);
    for(const [x,y]of c.inside)assert(alphaAt(f,result,x+.25,y+.25)>.999,`${c.label}: no seam opening in front face`);
    if(c.buried)assert(!owners(result).some(owner=>(owner.capBands??[]).some(band=>uvAt(band,c.buried[0],c.buried[1]+1))),`${c.label}: buried horizontal author join has no cyan lip`);
  }
  const separate=compile(f,[[2,5],[3,5]],[curve('detached',128,256,128,256)]);
  assert.equal(separate.material.report.groups.length,2);assert.equal(separate.report.placed.length,4);
  for(const x of [144,192,240])assert.equal(alphaAt(f,separate,x,288),0,'disconnected curve/grid air gap remains empty');
});
