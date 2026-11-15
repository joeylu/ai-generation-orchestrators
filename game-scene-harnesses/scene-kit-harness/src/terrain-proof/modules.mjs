import { encodeRgbaPng, inspectPng } from '../png.mjs';
import { NEIGHBORS, PROFILE, SIGNATURES, cellKey, normalizeSignature, signatureAt } from '../topology.mjs';
import { check, deepFreeze, digest, hash, jsonBytes, seal } from '../generation/common.mjs';
import { TERRAIN_PROOF as P, layoutCells } from './profile.mjs';
import { TERRAIN_PROOF_V2_SHA256, revisionCrops } from './revision.mjs';
import { areaResample, blit, periodize, raster, validateRaster } from './raster.mjs';

const N = 64, corners = [[1, 64, 128, false, false], [1, 4, 2, true, false],
  [16, 4, 8, true, true], [16, 64, 32, false, true]];
export const STUDY_LAYOUTS = deepFreeze(fixedStudyLayouts());
export const TERRAIN_MODULE_STUDY = deepFreeze({
  format: 'ai_scene_terrain_module_study_profile_v1', profile: 'sideview-derived-blob47-study-v1',
  parentProfileSha256: TERRAIN_PROOF_V2_SHA256, scope: 'derived-terrain-study-not-production-kit',
  grid: { width: N, height: N }, pixelsPerUnit: P.pixelsPerUnit, anchorPx: { x: 0, y: 0 },
  topologyProfile: PROFILE, signatures: SIGNATURES, materialVariantCount: 9,
  crops: 'v2-trim-cap-half-width-and-body-half-square-three-by-three-floor-lattice-v1',
  resample: P.resample, commonBorders: 'nine-sample-mean-periodic-two-pixel-collar-v1',
  variantSelection: 'fnv1a-utf16-coordinate-fmix32-mod-nine-v1',
  topInset: [0, 0, 1, 1, 2, 1, 1, 0, 0, 1, 2, 2, 1, 0, 1, 0],
  sideInset: [0, 0, 1, 1, 1, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0],
  insetStepPx: 4, capHeightPx: 8, outerCornerRadiusPx: 4, innerCornerShadeRadiusPx: 8,
  alpha: 'four-by-four-area-samples-round-half-up-zero-rgb-when-zero-v1',
  geometry: 'visual-inset-within-logical-solid-cell-no-overhang-collision-unchanged',
  layouts: STUDY_LAYOUTS, inspection: { columns: 28, rows: 28, caseStrideCells: 4, centerOffsetCells: 1, columnsOfCases: 7 },
  seam: P.seam, generationCalls: 0, independentGeneratedModuleCount: 0, productionKit: false,
});
export const TERRAIN_MODULE_STUDY_SHA256 = digest(TERRAIN_MODULE_STUDY);

export function studyVariantAt(x, y) {
  check(Number.isSafeInteger(x) && Number.isSafeInteger(y), 'PROOF_CELL');
  let value = 2166136261;
  for (const c of `${x},${y}`) value = Math.imul(value ^ c.charCodeAt(0), 16777619) >>> 0;
  value ^= value >>> 16; value = Math.imul(value, 0x85ebca6b) >>> 0;
  value ^= value >>> 13; value = Math.imul(value, 0xc2b2ae35) >>> 0;
  return ((value ^ (value >>> 16)) >>> 0) % 9;
}

export function studyCrops(width, height) {
  const original = revisionCrops(width, height), first = original.bodies[0], side = first.width;
  const step = Math.floor(side / 2), capWidth = Math.floor(original.cap.width / 2);
  return { bodies: Array.from({ length: 9 }, (_, v) => ({ x: first.x + (v % 3) * step,
    y: first.y + Math.floor(v / 3) * step, width: side, height: side })),
  caps: Array.from({ length: 9 }, (_, v) => ({ x: original.cap.x + Math.floor((original.cap.width - capWidth) * v / 8),
    y: original.cap.y, width: capWidth, height: original.cap.height })) };
}

