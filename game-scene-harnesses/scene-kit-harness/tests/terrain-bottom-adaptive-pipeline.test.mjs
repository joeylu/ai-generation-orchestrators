import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import * as flow from '../src/generation/index.mjs';
import {buildTerrainEdgeDelivery,verifyTerrainEdgeDelivery} from '../src/terrain-edge-pipeline.mjs';
import {TERRAIN_BOTTOM_ADAPTIVE_COVERAGE_PROFILE as adaptive} from '../src/terrain-bottom-edges.mjs';
import {loadSceneKit,readMap,contextFor} from '../src/kit.mjs';
import {compileMap} from '../src/compile.mjs';
import {setupBottomDelivery,bottomSideControls,bottomFixture} from './helpers/terrain-bottom-delivery.mjs';
import {receiveEdgeFixture} from './helpers/terrain-edge-delivery.mjs';
import {decision} from './helpers/generation.mjs';

test('explicit adaptive coverage traverses the public seven-source delivery, export and independent replay without changing original evidence',{timeout:900000},t=>{
  const f=setupBottomDelivery(t,{receiveSides:false}),side=bottomSideControls(f),bottom=bottomFixture(),raws=new Map([...f.raws,...bottom.raws]),
    batch=flow.freezeTerrainEdgeSources(f.workflow,{batchId:'adaptive.native.full',baseBatchSha256:f.base.sha256,capabilitiesSha256:f.options.capabilitiesSha256,
      coverageProfile:'full-perimeter-v1',nativeSizeProfile:'bounded-native-4m-v1',renderEnvelopeProfile:'visible-alpha8-outward16-native-rgba-v1',
      items:flow.TERRAIN_PERIMETER_ROLES.map((role,i)=>({assetId:'adaptive.native.'+i,role,content:'One independent synthetic native perimeter responsibility '+role+'.',exclusions:['Independent objects']}))});
  // The old helper's four-world repeat head predates endpoint underlap. This
  // synthetic source has real paint above twelve-world; measure/select that
  // native window rather than weaken the ten-world upstream collar guard.
  for(const value of [side.left.wall,side.right.wall])value.repeatY.from=144;
  flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('adaptive.native.compute',batch.sha256,'approve-compute'));
  for(const sha of batch.planSha256s)receiveEdgeFixture(f.workflow,sha,raws.get(flow.getGenerationPlan(f.workflow,sha).recipe.edgeRole));
  const before=flow.inspectWorkflow(f.workflow),controls={...side,bottom:{...bottom.controls,nativeSizeProfile:'bounded-native-4m-v1',
    renderEnvelopeProfile:'visible-alpha8-outward16-native-rgba-v1',junctionProfile:adaptive}},
    options={...f.deliveryOptions,batchSha256:batch.sha256,controls,output:join(f.parent,'adaptive-native-delivery')},
    report=buildTerrainEdgeDelivery(options),handle=loadSceneKit(join(options.output,'candidate/kit')),context=contextFor(handle),map=readMap(handle),scene=compileMap(handle,map);
  assert.equal(report.generationCalls,0);assert.equal(report.finalHumanArtReview,'pending');
  assert.equal(context.kit.terrainBottomEdges.junctionProfile,adaptive);
  assert.equal(scene.terrainBottomEdgePlacement.junctionProfile,adaptive);
  assert(scene.terrainUnionMaterial.supportedTopCover);
  assert([...scene.gridTerrains,...scene.curveTerrains].every(o=>Array.isArray(o.topCoverBands)));
  for(const role of flow.TERRAIN_PERIMETER_ROLES)assert.deepEqual(readFileSync(join(options.output,'candidate/source/'+role+'-native.png')),raws.get(role));
  assert.equal(verifyTerrainEdgeDelivery(options).reportSha256,report.sha256);
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before,'public deterministic delivery cannot reserve compute or grant source art acceptance');
});
