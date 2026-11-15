import test from 'node:test';
import assert from 'node:assert/strict';
import fs,{readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
import * as flow from '../src/generation/index.mjs';
import * as pipeline from '../src/coherent-pipeline.mjs';
import {COHERENT_POLICY} from '../src/generation/coherent-source.mjs';
import {LAYER_SOURCE_INTENT,LAYER_SOURCE_POLICY} from '../src/generation/layer-source.mjs';
import {sourceVisualGuide,SOURCE_VISUAL_GUIDE_PROFILE} from '../src/generation/source-visual-guide.mjs';
import {hash,jsonBytes,seal,unseal} from '../src/generation/common.mjs';
import {encodeRgbaPng} from '../src/png.mjs';
import {setupCoherent,sourcePng} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';

const rejects=(fn,code)=>assert.throws(fn,e=>e.errors?.some(issue=>issue.code===code));
const readJson=path=>JSON.parse(readFileSync(path,'utf8'));
function withTransactionCount(operation){
  const original=fs.openSync;let transactions=0;
  fs.openSync=(path,...args)=>{if(String(path).endsWith('.lock'))transactions++;return original(path,...args);};syncBuiltinESMExports();
  try{return {value:operation(),transactions};}finally{fs.openSync=original;syncBuiltinESMExports();}
}
function setup(t){
  const f=setupCoherent(t),project=readJson(join(f.root,'project.json'));
  // Historical v1 project fixture: only the metadata wrapper is synthetic.
  writeFileSync(join(f.root,'coherent-project.json'),jsonBytes(seal({format:'ai_scene_coherent_project_v1',projectId:project.projectId,
    referenceProjectSha256:project.sha256,policySha256:COHERENT_POLICY.sha256})));
  writeFileSync(join(f.root,'coherent-policy.json'),jsonBytes(COHERENT_POLICY));
  return f;
}
// The previous getter-based algorithm is retained here as a compatibility
// oracle, not used by the optimized production path.
function legacyInspection(f){
  const state=flow.inspectWorkflow(f.workflow),ref=state.plans.findLast(p=>p.current&&p.stage==='reference');
  const batches=state.batches.map(sha=>{try{return flow.getCoherentSourceBatch(f.workflow,sha);}catch{return null;}}).filter(b=>b?.referencePlanSha256===ref?.planSha256);
  const batch=batches.at(-1),sources=batch?.planSha256s.map(sha=>state.plans.find(p=>p.planSha256===sha))??[],rp=readJson(join(f.root,'project.json'));
  let stage='awaiting-design-review';
  if(state.activeSpecSha256===rp.specSha256&&state.activeStyleSha256===rp.styleSha256)stage=!ref?'reference-plan-needed':ref.status==='planned'?'awaiting-reference-compute'
    :ref.status==='authorized'?'ready-to-generate-reference':ref.status==='pending-visual-review'?'awaiting-reference-review':ref.status!=='accepted'?'attention-required'
      :!batch?'source-batch-needed':sources.some(s=>!s?.current||['failed','indeterminate','rejected-technical','rejected-visual','reserved','submitted'].includes(s.status))?'attention-required'
        :sources.every(s=>s.received)?'ready-to-deliver':sources.some(s=>s.status==='planned')?'awaiting-source-compute':'ready-to-generate-sources';
  return {format:'ai_scene_coherent_status_v1',projectId:state.projectId,stage,policySha256:COHERENT_POLICY.sha256,
    design:{specSha256:rp.specSha256,styleSha256:rp.styleSha256},reference:ref??null,batchSha256:batch?.sha256??null,sources,
    maximumSourceCalls:batch?.maximumCalls??null,remainingSourceCalls:sources.filter(s=>!s.received).length,eventCount:state.eventCount,
    geometryAnalysis:'agent-or-explicit-host-planner-data-not-pixel-segmentation',fullArtAcceptance:'not-assessed',automaticRetry:false,productionKit:false};
}
function legacySnapshot(f){
  const status=legacyInspection(f),batch=status.batchSha256?flow.getCoherentSourceBatch(f.workflow,status.batchSha256):null;
  const shas=status.stage.includes('reference')?[status.reference.planSha256]:batch.planSha256s;
  if(batch?.format==='ai_scene_coherent_source_batch_v2'&&!status.stage.includes('reference')){
    const all=shas.map(sha=>flow.getGenerationPlan(f.workflow,sha)),plans=all.filter(p=>p.request.maximumCalls>0),preparedSources=all.filter(p=>p.request.maximumCalls===0);
    const newAuthorizationRequiredPlanSha256s=status.sources.filter(s=>s.status==='planned'&&s.maximumCalls>0).map(s=>s.planSha256);
    return seal({format:'ai_scene_coherent_compute_snapshot_v2',projectId:status.projectId,targetSha256:batch.sha256,policy:COHERENT_POLICY,plans,preparedSources,
      maximumCalls:plans.reduce((n,p)=>n+p.request.maximumCalls,0),remainingCalls:status.remainingSourceCalls,
      authorizationUsage:newAuthorizationRequiredPlanSha256s.length?'new-digest-bound-authorization-required':'existing-unsubmitted-authorizations-only',newAuthorizationRequiredPlanSha256s,
      unusedAuthorizationPlanSha256s:status.sources.filter(s=>s.status==='authorized'&&!s.reserved&&s.maximumCalls>0).map(s=>s.planSha256),generationCalls:0,executable:false});
  }
  return seal({format:'ai_scene_coherent_compute_snapshot_v1',projectId:status.projectId,targetSha256:status.stage.includes('reference')?status.reference.planSha256:batch.sha256,
    policy:COHERENT_POLICY,plans:shas.map(sha=>flow.getGenerationPlan(f.workflow,sha)),maximumCalls:shas.length,
    remainingCalls:status.stage.includes('reference')?1:status.remainingSourceCalls,generationCalls:0,executable:false});
}
function legacyPacket(f){
  const snapshot=legacySnapshot(f),files=new Map([['compute-snapshot.json',jsonBytes(snapshot)]]),scoped=snapshot.plans.filter(p=>p.sourceScope?.profile===LAYER_SOURCE_INTENT);
  if(scoped.length)files.set('source-scope-review.json',jsonBytes(seal({format:'ai_scene_layer_source_review_v1',targetSha256:snapshot.targetSha256,policy:LAYER_SOURCE_POLICY,
    sources:scoped.map(p=>({planSha256:p.sha256,assetId:p.recipe.assetId,role:p.instanceBinding.role,alpha:p.target.alpha,scope:p.sourceScope.definition,
      observedEnvelope:p.instanceBinding.observedEnvelope,layoutUsage:'assembly-only-not-image-prompt',semanticIsolation:'requires-visual-review'})),generationCalls:0})));
  const visual=scoped.find(p=>p.sourceScope.definition.visualCoherence)?.sourceScope.definition.visualCoherence;if(visual)files.set('visual-coherence.json',jsonBytes(visual));
  for(const [index,plan]of snapshot.plans.entries()){
    files.set(`prompt-${index+1}.txt`,Buffer.from(plan.request.prompt));
    for(let n=0;n<plan.request.images.length;n++)files.set(`input-${index+1}-${n+1}.png`,flow.readGenerationInput(f.workflow,plan.sha256,n));
  }
  for(const [index,plan]of (snapshot.preparedSources??[]).entries())files.set(`prepared-source-${index+1}.json`,jsonBytes(plan));
  files.set('proof-bundle.json',jsonBytes(seal({format:'ai_scene_coherent_compute_review_bundle_v1',snapshotSha256:snapshot.sha256,
    artifacts:[...files].map(([path,bytes])=>({path,sha256:hash(bytes),byteLength:bytes.length})),generationCalls:0})));
  return files;
}
function legacySurfaceInputs(f){
  const status=legacyInspection(f);assert.equal(status.stage,'ready-to-deliver');
  const batch=flow.getCoherentSourceBatch(f.workflow,status.batchSha256),target=flow.getReferenceReconstructionTarget(f.workflow,status.reference.planSha256);
  const materials=batch.planSha256s.map(sha=>flow.getGenerationPlan(f.workflow,sha)).filter(plan=>plan.instanceBinding.role==='material');
  assert.equal(materials.length,1);
  const plan=materials[0],reference=flow.getGenerationResult(f.workflow,status.reference.planSha256),material=flow.getGenerationResult(f.workflow,plan.sha256);
  assert.equal(status.reference.status,'accepted');assert.equal(reference.result.rawSha256,target.rawSha256);assert.equal(hash(reference.bytes),target.rawSha256);
  assert.equal(plan.referenceEvidence[0].rawSha256,target.rawSha256);assert.equal(material.result.technical.status,'pass');assert.equal(material.result.rawSha256,hash(material.bytes));
  return {reference:{raw:reference.bytes,planSha256:status.reference.planSha256,rawSha256:target.rawSha256},
    material:{raw:material.bytes,planSha256:plan.sha256,rawSha256:material.result.rawSha256,assetId:plan.recipe.assetId},target,batch};
}
function assertPacket(f,out,expected){
  const read=withTransactionCount(()=>pipeline.exportCoherentComputeReview(f.root,out));assert.equal(read.transactions,1);
  assert.equal(readdirSync(out).length,expected.size);
  for(const [path,bytes]of expected)assert.deepEqual(readFileSync(join(out,path)),bytes,path);
  assert.equal(withTransactionCount(()=>pipeline.exportCoherentComputeReview(f.root,out)).transactions,1);
}
function narrowSource(){
  const width=320,height=256,rgba=Buffer.alloc(width*height*4);
  for(let y=35;y<220;y++)for(let x=6;x<314;x++)rgba.set([40+x%130,75+y%90,115,255],(y*width+x)*4);
  return encodeRgbaPng(width,height,rgba);
}
function history(t){
  const f=setup(t),scopes=flow.createLayerSourceScopes(f.brief.requirements);
  const base=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:scopes});
  flow.authorizeReferenceAssetBatch(f.workflow,base.sha256,decision('sources.compute',base.sha256,'approve-compute'));
  const source=base.planSha256s[2],{request,...ticket}=flow.reservePlan(f.workflow,source);flow.recordSubmission(f.workflow,ticket);
  assert.equal(flow.receiveResult(f.workflow,ticket,narrowSource()).technical.status,'pass');
  const preview=flow.proposeCoherentCanvasGutterPreparation(f.workflow,source,base.sha256);
  const prepared=flow.prepareAndAdoptCoherentCanvasGutterSource(f.workflow,{preparationId:'read.preparation',proposal:preview.proposal,
    receipt:decision('canvas.accept',preview.proposal.sha256),parentBatchSha256:base.sha256,batchId:'read.prepared'});
  let batch=prepared.batch;
  for(let index=0;index<3;index++){
    const plan=flow.getGenerationPlan(f.workflow,batch.planSha256s.at(-2));
    batch=flow.reviseCoherentSources(f.workflow,batch.sha256,{batchId:'read.revision.'+index,replacements:[{assetId:plan.recipe.assetId,
      planId:'read.front.'+index,intent:LAYER_SOURCE_INTENT,sourceScope:flow.withSourceVisualGuide(plan.recipe.sourceScope)}]});
  }
  return {...f,base,batch,plainFront:flow.getGenerationPlan(f.workflow,base.planSha256s.at(-2)).recipe.sourceScope};
}

