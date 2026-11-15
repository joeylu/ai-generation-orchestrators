import { encodeRgbaPng, inspectPng } from '../png.mjs';
import { assessEnvironmentAnimationAtlas } from './environment-animation-atlas.mjs';
import { check, hash, seal, unseal } from './common.mjs';

const border = 2;

// This prepares a candidate for review. It never changes the original attempt,
// repairs paint, or grants permission to adopt the result.
export function prepareEnvironmentAnimationAtlasPadding(raw, parentQa) {
  unseal(parentQa);
  const { columns, rows, frameSize } = parentQa;
  const grid = { columns, rows }, replay = assessEnvironmentAnimationAtlas(raw, grid);
  check(replay.sha256 === parentQa.sha256, 'ANIMATION_PADDING_PARENT_CHANGED');
  check(replay.issues.length === 1 && replay.issues[0] === 'ANIMATION_ATLAS_VISIBLE_GUTTER',
    'ANIMATION_PADDING_INELIGIBLE');
  const source = inspectPng(raw, { includePixels: true, allowHiddenRgb: true, allowCabx: true });
  const frameWidth = frameSize.width + 2 * border, frameHeight = frameSize.height + 2 * border;
  const width = columns * frameWidth, height = rows * frameHeight;
  check(width <= 4096 && height <= 4096, 'ANIMATION_PADDING_SIZE');
  let outerMax = 0, innerMax = 0, innerVisiblePixels = 0;
  for (const tile of replay.tiles) {
    for (let y = 0; y < tile.height; y++) for (let x = 0; x < tile.width; x++) {
      const distance = Math.min(x, y, tile.width - 1 - x, tile.height - 1 - y);
      if (distance > 1) continue;
      const alpha = source.rgba[((tile.y + y) * source.width + tile.x + x) * 4 + 3];
      if (distance === 0) outerMax = Math.max(outerMax, alpha);
      else {
        innerMax = Math.max(innerMax, alpha);
        if (alpha >= 8) innerVisiblePixels++;
      }
    }
  }
  check(outerMax <= 7 && innerMax <= 16, 'ANIMATION_PADDING_PAINT_AT_CUT');
  const pixels = Buffer.alloc(width * height * 4);
  for (const [index, tile] of replay.tiles.entries()) {
    const left = (index % columns) * frameWidth + border;
    const top = Math.floor(index / columns) * frameHeight + border;
    for (let y = 0; y < tile.height; y++) {
      const start = ((tile.y + y) * source.width + tile.x) * 4;
      source.rgba.copy(pixels, ((top + y) * width + left) * 4, start, start + tile.width * 4);
    }
  }
  const atlas = encodeRgbaPng(width, height, pixels), qa = assessEnvironmentAnimationAtlas(atlas, grid);
  check(qa.status === 'pass', 'ANIMATION_PADDING_QA_FAILED');
  const report = seal({ format: 'ai_scene_environment_animation_atlas_padding_v1', rawSha256: hash(raw),
    parentQaSha256: replay.sha256, paddedSha256: qa.rawSha256, paddedQaSha256: qa.sha256, grid,
    frameSize: { width: frameWidth, height: frameHeight }, border, outerMax, innerMax, innerVisiblePixels,
    originalRgbaPreserved: true, generationCalls: 0, adoption: 'requires-exact-review' });
  return { atlas, qa, report };
}
