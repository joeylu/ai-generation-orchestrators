import test from 'node:test';
import assert from 'node:assert/strict';
import {compileTerrainStepCorners} from '../src/terrain-step-corners.mjs';
import {buildTerrainStepSurface,validateTerrainStepSurface} from '../src/terrain-step-surface.mjs';
import {seal,unseal} from '../src/generation/common.mjs';
import {validateDocument} from '../src/schema.mjs';
import {stepSurfaceFixture,rebindStepSurfaceFixture} from './helpers/terrain-step-surface.mjs';
const rejects=(f,code)=>assert.throws(f,e=>e.errors?.some(x=>x.code===code));

test('bound ramps crop to native rows with unchanged UV density, body wedge, support, ownership and source input',()=>{
  const input=stepSurfaceFixture(),before=structuredClone(input),result=compileTerrainStepCorners(input),old=compileTerrainStepCorners(stepSurfaceFixture({bound:false}));
  assert.deepEqual(input,before);assert.equal(result.report.placed.length,old.report.placed.length);
  assert.equal(result.report.supportProbeDepthWorld,36);assert.equal(result.report.surfaceBinding.sha256,input.surfaceBinding.sha256);
  assert.deepEqual(result.gridTerrains[0].body,old.gridTerrains[0].body);assert.deepEqual(result.gridTerrains[0].edgeMeshes,old.gridTerrains[0].edgeMeshes);
  assert.deepEqual(result.gridTerrains[0].cornerMeshes.filter(m=>m.materialKind==='body'),old.gridTerrains[0].cornerMeshes.filter(m=>m.materialKind==='body'));
  for(const p of result.report.placed){assert.equal(p.surfaceCoverage.widthWorld,64);assert.equal(p.surfaceCoverage.capEndRow,8);assert.equal(p.capExtent.bottom-p.y,4);}
  const caps=result.gridTerrains[0].cornerMeshes.filter(m=>m.materialKind==='cap');
  for(const m of caps){assert(m.sourceLocalDepth.toWorld<=4);assert(m.coverageOpacity>0&&m.coverageOpacity<=1);
    for(let i=0;i<m.uvs.length;i+=2){assert.equal(m.uvs[i],m.positions[i]/512);
      assert.equal(m.uvs[i+1],((i/2)%2?m.sourceLocalDepth.toWorld:m.sourceLocalDepth.fromWorld)/36);}}
  assert(result.report.triangles<=old.report.triangles);assert(result.report.cornerMeshes<=old.report.cornerMeshes);
  assert.equal(result.report.authorGeometryChanged,false);assert.equal(result.report.sourceAlphaChanged,false);
});

test('a complete adjacent grid/curve span selects full coverage even when its last segment and ramp width are short',()=>{
  const input=stepSurfaceFixture(),id='curve.extension';input.curveTerrains.push({curveId:id,layerId:'terrain',surface:[{x:64,y:128},{x:128,y:128}],
    bounds:{x:64,y:128,width:64,height:192},body:{positions:[],uvs:[],indices:[]},cap:{positions:[],uvs:[],indices:[]},capBands:[],edgeMeshes:[]});
  input.unionMaterial.groups[0].ownerIds.push(id);input.unionMaterial.groups[0].exposedNorthSegments.unshift({from:{x:64,y:128},to:{x:128,y:128},ownerId:id});
  rebindStepSurfaceFixture(input);const result=compileTerrainStepCorners(input),left=result.report.placed.find(p=>p.side==='left'),right=result.report.placed.find(p=>p.side==='right');
  assert.equal(left.widthWorld,32);assert.equal(left.surfaceCoverage.widthWorld,128);assert.equal(left.surfaceCoverage.capEndRow,16);assert.equal(left.capExtent.bottom-left.y,8);
  assert.equal(right.surfaceCoverage.widthWorld,64);assert.equal(right.capExtent.bottom-right.y,4);
});

test('thin support and occupied air remain rejected with the conservative full-cap probes after coverage reduction',()=>{
  let input=stepSurfaceFixture();input.cells.set('2,1','ceiling');input.cells.set('6,1','ceiling');assert.equal(compileTerrainStepCorners(input).report.placed.length,0);
  input=stepSurfaceFixture();input.cells.delete('2,2');input.cells.delete('6,2');
  input.curveTerrains=[{curveId:'thin.left',surface:[{x:128,y:128},{x:192,y:128}],bounds:{x:128,y:128,width:64,height:16}},
    {curveId:'thin.right',surface:[{x:384,y:128},{x:448,y:128}],bounds:{x:384,y:128,width:64,height:16}}];
  const result=compileTerrainStepCorners(input);assert.equal(result.report.placed.length,0);assert(result.report.skipped.every(p=>p.reason==='unsupported-cap-depth'));
});

test('bindings reject resealed source, mapping, step or span substitutions and oversized coverage',()=>{
  const input=stepSurfaceFixture(),inputs={appearance:input.appearance,surfaceInterface:input.surfaceInterface,surfaceSpanEnvelope:input.surfaceSpanEnvelope,stepCorners:input.profile},record=input.surfaceBinding;
  assert.deepEqual(validateTerrainStepSurface(record,inputs),record);assert.deepEqual(validateDocument(record.format,record),[]);
  for(const key of ['capSourceSha256','capMappingSha256','interfaceSha256','surfaceSpanEnvelopeSha256','stepCornerProfileSha256'])
    rejects(()=>validateTerrainStepSurface(seal({...unseal(record),[key]:'f'.repeat(64)}),inputs),'STEP_SURFACE_REPLAY');
  rejects(()=>buildTerrainStepSurface({...inputs,surfaceInterface:{...input.surfaceInterface,capEndRow:60}}),'STEP_SURFACE_REDUCTION');
  assert(validateDocument(record.format,{...record,artAccepted:true}).length>0);
  const changed=structuredClone(input);changed.unionMaterial.groups[0].surfaceSpanEnvelope.spans[0].capEndRow++;
  rejects(()=>compileTerrainStepCorners(changed),'STEP_SURFACE_SPAN_BINDING');
});

test('full native-lip binding without an adaptive companion supports zero or all-fade without degenerate cap bands',()=>{
  for(const fade of [0,16]){
    const input=stepSurfaceFixture({adaptive:false});input.surfaceInterface.fadeRows=fade;rebindStepSurfaceFixture(input);
    const result=compileTerrainStepCorners(input),caps=result.gridTerrains[0].cornerMeshes.filter(m=>m.materialKind==='cap');
    assert(result.report.placed.every(p=>p.surfaceCoverage.capEndRow===16&&p.capExtent.bottom-p.y===8));
    assert(caps.every(m=>m.sourceLocalDepth.toWorld>m.sourceLocalDepth.fromWorld&&(fade?m.capBottomCoverage<1:m.capBottomCoverage===1)));
  }
});

test('span analysis consumes the existing candidate budget and never returns partial geometry',()=>{
  const input=stepSurfaceFixture();input.unionMaterial.groups=new Array(20000).fill(input.unionMaterial.groups[0]);
  rejects(()=>compileTerrainStepCorners(input),'STEP_CORNER_BUDGET');
});
