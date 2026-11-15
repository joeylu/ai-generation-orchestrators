import { encodeRgbaPng, inspectPng } from '../png.mjs';
import { check, deepFreeze, digest, hash, jsonBytes, seal } from '../generation/common.mjs';
import { materialCrops } from './derive.mjs';
import { revisionCrops } from './revision.mjs';
import { TERRAIN_CONTINUITY_STUDY_SHA256 } from './continuity.mjs';
import { areaResample, blit, periodize, raster, validateRaster } from './raster.mjs';

// A separate offline experiment. The frozen four-cell field and Studio's
// appearance snapshot are deliberately not changed by this producer.
export const TERRAIN_LONG_FIELD_STUDY = deepFreeze({
  format: 'ai_scene_terrain_long_field_profile_v1', profile: 'sideview-quilted-material-field-study-v1',
  scope: 'offline-material-comparison-not-production-kit', baselineProfileSha256: TERRAIN_CONTINUITY_STUDY_SHA256,
  crop: 'full-source-width-below-v1-cap-and-v2-trimmed-cap-v1',
  resample: 'integer-area-box-round-half-up-v1', bodyPoolHeight: 253,
  poolWidth: 'floor-source-width-times-253-over-body-height',
  quilt: { patchWidth: 253, overlap: 64, originQuarters: [0, 3, 1, 4, 2],
    seam: 'minimum-rgb-l1-top-to-bottom-three-neighbor-leftmost-ties-v1',
    ownership: 'existing-through-seam-new-after-seam', transforms: ['identity'] },
  textureField: { width: 1009, height: 253, capHeight: 8, periodicBlendPx: 4 },
  sampling: { columns: 16, rows: 4, stridePx: 63, windowPx: 64, sharedSamplePixels: 1,
    origin: 'world-zero', selection: 'positive-modulo-world-cell-coordinate' },
  comparison: { columns: 32, rows: 4, capHeight: 8, gapPx: 16, upper: 'four-cell-baseline', lower: 'sixteen-cell-quilt' },
  generationCalls: 0, independentGeneratedModuleCount: 0, productionKit: false, visualAcceptance: 'not-assessed',
});
export const TERRAIN_LONG_FIELD_STUDY_SHA256 = digest(TERRAIN_LONG_FIELD_STUDY);

export function longFieldCrops(width, height) {
  const original = materialCrops(width, height), trimmed = revisionCrops(width, height).cap;
  return { body: { x: 0, y: original.body.y, width, height: original.body.height },
    cap: { x: 0, y: trimmed.y, width, height: trimmed.height } };
}

// Integer dynamic programming, bounded by the fixed 64 x 253 overlap. It
// chooses a cut through matching colors; it does not generate missing stone.
export function minimumVerticalSeam(costs, width, height) {
  check(Number.isInteger(width) && width > 0 && width <= 64 && Number.isInteger(height) && height > 0 && height <= 253
    && ArrayBuffer.isView(costs) && typeof costs.every === 'function' && costs.length === width * height
    && costs.every(value => Number.isSafeInteger(value) && value >= 0 && value <= 765), 'QUILT_COSTS');
  const totals = new Uint32Array(costs.length), previous = new Int16Array(costs.length);
  for (let x = 0; x < width; x++) totals[x] = costs[x];
  for (let y = 1; y < height; y++) for (let x = 0; x < width; x++) {
    let best = Math.max(0, x - 1);
    for (let candidate = best + 1; candidate <= Math.min(width - 1, x + 1); candidate++)
      if (totals[(y - 1) * width + candidate] < totals[(y - 1) * width + best]) best = candidate;
    const p = y * width + x;
    totals[p] = costs[p] + totals[(y - 1) * width + best]; previous[p] = best;
  }
  let end = 0;
  for (let x = 1; x < width; x++) if (totals[(height - 1) * width + x] < totals[(height - 1) * width + end]) end = x;
  const cost = totals[(height - 1) * width + end], columns = Array(height);
  for (let y = height - 1; y >= 0; y--) { columns[y] = end; end = previous[y * width + end]; }
  return { columns, totalRgbL1: cost };
}

