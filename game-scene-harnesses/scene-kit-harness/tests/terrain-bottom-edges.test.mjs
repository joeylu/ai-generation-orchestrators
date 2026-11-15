import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {compileGridTerrainFields} from '../src/grid-terrain.mjs';
import {compileCurveGeometry} from '../src/curves.mjs';
import {compileTerrainUnionMaterial} from '../src/terrain-union-material.mjs';
import {compileTerrainBottomEdges,validateTerrainBottomEdges,terrainBottomEdgeSources,TERRAIN_BOTTOM_EDGE_PROFILE,TERRAIN_BOTTOM_EDGE_LIMITS,
  TERRAIN_BOTTOM_EDGE_PROFILE_V2,TERRAIN_BOTTOM_NATIVE_SIZE_PROFILE,TERRAIN_BOTTOM_EDGE_LIMITS_V2,TERRAIN_BOTTOM_RENDER_ENVELOPE_PROFILE} from '../src/terrain-bottom-edges.mjs';
import {encodeRgbaPng,inspectPng} from '../src/png.mjs';
import {paintCoherentMesh} from '../src/coherent-mesh-render.mjs';
import {validateDocument} from '../src/schema.mjs';
import {terrainEdgesFixture} from './helpers/terrain-edges.mjs';

const grid={width:64,height:64},world={x:0,y:0,width:512,height:512},hash=b=>createHash('sha256').update(b).digest('hex');
function fixture(){
  const f=terrainEdgesFixture();f.edges={...f.edges,format:'ai_scene_terrain_edges_v6',materialProfile:'union-world-body-local-surface-v1'};
  f.appearance={...f.appearance,format:'ai_scene_continuous_terrain_appearance_v6',surfaceOriginInBodyPixels:{numerator:-40,denominator:1},
    capDepth:{numerator:8,denominator:1},capUvEnd:{numerator:1,denominator:1}};
  const bottom={format:'ai_scene_terrain_bottom_edges_v1',profile:TERRAIN_BOTTOM_EDGE_PROFILE,
    sourceBinding:{materialSourceSha256:f.appearance.sourceSha256,surfaceMappingSha256:f.appearance.surfaceMappingSha256}};
  for(const [index,key]of ['edge','leftCorner','rightCorner'].entries()){
    const width=64,height=64,rgba=Buffer.alloc(width*height*4);
    for(let y=2;y<height-2;y++)for(let x=2;x<width-2;x++)rgba.set([40+index*50,100,180,255],(y*width+x)*4);
    const bytes=encodeRgbaPng(width,height,rgba),path=`bottom/${key}.png`;f.files.set(path,bytes);
    bottom[key]={source:{path,sha256:hash(bytes),byteLength:bytes.length},pixelSize:{width,height},scale:{numerator:1,denominator:2},
      boundaryY:48,innerY:32,inboardBlend:{fromY:32,toY:24},
      ...(key==='edge'?{repeatX:{from:8,to:56}}:key==='leftCorner'?{boundaryX:16,innerX:32,stripStartX:40,wallStartY:16}:
        {boundaryX:48,innerX:32,stripStartX:24,wallStartY:16})};
  }
  validateTerrainBottomEdges(bottom,f.appearance,{terrainEdges:f.edges,readAsset:path=>f.files.get(path)});return {...f,bottom};
}
const curve=(id,left,right,top,bottom)=>({...compileCurveGeometry({curveId:id,familyId:'terrain.primary',baseY:bottom,
  points:[{x:left,y:top,slope:0},{x:right,y:top,slope:0}]},8),layerId:'ground'});
