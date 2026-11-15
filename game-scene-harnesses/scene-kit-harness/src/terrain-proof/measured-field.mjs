import { inspectPng, encodeRgbaPng } from '../png.mjs';
import { SIGNATURES, cellKey, signatureAt } from '../topology.mjs';
import { check, clone, deepFreeze, digest, exact, hash, id, jsonBytes, seal, text, unseal } from '../generation/common.mjs';
import { STUDY_LAYOUTS, studyInspectionLayout, renderStudyLayout, studySurface } from './modules.mjs';
import { referencePhaseAt } from './reference-field.mjs';
import { resampleJoinedField } from './joined-field.mjs';
import { periodize, raster, validateRaster } from './raster.mjs';

// Measurements are explicit author observations, not segmentation or art approval.
// The old reference/joined field profiles remain independent replay contracts.
export const MEASURED_FIELD_PROFILE = deepFreeze({
  format: 'ai_scene_measured_field_profile_v1', profile: 'sideview-observed-source-surface-v1',
  source: 'accepted-opaque-material-only',
  scale: 'lower-median-observed-macro-rock-width-ratio-native-to-reference-world-times-512-over-505-v1',
  crop: 'explicit-source-surface-and-body-origins-and-horizontal-window-center-v1',
  field: { width: 505, height: 253, maximumCapHeight: 64, blend: 4 },
  phases: { columns: 8, rows: 4, stride: 63, window: 64 },
  logicalPeriod: { width: 512, height: 256 },
  resample: 'uniform-rational-area-box-round-half-up-v1',
  bodyFill: 'sample-available-integer-field-rows-then-periodic-source-rows-no-rescale-v1',
  transition: { overlapFieldPixels: 1, alphaFadeRows: 0, capAlpha: 255,
    direction: 'vertical-source-depth-v1', composition: 'opaque-source-strip-over-body-v1',
    capMapping: 'world-x-512-v1', bodyMapping: 'surface-vertical-depth-with-source-origin-v1',
    gridMapping: 'legacy-world-phase-compatibility-fallback-not-identical-to-surface-relative-curve' },
  periodicCollar: 'horizontal-symmetric-four-pixels-body-bottom-only-four-pixels-preserve-body-head-v1',
  color: 'source-samples-and-declared-periodic-collar-only-no-tint-or-procedural-shade',
  referencePixelsCopied: 0, generationCalls: 0, productionKit: false, visualAcceptance: 'not-assessed',
});
export const MEASURED_FIELD_SHA256 = digest(MEASURED_FIELD_PROFILE);

