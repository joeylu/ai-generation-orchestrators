import { canonicalJson } from '../document.mjs';
import { check, deepFreeze, digest, exact, seal, text, unseal } from './common.mjs';

// Versioned composition contract. Never change v1 when replaying frozen plans.
export const SCENE_LAYER_PROFILE = deepFreeze({ format: 'ai_scene_layer_profile_v1',
  order: 'back-to-front', projection: 'pure-sideview', layers: [
    { layerId: 'sky', sourceSlot: 'sky', kind: 'background', parallaxX: 0,
      content: 'Sky, clouds and restrained atmosphere appropriate to the reviewed theme.',
      placement: 'Continuous background behind every other layer; resolve all exposed sky areas.', contrast: 'Lowest detail; quiet broad color shapes.' },
    { layerId: 'far-backdrop', sourceSlot: 'far-backdrop', kind: 'background', parallaxX: 0.12,
      content: 'Extreme-distance mountains or biome landforms appropriate to the reviewed theme.',
      placement: 'Upper to middle background; an identifiable landform silhouette against sky.', contrast: 'Lowest landform contrast, atmospheric palette.' },
    { layerId: 'distant-scenery', sourceSlot: 'distant-scenery', kind: 'background', parallaxX: 0.2,
      content: 'Distant vegetation or a theme-appropriate natural landscape band.',
      placement: 'Below and in front of the far landforms; retain a distinct contour.', contrast: 'Slightly stronger than far landforms, simplified small forms.' },
    { layerId: 'far-structure', sourceSlot: 'far-structure', kind: 'environment', parallaxX: 0.35,
      content: 'A distant architectural landmark or natural landmark appropriate to the reviewed theme.',
      placement: 'Recognizable background landmark, behind middle scenery and playable terrain.', contrast: 'Atmospheric, simplified; distinct from distant vegetation.' },
    { layerId: 'valley-detail', sourceSlot: 'valley-detail', kind: 'environment', parallaxX: 0.45,
      content: 'A static valley detail appropriate to the theme: ice, water, mist or dry valley scenery.',
      placement: 'Visible through the valley opening behind the playable ground; keep the valley readable.', contrast: 'Subordinate to playable terrain; distinct from empty canvas.' },
    { layerId: 'middle-scenery', sourceSlot: 'middle-scenery', kind: 'environment', parallaxX: 0.65,
      content: 'A middle-distance group of vegetation or natural formations appropriate to the reviewed theme.',
      placement: 'Behind near structures and playable terrain; show a readable outer silhouette and base.', contrast: 'Medium contrast and scale, stronger than distant scenery.' },
    { layerId: 'structure-a', sourceSlot: 'structure-a', kind: 'environment', parallaxX: 0.9,
      content: 'A near architectural opening or natural framing formation appropriate to the theme.',
      placement: 'Behind the playable surface; a recognizable opening or tall silhouette with visible boundaries.', contrast: 'Near-distance material scale; clear major shapes.' },
    { layerId: 'structure-b', sourceSlot: 'structure-b', kind: 'environment', parallaxX: 0.9,
      content: 'A low near architectural remnant or natural formation, visibly different from structure-a.',
      placement: 'Behind playable terrain; a separate low silhouette rather than a fragment fused into structure-a.', contrast: 'Same near-distance lighting and material scale as structure-a.' },
    { layerId: 'terrain', sourceSlot: 'material', kind: 'terrain', parallaxX: 1,
      content: 'Playable continuous ground, steps, slopes and cliffs with a thin surface lip and solid material body.',
      placement: 'Main play space. Extend visible solid ground bodies naturally to the bottom frame edge; retain the designed valley opening.', contrast: 'Strong readable playable edges; simple broad material shapes.' },
    { layerId: 'platform', sourceSlot: 'platform', kind: 'environment', parallaxX: 1,
      content: 'A complete solid floating platform matching the ground surface and body materials.',
      placement: 'Same gameplay depth as terrain, surrounded by visible air; horizontal surface and solid underside.', contrast: 'Match playable terrain; pure frontal elevation, no visible top plane.' },
    { layerId: 'foreground', sourceSlot: 'foreground', kind: 'environment', parallaxX: 1.1,
      content: 'A low sparse group of closest-camera biome forms, such as rocks or low vegetation appropriate to the theme.',
      placement: 'In front of playable terrain along the lower and side edges. Clearly distinct from vegetation sitting on top of the ground. Preserve playable surface and valley readability.', contrast: 'Nearest scale and stronger local contrast, restrained detail; sparse framing rather than a solid band.' },
  ], rules: [
    'Render ONE coherent complete landscape, not an exploded view, labeled diagram, atlas, stacked strips or comparison panels.',
    'Show identifiable visible evidence of every listed layer. These are semantic drawing roles, not eleven equally spaced depths; terrain and platform share the gameplay plane.',
    'Keep pure side-view projection throughout. Separate adjacent layers by contour, scale, value and atmospheric depth, not by artificial outlines or drawn separators.',
    'Use controlled overlap: do not fuse unrelated layers into one indistinguishable mass. Leave enough visible contour to identify and regenerate each requested role.',
    'Foreground must be visibly in front of the playable terrain, not merely small decoration resting on its surface. Do not obscure key walkable edges, gaps or platform surfaces.',
    'Resolve the entire frame. Continue exposed solid terrain to the bottom; resolve valley openings with the specified scenery. No undesigned blank footer, gray placeholder band, flat empty strip or terrain fading into a featureless fill.',
    'All layers share the reviewed theme, palette, light direction and style. No characters, independent props, UI or text.',
    'This composite guides later per-layer regeneration. It is not a layered image file, a segmentation mask, exact geometry or proof of recoverable occluded pixels.',
  ] });
