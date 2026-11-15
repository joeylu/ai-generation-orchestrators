import {compileTerrainEdgeSource,assertTerrainEdgeCurrent,TERRAIN_EDGE_BATCH_FORMATS,TERRAIN_EDGE_PLAN_FORMATS} from './terrain-edge-source.mjs';
import {check,digest,exact,id,seal} from './common.mjs';

export const TERRAIN_EDGE_RECOVERY_BATCH_FORMAT='ai_scene_terrain_edge_recovery_batch_v1';
export const TERRAIN_EDGE_UNKNOWN_REPLACEMENT_FORMAT='ai_scene_terrain_edge_recovery_batch_v2';
export const isTerrainEdgeRecoveryBatch=batch=>[TERRAIN_EDGE_RECOVERY_BATCH_FORMAT,TERRAIN_EDGE_UNKNOWN_REPLACEMENT_FORMAT].includes(batch?.format);
export function assertTerrainEdgeRecoveryConfirmation(batch,entries){
  if(!isTerrainEdgeRecoveryBatch(batch))return;
  const replacement=entries.find(e=>(e.plan?.sha256??e.planSha256)===batch.replacementPlanSha256);
  check(replacement&&replacement.status!=='planned','TERRAIN_EDGE_RECOVERY_CONFIRMATION_REQUIRED');
  return replacement.status==='authorized'?replacement:null;
}
function parentInfo(state,parentSha,failedSha,terminalSha){
  const parent=state.batches.get(parentSha),failed=state.plans.get(failedSha),latest=[...state.batches.values()].findLast(b=>
    TERRAIN_EDGE_BATCH_FORMATS.includes(b.format)&&b.baseBatchSha256===parent?.baseBatchSha256&&b.referencePlanSha256===parent?.referencePlanSha256);
  check(parent&&latest?.sha256===parentSha&&parent.coverageProfile==='full-perimeter-v1'&&parent.fullPerimeterComplete===true
    &&parent.planSha256s.length===7&&parent.planSha256s.includes(failedSha),'TERRAIN_EDGE_RECOVERY_PARENT');
  const native=TERRAIN_EDGE_PLAN_FORMATS.includes(failed?.plan.format)&&failed.plan.request.maximumCalls===1;
  if(terminalSha===undefined){
    check(native&&failed.status==='rejected-technical'&&failed.result?.technical.status==='fail'&&failed.result.technical.issues.length>0,
      'TERRAIN_EDGE_RECOVERY_KNOWN_FAILURE');
  }else{
    check(native&&failed.status==='indeterminate'&&!failed.result&&failed.terminal?.outcome==='indeterminate'
      &&failed.terminal.sha256===terminalSha&&failed.terminal.attemptSha256===failed.attempt?.sha256
      &&failed.terminal.requestSha256===digest(failed.plan.request),'TERRAIN_EDGE_RECOVERY_UNKNOWN_TERMINAL');
  }
  check(![...state.plans.values()].some(e=>e.attempt&&!e.result&&['reserved','submitted'].includes(e.status)),'TERRAIN_EDGE_RECOVERY_ACTIVE');
  for(const sha of parent.planSha256s){const e=state.plans.get(sha);
    check(e&&(TERRAIN_EDGE_PLAN_FORMATS.includes(e.plan.format)||e.plan.format==='ai_scene_terrain_edge_canvas_gutter_preparation_v1'),'TERRAIN_EDGE_RECOVERY_SOURCE_KIND');
    assertTerrainEdgeCurrent(state,e.plan.format==='ai_scene_terrain_edge_canvas_gutter_preparation_v1'?e.plan.proposal.originalPlan:e.plan);
    if(sha!==failedSha)check(e.status==='authorized'&&e.authorization&&e.plan.request.maximumCalls===1
      ||['pending-visual-review','accepted'].includes(e.status)&&e.result?.technical.status==='pass','TERRAIN_EDGE_RECOVERY_OTHER_SOURCE');}
  return {parent,failed};
}
export function compileTerrainEdgeRecoveryPlan(state,options,readBlob){
  exact(options,['parentBatchSha256','failedPlanSha256','planId','batchId',...(Object.hasOwn(options,'terminalSha256')?['terminalSha256']:[])]);id(options.planId);id(options.batchId);
  const {failed}=parentInfo(state,options.parentBatchSha256,options.failedPlanSha256,options.terminalSha256);
  const plan=compileTerrainEdgeSource(state,{...failed.plan.recipe,planId:options.planId,parents:[failed.plan.sha256]},readBlob);
  check(plan.sha256!==failed.plan.sha256&&digest(plan.request)===digest(failed.plan.request),'TERRAIN_EDGE_RECOVERY_EXACT_REQUEST');
  return plan;
}
export function compileTerrainEdgeRecoveryBatch(state,options){
  exact(options,['parentBatchSha256','failedPlanSha256','replacementPlanSha256','batchId',...(Object.hasOwn(options,'terminalSha256')?['terminalSha256']:[])]);id(options.batchId);
  const {parent,failed}=parentInfo(state,options.parentBatchSha256,options.failedPlanSha256,options.terminalSha256),entry=state.plans.get(options.replacementPlanSha256),p=entry?.plan;
  check(entry?.status==='planned'&&p&&p.recipe.parents.length===1&&p.recipe.parents[0]===failed.plan.sha256
    &&p.recipe.edgeRole===failed.plan.recipe.edgeRole&&p.recipe.assetId===failed.plan.recipe.assetId
    &&digest({...p.recipe,planId:failed.plan.recipe.planId,parents:failed.plan.recipe.parents})===digest(failed.plan.recipe)
    &&digest(p.request)===digest(failed.plan.request),'TERRAIN_EDGE_RECOVERY_REPLACEMENT');
  assertTerrainEdgeCurrent(state,p);
  const plans=parent.planSha256s.map(sha=>sha===failed.plan.sha256?p.sha256:sha),reusedAuthorizations=[];
  for(const sha of plans){const e=state.plans.get(sha);if(sha!==p.sha256&&e.status==='authorized')reusedAuthorizations.push({
    planSha256:sha,authorizationSha256:e.authorization.sha256,requestSha256:digest(e.plan.request)});}
  const keys=['baseBatchSha256','referencePlanSha256','targetSha256','materialPlanSha256','materialRawSha256','policySha256','surfaceFamily',
    'coverageProfile','coverage','expectedRoles','requestedRoles','fullPerimeterComplete','coverageIntent','nativeSizeProfile','renderEnvelopeProfile','naturalSurfaceProfile','preparationSha256s'];
  const unknown=options.terminalSha256!==undefined;
  const outcome=unknown?{terminalSha256:failed.terminal.sha256,terminalAttemptSha256:failed.attempt.sha256}
    :{failedResultSha256:failed.result.sha256,failedRawSha256:failed.result.rawSha256,failedTechnicalSha256:failed.result.technical.sha256};
  return seal({format:unknown?TERRAIN_EDGE_UNKNOWN_REPLACEMENT_FORMAT:TERRAIN_EDGE_RECOVERY_BATCH_FORMAT,batchId:options.batchId,parentBatchSha256:parent.sha256,
    ...Object.fromEntries(keys.filter(k=>Object.hasOwn(parent,k)).map(k=>[k,parent[k]])),planSha256s:plans,
    failedPlanSha256:failed.plan.sha256,replacementPlanSha256:p.sha256,...outcome,
    reusedAuthorizations,remainingPreviouslyAuthorizedCalls:reusedAuthorizations.length,maximumCalls:1,newImageRequests:1,
    freshAuthorizationRequiredPlanSha256s:[p.sha256],automaticRetry:false,scope:unknown?'one-explicit-unknown-outcome-new-plan-and-fresh-confirmation'
      :'one-explicit-known-failure-new-plan-and-fresh-confirmation',artAcceptance:'not-transferred'});
}
