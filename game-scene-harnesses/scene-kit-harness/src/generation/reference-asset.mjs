import { canonicalJson } from '../document.mjs';
import { referenceInstanceContext } from '../reference-decomposition.mjs';
import { encodeRgbaPng } from '../png.mjs';
import { assessEnvironmentSourceV2 } from './environment-source.mjs';
import { check, digest, exact, hash, id, imageRef, seal, text } from './common.mjs';

function line(pixels, width, height, a, b, color) {
  const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  for (let n = 0; n <= steps; n++) {
    const t = steps ? n / steps : 0, x = Math.round(a.x + (b.x - a.x) * t), y = Math.round(a.y + (b.y - a.y) * t);
    if (x >= 0 && x < width && y >= 0 && y < height) pixels.set(color, (y * width + x) * 4);
  }
}
export function referenceAssetGuide(target, instance) {
  const viewport = target.mapping.viewport, pad = { x: Math.floor(viewport.width / 8), y: Math.floor(viewport.height / 8) };
  const frame = { width: viewport.width + pad.x * 2, height: viewport.height + pad.y * 2 };
  check(frame.width <= 4096 && frame.height <= 4096, 'REFERENCE_ASSET_GUIDE_SIZE');
  const aperture = { x: pad.x, y: pad.y, width: viewport.width, height: viewport.height };
  const rgba = Buffer.alloc(frame.width * frame.height * 4, 255);
  for (let p = 0; p < rgba.length; p += 4) rgba.set([236, 236, 236, 255], p);
  const corners = [{ x: pad.x, y: pad.y }, { x: pad.x + viewport.width - 1, y: pad.y },
    { x: pad.x + viewport.width - 1, y: pad.y + viewport.height - 1 }, { x: pad.x, y: pad.y + viewport.height - 1 }];
  corners.forEach((a, i) => line(rgba, frame.width, frame.height, a, corners[(i + 1) % 4], [155, 155, 155, 255]));
  const points = instance.visibleEnvelope.map(p => ({ x: Math.round(p.x + pad.x), y: Math.round(p.y + pad.y) }));
  points.forEach((a, i) => line(rgba, frame.width, frame.height, a, points[(i + 1) % points.length], [25, 25, 25, 255]));
  return { bytes: encodeRgbaPng(frame.width, frame.height, rgba), frame, aperture,
    meaning: 'coarse-visible-envelope-and-reference-aperture-not-alpha-mask-not-pixel-lock' };
}

