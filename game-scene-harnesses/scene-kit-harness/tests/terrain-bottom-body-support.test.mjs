import test from 'node:test';
import assert from 'node:assert/strict';
import {compileGridTerrainFields} from '../src/grid-terrain.mjs';
import {compileCurveGeometry} from '../src/curves.mjs';
import {compileTerrainUnionMaterial} from '../src/terrain-union-material.mjs';
import {compileTerrainUnionEdges,validateTerrainEdges,buildTerrainEdgeJunctions} from '../src/terrain-edges.mjs';
import {compileTerrainBottomEdges,validateTerrainBottomEdges,captureTerrainBottomBodySupport,TERRAIN_BOTTOM_BODY_SUPPORT_PROFILE as support,
 TERRAIN_BOTTOM_THIN_PLATFORM_TOP_PROFILE as thinTop,TERRAIN_BOTTOM_ADAPTIVE_COVERAGE_PROFILE as adaptive,
 TERRAIN_BOTTOM_EDGE_LIMITS as limits} from '../src/terrain-bottom-edges.mjs';
import {encodeRgbaPng,inspectPng} from '../src/png.mjs';
import {renderCoherentFrame} from '../src/coherent-render.mjs';
import {hash} from '../src/generation/common.mjs';
import {canonicalJson} from '../src/document.mjs';

