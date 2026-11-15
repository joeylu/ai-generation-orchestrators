import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeRgbaPng, inspectPng } from '../src/png.mjs';
import { hash } from '../src/generation/common.mjs';
import { SIGNATURES } from '../src/topology.mjs';
import { raster } from '../src/terrain-proof/raster.mjs';
import { buildStudyTiles, studySurface } from '../src/terrain-proof/modules.mjs';
import { referencePhaseAt } from '../src/terrain-proof/reference-field.mjs';
import { JOINED_FIELD_PROFILE, JOINED_FIELD_SHA256, joinedFieldCrops, resampleJoinedField,
  buildJoinedTiles, joinedSurface, deriveJoinedField } from '../src/terrain-proof/joined-field.mjs';

const rgbaAt = (image, x, y) => [...image.rgba.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];
const png = bytes => inspectPng(bytes, { includePixels: true, pixelStats: true });
function material(theme, width = 1024, height = 512) {
  const image = raster(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = (y * width + x) * 4, depth = Math.min(1, Math.max(0, (y - height / 12) / (height / 8)));
    const cap = theme === 'snow' ? [225, 237, 248] : [170, 133, 48];
    const body = theme === 'snow' ? [94, 119, 139] : [116, 91, 72];
    for (let c = 0; c < 3; c++) image.rgba[p + c] = Math.max(0, Math.min(255,
      Math.round(cap[c] * (1 - depth) + body[c] * depth + ((x * 3 + y * 5) % 11) - 5)));
    image.rgba[p + 3] = 255;
  }
  return encodeRgbaPng(width, height, image.rgba);
}
const derived = new Map();
const sample = theme => {
  if (!derived.has(theme)) {
    const raw = material(theme), before = Buffer.from(raw), value = deriveJoinedField(raw);
    assert.deepEqual(raw, before); derived.set(theme, { raw, ...value });
  }
  return derived.get(theme);
};

test('one rational source scale and adjacent source origins apply to several material dimensions', () => {
  for (const [width, height] of [[1024, 512], [1774, 887], [1536, 1024], [4096, 4095]]) {
    const crops = joinedFieldCrops(width, height), s = crops.nativePixelsPerFieldPixel;
    assert.equal(crops.body.width.numerator / crops.body.width.denominator / 505, s.numerator / s.denominator);
    assert.equal(crops.body.height.numerator / crops.body.height.denominator / 253, s.numerator / s.denominator);
    assert.equal(crops.cap.height.numerator / crops.cap.height.denominator / 32, s.numerator / s.denominator);
    assert.deepEqual(crops.cap.x, crops.body.x);
    assert.equal(crops.body.y.numerator / crops.body.y.denominator, Math.floor(height / 8));
    assert.equal(crops.cap.y.numerator / crops.cap.y.denominator, Math.floor(height / 16));
    const offset = crops.surfaceOriginInBodyPixels.numerator / crops.surfaceOriginInBodyPixels.denominator;
    assert.ok(crops.surfaceOriginInBodyPixels.denominator > 0);
    assert.ok(offset < 0 && offset >= -64);
    assert.equal(offset, (Math.floor(height / 16) - Math.floor(height / 8)) / (s.numerator / s.denominator));
  }
  assert.ok(Object.isFrozen(JOINED_FIELD_PROFILE.transition));
  assert.equal(JOINED_FIELD_SHA256.length, 64);
  for (let height = 512; height < 545; height++) {
    assert.ok(joinedFieldCrops(height * 2 + 3, height).surfaceOriginInBodyPixels.denominator > 0);
  }
});

test('uniform area sampling uses source pixels on both axes and never upscales', () => {
  const image = raster(20, 20);
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) {
    const p = (y * 20 + x) * 4;
    image.rgba.set([x * 5 + y * 3, x * 5, y * 3, 255], p);
  }
  const actual = resampleJoinedField(image,
    { xNumerator: 1, denominator: 2, stepNumerator: 4 }, 2, 2, 1);
  assert.deepEqual(rgbaAt(actual, 0, 0), [8, 5, 3, 255]);
  assert.deepEqual(rgbaAt(actual, 1, 1), [24, 15, 9, 255]);
  assert.throws(() => resampleJoinedField(image,
    { xNumerator: 0, denominator: 2, stepNumerator: 1 }, 2, 2, 0));
});

