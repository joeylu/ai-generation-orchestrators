import test from 'node:test';
import assert from 'node:assert/strict';
import {compileGridTerrainFields} from '../src/grid-terrain.mjs';
import {compileCurveGeometry} from '../src/curves.mjs';
import {compileTerrainUnionMaterial} from '../src/terrain-union-material.mjs';
import {compileTerrainUnionEdges,validateTerrainEdges,buildTerrainEdgeJunctions} from '../src/terrain-edges.mjs';
import {compileTerrainBottomEdges,validateTerrainBottomEdges,TERRAIN_BOTTOM_JUNCTION_PROFILE,
  TERRAIN_BOTTOM_ADAPTIVE_COVERAGE_PROFILE as adaptive} from '../src/terrain-bottom-edges.mjs';
import {encodeRgbaPng,inspectPng} from '../src/png.mjs';
import {renderCoherentFrame} from '../src/coherent-render.mjs';
import {hash} from '../src/generation/common.mjs';
import {canonicalJson} from '../src/document.mjs';
import {validateDocument} from '../src/schema.mjs';
const grid={width:64,height:64},world={x:0,y:0,width:512,height:512},background=[29,43,59];
function fixture(palette='snow',profile=adaptive){
  const files=new Map(),colors=palette==='snow'?{cap:[218,238,252],body:[73,83,105],lower:[155,91,45]}
    :{cap:[18,235,217],body:[72,79,85],lower:[192,96,28]};
  const asset=(path,width,height,color)=>{const rgba=Buffer.alloc(width*height*4);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)rgba.set(color(x,y),(y*width+x)*4);
    const bytes=encodeRgbaPng(width,height,rgba);files.set(path,bytes);
    return {source:{path,sha256:hash(bytes),byteLength:bytes.length},pixelSize:{width,height}};};
  const body=asset('body.png',16,128,(_,y)=>[...colors.body.map(c=>c+y%5),255]),
    cap=asset('cap.png',16,128,(_,y)=>[...(y<40?colors.cap:[110,126,142]),255]),
    appearance={format:'ai_scene_continuous_terrain_appearance_v6',sourceSha256:'a'.repeat(64),surfaceMappingSha256:'b'.repeat(64),body,cap,
      surfaceOriginInBodyPixels:{numerator:-120,denominator:1},capDepth:{numerator:64,denominator:1},capUvEnd:{numerator:1,denominator:1}},
    binding={materialSourceSha256:appearance.sourceSha256,surfaceMappingSha256:appearance.surfaceMappingSha256},
    edges={format:'ai_scene_terrain_edges_v6',profile:'curve-vertical-exposed-native-v1',sourceBinding:binding,
      gridProfile:'grid-solid-union-native-v1',joinProfile:'native-near-opaque-underlap-v1',materialProfile:'union-world-body-local-surface-v1',
      sideTerminationProfile:'exposed-side-only-v1',surfaceInterface:{profile:'world-body-native-lip-v1',capSourceSha256:cap.source.sha256,capEndRow:128,fadeRows:24}},
    bottom={format:'ai_scene_terrain_bottom_edges_v2',profile:'native-horizontal-bottom-union-v2',sourceBinding:binding,
      nativeSizeProfile:'bounded-native-4m-v1',renderEnvelopeProfile:'visible-alpha8-outward16-native-rgba-v1',junctionProfile:profile};
  for(const side of ['left','right']){
    const left=side==='left';edges[side]={};
    for(const part of ['wall','corner'])edges[side][part]={...asset(`${palette}-${side}-${part}.png`,160,256,(x,y)=>x>=2&&x<158&&y>=2&&y<254
      ?[...(part==='corner'&&y<56?colors.cap:[35+(left?7:21),66,95+(part==='corner'?10:0)]),255]:[0,0,0,0]),scale:{numerator:1,denominator:2},boundaryX:left?32:128,innerX:left?112:48,
      inboardBlend:{fromX:left?116:44,toX:left?132:28},...(part==='wall'?{repeatY:{from:96,to:240}}:{surfaceY:16,wallStartY:200})};
  }
  edges.junctions=buildTerrainEdgeJunctions(edges,{readAsset:p=>files.get(p)});
  bottom.edge={...asset(`${palette}-lower-edge.png`,160,128,(x,y)=>x>=2&&x<158&&y>=2&&y<124?[60,150,130,255]:[0,0,0,0]),
    scale:{numerator:1,denominator:2},boundaryY:96,innerY:40,repeatX:{from:16,to:144},inboardBlend:{fromY:40,toY:24}};
  for(const [i,key]of ['leftCorner','rightCorner'].entries())bottom[key]={...asset(`${palette}-${key}.png`,160,256,(x,y)=>x>=2&&x<158&&y>=2&&y<254
    ?[colors.lower[0]+i*20,colors.lower[1]+i*15,colors.lower[2],255]:[0,0,0,0]),scale:{numerator:1,denominator:2},
    boundaryX:i?128:32,innerX:i?48:112,stripStartX:i?32:128,wallStartY:104,
    boundaryY:224,innerY:168,inboardBlend:{fromY:168,toY:152}};
  validateTerrainEdges(edges,appearance,{readAsset:p=>files.get(p)});
  validateTerrainBottomEdges(bottom,appearance,{terrainEdges:edges,readAsset:p=>files.get(p)});
  return {files,colors,appearance,edges,bottom};
}
function compile(f,points,bounds=world){
  const cells=new Map(points.map(([x,y])=>[`${x},${y}`,'terrain.primary'])),preserve=f.bottom.junctionProfile===adaptive,
    material=compileTerrainUnionMaterial({gridTerrains:compileGridTerrainFields(cells,{grid,appearance:f.appearance,layerId:'ground'}),
      curveTerrains:[],appearance:f.appearance,grid,surfaceInterface:f.edges.surfaceInterface,...(preserve?{bottomCoverageProfile:adaptive}:{})}),
    sides=compileTerrainUnionEdges(material.gridTerrains,material.curveTerrains,f.edges,{world:bounds,grid,cells}),
    result=compileTerrainBottomEdges({gridTerrains:sides.gridTerrains,curveTerrains:sides.curves,bottomEdges:f.bottom,terrainEdges:f.edges,world:bounds,grid,cells});
  return {result,material,sides};
}
const owners=r=>[...r.gridTerrains,...r.curveTerrains];
const meshes=r=>owners(r).flatMap(o=>o.edgeMeshes??[]);
function render(f,r){
  const png=renderCoherentFrame({defaultCamera:{center:{x:256,y:256},viewport:{width:512,height:512}},
    layers:[{layerId:'ground',visible:true,nodes:[]}],gridTerrains:r.gridTerrains,curveTerrains:r.curveTerrains,terrainMaterial:f.appearance},p=>f.files.get(p)),
    image=inspectPng(png,{includePixels:true});
  return {png,rgb:(x,y)=>[...image.rgba.subarray((y*512+x)*4,(y*512+x)*4+3)]};
}
function covers(mesh,x,y){
  for(let i=0;i<mesh.indices.length;i+=3){const[a,b,c]=mesh.indices.slice(i,i+3).map(n=>({x:mesh.positions[n*2],y:mesh.positions[n*2+1]})),d=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);
    if(Math.abs(d)<1e-10)continue;const u=((b.y-c.y)*(x-c.x)+(c.x-b.x)*(y-c.y))/d,v=((c.y-a.y)*(x-c.x)+(a.x-c.x)*(y-c.y))/d;
    if(Math.min(u,v,1-u-v)>1e-7)return true;}
  return false;
}