const gcd = (a, b) => b ? gcd(b, a % b) : a;
const fraction = (numerator, denominator = 1) => {
  check(Number.isSafeInteger(numerator) && Number.isSafeInteger(denominator) && denominator > 0, 'MEASURED_FIELD_RATIONAL');
  const divisor = gcd(Math.abs(numerator), denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
};
const value = ratio => ratio.numerator / ratio.denominator;
const multiply = (a, b) => {
  const crossA = gcd(Math.abs(a.numerator), b.denominator), crossB = gcd(Math.abs(b.numerator), a.denominator);
  return fraction(a.numerator / crossA * (b.numerator / crossB), a.denominator / crossB * (b.denominator / crossA));
};
const rawBytes = input => input instanceof Uint8Array ? input : input?.raw;
function image(input, material = false) {
  const raw = rawBytes(input);
  check(raw instanceof Uint8Array && raw.length > 0 && raw.length <= 16777216, 'IMAGE_BYTES');
  const png = inspectPng(Buffer.from(raw), { allowCabx: true, pixelStats: true, includePixels: true, allowHiddenRgb: !material });
  check(png.varied && png.nonzeroAlphaPixels > 0, 'MEASURED_FIELD_IMAGE');
  if (material) check(!png.transparentPixels && png.width > png.height && png.height >= 512
    && png.width <= 4096 && png.height <= 4096, 'MATERIAL_SOURCE_SIZE');
  return { raw, png, ref: { sha256: hash(raw), byteLength: raw.length, pixelSize: { width: png.width, height: png.height } } };
}
const coordinate = (n, limit, inclusive = false) => Number.isSafeInteger(n) && n >= 0 && (inclusive ? n <= limit : n < limit);

function validateObservations(observations, referenceSize, materialSize, target) {
  exact(observations, ['format', 'sourceSurfaceTopY', 'sourceBodyStartY', 'sourceWindowCenterX',
    'rockFeaturePairs', 'referenceSurfaceSamples', 'notes']);
  check(observations.format === 'ai_scene_measured_surface_observations_v1', 'MEASURED_SURFACE_OBSERVATIONS');
  const { sourceSurfaceTopY: top, sourceBodyStartY: body, sourceWindowCenterX: center,
    rockFeaturePairs: pairs, referenceSurfaceSamples: samples } = observations;
  check(coordinate(top, materialSize.height) && coordinate(body, materialSize.height) && body > top
    && coordinate(center, materialSize.width, true), 'MEASURED_SOURCE_ORIGINS');
  check(Array.isArray(pairs) && pairs.length > 0 && pairs.length <= 64
    && Array.isArray(samples) && samples.length > 0 && samples.length <= 64, 'MEASURED_OBSERVATION_COUNT');
  const pairIds = new Set(), sampleIds = new Set();
  for (const pair of pairs) {
    exact(pair, ['featureId', 'source', 'reference']); id(pair.featureId);
    check(!pairIds.has(pair.featureId), 'MEASURED_FEATURE_ID'); pairIds.add(pair.featureId);
    for (const [span, size] of [[pair.source, materialSize], [pair.reference, referenceSize]]) {
      exact(span, ['fromX', 'toX']);
      check(coordinate(span.fromX, size.width) && coordinate(span.toX, size.width, true)
        && span.toX > span.fromX, 'MEASURED_FEATURE_SPAN');
    }
  }
  for (const sample of samples) {
    exact(sample, ['sampleId', 'surfaceId', 'x', 'topY', 'bodyStartY']); id(sample.sampleId); id(sample.surfaceId);
    check(!sampleIds.has(sample.sampleId), 'MEASURED_SAMPLE_ID'); sampleIds.add(sample.sampleId);
    check(coordinate(sample.x, referenceSize.width) && coordinate(sample.topY, referenceSize.height)
      && coordinate(sample.bodyStartY, referenceSize.height, true) && sample.bodyStartY > sample.topY,
    'MEASURED_REFERENCE_SAMPLE');
    if (target) check(target.surfaces?.some(surface => surface.surfaceId === sample.surfaceId), 'MEASURED_REFERENCE_SURFACE');
  }
  text(observations.notes, { limit: 2000 });
}

function parameters(referenceSize, materialSize, targetMapping, observations) {
  validateObservations(observations, referenceSize, materialSize);
  const scale = targetMapping.scale;
  check(scale && Number.isSafeInteger(scale.numerator) && Number.isSafeInteger(scale.denominator)
    && scale.numerator > 0 && scale.denominator > 0, 'MEASURED_REFERENCE_MAPPING');
  const pairs = observations.rockFeaturePairs.map(pair => {
    const sourceWidth = pair.source.toX - pair.source.fromX;
    const referenceWidth = pair.reference.toX - pair.reference.fromX;
    const referenceWorldWidth = multiply(fraction(referenceWidth), scale);
    const nativePixelsPerWorldPixel = multiply(fraction(sourceWidth, referenceWidth), fraction(scale.denominator, scale.numerator));
    return { featureId: pair.featureId, sourceWidth, referenceWidth, referenceWorldWidth, nativePixelsPerWorldPixel,
      nativePixelsPerFieldPixel: multiply(nativePixelsPerWorldPixel, fraction(512, 505)) };
  }).sort((a, b) => value(a.nativePixelsPerFieldPixel) - value(b.nativePixelsPerFieldPixel)
    || (a.featureId < b.featureId ? -1 : a.featureId > b.featureId ? 1 : 0));
  const selected = pairs[Math.floor((pairs.length - 1) / 2)], ratio = selected.nativePixelsPerFieldPixel;
  check(ratio.numerator >= ratio.denominator, 'MEASURED_FIELD_NATIVE_UPSCALE');
  const boundary = multiply(fraction(observations.sourceBodyStartY - observations.sourceSurfaceTopY),
    fraction(ratio.denominator, ratio.numerator));
  const end = fraction(boundary.numerator + boundary.denominator, boundary.denominator);
  const capHeight = Math.ceil(value(end));
  check(capHeight > 1 && capHeight <= MEASURED_FIELD_PROFILE.field.maximumCapHeight, 'MEASURED_FIELD_CAP_BUDGET');
  const capDepth = multiply(end, fraction(256, 253)), capUvEnd = multiply(end, fraction(1, capHeight));
  const unit = ratio.denominator * 2, step = ratio.numerator * 2;
  const x = observations.sourceWindowCenterX * unit - 505 * ratio.numerator;
  const bodyY = observations.sourceBodyStartY * unit, capY = observations.sourceSurfaceTopY * unit;
  const bodySampleHeight = Math.min(253, Math.floor((materialSize.height - observations.sourceBodyStartY) * ratio.denominator / ratio.numerator));
  check([unit, step, x, bodyY, capY, step * step * 255].every(Number.isSafeInteger)
    && x >= 0 && x + 505 * step <= materialSize.width * unit
    && bodySampleHeight > 0 && bodyY + bodySampleHeight * step <= materialSize.height * unit
    && capY + capHeight * step <= materialSize.height * unit, 'MEASURED_FIELD_SOURCE_WINDOW');
  const bodyRepeatRanges = [];
  for (let start = bodySampleHeight; start < 253; start += bodySampleHeight) {
    const count = Math.min(bodySampleHeight, 253 - start);
    bodyRepeatRanges.push({ targetStartRow: start, targetEndRowExclusive: start + count,
      sourceStartRow: 0, sourceEndRowExclusive: count });
  }
  const crop = (y, rows) => ({ x: fraction(x, unit), y: fraction(y, unit),
    width: multiply(fraction(505), ratio), height: multiply(fraction(rows), ratio) });
  const depths = observations.referenceSurfaceSamples.map(sample => ({ sampleId: sample.sampleId,
    depth: multiply(fraction(sample.bodyStartY - sample.topY), scale) }));
  const depthValues = depths.map(row => value(row.depth));
  const observedMinimum = Math.min(...depthValues), observedMaximum = Math.max(...depthValues);
  const surfaceDepth = multiply(boundary, fraction(256, 253));
  return {
    nativePixelsPerFieldPixel: ratio, selectedFeatureId: selected.featureId,
    boundaryFieldPixels: boundary, surfaceOriginInBodyPixels: fraction(-boundary.numerator, boundary.denominator),
    capDepth, capUvEnd, field: { width: 505, height: 253, capHeight },
    bodySampleHeight, bodyFill: 'periodic-source-rows-no-rescale', bodyRepeatRanges,
    crops: { body: crop(bodyY, bodySampleHeight), cap: crop(capY, capHeight) },
    sampling: { xNumerator: x, bodyYNumerator: bodyY, capYNumerator: capY, stepNumerator: step, denominator: unit },
    compatibility: { format: 'ai_scene_measured_surface_compatibility_v1', observations: 'human-approximate-native-pixel-spans',
      referenceSurfaceWorldDepths: depths, observedWorldDepthRange: { minimum: observedMinimum, maximum: observedMaximum },
      derivedSurfaceWorldDepth: surfaceDepth, derivedCoverageWorldDepth: capDepth,
      depthRatioToObservedRange: { minimum: value(surfaceDepth) / observedMaximum, maximum: value(surfaceDepth) / observedMinimum },
      rockFeatures: pairs.map(pair => ({ ...pair,
        derivedWorldWidth: multiply(fraction(pair.sourceWidth * ratio.denominator, ratio.numerator), fraction(512, 505)),
        widthRatioToReference: value(pair.nativePixelsPerFieldPixel) / value(ratio) })),
      exactFeatureCorrespondence: false, thresholdsApplied: false, status: 'requires-human-review', visualAcceptance: 'not-assessed' },
  };
}

export function compileMeasuredSurfaceMapping({ reference, target, material, observations }) {
  const ref = image(reference), source = image(material, true);
  unseal(target);
  check(target.rawSha256 === ref.ref.sha256 && digest(target.mapping?.nativeSize) === digest(ref.ref.pixelSize), 'MEASURED_REFERENCE_IDENTITY');
  validateObservations(observations, ref.ref.pixelSize, source.ref.pixelSize, target);
  const measured = parameters(ref.ref.pixelSize, source.ref.pixelSize, target.mapping, observations);
  return deepFreeze(seal({ format: 'ai_scene_measured_surface_mapping_v1', profileSha256: MEASURED_FIELD_SHA256,
    reference: ref.ref, targetSha256: target.sha256, material: source.ref, targetMapping: clone(target.mapping),
    observations: clone(observations), ...measured, referencePixelsCopied: 0, generationCalls: 0,
    productionKit: false, visualAcceptance: 'not-assessed' }));
}

export function validateMeasuredSurfaceMapping(mapping) {
  const body = unseal(mapping);
  exact(body, ['format', 'profileSha256', 'reference', 'targetSha256', 'material', 'targetMapping', 'observations',
    'nativePixelsPerFieldPixel', 'selectedFeatureId', 'boundaryFieldPixels', 'surfaceOriginInBodyPixels', 'capDepth',
    'capUvEnd', 'field', 'bodySampleHeight', 'bodyFill', 'bodyRepeatRanges', 'crops', 'sampling', 'compatibility',
    'referencePixelsCopied', 'generationCalls', 'productionKit', 'visualAcceptance']);
  check(body.format === 'ai_scene_measured_surface_mapping_v1' && body.profileSha256 === MEASURED_FIELD_SHA256
    && /^[a-f0-9]{64}$/.test(body.targetSha256) && body.referencePixelsCopied === 0 && body.generationCalls === 0
    && body.productionKit === false && body.visualAcceptance === 'not-assessed', 'MEASURED_MAPPING_PROFILE');
  for (const ref of [body.reference, body.material]) {
    exact(ref, ['sha256', 'byteLength', 'pixelSize']); exact(ref.pixelSize, ['width', 'height']);
    check(/^[a-f0-9]{64}$/.test(ref.sha256) && Number.isSafeInteger(ref.byteLength) && ref.byteLength > 0
      && ref.byteLength <= 16777216 && [ref.pixelSize.width, ref.pixelSize.height].every(n => Number.isSafeInteger(n) && n > 0 && n <= 4096),
    'MEASURED_MAPPING_IMAGE');
  }
  const expected = parameters(body.reference.pixelSize, body.material.pixelSize, body.targetMapping, body.observations);
  for (const [key, expectedValue] of Object.entries(expected)) check(digest(body[key]) === digest(expectedValue), 'MEASURED_MAPPING_PARAMETERS');
  return mapping;
}

// Preserve the body head: that is the actual adjacent source paint used by the
// one-pixel cap overlap. Only the bottom collar closes the vertical repeat.
export function periodizeMeasuredBody(source) {
  const result = periodize(source, 4, false);
  for (let d = 0; d < 4; d++) for (let x = 0; x < result.width; x++) {
    const p = ((result.height - 1 - d) * result.width + x) * 4, donor = (d * result.width + x) * 4;
    for (let c = 0; c < 3; c++) result.rgba[p + c] = Math.floor((result.rgba[p + c] * d + result.rgba[donor + c] * (4 - d) + 2) / 4);
  }
  return result;
}

export function measuredSurface(mask, x, y, capHeight) {
  const original = studySurface(mask, x, y), inset = Math.max(0, y - original.capY);
  const cap = !(mask & 1) && y >= inset && y < inset + capHeight;
  return { ...original, cap, capY: Math.max(0, y - inset), shade: 255,
    label: (original.label & ~1) | (cap ? 1 : 0) };
}

export function buildMeasuredTiles(body, cap) {
  validateRaster(body); validateRaster(cap);
  check(body.width === 64 && body.height === 64 && cap.width === 64 && cap.height > 1 && cap.height <= 64, 'PROOF_MATERIAL_SIZE');
  const tiles = new Map();
  for (const mask of SIGNATURES) {
    const tile = raster(64, 64);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const surface = measuredSurface(mask, x, y, cap.height), p = (y * 64 + x) * 4;
      if (!surface.alpha) continue;
      const source = surface.cap ? cap : body, q = ((surface.cap ? surface.capY : y) * 64 + x) * 4;
      tile.rgba.set(source.rgba.subarray(q, q + 3), p); tile.rgba[p + 3] = surface.alpha;
    }
    tiles.set(mask, tile);
  }
  return tiles;
}

