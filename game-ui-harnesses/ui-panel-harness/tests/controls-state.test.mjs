import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { controlId, choiceId, initialPanelState } from '../src/compiler.mjs';
import { attachPanelSession, projectPanelEvent } from '../src/state.mjs';

const base = JSON.parse(readFileSync(new URL('../examples/audio-settings.panel.json', import.meta.url), 'utf8'));
function fixture() {
  const spec = structuredClone(base);
  spec.panelSpecVersion = '0.3'; spec.assets = null;
  spec.state.push(
    { id: 'mode', type: 'enum', initial: 'auto', options: [{ id: 'auto', label: '自动' }, { id: 'stereo', label: '立体声' }] },
    { id: 'quality', type: 'enum', initial: 'auto', options: [{ id: 'auto', label: '自动' }, { id: 'high', label: '高质量' }] },
  );
  spec.sections[0].rows.push(
    { id: 'mode-row', kind: 'select', recipe: { id: 'settings.select', version: '0.1.0' }, label: '声音模式', bind: 'mode', enabled: true, event: 'audio.modeChanged' },
    { id: 'quality-row', kind: 'select', recipe: { id: 'settings.select', version: '0.1.0' }, label: '音频质量', bind: 'quality', enabled: true, event: 'audio.qualityChanged' },
    { id: 'reset-row', kind: 'button', recipe: { id: 'settings.button', version: '0.1.0' }, label: '默认设置', buttonLabel: '恢复默认', enabled: true, event: 'settings.reset', action: { kind: 'reset-initial', fields: ['volume', 'audioEnabled', 'mode', 'quality'] } },
    { id: 'apply-row', kind: 'button', recipe: { id: 'settings.button', version: '0.1.0' }, label: '应用设置', buttonLabel: '应用', enabled: true, event: 'settings.apply', action: { kind: 'emit' } },
  );
  return spec;
}
const saved = () => ({ volume: 25, audioEnabled: false, mode: 'stereo', quality: 'high' });
const rows = spec => spec.sections.flatMap(section => section.rows);
const row = (spec, id) => rows(spec).find(row => row.id === id);
const change = (spec, rowId, value, source = 'mouse') => ({ type: 'change', id: controlId(spec.id, rowId), value, source });
const activate = (spec, rowId = 'reset-row', source = 'keyboard') => ({ type: 'activate', id: controlId(spec.id, rowId), source });

// A synchronous TreePreview contract double. It performs no rendering or I/O;
// setValue deliberately emits control changes to exercise reentrant listeners.
function fakeRuntime(spec, state = initialPanelState(spec)) {
  const fields = new Map(spec.state.map(field => [field.id, field]));
  const nodes = rows(spec).map(row => {
    const props = { enabled: row.enabled }, field = fields.get(row.bind);
    let type;
    if (row.kind === 'button') { type = 'Button'; props.label = row.buttonLabel; }
    else if (row.kind === 'select') {
      type = 'Select'; props.options = field.options.map(option => ({ id: choiceId(spec.id, row.id, option.id), label: option.label }));
      props.selectedId = choiceId(spec.id, row.id, state[row.bind]);
    } else if (row.kind === 'slider') {
      type = 'Slider'; Object.assign(props, { min: field.min, max: field.max, step: field.step, value: state[row.bind] });
    } else { type = 'Switch'; props.checked = state[row.bind]; }
    return { id: controlId(spec.id, row.id), type, props };
  });
  const document = { schemaVersion: '0.2', id: spec.id, root: { id: `${spec.id}.canvas`, type: 'Container', children: nodes } };
  const listeners = new Set(), writes = [];
  let unsubscribeCalls = 0;
  const api = {
    writes, nodes,
    getDocument: () => structuredClone(document),
    subscribe(callback) { listeners.add(callback); return () => { unsubscribeCalls++; listeners.delete(callback); }; },
    emit(event) { for (const callback of [...listeners]) callback(event); },
    setValue(id, value) {
      const node = nodes.find(node => node.id === id);
      if (!node || node.type === 'Button') throw new Error('FAKE_UNSUPPORTED_VALUE');
      writes.push({ id, value });
      node.props[node.type === 'Select' ? 'selectedId' : node.type === 'Slider' ? 'value' : 'checked'] = value;
      api.emit({ id, type: 'change', source: 'control', value });
    },
    listenerCount: () => listeners.size,
    unsubscribeCalls: () => unsubscribeCalls,
  };
  return api;
}

