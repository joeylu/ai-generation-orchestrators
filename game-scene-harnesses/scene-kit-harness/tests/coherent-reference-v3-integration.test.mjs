import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as flow from '../src/generation/index.mjs';
import * as reference from '../src/reference-led-pipeline.mjs';
import {compileCoherentReferenceV3} from '../src/generation/coherent-reference-v3.mjs';
import {assertCurrent} from '../src/generation/compiler.mjs';
import {transact} from '../src/generation/store.mjs';
import {applyRecord,replay} from '../src/generation/model.mjs';
import {hash,seal,unseal,digest} from '../src/generation/common.mjs';
import {inspectPng,encodeRgbaPng} from '../src/png.mjs';
import {coherentBrief,coherentAnalysis,referencePng,sourcePng} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';
const rejects=(fn,code)=>assert.throws(fn,error=>error.errors?.some(issue=>issue.code===code));
function fixture(t){
  const parent=mkdtempSync(join(tmpdir(),'coherent-reference-v3-'));t.after(()=>rmSync(parent,{recursive:true,force:true}));
  const root=join(parent,'project'),brief=coherentBrief('Synthetic soft city composition'),initial=reference.initReferenceLedProject(root,brief,{purpose:'synthetic-simulation'});
  const workflow=join(root,'workflow'),capabilitiesSha256=JSON.parse(readFileSync(join(root,'capabilities.json'),'utf8')).sha256,
    options={planId:'reference.fixture',parents:[],capabilitiesSha256,pixelPolicy:{mode:'native-reference',orientation:'landscape',minimumShortEdge:256,maximumWidth:4096,maximumHeight:4096},intent:''};
  return {root,parent,brief,workflow,initial,options};
}
function guide(f){
  const bytes=sourcePng(false,158),options={guideId:'guide.fixture',specSha256:f.initial.design.specSha256,receipt:decision('guide.accept',hash(bytes))};
  return {bytes,options,record:flow.importCoherentCompositionGuide(f.workflow,options,bytes)};
}
function reviewed(f){reference.reviewReferenceLedDesign(f.root,{spec:decision('fixture.spec',f.initial.design.specSha256),style:decision('fixture.style',f.initial.design.styleSha256)});}
const v3=(f,g)=>({...f.options,referenceGuidanceProfile:'soft-composition-v3',compositionGuideSha256:g.record.sha256});

test('guide import binds original bytes, existing draft requirements and a globally single-use image review without activating the draft',t=>{
  const f=fixture(t),before=flow.inspectWorkflow(f.workflow);assert.equal(Object.hasOwn(before,'compositionGuides'),false);
  transact(f.workflow,store=>assert.equal(Object.hasOwn(replay(store),'compositionGuides'),false));
  const g=guide(f),status=flow.inspectWorkflow(f.workflow);
  assert.equal(status.activeSpecSha256,'');assert.equal(status.plans.length,0);assert.equal(status.eventCount,before.eventCount+1);
  assert.deepEqual(status.compositionGuides,[{sha256:g.record.sha256,specSha256:f.initial.design.specSha256,
    requirementsSha256:f.brief.requirements.sha256,imageSha256:hash(g.bytes)}]);
  assert.equal(g.record.generationCalls,0);assert.equal(g.record.sourcePngModified,false);
  assert.deepEqual(flow.getCoherentCompositionGuide(f.workflow,g.record.sha256),g.record);
  assert.deepEqual(flow.readWorkflowImage(f.workflow,g.record.image),g.bytes);
  for(const options of [{...g.options,guideId:'another.guide'}, {...g.options,receipt:decision('another.review',hash(g.bytes))},
    {...g.options,guideId:'wrong.target',receipt:decision('wrong.target','0'.repeat(64))},
    {...g.options,guideId:'compute.review',receipt:decision('wrong.compute',hash(g.bytes),'approve-compute')},
    {...g.options,guideId:'unknown.option',cleanup:true}]){
    assert.throws(()=>flow.importCoherentCompositionGuide(f.workflow,options,g.bytes));assert.deepEqual(flow.inspectWorkflow(f.workflow),status);
  }
  assert.throws(()=>flow.previewCoherentReferenceV3(f.workflow,v3(f,g)));assert.deepEqual(flow.inspectWorkflow(f.workflow),status);
  transact(f.workflow,store=>{
    const state=replay(store),body=unseal(g.record);
    assert.throws(()=>applyRecord(store,state,seal({...body,requirementsSha256:'a'.repeat(64)})));
    assert.throws(()=>applyRecord(store,state,seal({...body,image:{...body.image,sha256:'b'.repeat(64)}})));
  });
});

