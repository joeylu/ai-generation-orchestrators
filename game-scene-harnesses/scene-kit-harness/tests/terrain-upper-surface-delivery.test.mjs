import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import * as flow from '../src/generation/index.mjs';
import {combineTerrainUpperInputs,readTerrainUpperSelection} from '../src/terrain-edge-selection.mjs';
import {buildTerrainEdgeDelivery,verifyTerrainEdgeDelivery} from '../src/terrain-edge-pipeline.mjs';
import {loadSceneKit,readMap,contextFor} from '../src/kit.mjs';
import {compileMap} from '../src/compile.mjs';
import {openSceneExport} from '../src/persistence.mjs';
import {studioKitSnapshot} from '../src/studio/kit-snapshot.mjs';
import {reviewTerrainSurfaceKitSpan} from '../src/terrain-brush-footprint.mjs';
import {createEditor} from '../src/editor.mjs';
import {hash,jsonBytes,seal,unseal} from '../src/generation/common.mjs';
import {bottomSideControls,bottomFixture} from './helpers/terrain-bottom-delivery.mjs';
import {setupTerrainEdgeDelivery,receiveEdgeFixture} from './helpers/terrain-edge-delivery.mjs';
import {coherentSurfaceObservations} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';

for(const bodyMode of ['rigid','loop'])test(`checked upper-pair, cap cycle and span coverage survive ${bodyMode} body delivery, editor and export without generation or art acceptance`,{timeout:900000},t=>{
  const observations=coherentSurfaceObservations();observations.rockFeaturePairs[0].source.toX=160;
  observations.sourceBodyStartY=96;observations.referenceSurfaceSamples[0].bodyStartY=246;
  const f=setupTerrainEdgeDelivery(t,{receiveEdges:false,sourceAlpha:252,surfaceObservations:observations}),bottom=bottomFixture(),raws=new Map([...f.raws,...bottom.raws]),
    options={baseBatchSha256:f.base.sha256,capabilitiesSha256:f.options.capabilitiesSha256,coverageProfile:'full-perimeter-v1',
      nativeSizeProfile:'bounded-native-4m-v1',renderEnvelopeProfile:'visible-alpha8-outward16-native-rgba-v1',naturalSurfaceProfile:'reference-defined-cover-v1'},
    freeze=(id,roles,extra={})=>{
      const b=flow.freezeTerrainEdgeSources(f.workflow,{...options,batchId:id,...extra,
        items:roles.map((role,i)=>({assetId:id+'.'+i,role,content:'One synthetic native '+role+' responsibility.',exclusions:['Independent objects']}))});
      flow.authorizeReferenceAssetBatch(f.workflow,b.sha256,decision(id+'.compute',b.sha256,'approve-compute'));
      for(const sha of b.planSha256s)receiveEdgeFixture(f.workflow,sha,raws.get(flow.getGenerationPlan(f.workflow,sha).recipe.edgeRole));return b;
    },base=freeze('full.native',flow.TERRAIN_PERIMETER_ROLES),
    replacement=freeze('new.upper',['left-top-corner','right-top-corner'],{coverageIntent:'explicit-subset-replacement'}),
    view=readTerrainUpperSelection(f.workflow,base.sha256,replacement.sha256),stateBefore=flow.inspectWorkflow(f.workflow),
    controls={...bottomSideControls(f),bottom:{...bottom.controls,nativeSizeProfile:options.nativeSizeProfile,renderEnvelopeProfile:options.renderEnvelopeProfile},
      surfaceCycle:{fromColumn:0,usableColumns:192,overlapColumns:91},surfaceSpanEnvelope:{shortWidthWorld:64,fullWidthWorld:128,capEndRow:12,fadeRows:6}},
    delivery={...f.deliveryOptions,batchSha256:base.sha256,upperReplacementBatchSha256:replacement.sha256,controls,output:join(f.parent,'upper-cycle')};
  controls.bottom.junctionProfile='native-bottom-adaptive-coverage-v2';
  controls.bottom.bodySupportProfile='author-solid-world-body-v1';
  if(bodyMode==='loop'){delete controls.rigidBodyRepeat;controls.materialLoop={overlapRows:64,phaseCount:3};controls.stepCorners={widthWorld:32,heightWorld:12};controls.stepSurfaceProfile='native-lip-linear-step-end-v2';}
  for(const side of ['left','right'])controls[side].wall.repeatY.from=144;
  assert.equal(view.sources.length,7);assert.equal(view.selection.generationCalls,0);assert.equal(view.selection.computeAuthorizationIncluded,false);
  for(const item of view.selection.sources)assert.equal(item.batchSha256,item.edgeRole.endsWith('top-corner')?replacement.sha256:base.sha256);
  const source=flow.getTerrainEdgeInputs(f.workflow,base.sha256),other=flow.getTerrainEdgeInputs(f.workflow,replacement.sha256);
  assert.throws(()=>combineTerrainUpperInputs(source,{...other,batch:seal({...unseal(other.batch),materialRawSha256:'a'.repeat(64)})}));
  assert.throws(()=>combineTerrainUpperInputs(source,{...other,sources:other.sources.slice(0,1)}));
  assert.throws(()=>combineTerrainUpperInputs(other,source));
  const failed=structuredClone(other);failed.sources[0].result.technical.status='fail';assert.throws(()=>combineTerrainUpperInputs(source,failed));
  const report=buildTerrainEdgeDelivery(delivery),handle=loadSceneKit(join(delivery.output,'candidate/kit')),context=contextFor(handle),map=readMap(handle),
    scene=compileMap(handle,map),cycle=context.kit.terrainSurfaceCycle,original=context.kit.terrainAppearance.cap;
  assert.equal(report.finalHumanArtReview,'pending');assert.equal(report.generationCalls,0);
  assert.equal(hash(context.files.get(original.source.path)),original.source.sha256);
  assert.equal(scene.terrainMaterial.format,'ai_scene_continuous_terrain_appearance_v9');
  const body=context.kit[bodyMode==='loop'?'terrainMaterialLoop':'terrainRigidRepeat'];
  assert.deepEqual(scene.terrainMaterial.cap,cycle.output);assert.deepEqual(scene.terrainMaterial.body,body.output);
  assert.deepEqual(scene.terrainMaterial.bodyPeriod,body.bodyPeriod);
  if(bodyMode==='loop'){
    assert.equal(scene.format,'ai_scene_compiled_v8');
    assert.equal(context.kit.terrainStepSurface.format,'ai_scene_terrain_step_surface_v2');
    assert.equal(context.kit.terrainStepSurface.capSourceSha256,cycle.output.source.sha256);
    assert.equal(scene.terrainMaterial.stepSurface.sha256,context.kit.terrainStepSurface.sha256);
    assert.equal(scene.terrainStepCorners.surfaceBinding.sha256,context.kit.terrainStepSurface.sha256);
    const familyId=map.terrainRuns?.[0]?.familyId??map.curveTerrains?.[0]?.familyId,cells=[];
    for(let y=2;y<5;y++)for(let x=2;x<7;x++)cells.push({x,y,length:1,familyId});
    for(let x=3;x<6;x++)cells.push({x,y:1,length:1,familyId});
    const ramp=compileMap(handle,{...map,bounds:{x:0,y:0,width:10,height:8},terrainRuns:cells,curveTerrains:[],instances:[],assemblyInstances:[],inspectionCases:[],terrainConnections:[]});
    assert.equal(ramp.terrainStepCorners.placed.length,2);
    assert(ramp.terrainStepCorners.placed.every(p=>p.surfaceCoverage.capEndRow===12&&p.surfaceCoverage.widthWorld===64));
    assert(ramp.gridTerrains.flatMap(p=>p.cornerMeshes??[]).some(m=>m.vertexCoverage?.length>0));
  }else assert.equal(context.kit.terrainStepSurface,undefined);
  assert.equal(scene.terrainMaterial.edges.surfaceInterface.capSourceSha256,cycle.output.source.sha256);
  assert.equal(context.kit.terrainEdges.surfaceInterface.capSourceSha256,original.source.sha256,'immutable base-row interface remains source-bound');
  const span=reviewTerrainSurfaceKitSpan(handle,{minimumSpanCells:{width:1,height:1},maximumCornerTransitionCells:1,minimumInteriorWidthCells:.25,minimumBottomRepeatCells:.5,requireFullPerimeter:true});
  assert.equal(span.kitSha256,handle.bundleSha256);assert.equal(span.review.capSourceSha256,cycle.output.source.sha256);
  assert.equal(span.review.surfaceInterface.capSourceSha256,cycle.output.source.sha256);assert.equal(span.review.status,'measured-not-qualified');
  assert.equal(span.review.coverageAtDeclaredSpan.capEndRow,12);assert.equal(scene.terrainUnionMaterial.surfaceSpanEnvelope.sha256,context.kit.terrainSurfaceSpanEnvelope.sha256);
  const snapshot=studioKitSnapshot(handle);assert.equal(snapshot.metadata.kitMaterial.cap.source.sha256,cycle.output.source.sha256);
  assert.equal(snapshot.metadata.kitMaterial.surfaceSpanEnvelope.sha256,context.kit.terrainSurfaceSpanEnvelope.sha256);
  if(bodyMode==='loop')assert.equal(snapshot.metadata.kitMaterial.stepSurface.sha256,context.kit.terrainStepSurface.sha256);
  assert.equal(snapshot.metadata.kitMaterial.edges.surfaceInterface.capSourceSha256,cycle.output.source.sha256);
  assert.deepEqual(snapshot.assets.get('/assets/_terrain-material-cap.png'),context.files.get(cycle.output.source.path));
  const editor=createEditor(handle,{...map,terrainRuns:[],curveTerrains:[],instances:[],assemblyInstances:[],inspectionCases:[],terrainConnections:[]}),serialized=editor.serialize();
  editor.execute([{type:'paint-cells',familyId:context.rules.familyId,cells:[{x:1,y:1}]}]);
  assert.equal(editor.getScene().terrainBottomEdgePlacement.junctionProfile,'native-bottom-adaptive-coverage-v2');
  assert(editor.getScene().gridTerrains.some(p=>p.topCoverBands?.some(b=>b.surfaceSpanEnvelope?.capEndRow===12)));
  assert.equal(editor.getScene().terrainMaterial.surfaceCycleSha256,cycle.sha256);editor.undo();assert.equal(editor.serialize(),serialized);
  assert.equal(openSceneExport(join(delivery.output,'export')).compiled.contentSha256,scene.contentSha256);
  assert.equal(verifyTerrainEdgeDelivery(delivery).reportSha256,report.sha256);
  const kitPath=join(delivery.output,'candidate/kit/kit.json'),saved=readFileSync(kitPath),tampered=JSON.parse(saved);
  tampered.terrainSurfaceCycle=seal({...unseal(cycle),provenanceSha256:'a'.repeat(64)});writeFileSync(kitPath,jsonBytes(tampered));
  assert.throws(()=>loadSceneKit(join(delivery.output,'candidate/kit')));writeFileSync(kitPath,saved);
  const badSpan=JSON.parse(saved);badSpan.terrainSurfaceSpanEnvelope=seal({...unseal(badSpan.terrainSurfaceSpanEnvelope),capMappingSha256:'f'.repeat(64)});
  writeFileSync(kitPath,jsonBytes(badSpan));assert.throws(()=>loadSceneKit(join(delivery.output,'candidate/kit')));writeFileSync(kitPath,saved);
  if(bodyMode==='loop'){
    const badStep=JSON.parse(saved);badStep.terrainStepSurface=seal({...unseal(badStep.terrainStepSurface),interfaceSha256:'f'.repeat(64)});
    writeFileSync(kitPath,jsonBytes(badStep));assert.throws(()=>loadSceneKit(join(delivery.output,'candidate/kit')));writeFileSync(kitPath,saved);
  }
  assert.deepEqual(flow.inspectWorkflow(f.workflow),stateBefore);
});
