import { encodeRgbaPng, inspectPng } from '../png.mjs';
import { PROFILE, SIGNATURES, cellKey, signatureAt } from '../topology.mjs';
import { check, deepFreeze, digest, hash, jsonBytes, seal } from '../generation/common.mjs';
import { materialCrops } from './derive.mjs';
import { revisionCrops } from './revision.mjs';
import { TERRAIN_MODULE_STUDY, STUDY_LAYOUTS, assessStudyLayout, buildStudyTiles, renderStudyLayout, studyInspectionLayout } from './modules.mjs';
import { areaResample, blit, periodize, raster, validateRaster } from './raster.mjs';

export const TERRAIN_CONTINUITY_STUDY = deepFreeze({
  format: 'ai_scene_terrain_continuity_study_profile_v1', profile: 'sideview-continuous-material-blob47-study-v1',
  geometryProfile: TERRAIN_MODULE_STUDY, scope: 'derived-terrain-study-not-production-kit',
  crops: 'v1-body-square-v2-trimmed-cap-v1', resample: 'integer-area-box-round-half-up-v1',
  textureField: { width: 253, height: 253, capHeight: 8, periodicBlendPx: 4 },
  phases: { columns: 4, rows: 4, stridePx: 63, windowPx: 64, sharedSamplePixels: 1 },
  selection: 'positive-modulo-world-cell-coordinate-by-four-v1', transforms: ['identity'],
  phaseInterchangeable: false, generationCalls: 0, independentGeneratedModuleCount: 0, productionKit: false,
});
export const TERRAIN_CONTINUITY_STUDY_SHA256 = digest(TERRAIN_CONTINUITY_STUDY);
export function continuityPhaseAt(x, y) {
  check(Number.isSafeInteger(x) && Number.isSafeInteger(y), 'PROOF_CELL');
  return ((y % 4 + 4) % 4) * 4 + ((x % 4 + 4) % 4);
}
export function extractContinuityPhase(body, cap, phase) {
  validateRaster(body); validateRaster(cap);
  check(body.width === 253 && body.height === 253 && cap.width === 253 && cap.height === 8
    && Number.isInteger(phase) && phase >= 0 && phase < 16, 'PROOF_MATERIAL_SIZE');
  const x = (phase % 4) * 63, y = Math.floor(phase / 4) * 63, tileBody = raster(64, 64), tileCap = raster(64, 8);
  for (const [target, source, offsetY] of [[tileBody, body, y], [tileCap, cap, 0]]) {
    for (let row = 0; row < target.height; row++) target.rgba.set(source.rgba.subarray(((offsetY + row) * source.width + x) * 4,
      ((offsetY + row) * source.width + x + 64) * 4), row * 64 * 4);
  }
  return { body: tileBody, cap: tileCap };
}
export function deriveTerrainContinuityStudy(raw) {
  check(raw instanceof Uint8Array && raw.length > 0 && raw.length <= 16777216, 'IMAGE_BYTES');
  let source;
  try { source = inspectPng(Buffer.from(raw), { allowCabx: true, pixelStats: true, includePixels: true }); }
  catch { check(false, 'MATERIAL_SOURCE_PNG'); }
  check(!source.transparentPixels && source.varied, 'MATERIAL_SOURCE_OPAQUE_NONBLANK');
  const crops = { body: materialCrops(source.width, source.height).body, cap: revisionCrops(source.width, source.height).cap };
  const body = periodize(areaResample(source, crops.body, 253, 253), 4, true);
  const cap = periodize(areaResample(source, crops.cap, 253, 8), 4, false);
  const materials = Array.from({ length: 16 }, (_, phase) => extractContinuityPhase(body, cap, phase));
  const tiles = materials.map(item => buildStudyTiles(item.body, item.cap));
  const files = new Map(), artifacts = [], assessments = [], placements = [], images = [];
  const add = (path, image) => {
    const bytes = encodeRgbaPng(image.width, image.height, image.rgba); files.set(path, bytes);
    artifacts.push({ path, sha256: hash(bytes), pixelSha256: hash(image.rgba), byteLength: bytes.length,
      pixelSize: { width: image.width, height: image.height } });
  };
  add('materials/body-field.png', body); add('materials/cap-field.png', cap);
  tiles.forEach((set, phase) => { for (const [signature, tile] of set) add(`tiles/p${phase}-blob-${String(signature).padStart(3, '0')}.png`, tile); });
  const inspection = studyInspectionLayout();
  for (const layout of [...STUDY_LAYOUTS, inspection]) {
    const image = renderStudyLayout(layout, tiles, continuityPhaseAt), qa = assessStudyLayout(layout, image);
    check(qa.status === 'pass', 'PROOF_GEOMETRY_OR_SEAM'); assessments.push(qa); images.push(image);
    const cells = new Map(layout.cells.map(cell => [cellKey(cell.x, cell.y), 'primary']));
    placements.push({ ...layout, cells: layout.cells.map(cell => ({ ...cell,
      signature: signatureAt(cells, cell.x, cell.y), phase: continuityPhaseAt(cell.x, cell.y) })) });
    add(`proofs/${layout.layoutId}.png`, image);
  }
  const overview = raster(512, 928); let offset = 0;
  for (const image of images.slice(0, 3)) { blit(overview, image, 0, offset); offset += image.height + 16; }
  add('proofs/overview.png', overview);
  const topology = seal({ format: 'ai_scene_continuous_terrain_study_index_v1', topologyProfile: PROFILE,
    sourceSha256: hash(raw), profileSha256: TERRAIN_CONTINUITY_STUDY_SHA256,
    phaseRule: TERRAIN_CONTINUITY_STUDY.phases, selection: TERRAIN_CONTINUITY_STUDY.selection, phaseInterchangeable: false,
    entries: SIGNATURES.map(signature => ({ signature, footprint: { columns: 1, rows: 1 }, anchorPx: { x: 0, y: 0 },
      files: tiles.map((_, phase) => `tiles/p${phase}-blob-${String(signature).padStart(3, '0')}.png`) })),
    productionKit: false, visualAcceptance: 'not-assessed' });
  files.set('topology.json', jsonBytes(topology));
  const report = seal({ format: 'ai_scene_terrain_continuity_study_derivation_v1', compiler: 'scene-kit-continuous-material-study-v1',
    source: { sha256: hash(raw), byteLength: raw.length, pixelSize: { width: source.width, height: source.height } },
    profile: TERRAIN_CONTINUITY_STUDY, profileSha256: TERRAIN_CONTINUITY_STUDY_SHA256, crops, artifacts, assessments, placements,
    topologySha256: topology.sha256, topologyRoleCount: 47, texturePhaseCount: 16, derivedTilePNGCount: 752,
    inspectionCoverage: inspection.centers.map(item => item.signature), generationCalls: 0, independentGeneratedModuleCount: 0,
    productionKit: false, visualAcceptance: 'not-assessed', metadataTrust: 'not-verified' });
  files.set('derivation.json', jsonBytes(report)); return { files, report };
}
