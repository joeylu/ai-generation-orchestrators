import { assertCurrent } from './compiler.mjs';
import { assessSceneSource } from './scene-sources.mjs';
import { check, digest, exact, hash, id, seal, unseal } from './common.mjs';

export function compileSourceRecoveryProposal(state, sourcePlanSha256, handoff, bytes) {
  check(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= 16777216, 'IMAGE_BYTES');
  const source = state.plans.get(sourcePlanSha256);
  check(['ai_scene_generation_plan_v8', 'ai_scene_generation_plan_v11', 'ai_scene_generation_plan_v12', 'ai_scene_generation_plan_v13', 'ai_scene_generation_plan_v14'].includes(source?.plan.format)
    && source.status === 'indeterminate' && !source.result && source.attempt && source.submission, 'SOURCE_RECOVERY_STATE');
  assertCurrent(state, source.plan);
  const evidence = unseal(handoff);
  exact(evidence, ['format', 'sourcePlanSha256', 'requestSha256', 'rawSha256', 'byteLength', 'inputSha256s',
    'observedImageCalls', 'exactArgumentsVerified', 'completedImageVerified', 'originalBytesPreserved']);
  check(evidence.format === 'ai_scene_completed_image_handoff_v1' && evidence.sourcePlanSha256 === sourcePlanSha256
    && evidence.requestSha256 === digest(source.plan.request) && evidence.rawSha256 === hash(bytes)
    && evidence.byteLength === bytes.length && bytes.length > 0 && bytes.length <= 16777216
    && digest(evidence.inputSha256s) === digest(source.plan.request.images.map(image => image.artifact.sha256))
    && evidence.observedImageCalls === 1 && evidence.exactArgumentsVerified === true
    && evidence.completedImageVerified === true && evidence.originalBytesPreserved === true, 'SOURCE_RECOVERY_HANDOFF');
  const technical = assessSceneSource(source.plan, bytes);
  check(technical.status === 'pass', 'SOURCE_RECOVERY_TECHNICAL');
  return seal({ format: 'ai_scene_source_recovery_proposal_v1', sourcePlanSha256,
    handoff, rawSha256: hash(bytes), byteLength: bytes.length, technical,
    operation: 'register-exact-completed-image-as-separate-source', originalAttemptOutcome: 'indeterminate',
    sourceBytesModified: false, newImageCalls: 0, sourceArtAcceptance: 'not-assessed' });
}

export function compileSourceRecovery(state, options, bytes) {
  exact(options, ['recoveryId', 'proposal', 'receipt']); id(options.recoveryId);
  unseal(options.proposal);
  const proposal = compileSourceRecoveryProposal(state, options.proposal.sourcePlanSha256, options.proposal.handoff, bytes);
  check(digest(proposal) === digest(options.proposal) && options.receipt.decision === 'accept'
    && options.receipt.targetSha256 === proposal.sha256, 'SOURCE_RECOVERY_APPROVAL');
  const source = state.plans.get(proposal.sourcePlanSha256);
  return seal({ format: 'ai_scene_source_recovery_v1', compiler: 'scene-kit-completed-source-recovery-v1',
    sourcePlanSha256: source.plan.sha256, proposal, receipt: options.receipt,
    rawSha256: proposal.rawSha256, technical: proposal.technical,
    recipe: { ...source.plan.recipe, planId: options.recoveryId, parents: [source.plan.sha256] },
    designReviews: source.plan.designReviews, referenceEvidence: source.plan.referenceEvidence,
    target: source.plan.target, ...(source.plan.layerBinding ? { layerBinding: source.plan.layerBinding } : {}),
    request: { format: 'ai_scene_no_generation_request_v1', maximumCalls: 0 },
    originalAttemptOutcome: 'indeterminate', sourceBytesModified: false, sourceArtAcceptance: 'not-assessed' });
}
