import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessEnvironmentAnimationAtlas, makeEnvironmentPoseGuide, sliceEnvironmentAnimationAtlas, validateEnvironmentPoseGuide,
} from '../src/generation/environment-animation-atlas.mjs';
import { reassessEnvironmentAnimationAtlasContours } from '../src/generation/environment-animation-atlas-contours.mjs';
import { prepareEnvironmentAnimationAtlasPadding } from '../src/generation/environment-animation-atlas-padding.mjs';
import { hash } from '../src/generation/common.mjs';
import { encodeRgbaPng, inspectPng } from '../src/png.mjs';
import { raster } from '../src/terrain-proof/raster.mjs';

const grid = { columns: 2, rows: 2 };
const encode = image => encodeRgbaPng(image.width, image.height, image.rgba);
const decode = bytes => inspectPng(bytes, { includePixels: true });
const alpha = (image, x, y) => image.rgba[(y * image.width + x) * 4 + 3];
const rejects = code => error => error.errors?.[0]?.code === code;
function fill(image, x, y, width, height, pixel) {
  for (let dy = y; dy < y + height; dy++) for (let dx = x; dx < x + width; dx++) {
    image.rgba.set(pixel, (dy * image.width + dx) * 4);
  }
}

function sampleAtlas(width = 64, height = 48) {
  const image = raster(width, height);
  for (let row = 0; row < 2; row++) for (let column = 0; column < 2; column++) {
    const x = column * Math.floor(width / 2), y = row * Math.floor(height / 2);
    fill(image, x + 12, y + 8, 6, 9, [32 + 30 * row, 180, 60 + 30 * column, 255]);
    fill(image, x + 11, y + 8, 1, 9, [32 + 30 * row, 180, 60 + 30 * column, 96]);
  }
  return image;
}

test('pose guide keeps a shared placement and writes only neutral silhouette pixels', () => {
  const first = raster(32, 24), second = raster(32, 24);
  for (const image of [first, second]) fill(image, 14, 12, 3, 6, [44, 150, 93, 255]);
  fill(first, 10, 8, 5, 4, [33, 181, 40, 255]);
  fill(second, 16, 8, 5, 4, [99, 202, 81, 255]);
  const guideGrid = { columns: 2, rows: 1 };
  const guide = makeEnvironmentPoseGuide([encode(first), encode(second)], { ...guideGrid, cellWidth: 32, cellHeight: 24 });
  assert.deepEqual(validateEnvironmentPoseGuide(guide, guideGrid), { width: 64, height: 24, transparentPixels: 1460 });
  const image = decode(guide);
  assert.deepEqual([...image.rgba.subarray((12 * 64 + 14) * 4, (12 * 64 + 14) * 4 + 4)], [58, 58, 58, 255]);
  assert.equal(alpha(image, 46, 12), 255);
  assert.equal(alpha(image, 10, 8), 255);
  assert.equal(alpha(image, 42, 8), 0);
});

test('pose guide rejects flattened surrounds and enclosed distant alpha', () => {
  const opaque = raster(32, 24);
  fill(opaque, 0, 0, 32, 24, [244, 244, 244, 255]);
  const one = { columns: 1, rows: 1 };
  assert.throws(() => validateEnvironmentPoseGuide(encode(opaque), one), rejects('ANIMATION_GUIDE_OPAQUE_GUTTER'));
  assert.throws(() => makeEnvironmentPoseGuide([encode(opaque)], { ...one, cellWidth: 32, cellHeight: 24 }),
    rejects('ANIMATION_GUIDE_SOURCE_MARGIN'));
  const guide = raster(32, 24);
  fill(guide, 10, 8, 6, 9, [58, 58, 58, 255]);
  fill(guide, 25, 17, 3, 3, [58, 58, 58, 76]);
  assert.throws(() => validateEnvironmentPoseGuide(encode(guide), one), rejects('ANIMATION_GUIDE_FAR_FIELD_ALPHA'));
});

