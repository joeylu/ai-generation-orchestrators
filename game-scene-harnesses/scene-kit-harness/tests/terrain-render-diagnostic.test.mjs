import test from 'node:test';
import assert from 'node:assert/strict';
import {createTerrainRenderDiagnostic,TERRAIN_RENDER_DIAGNOSTIC_GROUPS as all} from '../src/terrain-render-diagnostic.mjs';
import {renderCoherentFrame} from '../src/coherent-render.mjs';
import {encodeRgbaPng,inspectPng} from '../src/png.mjs';
import {hash} from '../src/generation/common.mjs';

function fixture(){
  const files=new Map(),source=(name,rgba)=>{
    const bytes=encodeRgbaPng(2,2,Buffer.from(Array(4).fill(rgba).flat()));files.set(name,bytes);
    return {path:name,sha256:hash(bytes),byteLength:bytes.length};
  },body=source('body.png',[90,60,40,255]),cap=source('cap.png',[230,240,250,255]),rock=source('edge.png',[150,120,90,255]);
  const quad=(x,y,w,h)=>({positions:[x,y,x+w,y,x+w,y+h,x,y+h],uvs:[0,0,1,0,1,1,0,1],indices:[0,1,2,0,2,3]});
  const patch={layerId:'ground',source:{gridCells:[]},body:quad(4,4,24,20),cap:quad(4,4,24,8),
    capBands:[{...quad(4,4,24,8),coverageOpacity:.5}],topCoverBands:[{...quad(4,4,24,8),coverageOpacity:.5}],
    nativeTopCornerMeshes:[{...quad(4,3,6,10),source:cap,coverageOpacity:.75},{...quad(22,3,6,10),source:cap,coverageOpacity:.75}],
    edgeMeshes:[{...quad(4,12,4,12),source:rock,materialKey:'left.wall'},
      {...quad(24,12,4,12),source:rock,materialKey:'right.wall'},
      {...quad(8,20,16,4),source:rock,materialKey:'bottom.edge'}],cornerMeshes:[],fieldBoundaryBands:[]};
  const scene={format:'ai_scene_compiled_v7',contentSha256:'a'.repeat(64),source:{authorSha256:'b'.repeat(64)},
    defaultCamera:{center:{x:16,y:16},viewport:{width:32,height:32},scale:1},layers:[{layerId:'ground',visible:true,nodes:[]}],
    terrainMaterial:{body:{source:body},cap:{source:cap}},gridTerrains:[patch],curveTerrains:[],mixedTerrains:[]};
  const render=s=>inspectPng(renderCoherentFrame(s,p=>files.get(p)),{includePixels:true}).rgba;
  const pixel=(s,x,y)=>[...render(s).subarray((y*32+x)*4,(y*32+x+1)*4)];
  return {scene,files,render,pixel};
}

test('all terrain groups replay the same pixels without changing scene, camera or original sources',()=>{
  const f=fixture(),before=structuredClone(f.scene),bytes=[...f.files].map(([p,b])=>[p,hash(b)]),d=createTerrainRenderDiagnostic(f.scene,{groups:all});
  assert.deepEqual(f.render(d.scene),f.render(f.scene));assert.deepEqual(f.scene,before);
  assert.deepEqual([...f.files].map(([p,b])=>[p,hash(b)]),bytes);
  assert.deepEqual(d.scene.defaultCamera,f.scene.defaultCamera);assert.equal(d.scene.contentSha256,undefined);
  assert.equal(d.report.compiledSha256,before.contentSha256);assert.equal(d.report.actualStudioFrames,false);
  assert.equal(d.report.artAcceptance,'not-assessed');assert.equal(d.report.productionKit,false);
});

test('surface isolation retains the late supported cover once, not both early and late cap bands',()=>{
  const f=fixture(),d=createTerrainRenderDiagnostic(f.scene,{groups:['surface']});
  assert.deepEqual(f.pixel(d.scene,16,6),[130,142,155,255],'one half-opacity cover over the fixed diagnostic surround');
  assert.deepEqual(f.pixel(d.scene,16,16),[29,43,59,255]);
  const noSurface=createTerrainRenderDiagnostic(f.scene,{groups:['body']});
  assert.deepEqual(f.pixel(noSurface.scene,16,6),[90,60,40,255]);
  assert.equal(noSurface.scene.gridTerrains[0].topCoverBands.length,0);
});

test('two source-owned upper lobes remain visible with the shared cap disabled; wall and bottom isolation stay separate',()=>{
  const f=fixture(),d=createTerrainRenderDiagnostic(f.scene,{groups:['upper-corners']});
  assert.notDeepEqual(f.pixel(d.scene,6,6),[29,43,59,255]);assert.notDeepEqual(f.pixel(d.scene,25,6),[29,43,59,255]);
  assert.deepEqual(f.pixel(d.scene,16,6),[29,43,59,255]);
  const bottom=createTerrainRenderDiagnostic(f.scene,{groups:['bottom']});
  assert.deepEqual(f.pixel(bottom.scene,16,22),[150,120,90,255]);assert.deepEqual(f.pixel(bottom.scene,5,16),[29,43,59,255]);
  const walls=createTerrainRenderDiagnostic(f.scene,{groups:['walls']});
  assert.deepEqual(f.pixel(walls.scene,5,16),[150,120,90,255]);assert.deepEqual(f.pixel(walls.scene,16,22),[29,43,59,255]);
});

test('legacy caps and corners, curve/mixed owners and body shading use their actual draw responsibilities',()=>{
  const f=fixture(),p=f.scene.gridTerrains.pop();delete p.capBands;delete p.topCoverBands;
  p.edgeMeshes.push({...p.nativeTopCornerMeshes[0],materialKey:'left.corner'});p.nativeTopCornerMeshes=[];
  p.cornerMeshes=[{...structuredClone(p.cap),materialKind:'cap'}];p.fieldBoundaryBands=[{...structuredClone(p.body),shadeTint:0xffffff,coverageOpacity:.5}];
  f.scene.curveTerrains=[p];f.scene.mixedTerrains=[{...structuredClone(p),source:{gridCells:[],curveIds:[]}}];
  const d=createTerrainRenderDiagnostic(f.scene,{groups:['surface','upper-corners']});
  for(const owner of [...d.scene.curveTerrains,...d.scene.mixedTerrains]){
    assert(!Object.hasOwn(owner,'topCoverBands'));assert.deepEqual(owner.cap,p.cap);
    assert.deepEqual(owner.edgeMeshes.map(e=>e.materialKey),['left.corner']);assert.deepEqual(owner.fieldBoundaryBands,[]);assert.deepEqual(owner.cornerMeshes,[]);
  }
});

test('unknown draw responsibilities and invalid selections fail explicitly rather than masquerading as a bottom diagnosis',()=>{
  const f=fixture();
  for(const groups of [[],['cap'],['body','body']])assert.throws(()=>createTerrainRenderDiagnostic(f.scene,{groups}));
  assert.throws(()=>createTerrainRenderDiagnostic({...f.scene,contentSha256:undefined},{groups:['body']}));
  f.scene.gridTerrains[0].edgeMeshes.push({materialKey:'unknown.native'});
  assert.throws(()=>createTerrainRenderDiagnostic(f.scene,{groups:['bottom']}),e=>e.errors?.some(i=>i.code==='TERRAIN_DIAGNOSTIC_EDGE'));
});
