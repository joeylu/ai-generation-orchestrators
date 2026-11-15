import { inspectPng, encodeRgbaPng } from '../png.mjs';
import { SIGNATURES, cellKey, signatureAt } from '../topology.mjs';
import { check, deepFreeze, digest, hash, jsonBytes, seal } from '../generation/common.mjs';
import { STUDY_LAYOUTS, studyInspectionLayout, renderStudyLayout, studySurface } from './modules.mjs';
import { referencePhaseAt } from './reference-field.mjs';
import { periodize, raster, validateRaster } from './raster.mjs';

// The paint in the edge band is sampled from one contiguous part of the source.
// The program supplies coverage only: it never paints vegetation, contact shade,
// or a material boundary. A source with a painted hard stripe can still look hard.
export const JOINED_FIELD_PROFILE = deepFreeze({
  format: 'ai_scene_joined_field_profile_v1', profile: 'sideview-source-transition-overlay-v1',
  source: 'accepted-opaque-material-only',
  crop: 'largest-uniform-scale-body-below-eighth-edge-starts-sixteenth-same-x-v1',
  field: { width: 505, height: 253, capHeight: 32, blend: 4 },
  phases: { columns: 8, rows: 4, stride: 63, window: 64 },
  logicalPeriod: { width: 512, height: 256 },
  resample: 'uniform-rational-area-box-round-half-up-v1',
  transition: { retainedSourceRows: 24, alphaFadeRows: 8, lastRowAlpha: 0,
    composition: 'source-over-opaque-body-v1', capMapping: 'world-x-512-v1',
    curveBodyOrigin: 'cap-minus-body-native-origin-divided-by-common-native-scale-v1',
    gridBodyMapping: 'legacy-world-phase-overlay-fallback-not-identical-to-surface-relative-curve' },
  geometry: 'existing-study-alpha-and-logical-solid-no-invented-surface-details',
  color: 'source-samples-and-declared-periodic-collar-only-no-tint-or-procedural-shade',
  generationCalls: 0, productionKit: false, visualAcceptance: 'not-assessed',
});
export const JOINED_FIELD_SHA256 = digest(JOINED_FIELD_PROFILE);

const gcd = (a, b) => b ? gcd(b, a % b) : a;
const fraction = (numerator, denominator) => {
  const divisor = gcd(Math.abs(numerator), denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
};

// Fractions allow both axes and both fields to share exactly one native scale.
// Integer area weights avoid separate rounding of cap/body crop dimensions.
export function joinedFieldCrops(width, height) {
  check(Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > height && height >= 512
    && width <= 4096 && height <= 4096, 'MATERIAL_SOURCE_SIZE');
  const bodyY = Math.floor(height / 8), capY = Math.floor(height / 16), available = height - bodyY;
  const ratio = width * 253 <= available * 505 ? fraction(width, 505) : fraction(available, 253);
  const denominator = ratio.denominator * 2, stepNumerator = ratio.numerator * 2;
  check(ratio.numerator >= ratio.denominator, 'JOINED_FIELD_NATIVE_UPSCALE');
  const xNumerator = width * ratio.denominator - 505 * ratio.numerator;
  const crop = (y, rows) => ({ x: fraction(xNumerator, denominator), y: fraction(y * denominator, denominator),
    width: fraction(505 * stepNumerator, denominator), height: fraction(rows * stepNumerator, denominator) });
  return { nativePixelsPerFieldPixel: ratio,
    surfaceOriginInBodyPixels: fraction((capY - bodyY) * ratio.denominator, ratio.numerator),
    body: crop(bodyY, 253), cap: crop(capY, 32),
    sampling: { xNumerator, bodyYNumerator: bodyY * denominator, capYNumerator: capY * denominator,
      stepNumerator, denominator } };
}

export function resampleJoinedField(source, sampling, width, height, yNumerator) {
  validateRaster(source);
  const { xNumerator, stepNumerator: step, denominator: unit } = sampling;
  check([xNumerator, yNumerator, step, unit, width, height].every(Number.isSafeInteger)
    && xNumerator >= 0 && yNumerator >= 0 && step >= unit && unit > 0 && width > 0 && height > 0
    && xNumerator + width * step <= source.width * unit
    && yNumerator + height * step <= source.height * unit, 'PROOF_CROP');
  const result = raster(width, height), area = step * step;
  for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < width; dx++) {
    const x0 = xNumerator + dx * step, x1 = x0 + step;
    const y0 = yNumerator + dy * step, y1 = y0 + step, sums = [0, 0, 0];
    for (let sy = Math.floor(y0 / unit); sy < Math.ceil(y1 / unit); sy++) {
      const wy = Math.min(y1, (sy + 1) * unit) - Math.max(y0, sy * unit);
      for (let sx = Math.floor(x0 / unit); sx < Math.ceil(x1 / unit); sx++) {
        const wx = Math.min(x1, (sx + 1) * unit) - Math.max(x0, sx * unit);
        const p = (sy * source.width + sx) * 4;
        check(source.rgba[p + 3] === 255, 'PROOF_SOURCE_ALPHA');
        for (let c = 0; c < 3; c++) sums[c] += source.rgba[p + c] * wx * wy;
      }
    }
    const p = (dy * width + dx) * 4;
    for (let c = 0; c < 3; c++) result.rgba[p + c] = Math.floor((sums[c] + Math.floor(area / 2)) / area);
    result.rgba[p + 3] = 255;
  }
  return result;
}

