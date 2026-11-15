import { inspectPng } from '../png.mjs';
import { assessEnvironmentAnimationAtlas, ENVIRONMENT_ANIMATION_ATLAS_PROFILE_SHA256 } from './environment-animation-atlas.mjs';
import { check, digest, seal, unseal } from './common.mjs';

const profile = Object.freeze({
  id: 'isolated-environment-animation-atlas-contours-v2',
  parent: ENVIRONMENT_ANIMATION_ATLAS_PROFILE_SHA256,
  visibleAlpha: 8,
  coreAlpha: 224,
  maxContourDepth: 3,
  maxCoreDistanceFactor: 2,
  connectivity: 8,
});
export const ENVIRONMENT_ANIMATION_CONTOUR_PROFILE_SHA256 = digest(profile);

function distances(alpha, width, height, isSeed) {
  const result = new Uint16Array(alpha.length);
  const unreachable = width + height;
  result.fill(unreachable);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (isSeed(alpha[i])) result[i] = 0;
    if (x > 0) result[i] = Math.min(result[i], result[i - 1] + 1);
    if (y > 0) result[i] = Math.min(result[i], result[i - width] + 1);
  }
  for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
    const i = y * width + x;
    if (x + 1 < width) result[i] = Math.min(result[i], result[i + 1] + 1);
    if (y + 1 < height) result[i] = Math.min(result[i], result[i + width] + 1);
  }
  return result;
}

function inspectContours(image, tile) {
  const { x, y, width, height, softEdgePixels } = tile;
  const alpha = Uint8Array.from({ length: width * height }, (_, i) =>
    image.rgba[((y + Math.floor(i / width)) * image.width + x + i % width) * 4 + 3]);
  const core = distances(alpha, width, height, value => value >= profile.coreAlpha);
  const blank = distances(alpha, width, height, value => value < profile.visibleAlpha);
  const allowedDepth = Math.min(profile.maxContourDepth, softEdgePixels);
  const allowedDistance = softEdgePixels * profile.maxCoreDistanceFactor;
  const reached = new Uint8Array(alpha.length), queue = new Uint32Array(alpha.length);
  let end = 0;
  for (let i = 0; i < alpha.length; i++) if (core[i] === 0) {
    reached[i] = 1;
    queue[end++] = i;
  }
  // Reach an extension through visible subject pixels. Beyond the original
  // soft edge the path must stay both narrow and close to an opaque core.
  for (let head = 0; head < end; head++) {
    const i = queue[head], localX = i % width, localY = Math.floor(i / width);
    for (let yy = Math.max(0, localY - 1); yy <= Math.min(height - 1, localY + 1); yy++)
      for (let xx = Math.max(0, localX - 1); xx <= Math.min(width - 1, localX + 1); xx++) {
        const next = yy * width + xx;
        if (reached[next] || alpha[next] < profile.visibleAlpha) continue;
        if (core[next] > softEdgePixels && (core[next] > allowedDistance || blank[next] > allowedDepth)) continue;
        reached[next] = 1;
        queue[end++] = next;
      }
  }
  let connectedContourPixels = 0, remainingFarFieldPixels = 0;
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] < profile.visibleAlpha || core[i] <= softEdgePixels) continue;
    if (reached[i]) connectedContourPixels++;
    else remainingFarFieldPixels++;
  }
  check(connectedContourPixels + remainingFarFieldPixels === tile.farFieldPixels, 'ANIMATION_ATLAS_CONTOUR_REPLAY_MISMATCH');
  return { connectedContourPixels, remainingFarFieldPixels };
}

// Separate evidence only. The original attempt and its frozen QA keep their
// verdict, and the caller owns any subsequent review or publication decision.
export function reassessEnvironmentAnimationAtlasContours(bytes, previousQa) {
  unseal(previousQa);
  const { columns, rows } = previousQa;
  const replay = assessEnvironmentAnimationAtlas(bytes, { columns, rows });
  check(replay.sha256 === previousQa.sha256, 'ANIMATION_ATLAS_CONTOUR_PARENT_CHANGED');
  const image = inspectPng(bytes, { allowCabx: true, allowHiddenRgb: true, includePixels: true });
  const tiles = replay.tiles.map(tile => tile.farFieldPixels ? inspectContours(image, tile)
    : { connectedContourPixels: 0, remainingFarFieldPixels: 0 });
  const issues = replay.issues.filter(issue => issue !== 'ANIMATION_ATLAS_FAR_FIELD_ALPHA'
    || tiles.some(tile => tile.remainingFarFieldPixels));
  return seal({
    format: 'ai_scene_environment_animation_atlas_contour_review_v2',
    profileSha256: ENVIRONMENT_ANIMATION_CONTOUR_PROFILE_SHA256,
    parentQaSha256: replay.sha256, rawSha256: replay.rawSha256, columns, rows, tiles,
    status: issues.length ? 'fail' : 'pass', issues, originalQaStatus: replay.status,
    originalQaModified: false, sourceModified: false, humanVisualAcceptance: 'pending',
  });
}