for(const palette of ['snow','industrial'])test(`adaptive ${palette} 64-high source keeps the supported top cover above long native lower arms`,()=>{
  const old=fixture(palette,TERRAIN_BOTTOM_JUNCTION_PROFILE),f=fixture(palette),a=compile(old,[[2,2]]),b=compile(f,[[2,2]]),legacy=render(old,a.result),fixed=render(f,b.result);
  assert.notDeepEqual(legacy.rgb(150,136),old.colors.cap,'legacy reproduces the native lower arm painting over the top cover four world below the surface');
  assert.deepEqual(fixed.rgb(150,136),f.colors.cap,'the original supported high-contrast top paint must draw after all lower native sources');
  assert.deepEqual(fixed.rgb(150,146),f.colors.cap,'ordinary twenty-world cover remains visible on a sixty-four-world high solid');
  assert(owners(b.result).some(o=>o.nativeTopCornerMeshes?.some(m=>covers(m,150.25,160.25)&&m.coverageOpacity<1)),'the original upper corner fades before the native bottom region rather than being cut while opaque');
  assert(!owners(b.result).some(o=>o.topCoverBands?.some(m=>covers(m,150.25,136.25))),'central material cannot refill the original native side ownership');
  assert(!owners(b.result).some(o=>o.topCoverBands?.some(m=>covers(m,150.25,180.25))),'late paint cannot re-fill lower native-alpha recesses');
  assert(!owners(a.result).some(o=>o.topCoverBands),'legacy has no new late paint');
  assert.equal(b.result.report.junctionProfile,adaptive);
});