export function joinedSurface(mask, x, y) {
  const original = studySurface(mask, x, y), inset = Math.max(0, y - original.capY);
  const cap = !(mask & 1) && y >= inset && y < inset + 32;
  return { ...original, cap, capY: Math.max(0, y - inset), shade: 255,
    label: (original.label & ~1) | (cap ? 1 : 0) };
}

export function buildJoinedTiles(body, cap) {
  validateRaster(body); validateRaster(cap);
  check(body.width === 64 && body.height === 64 && cap.width === 64 && cap.height === 32, 'PROOF_MATERIAL_SIZE');
  const tiles = new Map();
  for (const mask of SIGNATURES) {
    const image = raster(64, 64);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const surface = joinedSurface(mask, x, y), p = (y * 64 + x) * 4;
      if (!surface.alpha) continue;
      const q = (surface.capY * 64 + x) * 4, alpha = surface.cap ? cap.rgba[q + 3] : 0;
      for (let c = 0; c < 3; c++) image.rgba[p + c] = Math.floor((
        body.rgba[p + c] * (255 - alpha) + (alpha ? cap.rgba[q + c] * alpha : 0) + 127) / 255);
      image.rgba[p + 3] = surface.alpha;
    }
    tiles.set(mask, image);
  }
  return tiles;
}

export function assessJoinedLayout(layout, image) {
  validateRaster(image);
  check(image.width === layout.columns * 64 && image.height === layout.rows * 64, 'PROOF_LAYOUT_SIZE');
  const cells = new Map(layout.cells.map(({ x, y }) => [cellKey(x, y), 'primary'])), interfaces = [];
  let geometryFailures = 0;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const signature = signatureAt(cells, Math.floor(x / 64), Math.floor(y / 64));
    const expected = signature === null ? 0 : joinedSurface(signature, x % 64, y % 64).alpha;
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
      const sa = joinedSurface(a, ax, ay), sb = joinedSurface(b, bx, by);
      if (sa.label !== sb.label || sa.alpha !== sb.alpha) { transitionOffsets.push(t); continue; }
      comparedPixels++;
      const pa = ((y * 64 + ay) * image.width + x * 64 + ax) * 4;
      const pb = (((y + dy) * 64 + by) * image.width + (x + dx) * 64 + bx) * 4;
      for (let c = 0; c < 4; c++) maximumChannelDifference = Math.max(maximumChannelDifference,
        Math.abs(image.rgba[pa + c] - image.rgba[pb + c]));
    }
    // A neighbor can have its complete 32-row exposed strip where this cell has
    // none. That declared material transition is not an accidental tile seam.
    interfaces.push({ cell: { x, y }, axis, comparedPixels, minimumComparedPixels: 24,
      maximumChannelDifference, transitionOffsets,
      status: comparedPixels >= 24 && maximumChannelDifference === 0 ? 'pass' : 'fail' });
  }
  return { layoutId: layout.layoutId, occupiedCells: cells.size, geometryFailures, interfaces,
    status: !geometryFailures && interfaces.every(item => item.status === 'pass') ? 'pass' : 'fail',
    boundaryTransitions: 'requires-human-review', visualAcceptance: 'not-assessed' };
}