test('v1 source inspection, snapshot and exact review keep previous bytes with one fresh transaction per read',t=>{
  const f=setup(t);flow.freezeCoherentSources(f.workflow,f.options);
  const before=flow.inspectWorkflow(f.workflow),view=withTransactionCount(()=>flow.readCoherentWorkflowView(f.workflow));
  assert.equal(view.transactions,1);assert.deepEqual(view.value.inspection,before);assert.equal(view.value.inputs.size,0);
  for(const plan of view.value.plans)assert.deepEqual(plan,flow.getGenerationPlan(f.workflow,plan.sha256));
  const expected=legacyInspection(f),inspection=withTransactionCount(()=>pipeline.inspectCoherentPipeline(f.root));
  assert.equal(inspection.transactions,1);assert.deepEqual(jsonBytes(inspection.value),jsonBytes(expected));
  const snapshot=withTransactionCount(()=>pipeline.coherentComputeSnapshot(f.root));assert.equal(snapshot.transactions,1);
  assert.deepEqual(jsonBytes(snapshot.value),jsonBytes(legacySnapshot(f)));
  assertPacket(f,join(f.parent,'old-v1-packet'),legacyPacket(f));assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
});

test('revised v2 prepared/guided snapshots and two-input packets keep all previous bytes without history getter replays',{timeout:120000},t=>{
  const f=history(t),before=flow.inspectWorkflow(f.workflow),guide=sourceVisualGuide(SOURCE_VISUAL_GUIDE_PROFILE);
  const view=withTransactionCount(()=>flow.readCoherentWorkflowView(f.workflow,{includeCurrentInputs:true}));assert.equal(view.transactions,1);
  assert.deepEqual(view.value.inspection,before);assert.equal(view.value.batches.length,5);assert.equal(view.value.inputs.size,2);
  assert.deepEqual(view.value.inputs.get(hash(f.raw)),f.raw);assert.deepEqual(view.value.inputs.get(guide.artifact.sha256),guide.bytes);
  assert.throws(()=>{view.value.plans.at(-1).request.prompt='changed';},TypeError);
  view.value.inputs.get(guide.artifact.sha256).fill(0);
  assert.deepEqual(flow.readCoherentWorkflowView(f.workflow,{includeCurrentInputs:true}).inputs.get(guide.artifact.sha256),guide.bytes,'caller mutation cannot alter a subsequent fresh read');
  const inspection=withTransactionCount(()=>pipeline.inspectCoherentPipeline(f.root));assert.equal(inspection.transactions,1);
  assert.deepEqual(jsonBytes(inspection.value),jsonBytes(legacyInspection(f)));
  const snapshot=withTransactionCount(()=>pipeline.coherentComputeSnapshot(f.root));assert.equal(snapshot.transactions,1);
  assert.equal(snapshot.value.format,'ai_scene_coherent_compute_snapshot_v2');assert.equal(snapshot.value.preparedSources.length,1);
  assert.deepEqual(jsonBytes(snapshot.value),jsonBytes(legacySnapshot(f)));
  assertPacket(f,join(f.parent,'v2-guided-packet'),legacyPacket(f));assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
});

