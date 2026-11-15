// Offline proposal renderer only. These marks never become asset alpha/ownership.
import { inspectPng, encodeRgbaPng } from './png.mjs';
import { inspectDecompositionReference } from './reference-decomposition.mjs';
import { validateBlueprintPolygon } from './reference-blueprint.mjs';
import { pointInReferencePolygon } from './reference-layout.mjs';
import { areaResample, blit, raster } from './terrain-proof/raster.mjs';
import { check, digest, exact, hash, id, jsonBytes, seal, text, unseal } from './generation/common.mjs';

const KEEP = [35, 232, 139], REMOVE = [255, 79, 97], DARK = [17, 31, 47];
const GLYPHS = { K: ['101','110','100','110','101'], R: ['110','101','110','101','101'],
  '1': ['010','110','010','010','111'], '2': ['110','001','010','100','111'], '3': ['110','001','010','001','110'],
  '4': ['101','101','111','001','001'], '5': ['111','100','110','001','110'], '6': ['011','100','110','101','010'],
  '7': ['111','001','010','010','010'], '8': ['010','101','010','101','010'], '9': ['010','101','011','001','110'] };

export function regionGuideNativePoint(point, mapping) {
  exact(point, ['x', 'y']);
  check(['x', 'y'].every(axis => Number.isFinite(point[axis]) && point[axis] >= mapping.offset[axis]
    && point[axis] <= mapping.offset[axis] + mapping.resized[axis === 'x' ? 'width' : 'height']), 'REGION_GUIDE_CONTENT_POINT');
  return { x: Math.min(mapping.nativeSize.width - 1, Math.round((point.x - mapping.offset.x) * mapping.nativeSize.width / mapping.resized.width)),
    y: Math.min(mapping.nativeSize.height - 1, Math.round((point.y - mapping.offset.y) * mapping.nativeSize.height / mapping.resized.height)) };
}
function validate(target, plan, recipe) {
  unseal(plan); unseal(recipe);
  exact(unseal(recipe), ['format', 'guideId', 'targetSha256', 'baselinePlanSha256', 'instanceId', 'coordinates',
    'keepSearchEnvelope', 'keepExamples', 'removeExamples', 'removeSurfaceIds']);
  check(recipe.format === 'ai_scene_region_guide_recipe_v1' && recipe.coordinates === 'canonical-reference-frame'
    && recipe.targetSha256 === target.sha256 && recipe.baselinePlanSha256 === plan.sha256
    && plan.format === 'ai_scene_generation_plan_v23' && plan.recipe.targetSha256 === target.sha256
    && plan.recipe.assetId === recipe.instanceId && plan.referenceEvidence[0].rawSha256 === target.rawSha256, 'REGION_GUIDE_BINDING');
  id(recipe.guideId); const subject = target.instances.find(i => i.instanceId === recipe.instanceId);
  check(subject, 'REGION_GUIDE_INSTANCE');
  validateBlueprintPolygon(recipe.keepSearchEnvelope, target.mapping.viewport);
  recipe.keepSearchEnvelope.forEach(p => regionGuideNativePoint(p, target.mapping));
  check(Array.isArray(recipe.keepExamples) && recipe.keepExamples.length > 0 && recipe.keepExamples.length <= 9
    && Array.isArray(recipe.removeExamples) && recipe.removeExamples.length > 0 && recipe.removeExamples.length <= 9
    && Array.isArray(recipe.removeSurfaceIds) && recipe.removeSurfaceIds.length <= 12
    && new Set(recipe.removeSurfaceIds).size === recipe.removeSurfaceIds.length, 'REGION_GUIDE_EXAMPLES');
  const ids = new Set();
  for (const keep of recipe.keepExamples) {
    exact(keep, ['id', 'point', 'part']); id(keep.id); text(keep.part, { limit: 100 });
    check(!ids.has(keep.id), 'REGION_GUIDE_DUPLICATE'); ids.add(keep.id);
    regionGuideNativePoint(keep.point, target.mapping);
    check(pointInReferencePolygon(recipe.keepSearchEnvelope, keep.point), 'REGION_GUIDE_KEEP_OUTSIDE');
  }
  for (const remove of recipe.removeExamples) {
    exact(remove, ['id', 'instanceId', 'polygon']); id(remove.id);
    const other = target.instances.find(i => i.instanceId === remove.instanceId);
    check(!ids.has(remove.id) && other && other.instanceId !== subject.instanceId, 'REGION_GUIDE_REMOVE_INSTANCE'); ids.add(remove.id);
    validateBlueprintPolygon(remove.polygon, target.mapping.viewport);
    for (const p of remove.polygon) {
      regionGuideNativePoint(p, target.mapping);
      check(pointInReferencePolygon(other.visibleEnvelope, p), 'REGION_GUIDE_REMOVE_OUTSIDE');
    }
    check(recipe.keepExamples.every(k => !pointInReferencePolygon(remove.polygon, k.point)), 'REGION_GUIDE_CONFLICT');
  }
  for (const surfaceId of recipe.removeSurfaceIds) {
    const surface = target.surfaces.find(s => s.surfaceId === surfaceId);
    check(surface && surface.instanceId !== subject.instanceId, 'REGION_GUIDE_SURFACE');
    surface.points.forEach(p => regionGuideNativePoint(p, target.mapping));
  }
}
function pixel(image, x, y, rgb, opacity = 255) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const p = (y * image.width + x) * 4;
  for (let c = 0; c < 3; c++) image.rgba[p + c] = Math.floor((rgb[c] * opacity + image.rgba[p + c] * (255 - opacity) + 127) / 255);
}
function dot(image, x, y, radius, rgb) {
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++)
    if (dx * dx + dy * dy <= radius * radius) pixel(image, Math.round(x) + dx, Math.round(y) + dy, rgb);
}
function line(image, a, b, rgb, radius = 2, dashed = false) {
  const n = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  for (let i = 0; i <= n; i++) if (!dashed || Math.floor(i / 12) % 2 === 0) {
    const t = n ? i / n : 0; dot(image, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, radius, rgb);
  }
}
function outline(image, points, rgb, dashed) { points.forEach((a, i) => line(image, a, points[(i + 1) % points.length], rgb, 2, dashed)); }
function label(image, x, y, value, rgb) {
  x = Math.max(2, Math.min(image.width - value.length * 16 - 6, Math.round(x)));
  y = Math.max(2, Math.min(image.height - 26, Math.round(y)));
  for (let dy = 0; dy < 24; dy++) for (let dx = 0; dx < value.length * 16 + 4; dx++) pixel(image, x + dx, y + dy, DARK);
  for (const [i, character] of [...value].entries()) for (const [gy, row] of GLYPHS[character].entries())
    for (let gx = 0; gx < row.length; gx++) if (row[gx] === '1')
      for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) pixel(image, x + 4 + i * 16 + gx * 3 + dx, y + 4 + gy * 3 + dy, rgb);
}
function marker(image, point, value, rgb, cross) {
  for (let a = 0; a < 360; a++) dot(image, point.x + Math.cos(a * Math.PI / 180) * 14, point.y + Math.sin(a * Math.PI / 180) * 14, 2, rgb);
  if (cross) {
    line(image, { x: point.x - 6, y: point.y - 6 }, { x: point.x + 6, y: point.y + 6 }, rgb, 1);
    line(image, { x: point.x - 6, y: point.y + 6 }, { x: point.x + 6, y: point.y - 6 }, rgb, 1);
  }
  label(image, point.x + 20, point.y - 12, value, rgb);
}
function tintPolygon(image, points) {
  const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++)
    if (pointInReferencePolygon(points, { x, y })) pixel(image, x, y, REMOVE, 42);
}