test('V3 preview is read-only, freezes exactly three ordered inputs, and refuses guide or format tampering before authorization',t=>{
  const f=fixture(t),g=guide(f);reviewed(f);
  const options=v3(f,g),before=flow.inspectWorkflow(f.workflow),preview=flow.previewCoherentReferenceV3(f.workflow,options);
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);assert.equal(preview.format,'ai_scene_generation_plan_v32');
  assert.equal(preview.request.format,'ai_scene_image_request_v32');assert.equal(preview.request.images.length,3);assert.equal(preview.request.maximumCalls,1);
  assert.equal(preview.request.images[2].role,'accepted-soft-composition-guide');assert.deepEqual(preview.request.images[2].artifact,g.record.image);
  assert.equal(preview.compositionGuideEvidence.compositionGuideSha256,g.record.sha256);
  assert.equal(preview.compositionGuideEvidence.receiptSha256,digest(g.record.receipt));assert.equal(preview.compositionGuideEvidence.pixelLocking,false);
  for(const bad of [{...options,compositionGuideSha256:'0'.repeat(64)},{...options,referenceGuidanceProfile:'isolated-component-v2'},
    {...options,implicitRetry:true}]){assert.throws(()=>flow.freezeCoherentReferenceV3(f.workflow,bad));assert.deepEqual(flow.inspectWorkflow(f.workflow),before);}
  const plan=flow.freezeCoherentReferenceV3(f.workflow,options);assert.equal(plan.sha256,preview.sha256);
  assert.deepEqual(flow.readGenerationInput(f.workflow,plan.sha256,2),g.bytes);
  const summary=flow.inspectWorkflow(f.workflow).plans[0];assert.equal(summary.referenceGuidanceProfile,'soft-composition-v3');assert.equal(summary.compositionGuideSha256,g.record.sha256);
  assert.equal(reference.inspectReferenceLedProject(f.root).reference.planSha256,plan.sha256);
  rejects(()=>flow.reservePlan(f.workflow,plan.sha256),'AUTHORIZATION_REQUIRED');
  transact(f.workflow,store=>{
    const state=replay(store),body=unseal(plan);
    rejects(()=>applyRecord(store,state,seal({...body,request:{...body.request,prompt:'tampered'}})),'PLAN_RECOMPILE_MISMATCH');
    rejects(()=>assertCurrent(state,{...plan,compositionGuideEvidence:{...plan.compositionGuideEvidence,imageSha256:'0'.repeat(64)}}),'COMPOSITION_GUIDE_BINDING');
    assert.throws(()=>compileCoherentReferenceV3(state,plan.recipe,()=>referencePng()));
  });
});

