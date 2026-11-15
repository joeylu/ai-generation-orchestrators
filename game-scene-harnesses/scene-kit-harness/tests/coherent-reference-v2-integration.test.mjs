import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as flow from '../src/generation/index.mjs';
import * as reference from '../src/reference-led-pipeline.mjs';
import {compileCoherentReference,coherentReferenceGuides} from '../src/generation/coherent-reference.mjs';
import {coherentReferenceGuidesV2} from '../src/generation/coherent-reference-v2.mjs';
import {REFERENCE_GUIDANCE_PROFILE} from '../src/reference-controls-v2.mjs';
import {transact} from '../src/generation/store.mjs';
import {applyRecord,replay} from '../src/generation/model.mjs';
import {hash,digest,seal,unseal} from '../src/generation/common.mjs';
import {coherentBrief,coherentAnalysis,referencePng} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';

const rejects=(fn,code)=>assert.throws(fn,error=>error.errors?.some(issue=>issue.code===code));
function fixture(t){
  const parent=mkdtempSync(join(tmpdir(),'coherent-reference-v2-'));t.after(()=>rmSync(parent,{recursive:true,force:true}));
  const root=join(parent,'project'),brief=coherentBrief('Synthetic engineered city'),initial=reference.initReferenceLedProject(root,brief,{purpose:'synthetic-simulation'});
  reference.reviewReferenceLedDesign(root,{spec:decision('fixture.spec',initial.design.specSha256),style:decision('fixture.style',initial.design.styleSha256)});
  const workflow=join(root,'workflow'),capabilitiesSha256=JSON.parse(readFileSync(join(root,'capabilities.json'),'utf8')).sha256;
  const options={planId:'reference.fixture',parents:[],capabilitiesSha256,pixelPolicy:{mode:'native-reference',orientation:'landscape',
    minimumShortEdge:256,maximumWidth:4096,maximumHeight:4096},intent:''};
  return {root,parent,brief,workflow,options,v2:{...options,referenceGuidanceProfile:REFERENCE_GUIDANCE_PROFILE}};
}

test('explicit V2 preview freezes v31 with checked V2 guide bytes while the old API remains v28',t=>{
  const f=fixture(t),before=flow.inspectWorkflow(f.workflow),legacy=flow.previewCoherentReference(f.workflow,f.options),preview=flow.previewCoherentReferenceV2(f.workflow,f.v2);
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);assert.equal(preview.format,'ai_scene_generation_plan_v31');
  assert.equal(preview.request.format,'ai_scene_image_request_v31');assert.equal(preview.recipe.referenceGuidanceProfile,REFERENCE_GUIDANCE_PROFILE);
  assert.equal(preview.request.maximumCalls,1);assert.equal(preview.request.images.length,2);
  assert.equal(legacy.format,'ai_scene_generation_plan_v28');assert.equal(Object.hasOwn(legacy.recipe,'referenceGuidanceProfile'),false);
  assert.equal(preview.request.images[0].artifact.sha256,legacy.request.images[0].artifact.sha256);
  assert.notEqual(preview.request.images[1].artifact.sha256,legacy.request.images[1].artifact.sha256);
  transact(f.workflow,store=>assert.equal(compileCoherentReference(replay(store),legacy.recipe).sha256,legacy.sha256));
  for(const options of [f.options,{...f.v2,referenceGuidanceProfile:'unknown'},{...f.v2,automaticRetry:true}]){
    assert.throws(()=>flow.freezeCoherentReferenceV2(f.workflow,options));assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
  }
  rejects(()=>flow.freezeCoherentReference(f.workflow,f.v2),'WORKFLOW_SHAPE');
  const plan=flow.freezeCoherentReferenceV2(f.workflow,f.v2);assert.equal(plan.sha256,preview.sha256);
  assert.equal(flow.inspectWorkflow(f.workflow).eventCount,before.eventCount+1);
  assert.equal(flow.inspectWorkflow(f.workflow).plans[0].referenceGuidanceProfile,REFERENCE_GUIDANCE_PROFILE);
  assert.equal(reference.inspectReferenceLedProject(f.root).reference.planSha256,plan.sha256);
  coherentReferenceGuidesV2().forEach((guide,index)=>{
    assert.equal(hash(guide.bytes),plan.request.images[index].artifact.sha256);
    assert.deepEqual(flow.readGenerationInput(f.workflow,plan.sha256,index),guide.bytes);
  });
  rejects(()=>flow.reservePlan(f.workflow,plan.sha256),'AUTHORIZATION_REQUIRED');
  transact(f.workflow,store=>{
    const state=replay(store),body=unseal(plan);
    rejects(()=>applyRecord(store,state,seal({...body,request:{...body.request,prompt:'tampered'}})),'PLAN_RECOMPILE_MISMATCH');
    assert.throws(()=>applyRecord(store,state,seal({...body,recipe:{...body.recipe,referenceGuidanceProfile:'unknown'}})));
  });
  assert.equal(flow.inspectWorkflow(f.workflow).coreProviderCalls,0);
});