test('atlas rejects a transparent-looking blanket over the complete canvas', () => {
  const image = sampleAtlas();
  for (let offset = 0; offset < image.rgba.length; offset += 4) {
    if (!image.rgba[offset + 3]) image.rgba.set([248, 248, 246, 112], offset);
  }
  const raw = encode(image), qa = assessEnvironmentAnimationAtlas(raw, grid);
  assert.equal(qa.rawSha256, hash(raw));
  assert.equal(qa.status, 'fail');
  assert.deepEqual(qa.issues, ['ANIMATION_ATLAS_VISIBLE_GUTTER', 'ANIMATION_ATLAS_FAR_FIELD_ALPHA']);
  assert(qa.tiles.every(tile => tile.maxGutterAlpha === 112 && tile.farFieldPixels > 0));
  assert.throws(() => sliceEnvironmentAnimationAtlas(raw, grid), rejects('ANIMATION_ATLAS_REJECTED'));
});

test('atlas rejects interior haze with clean gutters, including within silhouette openings', () => {
  const image = sampleAtlas();
  fill(image, 4, 4, 5, 12, [255, 245, 242, 64]);
  // A frame around a fully enclosed opening.
  fill(image, 36, 4, 24, 16, [20, 156, 64, 255]);
  fill(image, 38, 6, 20, 12, [240, 245, 247, 96]);
  const qa = assessEnvironmentAnimationAtlas(encode(image), grid);
  assert.deepEqual(qa.issues, ['ANIMATION_ATLAS_FAR_FIELD_ALPHA']);
  assert.equal(qa.tiles[0].maxFarFieldAlpha, 64);
  assert.equal(qa.tiles[1].maxFarFieldAlpha, 96);
  assert(qa.tiles.every(tile => tile.maxGutterAlpha === 0));
});

test('atlas preserves soft edges and pads uneven cells without moving or resampling pixels', () => {
  const image = sampleAtlas(65, 49);
  fill(image, 31, 0, 1, 1, [248, 248, 246, 7]);
  fill(image, 0, 0, 1, 1, [210, 160, 35, 0]);
  const raw = encode(image), qa = assessEnvironmentAnimationAtlas(raw, grid);
  assert.equal(qa.status, 'pass');
  assert.equal(qa.equalSourceCells, false);
  assert.deepEqual(qa.frameSize, { width: 33, height: 25 });
  const frames = sliceEnvironmentAnimationAtlas(raw, grid).map(decode);
  assert.equal(frames.length, 4);
  for (const [index, cell] of qa.tiles.entries()) {
    const frame = frames[index];
    assert.deepEqual([frame.width, frame.height], [33, 25]);
    for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
      const source = ((cell.y + y) * image.width + cell.x + x) * 4;
      const target = (y * frame.width + x) * 4;
      const expected = x < cell.width && y < cell.height && image.rgba[source + 3]
        ? image.rgba.subarray(source, source + 4) : Buffer.alloc(4);
      assert.deepEqual(frame.rgba.subarray(target, target + 4), expected);
    }
  }
  assert.equal(hash(raw), qa.rawSha256);
});

test('separate contour review preserves narrow attached tips beyond the normal soft edge', () => {
  const image = raster(72, 72), one = { columns: 1, rows: 1 };
  fill(image, 20, 20, 6, 15, [44, 155, 70, 255]);
  fill(image, 26, 25, 6, 1, [50, 160, 70, 170]);
  const raw = encode(image), parent = assessEnvironmentAnimationAtlas(raw, one);
  assert.deepEqual(parent.issues, ['ANIMATION_ATLAS_FAR_FIELD_ALPHA']);
  const review = reassessEnvironmentAnimationAtlasContours(raw, parent);
  assert.equal(review.parentQaSha256, parent.sha256);
  assert.equal(review.originalQaStatus, 'fail');
  assert.equal(review.status, 'pass');
  assert.deepEqual(review.tiles, [{ connectedContourPixels: 3, remainingFarFieldPixels: 0 }]);
  assert.equal(review.rawSha256, hash(raw));
  assert.throws(() => sliceEnvironmentAnimationAtlas(raw, one), rejects('ANIMATION_ATLAS_REJECTED'));
});