test('V32 reference receives and rechecks, requires its measured packet, then freezes fresh reference-bound sources',t=>{
  const f=fixture(t),g=guide(f);reviewed(f);const plan=flow.freezeCoherentReferenceV3(f.workflow,v3(f,g)),raw=referencePng();
  flow.authorizePlan(f.workflow,plan.sha256,decision('reference.compute',plan.sha256,'approve-compute'));
  const {request,...ticket}=flow.reservePlan(f.workflow,plan.sha256);assert.equal(request.images.length,3);flow.recordSubmission(f.workflow,ticket);
  const result=flow.receiveResult(f.workflow,ticket,raw);assert.equal(result.technical.status,'pass');assert.equal(result.technical.format,'ai_scene_reference_led_qa_v1');
  assert.equal(flow.recheckResult(f.workflow,plan.sha256,hash(raw)).sha256,result.technical.sha256);
  rejects(()=>flow.reviewResult(f.workflow,plan.sha256,decision('raw.accept',hash(raw))),'STANDARD_REFERENCE_REVIEW_REQUIRED');
  const analysis=coherentAnalysis(plan,hash(raw),f.brief.requirements),packet=flow.buildMeasuredReferenceReview(f.workflow,plan.sha256,analysis,join(f.parent,'review'));
  flow.reviewMeasuredReference(f.workflow,plan.sha256,analysis,decision('packet.accept',packet.packetSha256));
  assert.equal(reference.inspectReferenceLedProject(f.root).reference.status,'accepted');assert.equal(flow.getReferenceReconstructionTarget(f.workflow,plan.sha256).rawSha256,hash(raw));
  const options={batchId:'v32.sources',referencePlanSha256:plan.sha256,capabilitiesSha256:f.options.capabilitiesSha256,sourceScopes:flow.createLayerSourceScopes(f.brief.requirements)},
    preview=flow.previewCoherentSources(f.workflow,options),batch=flow.freezeCoherentSources(f.workflow,options);
  assert.equal(preview.generationCalls,0);assert.equal(batch.sha256,preview.batch.sha256);
  assert(preview.plans.every(p=>p.referenceEvidence[0].planSha256===plan.sha256));rejects(()=>flow.reservePlan(f.workflow,batch.planSha256s[0]),'AUTHORIZATION_REQUIRED');
  assert.deepEqual(flow.getGenerationResult(f.workflow,plan.sha256).bytes,raw);rejects(()=>flow.reservePlan(f.workflow,plan.sha256),'RESERVATION_STATE');
});

test('V32 unknown stays terminal and explicit revision preserves the exact soft guide without borrowing authorization',t=>{
  const f=fixture(t),g=guide(f);reviewed(f);const plan=flow.freezeCoherentReferenceV3(f.workflow,v3(f,g));
  flow.authorizePlan(f.workflow,plan.sha256,decision('reference.compute',plan.sha256,'approve-compute'));
  const {request,...ticket}=flow.reservePlan(f.workflow,plan.sha256);flow.recordSubmission(f.workflow,ticket);flow.stopAttempt(f.workflow,ticket,'indeterminate');
  rejects(()=>flow.reservePlan(f.workflow,plan.sha256),'RESERVATION_STATE');rejects(()=>flow.receiveResult(f.workflow,ticket,referencePng()),'ATTEMPT_NOT_PENDING');
  const next=flow.reviseGenerationPlan(f.workflow,plan.sha256,{planId:'reference.revised',capabilitiesSha256:f.options.capabilitiesSha256,intent:'Preserve semantic groups and relative occlusion.'});
  assert.equal(next.format,'ai_scene_generation_plan_v32');assert.equal(next.recipe.referenceGuidanceProfile,'soft-composition-v3');
  assert.equal(next.recipe.compositionGuideSha256,g.record.sha256);assert.deepEqual(next.recipe.parents,[plan.sha256]);assert.deepEqual(next.request.images,plan.request.images);
  rejects(()=>flow.reservePlan(f.workflow,next.sha256),'AUTHORIZATION_REQUIRED');assert.equal(flow.inspectWorkflow(f.workflow).plans[0].status,'indeterminate');
});

test('accepted guide transparency and hidden RGB remain original bytes through plan replay and input export',t=>{
  const f=fixture(t),png=inspectPng(sourcePng(false,159),{includePixels:true});png.rgba[3]=0;
  const bytes=encodeRgbaPng(png.width,png.height,png.rgba),record=flow.importCoherentCompositionGuide(f.workflow,
    {guideId:'guide.rgba',specSha256:f.initial.design.specSha256,receipt:decision('rgba.guide.accept',hash(bytes))},bytes);
  reviewed(f);const plan=flow.freezeCoherentReferenceV3(f.workflow,v3(f,{record}));
  assert.equal(flow.inspectWorkflow(f.workflow).plans[0].compositionGuideSha256,record.sha256);
  assert.deepEqual(flow.readGenerationInput(f.workflow,plan.sha256,2),bytes);
  const exported=inspectPng(flow.readGenerationInput(f.workflow,plan.sha256,2),{includePixels:true,allowHiddenRgb:true});
  assert.deepEqual(exported.rgba.subarray(0,4),png.rgba.subarray(0,4));assert(exported.rgba[0]>0);
  rejects(()=>flow.reservePlan(f.workflow,plan.sha256),'AUTHORIZATION_REQUIRED');
});
