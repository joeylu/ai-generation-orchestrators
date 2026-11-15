import { resampleEnvironmentAlpha } from '../environment-proof.mjs';
import { encodeRgbaPng, inspectPng } from '../png.mjs';
import { blit, raster } from '../terrain-proof/raster.mjs';
import { check, digest, hash, seal } from './common.mjs';

const profile = Object.freeze({
  id: 'isolated-environment-animation-atlas-v1',
  gutterPixels: 2,
  visibleAlpha: 8,
  coreAlpha: 224,
  softEdgeDistance: 'ceil-short-cell-side-divided-by-24',
  grid: 'floor-boundaries-transparent-right-bottom-padding',
  guideInk: 58,
});
export const ENVIRONMENT_ANIMATION_ATLAS_PROFILE_SHA256 = digest(profile);

function decode(bytes, options) {
  check(Buffer.isBuffer(bytes) && bytes.length <= 16777216, 'ANIMATION_ATLAS_BYTES');
  return inspectPng(bytes, { includePixels: true, ...options });
}

function gridCells(width, height, { columns, rows }) {
  check([columns, rows].every(count => Number.isSafeInteger(count) && count >= 1 && count <= 8)
    && Math.floor(width / columns) >= 8 && Math.floor(height / rows) >= 8, 'ANIMATION_ATLAS_GRID');
  return Array.from({ length: columns * rows }, (_, index) => {
    const column = index % columns, row = Math.floor(index / columns);
    const x = Math.floor(column * width / columns), y = Math.floor(row * height / rows);
    return { x, y, width: Math.floor((column + 1) * width / columns) - x,
      height: Math.floor((row + 1) * height / rows) - y };
  });
}

const isGutter = (x, y, width, height) => Math.min(x, y, width - 1 - x, height - 1 - y) < profile.gutterPixels;

export function makeEnvironmentPoseGuide(framePngs, { columns, rows, cellWidth, cellHeight }) {
  const width = columns * cellWidth, height = rows * cellHeight;
  check([cellWidth, cellHeight].every(Number.isSafeInteger) && width <= 4096 && height <= 4096, 'ANIMATION_GUIDE_SIZE');
  const cells = gridCells(width, height, { columns, rows });
  check(framePngs.length === cells.length, 'ANIMATION_GUIDE_FRAME_COUNT');
  const source = decode(framePngs[0], { allowHiddenRgb: true });
  check(source.width * source.height * cells.length <= 16777216, 'ANIMATION_GUIDE_SOURCE_SIZE');
  const frames = [source];
  let left = source.width, top = source.height, right = 0, bottom = 0;
  for (let index = 0; index < cells.length; index++) {
    const frame = index === 0 ? source : decode(framePngs[index], { allowHiddenRgb: true });
    check(frame.width === source.width && frame.height === source.height && frame.channels === 4
      && frame.nonzeroAlphaPixels > 0, 'ANIMATION_GUIDE_SOURCE_FRAME');
    if (index > 0) frames.push(frame);
    for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
      const offset = (y * frame.width + x) * 4;
      if (!frame.rgba[offset + 3]) continue;
      check(!isGutter(x, y, frame.width, frame.height), 'ANIMATION_GUIDE_SOURCE_MARGIN');
      frame.rgba.fill(profile.guideInk, offset, offset + 3);
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
    }
  }
  // Use the same crop and transform in every cell so pose registration survives.
  const crop = { x: left, y: top, width: right - left, height: bottom - top };
  const margin = Math.max(profile.gutterPixels, Math.ceil(Math.min(cellWidth, cellHeight) / 10));
  const scale = Math.min(1, (cellWidth - 2 * margin) / crop.width, (cellHeight - 2 * margin) / crop.height);
  const poseWidth = Math.max(1, Math.floor(crop.width * scale)), poseHeight = Math.max(1, Math.floor(crop.height * scale));
  const offsetX = Math.floor((cellWidth - poseWidth) / 2), offsetY = Math.floor((cellHeight - poseHeight) / 2);
  const guide = raster(width, height);
  frames.forEach((frame, index) => {
    const pose = resampleEnvironmentAlpha(frame, crop, poseWidth, poseHeight);
    blit(guide, pose, cells[index].x + offsetX, cells[index].y + offsetY);
  });
  const bytes = encodeRgbaPng(width, height, guide.rgba);
  validateEnvironmentPoseGuide(bytes, { columns, rows });
  return bytes;
}