test('the source-painted transition replaces the previous fixed eight-pixel color cut', () => {
  const body = raster(64, 64), cap = raster(64, 32), oldCap = raster(64, 8);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) body.rgba.set([100, 100, 100, 255], (y * 64 + x) * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) {
    const alpha = y < 24 ? 255 : Math.floor((255 * (31 - y) + 3) / 7), p = (y * 64 + x) * 4;
    cap.rgba.set(alpha ? [200 - y * 3, 200 - y * 3, 200 - y * 3, alpha] : [0, 0, 0, 0], p);
    if (y < 8) oldCap.rgba.set(cap.rgba.subarray(p, p + 4), p);
  }
  const before = buildStudyTiles(body, oldCap).get(0), after = buildJoinedTiles(body, cap).get(0);
  assert.equal(Math.abs(rgbaAt(before, 32, 7)[0] - rgbaAt(before, 32, 8)[0]), 79);
  assert.equal(Math.abs(rgbaAt(after, 32, 7)[0] - rgbaAt(after, 32, 8)[0]), 3);
  assert.deepEqual(rgbaAt(after, 32, 31), [100, 100, 100, 255]);
  assert.deepEqual(rgbaAt(after, 32, 32), [100, 100, 100, 255]);
});

test('all 47 editable topology roles retain their alpha and receive no invented side shade', () => {
  const body = raster(64, 64), cap = raster(64, 32);
  for (let p = 0; p < body.rgba.length; p += 4) body.rgba.set([120, 80, 40, 255], p);
  const tiles = buildJoinedTiles(body, cap);
  assert.equal(tiles.size, 47);
  for (const mask of SIGNATURES) {
    const tile = tiles.get(mask);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const rgba = rgbaAt(tile, x, y), surface = studySurface(mask, x, y);
      assert.equal(joinedSurface(mask, x, y).shade, 255);
      assert.equal(rgba[3], surface.alpha);
      assert.deepEqual(rgba.slice(0, 3), surface.alpha ? [120, 80, 40] : [0, 0, 0]);
    }
  }
});

for (const theme of ['autumn', 'snow']) test(`${theme}: complete derivation retains source identity, continuous alpha and world-phase seam evidence`, () => {
  const { raw, files, report } = sample(theme);
  assert.equal(report.source.sha256, hash(raw));
  assert.equal(report.profileSha256, JOINED_FIELD_SHA256);
  assert.equal(report.generationCalls, 0);
  assert.equal(report.visualAcceptance, 'not-assessed');
  assert.equal(report.sourceTransition.naturalTransitionAssessed, false);
  assert.deepEqual(report.surfaceOriginInBodyPixels, report.crops.surfaceOriginInBodyPixels);
  assert.equal(report.topologyRoles, 47);
  assert.equal(report.phaseCount, 32);
  assert.ok(report.assessments.length > 5);
  for (const qa of report.assessments) {
    assert.equal(qa.status, 'pass');
    assert.equal(qa.geometryFailures, 0);
    for (const edge of qa.interfaces) {
      assert.equal(edge.maximumChannelDifference, 0);
      assert.ok(edge.comparedPixels >= edge.minimumComparedPixels);
    }
  }
  const cap = png(files.get('materials/cap-field.png')), body = png(files.get('materials/body-field.png'));
  assert.deepEqual([body.width, body.height, cap.width, cap.height], [505, 253, 505, 32]);
  assert.equal(body.transparentPixels, 0);
  for (let y = 0; y < 32; y++) {
    const expected = y < 24 ? 255 : Math.floor((255 * (31 - y) + 3) / 7);
    for (let x = 0; x < 505; x++) {
      const rgba = rgbaAt(cap, x, y); assert.equal(rgba[3], expected);
      if (!expected) assert.deepEqual(rgba, [0, 0, 0, 0]);
    }
  }
  for (const artifact of report.artifacts) {
    const bytes = files.get(artifact.path);
    assert.equal(hash(bytes), artifact.sha256);
    assert.equal(bytes.length, artifact.byteLength);
  }
  assert.equal(referencePhaseAt(-1, -1), 31);
});

test('opaque sources only, with deterministic byte-for-byte replay', () => {
  const first = sample('autumn'), again = deriveJoinedField(first.raw);
  assert.equal(again.report.sha256, first.report.sha256);
  for (const [path, bytes] of first.files) assert.deepEqual(again.files.get(path), bytes);
  const transparent = raster(1024, 512); transparent.rgba[0] = 100;
  assert.throws(() => deriveJoinedField(encodeRgbaPng(1024, 512, transparent.rgba)));
  assert.throws(() => joinedFieldCrops(512, 512));
  assert.throws(() => deriveJoinedField(Buffer.from('not a PNG')));
});
