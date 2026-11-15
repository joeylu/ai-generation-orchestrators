import test from 'node:test';
import assert from 'node:assert/strict';
import {createTerrainRenderDiagnostic,createTerrainEdgeRoleDiagnostic,TERRAIN_RENDER_DIAGNOSTIC_GROUPS as groups,TERRAIN_RENDER_DIAGNOSTIC_EDGE_ROLES as roles} from '../src/terrain-render-diagnostic.mjs';
import {renderCoherentFrame} from '../src/coherent-render.mjs';
import {inspectPng} from '../src/png.mjs';
import {edgeRoleFixture} from './helpers/terrain-edge-role.mjs';

test('exact lower-corner omission preserves bottom middle, opposite corner, continuous coverage and source pixels',()=>{
  const {scene,files}=edgeRoleFixture(),before=structuredClone(scene),d=createTerrainEdgeRoleDiagnostic(scene,{groups,edgeRoles:roles.filter(r=>r!=='bottom.leftCorner')}),
    render=s=>inspectPng(renderCoherentFrame(s,p=>files.get(p)),{includePixels:true}).rgba,
    original=render(scene),omitted=render(d.scene),pixel=(b,x,y)=>[...b.subarray((y*32+x)*4,(y*32+x+1)*4)];
  assert.notDeepEqual(pixel(omitted,8,23),pixel(original,8,23));assert.deepEqual(pixel(omitted,8,23),[90,60,40,255]);
  for(const point of [[16,26],[25,24],[5,14],[26,6]])assert.deepEqual(pixel(omitted,...point),pixel(original,...point));
  assert.deepEqual(d.scene.gridTerrains[0].edgeMeshes,scene.gridTerrains[0].edgeMeshes.filter(m=>m.materialKey!=='bottom.leftCorner'));
  const only=createTerrainEdgeRoleDiagnostic(scene,{groups,edgeRoles:['bottom.leftCorner']});
  assert.deepEqual(only.scene.gridTerrains[0].edgeMeshes[0],scene.gridTerrains[0].edgeMeshes[4]);
  assert.deepEqual(scene,before);assert.equal(d.scene.contentSha256,undefined);assert.equal(d.report.productionKit,false);
  assert.deepEqual(d.report.nativeMeshesWithinSelectedGroups['bottom.leftCorner'],{before:1,retained:0,omitted:1});
});

test('all native roles reproduce original group selection; early and late corners keep the same exact role across owners',()=>{
  const {scene,files}=edgeRoleFixture(),p=scene.gridTerrains[0];scene.curveTerrains=[structuredClone(p)];scene.mixedTerrains=[structuredClone(p)];
  const all=createTerrainEdgeRoleDiagnostic(scene,{groups,edgeRoles:roles}),old=createTerrainRenderDiagnostic(scene,{groups});
  assert.deepEqual(all.scene,old.scene);assert.deepEqual(renderCoherentFrame(all.scene,p=>files.get(p)),renderCoherentFrame(scene,p=>files.get(p)));
  for(const role of ['left.corner','right.corner']){
    const d=createTerrainEdgeRoleDiagnostic(scene,{groups,edgeRoles:[role]});
    for(const key of ['gridTerrains','curveTerrains','mixedTerrains']){
      const original=scene[key][0],next=d.scene[key][0];
      for(const field of ['edgeMeshes','nativeTopCornerMeshes'])assert.deepEqual(next[field],original[field].filter(m=>m.materialKey===role));
      for(const field of ['body','cap','cornerMeshes','fieldBoundaryBands'])assert.deepEqual(next[field],original[field]);
    }
  }
});

test('role selection refines groups, does not restore omitted groups or remove unrelated body and step consumers',()=>{
  const {scene}=edgeRoleFixture(),p=scene.gridTerrains[0];p.cornerMeshes=[{...structuredClone(p.body),materialKind:'body'}];
  p.fieldBoundaryBands=[{...structuredClone(p.body),shadeTint:0xaaaaaa,coverageOpacity:.5}];
  const d=createTerrainEdgeRoleDiagnostic(scene,{groups:['body','bottom','step-corners','body-shading'],edgeRoles:['right.corner','bottom.edge']});
  assert.deepEqual(d.scene.gridTerrains[0].nativeTopCornerMeshes,[]);assert.deepEqual(d.scene.gridTerrains[0].cap.indices,[]);
  for(const field of ['body','cornerMeshes','fieldBoundaryBands'])assert.deepEqual(d.scene.gridTerrains[0][field],p[field]);
  const none=createTerrainEdgeRoleDiagnostic(scene,{groups,edgeRoles:[]});assert.deepEqual(none.scene.gridTerrains[0].edgeMeshes,[]);
  assert.deepEqual(none.scene.gridTerrains[0].nativeTopCornerMeshes,[]);assert.deepEqual(none.scene.gridTerrains[0].body,p.body);
});

test('ambiguous native roles and malformed selectors fail instead of producing misleading ownership evidence',()=>{
  const {scene}=edgeRoleFixture();
  for(const edgeRoles of [null,['bottom'],['bottom.edge','bottom.edge'],['left.wall','future.edge']])
    assert.throws(()=>createTerrainEdgeRoleDiagnostic(scene,{groups,edgeRoles}));
  assert.throws(()=>createTerrainEdgeRoleDiagnostic(scene,{groups,edgeRoles:roles,provider:'none'}));
  scene.gridTerrains[0].nativeTopCornerMeshes[0].materialKey='unknown.corner';
  assert.throws(()=>createTerrainEdgeRoleDiagnostic(scene,{groups:['body'],edgeRoles:[]}),e=>e.errors?.some(i=>i.code==='TERRAIN_DIAGNOSTIC_NATIVE_TOP_ROLE'));
});