function sharedMaterials(samples, vertical) {
  const mean = raster(samples[0].width, samples[0].height);
  for (let p = 0; p < mean.rgba.length; p += 4) {
    for (let c = 0; c < 3; c++) mean.rgba[p + c] = Math.floor((samples.reduce((s, item) => s + item.rgba[p + c], 0) + 4) / 9);
    mean.rgba[p + 3] = 255;
  }
  const donor = periodize(mean, 2, vertical);
  return samples.map(source => {
    const result = { ...source, rgba: Buffer.from(source.rgba) };
    for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
      const distance = Math.min(x, source.width - 1 - x, vertical ? Math.min(y, source.height - 1 - y) : Infinity);
      if (distance >= 2) continue;
      const p = (y * source.width + x) * 4;
      for (let c = 0; c < 3; c++) result.rgba[p + c] = Math.floor((source.rgba[p + c] * distance + donor.rgba[p + c] * (2 - distance) + 1) / 2);
    }
    return result;
  });
}

// This is a declared visual inset, not segmentation of the accepted material.
// Logical occupancy and collision never read these alpha values.
const surfaceCache = new Map();
export function studySurface(mask, x, y) {
  check(Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < N && y >= 0 && y < N
    && normalizeSignature(mask) === mask, 'PROOF_SURFACE');
  if (!surfaceCache.has(mask)) surfaceCache.set(mask, Array.from({ length: N * N }, (_, p) =>
    Object.freeze(calculateSurface(mask, p % N, Math.floor(p / N)))));
  return surfaceCache.get(mask)[y * N + x];
}
function calculateSurface(mask, x, y) {
  const top = !(mask & 1), right = !(mask & 4), bottom = !(mask & 16), left = !(mask & 64);
  const ix = Math.floor(x / 4), iy = Math.floor(y / 4), inset = TERRAIN_MODULE_STUDY.topInset[ix];
  const side = TERRAIN_MODULE_STUDY.sideInset[iy];
  let count = 0;
  for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
    const px = x + (sx + 0.5) / 4, py = y + (sy + 0.5) / 4;
    let inside = !(top && py < inset) && !(left && px < side) && !(right && px > N - side) && !(bottom && py > N - inset);
    for (const [a, b, , flipX, flipY] of corners) {
      if ((mask & a) || (mask & b)) continue;
      const dx = flipX ? N - px : px, dy = flipY ? N - py : py;
      if (dx < 4 && dy < 4 && (dx - 4) ** 2 + (dy - 4) ** 2 > 16) inside = false;
    }
    if (inside) count++;
  }
  const cap = top && y >= inset && y < 8;
  let shade = (left && x < 2) || (right && x >= N - 2) || (bottom && y >= N - 2) ? 192 : 255;
  let label = (cap ? 1 : 0) | (left && x < 2 ? 2 : 0) | (right && x >= 62 ? 4 : 0) | (bottom && y >= 62 ? 8 : 0);
  corners.forEach(([a, b, diagonal, flipX, flipY], index) => {
    if (!(mask & a) || !(mask & b) || (mask & diagonal)) return;
    const dx = flipX ? N - x - 0.5 : x + 0.5, dy = flipY ? N - y - 0.5 : y + 0.5;
    const squared = dx * dx + dy * dy;
    if (squared < 64) { shade = Math.min(shade, 255 - Math.floor((64 - squared) * 56 / 64)); label |= 16 << index; }
  });
  return { alpha: Math.floor((count * 255 + 8) / 16), cap, capY: Math.max(0, y - inset), shade, label };
}

export function buildStudyTiles(body, cap) {
  validateRaster(body); validateRaster(cap);
  check(body.width === N && body.height === N && cap.width === N && cap.height === 8, 'PROOF_MATERIAL_SIZE');
  const tiles = new Map();
  for (const mask of SIGNATURES) {
    const tile = raster(N, N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const surface = studySurface(mask, x, y), p = (y * N + x) * 4;
      if (!surface.alpha) continue;
      const source = surface.cap ? cap : body, q = ((surface.cap ? surface.capY : y) * N + x) * 4;
      for (let c = 0; c < 3; c++) tile.rgba[p + c] = Math.floor((source.rgba[q + c] * surface.shade + 127) / 255);
      tile.rgba[p + 3] = surface.alpha;
    }
    tiles.set(mask, tile);
  }
  return tiles;
}