const grid={width:64,height:64},world={x:0,y:0,width:512,height:512},background=[29,43,59];
const rejects=(fn,code)=>assert.throws(fn,e=>e.errors?.some(i=>i.code===code));
// A deliberately irregular transparent native fixture. Its thin joining
// collars are legal, but its lower contour leaves real gaps *inside* an
// authored rectangle after the old planar body cutback. No theme artwork.
function fixture(){
 const files=new Map(),asset=(path,w,h,color)=>{const rgba=Buffer.alloc(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++)rgba.set(color(x,y),(y*w+x)*4);
  const bytes=encodeRgbaPng(w,h,rgba);files.set(path,bytes);return {source:{path,sha256:hash(bytes),byteLength:bytes.length},pixelSize:{width:w,height:h}};},
 body=asset('body.png',16,128,(x,y)=>[50+x,75+y%13,110,255]),cap=asset('cap.png',16,128,(_,y)=>[140,180+(y%15),205,255]),
 appearance={format:'ai_scene_continuous_terrain_appearance_v6',sourceSha256:'a'.repeat(64),surfaceMappingSha256:'b'.repeat(64),body,cap,
  surfaceOriginInBodyPixels:{numerator:-120,denominator:1},capDepth:{numerator:64,denominator:1},capUvEnd:{numerator:1,denominator:1}},
 binding={materialSourceSha256:appearance.sourceSha256,surfaceMappingSha256:appearance.surfaceMappingSha256},
 edges={format:'ai_scene_terrain_edges_v6',profile:'curve-vertical-exposed-native-v1',sourceBinding:binding,gridProfile:'grid-solid-union-native-v1',
  joinProfile:'native-near-opaque-underlap-v1',materialProfile:'union-world-body-local-surface-v1',sideTerminationProfile:'exposed-side-only-v1',
  surfaceInterface:{profile:'world-body-native-lip-v1',capSourceSha256:cap.source.sha256,capEndRow:20,fadeRows:4}},
 bottom={format:'ai_scene_terrain_bottom_edges_v2',profile:'native-horizontal-bottom-union-v2',sourceBinding:binding,
  nativeSizeProfile:'bounded-native-4m-v1',renderEnvelopeProfile:'visible-alpha8-outward16-native-rgba-v1',junctionProfile:adaptive};
 for(const side of ['left','right']){const left=side==='left';edges[side]={};
  for(const part of ['wall','corner'])edges[side][part]={...asset(side+'-'+part+'.png',160,256,(x,y)=>x>=2&&x<158&&y>=2&&y<254
   ?[left?42:56,66,part==='corner'?105:95,255]:[0,0,0,0]),scale:{numerator:1,denominator:2},boundaryX:left?32:128,innerX:left?112:48,
   inboardBlend:{fromX:left?116:44,toX:left?132:28},...(part==='wall'?{repeatY:{from:96,to:240}}:{surfaceY:16,wallStartY:200})};
 }
 edges.junctions=buildTerrainEdgeJunctions(edges,{readAsset:p=>files.get(p)});
 bottom.edge={...asset('lower.png',160,128,(x,y)=>x>=2&&x<158&&y>=2&&y<124&&!(y>=86&&x>=16&&x<40)?[60,150,130,255]:[0,0,0,0]),
  scale:{numerator:1,denominator:2},boundaryY:96,innerY:40,repeatX:{from:16,to:144},inboardBlend:{fromY:40,toY:24}};
 for(const [i,key]of ['leftCorner','rightCorner'].entries())bottom[key]={...asset(key+'.png',160,256,(x,y)=>{
  const painted=x>=2&&x<158&&y>=2&&y<254,irregular=y>=202&&(i?x>56:x<104);
  return painted&&!irregular?[155+i*20,91+i*15,45,255]:[0,0,0,0];}),scale:{numerator:1,denominator:2},
  boundaryX:i?128:32,innerX:i?48:112,stripStartX:i?32:128,wallStartY:104,boundaryY:224,innerY:168,inboardBlend:{fromY:168,toY:152}};
 validateTerrainEdges(edges,appearance,{readAsset:p=>files.get(p)});validateTerrainBottomEdges(bottom,appearance,{terrainEdges:edges,readAsset:p=>files.get(p)});
 return {files,appearance,edges,bottom};
}
function compile(f,points,{enabled=false,protectTop=false,curves=[]}={}){
 const cells=new Map(points.map(([x,y])=>[x+','+y,'terrain.primary'])),material=compileTerrainUnionMaterial({
  gridTerrains:compileGridTerrainFields(cells,{grid,appearance:f.appearance,layerId:'ground'}),curveTerrains:curves,appearance:f.appearance,grid,
  surfaceInterface:f.edges.surfaceInterface,bottomCoverageProfile:adaptive}),
  snapshot=enabled?captureTerrainBottomBodySupport({...material,profile:support}):undefined,
  sides=compileTerrainUnionEdges(material.gridTerrains,material.curveTerrains,f.edges,{world,grid,cells}),
  args={gridTerrains:sides.gridTerrains,curveTerrains:sides.curves,bottomEdges:{...f.bottom,...(enabled?{bodySupportProfile:support}:{}),
   ...(protectTop?{thinPlatformTopProfile:thinTop}:{})},terrainEdges:f.edges,world,grid,cells,
   ...(snapshot?{interiorBodySupport:snapshot}:{})},result=compileTerrainBottomEdges(args);
 return {result,args,material,snapshot};
}
const owners=r=>[...r.gridTerrains,...r.curveTerrains];
function render(f,r){const bytes=renderCoherentFrame({defaultCamera:{center:{x:256,y:256},viewport:{width:512,height:512}},
 layers:[{layerId:'ground',visible:true,nodes:[]}],gridTerrains:r.gridTerrains,curveTerrains:r.curveTerrains,terrainMaterial:f.appearance},p=>f.files.get(p)),
 png=inspectPng(bytes,{includePixels:true});return {bytes,rgb:(x,y)=>[...png.rgba.subarray((y*512+x)*4,(y*512+x)*4+3)]};}
function covers(m,x,y){for(let i=0;i<m.indices.length;i+=3){const [a,b,c]=m.indices.slice(i,i+3).map(n=>({x:m.positions[n*2],y:m.positions[n*2+1]})),
 d=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);if(Math.abs(d)<1e-10)continue;
 const u=((b.y-c.y)*(x-c.x)+(c.x-b.x)*(y-c.y))/d,v=((c.y-a.y)*(x-c.x)+(a.x-c.x)*(y-c.y))/d;if(Math.min(u,v,1-u-v)>1e-7)return true;}return false;}

