import { encodeRgbaPng, inspectPng } from '../png.mjs';
import { check, digest, hash, jsonBytes, seal } from '../generation/common.mjs';
import { TERRAIN_PROOF as P, TERRAIN_PROOF_SHA256, layoutCells } from './profile.mjs';
import { areaResample, blit, periodize, raster, validateRaster } from './raster.mjs';

const N = P.grid.width, key = (x, y) => `${x},${y}`;
const contains = (cells, x, y) => cells.has(key(x, y));
const maskAt = (cells, x, y) => [[0, -1, 1], [1, 0, 4], [0, 1, 16], [-1, 0, 64]]
  .reduce((mask, [dx, dy, bit]) => mask | (contains(cells, x + dx, y + dy) ? bit : 0), 0);
const occupied = layout => new Set(layoutCells(layout).map(({ x, y }) => key(x, y)));

export function decorationAt(mask, x, y) {
  return ((!(mask & 1) && y < P.capHeightPx) ? 1 : 0)
    | ((!(mask & 64) && x < P.boundaryShadePx) ? 2 : 0)
    | ((!(mask & 4) && x >= N - P.boundaryShadePx) ? 4 : 0)
    | ((!(mask & 16) && y >= N - P.boundaryShadePx) ? 8 : 0);
}

export function materialCrops(width, height) {
  check(Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > height && height >= P.source.minimumShortEdge
    && width <= P.source.maximumWidth && height <= P.source.maximumHeight, 'MATERIAL_SOURCE_SIZE');
  const side = height, x = Math.floor((width - side) / 2), capHeight = Math.floor(side / 8), bodySide = side - capHeight;
  return { cap: { x, y: 0, width: side, height: capHeight },
    body: { x: x + Math.floor((side - bodySide) / 2), y: capHeight, width: bodySide, height: bodySide } };
}

export function buildProofTiles(body, cap) {
  validateRaster(body); validateRaster(cap);
  check(body.width === N && body.height === N && cap.width === N && cap.height === P.capHeightPx, 'PROOF_MATERIAL_SIZE');
  const tiles = new Map();
  for (let bits = 0; bits < 16; bits++) {
    const mask = [1, 4, 16, 64].reduce((value, bit, index) => value | ((bits & (1 << index)) ? bit : 0), 0);
    const tile = raster(N, N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const flags = decorationAt(mask, x, y), pixel = (y * N + x) * 4;
      const source = flags & 1 ? cap : body;
      for (let channel = 0; channel < 3; channel++) {
        let value = source.rgba[(y * N + x) * 4 + channel];
        if (flags & 14) value = Math.floor((value * P.boundaryShade.numerator + Math.floor(P.boundaryShade.denominator / 2)) / P.boundaryShade.denominator);
        tile.rgba[pixel + channel] = value;
      }
      tile.rgba[pixel + 3] = 255;
    }
    tiles.set(mask, tile);
  }
  return tiles;
}

export function renderProofLayout(layout, tiles) {
  const image = raster(layout.columns * N, layout.rows * N), cells = occupied(layout);
  for (const { x, y } of layoutCells(layout)) {
    const mask = maskAt(cells, x, y);
    blit(image, typeof tiles === 'function' ? tiles(mask, x, y) : tiles.get(mask), x * N, y * N);
  }
  return image;
}

