import test from 'node:test';
import assert from 'node:assert/strict';
import {createSharedTerrainFieldProfile,compileSharedTerrainFields} from '../src/shared-terrain-field.mjs';
import {encodeRgbaPng,inspectPng} from '../src/png.mjs';
import {hash} from '../src/generation/common.mjs';
import {renderCoherentFrame} from '../src/coherent-render.mjs';
import {Texture} from 'pixi.js';
import {createSceneView} from '../src/pixi/scene-view.mjs';
function fixture(){
  const bytes=Buffer.alloc(64*64*4);for(let y=0;y<64;y++)for(let x=0;x<64;x++)bytes.set([80+x*2,60+y*2,35,255],(y*64+x)*4);
  const png=encodeRgbaPng(64,64,bytes),source={path:'body.png',sha256:hash(png),byteLength:png.length},appearance={format:'ai_scene_continuous_terrain_appearance_v7',body:{source,pixelSize:{width:64,height:64}},cap:{source,pixelSize:{width:64,height:64}},capDepth:{numerator:32,denominator:1},capUvEnd:{numerator:1,denominator:1},bodyPeriod:{width:{numerator:128,denominator:1},height:{numerator:128,denominator:1}}},
    profile=createSharedTerrainFieldProfile(appearance,{outline:{maximumInsetWorld:4,sampleStepWorld:8,wavelengthWorld:64,seed:731},surfaceInterface:{profile:'world-body-native-lip-v1',capSourceSha256:source.sha256,capEndRow:24,fadeRows:8}});
  const compile=(cells,selected=profile)=>compileSharedTerrainFields(cells,{grid:{width:64,height:64},appearance,profile:selected,layerId:'terrain'}),render=(cells,selected=profile)=>{const result=compile(cells,selected),scene={defaultCamera:{center:{x:64,y:64},viewport:{width:256,height:256}},layers:[{layerId:'terrain',visible:true,nodes:[]}],terrainMaterial:appearance,gridTerrains:result.gridTerrains};return inspectPng(renderCoherentFrame(scene,()=>png),{includePixels:true});};
  return {appearance,profile,compile,render};
}
const cells=list=>new Map(list.map(([x,y])=>[`${x},${y}`,'terrain.primary']));
function triangles(m){return Array.from({length:m.indices.length/3},(_,n)=>m.indices.slice(n*3,n*3+3).map(i=>({x:m.positions[i*2],y:m.positions[i*2+1]})));}
function bounds(p){return {x0:Math.min(...p.map(p=>p.x)),x1:Math.max(...p.map(p=>p.x)),y0:Math.min(...p.map(p=>p.y)),y1:Math.max(...p.map(p=>p.y))};}
test('all 16 local occupancy patterns preserve true air and cell centers without diagonal bridges',()=>{
  const f=fixture(),positions=[[0,0],[1,0],[1,1],[0,1]];
  for(let mask=0;mask<16;mask++){
    const list=positions.filter((_,i)=>mask&(1<<i)),map=cells(list),r=f.compile(map);assert.equal(r.report.cells,list.length);
    for(const patch of r.gridTerrains)for(const p of triangles(patch.body)){
      const b=bounds(p);assert(list.some(([x,y])=>b.x0>=x*64-1e-6&&b.x1<=(x+1)*64+1e-6&&b.y0>=y*64-1e-6&&b.y1<=(y+1)*64+1e-6),'each output triangle remains inside one original occupied cell');
    }
    const image=f.render(map),pixel=(x,y)=>[...image.rgba.subarray(((y+64)*256+x+64)*4,((y+64)*256+x+64)*4+3)];
    for(const [x,y]of positions){const p=pixel(x*64+32,y*64+32);assert.equal(p.join(',')==='29,43,59',!map.has(`${x},${y}`));}
  }
});
test('paint order does not change any geometry, report or render',()=>{
  const f=fixture(),map=cells([[0,0],[1,0],[0,1],[2,0],[0,2]]),reversed=new Map([...map].reverse()),before=[...map];
  assert.deepEqual(f.compile(map),f.compile(reversed));assert.deepEqual(f.render(map).rgba,f.render(reversed).rgba);assert.deepEqual([...map],before);
});
test('body samples keep fixed world coordinates across every internal join and after adding a cell',()=>{
  const f=fixture(),map=cells([[0,0],[1,0],[0,1],[1,1]]),next=new Map(map);next.set('0,-1','terrain.primary');
  for(const source of [map,next])for(const patch of f.compile(source).gridTerrains){const b=patch.body;for(let n=0;n<b.positions.length;n+=2){assert(Math.abs(b.uvs[n]-b.positions[n]/128)<=1e-6);assert(Math.abs(b.uvs[n+1]-b.positions[n+1]/128)<=1e-6);}}
  const before=f.render(map),after=f.render(next);for(let y=32;y<120;y++)for(let x=16;x<120;x++){const n=((y+64)*256+x+64)*4;for(let c=0;c<4;c++)assert(Math.abs(before.rgba[n+c]-after.rgba[n+c])<=1,'world sampling differs by at most one 8-bit interpolation rounding step');}
});
test('single cells, stair turns, U openings and negative coordinates stay finite and within work budgets',()=>{
  const f=fixture();for(const list of [[[0,0]],[[0,0],[0,1],[1,1],[1,2],[2,2]],[[0,0],[0,1],[1,1],[2,1],[2,0]],[[-2,-2],[-1,-2],[-2,-1]]]){
    const r=f.compile(cells(list));assert(r.report.outputTriangles>0&&r.report.outputTriangles<=r.report.limits.maximumTriangles);assert(r.report.clipWork<=r.report.limits.maximumClipWork);
    for(const p of r.gridTerrains)for(const m of [p.body,...p.capBands])assert([...m.positions,...m.uvs].every(Number.isFinite));
  }
});
test('a changed material or resealed unsupported outline cannot inherit the profile',()=>{
  const f=fixture(),map=cells([[0,0]]);assert.throws(()=>compileSharedTerrainFields(map,{grid:{width:64,height:64},appearance:{...f.appearance,body:{...f.appearance.body,source:{...f.appearance.body.source,sha256:'a'.repeat(64)}}},profile:f.profile,layerId:'terrain'}),e=>e.errors?.some(i=>i.code==='SHARED_FIELD_SOURCE_BINDING'));
  assert.throws(()=>createSharedTerrainFieldProfile(f.appearance,{outline:{...f.profile.outline,maximumInsetWorld:32},surfaceInterface:f.profile.surfaceInterface}));
});
test('bounded side lighting samples the same world material and never paints into holes',()=>{
  const f=fixture(),profile=createSharedTerrainFieldProfile(f.appearance,{outline:{...f.profile.outline,maximumInsetWorld:12},surfaceInterface:f.profile.surfaceInterface,lighting:{bandWorld:6,fadeBands:4,leftShade:.95,rightShade:.72,bottomShade:.64}}),list=[[0,0],[0,1],[1,1],[2,1],[2,0]],map=cells(list),r=f.compile(map,profile);
  assert(r.gridTerrains[0].fieldBoundaryBands.length>0);for(const band of r.gridTerrains[0].fieldBoundaryBands)for(const p of triangles(band)){const b=bounds(p);assert(list.some(([x,y])=>b.x0>=x*64-1e-6&&b.x1<=(x+1)*64+1e-6&&b.y0>=y*64-1e-6&&b.y1<=(y+1)*64+1e-6));}
  assert.equal(r.report.renderRgbModulated,true);assert.equal(r.report.sourcePixelsRecolored,false);assert.deepEqual(f.compile(map,profile),f.compile(new Map([...map].reverse()),profile));
  const a=f.render(map,profile),n=((32+64)*256+96+64)*4;assert.deepEqual([...a.rgba.subarray(n,n+3)],[29,43,59]);
});
test('Pixi mounts boundary bands on the body texture with matching tint and coverage data',()=>{
  const f=fixture(),profile=createSharedTerrainFieldProfile(f.appearance,{outline:f.profile.outline,surfaceInterface:f.profile.surfaceInterface,lighting:{bandWorld:6,fadeBands:4,leftShade:.95,rightShade:.72,bottomShade:.64}}),result=f.compile(cells([[0,0],[1,0],[0,1]]),profile),
    view=createSceneView({resolveTexture:()=>Texture.WHITE,resolveCurveMaterial:()=>({body:Texture.WHITE,cap:Texture.EMPTY})});
  view.update({format:'ai_scene_compiled_v7',layers:[{layerId:'terrain',visible:true,nodes:[]}],terrainMaterial:f.appearance,gridTerrains:result.gridTerrains});
  const bands=view.root.children.flatMap(l=>l.children).filter(m=>m.label.startsWith('shared-field-boundary/'));
  assert.equal(bands.length,result.gridTerrains[0].fieldBoundaryBands.length);bands.forEach((m,i)=>{const d=result.gridTerrains[0].fieldBoundaryBands[i];assert.equal(m.texture,Texture.WHITE);assert.equal(m.tint,d.shadeTint);assert.equal(m.alpha,d.coverageOpacity);});
  view.destroy();assert(Texture.WHITE.source);assert(Texture.EMPTY.source);
});
test('local occupancy matrix has no unexplained interior pinholes at the maximum inset',()=>{
  const f=fixture(),profile=createSharedTerrainFieldProfile(f.appearance,{outline:{...f.profile.outline,maximumInsetWorld:16},surfaceInterface:f.profile.surfaceInterface}),positions=[[0,0],[1,0],[1,1],[0,1]];
  const inside=(p,t)=>{const cross=(a,b)=>(b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x),v=[cross(t[0],t[1]),cross(t[1],t[2]),cross(t[2],t[0])];return v.every(n=>n>=-1e-6)||v.every(n=>n<=1e-6);};
  for(let mask=0;mask<16;mask++){
    const list=positions.filter((_,i)=>mask&(1<<i)),map=cells(list),ts=f.compile(map,profile).gridTerrains.flatMap(p=>triangles(p.body));
    const boundaries=list.flatMap(([x,y])=>[[0,-1],[1,0],[0,1],[-1,0]].flatMap(([dx,dy])=>map.has(`${x+dx},${y+dy}`)?[]:[dx?{axis:'x',fixed:(x+(dx>0?1:0))*64,a:y*64,b:(y+1)*64}:{axis:'y',fixed:(y+(dy>0?1:0))*64,a:x*64,b:(x+1)*64}]));
    for(let y=8.5;y<128;y+=8)for(let x=8.5;x<128;x+=8){const p={x,y},occupied=map.has(`${Math.floor(x/64)},${Math.floor(y/64)}`),covered=ts.some(t=>inside(p,t));
      if(!occupied){assert.equal(covered,false);continue;}
      const distance=Math.min(...boundaries.map(b=>{const along=b.axis==='x'?y:x,normal=b.axis==='x'?x:y;return Math.hypot(normal-b.fixed,along-Math.max(b.a,Math.min(b.b,along)));}));
      if(distance>16*Math.SQRT2+1e-6)assert(covered,'interior beyond the declared boundary envelope remains covered');
    }
  }
});