function fixedStudyLayouts() {
const rowsLayout = (layoutId, rows) => ({ layoutId, columns: rows[0].length, rows: rows.length,
  cells: rows.flatMap((row, y) => [...row].flatMap((character, x) => character === '#' ? [{ x, y }] : [])) });
return [...P.layouts.map(layout => ({ ...layout, cells: layoutCells(layout) })),
  { layoutId: 'long-map', columns: 32, rows: 6, cells: layoutCells({ rows: 6,
    columnHeights: [2, 2, 2, 2, 3, 3, 3, 2, 2, 0, 0, 2, 2, 3, 4, 4, 4, 3, 2, 2, 2, 0, 2, 2, 3, 3, 3, 2, 2, 2, 2, 2] }) },
  rowsLayout('corners-and-hole', ['............', '..######....', '..#....#....', '###....###..', '###....###..', '##########..', '##########..', '##########..']),
  rowsLayout('floating', ['............', '...####.....', '...####.....', '............', '.###....###.', '.###....###.'])];
}
const cellsFor = layout => new Map(layout.cells.map(({ x, y }) => [cellKey(x, y), 'primary']));
export function renderStudyLayout(layout, tiles, variantAt = studyVariantAt) {
  const image = raster(layout.columns * N, layout.rows * N), cells = cellsFor(layout);
  for (const { x, y } of layout.cells) blit(image, tiles[variantAt(x, y)].get(signatureAt(cells, x, y)), x * N, y * N);
  return image;
}

export function assessStudyLayout(layout, image, surfaceFor = studySurface) {
  validateRaster(image);
  check(image.width === layout.columns * N && image.height === layout.rows * N, 'PROOF_LAYOUT_SIZE');
  const cells = cellsFor(layout), interfaces = []; let geometryFailures = 0;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const cx = Math.floor(x / N), cy = Math.floor(y / N), signature = signatureAt(cells, cx, cy);
    const expected = signature === null ? 0 : surfaceFor(signature, x % N, y % N).alpha, p = (y * image.width + x) * 4;
    if (image.rgba[p + 3] !== expected || (!expected && (image.rgba[p] || image.rgba[p + 1] || image.rgba[p + 2]))) geometryFailures++;
  }
  for (const { x, y } of layout.cells) for (const [dx, dy, axis] of [[1, 0, 'x'], [0, 1, 'y']]) {
    const a = signatureAt(cells, x, y), b = signatureAt(cells, x + dx, y + dy);
    if (b === null) continue;
    let comparedPixels = 0, maximumChannelDifference = 0; const transitionOffsets = [];
    for (let t = 0; t < N; t++) {
      const ax = axis === 'x' ? 63 : t, ay = axis === 'x' ? t : 63, bx = axis === 'x' ? 0 : t, by = axis === 'x' ? t : 0;
      const sa = surfaceFor(a, ax, ay), sb = surfaceFor(b, bx, by);
      if (sa.label !== sb.label || sa.alpha !== sb.alpha || sa.shade !== sb.shade) { transitionOffsets.push(t); continue; }
      comparedPixels++;
      const pa = ((y * N + ay) * image.width + x * N + ax) * 4, pb = (((y + dy) * N + by) * image.width + (x + dx) * N + bx) * 4;
      for (let c = 0; c < 4; c++) maximumChannelDifference = Math.max(maximumChannelDifference, Math.abs(image.rgba[pa + c] - image.rgba[pb + c]));
    }
    interfaces.push({ cell: { x, y }, axis, comparedPixels, maximumChannelDifference, transitionOffsets,
      status: comparedPixels >= 48 && maximumChannelDifference === 0 ? 'pass' : 'fail' });
  }
  return { layoutId: layout.layoutId, occupiedCells: cells.size, geometryFailures, interfaces,
    status: !geometryFailures && interfaces.every(item => item.status === 'pass') ? 'pass' : 'fail',
    boundaryTransitions: 'requires-human-review', visualAcceptance: 'not-assessed' };
}

export function studyInspectionLayout() {
  const centers = [], cells = [];
  SIGNATURES.forEach((signature, index) => {
    const cx = (index % 7) * 4 + 1, cy = Math.floor(index / 7) * 4 + 1;
    centers.push({ x: cx, y: cy, signature }); cells.push({ x: cx, y: cy });
    for (const [dx, dy, bit] of NEIGHBORS) if (signature & bit) cells.push({ x: cx + dx, y: cy + dy });
  });
  const layout = { layoutId: 'all-47-neighborhoods', columns: 28, rows: 28, cells, centers };
  const map = cellsFor(layout);
  check(centers.every(({ x, y, signature }) => signatureAt(map, x, y) === signature), 'PROOF_TOPOLOGY_COVERAGE');
  return layout;
}

