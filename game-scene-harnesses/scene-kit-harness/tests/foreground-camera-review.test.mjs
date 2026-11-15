import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewForegroundBottom } from '../src/foreground-camera-review.mjs';

const input = () => ({ bounds: { x: 0, y: 350, width: 200, height: 260 },
  camera: { referenceCenterWorld: { x: 512, y: 288 }, centerDomainWorld: { minX: 512, maxX: 512, minY: 288, maxY: 288 },
    viewportWorld: { width: 1024, height: 576 }, modes: ['editor-unparallax', 'play-parallax'] }, parallax: { x: 1.1, y: 1 } });

test('a bottom hidden below the main frame enters the free camera domain', () => {
  const a = input();
  assert.equal(reviewForegroundBottom(a).bottomMayEnterView, false);
  a.camera.centerDomainWorld.maxY = 360;
  assert.equal(reviewForegroundBottom(a).bottomMayEnterView, true);
  assert.match(reviewForegroundBottom(a).limitations, /support.*not assessed/);
});

test('modes use the actual projection, include horizontal separation, and handle negative parallax', () => {
  const a = input();
  a.bounds = { x: 1100, y: 0, width: 30, height: 500 };
  a.camera.centerDomainWorld.maxX = 700;
  a.parallax.x = 0;
  const r = reviewForegroundBottom(a);
  assert.equal(r.modes[0].bottomMayEnterView, true);
  assert.equal(r.modes[1].bottomMayEnterView, false);
  a.parallax.x = -1;
  assert.equal(reviewForegroundBottom(a).modes[1].visibleWorldUnion.left, -188);
});

test('finite extents and explicit supported modes are required', () => {
  const a = input(); a.bounds.height = Infinity;
  assert.throws(() => reviewForegroundBottom(a), TypeError);
  a.bounds.height = 20; a.camera.modes = ['unknown'];
  assert.throws(() => reviewForegroundBottom(a), TypeError);
});

test('finite inputs that overflow projection or bounds are rejected', () => {
  const a = input();
  a.camera.centerDomainWorld.minX = -Number.MAX_VALUE;
  a.camera.referenceCenterWorld.x = Number.MAX_VALUE;
  a.parallax.x = 0;
  assert.throws(() => reviewForegroundBottom(a), /overflow/);
  const b = input(); b.bounds.x = Number.MAX_VALUE; b.bounds.width = Number.MAX_VALUE;
  assert.throws(() => reviewForegroundBottom(b), /overflow/);
});
