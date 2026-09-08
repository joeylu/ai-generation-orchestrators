import test from 'node:test';
import assert from 'node:assert/strict';
import { clampScroll, isStepAligned, snapSlider } from '../src/runtime-state.ts';

test('slider values stay in the inclusive range and on its step lattice', () => {
  assert.equal(snapSlider(-1, 0, 100, 5), 0);
  assert.equal(snapSlider(12, 0, 100, 5), 10);
  assert.equal(snapSlider(13, 0, 100, 5), 15);
  assert.equal(snapSlider(120, 0, 100, 5), 100);
  assert.equal(snapSlider(0.30000000000000004, 0, 1, 0.1), 0.3);
});

test('scroll ranges use content minus viewport and reject invalid dimensions', () => {
  assert.equal(clampScroll(200, 370, 177), 193);
  assert.equal(clampScroll(-2, 370, 177), 0);
  assert.equal(clampScroll(20, 100, 177), 0);
  assert.throws(() => clampScroll(0, 0, 20), /INVALID_SCROLL_RANGE/);
});

test('step alignment validates a program value without coercing it', () => {
  assert.equal(isStepAligned(10, 0, 5), true);
  assert.equal(isStepAligned(12, 0, 5), false);
  assert.equal(isStepAligned(0.30000000000000004, 0, 0.1), true);
  assert.equal(isStepAligned(Number.NaN, 0, 1), false);
});
