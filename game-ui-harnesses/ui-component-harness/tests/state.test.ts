import test from 'node:test';
import assert from 'node:assert/strict';
import { ButtonStateMachine, type ButtonEvent } from '../src/button-state.ts';
function setup() {
  const machine = new ButtonStateMachine(true); const events: ButtonEvent[] = [];
  machine.subscribe(e => events.push(e));
  return { machine, events, count: () => events.filter(e => e.type === 'activate').length };
}
test('click produces normal → hover → pressed → hover and one activate', () => {
  const { machine: m, count } = setup(); m.over('mouse'); assert.equal(m.snapshot().state, 'hover');
  m.down(1, 'mouse', 0, true); assert.equal(m.snapshot().state, 'pressed');
  m.up(1, 'mouse', true); m.up(1, 'mouse', true); assert.equal(count(), 1); assert.equal(m.snapshot().state, 'hover');
});
test('outside release clears press and does not activate', () => {
  const { machine: m, count } = setup(); m.down(1, 'mouse', 0, true); m.out('mouse'); m.up(1, 'mouse', false);
  assert.equal(m.snapshot().state, 'normal'); assert.equal(m.snapshot().pressedPointer, null); assert.equal(count(), 0);
});
test('cancel prevents later inside release', () => {
  const { machine: m, count } = setup(); m.down(4, 'touch', 0, true); m.cancel('pointercancel', 'touch', 4); m.up(4, 'touch', true);
  assert.equal(m.snapshot().state, 'normal'); assert.equal(count(), 0);
});
test('disable before press blocks activate', () => {
  const { machine: m, count } = setup(); m.setEnabled(false); m.down(1, 'mouse', 0, true); m.up(1, 'mouse', true);
  assert.equal(m.snapshot().state, 'disabled'); assert.equal(count(), 0);
});
test('disable while pressed invalidates operation even if enabled before up', () => {
  const { machine: m, count } = setup(); m.down(1, 'mouse', 0, true); m.setEnabled(false); m.setEnabled(true); m.up(1, 'mouse', true);
  assert.equal(m.snapshot().pressedPointer, null); assert.equal(count(), 0);
});
test('secondary pointer cannot finish or cancel primary operation', () => {
  const { machine: m, count } = setup(); m.down(1, 'touch', 0, true); m.down(2, 'touch', 0, false); m.up(2, 'touch', true); m.cancel('pointercancel', 'touch', 2);
  assert.equal(m.snapshot().pressedPointer, 1); m.up(1, 'touch', true); assert.equal(count(), 1); assert.equal(m.snapshot().state, 'normal');
});
test('right click and release without press never activate', () => {
  const { machine: m, count } = setup(); m.down(1, 'mouse', 2, true); m.up(1, 'mouse', true); assert.equal(count(), 0);
});
test('blur, hidden, Escape and scale cancellation discard press', () => {
  for (const reason of ['blur', 'hidden', 'Escape', 'zoom']) {
    const { machine: m, count } = setup(); m.down(1, 'mouse', 0, true); m.cancel(reason); m.up(1, 'mouse', true); assert.equal(count(), 0);
  }
});
test('destroy is idempotent, clears subscriptions and rejects mutation', () => {
  const { machine: m, count, events } = setup(); m.down(1, 'mouse', 0, true); m.destroy(); m.destroy(); m.up(1, 'mouse', true);
  assert.equal(count(), 0); assert.equal(events.filter(e => e.type === 'destroy').length, 1);
  assert.equal(m.snapshot().pressedPointer, null); assert.throws(() => m.setEnabled(true), /INSTANCE_DESTROYED/);
});
test('destroy cleans every subscription even when a destroy callback throws', () => {
  const m = new ButtonStateMachine(true); let second = 0;
  m.subscribe(e => { if (e.type === 'destroy') throw new Error('first destroy failure'); });
  m.subscribe(e => { if (e.type === 'destroy') second += 1; });
  assert.throws(() => m.destroy(), /first destroy failure/);
  assert.equal(second, 1);
  assert.equal(m.snapshot().destroyed, true);
  assert.throws(() => m.subscribe(() => {}), /INSTANCE_DESTROYED/);
  m.destroy();
  assert.equal(second, 1);
});
test('unsubscribe stops delivery', () => {
  const m = new ButtonStateMachine(true); let n = 0; const off = m.subscribe(() => n++); off(); m.down(1, 'mouse', 0, true); assert.equal(n, 0);
});
test('subscriber disable at release prevents activation', () => {
  const { machine: m, count } = setup(); m.subscribe(e => { if (e.type === 'state' && e.reason === 'pointerup') m.setEnabled(false); });
  m.down(1, 'mouse', 0, true); m.up(1, 'mouse', true); assert.equal(count(), 0);
});