function compile(points,curves=[],f=fixture()){
  const cells=new Map(points.map(([x,y])=>[`${x},${y}`,'terrain.primary'])),input=compileTerrainUnionMaterial({
    gridTerrains:compileGridTerrainFields(cells,{grid,appearance:f.appearance,layerId:'ground'}),curveTerrains:curves,appearance:f.appearance,grid}),before=structuredClone(input);
  const result=compileTerrainBottomEdges({...input,bottomEdges:f.bottom,terrainEdges:f.edges,world,grid,cells});
  assert.deepEqual(input,before,'input geometry and phase must remain immutable');
  return {...result,input,f};
}
const meshes=r=>[...r.gridTerrains,...r.curveTerrains].flatMap(o=>(o.edgeMeshes??[]).filter(m=>m.materialKey?.startsWith('bottom.')));
function covers(mesh,x,y){
  for(let i=0;i<mesh.indices.length;i+=3){const [a,b,c]=mesh.indices.slice(i,i+3).map(n=>({x:mesh.positions[n*2],y:mesh.positions[n*2+1]})),
    den=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);if(Math.abs(den)<1e-12)continue;
    const u=((b.y-c.y)*(x-c.x)+(c.x-b.x)*(y-c.y))/den,v=((c.y-a.y)*(x-c.x)+(a.x-c.x)*(y-c.y))/den;
    if(Math.min(u,v,1-u-v)>1e-7)return true;
  }return false;
}
const rejects=(fn,code)=>assert.throws(fn,e=>e.errors?.some(i=>i.code===code));

test('native bottom validation binds independent original sources, exact joins, scale and declared collars',()=>{
  const f=fixture(),before=structuredClone(f.bottom),bytes=new Map([...f.files].map(([p,b])=>[p,Buffer.from(b)]));
  assert.deepEqual(terrainBottomEdgeSources(f.bottom).map(i=>i.key),['edge','leftCorner','rightCorner']);
  const report=validateTerrainBottomEdges(f.bottom,f.appearance,{terrainEdges:f.edges,readAsset:p=>f.files.get(p)});
  assert.equal(report.sources.length,3);assert(report.sources.every(i=>i.minimumCollarAlpha===255));assert.equal(report.sourceRgbaChanged,false);
  assert.deepEqual(f.bottom,before);for(const [path,value]of bytes)assert.deepEqual(f.files.get(path),value);
  rejects(()=>validateTerrainBottomEdges({...f.bottom,profile:'mirror-top-lip'},f.appearance,{terrainEdges:f.edges}),'TERRAIN_BOTTOM_PROFILE');
  rejects(()=>validateTerrainBottomEdges(f.bottom,f.appearance,{terrainEdges:{...f.edges,format:'ai_scene_terrain_edges_v5'}}),'TERRAIN_BOTTOM_DEPENDENCY');
  rejects(()=>validateTerrainBottomEdges(f.bottom,{...f.appearance,sourceSha256:'f'.repeat(64)},{terrainEdges:f.edges}),'TERRAIN_BOTTOM_BINDING');
  const reused=structuredClone(f.bottom);reused.leftCorner.source=reused.edge.source;
  rejects(()=>validateTerrainBottomEdges(reused,f.appearance,{terrainEdges:f.edges}),'TERRAIN_BOTTOM_SOURCE_REUSE');
  const stale=structuredClone(f.bottom);stale.edge.source.sha256='f'.repeat(64);
  rejects(()=>validateTerrainBottomEdges(stale,f.appearance,{terrainEdges:f.edges,readAsset:p=>f.files.get(p)}),'TERRAIN_BOTTOM_CHECKSUM');
  const mismatch=structuredClone(f.bottom);mismatch.leftCorner.innerX++;
  rejects(()=>validateTerrainBottomEdges(mismatch,f.appearance,{terrainEdges:f.edges}),'TERRAIN_BOTTOM_CORNER');
  const warp=structuredClone(f.bottom);warp.edge.scale={numerator:2,denominator:1};
  rejects(()=>validateTerrainBottomEdges(warp,f.appearance,{terrainEdges:f.edges}),'TERRAIN_BOTTOM_GEOMETRY');
});