test('Select projects compiled choice IDs to semantic values while retaining field event shape', () => {
  const spec = fixture(), state = initialPanelState(spec);
  const selected = choiceId(spec.id, 'mode-row', 'stereo');
  const result = projectPanelEvent(spec, state, change(spec, 'mode-row', selected));
  assert.equal(result.state.mode, 'stereo');
  assert.deepEqual(result.event, { name: 'audio.modeChanged', fieldId: 'mode', value: 'stereo', source: 'mouse' });
  assert.equal(projectPanelEvent(spec, state, change(spec, 'mode-row', selected, 'control')).event, null);
  assert.equal(projectPanelEvent(spec, result.state, change(spec, 'mode-row', selected)).event, null);
  assert.equal(state.mode, 'auto');
});

test('two enum fields may reuse local option IDs without accepting each other’s compiled IDs', () => {
  const spec = fixture(), state = initialPanelState(spec);
  assert.notEqual(choiceId(spec.id, 'mode-row', 'auto'), choiceId(spec.id, 'quality-row', 'auto'));
  for (const value of ['auto', null, 1, choiceId(spec.id, 'quality-row', 'auto'), choiceId(spec.id, 'mode-row', 'missing')]) {
    assert.throws(() => projectPanelEvent(spec, state, change(spec, 'mode-row', value)), /PANEL_CHOICE_VALUE/);
  }
  const mode = projectPanelEvent(spec, state, change(spec, 'mode-row', choiceId(spec.id, 'mode-row', 'stereo')));
  const quality = projectPanelEvent(spec, mode.state, change(spec, 'quality-row', choiceId(spec.id, 'quality-row', 'high')));
  assert.deepEqual(quality.state, { volume: 80, audioEnabled: true, mode: 'stereo', quality: 'high' });
});

test('disabled controls ignore user actions; control assignment updates choices but never activates buttons', () => {
  const spec = fixture(), state = saved();
  row(spec, 'mode-row').enabled = false; row(spec, 'reset-row').enabled = false;
  assert.deepEqual(projectPanelEvent(spec, state, change(spec, 'mode-row', 'invalid')), { state, event: null });
  assert.deepEqual(projectPanelEvent(spec, state, activate(spec)), { state, event: null });
  const assigned = projectPanelEvent(spec, state, change(spec, 'mode-row', choiceId(spec.id, 'mode-row', 'auto'), 'control'));
  assert.equal(assigned.state.mode, 'auto'); assert.equal(assigned.event, null);
  row(spec, 'reset-row').enabled = true;
  assert.deepEqual(projectPanelEvent(spec, state, activate(spec, 'reset-row', 'control')), { state, event: null });
  assert.throws(() => projectPanelEvent(spec, state, activate(spec, 'reset-row', 'network')), /PANEL_EVENT_SOURCE/);
});

test('reset projection uses only declared initial values and emits one explicit action snapshot', () => {
  const spec = fixture(), before = saved();
  const result = projectPanelEvent(spec, before, { ...activate(spec), value: { volume: 999 } });
  assert.deepEqual(result.state, initialPanelState(spec));
  assert.deepEqual(result.event, { name: 'settings.reset', rowId: 'reset-row', action: 'reset-initial', state: initialPanelState(spec), source: 'keyboard' });
  assert.deepEqual(before, saved());
  result.event.state.volume = 1;
  assert.equal(result.state.volume, 80, 'callback payload must not alias internal state');
});

