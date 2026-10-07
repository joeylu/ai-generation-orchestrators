import test from 'node:test';
import assert from 'node:assert/strict';
import { core, fixture, catalog, copy, nodesOf } from './helpers.mjs';
import { compilePanel, controlId, initialPanelState } from '../src/compiler.mjs';
import { projectPanelEvent, attachPanelSession } from '../src/state.mjs';

const volumeId = controlId(fixture.id, fixture.sections[0].rows[0].id);
const switchId = controlId(fixture.id, fixture.sections[0].rows[1].id);
const event = (id, value, source = 'mouse') => ({ id, value, source, type: 'change' });

test('committed input has explicit business port and disabled audio keeps the independent volume', () => {
  const initial = initialPanelState(fixture);
  const off = projectPanelEvent(fixture, initial, event(switchId, false));
  assert.deepEqual(off.state, { volume: 80, audioEnabled: false });
  const volume = projectPanelEvent(fixture, off.state, event(volumeId, 45));
  assert.deepEqual(volume.state, { volume: 45, audioEnabled: false });
  assert.deepEqual(volume.event, { name: 'audio.volumeChanged', fieldId: 'volume', value: 45, source: 'mouse' });
  assert.deepEqual(initial, { volume: 80, audioEnabled: true });
});

test('programmatic values update state without user callbacks; redundant or unrelated events do nothing', () => {
  const state = initialPanelState(fixture);
  assert.equal(projectPanelEvent(fixture, state, event(volumeId, 70, 'control')).event, null);
  assert.equal(projectPanelEvent(fixture, state, event(volumeId, 80)).event, null);
  assert.deepEqual(projectPanelEvent(fixture, state, event('foreign', 9)), { state, event: null });
  assert.deepEqual(projectPanelEvent(fixture, state, { type: 'focus', id: volumeId }), { state, event: null });
});

test('bad source/value, out-of-range values and disabled user edits cannot become host actions', () => {
  const state = initialPanelState(fixture);
  for (const value of [-1, 101, NaN, 0.5, '80']) assert.throws(() => projectPanelEvent(fixture, state, event(volumeId, value)));
  assert.throws(() => projectPanelEvent(fixture, state, event(volumeId, 70, 'network')));
  const disabled = copy(fixture); disabled.sections[0].rows[0].enabled = false;
  assert.deepEqual(projectPanelEvent(disabled, state, event(volumeId, 70)), { state, event: null });
});

function fakeRuntime(spec = fixture, savedState) {
  const document = compilePanel(spec, catalog, core, savedState).document, listeners = new Set();
  const api = {
    getDocument: () => copy(document),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit(input) { for (const fn of [...listeners]) fn(input); },
    setValue(id, value) {
      const node = nodesOf(document).find(n => n.id === id);
      node.props[node.type === 'Slider' ? 'value' : 'checked'] = value;
      api.emit(event(id, value, 'control'));
    },
    listenerCount: () => listeners.size,
  }; return api;
}

test('session hydrates existing saved controls without firing callbacks and suppresses host feedback loops', () => {
  const runtime = fakeRuntime(fixture, { volume: 35, audioEnabled: false }), emitted = [];
  const session = attachPanelSession(fixture, runtime, value => emitted.push(value));
  assert.deepEqual(session.getState(), { volume: 35, audioEnabled: false }); assert.deepEqual(emitted, []);
  session.setState({ volume: 90, audioEnabled: true });
  assert.deepEqual(session.getState(), { volume: 90, audioEnabled: true }); assert.deepEqual(emitted, []);
  runtime.emit(event(volumeId, 50, 'keyboard'));
  assert.equal(session.getState().volume, 50); assert.equal(emitted.length, 1);
  const snapshot = session.getState(); snapshot.volume = 1; assert.equal(session.getState().volume, 50);
  session.destroy(); session.destroy(); assert.equal(runtime.listenerCount(), 0);
  assert.throws(() => session.getState(), /DESTROYED/);
});

test('state validation precedes runtime writes; renderer failure terminates session', () => {
  const runtime = fakeRuntime(), session = attachPanelSession(fixture, runtime, () => {});
  assert.throws(() => session.setState({ volume: 101, audioEnabled: false }));
  assert.equal(session.getState().volume, 80);
  runtime.setValue = () => { throw new Error('renderer rejected update'); };
  assert.throws(() => session.setState({ volume: 45, audioEnabled: false }), /renderer/);
  assert.equal(runtime.listenerCount(), 0); assert.throws(() => session.getState(), /DESTROYED/);
});

test('attach rejects the wrong document or contract and destroy detaches listeners', () => {
  const wrong = fakeRuntime(); wrong.getDocument = () => ({ id: 'foreign' });
  assert.throws(() => attachPanelSession(fixture, wrong, () => {}), /MISMATCH/);
  const runtime = fakeRuntime(); const session = attachPanelSession(fixture, runtime, () => {});
  runtime.emit({ type: 'destroy', id: volumeId });
  assert.equal(runtime.listenerCount(), 0); assert.throws(() => session.getState(), /DESTROYED/);
});
