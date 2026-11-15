import { inspectPng, encodeRgbaPng } from '../png.mjs';
import { SIGNATURES } from '../topology.mjs';
import { check, deepFreeze, digest, hash, jsonBytes, seal } from '../generation/common.mjs';
import { materialCrops } from './derive.mjs';
import { revisionCrops } from './revision.mjs';
import { buildStudyTiles, STUDY_LAYOUTS, studyInspectionLayout, renderStudyLayout, assessStudyLayout } from './modules.mjs';
import { areaResample, periodize, raster } from './raster.mjs';

export const REFERENCE_FIELD_PROFILE = deepFreeze({ format: 'ai_scene_reference_field_profile_v1',
  profile: 'sideview-macro-rock-eight-by-four-v1', source: 'accepted-opaque-material-only',
  crop: 'center-body-two-thirds-height-two-to-one-aspect-cap-same-x-v1',
  field: { width: 505, height: 253, capHeight: 8, blend: 4 },
  phases: { columns: 8, rows: 4, stride: 63, window: 64 },
  logicalPeriod: { width: 512, height: 256 }, resample: 'integer-area-box-round-half-up-v1',
  generationCalls: 0, productionKit: false, visualAcceptance: 'not-assessed' });
export const REFERENCE_FIELD_SHA256 = digest(REFERENCE_FIELD_PROFILE);
export const referencePhaseAt = (x, y) => ((y % 4 + 4) % 4) * 8 + ((x % 8 + 8) % 8);

export function deriveReferenceField(raw) {
  const source = inspectPng(raw, { allowCabx: true, pixelStats: true, includePixels: true });
  check(source.varied && !source.transparentPixels, 'MATERIAL_SOURCE_OPAQUE_NONBLANK');
  const old = materialCrops(source.width, source.height), trimmed = revisionCrops(source.width, source.height).cap;
  const h = Math.min(Math.floor(old.body.height * 2 / 3), Math.floor(source.width / 2)), w = h * 2, x = Math.floor((source.width - w) / 2);
  const crops = { body: { x, y: old.body.y + Math.floor((old.body.height - h) / 2), width: w, height: h },
    cap: { x, y: trimmed.y, width: w, height: trimmed.height } };
  const body = periodize(areaResample(source, crops.body, 505, 253), 4, true);
  const cap = periodize(areaResample(source, crops.cap, 505, 8), 4, false);
  const tiles = Array.from({ length: 32 }, (_, phase) => {
    const bx = phase % 8 * 63, by = Math.floor(phase / 8) * 63, b = raster(64, 64), c = raster(64, 8);
    for (const [target, input, sy] of [[b, body, by], [c, cap, 0]]) for (let y = 0; y < target.height; y++)
      target.rgba.set(input.rgba.subarray(((sy + y) * input.width + bx) * 4, ((sy + y) * input.width + bx + 64) * 4), y * 64 * 4);
    return buildStudyTiles(b, c);
  });
  const files = new Map(), artifacts = [], assessments = [];
  const add = (path, image) => { const bytes = encodeRgbaPng(image.width, image.height, image.rgba); files.set(path, bytes);
    artifacts.push({ path, sha256: hash(bytes), byteLength: bytes.length, pixelSize: { width: image.width, height: image.height } }); };
  add('materials/body-field.png', body); add('materials/cap-field.png', cap);
  tiles.forEach((set, phase) => { for (const [signature, image] of set) add(`tiles/r${phase}-blob-${String(signature).padStart(3, '0')}.png`, image); });
  for (const layout of [...STUDY_LAYOUTS, studyInspectionLayout()]) {
    const image = renderStudyLayout(layout, tiles, referencePhaseAt), qa = assessStudyLayout(layout, image);
    check(qa.status === 'pass', 'PROOF_GEOMETRY_OR_SEAM'); assessments.push(qa); add(`proofs/${layout.layoutId}.png`, image);
  }
  const report = seal({ format: 'ai_scene_reference_field_derivation_v1', profile: REFERENCE_FIELD_PROFILE,
    profileSha256: REFERENCE_FIELD_SHA256, source: { sha256: hash(raw), byteLength: raw.length,
      pixelSize: { width: source.width, height: source.height } }, crops, artifacts, assessments,
    topologyRoles: SIGNATURES.length, phaseCount: 32, productionKit: false, visualAcceptance: 'not-assessed', generationCalls: 0 });
  files.set('derivation.json', jsonBytes(report)); return { files, report };
}