test('a real south union gets one edge sequence with render-only cutback and unchanged material phase',()=>{
  const f=fixture(),cells=new Map([['2,2','terrain.primary'],['3,2','terrain.primary']]),input=compileTerrainUnionMaterial({
    gridTerrains:compileGridTerrainFields(cells,{grid,appearance:f.appearance,layerId:'ground'}),curveTerrains:[],appearance:f.appearance,grid});
  input.gridTerrains[0].edgeMeshes=[{materialKey:'left.wall',positions:[128,128,130,128,128,130],uvs:[0,0,1,0,0,1],indices:[0,1,2]}];const before=structuredClone(input);
  const result=compileTerrainBottomEdges({...input,bottomEdges:f.bottom,terrainEdges:f.edges,world,grid,cells});
  assert.equal(result.report.placed.length,1);assert.deepEqual(result.report.placed[0].ownerIds,['grid-field/2,2']);
  assert.equal(result.report.placed[0].leftCornerApplied,true);assert.equal(result.report.placed[0].rightCornerApplied,true);
  const a=result.gridTerrains[0],b=input.gridTerrains[0];for(const key of ['cap','capBands','materialMapping','source','bounds'])assert.deepEqual(a[key],b[key]);
  assert(!covers(a.body,180.25,189.25),'the original rectangular body must not fill native lower contour recesses');
  assert(covers(a.body,180.25,184.25),'the checked inner collar retains two-world body underlap');
  for(let i=0;i<a.body.positions.length;i++)assert.equal(a.body.uvs[i],a.body.positions[i]/(i%2?256:512));
  assert.deepEqual(a.edgeMeshes[0],b.edgeMeshes[0]);assert.deepEqual(input,before);
  assert(meshes(result).some(m=>covers(m,180.25,190.25)),'native bottom paint covers the lower inside');
  assert(meshes(result).some(m=>covers(m,180.25,194.25)),'native original exterior alpha is retained below the boundary');
  for(const m of meshes(result))for(let i=0;i<m.positions.length;i++){
    const item=f.bottom[m.bottomPart],origin=i%2?m.nativeSourceOriginWorld.y:m.nativeSourceOriginWorld.x,dimension=i%2?item.pixelSize.height:item.pixelSize.width;
    assert(Math.abs(m.uvs[i]-(m.positions[i]-origin)/(dimension*.5))<1e-10,'all native UVs preserve original scale without a short-span warp');
  }
});

test('grid/curve above and below contacts bury shared south faces and coalesce aligned author bases',()=>{
  const below=compile([[2,2],[3,2]],[curve('below',128,256,192,320)]);
  assert.equal(below.report.placed.length,1);assert.equal(below.report.placed[0].y,320);
  const above=compile([[2,3],[3,3]],[curve('above',128,256,128,192)]);
  assert.equal(above.report.placed.length,1);assert.equal(above.report.placed[0].y,256);
  const right=compile([[2,2],[2,3]],[curve('right',192,320,128,256)]);
  assert.equal(right.report.placed.length,1);assert.equal(right.report.placed[0].fromX,128);assert.equal(right.report.placed[0].toX,320);
  assert.equal(right.report.placed[0].ownerIds.length,2);assert.equal(right.report.placed[0].sharedAuthorBoundaryRestarts,0);
  const left=compile([[3,2],[3,3]],[curve('left',64,192,128,256)]);
  assert.equal(left.report.placed.length,1);assert.equal(left.report.placed[0].ownerIds.length,2);
});

test('holes, bridges, concave endpoints and diagonal contacts preserve true empty areas',()=>{
  const ring=[];for(let y=2;y<=4;y++)for(let x=2;x<=4;x++)if(x!==3||y!==3)ring.push([x,y]);
  const hole=compile(ring),ceiling=hole.report.placed.find(p=>p.y===192);
  assert.deepEqual([ceiling.fromX,ceiling.toX],[192,256]);assert.equal(ceiling.leftCornerApplied,false);assert.equal(ceiling.rightCornerApplied,false);
  assert(meshes(hole).some(m=>covers(m,224.25,194.25)),'the genuine hole ceiling has a native lower strip');
  assert(!meshes(hole).some(m=>covers(m,224.25,224.25)),'native source may not fill the center of the hole');
  const overhang=compile([[2,2],[3,2],[4,2],[2,3],[2,4]]),ledge=overhang.report.placed.find(p=>p.y===192);
  assert.equal(ledge.leftCornerApplied,false);assert.equal(ledge.rightCornerApplied,true);
  const diagonal=compile([[2,2],[3,3]]);assert.equal(diagonal.report.placed.length,2);assert(diagonal.report.placed.every(p=>p.ownerIds.length===1));
});

test('a gap smaller than the native exterior is clipped before its midpoint and declares the loss instead of inventing alpha',()=>{
  const result=compile([], [curve('upper',128,256,128,192),curve('lower',128,256,200,320)]);
  const upperMeshes=meshes(result).filter(m=>m.unionBottom.y===192);
  assert(upperMeshes.some(m=>covers(m,200.25,194.25)));
  assert(!upperMeshes.some(m=>covers(m,200.25,196.25)),'half of the eight-world air gap remains empty');
  assert(!upperMeshes.some(m=>covers(m,200.25,202.25)),'an upper bottom edge cannot paint the lower solid');
  assert(result.report.halfGapClips>0);
  const short=compile([], [curve('short',128,160,128,192)]);
  assert(meshes(short).every(m=>m.nativeScale.numerator/m.nativeScale.denominator===.5));
});