test('v31 receives, rechecks and accepts only its measured packet, then supplies reference-bound source plans',t=>{
  const f=fixture(t),plan=flow.freezeCoherentReferenceV2(f.workflow,f.v2),raw=referencePng();
  flow.authorizePlan(f.workflow,plan.sha256,decision('reference.compute',plan.sha256,'approve-compute'));
  const {request,...ticket}=flow.reservePlan(f.workflow,plan.sha256);assert.equal(request.format,'ai_scene_image_request_v31');
  flow.recordSubmission(f.workflow,ticket);const result=flow.receiveResult(f.workflow,ticket,raw);
  assert.equal(result.technical.status,'pass');assert.equal(result.technical.format,'ai_scene_reference_led_qa_v1');
  assert.equal(flow.recheckResult(f.workflow,plan.sha256,hash(raw)).sha256,result.technical.sha256);
  rejects(()=>flow.reviewResult(f.workflow,plan.sha256,decision('raw.accept',hash(raw))),'STANDARD_REFERENCE_REVIEW_REQUIRED');
  const analysis=coherentAnalysis(plan,hash(raw),f.brief.requirements),packet=flow.buildMeasuredReferenceReview(f.workflow,plan.sha256,analysis,join(f.parent,'review'));
  flow.reviewMeasuredReference(f.workflow,plan.sha256,analysis,decision('measured.accept',packet.packetSha256));
  assert.equal(flow.getReferenceReconstructionTarget(f.workflow,plan.sha256).rawSha256,hash(raw));
  assert.equal(reference.inspectReferenceLedProject(f.root).reference.status,'accepted');
  const options={batchId:'v31.sources',referencePlanSha256:plan.sha256,capabilitiesSha256:f.options.capabilitiesSha256,
    sourceScopes:flow.createLayerSourceScopes(f.brief.requirements)},preview=flow.previewCoherentSources(f.workflow,options);
  assert.equal(preview.generationCalls,0);assert(preview.plans.every(source=>source.referenceEvidence[0].planSha256===plan.sha256));
  const batch=flow.freezeCoherentSources(f.workflow,options);assert.equal(batch.sha256,preview.batch.sha256);
  rejects(()=>flow.reservePlan(f.workflow,batch.planSha256s[0]),'AUTHORIZATION_REQUIRED');
  rejects(()=>flow.reservePlan(f.workflow,plan.sha256),'RESERVATION_STATE');
  assert.deepEqual(flow.getGenerationResult(f.workflow,plan.sha256).bytes,raw);
});

test('v31 unknown is terminal and an explicit revision retains the guidance profile and needs fresh authorization',t=>{
  const f=fixture(t),plan=flow.freezeCoherentReferenceV2(f.workflow,f.v2);
  flow.authorizePlan(f.workflow,plan.sha256,decision('reference.compute',plan.sha256,'approve-compute'));
  const {request,...ticket}=flow.reservePlan(f.workflow,plan.sha256);flow.recordSubmission(f.workflow,ticket);flow.stopAttempt(f.workflow,ticket,'indeterminate');
  rejects(()=>flow.reservePlan(f.workflow,plan.sha256),'RESERVATION_STATE');
  rejects(()=>flow.receiveResult(f.workflow,ticket,referencePng()),'ATTEMPT_NOT_PENDING');
  const next=flow.reviseGenerationPlan(f.workflow,plan.sha256,{planId:'reference.revised',capabilitiesSha256:f.options.capabilitiesSha256,intent:'Keep declared support ownership.'});
  assert.equal(next.format,'ai_scene_generation_plan_v31');assert.equal(next.recipe.referenceGuidanceProfile,REFERENCE_GUIDANCE_PROFILE);
  assert.deepEqual(next.recipe.parents,[plan.sha256]);assert.equal(next.request.format,'ai_scene_image_request_v31');
  assert.deepEqual(next.request.images,plan.request.images);rejects(()=>flow.reservePlan(f.workflow,next.sha256),'AUTHORIZATION_REQUIRED');
  assert.equal(flow.inspectWorkflow(f.workflow).plans.find(p=>p.planSha256===plan.sha256).status,'indeterminate');
});

test('legacy v28 stays v28 on generic revision; upgrading a terminal v28 requires the explicit V2 entry',t=>{
  const f=fixture(t),legacy=flow.freezeCoherentReference(f.workflow,f.options);
  assert.equal(Object.hasOwn(flow.inspectWorkflow(f.workflow).plans[0],'referenceGuidanceProfile'),false);
  coherentReferenceGuides().forEach((guide,index)=>assert.deepEqual(flow.readGenerationInput(f.workflow,legacy.sha256,index),guide.bytes));
  flow.authorizePlan(f.workflow,legacy.sha256,decision('legacy.compute',legacy.sha256,'approve-compute'));
  const {request,...ticket}=flow.reservePlan(f.workflow,legacy.sha256);flow.recordSubmission(f.workflow,ticket);flow.stopAttempt(f.workflow,ticket,'indeterminate');
  const revised=flow.reviseGenerationPlan(f.workflow,legacy.sha256,{planId:'legacy.revised',capabilitiesSha256:f.options.capabilitiesSha256,intent:''});
  assert.equal(revised.format,'ai_scene_generation_plan_v28');assert.equal(Object.hasOwn(revised.recipe,'referenceGuidanceProfile'),false);
  const upgraded=flow.freezeCoherentReferenceV2(f.workflow,{...f.v2,planId:'reference.upgraded',parents:[legacy.sha256]});
  assert.equal(upgraded.format,'ai_scene_generation_plan_v31');assert.deepEqual(upgraded.recipe.parents,[legacy.sha256]);
  assert.notEqual(digest(upgraded.request),digest(legacy.request));rejects(()=>flow.reservePlan(f.workflow,upgraded.sha256),'AUTHORIZATION_REQUIRED');
});
