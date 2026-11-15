import { encodeRgbaPng, inspectPng } from './png.mjs';
import { check, digest, exact, hash, id, isDigest, jsonBytes, seal, unseal } from './generation/common.mjs';
import { assessEnvironmentSource, assessEnvironmentSourceV2, environmentAlphaEvidence, environmentDefinition, environmentSupplementDefinition,
  ENVIRONMENT_SOURCE_PROFILE, ENVIRONMENT_SOURCE_PROFILE_SHA256, ENVIRONMENT_SOURCE_PROFILE_V2,
  ENVIRONMENT_SOURCE_PROFILE_V2_SHA256 } from './generation/environment-source.mjs';
import { raster, validateRaster, blit } from './terrain-proof/raster.mjs';
import { proofInventoryDigest } from './terrain-proof/derive.mjs';

// Alpha-weighted color, integer area weights, straight RGBA output. No matte,
// thresholds, color key, alpha dilation or inferred silhouette repair.
export function resampleEnvironmentAlpha(source, rect, width, height) {
  validateRaster(source);
  check(rect && [rect.x, rect.y, rect.width, rect.height, width, height].every(Number.isSafeInteger)
    && rect.x >= 0 && rect.y >= 0 && width > 0 && height > 0 && width <= rect.width && height <= rect.height
    && rect.x + rect.width <= source.width && rect.y + rect.height <= source.height, 'ENVIRONMENT_CROP');
  const result = raster(width, height), weight = rect.width * rect.height;
  for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < width; dx++) {
    const x0 = dx * rect.width, x1 = (dx + 1) * rect.width, y0 = dy * rect.height, y1 = (dy + 1) * rect.height;
    let sumAlpha = 0; const colors = [0, 0, 0];
    for (let sy = Math.floor(y0 / height); sy < Math.ceil(y1 / height); sy++) {
      const wy = Math.min(y1, (sy + 1) * height) - Math.max(y0, sy * height);
      for (let sx = Math.floor(x0 / width); sx < Math.ceil(x1 / width); sx++) {
        const wx = Math.min(x1, (sx + 1) * width) - Math.max(x0, sx * width);
        const p = ((rect.y + sy) * source.width + rect.x + sx) * 4, alphaWeight = source.rgba[p + 3] * wx * wy;
        sumAlpha += alphaWeight;
        for (let c = 0; c < 3; c++) colors[c] += source.rgba[p + c] * alphaWeight;
      }
    }
    const p = (dy * width + dx) * 4, alpha = Math.floor((sumAlpha + Math.floor(weight / 2)) / weight);
    result.rgba[p + 3] = alpha;
    if (alpha) for (let c = 0; c < 3; c++) result.rgba[p + c] = Math.floor((colors[c] + Math.floor(sumAlpha / 2)) / sumAlpha);
  }
  return result;
}

export function environmentPlacement(source, target, alphaEvidence) {
  const size = target.derivation.pixelSize;
  let crop, width, height;
  if (target.kind === 'background') {
    crop = source.width * size.height > source.height * size.width
      ? { x: 0, y: 0, width: Math.floor(source.height * size.width / size.height), height: source.height }
      : { x: 0, y: 0, width: source.width, height: Math.floor(source.width * size.height / size.width) };
    crop.x = Math.floor((source.width - crop.width) / 2); crop.y = Math.floor((source.height - crop.height) / 2);
    width = size.width; height = size.height;
    check(crop.width >= width && crop.height >= height, 'ENVIRONMENT_UPSCALE_REQUIRED');
  } else {
    const bounds = alphaEvidence.contentBounds;
    check(bounds, 'OUTPUT_EMPTY');
    const x = target.kind === 'strip' ? 0 : Math.max(0, bounds.x - 2), y = Math.max(0, bounds.y - 2);
    crop = { x, y, width: target.kind === 'strip' ? source.width : Math.min(source.width, bounds.x + bounds.width + 2) - x,
      height: Math.min(source.height, bounds.y + bounds.height + 2) - y };
    if (target.kind === 'strip') {
      check(crop.width >= size.width, 'ENVIRONMENT_UPSCALE_REQUIRED');
      width = size.width; height = Math.floor(crop.height * width / crop.width);
      check(height > 0 && height <= size.height, 'ENVIRONMENT_STRIP_TOO_TALL');
    } else {
      let numerator = 1, denominator = 1;
      if (size.width < crop.width) { numerator = size.width; denominator = crop.width; }
      if (size.height * denominator < crop.height * numerator) { numerator = size.height; denominator = crop.height; }
      width = Math.floor(crop.width * numerator / denominator); height = Math.floor(crop.height * numerator / denominator);
      check(width > 0 && height > 0, 'ENVIRONMENT_CONTENT_TOO_THIN');
    }
  }
  return { crop, resized: { width, height }, offset: { x: Math.floor((size.width - width) / 2), y: size.height - height },
    outputSize: size, anchorPx: target.kind === 'background' ? { x: 0, y: 0 } : { x: 0, y: size.height - 1 },
    fit: target.derivation.fit, aspectRounding: 'floor-to-integer-no-nonuniform-fill' };
}