export function quiltMaterialPool(pool) {
  validateRaster(pool);
  const { patchWidth, overlap, originQuarters } = TERRAIN_LONG_FIELD_STUDY.quilt, step = patchWidth - overlap;
  check(pool.width >= patchWidth && [8, 253].includes(pool.height), 'QUILT_POOL_SIZE');
  for (let p = 3; p < pool.rgba.length; p += 4) check(pool.rgba[p] === 255, 'PROOF_SOURCE_ALPHA');
  const field = raster(1009, pool.height), origins = originQuarters.map(q => Math.floor((pool.width - patchWidth) * q / 4)), seams = [];
  for (let patch = 0; patch < origins.length; patch++) {
    const start = patch * step, sourceX = origins[patch];
    let seam;
    if (patch) {
      const costs = new Uint16Array(overlap * pool.height);
      for (let y = 0; y < pool.height; y++) for (let x = 0; x < overlap; x++) {
        const a = (y * field.width + start + x) * 4, b = (y * pool.width + sourceX + x) * 4;
        for (let c = 0; c < 3; c++) costs[y * overlap + x] += Math.abs(field.rgba[a + c] - pool.rgba[b + c]);
      }
      seam = minimumVerticalSeam(costs, overlap, pool.height);
      seams.push({ patch, startX: start, sourceX, overlap, ...seam });
    }
    for (let y = 0; y < pool.height; y++) for (let x = patch ? seam.columns[y] + 1 : 0; x < patchWidth; x++) {
      const a = (y * field.width + start + x) * 4, b = (y * pool.width + sourceX + x) * 4;
      field.rgba.set(pool.rgba.subarray(b, b + 4), a);
    }
  }
  return { field, origins, seams };
}

// Same shared-sample convention as the old 47-role study, without producing
// thousands of tiles or advertising compatibility with its fixed 16 phases.
export function materialFieldPixel(field, worldX, worldY) {
  validateRaster(field);
  check(Number.isSafeInteger(worldX) && Number.isSafeInteger(worldY)
    && [253, 1009].includes(field.width) && [8, 253].includes(field.height), 'MATERIAL_FIELD_SAMPLE');
  const sample = (coordinate, periods) => {
    const cell = Math.floor(coordinate / 64), local = coordinate - cell * 64;
    return ((cell % periods + periods) % periods) * 63 + local;
  };
  const x = sample(worldX, (field.width - 1) / 63), y = field.height === 8 ? ((worldY % 8 + 8) % 8) : sample(worldY, 4);
  return field.rgba.subarray((y * field.width + x) * 4, (y * field.width + x) * 4 + 4);
}

export function fieldLagEvidence(field, lagCells) {
  validateRaster(field);
  check(field.height === 253 && [253, 1009].includes(field.width)
    && Number.isSafeInteger(lagCells) && lagCells > 0 && lagCells <= 32, 'MATERIAL_FIELD_LAG');
  const width = field.width - 1, height = field.height - 1, lag = lagCells * 63;
  let totalRgbL1 = 0, equalPixels = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const a = (y * field.width + x) * 4, b = (y * field.width + (x + lag) % width) * 4;
    let difference = 0;
    for (let c = 0; c < 3; c++) difference += Math.abs(field.rgba[a + c] - field.rgba[b + c]);
    totalRgbL1 += difference; if (!difference) equalPixels++;
  }
  return { lagCells, totalRgbL1, equalPixels, comparedPixels: width * height, comparedChannels: width * height * 3,
    interpretation: 'exact-pixel-lag-only-not-perceptual-quality' };
}

function renderFlat(body, cap) {
  const result = raster(2048, 256);
  for (let y = 0; y < result.height; y++) for (let x = 0; x < result.width; x++)
    result.rgba.set(materialFieldPixel(y < 8 ? cap : body, x, y), (y * result.width + x) * 4);
  return result;
}