test('sampled 3x3 occupancy families retain source occupancy and never paint hole centers',()=>{
  const f=fixture();
  for(const mask of [1,2,3,7,9,17,27,45,73,85,127,170,255,273,341,511]){
    const points=Array.from({length:9},(_,i)=>mask&(1<<i)?[i%3+2,Math.floor(i/3)+2]:null).filter(Boolean),result=compile(points,[],f),native=meshes(result);
    for(let y=2;y<=4;y++)for(let x=2;x<=4;x++)if(!points.some(([a,b])=>a===x&&b===y))assert(!native.some(m=>covers(m,x*64+32.25,y*64+32.25)),`mask ${mask} fills ${x},${y}`);
    for(let i=0;i<result.gridTerrains.length;i++)assert.deepEqual(result.gridTerrains[i].source,result.input.gridTerrains[i].source);
    assert(result.report.nativeMeshCount<=TERRAIN_BOTTOM_EDGE_LIMITS.maximumNativeMeshes);assert.equal(result.report.generationCalls,0);
  }
});

test('real source-alpha recesses reveal background in final composition instead of the old rectangular body',()=>{
  const f=fixture(),item=f.bottom.edge,old=inspectPng(f.files.get(item.source.path),{includePixels:true}),rgba=Buffer.from(old.rgba);
  for(let y=38;y<64;y++)for(let x=40;x<50;x++)rgba.fill(0,(y*64+x)*4,(y*64+x)*4+4);
  const bytes=encodeRgbaPng(64,64,rgba);f.files.set(item.source.path,bytes);item.source={...item.source,sha256:hash(bytes),byteLength:bytes.length};
  validateTerrainBottomEdges(f.bottom,f.appearance,{terrainEdges:f.edges,readAsset:p=>f.files.get(p)});
  const r=compile([[2,2],[3,2]],[],f),width=384,height=256,pixels=Buffer.alloc(width*height*4),background=[12,14,16];
  for(let p=0;p<pixels.length;p+=4)pixels.set([...background,255],p);
  const body={width:2,height:2,rgba:Buffer.from(Array.from({length:4},()=>[210,30,40,255]).flat())};
  for(const owner of [...r.gridTerrains,...r.curveTerrains]){
    paintCoherentMesh(pixels,{width,height},owner.body,body,{topLeftRule:true});
    for(const band of owner.capBands??[])paintCoherentMesh(pixels,{width,height},band,body,{topLeftRule:true,clampV:true,opacity:band.coverageOpacity??1});
    for(const mesh of owner.edgeMeshes??[])paintCoherentMesh(pixels,{width,height},mesh,inspectPng(f.files.get(mesh.source.path),{includePixels:true}),
      {topLeftRule:true,clampU:true,clampV:true,opacity:mesh.coverageOpacity??1});
  }
  const rgb=(x,y)=>[...pixels.subarray((y*width+x)*4,(y*width+x)*4+3)];
  assert.deepEqual(rgb(180,189),background,'the original inward notch must survive final source-over');
  assert.notDeepEqual(rgb(174,189),background,'neighboring original bottom paint must remain present');
  assert.deepEqual(rgb(180,185),[40,100,180],'the opaque native joining collar remains above the recess');
  assert.deepEqual(f.files.get(item.source.path),bytes,'compile may not patch source alpha or visible RGB');
});

test('bottom cutback preserves rigid rational body period and world origin',()=>{
  const f=fixture(),cells=new Map([['2,2','terrain.primary'],['3,2','terrain.primary']]),input=compileTerrainUnionMaterial({
    gridTerrains:compileGridTerrainFields(cells,{grid,appearance:f.appearance,layerId:'ground'}),curveTerrains:[],appearance:f.appearance,grid});
  const owner=input.gridTerrains[0],period=40960/253,origin=18688/253;
  Object.assign(owner.materialMapping,{bodyMapping:'fixed-world-rigid-row-repeat-v1',bodyPeriod:{width:512,height:period},bodyOriginWorldY:{numerator:18688,denominator:253}});
  owner.body.uvs=owner.body.positions.map((p,i)=>(p-(i%2?origin:0))/(i%2?period:512));
  const result=compileTerrainBottomEdges({...input,bottomEdges:f.bottom,terrainEdges:f.edges,world,grid,cells}),body=result.gridTerrains[0].body;
  for(let i=0;i<body.positions.length;i++)assert.equal(body.uvs[i],(body.positions[i]-(i%2?origin:0))/(i%2?period:512));
  assert.equal(result.report.bodyGeometryChanged,true);assert.equal(result.report.bodyUvChanged,false);
});