export const SCENE_LAYER_PROFILE_SHA256 = digest(SCENE_LAYER_PROFILE);

export function makeSceneLayerDesign(contents = null) {
  if (contents !== null) exact(contents, SCENE_LAYER_PROFILE.layers.map(layer => layer.layerId));
  const result = seal({ format: 'ai_scene_layer_design_v1', profileSha256: SCENE_LAYER_PROFILE_SHA256,
    layers: SCENE_LAYER_PROFILE.layers.map(layer => ({ layerId: layer.layerId, content: contents?.[layer.layerId] ?? layer.content })) });
  validateSceneLayerDesign(result); return result;
}
export function validateSceneLayerDesign(design) {
  const body = unseal(design); exact(body, ['format', 'profileSha256', 'layers']);
  check(body.format === 'ai_scene_layer_design_v1' && body.profileSha256 === SCENE_LAYER_PROFILE_SHA256
    && Array.isArray(body.layers) && body.layers.length === SCENE_LAYER_PROFILE.layers.length, 'SCENE_LAYER_COVERAGE');
  body.layers.forEach((layer, index) => {
    exact(layer, ['layerId', 'content']);
    check(layer.layerId === SCENE_LAYER_PROFILE.layers[index].layerId, 'SCENE_LAYER_ORDER'); text(layer.content, { limit: 1000 });
  });
  return design;
}
export function sceneLayerComposition(design) {
  validateSceneLayerDesign(design);
  return { profileSha256: SCENE_LAYER_PROFILE_SHA256, layerDesignSha256: design.sha256,
    layers: SCENE_LAYER_PROFILE.layers.map((layer, index) => ({ ...layer, content: design.layers[index].content })),
    rules: SCENE_LAYER_PROFILE.rules };
}
export function sceneLayerPrompt(design) {
  return ['LAYERED COMPOSITION: follow the complete back-to-front layer design below within ONE coherent scene.',
    ...SCENE_LAYER_PROFILE.rules, `SCENE_LAYER_COMPOSITION=${canonicalJson(sceneLayerComposition(design))}`].join('\n\n');
}
export function sceneLayerReviewChecklist(design) {
  return seal({ format: 'ai_scene_layer_review_checklist_v1', layerDesignSha256: design.sha256,
    requiredLayers: sceneLayerComposition(design).layers.map(layer => ({ layerId: layer.layerId, content: layer.content,
      placement: layer.placement, visualAcceptance: 'not-assessed' })),
    checks: ['Each layer is visibly identifiable in the composite.', 'Foreground is in front of terrain and does not obscure gameplay edges.',
      'Bottom edge is resolved with terrain or designed valley scenery; no featureless gray footer.',
      'Adjacent silhouettes remain distinguishable; projection, lighting and style agree.'],
    automatedLayerDetection: false, visualAcceptance: 'not-assessed' });
}
