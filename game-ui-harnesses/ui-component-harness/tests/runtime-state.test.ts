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

test('fractional origins, scientific steps and non-lattice upper limits remain portable', () => {
  for (const [value,min,max,step,expected] of [[1.5,.5,5.5,1,1.5],[10,0,10,3,9],
    [5e-7,0,1e-6,1e-7,5e-7],[3e-11,0,1e-10,1e-11,3e-11],[-.5,-1.5,4.5,1,-.5],
    [1,0,1,2,0],[.3,0,.3,.1,.3]]) {
    const result=snapSlider(value,min,max,step);
    assert.equal(result,expected);assert(isStepAligned(result,min,step));assert(result>=min&&result<=max);
  }
});
