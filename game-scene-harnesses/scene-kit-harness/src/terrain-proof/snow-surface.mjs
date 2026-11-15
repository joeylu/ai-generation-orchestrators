import { inspectPng, encodeRgbaPng } from '../png.mjs';
import { check, hash, jsonBytes, seal } from '../generation/common.mjs';
import { deriveReferenceField, referencePhaseAt } from './reference-field.mjs';
import { studySurface, STUDY_LAYOUTS, studyInspectionLayout, renderStudyLayout, assessStudyLayout } from './modules.mjs';
import { areaResample, periodize, raster } from './raster.mjs';
import { SIGNATURES } from '../topology.mjs';
import { SNOW_SURFACE_PROFILE, SNOW_SURFACE_SHA256 } from './snow-profile.mjs';
export { SNOW_SURFACE_PROFILE, SNOW_SURFACE_SHA256 } from './snow-profile.mjs';

export function snowSurface(mask, x, y) {
  const previous = studySurface(mask, x, y), inset = y - previous.capY;
  const cap = !(mask & 1) && y >= inset && y < 16;
  const sides = (!(mask & 64) && x < 2 ? 2 : 0) | (!(mask & 4) && x >= 62 ? 4 : 0);
  return { ...previous, cap, shade: sides ? 192 : 255, label: sides | (cap ? 1 : 0) };
}

export function deriveSnowSurface(raw) {
  const base = deriveReferenceField(raw), source = inspectPng(raw, { allowCabx: true, includePixels: true });
  const crop = { x: base.report.crops.cap.x, y: 0, width: base.report.crops.cap.width, height: Math.floor(source.height / 8) };
  const cap = periodize(areaResample(source, crop, 505, 16), 4, false);
  const body = inspectPng(base.files.get('materials/body-field.png'), { includePixels: true });
  const sets = Array.from({ length: 32 }, (_, phase) => {
    const bx = phase % 8 * 63, by = Math.floor(phase / 8) * 63;
    return new Map(SIGNATURES.map(mask => {
      const image = raster(64, 64);
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        const surface = snowSurface(mask, x, y), p = (y * 64 + x) * 4;
        if (!surface.alpha) continue;
        const input = surface.cap ? cap : body;
        const offset = (((surface.cap ? surface.capY : by + y) * 505) + bx + x) * 4;
        for (let c = 0; c < 3; c++) image.rgba[p + c] = Math.floor((input.rgba[offset + c] * surface.shade + 127) / 255);
        image.rgba[p + 3] = surface.alpha;
      }
      return [mask, image];
    }));
  });
  const files = new Map(), artifacts = [], assessments = [];
  const add = (path, image) => {
    const bytes = encodeRgbaPng(image.width, image.height, image.rgba); files.set(path, bytes);
    artifacts.push({ path, sha256: hash(bytes), byteLength: bytes.length, pixelSize: { width: image.width, height: image.height } });
  };
  files.set('materials/body-field.png', base.files.get('materials/body-field.png')); add('materials/cap-field.png', cap);
  sets.forEach((tiles, phase) => { for (const [signature, image] of tiles) add(`tiles/r${phase}-blob-${String(signature).padStart(3, '0')}.png`, image); });
  for (const layout of [...STUDY_LAYOUTS, studyInspectionLayout()]) {
    const image = renderStudyLayout(layout, sets, referencePhaseAt);
    const qa = assessStudyLayout(layout, image, snowSurface);
    check(qa.status === 'pass', 'SNOW_GEOMETRY_OR_SEAM', JSON.stringify({ layout: layout.layoutId, geometryFailures: qa.geometryFailures, failures: qa.interfaces.filter(item => item.status !== 'pass').slice(0, 3) }));
    assessments.push(qa); add(`proofs/${layout.layoutId}.png`, image);
  }
  const report = seal({ format: 'ai_scene_snow_surface_derivation_v1', profile: SNOW_SURFACE_PROFILE,
    profileSha256: SNOW_SURFACE_SHA256, sourceSha256: hash(raw), parentDerivationSha256: base.report.sha256,
    capCrop: crop, bodySha256: hash(base.files.get('materials/body-field.png')), artifacts, assessments,
    generationCalls: 0, geometryAcceptance: 'not-assessed', visualAcceptance: 'not-assessed', productionKit: false });
  files.set('derivation.json', jsonBytes(report)); return { files, report };
}
