import { encodeRgbaPng, inspectPng } from '../png.mjs';
import { check, deepFreeze, digest, hash, jsonBytes, seal } from '../generation/common.mjs';
import { TERRAIN_PROOF as P, TERRAIN_PROOF_SHA256, layoutCells } from './profile.mjs';
import { areaResample, blit, periodize, raster } from './raster.mjs';
import { assessProofLayout, buildProofTiles, materialCrops, renderProofLayout } from './derive.mjs';

export const TERRAIN_PROOF_V2 = deepFreeze({ ...P, format: 'ai_scene_terrain_proof_profile_v2', profile: 'sideview-material-proof-v2',
  sourceProfileSha256: TERRAIN_PROOF_SHA256, crop: 'trim-first-sixteenth-cap-to-eighth-body-four-floor-quadrants-v2',
  variantCount: 4, variantSelection: 'fnv1a-utf16-cell-coordinate-fmix32-v1',
  variantBorders: 'shared-periodic-variant-zero-donor-min-distance-four-pixels-v1',
  revisionScope: 'zero-generation-reprocess-same-material-source',
});
export const TERRAIN_PROOF_V2_SHA256 = digest(TERRAIN_PROOF_V2);

export function materialVariantAt(x, y) {
  check(Number.isSafeInteger(x) && Number.isSafeInteger(y), 'PROOF_CELL');
  let value = 2166136261;
  for (const character of `${x},${y}`) value = Math.imul(value ^ character.charCodeAt(0), 16777619) >>> 0;
  value ^= value >>> 16; value = Math.imul(value, 0x85ebca6b) >>> 0;
  value ^= value >>> 13; value = Math.imul(value, 0xc2b2ae35) >>> 0;
  return ((value ^ (value >>> 16)) >>> 0) % 4;
}

export function revisionCrops(width, height) {
  const original = materialCrops(width, height), trim = Math.floor(height / 16), half = Math.floor(original.body.width / 2);
  return { cap: { ...original.cap, y: trim, height: original.cap.height - trim },
    bodies: [0, 1, 2, 3].map(variant => ({ x: original.body.x + (variant % 2) * half,
      y: original.body.y + Math.floor(variant / 2) * half, width: half, height: half })) };
}

export function shareVariantBorder(source, donor) {
  const size = P.grid.width, band = P.periodicBlendPx;
  check(source.width === size && source.height === size && donor.width === size && donor.height === size, 'PROOF_MATERIAL_SIZE');
  const result = { width: size, height: size, rgba: Buffer.from(source.rgba) };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const distance = Math.min(x, y, size - 1 - x, size - 1 - y);
    if (distance >= band) continue;
    const p = (y * size + x) * 4;
    for (let channel = 0; channel < 3; channel++) result.rgba[p + channel] = Math.floor((source.rgba[p + channel] * distance
      + donor.rgba[p + channel] * (band - distance) + Math.floor(band / 2)) / band);
  }
  return result;
}

export function deriveTerrainProofRevision(raw) {
  check(raw instanceof Uint8Array && raw.length > 0 && raw.length <= 16777216, 'IMAGE_BYTES');
  let source;
  try { source = inspectPng(Buffer.from(raw), { allowCabx: true, pixelStats: true, includePixels: true }); }
  catch { check(false, 'MATERIAL_SOURCE_PNG'); }
  check(!source.transparentPixels && source.varied, 'MATERIAL_SOURCE_OPAQUE_NONBLANK');
  const crops = revisionCrops(source.width, source.height), size = P.grid.width;
  const cap = periodize(areaResample(source, crops.cap, size, P.capHeightPx), P.periodicBlendPx, false);
  const bodies = crops.bodies.map(crop => areaResample(source, crop, size, size));
  const donor = periodize(bodies[0], P.periodicBlendPx, true);
  const materials = bodies.map(body => shareVariantBorder(body, donor)), tiles = materials.map(body => buildProofTiles(body, cap));
  const files = new Map(), artifacts = [], assessments = [], images = [], placements = [];
  const add = (path, image) => {
    const bytes = encodeRgbaPng(image.width, image.height, image.rgba); files.set(path, bytes);
    artifacts.push({ path, sha256: hash(bytes), pixelSha256: hash(image.rgba), byteLength: bytes.length,
      pixelSize: { width: image.width, height: image.height } });
  };
  add('materials/cap.png', cap);
  materials.forEach((body, variant) => {
    add(`materials/body-${variant}.png`, body);
    for (const [mask, tile] of tiles[variant]) add(`tiles/v${variant}-cardinal-${String(mask).padStart(3, '0')}.png`, tile);
  });
  for (const layout of P.layouts) {
    const image = renderProofLayout(layout, (mask, x, y) => tiles[materialVariantAt(x, y)].get(mask));
    const qa = assessProofLayout(layout, image); check(qa.status === 'pass', 'PROOF_GEOMETRY_OR_SEAM');
    assessments.push(qa); images.push(image);
    placements.push({ layoutId: layout.layoutId, cells: layoutCells(layout).map(cell => ({ ...cell, variant: materialVariantAt(cell.x, cell.y) })) });
    add(`proofs/${layout.layoutId}.png`, image);
    const mask = { ...image, rgba: Buffer.from(image.rgba) };
    for (let i = 0; i < mask.rgba.length; i += 4) if (mask.rgba[i + 3]) mask.rgba.fill(255, i, i + 3);
    add(`masks/${layout.layoutId}.png`, mask);
  }
  const overview = raster(512, images.reduce((sum, image) => sum + image.height, 0) + 32); let top = 0;
  for (const image of images) { blit(overview, image, 0, top); top += image.height + 16; }
  add('proofs/overview.png', overview);
  const report = seal({ format: 'ai_scene_terrain_proof_derivation_v2', compiler: 'scene-kit-terrain-proof-v2',
    profileSha256: TERRAIN_PROOF_V2_SHA256, profile: TERRAIN_PROOF_V2, crops, placements,
    source: { sha256: hash(raw), byteLength: raw.length, pixelSize: { width: source.width, height: source.height } },
    artifacts, assessments, cardinalBoundaryRoleCount: 16, materialVariantCount: 4, derivedTilePNGCount: 64,
    independentGeneratedModuleCount: 0, generationCalls: 0, productionKit: false, visualAcceptance: 'not-assessed', metadataTrust: 'not-verified' });
  files.set('derivation.json', jsonBytes(report)); return { files, report };
}