test('views never cache authorizations or writes and select only the current batch input set',{timeout:120000},t=>{
  const f=history(t),oldView=flow.readCoherentWorkflowView(f.workflow,{includeCurrentInputs:true}),oldSnapshot=pipeline.coherentComputeSnapshot(f.root);
  const guided=flow.getGenerationPlan(f.workflow,f.batch.planSha256s.at(-2));
  const next=flow.reviseCoherentSources(f.workflow,f.batch.sha256,{batchId:'read.remove.guide',replacements:[{assetId:guided.recipe.assetId,
    planId:'read.plain.front',intent:LAYER_SOURCE_INTENT,sourceScope:f.plainFront}]});
  const current=flow.readCoherentWorkflowView(f.workflow,{includeCurrentInputs:true});assert.equal(current.inputs.size,1);assert(current.inputs.has(hash(f.raw)));
  assert(current.plans.some(plan=>plan.sha256===guided.sha256),'historical guided metadata is retained while its input is not selected');
  assert.equal(oldView.inputs.size,2);assert.notEqual(pipeline.coherentComputeSnapshot(f.root).sha256,oldSnapshot.sha256);
  flow.authorizeReferenceAssetBatch(f.workflow,next.sha256,decision('new.batch.compute',next.sha256,'approve-compute'));
  const authorized=pipeline.coherentComputeSnapshot(f.root);assert.deepEqual(authorized.newAuthorizationRequiredPlanSha256s,[]);
  const active=next.planSha256s.at(-2);assert.equal(flow.readCoherentWorkflowView(f.workflow).inspection.plans.find(p=>p.planSha256===active).status,'authorized');
  flow.reservePlan(f.workflow,active);rejects(()=>flow.reservePlan(f.workflow,active),'RESERVATION_STATE');
  rejects(()=>pipeline.coherentComputeSnapshot(f.root),'COHERENT_COMPUTE_STATE');
  assert.equal(flow.readCoherentWorkflowView(f.workflow).inspection.plans.find(p=>p.planSha256===active).status,'reserved');
});