export function deriveJoinedField(raw) {
  check(raw instanceof Uint8Array && raw.length > 0 && raw.length <= 16777216, 'IMAGE_BYTES');
  const source = inspectPng(Buffer.from(raw), { allowCabx: true, pixelStats: true, includePixels: true });
  check(source.varied && !source.transparentPixels, 'MATERIAL_SOURCE_OPAQUE_NONBLANK');
  const crops = joinedFieldCrops(source.width, source.height), sample = crops.sampling;
  const body = periodize(resampleJoinedField(source, sample, 505, 253, sample.bodyYNumerator), 4, true);
  const cap = periodize(resampleJoinedField(source, sample, 505, 32, sample.capYNumerator), 4, false);
  for (let y = 24; y < 32; y++) for (let x = 0; x < cap.width; x++) {
    const p = (y * cap.width + x) * 4;
    cap.rgba[p + 3] = Math.floor((255 * (31 - y) + 3) / 7);
    if (!cap.rgba[p + 3]) cap.rgba.fill(0, p, p + 3);
  }
  const tiles = Array.from({ length: 32 }, (_, phase) => {
    const bx = phase % 8 * 63, by = Math.floor(phase / 8) * 63, b = raster(64, 64), c = raster(64, 32);
    for (const [target, input, sy] of [[b, body, by], [c, cap, 0]]) for (let y = 0; y < target.height; y++)
      target.rgba.set(input.rgba.subarray(((sy + y) * input.width + bx) * 4,
        ((sy + y) * input.width + bx + 64) * 4), y * 64 * 4);
    return buildJoinedTiles(b, c);
  });
  const files = new Map(), artifacts = [], assessments = [];
  const add = (path, image) => {
    const bytes = encodeRgbaPng(image.width, image.height, image.rgba); files.set(path, bytes);
    artifacts.push({ path, sha256: hash(bytes), pixelSha256: hash(image.rgba), byteLength: bytes.length,
      pixelSize: { width: image.width, height: image.height } });
  };
  add('materials/body-field.png', body); add('materials/cap-field.png', cap);
  tiles.forEach((set, phase) => {
    for (const [signature, image] of set) add(`tiles/r${phase}-blob-${String(signature).padStart(3, '0')}.png`, image);
  });
  for (const layout of [...STUDY_LAYOUTS, studyInspectionLayout()]) {
    const image = renderStudyLayout(layout, tiles, referencePhaseAt), qa = assessJoinedLayout(layout, image);
    check(qa.status === 'pass', 'PROOF_GEOMETRY_OR_SEAM'); assessments.push(qa); add(`proofs/${layout.layoutId}.png`, image);
  }
  const report = seal({ format: 'ai_scene_joined_field_derivation_v1', profile: JOINED_FIELD_PROFILE,
    profileSha256: JOINED_FIELD_SHA256, source: { sha256: hash(raw), byteLength: raw.length,
      pixelSize: { width: source.width, height: source.height } }, crops,
    surfaceOriginInBodyPixels: crops.surfaceOriginInBodyPixels, artifacts, assessments,
    sourceTransition: { origin: 'contiguous-source-paint', geometricDepth: 32, coverageFadeRows: [24, 31],
      inventedVegetation: false, inventedContactShade: false, colorGrading: false, semanticSegmentation: false,
      naturalTransitionAssessed: false, sourcePngModified: false },
    topologyRoles: SIGNATURES.length, phaseCount: 32, productionKit: false, visualAcceptance: 'not-assessed', generationCalls: 0 });
  files.set('derivation.json', jsonBytes(report));
  return { files, report };
}
