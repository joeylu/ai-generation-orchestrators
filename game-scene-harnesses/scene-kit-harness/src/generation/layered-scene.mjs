import { canonicalJson } from '../document.mjs';
import { check, seal } from './common.mjs';
import { compileSceneReference, compileSceneSource } from './scene-sources.mjs';
import { sceneLayerComposition, sceneLayerPrompt, sceneLayerReviewChecklist, validateSceneLayerDesign } from './scene-layers.mjs';

function terminalParent(state, recipe, formats) {
  check(Array.isArray(recipe.parents) && recipe.parents.length <= 1, 'PLAN_PARENT');
  if (!recipe.parents.length) return;
  const parent = state.plans.get(recipe.parents[0]);
  check(formats.includes(parent?.plan.format) && parent.plan.recipe.assetId === recipe.assetId
    && parent.plan.recipe.slot === recipe.slot
    && ['failed', 'indeterminate', 'rejected-technical', 'rejected-visual'].includes(parent.status), 'PLAN_PARENT');
}
export function compileLayeredSceneReference(state, recipe) {
  const { layerDesign, ...baseRecipe } = recipe; validateSceneLayerDesign(layerDesign);
  terminalParent(state, recipe, ['ai_scene_generation_plan_v9', 'ai_scene_generation_plan_v10']);
  const { sha256: _old, ...base } = compileSceneReference(state, { ...baseRecipe, parents: [] });
  return seal({ ...base, format: 'ai_scene_generation_plan_v10', compiler: 'scene-kit-layered-reference-v1', recipe,
    composition: sceneLayerComposition(layerDesign), visualReviewChecklist: sceneLayerReviewChecklist(layerDesign),
    request: { ...base.request, format: 'ai_scene_image_request_v10', prompt: `${base.request.prompt}\n\n${sceneLayerPrompt(layerDesign)}` } });
}
export function compileLayeredSceneSource(state, recipe) {
  terminalParent(state, recipe, ['ai_scene_generation_plan_v11']);
  const reference = state.plans.get(recipe.referencePlans[0]);
  check(reference?.plan.format === 'ai_scene_generation_plan_v10', 'LAYERED_REFERENCE_REQUIRED');
  const { sha256: _old, ...base } = compileSceneSource(state, { ...recipe, parents: [] });
  const composition = sceneLayerComposition(reference.plan.recipe.layerDesign);
  const layer = composition.layers.find(item => item.sourceSlot === recipe.slot); check(layer, 'SCENE_LAYER_BINDING');
  const layerBinding = { referencePlanSha256: reference.plan.sha256, layerDesignSha256: composition.layerDesignSha256,
    profileSha256: composition.profileSha256, layerId: layer.layerId, sourceSlot: recipe.slot, layer };
  const instructions = recipe.slot === 'material'
    ? 'MATERIAL FROM THE TERRAIN LAYER ONLY: regenerate its surface lip and solid body as the requested canvas-filling material study. Exclude foreground, architecture and distant scenery. Do not reproduce the full scene.'
    : 'REGENERATE THE BOUND LAYER ONLY: use its visible forms in the accepted reference and its exact content/placement below. Exclude every other layer, including any foreground occluder. Preserve a complete isolated silhouette and base; infer occluded continuation consistently, without claiming exact recovery of hidden pixels. Placement describes the composite role, not a request to paint its neighbors or crop the isolated subject.';
  return seal({ ...base, format: 'ai_scene_generation_plan_v11', compiler: 'scene-kit-layered-sources-v1', recipe, layerBinding,
    request: { ...base.request, format: 'ai_scene_image_request_v11', prompt: [base.request.prompt, instructions,
      `SOURCE_LAYER_BINDING=${canonicalJson(layerBinding)}`, `REFERENCE_LAYER_CONTEXT=${canonicalJson(composition)}`].join('\n\n') } });
}
