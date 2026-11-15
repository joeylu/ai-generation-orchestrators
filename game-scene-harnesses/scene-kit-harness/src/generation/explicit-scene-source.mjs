import { canonicalJson } from '../document.mjs';
import { check, digest, exact, seal, text } from './common.mjs';
import { compileLayeredSceneSource } from './layered-scene.mjs';

// An explicit corrective request has a new format. Never rewrite frozen v11/v12 prompts.
export function compileExplicitSceneSource(state, recipe) {
  return compileSubjectSource(state, recipe, false);
}
// A parallel art candidate leaves its technically valid predecessor and reviews intact.
export function compileAlternativeSceneSource(state, recipe) {
  return compileSubjectSource(state, recipe, true);
}
function compileSubjectSource(state, recipe, alternative) {
  const { subjectBrief, ...baseRecipe } = recipe;
  exact(subjectBrief, ['content', 'exclusions']); text(subjectBrief.content, { limit: 2000 });
  check(Array.isArray(subjectBrief.exclusions) && subjectBrief.exclusions.length > 0
    && subjectBrief.exclusions.length <= 24 && new Set(subjectBrief.exclusions).size === subjectBrief.exclusions.length, 'SOURCE_SUBJECT_BRIEF');
  for (const excluded of subjectBrief.exclusions) text(excluded, { limit: 200 });
  check(Array.isArray(recipe.parents) && recipe.parents.length === 1, 'PLAN_PARENT');
  const parent = state.plans.get(recipe.parents[0]);
  const native = alternative && ['scene-native-border', 'scene-source-recovery'].includes(parent?.kind)
    ? state.plans.get(parent.plan.sourcePlanSha256) : parent;
  check(['ai_scene_generation_plan_v11', 'ai_scene_generation_plan_v12', 'ai_scene_generation_plan_v13', 'ai_scene_generation_plan_v14'].includes(native?.plan.format)
    && native.plan.recipe.assetId === recipe.assetId && native.plan.recipe.slot === recipe.slot
    && digest(native.plan.recipe.referencePlans) === digest(recipe.referencePlans)
    && (alternative ? ['pending-visual-review', 'accepted'].includes(parent.status) && parent.result?.technical.status === 'pass'
      : ['failed', 'indeterminate', 'rejected-technical', 'rejected-visual'].includes(parent.status)), 'PLAN_PARENT');
  const { sha256: _old, ...base } = compileLayeredSceneSource(state, { ...baseRecipe, parents: [] });
  check(base.target.alpha === 'transparent' && base.target.kind === 'environment', 'EXPLICIT_TRANSPARENT_SOURCE_ONLY');
  const style = state.designs.get(recipe.styleSha256);
  const sourceScope = { profile: alternative ? 'alternative-role-v1' : 'explicit-role-v1', role: recipe.slot, layerId: base.layerBinding.layerId,
    layerDesignSha256: base.layerBinding.layerDesignSha256, outputPurpose: 'single-scene-layer-source',
    requestedContent: base.layerBinding.layer.content, subjectBrief,
    referenceUsage: 'requested-subject-appearance-only', fullSceneCompositionRulesIncluded: false,
    fullSceneThemeIncluded: false, minimumTransparentMarginFraction: alternative ? { numerator: 3, denominator: 20 } : { numerator: 1, denominator: 10 },
    ...(alternative ? { alternativeOfPlanSha256: parent.plan.sha256, predecessorArtDecisionUnchanged: true } : {}) };
  const prompt = [
    'Create ONE isolated environmental asset for a pure 2D horizontal side-view game.',
    `The ENTIRE output subject is: ${subjectBrief.content}`,
    `The reviewed layer content for this subject is: ${base.layerBinding.layer.content}`,
    'Use the attached accepted reference ONLY to match this subject\'s shapes, palette, materials and light. Do not copy its complete composition. Infer hidden continuation consistently; do not claim exact recovery of hidden pixels.',
    `Exclude these contents entirely: ${subjectBrief.exclusions.join('; ')}.`,
    'Keep the complete subject centered and inside the canvas. Leave at least 10 percent of the full canvas width/height as fully transparent empty space on EACH of the four sides. No subject, shadow, haze or loose brush mark may touch any canvas edge. Keep real transparent holes between branches or separate forms. No opaque backing or ground strip.',
    'Use clear hand-painted silhouettes, broad color shapes and restrained texture noise, with consistent side-view scale. No photographic depth-of-field blur, bokeh, characters, independent props, UI, text, comparison panels or atlas.',
    `Additional source-specific requirements: ${recipe.intent}`,
    'Return ONE native landscape RGBA PNG, at least 1024 by 576 and at most 4096 on either edge, with a true transparent background. No drawn checkerboard. Preserve continuous alpha and original PNG bytes.',
    `Reviewed style: ${canonicalJson({ name: style.name, rules: style.rules })}`,
    'FINAL OUTPUT CHECK: only the described isolated subject; complete silhouette and base; empty transparent margins on all four sides; no neighboring scene layers.',
  ].join('\n\n');
  return seal({ ...base, format: alternative ? 'ai_scene_generation_plan_v14' : 'ai_scene_generation_plan_v13', compiler: alternative ? 'scene-kit-alternative-source-v1' : 'scene-kit-explicit-source-v1', recipe, sourceScope,
    visualReviewChecklist: { requiredChecks: ['Only the explicit subject and bound layer content.', 'All listed exclusions absent.',
      'Complete silhouettes and bases with transparent margins on all four sides.', 'Reviewed palette, light and clean shapes.'],
    automatedSemanticDetection: false, visualAcceptance: 'not-assessed' },
    request: { ...base.request, format: alternative ? 'ai_scene_image_request_v14' : 'ai_scene_image_request_v13',
      prompt: alternative ? prompt.replace('at least 10 percent', 'at least 15 percent') : prompt } });
}