export function compileReferenceAsset(state, recipe, readBlob) {
  exact(recipe, ['planId', 'parents', 'stage', 'specSha256', 'styleSha256', 'capabilitiesSha256', 'referencePlans',
    'inventoryRefs', 'assetId', 'targetSha256', 'subjectBrief', 'intent']);
  id(recipe.planId); id(recipe.assetId); text(recipe.intent, { empty: true, limit: 2000 });
  exact(recipe.subjectBrief, ['content', 'exclusions']); text(recipe.subjectBrief.content, { limit: 2000 });
  check(Array.isArray(recipe.subjectBrief.exclusions) && recipe.subjectBrief.exclusions.length > 0
    && recipe.subjectBrief.exclusions.length <= 24 && new Set(recipe.subjectBrief.exclusions).size === recipe.subjectBrief.exclusions.length, 'REFERENCE_ASSET_BRIEF');
  recipe.subjectBrief.exclusions.forEach(v => text(v, { limit: 200 }));
  check(recipe.stage === 'reference-asset' && recipe.specSha256 === state.activeSpec && recipe.styleSha256 === state.activeStyle
    && Array.isArray(recipe.referencePlans) && recipe.referencePlans.length === 1
    && Array.isArray(recipe.inventoryRefs) && recipe.inventoryRefs.length === 0
    && Array.isArray(recipe.parents) && recipe.parents.length <= 1, 'REFERENCE_ASSET_RECIPE');
  const reference = state.plans.get(recipe.referencePlans[0]), target = reference?.reconstructionTarget;
  check(reference?.status === 'accepted' && reference.result?.technical.status === 'pass'
    && target?.format === 'ai_scene_reference_reconstruction_target_v2' && target.sha256 === recipe.targetSha256
    && reference.plan.recipe.specSha256 === recipe.specSha256 && reference.plan.recipe.styleSha256 === recipe.styleSha256, 'REFERENCE_ASSET_ACCEPTED_TARGET');
  if (recipe.parents.length) {
    const parent = state.plans.get(recipe.parents[0]);
    check(parent?.plan.format === 'ai_scene_generation_plan_v21' && parent.plan.recipe.assetId === recipe.assetId
      && parent.plan.recipe.targetSha256 === recipe.targetSha256
      && ['failed', 'indeterminate', 'rejected-technical', 'rejected-visual'].includes(parent.status), 'PLAN_PARENT');
  }
  const cap = state.capabilities.get(recipe.capabilitiesSha256), style = state.designs.get(recipe.styleSha256);
  check(cap?.imageToImage === true && cap.maxInputImages >= 3 && cap.transparentBackground === true
    && cap.maxWidth >= 1024 && cap.maxHeight >= 576, 'REFERENCE_ASSET_CAPABILITY');
  const raw = readBlob(reference.result.rawSha256), context = referenceInstanceContext(target, raw, recipe.assetId);
  const guide = referenceAssetGuide(target, context.instance), sourceArtifact = reference.result.technical.image;
  const minimumWidth = Math.max(1024, guide.frame.width), minimumHeight = Math.max(576, guide.frame.height);
  check(cap.maxWidth >= minimumWidth && cap.maxHeight >= minimumHeight, 'REFERENCE_ASSET_CAPABILITY');
  check(hash(raw) === target.rawSha256 && digest(imageRef(raw, { allowCabx: true })) === digest(sourceArtifact), 'REFERENCE_ASSET_RAW');
  const alpha = context.instance.role === 'sky' ? 'opaque' : 'transparent';
  const images = [{ role: 'accepted-scene-art-and-composition', artifact: sourceArtifact },
    { role: 'exact-instance-context-not-cutout', artifact: imageRef(context.bytes) },
    { role: 'coarse-placement-guide-not-art-style', artifact: imageRef(guide.bytes) }];
  const placement = { profile: 'padded-reference-frame-v1', frame: guide.frame, referenceAperture: guide.aperture,
    mapping: 'native-output-uniform-contain-to-frame-then-subtract-reference-aperture-origin',
    visibleEnvelope: context.instance.visibleEnvelope, anchor: context.instance.anchor,
    anchorMeaning: 'reference-observation-not-sprite-pivot', sourceMapping: target.mapping,
    guideMeaning: guide.meaning, outsideReference: 'new-inferred-continuation-not-original-pixels',
    hardGeometryControl: false, automaticAlphaBoundsPlacement: false };
  const prompt = [
    'Generate ONE faithful reconstruction asset from the accepted 2D side-view scene. This is a new image-generation task, not pixel segmentation.',
    `The ONLY output subject is: ${recipe.subjectBrief.content}`,
    'INPUT 1 is the accepted complete scene: authoritative for the requested subject\'s observed silhouette, appearance, position, scale, palette, materials and lighting. Do not output the rest of the scene.',
    'INPUT 2 is an exact crop containing the subject AND neighboring context. Identify only the requested foreground/scene instance; do not copy every object inside the crop. It is not a cutout.',
    'INPUT 3 is a monochrome placement diagram, not artwork or style. The gray rectangle is the original reference aperture inside a padded storage canvas; the dark outline is only a coarse observed envelope. Fine branches, real contour and internal openings follow the artwork, not this rough polygon. Never paint diagram lines, gray backing, labels or a polygon slab.',
    `Use a landscape storage canvas with aspect ${guide.frame.width}:${guide.frame.height}. Preserve the subject\'s original normalized position and scale inside the reference aperture. DO NOT center the subject or enlarge it to fill the canvas. The aperture is x=${guide.aperture.x}, y=${guide.aperture.y}, width=${guide.aperture.width}, height=${guide.aperture.height} in the ${guide.frame.width}x${guide.frame.height} diagram. Output resolution may differ; keep those proportions. This is soft image guidance, not an exact pixel lock.`,
    'Preserve the visible composition of the requested subject, including its large forms, snow coverage, attached branches and value relationships where present. Remove occluding neighboring layers. Continue unseen or frame-clipped portions only consistently into the outer support area; these portions are inferred.'
      + (alpha === 'transparent' ? ' Keep the complete generated silhouette at least two transparent pixels away from every outer canvas border.' : ' Fill the opaque storage frame consistently.'),
    `Exclude completely: ${recipe.subjectBrief.exclusions.join('; ')}. No characters, independent props, text, UI, atlas, comparison panels, photographic blur or drawn checkerboard.`,
    alpha === 'transparent' ? 'Return ONE native landscape RGBA PNG with a genuinely transparent background and real openings between branches/forms. Preserve continuous alpha. Only the requested asset is visible.'
      : 'Return ONE opaque native landscape PNG for the requested sky source, without the other scene subjects.',
    `Minimum ${minimumWidth}x${minimumHeight}, maximum 4096 on either edge. Keep the original PNG; do not bake a new tint, fake a shadow backing or redesign the asset as a generic centered prop.`,
    `Reviewed style: ${canonicalJson({ name: style.name, rules: style.rules })}`,
    `Additional requirements: ${recipe.intent}`,
  ].join('\n\n');
  return seal({ format: 'ai_scene_generation_plan_v21', compiler: 'scene-kit-reference-asset-v1', recipe,
    designReviews: reference.plan.designReviews,
    referenceEvidence: [{ planSha256: reference.plan.sha256, rawSha256: target.rawSha256, acceptedPacketSha256: target.acceptedPacketSha256,
      targetSha256: target.sha256, humanReceiptSha256: target.humanReceiptSha256 }],
    instanceBinding: { instanceId: context.instance.instanceId, layerId: context.instance.layerId, role: context.instance.role,
      contextCrop: context.nativeCrop, cropMeaning: 'exact-context-only-not-alpha-mask', contextSha256: hash(context.bytes) },
    placement, target: { assetId: recipe.assetId, kind: 'environment', alpha,
      sourcePolicy: { mode: 'native-environment', orientation: 'landscape', minimumWidth, minimumHeight,
        maximumWidth: Math.min(4096, cap.maxWidth), maximumHeight: Math.min(4096, cap.maxHeight) } },
    visualReviewChecklist: { requiredChecks: ['Only the bound instance, without neighbors.', 'Observed silhouette, scale and frame placement match the accepted scene.',
      'Snow/rock value, palette, light and texture scale match.', 'Frame continuation and transparent edges reviewed separately.'],
      visualAcceptance: 'not-assessed', pixelIdentityRequired: false },
    request: { format: 'ai_scene_image_request_v21', task: 'reference-asset', prompt, images,
      output: { format: 'png', alpha, sourcePolicy: { mode: 'native-environment', orientation: 'landscape', minimumWidth, minimumHeight,
        maximumWidth: Math.min(4096, cap.maxWidth), maximumHeight: Math.min(4096, cap.maxHeight) } },
      maximumCalls: 1 } });
}

export function referenceAssetInputs(state, plan, readBlob) {
  const reference = state.plans.get(plan.recipe.referencePlans[0]), raw = readBlob(reference.result.rawSha256);
  const context = referenceInstanceContext(reference.reconstructionTarget, raw, plan.recipe.assetId);
  const guide = referenceAssetGuide(reference.reconstructionTarget, context.instance);
  return [raw, context.bytes, guide.bytes];
}

export function assessReferenceAsset(plan, bytes) {
  const qa = assessEnvironmentSourceV2(plan, bytes), issues = [...qa.issues];
  if (qa.image) {
    const { width, height } = qa.image.pixelSize, frame = plan.placement.frame;
    if (Math.abs(width * frame.height - height * frame.width) * 1000 > 20 * height * frame.width) issues.push('REFERENCE_ASSET_FRAME_ASPECT');
  }
  const { sha256: _sha, ...body } = qa;
  return seal({ ...body, format: 'ai_scene_reference_asset_qa_v1', policy: 'native-reference-asset-v1', issues,
    status: issues.length ? 'fail' : 'pass', geometryEvidence: 'soft-placement-guide-not-verified',
    silhouetteFidelity: 'requires-human-review', referencePlacement: 'not-assessed', pixelIdentityRequired: false });
}