export function deriveTerrainModuleStudy(raw) {
  check(raw instanceof Uint8Array && raw.length > 0 && raw.length <= 16777216, 'IMAGE_BYTES');
  let source;
  try { source = inspectPng(Buffer.from(raw), { allowCabx: true, pixelStats: true, includePixels: true }); }
  catch { check(false, 'MATERIAL_SOURCE_PNG'); }
  check(!source.transparentPixels && source.varied, 'MATERIAL_SOURCE_OPAQUE_NONBLANK');
  const crops = studyCrops(source.width, source.height);
  const bodies = sharedMaterials(crops.bodies.map(crop => areaResample(source, crop, N, N)), true);
  const caps = sharedMaterials(crops.caps.map(crop => areaResample(source, crop, N, 8)), false);
  const tiles = bodies.map((body, index) => buildStudyTiles(body, caps[index]));
  const files = new Map(), artifacts = [], assessments = [], placements = [], images = [];
  const add = (path, image) => {
    const bytes = encodeRgbaPng(image.width, image.height, image.rgba); files.set(path, bytes);
    artifacts.push({ path, sha256: hash(bytes), pixelSha256: hash(image.rgba), byteLength: bytes.length,
      pixelSize: { width: image.width, height: image.height } });
  };
  bodies.forEach((body, v) => { add(`materials/body-${v}.png`, body); add(`materials/cap-${v}.png`, caps[v]);
    for (const [signature, tile] of tiles[v]) add(`tiles/v${v}-blob-${String(signature).padStart(3, '0')}.png`, tile); });
  const inspection = studyInspectionLayout(), layouts = [...STUDY_LAYOUTS, inspection];
  for (const layout of layouts) {
    const image = renderStudyLayout(layout, tiles), qa = assessStudyLayout(layout, image);
    check(qa.status === 'pass', 'PROOF_GEOMETRY_OR_SEAM'); assessments.push(qa); images.push(image);
    placements.push({ ...layout, cells: layout.cells.map(cell => ({ ...cell,
      signature: signatureAt(cellsFor(layout), cell.x, cell.y), variant: studyVariantAt(cell.x, cell.y) })) });
    add(`proofs/${layout.layoutId}.png`, image);
  }
  const overview = raster(512, 928); let offset = 0;
  for (const image of images.slice(0, 3)) { blit(overview, image, 0, offset); offset += image.height + 16; }
  add('proofs/overview.png', overview);
  const topology = seal({ format: 'ai_scene_derived_terrain_study_index_v1', topologyProfile: PROFILE,
    sourceSha256: hash(raw), profileSha256: TERRAIN_MODULE_STUDY_SHA256,
    entries: SIGNATURES.map(signature => ({ signature, footprint: { columns: 1, rows: 1 }, anchorPx: { x: 0, y: 0 },
      files: tiles.map((_, v) => `tiles/v${v}-blob-${String(signature).padStart(3, '0')}.png`) })),
    independentGeneratedModuleCount: 0, productionKit: false, visualAcceptance: 'not-assessed' });
  files.set('topology.json', jsonBytes(topology));
  const report = seal({ format: 'ai_scene_terrain_module_study_derivation_v1', compiler: 'scene-kit-derived-blob47-study-v1',
    source: { sha256: hash(raw), byteLength: raw.length, pixelSize: { width: source.width, height: source.height } },
    profile: TERRAIN_MODULE_STUDY, profileSha256: TERRAIN_MODULE_STUDY_SHA256, crops, artifacts, assessments, placements,
    topologySha256: topology.sha256, topologyRoleCount: SIGNATURES.length, materialVariantCount: 9,
    distinctBodySamples: new Set(bodies.map(body => hash(body.rgba))).size, distinctCapSamples: new Set(caps.map(cap => hash(cap.rgba))).size,
    derivedTilePNGCount: 423,
    inspectionCoverage: inspection.centers.map(item => item.signature), generationCalls: 0, independentGeneratedModuleCount: 0,
    productionKit: false, visualAcceptance: 'not-assessed', metadataTrust: 'not-verified' });
  files.set('derivation.json', jsonBytes(report)); return { files, report };
}
