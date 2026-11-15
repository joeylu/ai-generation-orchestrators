import test from 'node:test';
import assert from 'node:assert/strict';
import * as flow from '../src/generation/index.mjs';
import {inspectPng,encodeRgbaPng} from '../src/png.mjs';
import {hash,seal,unseal} from '../src/generation/common.mjs';
import {compileTerrainEdgeSource,assessTerrainEdgeSource} from '../src/generation/terrain-edge-source.mjs';
import {transact} from '../src/generation/store.mjs';
import {replay} from '../src/generation/model.mjs';
import {setupCoherent,sourcePng} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';
import {inspectReferenceLedProject} from '../src/reference-led-pipeline.mjs';

const rejects=(fn,code)=>assert.throws(fn,error=>error.errors?.some(issue=>issue.code===code));
const receive=(root,sha,bytes)=>{const {request,...ticket}=flow.reservePlan(root,sha);flow.recordSubmission(root,ticket);return flow.receiveResult(root,ticket,bytes);};
const items=()=>flow.TERRAIN_EDGE_ROLES.map((role,index)=>({assetId:'edge.'+index,role,
  content:'One compact autumn rock edge with restrained attached moss and unchanged warm soil colors.',exclusions:['Independent trees or props']}));
function setup(t){
  const f=setupCoherent(t),base=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:flow.createLayerSourceScopes(f.brief.requirements)});
  flow.authorizeReferenceAssetBatch(f.workflow,base.sha256,decision('base.compute',base.sha256,'approve-compute'));
  base.planSha256s.forEach((sha,index)=>{const plan=flow.getGenerationPlan(f.workflow,sha);receive(f.workflow,sha,sourcePng(plan.target.alpha==='transparent',index+17));});
  return {...f,base,edgeOptions:{batchId:'edges.first',baseBatchSha256:base.sha256,capabilitiesSha256:f.options.capabilitiesSha256,items:items()}};
}

test('terrain edge preview is read-only and frozen four-plan budget binds the exact accepted reference and existing material',{timeout:240000},t=>{
  const f=setup(t),before=flow.inspectWorkflow(f.workflow),preview=flow.previewTerrainEdgeSources(f.workflow,f.edgeOptions);
  assert.equal(preview.sha256,flow.previewTerrainEdgeSources(f.workflow,f.edgeOptions).sha256);assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
  assert.equal(preview.executable,false);assert.equal(preview.generationCalls,0);assert.equal(preview.batch.maximumCalls,4);
  const material=flow.getGenerationResult(f.workflow,f.base.planSha256s[0]);
  for(const plan of preview.plans){
    assert.equal(plan.format,'ai_scene_generation_plan_v29');assert.equal(plan.request.maximumCalls,1);assert.equal(plan.request.images.length,2);
    assert.equal(plan.request.images[0].artifact.sha256,hash(f.raw));assert.equal(plan.request.images[1].artifact.sha256,material.result.rawSha256);
    assert.equal(plan.materialEvidence.artAcceptance,'not-assessed');assert.equal(plan.sourceScope.sceneCoordinatesInPrompt,false);
    assert.equal(plan.sourceScope.profile,'isolated-terrain-edge-v1');assert.equal(plan.request.output.alpha,'transparent');
    assert.equal(plan.visualReviewChecklist.automatedSemanticDetection,false);assert.match(plan.request.prompt,/Do not rotate a horizontal grass cap/);
    assert.doesNotMatch(plan.request.prompt,/observedEnvelope|canonical-reference-frame|[A-Z]:\\/);
  }
  const batch=flow.freezeTerrainEdgeSources(f.workflow,f.edgeOptions);
  assert.equal(batch.sha256,preview.batch.sha256);assert.deepEqual(flow.getTerrainEdgeSourceBatch(f.workflow,batch.sha256),batch);
  assert.equal(flow.inspectWorkflow(f.workflow).eventCount,before.eventCount+5);
  assert.equal(inspectReferenceLedProject(f.root).reference.status,'accepted');
  for(const sha of batch.planSha256s){rejects(()=>flow.reservePlan(f.workflow,sha),'AUTHORIZATION_REQUIRED');
    assert.deepEqual(flow.readGenerationInput(f.workflow,sha,0),f.raw);assert.deepEqual(flow.readGenerationInput(f.workflow,sha,1),material.bytes);}
  const frozen=flow.inspectWorkflow(f.workflow);
  rejects(()=>flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('wrong.old.digest',f.base.sha256,'approve-compute')),'AUTHORIZATION_STATE');
  assert.deepEqual(flow.inspectWorkflow(f.workflow),frozen);
});

