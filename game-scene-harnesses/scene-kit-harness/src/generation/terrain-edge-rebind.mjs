import {transact} from './store.mjs';
import {replay} from './model.mjs';
import {assertCurrent} from './compiler.mjs';
import {assessTerrainEdgeSource,TERRAIN_EDGE_BATCH_FORMATS} from './terrain-edge-source.mjs';
import {compileTerrainEdgeCanvasGutterPreparation,assessTerrainEdgeCanvasGutterPreparation,TERRAIN_EDGE_CANVAS_GUTTER_FORMAT,
  TERRAIN_EDGE_AUTO_GUTTER_PROFILE} from './terrain-edge-canvas-gutter.mjs';
import {check,digest,exact,hash,id,isDigest,receipt as validateReceipt,seal,unseal} from './common.mjs';
import {inspectPng} from '../png.mjs';

export const TERRAIN_EDGE_REBIND_FORMAT='ai_scene_terrain_edge_rebind_v1';
export const TERRAIN_EDGE_REBIND_BATCH_FORMAT='ai_scene_terrain_edge_rebind_batch_v1';
function styleContent(state,sha){const s=unseal(state.designs.get(sha));check(s.format==='ai_scene_style_v2','EDGE_REBIND_STYLE');const {styleId,...content}=s;return digest(content);}
function basePlan(state,entry){const p=entry?.plan;return p?.format===TERRAIN_EDGE_CANVAS_GUTTER_FORMAT?state.plans.get(p.sourcePlanSha256)?.plan:p;}
function identity(state,plan){unseal(plan);check(plan.format==='ai_scene_generation_plan_v37','EDGE_REBIND_PLAN');
  const out={role:plan.recipe.edgeRole,referenceRawSha256:plan.referenceEvidence?.[0]?.rawSha256,materialRawSha256:plan.materialEvidence?.rawSha256,
    styleContentSha256:styleContent(state,plan.recipe.styleSha256),naturalSurfaceProfile:plan.recipe.naturalSurfaceProfile,
    nativeSizeProfile:plan.recipe.nativeSizeProfile,renderEnvelopeProfile:plan.recipe.renderEnvelopeProfile};
  check([out.referenceRawSha256,out.materialRawSha256,out.styleContentSha256].every(isDigest)&&typeof out.role==='string','EDGE_REBIND_IDENTITY');return out;}
