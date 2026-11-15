import { paddedEnvironmentSource } from './environment-padding.mjs';
import { assertCurrent } from './compiler.mjs';
import { check, digest, exact, hash, id, seal, unseal } from './common.mjs';
import { inspectPng } from '../png.mjs';

const formats = ['ai_scene_generation_plan_v8', 'ai_scene_generation_plan_v11', 'ai_scene_generation_plan_v12', 'ai_scene_generation_plan_v13', 'ai_scene_generation_plan_v14'];
const operation = 'copy-all-rgba-at-offset-two-add-zero-rgba-border-only';
const rule = { eligibleIssue: 'ENVIRONMENT_ALPHA_MARGIN', marginWidth: 2, maximumMarginAlpha: 1,
  paddingPixels: 2, pixelOperation: operation, sourceRawPreserved: true,
  maximumSizePolicy: 'must-stay-within-original-source-policy', computeRetry: false, sourceArtAcceptance: 'not-granted' };
const frame = (store, state, sha) => paddedEnvironmentSource(store, state, sha, formats);

export function compileNativeBorderPolicy(store, state, batchSha256, sourcePlanSha256s, subset = false) {
  const batch = state.batches.get(batchSha256);
  check(batch && Array.isArray(sourcePlanSha256s) && sourcePlanSha256s.length > 0
    && new Set(sourcePlanSha256s).size === sourcePlanSha256s.length, 'NATIVE_BORDER_POLICY_SCOPE');
  const transparent = batch.planSha256s.filter(sha => state.plans.get(sha).plan.target.alpha === 'transparent');
  // v1 keeps its exact full-batch semantics. v2 can explicitly name a subset;
  // prior prepared/received sources and their approvals are never inherited.
  const members = subset ? transparent.filter(sha => sourcePlanSha256s.includes(sha)) : transparent;
  check(digest(members) === digest(sourcePlanSha256s), 'NATIVE_BORDER_POLICY_SCOPE');
  const examples = [];
  for (const sha of sourcePlanSha256s) {
    const entry = state.plans.get(sha);
    check(formats.includes(entry?.plan.format) && entry.plan.target.kind === 'environment'
      && ['authorized', 'rejected-technical'].includes(entry.status), 'NATIVE_BORDER_POLICY_SOURCE');
    assertCurrent(state, entry.plan);
    if (entry.status !== 'rejected-technical') continue;
    const { source, bytes, png, width, height } = frame(store, state, sha);
    const padded = inspectPng(bytes, { allowHiddenRgb: true, includePixels: true });
    examples.push({ sourcePlanSha256: sha, originalRawSha256: source.result.rawSha256,
      originalRgbaSha256: hash(png.rgba), paddedRawSha256: hash(bytes), paddedRgbaSha256: hash(padded.rgba),
      originalPixelSize: { width: png.width, height: png.height }, paddedPixelSize: { width, height } });
  }
  check(examples.length > 0, 'NATIVE_BORDER_POLICY_EXAMPLE');
  return seal({ format: subset ? 'ai_scene_native_border_policy_proposal_v2' : 'ai_scene_native_border_policy_proposal_v1',
    compiler: subset ? 'scene-kit-native-border-policy-v2' : 'scene-kit-native-border-policy-v1',
    ...(subset ? { scope: 'listed-sources-only' } : {}),
    batchSha256, sourcePlanSha256s, rule, examples, futureSourcesNeedMatchingRawQA: true, maximumNewImageCalls: 0 });
}

