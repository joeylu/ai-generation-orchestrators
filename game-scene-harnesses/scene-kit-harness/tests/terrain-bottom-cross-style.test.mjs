import test from 'node:test';
import assert from 'node:assert/strict';
import {compileGridTerrainFields} from '../src/grid-terrain.mjs';
import {compileCurveGeometry} from '../src/curves.mjs';
import {compileTerrainUnionMaterial,TERRAIN_SURFACE_INTERFACE_PROFILE,TERRAIN_UNION_MATERIAL_PROFILE} from '../src/terrain-union-material.mjs';
import {compileTerrainUnionEdges,validateTerrainEdges,GRID_TERRAIN_EDGE_PROFILE,NEAR_OPAQUE_JOIN_PROFILE,EXPOSED_SIDE_TERMINATION_PROFILE} from '../src/terrain-edges.mjs';
import {buildTerrainEdgeJunctions} from '../src/terrain-edge-junction.mjs';
import {compileTerrainBottomEdges,validateTerrainBottomEdges,TERRAIN_BOTTOM_EDGE_PROFILE,TERRAIN_BOTTOM_EDGE_PROFILE_V2,
  TERRAIN_BOTTOM_NATIVE_SIZE_PROFILE,TERRAIN_BOTTOM_RENDER_ENVELOPE_PROFILE,TERRAIN_BOTTOM_JUNCTION_PROFILE} from '../src/terrain-bottom-edges.mjs';
import {encodeRgbaPng,inspectPng} from '../src/png.mjs';
import {paintCoherentMesh} from '../src/coherent-mesh-render.mjs';
import {hash} from '../src/generation/common.mjs';