test('contour review still blocks broad attached haze, detached flecks and painted gutters', () => {
  const one = { columns: 1, rows: 1 };
  for (const [name, shape, issue] of [
    ['attached haze', [26, 21, 8, 12], 'ANIMATION_ATLAS_FAR_FIELD_ALPHA'],
    ['detached fleck', [30, 25, 1, 1], 'ANIMATION_ATLAS_FAR_FIELD_ALPHA'],
    ['painted gutter', [0, 25, 1, 1], 'ANIMATION_ATLAS_VISIBLE_GUTTER'],
  ]) {
    const image = raster(72, 72);
    fill(image, 20, 20, 6, 15, [44, 155, 70, 255]);
    fill(image, ...shape, [246, 246, 245, 110]);
    const raw = encode(image), parent = assessEnvironmentAnimationAtlas(raw, one);
    const review = reassessEnvironmentAnimationAtlasContours(raw, parent);
    assert.equal(review.status, 'fail', name);
    assert(review.issues.includes(issue), name);
  }
});

test('contour review requires the exact sealed parent QA and raw bytes', () => {
  const raw = encode(sampleAtlas()), parent = assessEnvironmentAnimationAtlas(raw, grid);
  assert.throws(() => reassessEnvironmentAnimationAtlasContours(raw, { ...parent, status: 'fail' }), rejects('RECORD_INTEGRITY'));
  assert.throws(() => reassessEnvironmentAnimationAtlasContours(encode(sampleAtlas(65, 49)), parent),
    rejects('ANIMATION_ATLAS_CONTOUR_PARENT_CHANGED'));
});

test('padding requires trace-only cut edges and preserves even the hidden RGB in every cell', () => {
  const image = raster(65, 32), grid = { columns: 2, rows: 1 };
  fill(image, 2, 6, 18, 18, [40, 150, 68, 255]);
  fill(image, 38, 6, 18, 18, [40, 155, 68, 255]);
  fill(image, 0, 12, 1, 1, [200, 200, 200, 7]);
  fill(image, 1, 12, 1, 1, [200, 200, 200, 11]);
  fill(image, 15, 0, 1, 1, [200, 200, 200, 0]);
  const raw = encode(image), parent = assessEnvironmentAnimationAtlas(raw, grid);
  const { atlas, qa, report } = prepareEnvironmentAnimationAtlasPadding(raw, parent);
  assert.deepEqual(parent.issues, ['ANIMATION_ATLAS_VISIBLE_GUTTER']);
  assert.equal(qa.status, 'pass');
  assert.equal(report.rawSha256, hash(raw));
  assert.equal(report.adoption, 'requires-exact-review');
  const result = inspectPng(atlas, { includePixels: true, allowHiddenRgb: true });
  for (const [index, tile] of parent.tiles.entries()) for (let y = 0; y < tile.height; y++) {
    const from = ((tile.y + y) * image.width + tile.x) * 4;
    const to = ((2 + y) * result.width + index * qa.frameSize.width + 2) * 4;
    assert.deepEqual(result.rgba.subarray(to, to + tile.width * 4), image.rgba.subarray(from, from + tile.width * 4));
  }
  fill(image, 0, 12, 1, 1, [200, 200, 200, 8]);
  const clipped = encode(image);
  assert.throws(() => prepareEnvironmentAnimationAtlasPadding(clipped, assessEnvironmentAnimationAtlas(clipped, grid)),
    rejects('ANIMATION_PADDING_PAINT_AT_CUT'));
});
