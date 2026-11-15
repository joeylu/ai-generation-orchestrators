import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveSyntheticPaintGeometry } from '../experiments/paint-geometry-study.mjs';
import { raster } from '../src/terrain-proof/raster.mjs';
import { hash, seal, unseal } from '../src/generation/common.mjs';
const rejects = (fn, code) => assert.throws(fn, e => e.errors?.some(v => v.code === code));
function fixture() {
  const paint = raster(3, 3); for (let i = 0; i < 9; i++) paint.rgba.set([40 + i, 90, 130, 255], i * 4);
  paint.rgba[3] = 128;
  const alpha = Buffer.from([128, 255, 0, 255, 0, 255, 0, 255, 255]);
  const spec = seal({ format: 'ai_scene_synthetic_geometry_spec_v1', purpose: 'synthetic-simulation',
    paintRgbaSha256: hash(paint.rgba), alphaSha256: hash(alpha), localCanvas: { width: 3, height: 3 },
    sceneCanvas: { width: 12, height: 10 }, origin: { x: 5, y: 6 }, unresolvedPixels: 0 });
  const reviewFor = s => seal({ format: 'ai_scene_synthetic_geometry_review_v1', scope: 'synthetic-only-no-real-image-authority',
    specSha256: s.sha256, decision: 'fixture-accepted' });
  const run = (s = spec, a = alpha, p = paint, r = reviewFor(s)) => deriveSyntheticPaintGeometry(p, a, s, r);
  return { paint, alpha, spec, reviewFor, run };
}
test('continuous alpha multiplication rounds half coverage without thresholding', () => {
  const f = fixture(), out = f.run(); assert.equal(out.layer.rgba[3], 64);
  assert.deepEqual([...out.layer.rgba.subarray(0, 3)], [40, 90, 130]);
  assert.equal(out.report.partialAlphaPixels, 1);
});
test('enclosed holes and transparent outer pixels have zero RGBA, inputs stay byte-identical', () => {
  const f = fixture(), p = Buffer.from(f.paint.rgba), a = Buffer.from(f.alpha), out = f.run();
  for (const i of [2, 4, 6]) assert.deepEqual([...out.layer.rgba.subarray(i * 4, i * 4 + 4)], [0, 0, 0, 0]);
  assert.deepEqual(f.paint.rgba, p); assert.deepEqual(f.alpha, a); assert.deepEqual(f.run(), out);
});
test('placement uses the explicit origin and local canvas without fitting visible bounds', () => {
  const f = fixture(), a = Buffer.alloc(9); a[8] = 255;
  const s = seal({ ...unseal(f.spec), alphaSha256: hash(a) }), out = f.run(s, a);
  assert.deepEqual([...out.placed.rgba.subarray((8 * 12 + 7) * 4, (8 * 12 + 7) * 4 + 4)], [48, 90, 130, 255]);
  assert.equal(out.placed.rgba[(6 * 12 + 5) * 4 + 3], 0);
});
test('an unresolved contour never becomes a reviewed delivery alpha', () => {
  const f = fixture(), s = seal({ ...unseal(f.spec), unresolvedPixels: 1 });
  rejects(() => f.run(s), 'STUDY_UNRESOLVED');
});
test('altered source or alpha and mismatched raster dimensions are rejected', () => {
  const f = fixture(), a = Buffer.from(f.alpha); a[0]++;
  rejects(() => f.run(f.spec, a), 'STUDY_BINDING'); f.paint.rgba[0]++;
  rejects(() => f.run(), 'STUDY_BINDING');
  rejects(() => f.run(f.spec, f.alpha, raster(1, 9)), 'STUDY_BINDING');
});
test('missing, rejected or stale fixture decisions cannot authorize an experiment', () => {
  const f = fixture(), r = unseal(f.reviewFor(f.spec));
  rejects(() => f.run(f.spec, f.alpha, f.paint, seal({ ...r, decision: 'pending' })), 'STUDY_REVIEW');
  rejects(() => f.run(f.spec, f.alpha, f.paint, seal({ ...r, specSha256: '0'.repeat(64) })), 'STUDY_REVIEW');
  assert.throws(() => f.run(f.spec, f.alpha, f.paint, {}));
});
test('real-art purpose and out-of-frame transforms are outside the experiment', () => {
  const f = fixture(); rejects(() => f.run(seal({ ...unseal(f.spec), purpose: 'real-art' })), 'STUDY_SYNTHETIC_ONLY');
  for (const origin of [{ x: -1, y: 0 }, { x: 10, y: 0 }, { x: 0.5, y: 0 }])
    rejects(() => f.run(seal({ ...unseal(f.spec), origin })), 'STUDY_PLACEMENT');
});
test('an empty alpha result is a failure even with a matching synthetic fixture decision', () => {
  const f = fixture(), a = Buffer.alloc(9), s = seal({ ...unseal(f.spec), alphaSha256: hash(a) });
  rejects(() => f.run(s, a), 'STUDY_EMPTY');
});
test('native frame contact is preserved without adding an unapproved transparent border', () => {
  const f = fixture(), s = seal({ ...unseal(f.spec), sceneCanvas: { width: 3, height: 3 }, origin: { x: 0, y: 0 } });
  const out = f.run(s);
  assert.deepEqual(out.placed.rgba, out.layer.rgba);
  assert.equal(out.placed.rgba[(1 * 3 + 0) * 4 + 3], 255);
  assert.equal(out.placed.rgba[(2 * 3 + 2) * 4 + 3], 255);
});
