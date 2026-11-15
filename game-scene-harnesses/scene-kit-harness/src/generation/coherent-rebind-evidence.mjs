import {transact} from './store.mjs';
import {resolve} from 'node:path';
import {replay} from './model.mjs';
import {assertCurrent} from './compiler.mjs';
import {assessCoherentSource} from './coherent-source.mjs';
import {compileCoherentCanvasGutterPreparation} from './coherent-canvas-gutter.mjs';
import {check,digest,exact,hash,id,isDigest,receipt as validateReceipt,seal,unseal} from './common.mjs';

// These read-only projections neither import a source nor make a new result.
// A seal is a content checksum, not a signature or proof of provider activity.
const SCOPE='isolated-layer-v4';
function identity(plan,state){
  unseal(plan);
  check(plan.format==='ai_scene_generation_plan_v27'&&!plan.recipe.sourceDependency&&plan.sourceScope?.profile===SCOPE
    &&plan.sourceScope.definition?.sha256===plan.recipe?.sourceScope?.sha256,'REBIND_PLAN');
  unseal(plan.sourceScope.definition);
  const style=state.designs.get(plan.recipe.styleSha256),s=unseal(style);
  exact(s,['format','styleId','mode','name','rules','anchors']);
  check(s.format==='ai_scene_style_v2','REBIND_STYLE');
  const {styleId:unusedStyleId,...content}=s;
  const v={planSha256:plan.sha256,assetId:plan.recipe.assetId,role:plan.instanceBinding.role,
    targetSha256:plan.recipe.targetSha256,referenceRawSha256:plan.referenceEvidence?.[0]?.rawSha256,
    styleSha256:plan.recipe.styleSha256,styleContentSha256:digest(content),scopeSha256:plan.sourceScope.definition.sha256};
  check(['planSha256','targetSha256','referenceRawSha256','styleSha256','styleContentSha256','scopeSha256'].every(k=>isDigest(v[k]))
    &&typeof v.assetId==='string'&&typeof v.role==='string','REBIND_PLAN');
  return v;
}
function safeProjection(record,bytes){
  const b=unseal(record);
  exact(b,['format','source','rawSha256','byteLength','technicalSha256','technicalStatus','visualAcceptance','provenance','generationCalls']);
  exact(b.source,['planSha256','assetId','role','targetSha256','referenceRawSha256','styleSha256','styleContentSha256','scopeSha256']);
  check(b.format==='ai_scene_coherent_rebind_source_evidence_v1'&&b.technicalStatus==='pass'
    &&b.visualAcceptance==='not-transferred'&&b.provenance==='local-export-not-a-provider-attestation'
    &&b.generationCalls===0&&isDigest(b.rawSha256)&&isDigest(b.technicalSha256)
    &&Number.isSafeInteger(b.byteLength)&&b.byteLength>0&&b.byteLength<=16777216
    &&['planSha256','targetSha256','referenceRawSha256','styleSha256','styleContentSha256','scopeSha256'].every(k=>isDigest(b.source[k]))
    &&typeof b.source.assetId==='string'&&typeof b.source.role==='string'
    &&bytes instanceof Uint8Array&&bytes.length===b.byteLength&&hash(bytes)===b.rawSha256,'REBIND_EVIDENCE');
  return b;
}