test('explicit author-solid support repairs generic native lower recesses without modifying source or any exterior pixel',()=>{
 const f=fixture(),raws=new Map([...f.files].map(([p,b])=>[p,Buffer.from(b)])),legacy=compile(f,[[2,2]]),selected=compile(f,[[2,2]],{enabled:true}),
 a=render(f,legacy.result),b=render(f,selected.result);
 assert.deepEqual(a.rgb(130,189),background,'legal native collars do not cover the old planar-cutback interior');
 assert.notDeepEqual(b.rgb(130,189),background,'pre-side author body backs the lower corner inside its solid');
 assert.notDeepEqual(b.rgb(160,189),background,'the middle lower source recess is also backed');
 for(let y=0;y<512;y++)for(let x=0;x<512;x++)if(x<128||x>=192||y<128||y>=192)assert.deepEqual(b.rgb(x,y),a.rgb(x,y),'new support never paints an author-exterior pixel');
 for(const [path,bytes]of raws)assert.deepEqual(f.files.get(path),bytes);
 assert.equal(selected.result.report.bodySupportProfile,support);assert(selected.result.report.bodySupport.outputTriangles>0);
 assert.equal(selected.result.report.bodySupport.exteriorSupport,false);
 for(const owner of owners(selected.result))for(let i=0;i<owner.body.positions.length;i++)assert(Math.abs(owner.body.uvs[i]-owner.body.positions[i]/(i%2?256:512))<1e-9,'world UVs retain their original phase and physical scale');
 assert(!Object.hasOwn(legacy.result.report,'bodySupport'));
});

test('support follows true exposed union south spans, stays out of caves and shared internal boundaries, and clips to sampled curve solids',()=>{
 const f=fixture(),ring=[];for(let y=2;y<=4;y++)for(let x=2;x<=4;x++)if(x!==3||y!==3)ring.push([x,y]);
 const cases=[ring,[[2,2],[3,2],[4,2],[2,3],[4,3],[2,4],[4,4]],[[2,2],[2,3]]];
 for(const points of cases){const compiled=compile(f,points,{enabled:true}),image=render(f,compiled.result),cells=new Set(points.map(p=>p.join(',')));
  if(points.length>2)assert.deepEqual(image.rgb(224,224),background,'inside-author backing cannot fill a cave or bridge void');
  for(const owner of owners(compiled.result))for(let y=120;y<330;y+=8)for(let x=120;x<330;x+=8)if(covers(owner.body,x+.25,y+.25))
   assert(cells.has(Math.floor(x/64)+','+Math.floor(y/64)),'support body remains inside the original author cells');
  if(points.length===2)assert.deepEqual(compiled.result.report.placed.map(r=>r.y),[256],'adjacent vertical cells get one exposed bottom, no internal support stripe');
 }
 const curve={...compileCurveGeometry({curveId:'slope',familyId:'terrain.primary',baseY:192,points:[{x:128,y:180,slope:0},{x:256,y:128,slope:0}]},8),layerId:'ground'},
  curved=compile(f,[],{enabled:true,curves:[curve]});
 for(const owner of curved.result.curveTerrains)for(let y=120;y<210;y+=4)for(let x=128;x<256;x+=4)if(covers(owner.body,x+.25,y+.25)){
  const top=curve.surface.findLast(p=>p.x<=x+.25),next=curve.surface.find(p=>p.x> x+.25),height=next?top.y+(next.y-top.y)*(x+.25-top.x)/(next.x-top.x):top.y;
  assert(y+.25>=height-1e-6&&y+.25<=192,'source mapped triangles prevent support from filling air above a sampled sloping surface');
 }
});

