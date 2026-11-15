import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import * as flow from '../src/generation/index.mjs';
import {readTerrainSideSelection} from '../src/terrain-edge-selection.mjs';
import {buildTerrainEdgeDelivery,verifyTerrainEdgeDelivery} from '../src/terrain-edge-pipeline.mjs';
import {loadSceneKit,readMap,contextFor} from '../src/kit.mjs';
import {compileMap} from '../src/compile.mjs';
import {openSceneExport} from '../src/persistence.mjs';
import {studioKitSnapshot} from '../src/studio/kit-snapshot.mjs';
import {createEditor} from '../src/editor.mjs';
import {encodeRgbaPng,inspectPng} from '../src/png.mjs';
import {hash,jsonBytes,seal,unseal} from '../src/generation/common.mjs';
import {bottomSideControls,bottomFixture} from './helpers/terrain-bottom-delivery.mjs';
import {setupTerrainEdgeDelivery,receiveEdgeFixture} from './helpers/terrain-edge-delivery.mjs';
import {coherentSurfaceObservations} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';

test('one checked wall revision combines with the separate upper pair while preserving the other native roles, loop/cap/span/step export and workflow',{timeout:900000},t=>{
  const observations=coherentSurfaceObservations();observations.rockFeaturePairs[0].source.toX=160;
  observations.sourceBodyStartY=96;observations.referenceSurfaceSamples[0].bodyStartY=246;
  const f=setupTerrainEdgeDelivery(t,{receiveEdges:false,sourceAlpha:252,surfaceObservations:observations}),bottom=bottomFixture(),raws=new Map([...f.raws,...bottom.raws]),
    image=inspectPng(raws.get('left-wall'),{includePixels:true,allowHiddenRgb:true}),rgba=Buffer.from(image.rgba);
  for(let p=0;p<rgba.length;p+=4)if(rgba[p+3])rgba[p+1]=Math.min(255,rgba[p+1]+7);
  const revised=encodeRgbaPng(image.width,image.height,rgba),options={baseBatchSha256:f.base.sha256,capabilitiesSha256:f.options.capabilitiesSha256,
    coverageProfile:'full-perimeter-v1',nativeSizeProfile:'bounded-native-4m-v1',renderEnvelopeProfile:'visible-alpha8-outward16-native-rgba-v1',naturalSurfaceProfile:'reference-defined-cover-v1'},
    freeze=(id,roles,replacement=false)=>{
      const b=flow.freezeTerrainEdgeSources(f.workflow,{...options,batchId:id,...(replacement?{coverageIntent:'explicit-subset-replacement'}:{}),
        items:roles.map((role,i)=>({assetId:id+'.'+i,role,content:'One synthetic source-owned '+role+' responsibility.',exclusions:['Independent objects']}))});
      flow.authorizeReferenceAssetBatch(f.workflow,b.sha256,decision(id+'.compute',b.sha256,'approve-compute'));
      for(const sha of b.planSha256s){const role=flow.getGenerationPlan(f.workflow,sha).recipe.edgeRole;
        receiveEdgeFixture(f.workflow,sha,id==='new.wall'?revised:raws.get(role));}return b;
    },base=freeze('full.native',flow.TERRAIN_PERIMETER_ROLES),upper=freeze('new.upper',['left-top-corner','right-top-corner'],true),
    wall=freeze('new.wall',['left-wall'],true),replacements=[upper.sha256,wall.sha256],view=readTerrainSideSelection(f.workflow,base.sha256,replacements),
    stateBefore=flow.inspectWorkflow(f.workflow),controls={...bottomSideControls(f),bottom:{...bottom.controls,nativeSizeProfile:options.nativeSizeProfile,
      renderEnvelopeProfile:options.renderEnvelopeProfile,junctionProfile:'native-bottom-adaptive-coverage-v2',bodySupportProfile:'author-solid-world-body-v1'},
      surfaceCycle:{fromColumn:0,usableColumns:192,overlapColumns:91},surfaceSpanEnvelope:{shortWidthWorld:64,fullWidthWorld:128,capEndRow:12,fadeRows:6},
      materialLoop:{overlapRows:64,phaseCount:3},stepCorners:{widthWorld:32,heightWorld:12},stepSurfaceProfile:'native-lip-linear-step-end-v2'};
  delete controls.rigidBodyRepeat;for(const side of ['left','right'])controls[side].wall.repeatY.from=144;
  const delivery={...f.deliveryOptions,batchSha256:base.sha256,replacementBatchSha256s:replacements,controls,output:join(f.parent,'side-subset')},
    report=buildTerrainEdgeDelivery(delivery),candidate=JSON.parse(readFileSync(join(delivery.output,'candidate/readiness.json'))),
    handle=loadSceneKit(join(delivery.output,'candidate/kit')),ctx=contextFor(handle),map=readMap(handle),scene=compileMap(handle,map);
  assert.equal(candidate.sideSourceSelection.sha256,view.selection.sha256);assert(!Object.hasOwn(candidate,'upperSourceSelection'));
  assert.equal(report.productionKit,false);assert.equal(report.generationCalls,0);assert.equal(report.finalHumanArtReview,'pending');
  for(const source of view.sources){const role=source.plan.recipe.edgeRole,record=candidate.sideSourceSelection.sources.find(s=>s.edgeRole===role),
    batch=role==='left-wall'?wall:role.endsWith('top-corner')?upper:base;
    assert.equal(record.batchSha256,batch.sha256);assert.equal(record.rawSha256,source.result.rawSha256);
    assert.deepEqual(readFileSync(join(delivery.output,'candidate/source',role+'-native.png')),role==='left-wall'?revised:raws.get(role));
  }
  assert.equal(scene.format,'ai_scene_compiled_v8');assert.equal(scene.terrainMaterial.stepSurface.sha256,ctx.kit.terrainStepSurface.sha256);
  assert.equal(scene.terrainMaterial.body.source.sha256,ctx.kit.terrainMaterialLoop.output.source.sha256);
  assert.equal(scene.terrainMaterial.cap.source.sha256,ctx.kit.terrainSurfaceCycle.output.source.sha256);
  const snapshot=studioKitSnapshot(handle);assert.equal(snapshot.metadata.kitMaterial.edges.left.wall.source.sha256,ctx.kit.terrainEdges.left.wall.source.sha256);
  const editor=createEditor(handle,{...map,terrainRuns:[],curveTerrains:[],instances:[],assemblyInstances:[],inspectionCases:[],terrainConnections:[]}),serialized=editor.serialize();
  editor.execute([{type:'paint-cells',familyId:ctx.rules.familyId,cells:[{x:1,y:1}]}]);assert.equal(editor.getScene().format,'ai_scene_compiled_v8');editor.undo();assert.equal(editor.serialize(),serialized);
  assert.equal(openSceneExport(join(delivery.output,'export')).compiled.contentSha256,scene.contentSha256);
  assert.equal(verifyTerrainEdgeDelivery({...delivery,replacementBatchSha256s:[...replacements].reverse()}).reportSha256,report.sha256);
  const evidencePath=join(delivery.output,'candidate/evidence/side-source-selection.json'),saved=readFileSync(evidencePath),tampered=unseal(JSON.parse(saved));
  tampered.sources[0].rawSha256='f'.repeat(64);writeFileSync(evidencePath,jsonBytes(seal(tampered)));
  assert.throws(()=>verifyTerrainEdgeDelivery(delivery));writeFileSync(evidencePath,saved);
  assert.deepEqual(flow.inspectWorkflow(f.workflow),stateBefore);
});