export function validateEnvironmentPoseGuide(bytes, grid) {
  const image = decode(bytes);
  check(image.channels === 4 && image.width % grid.columns === 0 && image.height % grid.rows === 0, 'ANIMATION_GUIDE_RGBA_GRID');
  for (const cell of gridCells(image.width, image.height, grid)) {
    const evidence = inspectCell(image, cell);
    check(evidence.maxGutterAlpha === 0, 'ANIMATION_GUIDE_OPAQUE_GUTTER');
    check(evidence.corePixels > 0, 'ANIMATION_GUIDE_EMPTY_POSE');
    check(evidence.farFieldPixels === 0, 'ANIMATION_GUIDE_FAR_FIELD_ALPHA');
    for (let y = 0; y < cell.height; y++) for (let x = 0; x < cell.width; x++) {
      const offset = ((cell.y + y) * image.width + cell.x + x) * 4, alpha = image.rgba[offset + 3];
      if (!alpha) continue;
      check(image.rgba[offset] === profile.guideInk && image.rgba[offset + 1] === profile.guideInk
        && image.rgba[offset + 2] === profile.guideInk, 'ANIMATION_GUIDE_INK');
    }
  }
  return { width: image.width, height: image.height, transparentPixels: image.width * image.height - image.nonzeroAlphaPixels };
}

function inspectCell(image, cell) {
  const { width, height } = cell;
  const distance = new Uint16Array(width * height);
  distance.fill(width + height);
  const alphaAt = (x, y) => image.rgba[((cell.y + y) * image.width + cell.x + x) * 4 + 3];
  let corePixels = 0, maxGutterAlpha = 0, farFieldPixels = 0, maxFarFieldAlpha = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x, alpha = alphaAt(x, y);
    if (isGutter(x, y, width, height)) maxGutterAlpha = Math.max(maxGutterAlpha, alpha);
    if (alpha >= profile.coreAlpha) {
      distance[index] = 0;
      corePixels++;
    }
    if (x > 0) distance[index] = Math.min(distance[index], distance[index - 1] + 1);
    if (y > 0) distance[index] = Math.min(distance[index], distance[index - width] + 1);
  }
  // Measure alpha outside the soft edge of the opaque subject, including holes
  // inside the silhouette. Color and connectivity to the canvas edge are irrelevant.
  const softEdgePixels = Math.ceil(Math.min(width, height) / 24);
  for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
    const index = y * width + x;
    if (x + 1 < width) distance[index] = Math.min(distance[index], distance[index + 1] + 1);
    if (y + 1 < height) distance[index] = Math.min(distance[index], distance[index + width] + 1);
    if (distance[index] <= softEdgePixels) continue;
    const alpha = alphaAt(x, y);
    if (alpha >= profile.visibleAlpha) farFieldPixels++;
    maxFarFieldAlpha = Math.max(maxFarFieldAlpha, alpha);
  }
  return { ...cell, corePixels, softEdgePixels, maxGutterAlpha, farFieldPixels, maxFarFieldAlpha };
}

function assessAtlas(image, rawSha256, grid) {
  const { width, height, channels } = image;
  const tiles = gridCells(width, height, grid).map(cell => inspectCell(image, cell));
  const issues = [];
  if (channels !== 4) issues.push('ANIMATION_ATLAS_RGBA_REQUIRED');
  if (tiles.some(tile => !tile.corePixels)) issues.push('ANIMATION_ATLAS_EMPTY_CORE');
  if (tiles.some(tile => tile.maxGutterAlpha >= profile.visibleAlpha)) issues.push('ANIMATION_ATLAS_VISIBLE_GUTTER');
  if (tiles.some(tile => tile.farFieldPixels)) issues.push('ANIMATION_ATLAS_FAR_FIELD_ALPHA');
  const { columns, rows } = grid;
  return seal({
    format: 'ai_scene_environment_animation_atlas_qa_v1', profileSha256: ENVIRONMENT_ANIMATION_ATLAS_PROFILE_SHA256,
    rawSha256, width, height, columns, rows, status: issues.length ? 'fail' : 'pass', issues, tiles,
    frameSize: { width: Math.ceil(width / columns), height: Math.ceil(height / rows) },
    equalSourceCells: width % columns === 0 && height % rows === 0,
  });
}

export function assessEnvironmentAnimationAtlas(bytes, grid) {
  return assessAtlas(decode(bytes, { allowHiddenRgb: true, allowCabx: true }), hash(bytes), grid);
}

export function validateEnvironmentAnimationAtlas(bytes, { columns, rows }) {
  const { width, height } = decode(bytes, { includePixels: false, allowHiddenRgb: true, allowCabx: true });
  gridCells(width, height, { columns, rows });
  return { rawSha256: hash(bytes), width, height, columns, rows,
    frameSize: { width: Math.ceil(width / columns), height: Math.ceil(height / rows) } };
}

export function sliceEnvironmentAnimationAtlas(bytes, grid) {
  const image = decode(bytes, { allowHiddenRgb: true, allowCabx: true });
  const qa = assessAtlas(image, hash(bytes), grid);
  check(qa.status === 'pass', 'ANIMATION_ATLAS_REJECTED');
  return qa.tiles.map(cell => {
    const frame = raster(qa.frameSize.width, qa.frameSize.height);
    for (let y = 0; y < cell.height; y++) for (let x = 0; x < cell.width; x++) {
      const from = ((cell.y + y) * image.width + cell.x + x) * 4;
      if (image.rgba[from + 3]) image.rgba.copy(frame.rgba, (y * frame.width + x) * 4, from, from + 4);
    }
    return encodeRgbaPng(frame.width, frame.height, frame.rgba);
  });
}