test('reset can target a subset and emit buttons preserve state without invented field events', () => {
  const spec = fixture(), before = saved();
  row(spec, 'reset-row').action.fields = ['volume', 'mode'];
  const result = projectPanelEvent(spec, before, activate(spec));
  assert.deepEqual(result.state, { volume: 80, audioEnabled: false, mode: 'auto', quality: 'high' });
  const emitted = projectPanelEvent(spec, before, activate(spec, 'apply-row', 'touch'));
  assert.deepEqual(emitted, { state: before, event: { name: 'settings.apply', rowId: 'apply-row', action: 'emit', state: before, source: 'touch' } });
  assert.equal(projectPanelEvent(spec, before, change(spec, 'apply-row', true)).event, null);
  assert.equal(projectPanelEvent(spec, before, activate(spec, 'mode-row')).event, null);
  assert.equal(projectPanelEvent(spec, before, { type: 'press', id: controlId(spec.id, 'reset-row') }).event, null);
});

test('session hydrates saved enum values then resets to authored defaults, not the loaded snapshot', () => {
  const spec = fixture(), runtime = fakeRuntime(spec, saved()), events = [];
  const session = attachPanelSession(spec, runtime, event => events.push(event));
  assert.deepEqual(session.getState(), saved()); assert.equal(events.length, 0); assert.equal(runtime.writes.length, 0);
  runtime.emit(activate(spec));
  assert.deepEqual(session.getState(), initialPanelState(spec));
  assert.equal(events.length, 1); assert.equal(events[0].action, 'reset-initial');
  assert.deepEqual(runtime.writes, [
    { id: controlId(spec.id, 'volume-row'), value: 80 },
    { id: controlId(spec.id, 'audio-enabled-row'), value: true },
    { id: controlId(spec.id, 'mode-row'), value: choiceId(spec.id, 'mode-row', 'auto') },
    { id: controlId(spec.id, 'quality-row'), value: choiceId(spec.id, 'quality-row', 'auto') },
  ]);
  runtime.emit(activate(spec));
  assert.equal(events.length, 2, 'a second activation still has an action event');
  assert.equal(runtime.writes.length, 4, 'unchanged fields need no renderer assignment');
  session.destroy();
});

test('subset reset and public setState share validated writes while suppressing control reentry', () => {
  const spec = fixture(); row(spec, 'reset-row').action.fields = ['mode'];
  const runtime = fakeRuntime(spec, saved()), events = [], session = attachPanelSession(spec, runtime, event => events.push(event));
  runtime.emit(activate(spec));
  assert.deepEqual(session.getState(), { ...saved(), mode: 'auto' });
  assert.equal(runtime.writes.length, 1); assert.equal(events.length, 1);
  session.setState({ ...saved(), quality: 'auto' });
  assert.equal(events.length, 1); assert.equal(runtime.writes.length, 3);
  const writesBefore = runtime.writes.length;
  assert.throws(() => session.setState({ ...saved(), mode: 'invalid' }));
  assert.equal(runtime.writes.length, writesBefore); assert.equal(runtime.listenerCount(), 1);
  runtime.emit(activate(spec, 'apply-row'));
  assert.equal(runtime.writes.length, writesBefore); assert.equal(events.length, 2);
  assert.equal(events[1].action, 'emit'); session.destroy();
});

test('hydrate rejects mismatched option IDs, labels, order, selection, button labels and enabled flags', () => {
  const spec = fixture();
  const edits = [
    runtime => { runtime.nodes[2].props.options[0].id = 'auto'; },
    runtime => { runtime.nodes[2].props.options[0].label = 'wrong'; },
    runtime => { runtime.nodes[2].props.options.reverse(); },
    runtime => { runtime.nodes[2].props.options.pop(); },
    runtime => { runtime.nodes[2].props.selectedId = 'auto'; },
    runtime => { runtime.nodes[2].props.selectedId = choiceId(spec.id, 'quality-row', 'auto'); },
    runtime => { runtime.nodes[2].props.enabled = false; },
    runtime => { runtime.nodes[4].props.label = 'Delete everything'; },
    runtime => { runtime.nodes[4].props.enabled = false; },
    runtime => { runtime.nodes[4].type = 'Switch'; },
  ];
  for (const edit of edits) {
    const runtime = fakeRuntime(spec); edit(runtime);
    assert.throws(() => attachPanelSession(spec, runtime, () => {}), /PANEL_RUNTIME_MISMATCH/);
    assert.equal(runtime.listenerCount(), 0);
  }
});