test('short native corners fade before the half-span end and keep an unchanged-phase horizontal source behind the fade',()=>{
  const f=fixture(),old=fixture('snow',TERRAIN_BOTTOM_JUNCTION_PROFILE),a=compile(old,[[2,2]]).result,b=compile(f,[[2,2]]).result;
  const oldCover=meshes(a).filter(m=>m.bottomPart==='leftCorner'&&covers(m,157.25,189.25)),newCover=meshes(b).filter(m=>m.bottomPart==='leftCorner'&&covers(m,157.25,189.25));
  assert(oldCover.some(m=>m.coverageOpacity===1),'legacy clips the opaque foot arm before its native inward fade');
  assert(newCover.length&&newCover.every(m=>m.coverageOpacity<.5),'the complete lower foot arm now fades before the available half-span ends');
  assert(meshes(b).some(m=>m.bottomPart==='edge'&&covers(m,157.25,189.25)),'the unchanged-scale horizontal source underlies this fade');
  const fade=b.report.adaptiveEndpointFades[0];assert.equal(fade.left.to-fade.left.from,8);
  for(const m of meshes(b).filter(m=>m.part==='bottom'))for(const part of m.coverageGeometryParts??[{firstVertex:0,vertexCount:m.positions.length/2}])
    for(let i=part.firstVertex*2;i<(part.firstVertex+part.vertexCount)*2;i++){
      const item=f.bottom[m.bottomPart],s=item.scale.numerator/item.scale.denominator,phase=part.nativeSourceOriginWorld??m.nativeSourceOriginWorld,
        origin=i%2?phase.y:phase.x,size=i%2?item.pixelSize.height:item.pixelSize.width;
      assert(Math.abs(m.uvs[i]-(m.positions[i]-origin)/(s*size))<1e-9,'coverage may not crop, stretch or restart source UVs');
    }
});

test('long-arm lower corners ramp over the two-world exterior handoff without an opaque Y-plane onset',()=>{
  const f=fixture(),a=compile(f,[[2,2],[2,3],[2,4]]).result,
    lower=meshes(a).filter(m=>m.bottomPart==='leftCorner'&&covers(m,138.27,260.21));
  assert(lower.some(m=>m.coverageOpacity>0&&m.coverageOpacity<1),'the sixty-world lower arm must ramp into the retained side rather than switch on at Y=260');
  assert(a.report.endpointHandoffs.every(h=>h.supportedInteriorRetainedToBottomCutback===true));
});

test('holes and short bridges retain only original-solid top samples and leave real air unpainted',()=>{
  const f=fixture(),ring=[];for(let y=2;y<=4;y++)for(let x=2;x<=4;x++)if(x!==3||y!==3)ring.push([x,y]);
  for(const points of [ring,[[2,2],[3,2],[4,2],[2,3],[4,3],[2,4],[4,4]]]){
    const compiled=compile(f,points).result,r=render(f,compiled);
    assert.deepEqual(r.rgb(224,224),background,'late top paint cannot fill a hole or the bridge opening');
    const cells=new Set(points.map(([x,y])=>`${x},${y}`));
    for(const owner of owners(compiled))for(const band of owner.topCoverBands??[])for(let y=0;y<512;y+=16)for(let x=0;x<512;x+=16)
      if(covers(band,x+.25,y+.25))assert(cells.has(`${Math.floor(x/64)},${Math.floor(y/64)}`),'late paint belongs only to an original solid cell');
    assert(compiled.report.nativeSideExtensions.every(e=>e.phaseReset===false&&e.topFadeWorld===8));
  }
});

