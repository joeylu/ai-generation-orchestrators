import test from 'node:test';
import assert from 'node:assert/strict';
import { skinUsage } from '../src/skins/usage.mjs';
import { sliceViewOptions } from '../src/slicing/document.mjs';
import { measureSlices } from '../src/slicing/geometry.mjs';
import { suggestSlices } from '../src/slicing/suggestion.mjs';
import { assertMetadata } from '../src/skins/contract.mjs';

const meta = { density: 3, nineSlice: { left: 24, top: 8, right: 22, bottom: 6 }, contentInsets: { left: 26, top: 2, right: 26, bottom: 2 }, minSize: { width: 53, height: 17 } };
test('Panel physical cuts and skin logical cuts agree at scale 2, density 3, asymmetric edges', () => {
  const usage = skinUsage(meta, 768, 192, 2);
  const panel = sliceViewOptions({ source: { width: 768, height: 192 }, density: 6, bordersPx: { left: 144, top: 48, right: 132, bottom: 36 }, target: { width: 276, height: 40 }, multiplier: 1 });
  assert.equal(usage.resolution, 6);
  assert.deepEqual(usage.measure(276, 40), measureSlices(panel));
  assert.deepEqual(usage.tuple, [24, 8, 22, 6]);
  assert.deepEqual(usage.pixi, { leftWidth: 24, topHeight: 8, rightWidth: 22, bottomHeight: 6 });
  assert.deepEqual(usage.contentInsets, meta.contentInsets);
  assert.throws(() => usage.measure(45, 40), { code: 'slice.minimum' });
  assert.throws(() => assertMetadata({ ...meta, density: 9 }, 384, 96, 'nine-slice'), { code: 'skin.slice' });
});
test('automatic suggestions include transparent padding, use density and never modify artwork or metadata', () => {
  const image = { width: 80, height: 64, pixels: new Uint8Array(80 * 64 * 4) };
  for (let y = 0; y < 64; y++) for (let x = 0; x < 80; x++) image.pixels.set(x < 10 || x >= 70 ? [255, 0, 0, 0] : x < 16 || x >= 64 || y < 8 || y >= 56 ? [60, 30, 10, 255] : [220, 180, 120, 255], (y * 80 + x) * 4);
  const before = image.pixels.slice(), result = suggestSlices(image, 2);
  assert.equal(result.status, 'supported');
  assert.ok(result.bordersPx.left >= 16);
  assert.equal(result.nineSlice.left, result.bordersPx.left / 2);
  assert.deepEqual(image.pixels, before);
  image.pixels.fill(0);
  const rejected = suggestSlices(image, 2);
  assert.equal(rejected.status, 'unsupported');
  assert.equal(rejected.nineSlice, undefined);
});