const grid={width:64,height:64},world={x:0,y:0,width:512,height:512},background=[12,14,16];
const ratio=v=>v.numerator/v.denominator;
function fixture(kind){
  const natural=kind==='natural',alpha=natural?250:255,files=new Map(),images=new Map(),
    image=(path,width,height,pixel)=>{
      const rgba=Buffer.alloc(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++)rgba.set(pixel(x,y),4*(y*width+x));
      const bytes=encodeRgbaPng(width,height,rgba);files.set(path,bytes);images.set(path,{width,height,rgba});
      return {source:{path,sha256:hash(bytes),byteLength:bytes.length},pixelSize:{width,height}};
    },base={format:'ai_scene_continuous_terrain_appearance_v6',sourceSha256:'a'.repeat(64),surfaceMappingSha256:'b'.repeat(64),
      surfaceOriginInBodyPixels:{numerator:-40,denominator:1},capDepth:{numerator:natural?16:8,denominator:1},capUvEnd:{numerator:1,denominator:1},
      body:image(kind+'/body.png',natural?64:96,64,(x,y)=>natural?[85+x%13,75+y%19,60,255]:[35+y%17,65+(x%24===0?30:0),95+y%13,255]),
      cap:image(kind+'/cap.png',natural?64:96,natural?64:32,(x,y)=>natural?[160+x%25,130+y%14,40,255]:[20,170+x%30,210,255])},
    edges={format:'ai_scene_terrain_edges_v5',profile:'curve-vertical-exposed-native-v1',joinProfile:NEAR_OPAQUE_JOIN_PROFILE,gridProfile:GRID_TERRAIN_EDGE_PROFILE,
      sourceBinding:{materialSourceSha256:base.sourceSha256,surfaceMappingSha256:base.surfaceMappingSha256}};
  for(const side of ['left','right']){
    edges[side]={};
    for(const part of ['wall','corner']){
      const corner=part==='corner',width=natural?(corner?80:72):(corner?128:96),height=natural?(corner?160:120):(corner?128:160),
        boundaryX=natural?(side==='left'?24:width-24):(side==='left'?(corner?40:32):width-(corner?40:32)),
        innerX=boundaryX+(side==='left'?16:-16),s=natural?{numerator:1,denominator:2}:{numerator:1,denominator:4},
        native=image(`${kind}/${side}-${part}.png`,width,height,(x,y)=>{
          const boundary=boundaryX+(natural?Math.floor(y/7)%5-2:0),inside=side==='left'?x>=boundary:x<boundary;
          return x>=2&&x<width-2&&y>=(corner?8:2)&&y<height-2&&inside?[80+(corner?25:0),55+x%19,35+y%23,alpha]:[0,0,0,0];
        });
      edges[side][part]={...native,scale:s,boundaryX,innerX,
        inboardBlend:{fromX:innerX,toX:innerX+(side==='left'?8:-8)},
        ...(corner?{surfaceY:natural?24:32,wallStartY:natural?112:96}:{repeatY:{from:natural?12:16,to:natural?108:144}})};
    }
  }
  edges.junctions=buildTerrainEdgeJunctions(edges,{readAsset:p=>files.get(p)});
  const surfaceInterface={profile:TERRAIN_SURFACE_INTERFACE_PROFILE,capSourceSha256:base.cap.source.sha256,capEndRow:natural?8:12,fadeRows:2};
  Object.assign(edges,{format:'ai_scene_terrain_edges_v6',materialProfile:TERRAIN_UNION_MATERIAL_PROFILE,sideTerminationProfile:EXPOSED_SIDE_TERMINATION_PROFILE,surfaceInterface});
  validateTerrainEdges(edges,base,{readAsset:p=>files.get(p)});
  const bottom={format:'ai_scene_terrain_bottom_edges_v1',profile:TERRAIN_BOTTOM_EDGE_PROFILE,
    sourceBinding:{materialSourceSha256:base.sourceSha256,surfaceMappingSha256:base.surfaceMappingSha256}};
  for(const key of ['edge','leftCorner','rightCorner']){
    const corner=key!=='edge',left=key==='leftCorner',width=natural?(corner?80:96):(corner?128:160),height=natural?(corner?96:80):(corner?128:96),
      boundaryY=natural?(corner?72:60):(corner?96:72),innerY=boundaryY-16,
      boundaryX=corner?(natural?(left?24:56):(left?40:88)):null,innerX=corner?boundaryX+(left?16:-16):null,
      native=image(`${kind}/bottom-${key}.png`,width,height,(x,y)=>{
        const lower=natural?boundaryY+4+(Math.floor(x/6)%2)*8:boundaryY+12,
          inward=corner?(left?x>=boundaryX+(natural?Math.floor(y/7)%5-2:0):x<boundaryX+(natural?Math.floor(y/7)%5-2:0)):true,
          notch=natural&&!corner&&x>=68&&x<76&&y>=50;
        return x>=4&&x<width-4&&y>=4&&y<lower&&inward&&!notch
          ?[natural?130:30,100+(x%7),natural?50:160+(y%7),alpha]:[0,0,0,0];
      });
    bottom[key]={...native,scale:natural?{numerator:1,denominator:2}:{numerator:1,denominator:4},boundaryY,innerY,
      inboardBlend:{fromY:innerY,toY:innerY-8},...(corner?{boundaryX,innerX,stripStartX:innerX+(left?8:-8),wallStartY:natural?28:32}
        :{repeatX:{from:natural?12:16,to:width-(natural?12:16)}})};
  }
  validateTerrainBottomEdges(bottom,base,{terrainEdges:edges,readAsset:p=>files.get(p)});
  const appearance=natural?base:{...base,format:'ai_scene_continuous_terrain_appearance_v8',bodyRepeatSha256:'c'.repeat(64),
    bodyPeriod:{width:{numerator:512,denominator:1},height:{numerator:4973,denominator:31}},bodyOriginWorldY:{numerator:123,denominator:7}};
  return {kind,natural,alpha,files,images,base,appearance,edges,bottom,surfaceInterface};
}
function compile(f,points,curves=[]){
  const cells=new Map(points.map(([x,y])=>[`${x},${y}`,'terrain.primary'])),material=compileTerrainUnionMaterial({
    gridTerrains:compileGridTerrainFields(cells,{grid,appearance:f.base,layerId:'ground'}),curveTerrains:curves,appearance:f.appearance,grid,surfaceInterface:f.surfaceInterface}),
    sides=compileTerrainUnionEdges(material.gridTerrains,material.curveTerrains,f.edges,{world,grid,cells}),
    input={gridTerrains:sides.gridTerrains,curveTerrains:sides.curves},before=structuredClone(input),
    result=compileTerrainBottomEdges({...input,bottomEdges:f.bottom,terrainEdges:f.edges,world,grid,cells});
  assert.deepEqual(input,before,'adding bottom presentation cannot mutate preceding side compilation');return result;
}
function render(f,result){
  const width=512,height=512,pixels=Buffer.alloc(width*height*4);
  for(let p=0;p<pixels.length;p+=4)pixels.set([...background,255],p);
  for(const owner of [...result.gridTerrains,...result.curveTerrains]){
    paintCoherentMesh(pixels,{width,height},owner.body,f.images.get(f.appearance.body.source.path),{topLeftRule:true});
    for(const band of owner.capBands??[owner.cap])paintCoherentMesh(pixels,{width,height},band,f.images.get(f.appearance.cap.source.path),{topLeftRule:true,cap:true,opacity:band.coverageOpacity??1});
    for(const edge of owner.edgeMeshes??[])paintCoherentMesh(pixels,{width,height},edge,f.images.get(edge.source.path),{topLeftRule:true,clampU:true,clampV:true,opacity:edge.coverageOpacity??1});
  }
  return {pixels,width,height,rgb:(x,y)=>[...pixels.subarray((y*width+x)*4,(y*width+x)*4+3)]};
}
function assertPhase(f,result){
  const height=f.natural?256:ratio(f.appearance.bodyPeriod.height),origin=f.natural?0:ratio(f.appearance.bodyOriginWorldY);
  for(const owner of [...result.gridTerrains,...result.curveTerrains])for(let i=0;i<owner.body.positions.length;i++)
    assert.equal(owner.body.uvs[i],(owner.body.positions[i]-(i%2?origin:0))/(i%2?height:512));
}
const curve=(id,left,right,top,bottom)=>({...compileCurveGeometry({curveId:id,familyId:'terrain.primary',baseY:bottom,
  points:[{x:left,y:top,slope:0},{x:right,y:top,slope:0}]},8),layerId:'ground'});