test('windowed walls retain only their first native origin for concave bottom underlap',()=>{
  const f=fixture('industrial');
  f.edges.junctions=buildTerrainEdgeJunctions(f.edges,{readAsset:p=>f.files.get(p),wallRepeatProfile:'native-alpha-repeat-window-v1'});
  const bridge=[[2,2],[3,2],[4,2],[2,3],[4,3],[2,4],[4,4]];
  const {result}=compile(f,bridge),r=render(f,result);
  assert.deepEqual(r.rgb(224,224),background);
  assert(result.report.nativeSideExtensions.length>0);
  for(const ext of result.report.nativeSideExtensions){
    const wall=f.edges[ext.side].wall;
    assert.deepEqual(ext.sourceOriginWorldYs,[ext.y-wall.repeatY.from*.5]);
    assert.equal(ext.phaseReset,false);
  }
  const extensions=meshes(result).filter(m=>m.bottomJunction?.kind==='concave-side-underlap');
  assert(extensions.length>0&&extensions.every(m=>m.nativeVerticalRange.toY<=f.edges[m.side].wall.repeatY.from));
});

test('adaptive declarations remain explicit, preserve raw artwork and leave long-span legacy bytes unchanged',()=>{
  const old=fixture('industrial',TERRAIN_BOTTOM_JUNCTION_PROFILE),bytes=new Map([...old.files].map(([p,b])=>[p,Buffer.from(b)])),points=Array.from({length:6},(_,i)=>[i+1,2]),
    before=compile(old,points).result,identity=hash(canonicalJson(before));
  assert.equal(validateDocument('ai_scene_terrain_bottom_edges_v2',fixture().bottom).length,0);
  const adaptiveResult=compile({...old,bottom:{...old.bottom,junctionProfile:adaptive}},points).result;
  assert(adaptiveResult.report.adaptiveCoverage);
  assert.equal(hash(canonicalJson(compile(old,points).result)),identity);
  assert(!Object.hasOwn(before.report,'adaptiveCoverage'));assert(!owners(before).some(o=>o.topCoverBands));
  for(const[p,b]of bytes)assert.deepEqual(old.files.get(p),b,'no original RGBA/PNG normalization, cleanup or repaint occurs');
  assert.throws(()=>validateTerrainBottomEdges({...old.bottom,junctionProfile:'unbounded-auto-repair'},old.appearance,{terrainEdges:old.edges}),
    e=>e.errors?.some(i=>i.code==='TERRAIN_BOTTOM_JUNCTION_PROFILE'));
});

test('adaptive top ownership includes standalone curves and detached curve groups without requiring a native lip option',()=>{
  const f=fixture(),curve={...compileCurveGeometry({curveId:'detached',familyId:'terrain.primary',baseY:192,
    points:[{x:128,y:128,slope:0},{x:192,y:128,slope:0}]},8),layerId:'ground'};
  for(const points of [[],[[5,5]]]){
    const cells=new Map(points.map(([x,y])=>[`${x},${y}`,'terrain.primary'])),input=compileGridTerrainFields(cells,{grid,appearance:f.appearance,layerId:'ground'}),
      material=compileTerrainUnionMaterial({gridTerrains:input,curveTerrains:[curve],appearance:f.appearance,grid,bottomCoverageProfile:adaptive});
    assert(material.curveTerrains[0].topCoverBands.length,'a valid independent curve group must have supported cap samples');
    const result=compileTerrainBottomEdges({...material,bottomEdges:f.bottom,terrainEdges:f.edges,world,grid,cells});
    assert(owners(result).every(o=>Array.isArray(o.topCoverBands)));
    assert.deepEqual(render(f,result).rgb(150,136),f.colors.cap);
    assert.throws(()=>compileTerrainBottomEdges({gridTerrains:input,curveTerrains:[curve],bottomEdges:f.bottom,terrainEdges:f.edges,world,grid,cells}),
      e=>e.errors?.some(i=>i.code==='TERRAIN_BOTTOM_ADAPTIVE_TOP_COVER'));
  }
});