test('edge subset and long identifiers work while duplicate roles, invalid briefs and incomplete bases fail atomically',{timeout:240000},t=>{
  const f=setup(t),before=flow.inspectWorkflow(f.workflow);
  for(const badItems of [[items()[0],{...items()[1],role:items()[0].role}],
    [{...items()[0],assetId:flow.getGenerationPlan(f.workflow,f.base.planSha256s[0]).recipe.assetId}],
    [items()[0],{...items()[1],content:'https://private.invalid/provider'}], [...items(),items()[0]]]){
    assert.throws(()=>flow.freezeTerrainEdgeSources(f.workflow,{...f.edgeOptions,items:badItems}));assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
  }
  const subset={...f.edgeOptions,batchId:'a'.repeat(100),items:[items()[2]]},preview=flow.previewTerrainEdgeSources(f.workflow,subset);
  assert.equal(preview.plans.length,1);assert(preview.plans[0].recipe.planId.length<=100);
  assert.equal(flow.freezeTerrainEdgeSources(f.workflow,subset).maximumCalls,1);
  const incomplete=setupCoherent(t),base=flow.freezeCoherentSources(incomplete.workflow,incomplete.options),incompleteBefore=flow.inspectWorkflow(incomplete.workflow);
  rejects(()=>flow.freezeTerrainEdgeSources(incomplete.workflow,{...f.edgeOptions,baseBatchSha256:base.sha256,capabilitiesSha256:incomplete.options.capabilitiesSha256}),'TERRAIN_EDGE_MATERIAL');
  assert.deepEqual(flow.inspectWorkflow(incomplete.workflow),incompleteBefore);
});

test('fresh single-use batch executes checked native sources without changing RGBA or implying art acceptance',{timeout:240000},t=>{
  const f=setup(t),baseBefore=f.base.planSha256s.map(sha=>flow.getGenerationResult(f.workflow,sha)),batch=flow.freezeTerrainEdgeSources(f.workflow,f.edgeOptions);
  flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('edge.compute',batch.sha256,'approve-compute'));
  for(const [index,sha]of batch.planSha256s.entries()){
    const p=inspectPng(sourcePng(true,index+61),{includePixels:true});p.rgba.set([11,23,37,0],0);p.rgba[(120*p.width+150)*4+3]=119;
    const raw=encodeRgbaPng(p.width,p.height,p.rgba),result=receive(f.workflow,sha,raw);
    assert.equal(result.technical.status,'pass');assert.equal(result.technical.format,'ai_scene_terrain_edge_source_qa_v1');
    assert.equal(result.technical.semanticArtAcceptance,'not-assessed');assert.equal(result.technical.hiddenRgbPixels,1);
    assert.equal(flow.recheckResult(f.workflow,sha,hash(raw)).sha256,result.technical.sha256);
    assert.deepEqual(flow.getGenerationResult(f.workflow,sha).bytes,raw);rejects(()=>flow.reservePlan(f.workflow,sha),'RESERVATION_STATE');
  }
  const ready=flow.getTerrainEdgeInputs(f.workflow,batch.sha256);
  assert.equal(ready.sources.length,4);assert.equal(ready.reference.target.sha256,f.target.sha256);assert.deepEqual(ready.reference.raw,f.raw);
  assert(ready.sources.every(source=>source.status==='pending-visual-review'&&!source.review));
  assert.deepEqual(f.base.planSha256s.map(sha=>flow.getGenerationResult(f.workflow,sha)),baseBefore);
  const before=flow.inspectWorkflow(f.workflow);
  rejects(()=>flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('edge.repeat.compute',batch.sha256,'approve-compute')),'AUTHORIZATION_STATE');
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
});

