import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveSnowSurface, SNOW_SURFACE_PROFILE, SNOW_SURFACE_SHA256 } from '../src/terrain-proof/snow-surface.mjs';
import { deriveReferenceField } from '../src/terrain-proof/reference-field.mjs';
import { encodeFixturePng, inspectPng } from '../src/png.mjs';
import { hash, digest } from '../src/generation/common.mjs';
import { compileCurveGeometry } from '../src/curves.mjs';

test('snow derivation retains white upper source, original occupancy/body, all 47 roles and strict seam evidence', () => {
  const width = 1024, height = 576, pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set(
    y < 36 ? [245, 250, 255, 255] : [55 + x % 80, 75 + y % 100, 130, 255], (y * width + x) * 4);
  const raw = encodeFixturePng(width, height, pixels), before = hash(raw);
  const old = deriveReferenceField(raw), result = deriveSnowSurface(raw);
  assert.equal(digest(SNOW_SURFACE_PROFILE), SNOW_SURFACE_SHA256); assert.equal(hash(raw), before);
  assert.ok(result.files.get('materials/body-field.png').equals(old.files.get('materials/body-field.png')));
  const cap = inspectPng(result.files.get('materials/cap-field.png'), { includePixels: true });
  assert.equal(cap.height, 16); assert.deepEqual([...cap.rgba.subarray(0, 4)], [245, 250, 255, 255]);
  let tiles = 0;
  for (const [path, bytes] of result.files) if (path.startsWith('tiles/')) {
    const a = inspectPng(bytes, { includePixels: true }), b = inspectPng(old.files.get(path), { includePixels: true });
    for (let p = 0; p < a.rgba.length; p += 4) {
      assert.equal(a.rgba[p + 3], b.rgba[p + 3]);
      if (!a.rgba[p + 3]) assert.equal(a.rgba[p] | a.rgba[p + 1] | a.rgba[p + 2], 0);
    }
    tiles++;
  }
  assert.equal(tiles, 47 * 32);
  assert.ok(result.report.assessments.every(q => q.status === 'pass' && q.geometryFailures === 0
    && q.interfaces.every(i => i.comparedPixels >= 48 && i.maximumChannelDifference === 0)));
});

test('versioned curve cap depth keeps the surface/collision and rejects an unsafe wider strip', () => {
  const curve = { curveId: 'test.curve', familyId: 'terrain.primary', baseY: 100,
    points: [{ x: 0, y: 50, slope: 0 }, { x: 128, y: 50, slope: 0 }] };
  const a = compileCurveGeometry(curve), b = compileCurveGeometry(curve, 16);
  assert.deepEqual(a.surface, b.surface); assert.deepEqual(a.contour, b.contour);
  assert.equal(a.cap.positions[3], 58); assert.equal(b.cap.positions[3], 66);
  assert.equal(b.profile.capWidth, 16);
  assert.throws(() => compileCurveGeometry({ ...curve, baseY: 60 }, 16), e => e.errors.some(i => i.code === 'CURVE_CAP_BOUNDS'));
  assert.throws(() => compileCurveGeometry(curve, 24), e => e.errors.some(i => i.code === 'CURVE_CAP_WIDTH'));
});
