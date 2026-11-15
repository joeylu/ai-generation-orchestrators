import test from 'node:test';
import assert from 'node:assert/strict';
import {createTerrainBodyPhaseDiagnostic,TERRAIN_RENDER_DIAGNOSTIC_GROUPS as all} from '../src/index.mjs';
import {hash,unseal} from '../src/generation/common.mjs';
import {bodyPhaseFixture} from './helpers/terrain-body-phase.mjs';

test('one-period phase probe moves every retained body-textured consumer across grid, curve and mixed owners',()=>{
  const f=bodyPhaseFixture(),base=f.scene.gridTerrains[0];
  f.scene.curveTerrains=[{...structuredClone(base),curveId:'curve'}];
  f.scene.mixedTerrains=[{...structuredClone(base),patchId:'mixed',source:{gridCells:[],curveIds:[]}}];
  const before=structuredClone(f.scene),sourceHashes=[...f.files].map(([p,b])=>[p,hash(b)]),
    d=createTerrainBodyPhaseDiagnostic(f.scene,{groups:all,phase:{u:.25,v:-.5}});
  assert.deepEqual(d.report.consumers,{body:3,bodyShading:3,stepBody:3});unseal(d.report);
  for(const key of ['gridTerrains','curveTerrains','mixedTerrains'])for(let i=0;i<d.scene[key].length;i++){
    const p=d.scene[key][i],original=f.scene[key][i];
    for(const [mesh,old]of [[p.body,original.body],[p.fieldBoundaryBands[0],original.fieldBoundaryBands[0]],[p.cornerMeshes[0],original.cornerMeshes[0]]]){
      assert.deepEqual(mesh.uvs,old.uvs.map((n,j)=>n+(j%2?-.5:.25)));
      assert.deepEqual({...mesh,uvs:old.uvs},old);
    }
    assert.deepEqual(p.cap,original.cap);assert.deepEqual(p.cornerMeshes[1],original.cornerMeshes[1]);
    assert.deepEqual(p.edgeMeshes,original.edgeMeshes);assert.deepEqual(p.nativeTopCornerMeshes,original.nativeTopCornerMeshes);
  }
  assert.deepEqual(f.scene,before);assert.deepEqual([...f.files].map(([p,b])=>[p,hash(b)]),sourceHashes);
  assert.equal(d.scene.contentSha256,undefined);assert.equal(d.scene.format,'ai_scene_terrain_render_diagnostic_frame_v1');
  assert.equal(d.report.compiledSha256,before.contentSha256);assert.equal(d.report.productionKit,false);
  assert.equal(d.report.actualStudioFrames,false);assert.equal(d.report.artAcceptance,'not-assessed');
});

test('CPU result shifts the same known texture texel in body, shaded body and step wedge while other pixels stay identical',()=>{
  const f=bodyPhaseFixture(),before=f.pixels(f.scene),phase={u:1/8,v:0},d=createTerrainBodyPhaseDiagnostic(f.scene,{groups:all,phase}),after=f.pixels(d.scene),
    surround=[29,43,59],texel=[100,98,72];
  for(const [j,opacity]of [1,.5,.75].entries()){
    const p=f.bodyRects[j],actual=f.pixel(after,p.x+2,p.y+3);
    assert.deepEqual(actual,[...texel.map((n,c)=>Math.round(n*opacity+surround[c]*(1-opacity))),255]);
    assert.notDeepEqual(actual,f.pixel(before,p.x+2,p.y+3));
  }
  for(let y=0;y<40;y++)for(let x=0;x<64;x++)if(!f.bodyRects.some(p=>x>=p.x&&x<p.x+8&&y>=p.y&&y<p.y+8))
    assert.deepEqual(f.pixel(after,x,y),f.pixel(before,x,y));
  // Simulate the incomplete manual probe: moving only patch.body leaves a
  // visible stationary step wedge. The shared helper must reproduce neither it
  // nor a change in the cap used next to that wedge.
  const partial=structuredClone(f.scene);partial.gridTerrains[0].body.uvs=d.scene.gridTerrains[0].body.uvs;
  assert.notDeepEqual(f.pixel(f.pixels(partial),30,7),f.pixel(after,30,7));
});

test('zero phase retains exact old pixels; explicit group selection limits all phase consumers',()=>{
  const f=bodyPhaseFixture(),before=f.pixels(f.scene),zero=createTerrainBodyPhaseDiagnostic(f.scene,{groups:all,phase:{u:0,v:0}});
  assert.deepEqual(f.pixels(zero.scene),before);assert.deepEqual(zero.scene.defaultCamera,f.scene.defaultCamera);
  const body=createTerrainBodyPhaseDiagnostic(f.scene,{groups:['body'],phase:{u:1,v:-1}});
  assert.deepEqual(body.report.consumers,{body:1,bodyShading:0,stepBody:0});
  assert.deepEqual(body.scene.gridTerrains[0].cornerMeshes,[]);
  const native=createTerrainBodyPhaseDiagnostic(f.scene,{groups:['walls','bottom','upper-corners'],phase:{u:.25,v:.25}});
  assert.deepEqual(native.report.consumers,{body:0,bodyShading:0,stepBody:0});
});

test('phase probes reject unknown units, unbounded or nonfinite offsets and unknown step-material responsibilities',()=>{
  const f=bodyPhaseFixture();
  for(const phase of [undefined,{},[0,0],{x:0,y:0},{u:0,v:0,world:1},{u:NaN,v:0},{u:0,v:Infinity},{u:1.01,v:0},{u:0,v:-1.01}])
    assert.throws(()=>createTerrainBodyPhaseDiagnostic(f.scene,{groups:all,phase}));
  const bad=structuredClone(f.scene);bad.gridTerrains[0].cornerMeshes[0].materialKind='future-material';
  assert.throws(()=>createTerrainBodyPhaseDiagnostic(bad,{groups:all,phase:{u:0,v:0}}),e=>e.errors?.some(i=>i.code==='TERRAIN_DIAGNOSTIC_STEP_MATERIAL'));
  const invalid=structuredClone(f.scene);invalid.gridTerrains[0].body.uvs[0]=Infinity;
  assert.throws(()=>createTerrainBodyPhaseDiagnostic(invalid,{groups:all,phase:{u:0,v:0}}),e=>e.errors?.some(i=>i.code==='TERRAIN_DIAGNOSTIC_BODY_UVS'));
});