export function environmentSeamEvidence(image, repeatAxis) {
  validateRaster(image); check(['none', 'x'].includes(repeatAxis), 'ENVIRONMENT_REPEAT');
  if (repeatAxis === 'none') return { axis: 'none', status: 'not-required' };
  let mismatchedRows = 0, maximumChannelDifference = 0;
  for (let y = 0; y < image.height; y++) {
    const a = y * image.width * 4, b = (y * image.width + image.width - 1) * 4; let rowDifference = 0;
    for (let c = 0; c < 4; c++) rowDifference = Math.max(rowDifference, Math.abs(image.rgba[a + c] - image.rgba[b + c]));
    if (rowDifference) mismatchedRows++; maximumChannelDifference = Math.max(maximumChannelDifference, rowDifference);
  }
  return { axis: 'x', comparedRows: image.height, mismatchedRows, maximumChannelDifference,
    status: mismatchedRows ? 'fail' : 'pass', visualContinuity: 'requires-human-review', repair: 'not-performed' };
}

function composite(image, dark = false) {
  const result = raster(image.width, image.height), palette = dark ? [[24, 34, 38], [51, 65, 68]] : [[244, 243, 234], [211, 220, 214]];
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const p = (y * image.width + x) * 4, alpha = image.rgba[p + 3], color = palette[(Math.floor(x / 16) + Math.floor(y / 16)) % 2];
    for (let c = 0; c < 3; c++) result.rgba[p + c] = Math.floor((image.rgba[p + c] * alpha + color[c] * (255 - alpha) + 127) / 255);
    result.rgba[p + 3] = 255;
  }
  return result;
}

