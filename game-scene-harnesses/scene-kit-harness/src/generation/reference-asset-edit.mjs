import { canonicalJson } from '../document.mjs';
import { inspectPng } from '../png.mjs';
import { referenceInstanceContext } from '../reference-decomposition.mjs';
import { assessEnvironmentSourceV2 } from './environment-source.mjs';
import { check, digest, exact, hash, id, imageRef, seal, text } from './common.mjs';

// v21 is immutable. Original-canvas edits deliberately use a new recipe and QA.
export const REFERENCE_LAYER_EDIT_MODE = 'original-canvas-layer-edit-v1';
export const REFERENCE_LAYER_SINGLE_INPUT_MODE = 'original-canvas-single-input-edit-v1';
const EDGES = ['left', 'top', 'right', 'bottom'];
export const compileReferenceAssetEdit = (state, recipe, readBlob) => compileLayerEdit(state, recipe, readBlob, false);
export const compileReferenceAssetSingleInput = (state, recipe, readBlob) => compileLayerEdit(state, recipe, readBlob, true);
function compileLayerEdit(state, recipe, readBlob, singleInput) {
  exact(recipe, ['planId', 'parents', 'stage', 'specSha256', 'styleSha256', 'capabilitiesSha256', 'referencePlans',
    'inventoryRefs', 'assetId', 'targetSha256', 'subjectBrief', 'intent', 'mode', 'clippedEdges']);
  id(recipe.planId); id(recipe.assetId); text(recipe.intent, { empty: true, limit: 2000 });
  exact(recipe.subjectBrief, ['content', 'exclusions']); text(recipe.subjectBrief.content, { limit: 2000 });
  check(Array.isArray(recipe.subjectBrief.exclusions) && recipe.subjectBrief.exclusions.length > 0
    && recipe.subjectBrief.exclusions.length <= 24 && new Set(recipe.subjectBrief.exclusions).size === recipe.subjectBrief.exclusions.length, 'REFERENCE_ASSET_BRIEF');
  recipe.subjectBrief.exclusions.forEach(v => text(v, { limit: 200 }));
  check(recipe.mode === (singleInput ? REFERENCE_LAYER_SINGLE_INPUT_MODE : REFERENCE_LAYER_EDIT_MODE) && recipe.stage === 'reference-asset'
    && recipe.specSha256 === state.activeSpec && recipe.styleSha256 === state.activeStyle
    && Array.isArray(recipe.referencePlans) && recipe.referencePlans.length === 1
    && Array.isArray(recipe.inventoryRefs) && recipe.inventoryRefs.length === 0
    && Array.isArray(recipe.parents) && recipe.parents.length <= 1, 'REFERENCE_ASSET_RECIPE');
  const reference = state.plans.get(recipe.referencePlans[0]), target = reference?.reconstructionTarget;
  check(reference?.status === 'accepted' && reference.result?.technical.status === 'pass'
    && target?.format === 'ai_scene_reference_reconstruction_target_v2' && target.sha256 === recipe.targetSha256
    && reference.plan.recipe.specSha256 === recipe.specSha256 && reference.plan.recipe.styleSha256 === recipe.styleSha256, 'REFERENCE_ASSET_ACCEPTED_TARGET');
  if (recipe.parents.length) {
    const parent = state.plans.get(recipe.parents[0]);
    check((singleInput ? ['ai_scene_generation_plan_v22', 'ai_scene_generation_plan_v23']
      : ['ai_scene_generation_plan_v21', 'ai_scene_generation_plan_v22']).includes(parent?.plan.format)
      && parent.plan.recipe.assetId === recipe.assetId && parent.plan.recipe.targetSha256 === recipe.targetSha256
      && ['failed', 'indeterminate', 'rejected-technical', 'rejected-visual'].includes(parent.status), 'PLAN_PARENT');
  }
  const cap = state.capabilities.get(recipe.capabilitiesSha256), style = state.designs.get(recipe.styleSha256);
  check(cap?.imageToImage === true && cap.maxInputImages >= (singleInput ? 1 : 2) && cap.transparentBackground === true
    && cap.maxWidth >= 1024 && cap.maxHeight >= 576, 'REFERENCE_ASSET_CAPABILITY');
  const raw = readBlob(reference.result.rawSha256), context = referenceInstanceContext(target, raw, recipe.assetId);
  const sourceArtifact = reference.result.technical.image;
  check(hash(raw) === target.rawSha256 && digest(imageRef(raw, { allowCabx: true })) === digest(sourceArtifact), 'REFERENCE_ASSET_RAW');
  check(context.instance.role !== 'sky', 'REFERENCE_LAYER_TRANSPARENT_ONLY');
  const viewport = target.mapping.viewport, envelope = context.instance.visibleEnvelope;
  const touches = { left: envelope.some(p => p.x <= 0), top: envelope.some(p => p.y <= 0),
    right: envelope.some(p => p.x >= viewport.width - 1), bottom: envelope.some(p => p.y >= viewport.height - 1) };
  check(Array.isArray(recipe.clippedEdges) && recipe.clippedEdges.length <= 4
    && new Set(recipe.clippedEdges).size === recipe.clippedEdges.length
    && recipe.clippedEdges.every(e => EDGES.includes(e) && touches[e]
      && context.instance.visibility.includes('frame-clipped')), 'REFERENCE_LAYER_CLIPPED_EDGES');
  const nativeSize = sourceArtifact.pixelSize;
  const sourcePolicy = { mode: 'native-environment', orientation: 'landscape', minimumWidth: 1024, minimumHeight: 576,
    maximumWidth: Math.min(4096, cap.maxWidth), maximumHeight: Math.min(4096, cap.maxHeight) };
  const prompt = [
    'Use case: background-extraction. Edit INPUT 1 into ONE transparent visible scene layer. INPUT 1 is the EDIT TARGET, not a style reference. Keep its original full landscape canvas and composition.',
    `Keep only this existing subject: ${recipe.subjectBrief.content}`,
    ...(singleInput ? [] : ['INPUT 2 is an exact local crop ONLY to identify the subject inside INPUT 1. It contains neighboring layers. Do not use the crop as the output frame, do not copy every object in it, and do not enlarge, center, mirror or redesign the subject.']),
    `Preserve the ${nativeSize.width}:${nativeSize.height} full-scene canvas aspect and the subject's normalized position, scale, visible silhouette, snow coverage, attached branches, palette, lighting, material detail and edge sharpness from INPUT 1. Prefer the original ${nativeSize.width}x${nativeSize.height} canvas. This is soft image-edit guidance, not a guaranteed pixel lock.`,
    `Retain only what is visible of this subject in INPUT 1. Preserve its ORIGINAL frame clipping at: ${recipe.clippedEdges.length ? recipe.clippedEdges.join(', ') : 'none'}. Do not reveal or complete outside-frame material, extend the canvas, add a support area or invent an unseen back side. This pass produces a visible layer, not a complete standalone reusable module.`,
    `Make every other layer and all gaps/openings genuinely transparent, including: ${recipe.subjectBrief.exclusions.join('; ')}. Do not leave scenery, a gray backing, shadows from removed neighbors, an atlas, text, UI or a drawn checkerboard. Do not blur the foreground.`,
    `On edges other than the declared original clipped edges, keep at least two fully transparent border pixels. Do not shrink or move the subject to add padding on the declared clipped edges. Return ONE native RGBA PNG with continuous alpha. Minimum 1024x576, maximum ${sourcePolicy.maximumWidth}x${sourcePolicy.maximumHeight}.`,
    `Reviewed style data (preserve the actual edit target's appearance): ${canonicalJson({ name: style.name, rules: style.rules })}`,
    `Additional requirements: ${recipe.intent}`,
  ].join('\n\n');
  return seal({ format: singleInput ? 'ai_scene_generation_plan_v23' : 'ai_scene_generation_plan_v22',
    compiler: singleInput ? 'scene-kit-reference-layer-single-input-v1' : 'scene-kit-reference-layer-edit-v1', recipe,
    designReviews: reference.plan.designReviews,
    referenceEvidence: [{ planSha256: reference.plan.sha256, rawSha256: target.rawSha256,
      acceptedPacketSha256: target.acceptedPacketSha256, targetSha256: target.sha256, humanReceiptSha256: target.humanReceiptSha256 }],
    instanceBinding: { instanceId: context.instance.instanceId, layerId: context.instance.layerId, role: context.instance.role,
      contextCrop: context.nativeCrop, cropMeaning: singleInput ? 'review-only-context-not-transmitted' : 'locator-only-not-output-frame-not-alpha-mask', contextSha256: hash(context.bytes) },
    placement: { profile: singleInput ? REFERENCE_LAYER_SINGLE_INPUT_MODE : REFERENCE_LAYER_EDIT_MODE, frame: viewport,
      referenceAperture: { x: 0, y: 0, width: viewport.width, height: viewport.height },
      nativeReferenceSize: nativeSize, mapping: 'native-output-uniform-contain-to-original-reference-frame',
      visibleEnvelope: envelope, anchor: context.instance.anchor, anchorMeaning: 'reference-observation-not-sprite-pivot',
      sourceMapping: target.mapping, outsideReference: 'unknown-not-generated',
      hardGeometryControl: false, automaticAlphaBoundsPlacement: false },
    target: { assetId: recipe.assetId, kind: 'environment', alpha: 'transparent', sourcePolicy,
      purpose: 'visible-reference-layer-not-completed-module', borderPolicy: { marginPx: 2, originalClippedEdges: recipe.clippedEdges } },
    visualReviewChecklist: { requiredChecks: ['Only the requested visible instance remains.', 'Original canvas, subject position and scale are preserved.',
      'Observed contour, snow, branches, values and sharpness match.', 'Declared frame cuts stay in place; no outside completion.'],
      visualAcceptance: 'not-assessed', pixelIdentityRequired: false },
    request: { format: singleInput ? 'ai_scene_image_request_v23' : 'ai_scene_image_request_v22', task: 'reference-asset', prompt,
      images: [{ role: 'accepted-scene-edit-target-original-canvas', artifact: sourceArtifact },
        ...(singleInput ? [] : [{ role: 'exact-instance-locator-not-output-frame', artifact: imageRef(context.bytes) }])],
      output: { format: 'png', alpha: 'transparent', sourcePolicy }, maximumCalls: 1 } });
}

