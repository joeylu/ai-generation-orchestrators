import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import * as flow from '../src/generation/index.mjs';
import {inspectPng,encodeRgbaPng} from '../src/png.mjs';
import {hash,seal,unseal} from '../src/generation/common.mjs';
import {setupCoherent,sourcePng,coherentSurfaceObservations} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';
import {nativeFixtures} from './helpers/terrain-edge-delivery.mjs';
import {bottomFixture,bottomSideControls} from './helpers/terrain-bottom-delivery.mjs';
import {compileMeasuredSurfaceMapping} from '../src/terrain-proof/measured-field.mjs';
import {createMeasuredCoherentComposition} from '../src/coherent-composition.mjs';
import {buildTerrainEdgeDelivery,verifyTerrainEdgeDelivery} from '../src/terrain-edge-pipeline.mjs';

// All artifacts below are deterministic synthetic fixtures; no adapter is invoked.
function receive(workflow,sha,bytes){
  const {request,...ticket}=flow.reservePlan(workflow,sha);
  flow.recordSubmission(workflow,ticket);
  return flow.receiveResult(workflow,ticket,bytes);
}
function setup(t,{alterTarget=false,failFirst=false,failIndices=[]}={}){
  const f=setupCoherent(t,undefined,undefined,{transformAnalysis:a=>{
    if(!alterTarget)return a;
    const b=unseal(a);b.instances.find(x=>x.instanceId==='landmark.actual').anchor.x+=1;return seal(b);
  }});
  const coherent=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:flow.createLayerSourceScopes(f.brief.requirements)});
  flow.authorizeReferenceAssetBatch(f.workflow,coherent.sha256,decision('coherent.compute',coherent.sha256,'approve-compute'));
  coherent.planSha256s.forEach((sha,i)=>receive(f.workflow,sha,sourcePng(flow.getGenerationPlan(f.workflow,sha).target.alpha==='transparent',i+17)));
  const native=nativeFixtures('autumn',252),bottom=bottomFixture(),raws=new Map([...native.raws,...bottom.raws]);
  const edgeBatch=flow.freezeTerrainEdgeSources(f.workflow,{batchId:'perimeter.synthetic',baseBatchSha256:coherent.sha256,
    capabilitiesSha256:f.options.capabilitiesSha256,coverageProfile:'full-perimeter-v1',nativeSizeProfile:'bounded-native-4m-v1',
    renderEnvelopeProfile:'visible-alpha8-outward16-native-rgba-v1',naturalSurfaceProfile:'reference-defined-cover-v1',
    items:flow.TERRAIN_PERIMETER_ROLES.map((role,i)=>({assetId:`edge.${i}`,role,content:`Synthetic ${role} boundary.`,exclusions:['Independent props']}))});
  flow.authorizeReferenceAssetBatch(f.workflow,edgeBatch.sha256,decision('perimeter.compute',edgeBatch.sha256,'approve-compute'));
  const rawByPlan=new Map(),preparedShas=[];
  let batch=edgeBatch,sourcePlanSha256=edgeBatch.planSha256s[0];
  const failed=new Set([...failIndices,...(failFirst?[0]:[])]);
  edgeBatch.planSha256s.forEach((sha,i)=>{
    let raw=raws.get(flow.getGenerationPlan(f.workflow,sha).recipe.edgeRole);
    if(failed.has(i)){const png=inspectPng(raw,{includePixels:true,allowHiddenRgb:true});png.rgba.set([23,41,67,1],(png.width*20)*4);raw=encodeRgbaPng(png.width,png.height,png.rgba);}
    rawByPlan.set(sha,raw);const result=receive(f.workflow,sha,raw);
    assert.equal(result.technical.status,failed.has(i)?'fail':'pass');
    if(failed.has(i)){
      assert.deepEqual(result.technical.issues,['TERRAIN_EDGE_NATIVE_GUTTER']);
      const {proposal}=flow.proposeTerrainEdgeCanvasGutterPreparation(f.workflow,sha,batch.sha256);
      const prepared=flow.prepareAndAdoptTerrainEdgeCanvasGutterSource(f.workflow,{preparationId:`edge.prepared.${i}`,proposal,
        receipt:{...decision(`edge.padding.${i}`,proposal.sha256),notes:failFirst?'PRIVATE_SOURCE_RECEIPT_SENTINEL':'Synthetic target padding acceptance.'},
        parentBatchSha256:batch.sha256,batchId:`edge.padded.batch.${i}`});
      if(i===0)sourcePlanSha256=prepared.record.sha256;preparedShas.push(prepared.record.sha256);batch=prepared.batch;
    }
  });
  return {...f,base:coherent,batch,edgeBatch,rawByPlan,sourcePlanSha256,preparedShas,controls:native.controls,bottom};
}