// Deterministic target-side replay. Source identity remains a local-export
// declaration; the bytes and all target binding/QA are checked on every replay.
export function compileCoherentRebindRecord(state,{rebindId,targetPlanSha256,parentBatchSha256,intendedBatchId,evidence,proposal,receipt,bytes}){
  id(rebindId);id(intendedBatchId);check(isDigest(targetPlanSha256)&&isDigest(parentBatchSha256),'REBIND_TARGET');
  const source=safeProjection(evidence,bytes),p=unseal(proposal);
  exact(p,['format','sourceEvidenceSha256','source','target','rawSha256','byteLength','oldTechnicalSha256','newTechnical','generationCalls','review','sourceVisualAcceptance','finalArtAcceptance','provenance']);
  const entry=state.plans.get(targetPlanSha256),plan=entry?.plan;
  check(plan&&entry.status==='planned'&&!entry.attempt&&!entry.result,'REBIND_TARGET_STATE');assertCurrent(state,plan);
  const target=identity(plan,state),technical=assessCoherentSource(plan,bytes);
  const parent=state.batches.get(parentBatchSha256),latest=[...state.batches.values()].findLast(b=>
    ['ai_scene_coherent_source_batch_v1','ai_scene_coherent_source_batch_v2','ai_scene_coherent_source_batch_v3'].includes(b.format)
    &&b.referencePlanSha256===plan.recipe.referencePlans[0]);
  check(parent&&latest?.sha256===parent.sha256&&parent.planSha256s.includes(targetPlanSha256),'REBIND_PARENT_STALE');
  check(p.format==='ai_scene_coherent_rebind_proposal_v1'&&p.sourceEvidenceSha256===evidence.sha256
    &&digest(p.source)===digest(source.source)&&digest(p.target)===digest(target)
    &&p.rawSha256===source.rawSha256&&p.byteLength===source.byteLength&&p.oldTechnicalSha256===source.technicalSha256
    &&p.generationCalls===0&&p.review==='required'&&p.sourceVisualAcceptance==='not-transferred'
    &&p.finalArtAcceptance==='not-assessed'&&p.provenance==='content-checksums-do-not-attest-provider-history'
    &&target.targetSha256!==source.source.targetSha256&&target.role===source.source.role&&target.assetId===source.source.assetId
    &&target.referenceRawSha256===source.source.referenceRawSha256&&target.styleContentSha256===source.source.styleContentSha256
    &&technical.status==='pass'&&digest(technical)===digest(p.newTechnical),'REBIND_PROPOSAL');
  validateReceipt(receipt,'review');check(receipt.decision==='accept'&&receipt.targetSha256===proposal.sha256,'REBIND_REVIEW');
  return seal({format:'ai_scene_coherent_rebind_v1',recipe:{...plan.recipe,planId:rebindId},targetPlanSha256,parentBatchSha256,intendedBatchId,
    sourceEvidence:evidence,proposal,receipt,rawSha256:source.rawSha256,technical,
    referenceEvidence:plan.referenceEvidence,instanceBinding:plan.instanceBinding,sourceScope:plan.sourceScope,target:plan.target,
    request:{format:'ai_scene_no_generation_request_v1',maximumCalls:0}});
}

// One fresh locked transaction verifies all source workflow bytes and replays
// its records. No receipt, attempt, request, provider or host data is exported.
export function exportCoherentRebindEvidence(workflow,planSha256,{historicalBatchSha256}={}){
  check(isDigest(planSha256),'REBIND_PLAN');
  return transact(workflow,store=>{
    const active=replay(store),entry=active.plans.get(planSha256),selected=entry?.plan;
    check(selected&&['pending-visual-review','accepted'].includes(entry.status)&&entry.result?.technical?.status==='pass','REBIND_SOURCE_STATE');
    let state=active;
    if(historicalBatchSha256!==undefined){
      const batch=active.batches.get(historicalBatchSha256),prior=active.plans.get(batch?.referencePlanSha256);
      const latest=[...active.batches.values()].findLast(b=>['ai_scene_coherent_source_batch_v1','ai_scene_coherent_source_batch_v2','ai_scene_coherent_source_batch_v3'].includes(b.format)
        &&b.referencePlanSha256===batch?.referencePlanSha256);
      const current=[...active.plans.values()].findLast(e=>e.plan.recipe.stage==='reference'&&e.plan.recipe.specSha256===active.activeSpec
        &&e.plan.recipe.styleSha256===active.activeStyle);
      check(isDigest(historicalBatchSha256)&&latest?.sha256===historicalBatchSha256&&batch.planSha256s.includes(planSha256)
        &&prior?.status==='accepted'&&current?.status==='accepted'&&current.plan.format==='ai_scene_reference_candidate_v1'
        &&current.result?.rawSha256===prior.result?.rawSha256&&selected.recipe.styleSha256===active.activeStyle
        &&selected.recipe.specSha256===prior.plan.recipe.specSha256&&selected.recipe.specSha256!==active.activeSpec,'REBIND_HISTORICAL_BATCH');
      state={...active,activeSpec:selected.recipe.specSha256};
    }
    assertCurrent(state,selected);
    let plan=selected;
    if(['ai_scene_coherent_canvas_gutter_preparation_v1','ai_scene_coherent_canvas_gutter_preparation_v2'].includes(selected.format)){
      const resultFormat=selected.format.endsWith('_v2')?'ai_scene_coherent_canvas_gutter_result_v2':'ai_scene_coherent_canvas_gutter_result_v1';
      const original=state.plans.get(selected.sourcePlanSha256),parent=state.batches.get(selected.proposal?.parentBatchSha256),
        latest=[...state.batches.values()].findLast(b=>['ai_scene_coherent_source_batch_v1','ai_scene_coherent_source_batch_v2','ai_scene_coherent_source_batch_v3'].includes(b.format)
          &&b.referencePlanSha256===parent?.referencePlanSha256);
      check(entry.kind==='coherent-canvas-gutter-preparation'&&original?.plan.format==='ai_scene_generation_plan_v27'
        &&parent&&latest?.planSha256s.includes(planSha256)&&entry.result.format===resultFormat
        &&entry.result.preparationSha256===planSha256&&entry.result.sourcePlanSha256===original.plan.sha256
        &&entry.result.originalRawSha256===original.result?.rawSha256&&entry.result.maximumCalls===0,'REBIND_SOURCE_PREPARATION');
      assertCurrent(state,original.plan);
      const compiled=compileCoherentCanvasGutterPreparation(store,state,{preparationId:selected.recipe.planId,proposal:selected.proposal,receipt:selected.receipt});
      check(digest(compiled.record)===digest(selected)&&store.readBlob(selected.rawSha256).equals(compiled.bytes)
        &&entry.result.rawSha256===selected.rawSha256&&digest(entry.result.technical)===digest(selected.technical),'REBIND_SOURCE_PREPARATION');
      plan=original.plan;
    }else check(selected.format==='ai_scene_generation_plan_v27','REBIND_SOURCE_STATE');
    const source={...identity(plan,state),planSha256},bytes=store.readBlob(entry.result.rawSha256),technical=assessCoherentSource(plan,bytes);
    check(entry.result.rawSha256===hash(bytes)&&digest(technical)===digest(entry.result.technical)&&technical.status==='pass','REBIND_SOURCE_QA');
    return {evidence:seal({format:'ai_scene_coherent_rebind_source_evidence_v1',source,rawSha256:hash(bytes),byteLength:bytes.length,
      technicalSha256:technical.sha256,technicalStatus:'pass',visualAcceptance:'not-transferred',
      provenance:'local-export-not-a-provider-attestation',generationCalls:0}),bytes:Buffer.from(bytes)};
  });
}