test('failed renderer writes terminate reset without emitting a success or partial field events', () => {
  const spec = fixture(), runtime = fakeRuntime(spec, saved()), events = [];
  const originalWrite = runtime.setValue;
  runtime.setValue = (id, value) => {
    if (id === controlId(spec.id, 'audio-enabled-row')) throw new Error('renderer rejected second reset write');
    originalWrite(id, value);
  };
  const session = attachPanelSession(spec, runtime, event => events.push(event));
  assert.throws(() => runtime.emit(activate(spec)), /renderer rejected/);
  assert.equal(runtime.writes.length, 1, 'first renderer write may already have happened');
  assert.equal(events.length, 0); assert.equal(runtime.listenerCount(), 0);
  assert.throws(() => session.getState(), /PANEL_SESSION_DESTROYED/);
  session.destroy(); assert.equal(runtime.unsubscribeCalls(), 1);
});

test('renderer destruction during reset is handled even while control events are suppressed', () => {
  const spec = fixture(), runtime = fakeRuntime(spec, saved()), events = [];
  runtime.setValue = id => runtime.emit({ type: 'destroy', id });
  const session = attachPanelSession(spec, runtime, event => events.push(event));
  assert.throws(() => runtime.emit(activate(spec)), /PANEL_SESSION_DESTROYED/);
  assert.equal(events.length, 0); assert.equal(runtime.listenerCount(), 0);
  assert.throws(() => session.setState(saved()), /PANEL_SESSION_DESTROYED/);
});

test('callback payload mutations cannot corrupt session state; callback errors propagate after state commit', () => {
  const spec = fixture(), runtime = fakeRuntime(spec, saved());
  const session = attachPanelSession(spec, runtime, event => {
    event.state.volume = 1;
    throw new Error('host callback failed');
  });
  assert.throws(() => runtime.emit(activate(spec)), /host callback failed/);
  assert.deepEqual(session.getState(), initialPanelState(spec));
  assert.equal(runtime.listenerCount(), 1);
  session.destroy();
});

test('callback may explicitly assign host state after reset without generating feedback callbacks', () => {
  const spec = fixture(), runtime = fakeRuntime(spec, saved());
  let count = 0, session;
  session = attachPanelSession(spec, runtime, () => { count++; session.setState({ ...initialPanelState(spec), volume: 35 }); });
  runtime.emit(activate(spec));
  assert.equal(count, 1); assert.equal(session.getState().volume, 35);
  session.destroy();
});

test('destroy and unsubscribe are idempotent, including synchronous destroy while attaching', () => {
  const spec = fixture(), runtime = fakeRuntime(spec);
  const session = attachPanelSession(spec, runtime, () => {});
  runtime.emit({ type: 'destroy', id: controlId(spec.id, 'mode-row') });
  session.destroy(); session.destroy();
  assert.equal(runtime.listenerCount(), 0); assert.equal(runtime.unsubscribeCalls(), 1);
  const earlyRuntime = fakeRuntime(spec), subscribe = earlyRuntime.subscribe;
  earlyRuntime.subscribe = callback => {
    const detach = subscribe(callback);
    callback({ type: 'destroy', id: controlId(spec.id, 'mode-row') });
    return detach;
  };
  const earlySession = attachPanelSession(spec, earlyRuntime, () => {});
  assert.equal(earlyRuntime.listenerCount(), 0); assert.equal(earlyRuntime.unsubscribeCalls(), 1);
  assert.throws(() => earlySession.getState(), /PANEL_SESSION_DESTROYED/);
});