function assessMeasuredLayout(layout, image, capHeight) {
  const cells = new Map(layout.cells.map(({ x, y }) => [cellKey(x, y), 'primary'])), interfaces = [];
  let geometryFailures = 0;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const mask = signatureAt(cells, Math.floor(x / 64), Math.floor(y / 64));
    const expected = mask === null ? 0 : measuredSurface(mask, x % 64, y % 64, capHeight).alpha;
    const p = (y * image.width + x) * 4;
    if (image.rgba[p + 3] !== expected || (!expected && (image.rgba[p] || image.rgba[p + 1] || image.rgba[p + 2]))) geometryFailures++;
  }
  for (const { x, y } of layout.cells) for (const [dx, dy, axis] of [[1, 0, 'x'], [0, 1, 'y']]) {
    const a = signatureAt(cells, x, y), b = signatureAt(cells, x + dx, y + dy);
    if (b === null) continue;
    let comparedPixels = 0, maximumChannelDifference = 0; const transitionOffsets = [];
    for (let t = 0; t < 64; t++) {
      const ax = axis === 'x' ? 63 : t, ay = axis === 'x' ? t : 63;
      const bx = axis === 'x' ? 0 : t, by = axis === 'x' ? t : 0;
      const sa = measuredSurface(a, ax, ay, capHeight), sb = measuredSurface(b, bx, by, capHeight);
      if (sa.label !== sb.label || sa.alpha !== sb.alpha) { transitionOffsets.push(t); continue; }
      comparedPixels++;
      const pa = ((y * 64 + ay) * image.width + x * 64 + ax) * 4;
      const pb = (((y + dy) * 64 + by) * image.width + (x + dx) * 64 + bx) * 4;
      for (let c = 0; c < 4; c++) maximumChannelDifference = Math.max(maximumChannelDifference, Math.abs(image.rgba[pa + c] - image.rgba[pb + c]));
    }
    interfaces.push({ cell: { x, y }, axis, comparedPixels, maximumChannelDifference, transitionOffsets,
      status: maximumChannelDifference ? 'fail' : comparedPixels ? 'pass' : 'not-assessed' });
  }
  return { layoutId: layout.layoutId, geometryFailures, interfaces,
    status: geometryFailures || interfaces.some(edge => edge.status === 'fail') ? 'fail' : 'pass',
    unassessedInterfaces: interfaces.filter(edge => edge.status === 'not-assessed').length,
    gridMapping: MEASURED_FIELD_PROFILE.transition.gridMapping, boundaryTransitions: 'requires-human-review', visualAcceptance: 'not-assessed' };
}