test('different native natural and manufactured sources retain their original alpha/shape/scale through the full side and bottom compiler',()=>{
  const natural=fixture('natural'),city=fixture('city');
  assert.notDeepEqual(natural.bottom.edge.pixelSize,city.bottom.edge.pixelSize);assert.notDeepEqual(natural.bottom.edge.scale,city.bottom.edge.scale);
  assert.notEqual(natural.bottom.edge.boundaryY-natural.bottom.edge.innerY,0);
  assert.notEqual((natural.bottom.edge.boundaryY-natural.bottom.edge.innerY)*ratio(natural.bottom.edge.scale),
    (city.bottom.edge.boundaryY-city.bottom.edge.innerY)*ratio(city.bottom.edge.scale));
  for(const f of [natural,city]){
    const originals=new Map([...f.files].map(([path,bytes])=>[path,Buffer.from(bytes)])),bottomBefore=structuredClone(f.bottom),
      result=compile(f,[[2,2],[3,2],[4,2],[5,2],[2,3],[3,3],[4,3],[5,3]]),image=render(f,result);
    assertPhase(f,result);assert.equal(result.report.placed.length,1);assert.equal(result.report.generationCalls,0);
    assert.equal(result.report.sourcePngChanged,false);assert.equal(result.report.visibleRgbaChanged,false);
    assert.notDeepEqual(image.rgb(160,253),background,'retained neighboring native lower paint remains visible');
    const expected=f.natural?[128,99,49]:[30,104,166];
    assert(image.rgb(160,253).every((value,index)=>Math.abs(value-expected[index])<=1),
      'final pixel retains bilinear native RGBA (one-code rounding tolerance): natural alpha250 over background, manufactured alpha255');
    if(f.natural)assert.deepEqual(image.rgb(167,253),background,'native irregular inward recess survives final RGBA source-over');
    else assert.notDeepEqual(image.rgb(167,253),background,'straight manufactured lower panel stays filled at the same world point');
    const source=inspectPng(f.files.get(f.bottom.edge.source.path),{includePixels:true});
    assert(source.rgba.some((a,i)=>i%4===3&&a===f.alpha));assert.equal(f.alpha,f.natural?250:255);
    for(const owner of [...result.gridTerrains,...result.curveTerrains])for(const edge of owner.edgeMeshes??[])
      if(edge.materialKey?.startsWith('bottom.'))assert.deepEqual(edge.nativeScale,f.bottom[edge.bottomPart].scale,'compiler never fits a new physical scale');
    assert.deepEqual(f.bottom,bottomBefore);for(const [path,bytes]of originals)assert.deepEqual(f.files.get(path),bytes);
  }
});

test('both source families preserve enclosed holes, separate curve air gaps and world phase after cutback',()=>{
  for(const kind of ['natural','city']){
    const f=fixture(kind),ring=[];for(let y=2;y<=5;y++)for(let x=2;x<=5;x++)if(!(x>=3&&x<=4&&y>=3&&y<=4))ring.push([x,y]);
    const hole=compile(f,ring),holeImage=render(f,hole);assertPhase(f,hole);
    for(const [x,y]of [[224,224],[288,224],[224,288],[288,288]])assert.deepEqual(holeImage.rgb(x,y),background,`${kind}: native perimeter preserves hole centers`);
    const gap=compile(f,[],[curve('upper',128,384,128,192),curve('lower',128,384,200,320)]),gapImage=render(f,gap);assertPhase(f,gap);
    assert.equal(gap.report.placed.length,2);assert(gap.report.halfGapClips>0);
    assert.deepEqual(gapImage.rgb(224,196),background,`${kind}: eight-world central air gap remains visible in final pixels`);
    assert.notDeepEqual(gapImage.rgb(224,176),background);assert.notDeepEqual(gapImage.rgb(224,224),background);
  }
});