function verifyEvidence(evidence,originalRaw,bytes){const e=unseal(evidence),original=e.originalPlan;unseal(original);unseal(e.originalTechnical);unseal(e.preparedTechnical);
  const automatic=Object.hasOwn(e,'automaticPolicy');
  exact(e,['format','identity','sourceStyle','originalPlan','originalTechnical','preparedTechnical','originalRawSha256','rawSha256','originalRgbaSha256','nativeFrame','preparationSha256','proposalSha256',automatic?'automaticPolicy':'receiptSha256','sourceBatchSha256','sourceResultSha256','provenance','visualAcceptance','generationCalls']);
  const style=unseal(e.sourceStyle),{styleId,...styleWithoutId}=style;
  check(e.format==='ai_scene_terrain_edge_rebind_source_v1'&&e.provenance==='local-export-not-provider-attestation'&&e.visualAcceptance==='not-transferred'
    &&e.generationCalls===0&&hash(originalRaw)===e.originalRawSha256&&hash(bytes)===e.rawSha256
    &&e.originalTechnical.status==='fail'&&digest(e.originalTechnical.issues)===digest(['TERRAIN_EDGE_NATIVE_GUTTER'])
    &&digest(assessTerrainEdgeSource(original,originalRaw))===digest(e.originalTechnical)
    &&digest(assessTerrainEdgeSource(original,bytes))===digest(e.preparedTechnical)&&e.preparedTechnical.status==='pass'
    &&[e.preparationSha256,e.proposalSha256,e.sourceBatchSha256,e.sourceResultSha256].every(isDigest)
    &&(automatic?e.automaticPolicy===TERRAIN_EDGE_AUTO_GUTTER_PROFILE:isDigest(e.receiptSha256))
    &&original.format==='ai_scene_generation_plan_v37'&&original.target.alpha==='transparent'
    &&original.recipe.nativeSizeProfile==='bounded-native-4m-v1'&&original.recipe.renderEnvelopeProfile==='visible-alpha8-outward16-native-rgba-v1'
    &&style.format==='ai_scene_style_v2'&&e.sourceStyle.sha256===original.recipe.styleSha256&&digest(styleWithoutId)===e.identity.styleContentSha256
    &&original.recipe.edgeRole===e.identity.role&&original.referenceEvidence?.[0]?.rawSha256===e.identity.referenceRawSha256
    &&original.materialEvidence?.rawSha256===e.identity.materialRawSha256&&original.recipe.naturalSurfaceProfile===e.identity.naturalSurfaceProfile
    &&original.recipe.nativeSizeProfile===e.identity.nativeSizeProfile&&original.recipe.renderEnvelopeProfile===e.identity.renderEnvelopeProfile,'EDGE_REBIND_EVIDENCE');
  const a=inspectPng(originalRaw,{includePixels:true,allowCabx:true,allowHiddenRgb:true}),b=inspectPng(bytes,{includePixels:true,allowCabx:true,allowHiddenRgb:true});
  check(hash(a.rgba)===e.originalRgbaSha256&&digest(e.nativeFrame)===digest({x:2,y:2,width:a.width,height:a.height})
    &&b.width===a.width+4&&b.height===a.height+4,'EDGE_REBIND_FRAME');
  let edgeMax=0,hasBody=false;
  for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++){const alpha=a.rgba[(y*a.width+x)*4+3];
    if(x<2||y<2||x>=a.width-2||y>=a.height-2)edgeMax=Math.max(edgeMax,alpha);
    if(alpha>=8)hasBody=true;}
  check(edgeMax>0&&edgeMax<=(automatic?1:7)&&hasBody,'EDGE_REBIND_ORIGINAL_GUTTER');
  const stride=b.width*4;
  check(b.rgba.subarray(0,2*stride).every(v=>v===0)&&b.rgba.subarray((b.height-2)*stride).every(v=>v===0),'EDGE_REBIND_FRAME');
  for(let y=0;y<a.height;y++){const row=(y+2)*stride,source=y*a.width*4;
    check(b.rgba.subarray(row,row+8).every(v=>v===0)&&b.rgba.subarray(row+stride-8,row+stride).every(v=>v===0)
      &&b.rgba.subarray(row+8,row+stride-8).equals(a.rgba.subarray(source,source+a.width*4)),'EDGE_REBIND_FRAME');}
  return e;}