test('selection and support snapshots remain explicit and bounded while absent-profile full output stays fixed',()=>{
 const f=fixture(),points=[[2,2],[3,2]],baseline=compile(f,points),same=compile(f,points),selected=compile(f,points,{enabled:true});
 assert.equal(hash(canonicalJson(same.result)),hash(canonicalJson(baseline.result)));
 assert.equal(hash(canonicalJson(compile(f,points).result)),hash(canonicalJson(baseline.result)),'an opt-in compile cannot mutate later legacy output');
 const owned=structuredClone(selected.args);
 const reused=compileTerrainBottomEdges(owned,{ownedMeshes:true});
 assert.equal(reused.gridTerrains,owned.gridTerrains);
 assert.deepEqual(reused,selected.result);
 rejects(()=>compileTerrainBottomEdges({...selected.args,interiorBodySupport:undefined}),'TERRAIN_BOTTOM_BODY_SUPPORT_INPUT');
 rejects(()=>compileTerrainBottomEdges({...baseline.args,interiorBodySupport:selected.snapshot}),'TERRAIN_BOTTOM_BODY_SUPPORT_INPUT');
 rejects(()=>validateTerrainBottomEdges({...f.bottom,bodySupportProfile:'fill-everything'},f.appearance,{terrainEdges:f.edges}),'TERRAIN_BOTTOM_BODY_SUPPORT_PROFILE');
 const wrong=structuredClone(selected.snapshot);wrong.owners[0].ownerId='unrelated';rejects(()=>compileTerrainBottomEdges({...selected.args,interiorBodySupport:wrong}),'TERRAIN_BOTTOM_BODY_SUPPORT_INPUT');
 const huge={gridTerrainId:'huge',body:{positions:[0,0,1,0,1,1],uvs:[0,0,1,0,1,1],indices:Array((limits.maximumOutputTriangles+1)*3).fill(0)}};
 rejects(()=>captureTerrainBottomBodySupport({gridTerrains:[huge],curveTerrains:[],profile:support}),'TERRAIN_BOTTOM_BUDGET');
});

test('a thin isolated flat curve keeps its original central and inboard corner top cover without altering the bottom or exterior',()=>{
 const f=fixture(),curve={...compileCurveGeometry({curveId:'thin',familyId:'terrain.primary',baseY:152,
   points:[{x:128,y:128,slope:0},{x:320,y:128,slope:0}]},8),layerId:'ground'};
 const old=compile(f,[],{enabled:true,curves:[curve]}),next=compile(f,[],{enabled:true,protectTop:true,curves:[curve]});
 const a=old.result.curveTerrains[0],b=next.result.curveTerrains[0],before=render(f,old.result),after=render(f,next.result);
 assert.equal(a.topCoverBands.length,0);
 assert.deepEqual(b.topCoverBands,next.args.curveTerrains[0].topCoverBands);
 assert(b.topCoverBands.length>0);
 assert.deepEqual(b.edgeMeshes,a.edgeMeshes);
 assert.deepEqual(b.body,a.body);
 assert.deepEqual(b.surface,a.surface);
 assert.deepEqual(b.contour,a.contour);
 assert.notDeepEqual(after.rgb(224,129),before.rgb(224,129),'center cap returns');
 assert.notDeepEqual(after.rgb(133,129),before.rgb(133,129),'inboard upper corner returns');
 for(let y=0;y<512;y++)for(let x=0;x<512;x++)
  if(x<128||x>=320||y<128||y>=152)assert.deepEqual(after.rgb(x,y),before.rgb(x,y),'no new exterior paint');
 assert.deepEqual(next.result.report.retainedThinPlatformTops.map(p=>p.ownerId),['thin']);
 assert.equal(next.result.report.nativeMeshCount,old.result.report.nativeMeshCount);
 const attached=[[1,2]],sloped={...compileCurveGeometry({curveId:'sloped',familyId:'terrain.primary',baseY:152,
   points:[{x:128,y:130,slope:0},{x:320,y:128,slope:0}]},8),layerId:'ground'};
 for(const [points,curves] of [[attached,[curve]],[[],[sloped]]]){
  const standard=compile(f,points,{enabled:true,curves}).result;
  const selected=compile(f,points,{enabled:true,protectTop:true,curves}).result;
  assert.deepEqual(selected.report.retainedThinPlatformTops,[]);
  assert.deepEqual(selected.gridTerrains,standard.gridTerrains);
  assert.deepEqual(selected.curveTerrains,standard.curveTerrains);
 }
});
