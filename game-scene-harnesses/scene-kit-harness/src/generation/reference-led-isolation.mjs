import { check, digest, exact, hash, id, seal, text } from './common.mjs';
import { compileReferenceLedPlan, referenceLedContent } from './reference-led.mjs';

const mode = 'reference-led-preset-text-only-v1';
const prefix = prompt => {
  const at = prompt.lastIndexOf('\n\nINTENT='); check(at >= 0, 'ISOLATION_BASE_PROMPT'); return prompt.slice(0, at);
};
function baselineFor(state, sha256) {
  const entry = state.plans.get(sha256);
  check(entry?.plan.format === 'ai_scene_generation_plan_v18' && entry.result?.technical.status === 'pass'
    && entry.status === 'rejected-visual' && entry.review?.receipt.decision === 'reject', 'ISOLATION_REJECTED_BASELINE_REQUIRED');
  check(entry.plan.recipe.specSha256 === state.activeSpec && entry.plan.recipe.styleSha256 === state.activeStyle, 'ISOLATION_BASELINE_STALE');
  const style = state.designs.get(entry.plan.recipe.styleSha256);
  check(style?.mode === 'preset' && style.anchors.length === 0, 'ISOLATION_PRESET_STYLE_REQUIRED');
  check(entry.plan.request.images.length > 0 && entry.plan.request.images.every(i => i.role === 'style-reference'), 'ISOLATION_STYLE_IMAGE_REQUIRED');
  check(compileReferenceLedPlan(state, entry.plan.recipe).sha256 === entry.plan.sha256, 'ISOLATION_BASELINE_CHANGED');
  return entry;
}
export function referenceLedIsolationRecipe(state, options) {
  exact(options, ['planId', 'baselinePlanSha256', 'intent']); id(options.planId); text(options.intent, { limit: 2000 });
  const baseline = baselineFor(state, options.baselinePlanSha256);
  return { ...baseline.plan.recipe, planId: options.planId, parents: [], intent: options.intent,
    baselinePlanSha256: options.baselinePlanSha256, experiment: mode };
}
export function compileReferenceLedIsolation(state, recipe) {
  exact(recipe, ['planId', 'parents', 'stage', 'mode', 'specSha256', 'styleSha256', 'capabilitiesSha256', 'referencePlans', 'inventoryRefs',
    'assetId', 'pixelPolicy', 'intent', 'baselinePlanSha256', 'experiment']);
  id(recipe.planId); text(recipe.intent, { limit: 2000 });
  check(recipe.experiment === mode && Array.isArray(recipe.parents) && recipe.parents.length <= 1, 'ISOLATION_RECIPE');
  const baseline = baselineFor(state, recipe.baselinePlanSha256), original = baseline.plan;
  const { planId: _id, parents: _parents, intent: _intent, baselinePlanSha256: _base, experiment: _mode, ...held } = recipe;
  const { planId: _oldId, parents: _oldParents, intent: _oldIntent, ...expected } = original.recipe;
  check(digest(held) === digest(expected), 'ISOLATION_HELD_INPUT_CHANGED');
  check(state.capabilities.get(recipe.capabilitiesSha256)?.textToImage === true, 'CAPABILITY_INPUT_UNSUPPORTED');
  if (recipe.parents.length) {
    const parent = state.plans.get(recipe.parents[0]);
    check(parent?.plan.format === 'ai_scene_generation_plan_v19' && parent.plan.recipe.baselinePlanSha256 === recipe.baselinePlanSha256
      && ['failed', 'indeterminate', 'rejected-technical', 'rejected-visual'].includes(parent.status), 'PLAN_PARENT');
  }
  const content = referenceLedContent(state, { specSha256: recipe.specSha256, styleSha256: recipe.styleSha256,
    capabilitiesSha256: recipe.capabilitiesSha256, pixelPolicy: recipe.pixelPolicy, intent: recipe.intent });
  check(prefix(content.request.prompt) === prefix(original.request.prompt) && digest(content.target) === digest(original.target)
    && digest(content.referenceRequirements) === digest(original.referenceRequirements), 'ISOLATION_BASE_PROMPT');
  return seal({ format: 'ai_scene_generation_plan_v19', compiler: 'scene-kit-reference-led-isolation-v1', recipe,
    designReviews: original.designReviews, referenceEvidence: [], target: content.target, referenceRequirements: content.referenceRequirements,
    inputPolicy: { ...content.inputPolicy, styleSource: 'accepted-preset-text-only', activeImageInputs: 0,
      omittedStyleImages: original.request.images.map(i => i.artifact) },
    experimentEvidence: { mode, baselinePlanSha256: original.sha256, baselineRawSha256: baseline.result.rawSha256,
      baselineTechnicalSha256: baseline.result.technical.sha256, baselineRejectionSha256: baseline.review.sha256,
      heldSpecSha256: recipe.specSha256, heldStyleSha256: recipe.styleSha256, heldRequirementsSha256: content.referenceRequirements.sha256,
      heldTargetSha256: digest(content.target), heldBasePromptSha256: hash(prefix(content.request.prompt)),
      intentBeforeSha256: hash(original.recipe.intent), intentAfterSha256: hash(recipe.intent),
      changes: ['all-uploaded-style-images-omitted', ...(recipe.intent === original.recipe.intent ? [] : ['intent-updated-for-zero-image-inputs'])], priorReviewPreserved: true,
      automaticStyleExtraction: false, causalConclusion: 'not-established', improvement: 'not-tested', newSingleUseAuthorizationRequired: true },
    request: { ...content.request, format: 'ai_scene_image_request_v19', images: [] } });
}