export function deriveEnvironmentProof(raw, plan, studyOptions = null) {
  check(raw instanceof Uint8Array && raw.length > 0 && raw.length <= 16777216, 'IMAGE_BYTES');
  const allowHiddenRgb = ['ai_scene_generation_plan_v6', 'ai_scene_generation_plan_v7', 'ai_scene_environment_reinspection_v1', 'ai_scene_environment_preparation_v1', 'ai_scene_environment_preparation_v2'].includes(plan?.format);
  check((allowHiddenRgb && plan.target.profileSha256 === ENVIRONMENT_SOURCE_PROFILE_V2_SHA256)
    || (plan?.format === 'ai_scene_generation_plan_v5' && plan.target.profileSha256 === ENVIRONMENT_SOURCE_PROFILE_SHA256), 'ENVIRONMENT_PLAN');
  unseal(plan);
  const supplement = plan.format === 'ai_scene_generation_plan_v7'
    || (plan.format === 'ai_scene_environment_preparation_v2' && plan.sourcePlanFormat === 'ai_scene_generation_plan_v7');
  const define = supplement ? environmentSupplementDefinition : environmentDefinition;
  const role = define(plan.target.role, plan.target.sourcePolicy, plan.target.derivation);
  check(['alpha', 'kind', 'repeatAxis', 'fit'].every(key => role[key] === plan.target[key]), 'ENVIRONMENT_PLAN');
  const technical = (allowHiddenRgb ? assessEnvironmentSourceV2 : assessEnvironmentSource)(plan, Buffer.from(raw));
  check(technical.status === 'pass', 'ENVIRONMENT_SOURCE_NOT_READY');
  let target = plan.target, layoutStudy = null;
  if (studyOptions !== null) {
    check(allowHiddenRgb && target.kind === 'strip', 'ENVIRONMENT_LAYOUT_STUDY');
    exact(studyOptions, ['studyId', 'pixelSize']); id(studyOptions.studyId); exact(studyOptions.pixelSize, ['width', 'height']);
    check(studyOptions.pixelSize.width === target.derivation.pixelSize.width && Number.isSafeInteger(studyOptions.pixelSize.height)
      && studyOptions.pixelSize.height >= target.derivation.pixelSize.height && studyOptions.pixelSize.height <= 2048, 'ENVIRONMENT_LAYOUT_STUDY');
    layoutStudy = seal({ format: 'ai_scene_environment_layout_study_v1', studyId: studyOptions.studyId,
      sourceAssessmentSha256: plan.sha256, sourceTargetSha256: digest(plan.target), pixelSize: studyOptions.pixelSize,
      scope: 'separate-height-study-not-original-delivery', originalTargetPixelSize: target.derivation.pixelSize, generationCalls: 0 });
    target = { ...target, derivation: { ...target.derivation, pixelSize: studyOptions.pixelSize } };
  }
  const source = inspectPng(Buffer.from(raw), { allowCabx: true, includePixels: true, allowHiddenRgb });
  const placement = environmentPlacement(source, target, technical.alphaEvidence), size = placement.outputSize;
  const image = raster(size.width, size.height);
  blit(image, resampleEnvironmentAlpha(source, placement.crop, placement.resized.width, placement.resized.height), placement.offset.x, placement.offset.y);
  // Very faint scattered source pixels can all round to zero when reduced.
  // Keep the source; an empty derived PNG is not an environment candidate.
  const outputAlphaEvidence = environmentAlphaEvidence(image, 'background');
  check(outputAlphaEvidence.visiblePixels > 0, 'ENVIRONMENT_DERIVED_EMPTY');
  const seam = environmentSeamEvidence(image, target.repeatAxis), files = new Map(), artifacts = [];
  const add = (path, pixels) => {
    const bytes = encodeRgbaPng(pixels.width, pixels.height, pixels.rgba); files.set(path, bytes);
    artifacts.push({ path, sha256: hash(bytes), pixelSha256: hash(pixels.rgba), byteLength: bytes.length, pixelSize: { width: pixels.width, height: pixels.height } });
  };
  add('assets/environment.png', image); add('proofs/on-light.png', composite(image)); add('proofs/on-dark.png', composite(image, true));
  if (target.repeatAxis === 'x') {
    const width = Math.min(1024, image.width), height = Math.max(1, Math.floor(image.height * width / image.width));
    const small = resampleEnvironmentAlpha(image, { x: 0, y: 0, width: image.width, height: image.height }, width, height);
    const repeated = raster(width * 3, height);
    for (let index = 0; index < 3; index++) blit(repeated, small, width * index, 0);
    add('proofs/three-periods.png', composite(repeated));
  }
  const profile = allowHiddenRgb ? ENVIRONMENT_SOURCE_PROFILE_V2 : ENVIRONMENT_SOURCE_PROFILE;
  const profileSha256 = allowHiddenRgb ? ENVIRONMENT_SOURCE_PROFILE_V2_SHA256 : ENVIRONMENT_SOURCE_PROFILE_SHA256;
  const report = seal({ format: allowHiddenRgb ? 'ai_scene_environment_derivation_v2' : 'ai_scene_environment_derivation_v1',
    compiler: allowHiddenRgb ? 'scene-kit-environment-proof-v2' : 'scene-kit-environment-proof-v1',
    planSha256: plan.sha256, source: { sha256: hash(raw), byteLength: raw.length, pixelSize: { width: source.width, height: source.height } },
    profile, profileSha256, target, placement,
    sourceTechnicalSha256: technical.sha256, outputAlphaEvidence, seam, artifacts, status: seam.status === 'fail' ? 'blocked-seam' : 'technical-proof-only',
    sourceVisualAcceptance: 'separate-workflow-decision', visualAcceptance: 'not-assessed', productionKit: false,
    generationCalls: 0, independentGeneratedModuleCount: 0,
    ...(layoutStudy ? { layoutStudy, originalTarget: plan.target } : {}) });
  files.set('derivation.json', jsonBytes(report)); return { files, report };
}

export function environmentProofFiles(raw, evidence, plan, studyOptions = null) {
  exact(evidence, ['purpose', 'planSha256', 'requestSha256', 'rawSha256', 'technicalSha256']);
  check(['external-exchange', 'synthetic-simulation'].includes(evidence.purpose)
    && ['planSha256', 'requestSha256', 'rawSha256', 'technicalSha256'].every(key => isDigest(evidence[key]))
    && evidence.rawSha256 === hash(raw) && evidence.planSha256 === plan.sha256 && evidence.requestSha256 === digest(plan.request), 'PROOF_SOURCE_EVIDENCE');
  const { files, report } = deriveEnvironmentProof(raw, plan, studyOptions);
  check(report.sourceTechnicalSha256 === evidence.technicalSha256, 'PROOF_SOURCE_EVIDENCE');
  files.set('source/original.png', Buffer.from(raw));
  const bundle = seal({ format: studyOptions ? 'ai_scene_environment_layout_study_bundle_v1' : 'ai_scene_environment_proof_bundle_v1',
    ...evidence, derivationSha256: report.sha256,
    inventorySha256: proofInventoryDigest(files), artifacts: [...files].map(([path, bytes]) => ({ path, sha256: hash(bytes), byteLength: bytes.length })),
    status: report.status, sourceRequiresSeparateVisualReview: true, productionKit: false, visualAcceptance: 'not-assessed',
    ...(studyOptions ? { layoutStudySha256: report.layoutStudy.sha256 } : {}) });
  files.set('proof-bundle.json', jsonBytes(bundle)); return { files, report, bundle };
}