test('every view still verifies all stored bytes and project bindings after earlier successful reads',t=>{
  const f=setup(t),batch=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:flow.createLayerSourceScopes(f.brief.requirements)});
  flow.readCoherentWorkflowView(f.workflow);pipeline.coherentComputeSnapshot(f.root);
  const blob=join(f.workflow,'blobs',hash(f.raw)+'.bin');
  try{writeFileSync(blob,Buffer.from('altered native bytes'));rejects(()=>flow.readCoherentWorkflowView(f.workflow),'BLOB_INTEGRITY');
    rejects(()=>pipeline.inspectCoherentPipeline(f.root),'BLOB_INTEGRITY');rejects(()=>pipeline.exportCoherentComputeReview(f.root,join(f.parent,'blocked-packet')),'BLOB_INTEGRITY');}
  finally{writeFileSync(blob,f.raw);}
  const policyPath=join(f.root,'coherent-policy.json'),policy=readFileSync(policyPath);
  try{writeFileSync(policyPath,jsonBytes(seal({...unseal(COHERENT_POLICY),priority:['changed']})));rejects(()=>pipeline.inspectCoherentPipeline(f.root),'COHERENT_PROJECT');}
  finally{writeFileSync(policyPath,policy);}
  assert.equal(pipeline.inspectCoherentPipeline(f.root).batchSha256,batch.sha256);
});