test('rebind preserves the original gutter failure and replaces only the reviewed target slot',{timeout:1200000},t=>{
  // All three bottom roles require prepared sources in the production failure;
  // leaving even one native source passing would mask the child-parent gate.
  const source=setup(t,{failFirst:true}),target=setup(t,{alterTarget:true,failIndices:[1,4,5,6]}),sourceBefore=flow.inspectWorkflow(source.workflow);
  const targetPlanSha256=target.batch.planSha256s[0];
  const input={sourceWorkflow:source.workflow,sourcePlanSha256:source.sourcePlanSha256,parentBatchSha256:target.batch.sha256,targetPlanSha256};
  const evidence=flow.exportTerrainEdgeRebindEvidence(source.workflow,source.sourcePlanSha256);
  assert(evidence);assert.equal(flow.inspectWorkflow(source.workflow).eventCount,sourceBefore.eventCount);
  assert.doesNotMatch(JSON.stringify(evidence.evidence),/PRIVATE_SOURCE_RECEIPT_SENTINEL/);
  const candidate=flow.proposeTerrainEdgeRebind(target.workflow,input),proposal=candidate.proposal;
  assert.equal(proposal.generationCalls,0);
  const options={...input,rebindId:'edge.rebound.left',batchId:'edge.rebound.batch',proposal};
  const before=flow.inspectWorkflow(target.workflow);
  assert.throws(()=>flow.adoptTerrainEdgeRebind(target.workflow,{...options,receipt:decision('edge.bad.review','f'.repeat(64))}));
  assert.deepEqual(flow.inspectWorkflow(target.workflow),before);
  assert.throws(()=>flow.proposeTerrainEdgeRebind(target.workflow,{...input,targetPlanSha256:target.batch.planSha256s[1]}));
  const tampered=seal({...unseal(proposal),rawSha256:'9'.repeat(64)});
  assert.throws(()=>flow.adoptTerrainEdgeRebind(target.workflow,{...options,proposal:tampered,receipt:decision('edge.tampered.review',tampered.sha256)}));
  assert.deepEqual(flow.inspectWorkflow(target.workflow),before);
  const receipt=decision('edge.review',proposal.sha256),{batchId,...prepareOptions}=options;
  const prepared=flow.prepareTerrainEdgeRebind(target.workflow,{...prepareOptions,receipt});
  assert.equal(prepared.request.maximumCalls,0);
  const afterPrepare=flow.inspectWorkflow(target.workflow);
  const adopted=flow.adoptTerrainEdgeRebind(target.workflow,{...options,receipt});
  assert.equal(adopted.record.request.maximumCalls,0);
  assert.equal(adopted.batch.planSha256s.length,7);
  assert.deepEqual(adopted.batch.planSha256s.slice(1),target.batch.planSha256s.slice(1));
  assert.equal(target.preparedShas.length,4);
  for(const sha of target.preparedShas)assert(adopted.batch.planSha256s.includes(sha));
  assert.equal(adopted.batch.planSha256s[0],adopted.record.sha256);
  assert.equal(adopted.batch.maximumCalls,0);
  const inputs=flow.getTerrainEdgeInputs(target.workflow,adopted.batch.sha256);
  assert.equal(inputs.sources.length,7);
  for(const role of ['bottom-edge','left-bottom-corner','right-bottom-corner']) {
    const bottomSource=inputs.sources.find(item=>item.plan.recipe.edgeRole===role);
    assert.equal(bottomSource?.plan.format,'ai_scene_terrain_edge_canvas_gutter_preparation_v1');
    assert.equal(bottomSource.preparation.record.sha256,bottomSource.plan.sha256);
  }
  const left=inputs.sources.find(x=>x.plan.recipe.edgeRole==='left-wall');
  assert.equal(left.plan.sha256,adopted.record.sha256);assert.equal(left.result.technical.status,'pass');
  assert.equal(flow.recheckResult(target.workflow,left.plan.sha256,left.result.rawSha256).status,'pass');
  assert.doesNotMatch(JSON.stringify(left),/PRIVATE_SOURCE_RECEIPT_SENTINEL/);
  const original=flow.getGenerationResult(source.workflow,source.edgeBatch.planSha256s[0]);
  assert.equal(original.result.technical.status,'fail');
  assert.equal(original.result.rawSha256,hash(source.rawByPlan.get(source.edgeBatch.planSha256s[0])));
  assert.deepEqual(flow.inspectWorkflow(source.workflow),sourceBefore);
  const afterAdopt=flow.inspectWorkflow(target.workflow);
  const resumed=flow.adoptTerrainEdgeRebind(target.workflow,{...options,receipt});
  assert.equal(resumed.batch.sha256,adopted.batch.sha256);
  assert.deepEqual(flow.inspectWorkflow(target.workflow),afterAdopt);
  assert(afterAdopt.eventCount>afterPrepare.eventCount);
  assert.throws(()=>flow.adoptTerrainEdgeRebind(target.workflow,{...options,receipt:decision('edge.review.again',proposal.sha256)}));
  assert.doesNotThrow(()=>flow.inspectWorkflow(target.workflow));

  const observations=coherentSurfaceObservations();observations.rockFeaturePairs[0].source.toX=160;
  const material=flow.getGenerationResult(target.workflow,target.base.planSha256s[0]).bytes,
    mapping=compileMeasuredSurfaceMapping({reference:target.raw,target:target.target,material,observations}),
    composition=createMeasuredCoherentComposition(target.base,target.target,mapping),baseCandidateRoot=join(target.parent,'base-candidate');
  flow.buildCoherentCandidate(target.workflow,target.base.sha256,'base.fixture',baseCandidateRoot,composition);
  const controls={...bottomSideControls({...target,baseCandidateRoot}),bottom:{...target.bottom.controls,
    nativeSizeProfile:'bounded-native-4m-v1',renderEnvelopeProfile:'visible-alpha8-outward16-native-rgba-v1'}},
    delivery={workflow:target.workflow,baseKitRoot:join(baseCandidateRoot,'kit'),batchSha256:adopted.batch.sha256,
      controls,output:join(target.parent,'rebind-delivery')};
  const report=buildTerrainEdgeDelivery(delivery);
  assert.equal(report.productionKit,false);assert.equal(report.finalHumanArtReview,'pending');
  // Temporarily make only this synthetic source workflow unreadable; the
  // original marker is restored byte-for-byte even when verification fails.
  const sourceMarker=join(source.workflow,'workflow.json'),savedMarker=readFileSync(sourceMarker);
  writeFileSync(sourceMarker,'unavailable');
  try {assert.throws(()=>flow.inspectWorkflow(source.workflow));assert.equal(verifyTerrainEdgeDelivery(delivery).status,'verified');}
  finally {writeFileSync(sourceMarker,savedMarker);}
  const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]);
  for(const file of walk(delivery.output).filter(p=>p.endsWith('.json')))assert.doesNotMatch(readFileSync(file,'utf8'),/PRIVATE_SOURCE_RECEIPT_SENTINEL/,file);
});