export function assessProofLayout(layout, image) {
  validateRaster(image);
  check(image.width === layout.columns * N && image.height === layout.rows * N, 'PROOF_LAYOUT_SIZE');
  const cells = occupied(layout), interfaces = [];
  let geometryFailures = 0;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const p = (y * image.width + x) * 4, expected = contains(cells, Math.floor(x / N), Math.floor(y / N)) ? 255 : 0;
    if (image.rgba[p + 3] !== expected || (!expected && (image.rgba[p] || image.rgba[p + 1] || image.rgba[p + 2]))) geometryFailures++;
  }
  for (const { x, y } of layoutCells(layout)) for (const [dx, dy, axis] of [[1, 0, 'x'], [0, 1, 'y']]) {
    if (!contains(cells, x + dx, y + dy)) continue;
    const aMask = maskAt(cells, x, y), bMask = maskAt(cells, x + dx, y + dy);
    let comparedPixels = 0, transitionPixels = 0, maximumChannelDifference = 0;
    const transitionOffsets = [];
    for (let t = 0; t < N; t++) {
      const ax = axis === 'x' ? N - 1 : t, ay = axis === 'x' ? t : N - 1;
      const bx = axis === 'x' ? 0 : t, by = axis === 'x' ? t : 0;
      if (decorationAt(aMask, ax, ay) !== decorationAt(bMask, bx, by)) { transitionPixels++; transitionOffsets.push(t); continue; }
      comparedPixels++;
      const pa = ((y * N + ay) * image.width + x * N + ax) * 4;
      const pb = (((y + dy) * N + by) * image.width + (x + dx) * N + bx) * 4;
      for (let channel = 0; channel < 4; channel++) maximumChannelDifference = Math.max(maximumChannelDifference, Math.abs(image.rgba[pa + channel] - image.rgba[pb + channel]));
    }
    const coverage = comparedPixels * P.seam.minimumComparedFraction.denominator >= N * P.seam.minimumComparedFraction.numerator;
    interfaces.push({ cell: { x, y }, axis, comparedPixels, transitionPixels, transitionOffsets,
      maximumChannelDifference, status: coverage && maximumChannelDifference <= P.seam.channelDifferenceLimit ? 'pass' : 'fail' });
  }
  return { layoutId: layout.layoutId, occupiedCells: cells.size, geometryFailures, interfaces,
    status: !geometryFailures && interfaces.every(item => item.status === 'pass') ? 'pass' : 'fail',
    boundaryTransitions: 'requires-human-review', visualAcceptance: 'not-assessed' };
}

export function deriveTerrainProof(raw) {
  check(raw instanceof Uint8Array && raw.length > 0 && raw.length <= 16777216, 'IMAGE_BYTES');
  let source;
  try { source = inspectPng(Buffer.from(raw), { allowCabx: true, pixelStats: true, includePixels: true }); }
  catch { check(false, 'MATERIAL_SOURCE_PNG'); }
  check(!source.transparentPixels && source.varied, 'MATERIAL_SOURCE_OPAQUE_NONBLANK');
  const crops = materialCrops(source.width, source.height);
  const cap = periodize(areaResample(source, crops.cap, N, P.capHeightPx), P.periodicBlendPx, false);
  const body = periodize(areaResample(source, crops.body, N, N), P.periodicBlendPx, true);
  const files = new Map(), artifacts = [], assessments = [], proofImages = [];
  const add = (path, image) => {
    const bytes = encodeRgbaPng(image.width, image.height, image.rgba); files.set(path, bytes);
    artifacts.push({ path, sha256: hash(bytes), pixelSha256: hash(image.rgba), byteLength: bytes.length,
      pixelSize: { width: image.width, height: image.height } });
  };
  add('materials/body.png', body); add('materials/cap.png', cap);
  const tiles = buildProofTiles(body, cap);
  for (const [mask, tile] of tiles) add(`tiles/cardinal-${String(mask).padStart(3, '0')}.png`, tile);
  for (const layout of P.layouts) {
    const image = renderProofLayout(layout, tiles), qa = assessProofLayout(layout, image);
    check(qa.status === 'pass', 'PROOF_GEOMETRY_OR_SEAM'); assessments.push(qa); proofImages.push(image);
    add(`proofs/${layout.layoutId}.png`, image);
    const mask = { ...image, rgba: Buffer.from(image.rgba) };
    for (let i = 0; i < mask.rgba.length; i += 4) if (mask.rgba[i + 3]) mask.rgba.fill(255, i, i + 3);
    add(`masks/${layout.layoutId}.png`, mask);
  }
  const overview = raster(P.layouts[0].columns * N, proofImages.reduce((height, image) => height + image.height, 0) + 32);
  let offset = 0;
  for (const image of proofImages) { blit(overview, image, 0, offset); offset += image.height + 16; }
  add('proofs/overview.png', overview);
  const report = seal({ format: 'ai_scene_terrain_proof_derivation_v1', compiler: 'scene-kit-terrain-proof-v1',
    profileSha256: TERRAIN_PROOF_SHA256, source: { sha256: hash(raw), byteLength: raw.length, pixelSize: { width: source.width, height: source.height } },
    crops, profile: P, artifacts, assessments, derivedCardinalTileCount: tiles.size,
    independentGeneratedModuleCount: 0, productionKit: false, visualAcceptance: 'not-assessed', metadataTrust: 'not-verified' });
  files.set('derivation.json', jsonBytes(report));
  return { files, report };
}

export const proofInventoryDigest = files => digest([...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  .map(([path, bytes]) => ({ path, sha256: hash(bytes), byteLength: bytes.length })));
