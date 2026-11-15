import { check, digest, exact, hash, id, seal, text } from './common.mjs';
import { flexibleReferenceContent } from './flexible-reference.mjs';

const mode = 'omit-uploaded-style-images-v1';
const prefix = prompt => {
  const at = prompt.lastIndexOf('\n\nINTENT='); check(at >= 0, 'EXPERIMENT_BASE_PROMPT'); return prompt.slice(0, at);
};
function baselineFor(state, sha256) {
  const entry = state.plans.get(sha256);
  check(entry?.plan.format === 'ai_scene_generation_plan_v16' && entry.result?.technical.status === 'pass'
    && ['pending-visual-review', 'rejected-visual'].includes(entry.status), 'EXPERIMENT_BASELINE_REQUIRED');
  check(entry.plan.recipe.specSha256 === state.activeSpec && entry.plan.recipe.styleSha256 === state.activeStyle, 'EXPERIMENT_BASELINE_STALE');
  const style = state.designs.get(entry.plan.recipe.styleSha256);
  check(style?.mode === 'preset' && style.anchors.length === 0, 'EXPERIMENT_PRESET_STYLE_REQUIRED');
  check(entry.plan.request.images.some(i => i.role === 'style-reference')
    && entry.plan.request.images.every(i => ['layout-reference', 'style-reference'].includes(i.role)), 'EXPERIMENT_STYLE_IMAGE_REQUIRED');
  return entry;
}
export function referenceInputExperimentRecipe(state, options) {
  exact(options, ['planId', 'baselinePlanSha256', 'intent']); id(options.planId); text(options.intent, { limit: 2000 });
  const baseline = baselineFor(state, options.baselinePlanSha256);
  return { ...baseline.plan.recipe, planId: options.planId, parents: [], intent: options.intent,
    baselinePlanSha256: options.baselinePlanSha256, experiment: mode };
}
export function compileReferenceInputExperiment(state, recipe) {
  exact(recipe, ['planId', 'parents', 'stage', 'specSha256', 'styleSha256', 'capabilitiesSha256', 'referencePlans', 'inventoryRefs', 'assetId',
    'pixelPolicy', 'blueprint', 'intent', 'baselinePlanSha256', 'experiment']);
  id(recipe.planId); text(recipe.intent, { limit: 2000 });
  check(recipe.experiment === mode && Array.isArray(recipe.parents) && recipe.parents.length <= 1, 'EXPERIMENT_RECIPE');
  const baseline = baselineFor(state, recipe.baselinePlanSha256), original = baseline.plan;
  const { planId: _id, parents: _parents, intent: _intent, baselinePlanSha256: _base, experiment: _mode, ...held } = recipe;
  const { planId: _oldId, parents: _oldParents, intent: _oldIntent, ...expected } = original.recipe;
  check(digest(held) === digest(expected), 'EXPERIMENT_HELD_INPUT_CHANGED');
  if (recipe.parents.length) {
    const parent = state.plans.get(recipe.parents[0]);
    check(parent?.plan.format === 'ai_scene_generation_plan_v17' && parent.plan.recipe.baselinePlanSha256 === recipe.baselinePlanSha256
      && ['failed', 'indeterminate', 'rejected-technical', 'rejected-visual'].includes(parent.status), 'PLAN_PARENT');
  }
  const content = flexibleReferenceContent(state, { specSha256: recipe.specSha256, styleSha256: recipe.styleSha256,
    capabilitiesSha256: recipe.capabilitiesSha256, pixelPolicy: recipe.pixelPolicy, blueprint: recipe.blueprint, intent: recipe.intent });
  check(prefix(content.request.prompt) === prefix(original.request.prompt) && digest(content.target) === digest(original.target), 'EXPERIMENT_BASE_PROMPT');
  const images = content.request.images.filter(i => i.role === 'layout-reference');
  check(images.length === 1 && digest(images[0]) === digest(original.request.images[0]), 'EXPERIMENT_LAYOUT_CHANGED');
  const specReview = state.designReviews.get(recipe.specSha256), styleReview = state.designReviews.get(recipe.styleSha256);
  check(specReview?.receipt.decision === 'accept' && styleReview?.receipt.decision === 'accept', 'DESIGN_REVIEW_REQUIRED');
  return seal({ format: 'ai_scene_generation_plan_v17', compiler: 'scene-kit-reference-input-experiment-v1', recipe,
    designReviews: { spec: specReview.sha256, style: styleReview.sha256 }, referenceEvidence: [], target: content.target,
    inputPolicy: { ...content.inputPolicy, styleSource: 'accepted-preset-text-only', omittedStyleImages: original.request.images.filter(i => i.role === 'style-reference').map(i => i.artifact) },
    experimentEvidence: { mode, baselinePlanSha256: original.sha256, baselineRawSha256: baseline.result.rawSha256,
      baselineTechnicalSha256: baseline.result.technical.sha256, heldSpecSha256: recipe.specSha256, heldStyleSha256: recipe.styleSha256,
      heldBlueprintSha256: recipe.blueprint.sha256, heldLayoutImageSha256: images[0].artifact.sha256, heldBasePromptSha256: hash(prefix(content.request.prompt)),
      intentBeforeSha256: hash(original.recipe.intent), intentAfterSha256: hash(recipe.intent),
      changes: ['uploaded-style-image-inputs-omitted', 'intent-updated-to-describe-one-input'],
      priorReviewPreserved: true, improvement: 'not-tested', newSingleUseAuthorizationRequired: true },
    request: { ...content.request, format: 'ai_scene_image_request_v17', images } });
}
