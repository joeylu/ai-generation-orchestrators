import {existsSync} from 'node:fs';
import * as flow from './generation/index.mjs';
import {check,digest,hash,jsonBytes,seal} from './generation/common.mjs';
import {isTerrainEdgeRecoveryBatch,TERRAIN_EDGE_UNKNOWN_REPLACEMENT_FORMAT} from './generation/terrain-edge-recovery.mjs';
import {writeProofBundle,verifyProofBundle} from './terrain-proof/bundle.mjs';

// Read-only evidence for one new authorization, with the original unused
// authorizations reported separately. No reservation or dispatch occurs here.
export function prepareTerrainEdgeRecoveryComputeReview(workflow,batch,output){
  check(isTerrainEdgeRecoveryBatch(batch),'TERRAIN_EDGE_RECOVERY_REVIEW');
  const view=flow.readTerrainEdgeWorkflowView(workflow,{batchSha256:batch.sha256,includeCurrentInputs:true,includeResults:true}),
    files=new Map(),plans=[],completedSources=[],existingAuthorizedContinuations=[],put=(path,value)=>files.set(path,jsonBytes(value));
  check(view.batches.findLast(b=>b.baseBatchSha256===batch.baseBatchSha256&&b.referencePlanSha256===batch.referencePlanSha256)?.sha256===batch.sha256,'TERRAIN_EDGE_COMPUTE_STALE');
  for(const [index,sha]of batch.planSha256s.entries()){
    const plan=view.plans.find(p=>p.sha256===sha),status=view.inspection.plans.find(p=>p.planSha256===sha),result=view.results.get(sha);
    check(status?.current,'TERRAIN_EDGE_COMPUTE_STALE');put(`plan-${index+1}.json`,plan);
    if(['pending-visual-review','accepted'].includes(status.status)){
      check(result?.result.technical.status==='pass','TERRAIN_EDGE_RECOVERY_REVIEW_SOURCE');put(`result-${index+1}.json`,result.result);
      completedSources.push({planSha256:sha,edgeRole:plan.recipe.edgeRole,rawSha256:result.result.rawSha256,
        resultSha256:result.result.sha256,maximumCalls:0,prepared:plan.request.maximumCalls===0});continue;
    }
    const fresh=sha===batch.replacementPlanSha256,reused=batch.reusedAuthorizations.find(a=>a.planSha256===sha);
    check((fresh?['planned','authorized'].includes(status.status):status.status==='authorized'&&reused?.requestSha256===digest(plan.request))
      &&plan.request.maximumCalls===1&&plan.request.images.length===(plan.recipe.topologyGuideProfile?3:2),'TERRAIN_EDGE_RECOVERY_REVIEW_REQUEST');
    files.set(`prompt-${index+1}.txt`,Buffer.from(plan.request.prompt+'\n'));
    const inputs=plan.request.images.map((image,inputIndex)=>{
      const bytes=view.inputs.get(image.artifact.sha256),path=inputIndex===2?`guide-${index+1}.png`:`input-${inputIndex+1}.png`;
      check(bytes&&hash(bytes)===image.artifact.sha256&&bytes.length===image.artifact.byteLength,'TERRAIN_EDGE_COMPUTE_INPUT');
      if(files.has(path))check(files.get(path).equals(bytes),'TERRAIN_EDGE_COMPUTE_INPUT');else files.set(path,bytes);
      return {path,role:image.role,sha256:hash(bytes),byteLength:bytes.length};
    });
    const row={planSha256:sha,edgeRole:plan.recipe.edgeRole,assetId:plan.recipe.assetId,prompt:`prompt-${index+1}.txt`,inputs,
      maximumCalls:1,transparentBackground:true};
    if(fresh)plans.push(row);else existingAuthorizedContinuations.push({...row,authorizationSha256:reused.authorizationSha256});
  }
  check(plans.length===1&&existingAuthorizedContinuations.length===batch.remainingPreviouslyAuthorizedCalls,'TERRAIN_EDGE_RECOVERY_REVIEW_REQUEST');
  const unknown=batch.format===TERRAIN_EDGE_UNKNOWN_REPLACEMENT_FORMAT;
  put('failed-plan.json',flow.getGenerationPlan(workflow,batch.failedPlanSha256));
  let outcome;
  if(unknown){
    const terminal=view.predecessorTerminal;
    check(terminal?.sha256===batch.terminalSha256&&terminal.attemptSha256===batch.terminalAttemptSha256
      &&terminal.planSha256===batch.failedPlanSha256&&terminal.outcome==='indeterminate','TERRAIN_EDGE_RECOVERY_REVIEW_FAILURE');
    put('predecessor-terminal.json',terminal);
    outcome={terminalSha256:terminal.sha256,terminalAttemptSha256:terminal.attemptSha256,predecessorOutcome:terminal.outcome};
  }else{
    const failed=flow.getGenerationResult(workflow,batch.failedPlanSha256);
    check(failed.status==='rejected-technical'&&failed.result.sha256===batch.failedResultSha256&&failed.result.rawSha256===batch.failedRawSha256
      &&failed.result.technical.sha256===batch.failedTechnicalSha256,'TERRAIN_EDGE_RECOVERY_REVIEW_FAILURE');
    put('failed-result.json',failed.result);files.set('failed-source-native.png',failed.bytes);
    outcome={failedResultSha256:batch.failedResultSha256,failedRawSha256:batch.failedRawSha256,
      failedTechnicalSha256:batch.failedTechnicalSha256,failedIssues:failed.result.technical.issues};
  }
  const report=seal({format:unknown?'ai_scene_terrain_edge_recovery_compute_review_v2':'ai_scene_terrain_edge_recovery_compute_review_v1',
    targetSha256:batch.sha256,parentBatchSha256:batch.parentBatchSha256,failedPlanSha256:batch.failedPlanSha256,...outcome,
    materialPlanSha256:batch.materialPlanSha256,materialRawSha256:batch.materialRawSha256,referencePlanSha256:batch.referencePlanSha256,
    plans,completedSources,existingAuthorizedContinuations,maximumCalls:1,newImageRequests:1,
    executionRemainingAfterFreshApproval:1+existingAuthorizedContinuations.length,
    continuationGate:'new-replacement-must-be-confirmed-and-pass-before-original-unused-requests',
    sameRequestAsFailedPlan:true,automaticRetry:false,generationCalls:0,computeAuthorizationIncluded:false,
    sourceAcceptance:'separate-human-visual-review',artAcceptance:'not-transferred'});
  put('batch.json',batch);put('compute-review.json',report);
  files.set('README.md',Buffer.from(unknown
    ?`This packet requests one fresh single-use authorization for batch ${batch.sha256}. The prior attempt remains terminal and its outcome is unknown. Only the distinct replacement plan can dispatch before the original unused requests. Failure or an unknown outcome stops dispatch. This packet grants neither compute nor human art acceptance.\n`
    :'This packet requests one fresh single-use authorization for the new replacement plan. The failed attempt and original PNG remain immutable. Existing authorized continuations require the replacement to pass first; they are not reauthorized. Failure or unknown outcome stops dispatch. Preparing this packet calls no image tool and grants no human art acceptance.\n'));
  const bundle=seal({format:unknown?'ai_scene_terrain_edge_recovery_compute_review_bundle_v2':'ai_scene_terrain_edge_recovery_compute_review_bundle_v1',reviewSha256:report.sha256,
    artifacts:[...files].map(([path,bytes])=>({path,sha256:hash(bytes),byteLength:bytes.length})),generationCalls:0});
  put('proof-bundle.json',bundle);const prepared={files,bundle,report};
  if(existsSync(output))verifyProofBundle(output,prepared);else writeProofBundle(output,workflow,prepared);return report;
}