test('surface inputs preserve exact target/native bytes with four reads across prepared and guided history',{timeout:120000},t=>{
  const f=history(t);
  const blocked=withTransactionCount(()=>rejects(()=>pipeline.coherentSurfaceInputs(f.root),'COHERENT_SURFACE_REVIEW_STATE'));
  assert.equal(blocked.transactions,1,'incomplete source batches stop after the first fresh view');
  flow.authorizeReferenceAssetBatch(f.workflow,f.batch.sha256,decision('surface.current.compute',f.batch.sha256,'approve-compute'));
  const view=flow.readCoherentWorkflowView(f.workflow),plans=new Map(view.plans.map(plan=>[plan.sha256,plan]));
  for(const sha of f.batch.planSha256s){const row=view.inspection.plans.find(row=>row.planSha256===sha);if(row.received)continue;
    const plan=plans.get(sha),{request,...ticket}=flow.reservePlan(f.workflow,sha);flow.recordSubmission(f.workflow,ticket);
    const raw=plan.instanceBinding.role==='material'?sourcePng(false,19):plan.target.alpha==='transparent'?narrowSource():sourcePng(false,20);
    assert.equal(flow.receiveResult(f.workflow,ticket,raw).technical.status,'pass');
  }
  const before=flow.inspectWorkflow(f.workflow),expected=legacySurfaceInputs(f),read=withTransactionCount(()=>pipeline.coherentSurfaceInputs(f.root));
  assert.equal(read.transactions,4);assert.deepEqual(read.value,expected);assert.equal(read.value.target.sha256,f.target.sha256);
  assert.deepEqual(read.value.reference.raw,f.raw);assert.deepEqual(read.value.material.raw,sourcePng(false,19));
  assert.equal(read.value.material.rawSha256,hash(read.value.material.raw));assert.equal(read.value.reference.rawSha256,read.value.target.rawSha256);
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
  const materialBlob=join(f.workflow,'blobs',read.value.material.rawSha256+'.bin');
  try{writeFileSync(materialBlob,sourcePng(false,21));rejects(()=>pipeline.coherentSurfaceInputs(f.root),'BLOB_INTEGRITY');}
  finally{writeFileSync(materialBlob,read.value.material.raw);}
  const referenceBlob=join(f.workflow,'blobs',read.value.reference.rawSha256+'.bin');
  try{writeFileSync(referenceBlob,sourcePng(false,22));rejects(()=>pipeline.coherentSurfaceInputs(f.root),'BLOB_INTEGRITY');}
  finally{writeFileSync(referenceBlob,read.value.reference.raw);}
  assert.deepEqual(pipeline.coherentSurfaceInputs(f.root),expected);
});