test('native lower side-corner overhangs respect the midpoint of a narrow horizontal gap',()=>{
  const result=compile([], [curve('left',128,192,128,192),curve('right',200,264,128,192)]);
  assert(!meshes(result).some(m=>covers(m,196.25,190.25)),'the middle of the eight-world side gap must stay unpainted');
  assert(result.report.halfGapClips>0);
});

test('a validated small native repeat rejects its interval budget before allocating repeat origins',()=>{
  const f=fixture();
  for(const side of ['left','right'])for(const part of ['wall','corner'])f.edges[side][part].innerX=side==='left'?22:26;
  Object.assign(f.bottom.edge,{scale:{numerator:1,denominator:512},repeatX:{from:8,to:16}});
  for(const [index,key]of ['leftCorner','rightCorner'].entries()){
    const item=f.bottom[key],width=2048,height=64,rgba=Buffer.alloc(width*height*4);
    for(let y=2;y<62;y++)for(let x=2;x<2046;x++)rgba.set([90+index*50,100,180,255],(y*width+x)*4);
    const bytes=encodeRgbaPng(width,height,rgba);f.files.set(item.source.path,bytes);
    Object.assign(item,{source:{...item.source,sha256:hash(bytes),byteLength:bytes.length},pixelSize:{width,height},scale:{numerator:1,denominator:512},
      ...(key==='leftCorner'?{boundaryX:16,innerX:1552,stripStartX:1554}:{boundaryX:2032,innerX:496,stripStartX:494})});
  }
  validateTerrainBottomEdges(f.bottom,f.appearance,{terrainEdges:f.edges,readAsset:p=>f.files.get(p)});
  const source=curve('wide',0,4096,128,192),before=structuredClone(source);
  rejects(()=>compileTerrainBottomEdges({gridTerrains:[],curveTerrains:[source],bottomEdges:f.bottom,terrainEdges:f.edges,
    world:{x:0,y:0,width:4096,height:512},grid,cells:new Map()}),'TERRAIN_BOTTOM_BUDGET');
  assert.deepEqual(source,before,'a budget failure cannot partially alter an input map');
});