export function regionGuideProposalFiles(target, raw, baselinePlan, recipe) {
  const original = inspectDecompositionReference(target, raw); validate(target, baselinePlan, recipe);
  const guide = { width: original.width, height: original.height, rgba: Buffer.from(original.rgba) };
  const native = p => regionGuideNativePoint(p, target.mapping);
  const keepEnvelope = recipe.keepSearchEnvelope.map(native), keepExamples = recipe.keepExamples.map(k => ({ ...k, nativePoint: native(k.point) }));
  const removeExamples = recipe.removeExamples.map(r => ({ ...r, nativePolygon: r.polygon.map(native) }));
  for (const r of removeExamples) { tintPolygon(guide, r.nativePolygon); outline(guide, r.nativePolygon, REMOVE, false); }
  for (const surfaceId of recipe.removeSurfaceIds) {
    const points = target.surfaces.find(s => s.surfaceId === surfaceId).points.map(native);
    points.slice(1).forEach((p, i) => line(guide, points[i], p, REMOVE, 2));
  }
  outline(guide, keepEnvelope, KEEP, true);
  keepExamples.forEach((k, i) => marker(guide, k.nativePoint, `K${i + 1}`, KEEP, false));
  removeExamples.forEach((r, i) => marker(guide, { x: Math.round(r.nativePolygon.reduce((n, p) => n + p.x, 0) / r.nativePolygon.length),
    y: Math.round(r.nativePolygon.reduce((n, p) => n + p.y, 0) / r.nativePolygon.length) }, `R${i + 1}`, REMOVE, true));
  const guideBytes = encodeRgbaPng(guide.width, guide.height, guide.rgba);
  const w = Math.min(2048, original.width), h = Math.floor(original.height * w / original.width), comparison = raster(w * 2, h);
  const preview = image => w === image.width ? image : areaResample(image, { x: 0, y: 0, width: image.width, height: image.height }, w, h);
  blit(comparison, preview(original), 0, 0); blit(comparison, preview(guide), w, 0);
  const instructions = 'INPUT 2 is the same full-scene canvas annotated ONLY for subject selection. Green dashed outline is a COARSE SEARCH AREA, not a silhouette, alpha mask or instruction to keep every enclosed pixel. Green K rings point to examples of the requested foreground rock, snow and attached branches. Red R patches and red playable-surface lines identify OTHER main-ground material that must be removed, even where close to or behind the foreground. Unmarked gaps/background/other layers must also be transparent. Keep the actual subject artwork from INPUT 1, not green/red ink, labels or rough polygon boundaries. Both images share the full reference frame; never crop, reframe, center or enlarge the subject.';
  const paragraphs = baselinePlan.request.prompt.split('\n\n'); paragraphs.splice(2, 0, instructions);
  const prompt = paragraphs.join('\n\n'), files = new Map([['reference-native.png', Buffer.from(raw)], ['reconstruction-target.json', jsonBytes(target)],
    ['baseline-plan.json', jsonBytes(baselinePlan)], ['guide-recipe.json', jsonBytes(recipe)], ['region-guide.png', guideBytes],
    ['review-comparison.png', encodeRgbaPng(comparison.width, comparison.height, comparison.rgba)], ['prompt-draft.txt', Buffer.from(prompt)]]);
  const proposal = seal({ format: 'ai_scene_region_guide_proposal_v1', targetSha256: target.sha256, rawSha256: target.rawSha256,
    baselinePlanSha256: baselinePlan.sha256, guideRecipeSha256: recipe.sha256, instanceId: recipe.instanceId,
    nativeSize: target.mapping.nativeSize, coordinates: recipe.coordinates, mapping: target.mapping,
    keepSearchEnvelopeNative: keepEnvelope, keepExamples, removeExamples, removeSurfaceIds: recipe.removeSurfaceIds,
    proposedInputs: [{ path: 'reference-native.png', role: 'accepted-scene-edit-target', sha256: hash(raw) },
      { path: 'region-guide.png', role: 'same-frame-region-selection-guide-not-edit-target', sha256: hash(guideBytes) }],
    reviewOnlyImages: ['review-comparison.png'], promptDraftSha256: hash(Buffer.from(prompt)),
    humanDesignAcceptance: 'pending', generationRuntimeSupport: 'not-implemented-for-region-guides', executable: false,
    guideMeaning: 'coarse-location-and-positive-negative-examples-not-pixel-ownership-not-alpha',
    sourceModified: false, targetModified: false, assetPixelsProduced: 0, generationCalls: 0, modelCalls: 0 });
  files.set('proposal.json', jsonBytes(proposal));
  files.set('README.md', Buffer.from('# 同画幅前景区域指示：设计审阅包\n\n[左原图／右标注](review-comparison.png) · [拟作为第二输入的完整标注图](region-guide.png) · [提示草案](prompt-draft.txt)\n\n' +
    '绿色虚线为粗定位范围，K圈指出要保留主体的材料/枝条示例；红色R区和表沿线指出须排除的主地形示例。粗范围可能包含主体间隙和邻层，不是精细mask，不能把范围内全部像素保留，红区也不是全部排除范围。原图决定真实轮廓、细枝和空隙。\n\n' +
    '两张拟输入均保持原生完整画幅；review-comparison只供人查看，不得传给工具。原PNG和已接受布局不改，不分割或生成素材。本包是待审控制设计，尚未接入生图运行时、冻结新计算计划或取得计算授权；软提示效果仍须验证。上一张素材美术状态不由本方案决定。\n'));
  const packet = seal({ format: 'ai_scene_region_guide_review_packet_v1', proposalSha256: proposal.sha256,
    targetSha256: target.sha256, baselinePlanSha256: baselinePlan.sha256, guideRecipeSha256: recipe.sha256,
    artifacts: [...files].map(([path, bytes]) => ({ path, sha256: hash(bytes), byteLength: bytes.length })),
    scope: 'region-guide-design-only-no-compute-no-art-decision', visualAcceptance: 'pending',
    generationRuntimeSupport: proposal.generationRuntimeSupport, generationCalls: 0, modelCalls: 0 });
  files.set('review-packet.json', jsonBytes(packet));
  const bundle = seal({ format: 'ai_scene_region_guide_proposal_bundle_v1', targetSha256: target.sha256, packetSha256: packet.sha256,
    artifacts: [...files].map(([path, bytes]) => ({ path, sha256: hash(bytes), byteLength: bytes.length })), generationCalls: 0 });
  files.set('proof-bundle.json', jsonBytes(bundle));
  // Ensure the prospective guide has a real image canvas, never a label mask.
  const checked = inspectPng(guideBytes); check(checked.transparentPixels === 0 && hash(raw) === target.rawSha256, 'REGION_GUIDE_RENDER');
  return { files, report: proposal, packet, bundle };
}