test('the same explicit endpoint underlap works with independently measured natural and city sources',()=>{
  const bridge=[...[2,3,4,5].map(x=>[x,2]),...[3,4,5].flatMap(y=>[[2,y],[5,y]])];
  for(const kind of ['natural','city']){
    const f=fixture(kind),originals=new Map([...f.files].map(([path,bytes])=>[path,Buffer.from(bytes)])),
      depth=(f.bottom.edge.boundaryY-f.bottom.edge.innerY)*ratio(f.bottom.edge.scale),
      baseline=kind==='natural'?{from:26,to:108}:{from:30,to:144};
    // The original short head remains valid for its old, nonextending role.
    // New endpoint control selects native rows with measured upstream room;
    // the source PNG, feature scale and painting are unchanged.
    for(const side of ['left','right'])f.edges[side].wall.repeatY={...baseline};
    f.edges.junctions=buildTerrainEdgeJunctions(f.edges,{readAsset:p=>f.files.get(p)});
    Object.assign(f.bottom,{format:'ai_scene_terrain_bottom_edges_v2',profile:TERRAIN_BOTTOM_EDGE_PROFILE_V2,
      nativeSizeProfile:TERRAIN_BOTTOM_NATIVE_SIZE_PROFILE,renderEnvelopeProfile:TERRAIN_BOTTOM_RENDER_ENVELOPE_PROFILE});
    const before=compile(f,bridge),oldImage=render(f,before);
    f.bottom.junctionProfile=TERRAIN_BOTTOM_JUNCTION_PROFILE;
    const validation=validateTerrainBottomEdges(f.bottom,f.base,{terrainEdges:f.edges,readAsset:p=>f.files.get(p)});
    assert(validation.junctionSources.every(s=>s.minimumCollarAlpha===f.alpha&&s.extensionDepthWorld===depth+2));
    const result=compile(f,bridge),image=render(f,result);assertPhase(f,result);
    assert.notDeepEqual(image.rgb(191,190),oldImage.rgb(191,190),`${kind}: the concave joint gains original native side paint`);
    assert.deepEqual(image.rgb(256,224),background,`${kind}: extending the native side cannot fill the bridge opening`);
    const extensions=[...result.gridTerrains,...result.curveTerrains].flatMap(o=>o.edgeMeshes??[]).filter(m=>m.bottomJunction?.kind==='concave-side-underlap');
    assert(extensions.length>0);assert(result.report.endpointHandoffs.length>0);
    for(const m of extensions){
      const side=f.edges[m.side].wall,sourceHeight=side.pixelSize.height*ratio(side.scale);
      assert.equal(m.nativeOriginWorld,192-side.repeatY.from*ratio(side.scale),`${kind}: no source-phase reset at the new joint`);
      for(let i=1;i<m.positions.length;i+=2)assert(Math.abs(m.uvs[i]-(m.positions[i]-m.nativeOriginWorld)/sourceHeight)<1e-9);
    }
    const ring=[];for(let y=2;y<=5;y++)for(let x=2;x<=5;x++)if(!(x>=3&&x<=4&&y>=3&&y<=4))ring.push([x,y]);
    const hole=compile(f,ring),holeImage=render(f,hole);assertPhase(f,hole);assert(hole.report.nativeSideExtensions.length>0);
    for(const [x,y]of [[224,224],[288,224],[224,288],[288,288]])assert.deepEqual(holeImage.rgb(x,y),background);
    for(const [path,bytes]of originals)assert.deepEqual(f.files.get(path),bytes,`${kind}: source bytes stay immutable`);
  }
});

test('short upstream heads fail the new endpoint gate while each legacy style keeps its old replay',()=>{
  for(const kind of ['natural','city']){
    const f=fixture(kind),points=[[2,2],[3,2],[2,3]],before=compile(f,points),oldBytes=hash(Buffer.from(JSON.stringify(before))),
      candidate={...f.bottom,format:'ai_scene_terrain_bottom_edges_v2',profile:TERRAIN_BOTTOM_EDGE_PROFILE_V2,
        nativeSizeProfile:TERRAIN_BOTTOM_NATIVE_SIZE_PROFILE,renderEnvelopeProfile:TERRAIN_BOTTOM_RENDER_ENVELOPE_PROFILE,junctionProfile:TERRAIN_BOTTOM_JUNCTION_PROFILE};
    assert.throws(()=>validateTerrainBottomEdges(candidate,f.base,{terrainEdges:f.edges,readAsset:p=>f.files.get(p)}),
      error=>error.errors?.some(e=>e.code==='TERRAIN_BOTTOM_JUNCTION_COLLAR'),`${kind}: insufficient native upstream rows must be rejected`);
    validateTerrainBottomEdges(f.bottom,f.base,{terrainEdges:f.edges,readAsset:p=>f.files.get(p)});
    assert.equal(hash(Buffer.from(JSON.stringify(compile(f,points)))),oldBytes,`${kind}: the old nonextending kit replays unchanged`);
  }
});