test('the explicit v2 native envelope keeps 2172x724 source bytes and scale while v1 still rejects that size',()=>{
  const f=fixture(),legacy=structuredClone(f.bottom),oldSources=new Map([...f.files].map(([p,b])=>[p,Buffer.from(b)])),
    before=compile([[2,2],[3,2]],[],f),width=2172,height=724,rgba=Buffer.alloc(width*height*4);
  // The extra dimensions are native transparent canvas, not an upscale. The
  // original visible pixels and joining coordinates remain in source space.
  for(let y=2;y<62;y++)for(let x=2;x<width-2;x++)rgba.set([40+x%16,100,180,255],(y*width+x)*4);
  const bytes=encodeRgbaPng(width,height,rgba),path='bottom/native-wide-edge.png',nativeSha=hash(bytes);f.files.set(path,bytes);
  const wide=structuredClone(legacy);Object.assign(wide.edge,{source:{path,sha256:nativeSha,byteLength:bytes.length},pixelSize:{width,height},repeatX:{from:64,to:2108}});
  rejects(()=>validateTerrainBottomEdges(wide,f.appearance,{terrainEdges:f.edges,readAsset:p=>f.files.get(p)}),'TERRAIN_BOTTOM_GEOMETRY');
  Object.assign(wide,{format:'ai_scene_terrain_bottom_edges_v2',profile:TERRAIN_BOTTOM_EDGE_PROFILE_V2,nativeSizeProfile:TERRAIN_BOTTOM_NATIVE_SIZE_PROFILE,
    renderEnvelopeProfile:TERRAIN_BOTTOM_RENDER_ENVELOPE_PROFILE});
  const record=structuredClone(wide),review=validateTerrainBottomEdges(wide,f.appearance,{terrainEdges:f.edges,readAsset:p=>f.files.get(p)});
  assert.deepEqual(validateDocument('ai_scene_terrain_bottom_edges_v2',wide),[]);
  assert.equal(review.nativeSizeProfile,'bounded-native-4m-v1');assert.equal(review.limits.maximumSourceDimension,4096);
  assert.equal(review.limits.maximumSourcePixels,4194304);assert.deepEqual(wide,record);assert.deepEqual(wide.edge.scale,legacy.edge.scale);
  const result=compile([[2,2],[3,2]],[],{...f,bottom:wide});
  assert.equal(result.report.format,'ai_scene_terrain_bottom_edge_placement_v2');assert.equal(result.report.profile,TERRAIN_BOTTOM_EDGE_PROFILE_V2);
  assert.equal(result.report.nativeSizeProfile,TERRAIN_BOTTOM_NATIVE_SIZE_PROFILE);assert.equal(result.report.limits.maximumSourceDimension,4096);
  assert.deepEqual(f.files.get(path),bytes);assert.equal(hash(f.files.get(path)),nativeSha);
  for(const [p,b]of oldSources)assert.deepEqual(f.files.get(p),b,'legacy source bytes cannot be rewritten by a new envelope');
  const replay=compile([[2,2],[3,2]],[],{...f,bottom:legacy});assert.deepEqual(replay.report,before.report);assert.deepEqual(replay.gridTerrains,before.gridTerrains);
  assert.equal(TERRAIN_BOTTOM_EDGE_LIMITS.maximumSourceDimension,2048);assert.equal(TERRAIN_BOTTOM_EDGE_LIMITS_V2.maximumSourceDimension,4096);
  assert.equal(Object.hasOwn(replay.report,'nativeSizeProfile'),false);
});

test('v2 size declarations cannot weaken the four-million-pixel budget or actual coordinate bounds',()=>{
  const f=fixture(),wide={...structuredClone(f.bottom),format:'ai_scene_terrain_bottom_edges_v2',profile:TERRAIN_BOTTOM_EDGE_PROFILE_V2,
    nativeSizeProfile:TERRAIN_BOTTOM_NATIVE_SIZE_PROFILE,renderEnvelopeProfile:TERRAIN_BOTTOM_RENDER_ENVELOPE_PROFILE};
  const missing=structuredClone(wide);delete missing.nativeSizeProfile;
  rejects(()=>validateTerrainBottomEdges(missing,f.appearance,{terrainEdges:f.edges}),'TERRAIN_BOTTOM_PROFILE');
  const missingEnvelope=structuredClone(wide);delete missingEnvelope.renderEnvelopeProfile;
  rejects(()=>validateTerrainBottomEdges(missingEnvelope,f.appearance,{terrainEdges:f.edges}),'TERRAIN_BOTTOM_PROFILE');
  assert(validateDocument('ai_scene_terrain_bottom_edges_v2',missingEnvelope).length>0);
  rejects(()=>validateTerrainBottomEdges({...wide,renderEnvelopeProfile:'discard-alpha-below-eight'},f.appearance,{terrainEdges:f.edges}),'TERRAIN_BOTTOM_PROFILE');
  rejects(()=>validateTerrainBottomEdges({...wide,nativeSizeProfile:'arbitrary-resize'},f.appearance,{terrainEdges:f.edges}),'TERRAIN_BOTTOM_PROFILE');
  rejects(()=>validateTerrainBottomEdges({...f.bottom,nativeSizeProfile:TERRAIN_BOTTOM_NATIVE_SIZE_PROFILE},f.appearance,{terrainEdges:f.edges}),'TERRAIN_BOTTOM_PROFILE');
  let reads=0;const tooMany=structuredClone(wide);tooMany.edge.pixelSize={width:4096,height:1025};
  rejects(()=>validateTerrainBottomEdges(tooMany,f.appearance,{terrainEdges:f.edges,readAsset:()=>{reads++;return null;}}),'TERRAIN_BOTTOM_GEOMETRY');
  assert.equal(reads,0,'over-budget dimensions must be rejected before decoding PNG bytes');
  const tooWide=structuredClone(wide);tooWide.edge.pixelSize={width:4097,height:32};
  rejects(()=>validateTerrainBottomEdges(tooWide,f.appearance,{terrainEdges:f.edges}),'TERRAIN_BOTTOM_GEOMETRY');
  const outside=structuredClone(wide);outside.edge.repeatX.to=4095;
  rejects(()=>validateTerrainBottomEdges(outside,f.appearance,{terrainEdges:f.edges}),'TERRAIN_BOTTOM_REPEAT');
});