// Freeze a rule for named, unsubmitted plans using an already approved exact
// preparation as the pixel-operation example. This is not compute authorization.
export function compileNativeBorderFuturePolicy(store, state, options) {
  exact(options, ['batchSha256', 'sourcePlanSha256s', 'examplePreparationSha256']);
  const { batchSha256, sourcePlanSha256s, examplePreparationSha256 } = options, batch = state.batches.get(batchSha256);
  check(batch && Array.isArray(sourcePlanSha256s) && sourcePlanSha256s.length > 0
    && new Set(sourcePlanSha256s).size === sourcePlanSha256s.length
    && digest(batch.planSha256s.filter(sha => sourcePlanSha256s.includes(sha))) === digest(sourcePlanSha256s), 'NATIVE_BORDER_FUTURE_SCOPE');
  for (const sha of sourcePlanSha256s) {
    const entry = state.plans.get(sha);
    check(formats.includes(entry?.plan.format) && entry.plan.target.kind === 'environment' && entry.plan.target.alpha === 'transparent'
      && ['planned', 'authorized'].includes(entry.status) && !entry.attempt
      && entry.plan.recipe.referencePlans[0] === batch.referencePlanSha256, 'NATIVE_BORDER_FUTURE_SOURCE');
    assertCurrent(state, entry.plan);
  }
  const example = state.plans.get(examplePreparationSha256);
  check(example?.kind === 'scene-native-border' && ['pending-visual-review', 'accepted'].includes(example.status)
    && state.paddingApprovals.has(example.plan.approvalSha256)
    && example.plan.recipe.referencePlans[0] === batch.referencePlanSha256, 'NATIVE_BORDER_FUTURE_EXAMPLE');
  assertCurrent(state, example.plan);
  const { source, bytes, png, width, height } = frame(store, state, example.plan.sourcePlanSha256);
  check(hash(bytes) === example.result.rawSha256 && store.readBlob(example.result.rawSha256).equals(bytes), 'NATIVE_BORDER_FUTURE_EXAMPLE');
  const padded = inspectPng(bytes, { allowHiddenRgb: true, includePixels: true });
  const examples = [{ sourcePlanSha256: source.plan.sha256, originalRawSha256: source.result.rawSha256,
    originalRgbaSha256: hash(png.rgba), paddedRawSha256: hash(bytes), paddedRgbaSha256: hash(padded.rgba),
    originalPixelSize: { width: png.width, height: png.height }, paddedPixelSize: { width, height } }];
  return seal({ format: 'ai_scene_native_border_policy_proposal_v3', compiler: 'scene-kit-native-border-policy-v3',
    scope: 'listed-plans-before-dispatch', batchSha256, sourcePlanSha256s, examplePreparationSha256, rule, examples,
    futureSourcesNeedMatchingRawQA: true, maximumNewImageCalls: 0 });
}

export function compileNativeBorderPreparation(store, state, options) {
  exact(options, ['preparationId', 'approvalSha256', 'sourcePlanSha256']); id(options.preparationId);
  const approval = state.paddingApprovals.get(options.approvalSha256);
  check(approval?.format === 'ai_scene_native_border_policy_approval_v1'
    && approval.proposal.sourcePlanSha256s.includes(options.sourcePlanSha256), 'NATIVE_BORDER_APPROVAL_REQUIRED');
  unseal(approval.proposal);
  check(digest(approval.proposal.rule) === digest(rule), 'NATIVE_BORDER_POLICY_CHANGED');
  const { source, bytes, technical, png, width, height } = frame(store, state, options.sourcePlanSha256);
  const padded = inspectPng(bytes, { allowHiddenRgb: true, includePixels: true });
  const record = seal({ format: 'ai_scene_native_border_preparation_v1', compiler: 'scene-kit-native-border-v1',
    sourcePlanSha256: source.plan.sha256, approvalSha256: approval.sha256, proposalSha256: approval.proposal.sha256,
    originalRawSha256: source.result.rawSha256, originalRgbaSha256: hash(png.rgba), rawSha256: hash(bytes),
    paddedRgbaSha256: hash(padded.rgba), paddingPixels: 2, pixelOperation: operation,
    originalPixelSize: { width: png.width, height: png.height }, paddedPixelSize: { width, height },
    recipe: { ...source.plan.recipe, planId: options.preparationId, parents: [source.plan.sha256] },
    designReviews: source.plan.designReviews, referenceEvidence: source.plan.referenceEvidence,
    target: source.plan.target, ...(source.plan.layerBinding ? { layerBinding: source.plan.layerBinding } : {}),
    request: { format: 'ai_scene_no_generation_request_v1', maximumCalls: 0 }, technical,
    originalPreserved: true, allOriginalRgbaPreserved: true, sourceArtAcceptance: 'not-granted' });
  return { record, bytes };
}