export function deriveTerrainLongFieldStudy(raw) {
  check(raw instanceof Uint8Array && raw.length > 0 && raw.length <= 16777216, 'IMAGE_BYTES');
  let source;
  try { source = inspectPng(Buffer.from(raw), { allowCabx: true, pixelStats: true, includePixels: true }); }
  catch { check(false, 'MATERIAL_SOURCE_PNG'); }
  check(!source.transparentPixels && source.varied, 'MATERIAL_SOURCE_OPAQUE_NONBLANK');
  const crops = longFieldCrops(source.width, source.height), poolWidth = Math.floor(crops.body.width * 253 / crops.body.height);
  const bodyPool = areaResample(source, crops.body, poolWidth, 253), capPool = areaResample(source, crops.cap, poolWidth, 8);
  const bodyQuilt = quiltMaterialPool(bodyPool), capQuilt = quiltMaterialPool(capPool);
  const body = periodize(bodyQuilt.field, 4, true), cap = periodize(capQuilt.field, 4, false);
  const baselineBody = periodize(areaResample(source, materialCrops(source.width, source.height).body, 253, 253), 4, true);
  const baselineCap = periodize(areaResample(source, revisionCrops(source.width, source.height).cap, 253, 8), 4, false);
  const files = new Map(), artifacts = [];
  const add = (path, image) => {
    const bytes = encodeRgbaPng(image.width, image.height, image.rgba); files.set(path, bytes);
    artifacts.push({ path, sha256: hash(bytes), pixelSha256: hash(image.rgba), byteLength: bytes.length,
      pixelSize: { width: image.width, height: image.height } });
  };
  add('materials/body-pool.png', bodyPool); add('materials/cap-pool.png', capPool);
  add('materials/body-field.png', body); add('materials/cap-field.png', cap);
  add('baseline/body-field.png', baselineBody); add('baseline/cap-field.png', baselineCap);
  const oldImage = renderFlat(baselineBody, baselineCap), newImage = renderFlat(body, cap), overview = raster(2048, 528);
  add('proofs/four-cell-baseline.png', oldImage); add('proofs/sixteen-cell-quilt.png', newImage);
  blit(overview, oldImage, 0, 0); blit(overview, newImage, 0, 272); add('proofs/comparison.png', overview);
  const report = seal({ format: 'ai_scene_terrain_long_field_derivation_v1', compiler: 'scene-kit-quilted-material-field-v1',
    source: { sha256: hash(raw), byteLength: raw.length, pixelSize: { width: source.width, height: source.height } },
    profile: TERRAIN_LONG_FIELD_STUDY, profileSha256: TERRAIN_LONG_FIELD_STUDY_SHA256, crops,
    pool: { width: poolWidth, height: 253, bodyScale: { numerator: 253, denominator: crops.body.height },
      widthRounding: 'floor', capScale: 'same-horizontal-scale-as-body-height-resampled-to-eight' },
    patches: { sourceOriginsX: bodyQuilt.origins, bodySeams: bodyQuilt.seams, capSeams: capQuilt.seams },
    repetition: { baseline: [4, 8, 16].map(lag => fieldLagEvidence(baselineBody, lag)),
      quilt: [4, 8, 16].map(lag => fieldLagEvidence(body, lag)), declaredPeriodCells: { x: 16, y: 4 },
      perceptualRepetition: 'requires-human-review-same-source-features-reused' },
    artifacts, productionKit: false, visualAcceptance: 'not-assessed', metadataTrust: 'not-verified',
    derivedTilePNGCount: 0, generationCalls: 0, independentGeneratedModuleCount: 0,
    studioIntegration: 'not-implemented', boundaryTransitions: 'requires-human-review' });
  files.set('derivation.json', jsonBytes(report)); return { files, report };
}