test('only explicit v2 measures alpha-eight contours while preserving weak native RGBA and disclosing out-of-window tails',()=>{
  const f=fixture(),item=f.bottom.edge,width=64,height=128,rgba=Buffer.alloc(width*height*4),old=inspectPng(f.files.get(item.source.path),{includePixels:true});
  old.rgba.copy(rgba);
  for(const [from,to]of [[67,70],[94,99]])for(let y=from;y<to;y++)for(let x=43;x<46;x++)rgba.set([200,80,20,4],(y*width+x)*4);
  const bytes=encodeRgbaPng(width,height,rgba);f.files.set(item.source.path,bytes);Object.assign(item,{pixelSize:{width,height},source:{...item.source,sha256:hash(bytes),byteLength:bytes.length}});
  rejects(()=>validateTerrainBottomEdges(f.bottom,f.appearance,{terrainEdges:f.edges,readAsset:p=>f.files.get(p)}),'TERRAIN_BOTTOM_OUTWARD');
  const v2={...structuredClone(f.bottom),format:'ai_scene_terrain_bottom_edges_v2',profile:TERRAIN_BOTTOM_EDGE_PROFILE_V2,
    nativeSizeProfile:TERRAIN_BOTTOM_NATIVE_SIZE_PROFILE,renderEnvelopeProfile:TERRAIN_BOTTOM_RENDER_ENVELOPE_PROFILE};
  const review=validateTerrainBottomEdges(v2,f.appearance,{terrainEdges:f.edges,readAsset:p=>f.files.get(p)}),source=review.sources.find(s=>s.key==='edge');
  assert.deepEqual(source.nativeOutwardWorld,{x:0,y:25.5});assert.deepEqual(source.nativeVisibleOutwardWorld,{x:0,y:7});
  assert.deepEqual(source.nativeRenderEnvelope.nativeAlphaBbox,{left:2,top:2,right:62,bottom:99});
  assert.deepEqual(source.nativeRenderEnvelope.visibleAlphaBbox,{left:2,top:2,right:62,bottom:62});
  assert.deepEqual(source.nativeRenderEnvelope.weakTailOutsideEnvelope,{measurement:'source-pixel-centers-outside-fixed-outward-window',pixelCount:15,
    alphaSum:60,maximumAlpha:4,belowPixelCount:15,sidePixelCount:0});
  assert.equal(source.nativeRenderEnvelope.sourcePixelsRemoved,0);assert.equal(source.nativeRenderEnvelope.nativeAlphaChanged,false);
  const result=compile([[2,2],[3,2]],[],{...f,bottom:v2}),native=meshes(result),viewport={width:384,height:256},pixels=Buffer.alloc(384*256*4);
  for(const mesh of native)paintCoherentMesh(pixels,viewport,mesh,inspectPng(f.files.get(mesh.source.path),{includePixels:true}),
    {topLeftRule:true,clampU:true,clampV:true,opacity:mesh.coverageOpacity??1});
  assert(pixels[(202*384+180)*4]>0,'alpha-four paint inside the sixteen-world window must still render');
  assert(!native.some(m=>m.unionBottom.y===192&&covers(m,180.25,216.25)),'outside weak tails are presentation-clipped by the fixed native window');
  assert.deepEqual(f.files.get(item.source.path),bytes);assert.equal(hash(f.files.get(item.source.path)),v2.edge.source.sha256);
  const strong=Buffer.from(rgba);strong[(96*64+44)*4+3]=8;const strongBytes=encodeRgbaPng(width,height,strong);
  f.files.set(item.source.path,strongBytes);const rejectStrong=structuredClone(v2);rejectStrong.edge.source={...rejectStrong.edge.source,sha256:hash(strongBytes),byteLength:strongBytes.length};
  rejects(()=>validateTerrainBottomEdges(rejectStrong,f.appearance,{terrainEdges:f.edges,readAsset:p=>f.files.get(p)}),'TERRAIN_BOTTOM_OUTWARD');
});