export function referenceAssetEditInputs(state, plan, readBlob) {
  const reference = state.plans.get(plan.recipe.referencePlans[0]), raw = readBlob(reference.result.rawSha256);
  return [raw, ...(plan.format === 'ai_scene_generation_plan_v23' ? []
    : [referenceInstanceContext(reference.reconstructionTarget, raw, plan.recipe.assetId).bytes])];
}

export function assessReferenceAssetEdit(plan, bytes) {
  // Reuse PNG/area/size checks; v22 owns its explicitly declared edge policy.
  const qa = assessEnvironmentSourceV2({ ...plan, target: { ...plan.target, kind: 'visible-reference-layer' } }, bytes);
  const issues = [...qa.issues]; let edgeEvidence = null;
  if (qa.image) {
    const png = inspectPng(bytes, { allowCabx: true, allowHiddenRgb: true, includePixels: true });
    const { width, height, rgba } = png, counts = Object.fromEntries(EDGES.map(e => [e, 0]));
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (rgba[(y * width + x) * 4 + 3]) {
      if (x < 2) counts.left++; if (y < 2) counts.top++;
      if (x >= width - 2) counts.right++; if (y >= height - 2) counts.bottom++;
    }
    const allowed = plan.target.borderPolicy.originalClippedEdges;
    edgeEvidence = { marginPx: 2, visibleBorderPixelsByEdge: counts, originalClippedEdges: allowed,
      violatedEdges: EDGES.filter(e => !allowed.includes(e) && counts[e] > 0) };
    if (edgeEvidence.violatedEdges.length) issues.push('REFERENCE_LAYER_UNDECLARED_EDGE');
    const frame = plan.placement.nativeReferenceSize;
    if (Math.abs(width * frame.height - height * frame.width) * 1000 > 20 * height * frame.width) issues.push('REFERENCE_ASSET_FRAME_ASPECT');
  }
  const { sha256: _sha, ...body } = qa;
  return seal({ ...body, format: 'ai_scene_reference_layer_qa_v1', policy: REFERENCE_LAYER_EDIT_MODE, edgeEvidence, issues,
    status: issues.length ? 'fail' : 'pass', geometryEvidence: 'original-canvas-edit-soft-guidance-not-verified',
    silhouetteCompleteness: 'visible-frame-only-outside-unknown', silhouetteFidelity: 'requires-human-review',
    referencePlacement: 'not-assessed', pixelIdentityRequired: false, completedReusableModule: false });
}