export function deriveMeasuredField(raw, mapping) {
  validateMeasuredSurfaceMapping(mapping);
  const source = image(raw, true);
  check(digest(source.ref) === digest(mapping.material), 'MEASURED_MATERIAL_IDENTITY');
  const { sampling: sample, field } = mapping;
  const sampledBody = resampleJoinedField(source.png, sample, 505, mapping.bodySampleHeight, sample.bodyYNumerator);
  const repeatedBody = raster(505, 253);
  for (let y = 0; y < repeatedBody.height; y++) {
    const sourceY = y % sampledBody.height;
    repeatedBody.rgba.set(sampledBody.rgba.subarray(sourceY * 505 * 4, (sourceY + 1) * 505 * 4), y * 505 * 4);
  }
  const body = periodizeMeasuredBody(repeatedBody);
  const cap = periodize(resampleJoinedField(source.png, sample, 505, field.capHeight, sample.capYNumerator), 4, false);
  const tiles = Array.from({ length: 32 }, (_, phase) => {
    const bx = phase % 8 * 63, by = Math.floor(phase / 8) * 63, b = raster(64, 64), c = raster(64, field.capHeight);
    for (const [target, input, sy] of [[b, body, by], [c, cap, 0]]) for (let y = 0; y < target.height; y++)
      target.rgba.set(input.rgba.subarray(((sy + y) * input.width + bx) * 4, ((sy + y) * input.width + bx + 64) * 4), y * 64 * 4);
    return buildMeasuredTiles(b, c);
  });
  const files = new Map(), artifacts = [], assessments = [];
  const add = (path, image) => {
    const bytes = encodeRgbaPng(image.width, image.height, image.rgba); files.set(path, bytes);
    artifacts.push({ path, sha256: hash(bytes), pixelSha256: hash(image.rgba), byteLength: bytes.length,
      pixelSize: { width: image.width, height: image.height } });
  };
  add('materials/body-field.png', body); add('materials/cap-field.png', cap);
  tiles.forEach((set, phase) => { for (const [signature, image] of set) add(`tiles/r${phase}-blob-${String(signature).padStart(3, '0')}.png`, image); });
  for (const layout of [...STUDY_LAYOUTS, studyInspectionLayout()]) {
    const image = renderStudyLayout(layout, tiles, referencePhaseAt), qa = assessMeasuredLayout(layout, image, field.capHeight);
    check(qa.status === 'pass', 'PROOF_GEOMETRY_OR_SEAM'); assessments.push(qa); add(`proofs/${layout.layoutId}.png`, image);
  }
  const report = seal({ format: 'ai_scene_measured_field_derivation_v1', profile: MEASURED_FIELD_PROFILE,
    profileSha256: MEASURED_FIELD_SHA256, source: source.ref, surfaceMappingSha256: mapping.sha256,
    referenceSha256: mapping.reference.sha256, targetSha256: mapping.targetSha256,
    crops: mapping.crops, field, nativePixelsPerFieldPixel: mapping.nativePixelsPerFieldPixel,
    bodySampleHeight: mapping.bodySampleHeight, bodyFill: mapping.bodyFill, bodyRepeatRanges: mapping.bodyRepeatRanges,
    surfaceOriginInBodyPixels: mapping.surfaceOriginInBodyPixels, capDepth: mapping.capDepth, capUvEnd: mapping.capUvEnd,
    compatibility: mapping.compatibility, sourceTransition: { origin: 'explicit-contiguous-source-paint',
      sourceSurfaceTopY: mapping.observations.sourceSurfaceTopY, sourceBodyStartY: mapping.observations.sourceBodyStartY,
      overlapFieldPixels: 1, alphaFadeRows: 0, capOpaque: true, colorGrading: false, semanticSegmentation: false,
      naturalTransitionAssessed: false, sourcePngModified: false, referencePixelsCopied: 0,
      samplingApproximation: 'independent-rational-area-footprints-and-linear-mesh-filtering-not-pixel-reconstruction' },
    artifacts, assessments, topologyRoles: SIGNATURES.length, phaseCount: 32, productionKit: false,
    visualAcceptance: 'not-assessed', generationCalls: 0 });
  files.set('surface-mapping.json', jsonBytes(mapping)); files.set('derivation.json', jsonBytes(report));
  return { files, report };
}