test('late top cover does not refill an artist-transparent recess in the native bottom contour',()=>{
  const f=fixture();
  for(const key of ['edge','leftCorner','rightCorner']){
    const item=f.bottom[key],old=inspectPng(f.files.get(item.source.path),{includePixels:true}),rgba=Buffer.from(old.rgba),
      range=key==='edge'?{x0:16,x1:40,y:86}:key==='leftCorner'?{x0:80,x1:120,y:210}:{x0:40,x1:80,y:210};
    for(let y=range.y;y<old.height;y++)for(let x=range.x0;x<range.x1;x++)rgba.fill(0,(y*old.width+x)*4,(y*old.width+x)*4+4);
    const bytes=encodeRgbaPng(old.width,old.height,rgba);f.files.set(item.source.path,bytes);item.source={...item.source,sha256:hash(bytes),byteLength:bytes.length};
  }
  validateTerrainBottomEdges(f.bottom,f.appearance,{terrainEdges:f.edges,readAsset:p=>f.files.get(p)});
  const r=render(f,compile(f,[[2,2]]).result);
  assert.deepEqual(r.rgb(160,189),background,'the original native-alpha recess stays empty even when the original cap depth nearly spans the whole solid');
  assert.deepEqual(r.rgb(150,146),f.colors.cap,'preserving that lower recess must not erase the ordinary top snow');
});

test('a thick wide solid retains the original complete cap fade exactly once, without double source-over',()=>{
  const points=[];for(let y=2;y<=5;y++)for(let x=1;x<=6;x++)points.push([x,y]);
  const f=fixture(),old=fixture('snow',TERRAIN_BOTTOM_JUNCTION_PROFILE),a=compile(old,points),b=compile(f,points),
    legacy=render(old,a.result),fixed=render(f,b.result);
  for(const y of [178,180,182,184,186,188,190])assert.deepEqual(fixed.rgb(250,y),legacy.rgb(250,y),
    'unchallenged cap fade must blend once over the same world body, not .5 twice to .75');
  const selected=b.result.gridTerrains.find(o=>o.source.gridCells.some(c=>c.x===3&&c.y===2)),
    original=b.sides.gridTerrains.find(o=>o.gridTerrainId===selected.gridTerrainId);
  assert.deepEqual(selected.topCoverBands,original.topCoverBands,'a distant bottom cannot shorten or alter the supported top source');
});

test('late native upper corners keep their source silhouettes and transparent upper recesses without rectangular cap refill',()=>{
  for(const palette of ['snow','industrial']){
    const f=fixture(palette);
    for(const side of ['left','right']){
      const item=f.edges[side].corner,png=inspectPng(f.files.get(item.source.path),{includePixels:true}),rgba=Buffer.from(png.rgba),
        x0=side==='left'?32:104,x1=side==='left'?56:128;
      for(let y=16;y<24;y++)for(let x=x0;x<x1;x++)rgba.fill(0,(y*png.width+x)*4,(y*png.width+x)*4+4);
      const bytes=encodeRgbaPng(png.width,png.height,rgba);f.files.set(item.source.path,bytes);
      item.source={...item.source,sha256:hash(bytes),byteLength:bytes.length};
    }
    f.edges.junctions=buildTerrainEdgeJunctions(f.edges,{readAsset:p=>f.files.get(p)});
    validateTerrainEdges(f.edges,f.appearance,{readAsset:p=>f.files.get(p)});
    const raw=new Map([...f.files].map(([p,b])=>[p,Buffer.from(b)])),compiled=compile(f,[[2,2]]),image=render(f,compiled.result),
      upper=owners(compiled.result).flatMap(o=>o.nativeTopCornerMeshes??[]);
    assert(upper.length&&upper.every(m=>m.part==='corner'&&m.source.sha256===f.edges[m.side].corner.source.sha256));
    assert(!meshes(compiled.result).some(m=>m.part==='corner'),'the original corner may not be drawn early as well as late');
    for(const [x,y]of [[130,129],[190,129]]){
      assert.deepEqual(image.rgb(x,y),background,'real native-alpha upper recesses stay open after the lower arms and central cap');
      assert(!owners(compiled.result).some(o=>o.topCoverBands.some(m=>covers(m,x+.25,y+.25))),
        'logical-solid cap triangles cannot borrow a rectangle over either original artist corner');
    }
    assert.deepEqual(image.rgb(150,146),f.colors.cap,'ordinary twenty-world native snow or industrial trim remains visible');
    for(const owner of owners(compiled.result))for(const m of [owner.body,owner.cap,...owner.capBands??[],...owner.topCoverBands??[],...owner.nativeTopCornerMeshes??[],...owner.edgeMeshes??[]]){
      assert.equal(m.positions.length,m.uvs.length);assert.equal(m.positions.length%2,0);assert.equal(m.indices.length%3,0);
      assert(m.positions.every(Number.isFinite)&&m.uvs.every(Number.isFinite));
      assert(m.indices.every(i=>Number.isSafeInteger(i)&&i>=0&&i<m.positions.length/2));
    }
    assert(compiled.result.report.nativeTopCornerTriangles>0);
    for(const[p,b]of raw)assert.deepEqual(f.files.get(p),b,'render ordering and coverage do not change original source PNG bytes');
  }
});