export function exportTerrainEdgeRebindEvidence(workflow,sourcePlanSha256){check(isDigest(sourcePlanSha256),'EDGE_REBIND_SOURCE');return transact(workflow,store=>{
  const state=replay(store),entry=state.plans.get(sourcePlanSha256),p=entry?.plan;
  check(p?.format===TERRAIN_EDGE_CANVAS_GUTTER_FORMAT&&entry.kind==='terrain-edge-canvas-gutter-preparation'&&entry.result?.technical.status==='pass'
    &&['pending-visual-review','accepted'].includes(entry.status),'EDGE_REBIND_SOURCE');assertCurrent(state,p);
  const latest=[...state.batches.values()].findLast(b=>TERRAIN_EDGE_BATCH_FORMATS.includes(b.format)&&b.baseBatchSha256===p.recipe.baseBatchSha256);
  check(latest?.planSha256s.includes(sourcePlanSha256),'EDGE_REBIND_SOURCE_STALE');
  const compiled=compileTerrainEdgeCanvasGutterPreparation(store,state,{preparationId:p.recipe.planId,proposal:p.proposal,
    ...(p.automaticPolicy?{automaticPolicy:p.automaticPolicy}:{receipt:p.receipt})});
  const bytes=store.readBlob(p.rawSha256),originalRaw=store.readBlob(p.originalRawSha256);
  check(digest(compiled.record)===digest(p)&&compiled.bytes.equals(bytes),'EDGE_REBIND_SOURCE');
  const evidence=seal({format:'ai_scene_terrain_edge_rebind_source_v1',identity:identity(state,p.proposal.originalPlan),sourceStyle:state.designs.get(p.proposal.originalPlan.recipe.styleSha256),originalPlan:p.proposal.originalPlan,
    originalTechnical:p.proposal.originalTechnical,preparedTechnical:p.technical,originalRawSha256:p.originalRawSha256,rawSha256:p.rawSha256,
    originalRgbaSha256:p.proposal.originalRgbaSha256,nativeFrame:p.nativeFrame,preparationSha256:p.sha256,proposalSha256:p.proposal.sha256,
    ...(p.automaticPolicy?{automaticPolicy:p.automaticPolicy}:{receiptSha256:digest(p.receipt)}),
    sourceBatchSha256:latest.sha256,sourceResultSha256:entry.result.sha256,
    provenance:'local-export-not-provider-attestation',visualAcceptance:'not-transferred',generationCalls:0});
  verifyEvidence(evidence,originalRaw,bytes);return {evidence,originalRaw:Buffer.from(originalRaw),bytes:Buffer.from(bytes)};
});}
function targetInfo(state,parentBatchSha256,targetPlanSha256){const parent=state.batches.get(parentBatchSha256),entry=state.plans.get(targetPlanSha256);
  const latest=[...state.batches.values()].findLast(b=>TERRAIN_EDGE_BATCH_FORMATS.includes(b.format)&&b.baseBatchSha256===parent?.baseBatchSha256&&b.referencePlanSha256===parent?.referencePlanSha256);
  check(parent&&latest?.sha256===parent.sha256&&parent.coverageProfile==='full-perimeter-v1'&&parent.fullPerimeterComplete===true
    &&parent.planSha256s.length===7&&parent.planSha256s.includes(targetPlanSha256)&&parent.planSha256s.every(x=>{const s=state.plans.get(x);return ['pending-visual-review','accepted'].includes(s?.status)&&s.result?.technical.status==='pass';}),'EDGE_REBIND_PARENT');
  check(entry&&['pending-visual-review','accepted'].includes(entry.status),'EDGE_REBIND_TARGET');assertCurrent(state,entry.plan);
  const plan=basePlan(state,entry);check(plan?.format==='ai_scene_generation_plan_v37','EDGE_REBIND_TARGET');return {parent,entry,plan,identity:identity(state,plan)};}
export function compileTerrainEdgeRebindProposal(state,{evidence,originalRaw,bytes,parentBatchSha256,targetPlanSha256}){const e=verifyEvidence(evidence,originalRaw,bytes),t=targetInfo(state,parentBatchSha256,targetPlanSha256);
  check(e.identity.role==='left-wall'&&digest(e.identity)===digest(t.identity),'EDGE_REBIND_TARGET_BINDING');const technical=assessTerrainEdgeSource(t.plan,bytes);
  check(technical.status==='pass','EDGE_REBIND_TARGET_QA');return seal({format:'ai_scene_terrain_edge_rebind_proposal_v1',sourceEvidenceSha256:evidence.sha256,
    target:{parentBatchSha256,targetPlanSha256,targetOriginalPlanSha256:t.plan.sha256,identity:t.identity},originalRawSha256:hash(originalRaw),rawSha256:hash(bytes),
    nativeFrame:e.nativeFrame,technical,generationCalls:0,review:'required',visualAcceptance:'not-transferred',provenance:'content-checksums-do-not-attest-provider-history'});}