test('unknown and technical-failed edges remain terminal and require a separately frozen fresh budget',{timeout:240000},t=>{
  const f=setup(t),batch=flow.freezeTerrainEdgeSources(f.workflow,{...f.edgeOptions,items:items().slice(0,2)});
  flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('edge.compute',batch.sha256,'approve-compute'));
  const {request,...ticket}=flow.reservePlan(f.workflow,batch.planSha256s[0]);flow.recordSubmission(f.workflow,ticket);flow.stopAttempt(f.workflow,ticket,'indeterminate');
  rejects(()=>flow.reservePlan(f.workflow,batch.planSha256s[0]),'RESERVATION_STATE');rejects(()=>flow.receiveResult(f.workflow,ticket,sourcePng(true,21)),'ATTEMPT_NOT_PENDING');
  const result=receive(f.workflow,batch.planSha256s[1],sourcePng(false,62));assert.equal(result.technical.status,'fail');assert(result.technical.issues.includes('COHERENT_NO_TRANSPARENCY'));
  rejects(()=>flow.getTerrainEdgeInputs(f.workflow,batch.sha256),'TERRAIN_EDGE_SOURCES_INCOMPLETE');
  const next=flow.freezeTerrainEdgeSources(f.workflow,{...f.edgeOptions,batchId:'edge.explicit.new',items:[items()[0]]});
  rejects(()=>flow.reservePlan(f.workflow,next.planSha256s[0]),'AUTHORIZATION_REQUIRED');
  const statuses=flow.inspectWorkflow(f.workflow).plans;assert.equal(statuses.find(p=>p.planSha256===batch.planSha256s[0]).status,'indeterminate');
  assert.equal(statuses.find(p=>p.planSha256===batch.planSha256s[1]).status,'rejected-technical');
});

test('binding checks reject wrong material, changed input fingerprints, missing capability and later source rejection',{timeout:240000},t=>{
  const f=setup(t),preview=flow.previewTerrainEdgeSources(f.workflow,{...f.edgeOptions,items:[items()[0]]}),plan=preview.plans[0];
  transact(f.workflow,store=>{
    const state=replay(store),compile=recipe=>compileTerrainEdgeSource(state,recipe,sha=>store.readBlob(sha));
    rejects(()=>compile({...plan.recipe,materialPlanSha256:f.base.planSha256s[1]}),'TERRAIN_EDGE_MATERIAL');
    rejects(()=>compile({...plan.recipe,materialRawSha256:'f'.repeat(64)}),'TERRAIN_EDGE_MATERIAL');
    const capability=state.capabilities.get(plan.recipe.capabilitiesSha256);state.capabilities.set(plan.recipe.capabilitiesSha256,{...capability,maxInputImages:1});
    rejects(()=>compile(plan.recipe),'TERRAIN_EDGE_CAPABILITY');state.capabilities.set(plan.recipe.capabilitiesSha256,capability);
    rejects(()=>compileTerrainEdgeSource(state,plan.recipe,()=>sourcePng(false,74)),'TERRAIN_EDGE_INPUT');
  });
  const body=unseal(plan),tampered=seal({...body,materialEvidence:{...body.materialEvidence,rawSha256:'0'.repeat(64)}});
  assert.notEqual(tampered.sha256,plan.sha256);assert.equal(assessTerrainEdgeSource(plan,sourcePng(false,17)).status,'fail');
  const batch=flow.freezeTerrainEdgeSources(f.workflow,{...f.edgeOptions,items:[items()[0]]}),material=flow.getGenerationResult(f.workflow,f.base.planSha256s[0]);
  flow.reviewResult(f.workflow,f.base.planSha256s[0],decision('material.art.reject',material.result.rawSha256,'reject'));
  rejects(()=>flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('must.not.compute',batch.sha256,'approve-compute')),'TERRAIN_EDGE_BASE_INCOMPLETE');
});