test('a semi-transparent native upper corner moves to the late group once on a thick solid',()=>{
  const f=fixture(),old=fixture('snow',TERRAIN_BOTTOM_JUNCTION_PROFILE),points=[];
  for(let y=2;y<=5;y++)for(let x=1;x<=6;x++)points.push([x,y]);
  for(const sample of [f,old]){
    const item=sample.edges.left.corner,png=inspectPng(sample.files.get(item.source.path),{includePixels:true}),rgba=Buffer.from(png.rgba);
    for(let y=20;y<54;y++)for(let x=40;x<88;x++)rgba[(y*png.width+x)*4+3]=128;
    const bytes=encodeRgbaPng(png.width,png.height,rgba);sample.files.set(item.source.path,bytes);
    item.source={...item.source,sha256:hash(bytes),byteLength:bytes.length};
    sample.edges.junctions=buildTerrainEdgeJunctions(sample.edges,{readAsset:p=>sample.files.get(p)});
    validateTerrainEdges(sample.edges,sample.appearance,{readAsset:p=>sample.files.get(p)});
  }
  const a=render(old,compile(old,points).result),b=render(f,compile(f,points).result);
  assert.notDeepEqual(b.rgb(80,138),f.colors.cap,'the selected source sample must be partially transparent');
  assert.deepEqual(b.rgb(80,138),a.rgb(80,138),'moving a native corner must preserve its single original source-over opacity');
});

test('a synthetic twenty-five-cell point-contact checker fails explicitly at the unchanged triangle budget after safe draw merging',()=>{
  const f=fixture(),points=[];for(let y=1;y<=5;y++)for(let x=2;x<12;x++)if((x+y)%2===0)points.push([x,y]);
  assert.equal(points.length,25);
  const raw=new Map([...f.files].map(([path,bytes])=>[path,Buffer.from(bytes)])),before=structuredClone(points),bounds={x:0,y:0,width:1024,height:576};
  assert.throws(()=>compile(f,points,bounds),error=>error.errors?.some(e=>e.code==='TERRAIN_BOTTOM_BUDGET'
    &&e.message.includes('output triangle limit (262144)')&&/merged native meshes 32575/.test(e.message)),
  'draw coalescing cannot pretend that the original 350k-plus source triangles disappeared');
  assert.deepEqual(points,before);for(const[path,bytes]of raw)assert.deepEqual(f.files.get(path),bytes,'a budget rejection cannot mutate artwork');
  const result=compile(f,points.filter(([,y])=>y<=3),bounds).result,report=result.report;
  assert(report.coverageMeshMerging.before.nativeLowerMeshes>report.coverageMeshMerging.after.nativeLowerMeshes);
  assert(report.nativeMeshCount+report.nativeTopCornerMeshes<=report.limits.maximumNativeMeshes);
  assert(report.outputTriangles+report.nativeTopCornerTriangles+report.supportedTopCoverTriangles<=report.limits.maximumOutputTriangles);
  assert.equal(report.coverageMeshMerging.verticesUvsTrianglesChanged,false);
  for(const owner of owners(result))for(const mesh of [...owner.nativeTopCornerMeshes??[],...owner.edgeMeshes??[]]){
    assert.equal(mesh.positions.length,mesh.uvs.length);
    assert(mesh.indices.every(i=>Number.isSafeInteger(i)&&i>=0&&i<mesh.positions.length/2));
  }
});
