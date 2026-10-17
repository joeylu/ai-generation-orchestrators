import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePanel } from '../src/analyze.mjs';
import { automaticSliceDocument } from '../src/automatic.mjs';

function fixture(draw, width = 80, height = 64) {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set(draw(x, y), (y * width + x) * 4);
  return { width, height, pixels };
}
test('asymmetric edges and corner ornaments stay outside stretch bands', () => {
  const image = fixture((x, y) => x < 12 ? [255, 0, 0, 255] : x >= 60 ? [0, 0, 255, 255] : y < 8 ? [0, 255, 0, 255] : y >= 50 ? [255, 255, 0, 255] : [60, 60, 60, 255]);
  assert.deepEqual(analyzePanel(image).bordersPx, { left: 13, right: 21, top: 9, bottom: 15 });
  image.pixels.set([255, 255, 255, 255], (6 * 80 + 20) * 4);
  assert.equal(analyzePanel(image).bordersPx.left, 22);
});
test('flat panels supported; transparent, gradient, noise and centered art rejected', () => {
  assert.equal(analyzePanel(fixture(() => [50, 70, 90, 128])).status, 'supported');
  for (const draw of [() => [255, 255, 255, 0], (x, y) => [x * 3, y * 3, 90, 255],
    (x, y) => [(x * 17 + y * 23) % 256, 40, 90, 255],
    (x, y) => Math.abs(x - 40) < 4 && Math.abs(y - 32) < 4 ? [255, 0, 0, 255] : [50, 70, 90, 255]])
    assert.equal(analyzePanel(fixture(draw)).status, 'unsupported');
});
test('invisible RGB ignored, small details in stretching strips not skipped', () => {
  const image = fixture((x, y) => y < 5 ? [x * 3, 0, 0, 0] : [70, 90, 110, 255]);
  assert.equal(analyzePanel(image).status, 'supported');
  for (let x = 0; x < 80; x++) image.pixels.set([x * 3, 0, 0, 255], (2 * 80 + x) * 4);
  assert.equal(analyzePanel(image).status, 'unsupported');
});
test('automatic defaults fit the initial panel and serialize as the existing document', () => {
  const image = fixture(() => [80, 90, 100, 255], 800, 640);
  const asset = { source: { sha256: 'a'.repeat(64), width: 800, height: 640 }, readPixels: () => image };
  const doc = automaticSliceDocument(asset, { width: 400, height: 320 });
  assert.equal(doc.multiplier, 2); assert.equal(doc.density, 1);
  assert.deepEqual(doc.bordersPx, { left: 0, top: 0, right: 0, bottom: 0 });
  assert.throws(() => automaticSliceDocument({ ...asset, readPixels: () => fixture(() => [0, 0, 0, 0]) }), /无法自动配置/);
});

test('structural fallback identifies a framed textured panel and protects the frame', () => {
  const image = fixture((x, y) => {
    if (x < 4 || x >= 156 || y < 4 || y >= 116) return [200, 0, 0, 0];
    if (x < 16 || x >= 144 || y < 16 || y >= 104) return [65, 35, 15, 255];
    const texture = (x * 7 + y * 11) % 17;
    return [220 + texture, 180 + texture, 110 + texture, 255];
  }, 160, 120);
  const result = analyzePanel(image);
  assert.equal(result.method, 'framed-texture-v2');
  for (const border of Object.values(result.bordersPx)) assert.ok(border >= 16 && border < 40);
  assert.ok(result.bordersPx.left + result.bordersPx.right < 160);
  assert.ok(result.bordersPx.top + result.bordersPx.bottom < 120);
  // A strong central emblem is not harmless paper grain.
  for (let y = 45; y < 75; y++) for (let x = 65; x < 95; x++) image.pixels.set([0, 0, 0, 255], (y * 160 + x) * 4);
  assert.equal(analyzePanel(image).status, 'unsupported');
});

test('unframed texture and framed translucent holes remain unsupported', () => {
  const plain = fixture((x, y) => [180 + (x * 3 + y * 7) % 23, 150, 80, 255], 160, 120);
  assert.equal(analyzePanel(plain).status, 'unsupported');
  for (let y = 0; y < 120; y++) for (let x = 0; x < 160; x++) {
    if (x < 12 || x > 147 || y < 12 || y > 107) plain.pixels.set([35, 20, 10, 255], (y * 160 + x) * 4);
    if (x > 60 && x < 75 && y > 40 && y < 55) plain.pixels[(y * 160 + x) * 4 + 3] = 64;
  }
  assert.equal(analyzePanel(plain).status, 'unsupported');
});

function shadedFrame(shade = 30) {
  return fixture((x, y) => {
    if (x < 4 || x >= 316 || y < 4 || y >= 92) return [0, 0, 0, 0];
    if (x < 18 || x >= 302 || y < 16 || y >= 80) return [40, 65, 80, 255];
    const tint = Math.round(shade * Math.min(1, Math.max(0, (x - 235) / 35)));
    const grain = (x * 7 + y * 11) % 5;
    return [168 - tint + grain, 192 - tint + grain, 190 - tint + grain, 255];
  }, 320, 96);
}
test('mild side shading is separated from an actual frame without changing pixels', () => {
  const image = shadedFrame(), before = image.pixels.slice(), result = analyzePanel(image);
  assert.equal(result.method, 'framed-texture-local-shade-v1');
  assert.ok(result.evidence.localBackgrounds.right);
  assert.ok(result.bordersPx.right >= 18 && result.bordersPx.right < 40);
  assert.ok(result.bordersPx.top >= 16 && result.bordersPx.bottom >= 16);
  assert.deepEqual(image.pixels, before);
});
test('local shade fallback rejects strong side art and translucent interior evidence', () => {
  assert.equal(analyzePanel(shadedFrame(65)).status, 'unsupported');
  const image = shadedFrame();
  for (let y = 30; y < 65; y++) for (let x = 275; x < 283; x++) image.pixels[(y * 320 + x) * 4 + 3] = 64;
  assert.equal(analyzePanel(image).status, 'unsupported');
});
test('horizontal tabs retain vertical padding without requiring a vertical stretch band', () => {
  const image = fixture((x, y) => {
    if (x < 4 || x >= 316 || y < 24 || y >= 72) return [0, 0, 0, 0];
    if (x < 16 || x >= 304 || y < 34 || y >= 62) return [60, 35, 15, 255];
    return [180 + (x * 7 + y * 11) % 7, 140, 80, 255];
  }, 320, 96);
  assert.equal(analyzePanel(image).status, 'unsupported');
  const result = analyzePanel(image, { axis: 'horizontal' });
  assert.equal(result.status, 'supported');
  assert.equal(result.bordersPx.top, 0); assert.equal(result.bordersPx.bottom, 0);
  assert.ok(result.bordersPx.left >= 16 && result.bordersPx.right >= 16);
  const rotated = fixture((x, y) => Array.from(image.pixels.subarray((x * 320 + y) * 4, (x * 320 + y) * 4 + 4)), 96, 320);
  const vertical = analyzePanel(rotated, { axis: 'vertical' });
  assert.equal(vertical.status, 'supported');
  assert.equal(vertical.bordersPx.left, 0); assert.equal(vertical.bordersPx.right, 0);
  assert.equal(analyzePanel(image, { axis: 'unknown' }).status, 'unsupported');
});