export function proposeTerrainEdgeRebind(workflow,options){exact(options,['sourceWorkflow','sourcePlanSha256','parentBatchSha256','targetPlanSha256']);
  const {evidence,originalRaw,bytes}=exportTerrainEdgeRebindEvidence(options.sourceWorkflow,options.sourcePlanSha256);
  const proposal=transact(workflow,store=>compileTerrainEdgeRebindProposal(replay(store),{evidence,originalRaw,bytes,parentBatchSha256:options.parentBatchSha256,targetPlanSha256:options.targetPlanSha256}));return {evidence,originalRaw,bytes,proposal};}
export function compileTerrainEdgeRebindRecord(state,{rebindId,parentBatchSha256,targetPlanSha256,evidence,originalRaw,bytes,proposal,receipt}){id(rebindId);
  const expected=compileTerrainEdgeRebindProposal(state,{evidence,originalRaw,bytes,parentBatchSha256,targetPlanSha256});check(digest(expected)===digest(proposal),'EDGE_REBIND_PROPOSAL');
  validateReceipt(receipt,'review');check(receipt.decision==='accept'&&receipt.targetSha256===proposal.sha256,'EDGE_REBIND_REVIEW');
  const t=targetInfo(state,parentBatchSha256,targetPlanSha256);return seal({format:TERRAIN_EDGE_REBIND_FORMAT,recipe:{...t.plan.recipe,planId:rebindId},
    parentBatchSha256,targetPlanSha256,sourceEvidence:evidence,proposal,receipt,originalRawSha256:hash(originalRaw),rawSha256:hash(bytes),technical:proposal.technical,
    nativeFrame:proposal.nativeFrame,referenceEvidence:t.plan.referenceEvidence,materialEvidence:t.plan.materialEvidence,instanceBinding:t.plan.instanceBinding,
    request:{format:'ai_scene_no_generation_request_v1',maximumCalls:0},visualAcceptance:'not-transferred'});}
export function compileTerrainEdgeRebindBatch(state,{parentBatchSha256,rebindSha256,batchId}){id(batchId);const entry=state.plans.get(rebindSha256),r=entry?.plan;
  check(entry?.kind==='terrain-edge-rebind'&&entry.status==='pending-visual-review'&&r.parentBatchSha256===parentBatchSha256,'EDGE_REBIND_BATCH');
  const {parent}=targetInfo(state,parentBatchSha256,r.targetPlanSha256),plans=parent.planSha256s.map(x=>x===r.targetPlanSha256?rebindSha256:x);
  const binding=Object.fromEntries(['baseBatchSha256','referencePlanSha256','targetSha256','materialPlanSha256','materialRawSha256','policySha256','surfaceFamily','coverageProfile','coverage','expectedRoles','requestedRoles','fullPerimeterComplete','coverageIntent','nativeSizeProfile','renderEnvelopeProfile','naturalSurfaceProfile'].filter(k=>Object.hasOwn(parent,k)).map(k=>[k,parent[k]]));
  return seal({format:TERRAIN_EDGE_REBIND_BATCH_FORMAT,batchId,parentBatchSha256,...binding,planSha256s:plans,rebindSha256,maximumCalls:0,newImageRequests:0,automaticRetry:false,scope:'reviewed-one-role-rebind'});}

export function terrainEdgeRebindView(item,batch){const record=item.rebind?.record,originalRaw=item.rebind?.originalRaw;
  check(record?.format===TERRAIN_EDGE_REBIND_FORMAT&&batch.rebindSha256===record.sha256&&record.sha256===item.plan.sha256
    &&record.rawSha256===hash(item.raw)&&record.technical.sha256===item.result.technical.sha256&&record.receipt.decision==='accept'
    &&record.receipt.targetSha256===record.proposal.sha256&&record.request.maximumCalls===0,'EDGE_REBIND_DELIVERY');
  verifyEvidence(record.sourceEvidence,originalRaw,item.raw);
  const p=inspectPng(originalRaw,{includePixels:true,allowCabx:true,allowHiddenRgb:true});
  check(digest(record.nativeFrame)===digest({x:2,y:2,width:p.width,height:p.height}),'EDGE_REBIND_FRAME');
  return {width:p.width,height:p.height,rgba:Buffer.from(p.rgba)};}