// Compile against the caller's already locked and replayed target state. Source
// evidence must have just been obtained from its own locked workflow replay.
export function compileCoherentRebindProposal(state,{evidence,bytes,targetPlanSha256,targetSha256,scopeSha256}){
  check(isDigest(targetPlanSha256)&&isDigest(targetSha256)&&isDigest(scopeSha256),'REBIND_TARGET');
  const source=safeProjection(evidence,bytes);
  const entry=state.plans.get(targetPlanSha256),plan=entry?.plan;
  check(plan&&entry.status==='planned'&&!entry.attempt&&!entry.result,'REBIND_TARGET_STATE');assertCurrent(state,plan);
  const target=identity(plan,state);
  check(target.targetSha256===targetSha256&&target.scopeSha256===scopeSha256
    &&target.targetSha256!==source.source.targetSha256
    &&target.role===source.source.role&&target.assetId===source.source.assetId
    &&target.referenceRawSha256===source.source.referenceRawSha256&&target.styleContentSha256===source.source.styleContentSha256,'REBIND_TARGET_BINDING');
  const technical=assessCoherentSource(plan,bytes);
  check(technical.status==='pass'&&technical.rawSha256===source.rawSha256,'REBIND_TARGET_QA');
  return seal({format:'ai_scene_coherent_rebind_proposal_v1',sourceEvidenceSha256:evidence.sha256,source:source.source,
    target,rawSha256:source.rawSha256,byteLength:source.byteLength,oldTechnicalSha256:source.technicalSha256,
    newTechnical:technical,generationCalls:0,review:'required',sourceVisualAcceptance:'not-transferred',finalArtAcceptance:'not-assessed',
    provenance:'content-checksums-do-not-attest-provider-history'});
}

// Caller-confirmed target and exact new scope are bound to the proposal. This
// does not approve the proposal, import bytes or make the target plan usable.
export function proposeCoherentRebind(workflow,options){
  const historical=Object.hasOwn(options,'historicalBatchSha256');
  exact(options,['sourceWorkflow','sourcePlanSha256','targetPlanSha256','targetSha256','scopeSha256',...(historical?['historicalBatchSha256']:[])]);
  const {sourceWorkflow,sourcePlanSha256,targetPlanSha256,targetSha256,scopeSha256,historicalBatchSha256}=options;
  check(!historical||resolve(workflow)===resolve(sourceWorkflow),'REBIND_HISTORICAL_BATCH');
  check(isDigest(targetPlanSha256)&&isDigest(targetSha256)&&isDigest(scopeSha256),'REBIND_TARGET');
  // Never accept caller-supplied checksummed metadata as proof of export. Read
  // the explicitly chosen local source through its own locked replay first.
  const {evidence,bytes}=exportCoherentRebindEvidence(sourceWorkflow,sourcePlanSha256,{historicalBatchSha256});
  const proposal=transact(workflow,store=>{
    const state=replay(store);
    return compileCoherentRebindProposal(state,{evidence,bytes,targetPlanSha256,targetSha256,scopeSha256});
  });
  return {evidence,bytes,proposal};
}
