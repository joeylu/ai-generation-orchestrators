import test from 'node:test';
import assert from 'node:assert/strict';
import { attachLayoutSession } from '../src/layout-session.mjs';

const spec = { panelSpecVersion: '0.4', id: 'panel' };
function fakeRuntime() {
  let scroll = 0, opened = false;
  const listeners = new Set(), writes = [], closes = [];
  const body = { id: 'panel.body', type: 'ScrollView', layout: { height: 200 }, props: { contentHeight: 600 } };
  const api = {
    getDocument: () => ({ root: { id: 'panel.canvas', children: [body] } }),
    inspect: () => ({ nodes: [
      { id: 'panel.body', type: 'ScrollView', visible: true, bounds: { x: 20, y: 100, width: 400, height: 200 }, value: { x: 0, y: scroll } },
      { id: 'panel.row.last', type: 'Container', visible: true, bounds: { x: 20, y: 430 - scroll, width: 400, height: 56 } },
      { id: 'panel.row.last.control', type: 'Select', visible: true, popupOpen: opened, bounds: { x: 140, y: 438 - scroll, width: 240, height: 40 } },
      { id: 'panel.row.first', type: 'Container', visible: true, bounds: { x: 20, y: 120 - scroll, width: 400, height: 56 } },
      { id: 'panel.row.first.control', type: 'Slider', visible: true, bounds: { x: 140, y: 120 - scroll, width: 160, height: 56 } },
    ] }),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit(event) { for (const listener of [...listeners]) listener(event); },
    setValue(id, value) { scroll = value.y; writes.push({ id, value }); api.emit({ id, type: 'scroll', source: 'control' }); },
    setSelectOpen(id, value) { opened = value; closes.push(id); api.emit({ id, type: value ? 'open' : 'close', source: 'control' }); },
    open() { opened = true; api.emit({ id: 'panel.row.last.control', type: 'open', source: 'control' }); },
    scrollTo(y, source = 'wheel') { scroll = y; api.emit({ id: 'panel.body', type: 'scroll', source }); },
    writes, closes, listenerCount: () => listeners.size,
  };
  return api;
}

test('keyboard focus reveals a complete row in both directions and leaves already-visible rows still', () => {
  const runtime = fakeRuntime(), session = attachLayoutSession(spec, runtime);
  runtime.emit({ id: 'panel.row.last.control', type: 'focus', source: 'keyboard' });
  assert.deepEqual(runtime.writes, [{ id: 'panel.body', value: { x: 0, y: 186 } }]);
  runtime.emit({ id: 'panel.row.last.control', type: 'focus', source: 'keyboard' });
  assert.equal(runtime.writes.length, 1);
  runtime.emit({ id: 'panel.row.first.control', type: 'focus', source: 'keyboard' });
  assert.equal(runtime.writes.at(-1).value.y, 20);
  session.destroy(); session.destroy(); assert.equal(runtime.listenerCount(), 0);
});

test('opening a partly clipped Select reveals its row without recursively closing the popup', () => {
  const runtime = fakeRuntime(); attachLayoutSession(spec, runtime);
  runtime.open();
  assert.equal(runtime.writes.at(-1).value.y, 186);
  assert.deepEqual(runtime.closes, []);
  assert.equal(runtime.inspect().nodes.find(node => node.type === 'Select').popupOpen, true);
});

test('wheel, keyboard or external programmatic scroll close open menus but not business controls', () => {
  const runtime = fakeRuntime(); attachLayoutSession(spec, runtime);
  for (const source of ['wheel', 'keyboard', 'control', 'mouse']) {
    runtime.open(); runtime.scrollTo(100, source);
  }
  assert.equal(runtime.closes.length, 4);
  assert.ok(runtime.closes.every(id => id === 'panel.row.last.control'));
});

test('irrelevant events and legacy/non-scroll panels add no viewport effects', () => {
  assert.doesNotThrow(() => attachLayoutSession({ panelSpecVersion: '0.3' }, null).destroy());
  const runtime = fakeRuntime(), session = attachLayoutSession(spec, runtime);
  for (const event of [{ id: 'unknown', type: 'focus', source: 'keyboard' }, { id: 'panel.row.last.control', type: 'change', source: 'keyboard' }, { id: 'panel.row.last.control', type: 'focus', source: 'mouse' }]) runtime.emit(event);
  assert.deepEqual(runtime.writes, []); session.destroy();
  runtime.getDocument = () => ({ root: { id: 'panel.canvas', children: [] } });
  attachLayoutSession(spec, runtime).destroy(); assert.equal(runtime.listenerCount(), 0);
});

test('runtime teardown detaches and a synchronous subscription teardown cannot leak its listener', () => {
  const runtime = fakeRuntime(); attachLayoutSession(spec, runtime);
  runtime.emit({ type: 'destroy' }); assert.equal(runtime.listenerCount(), 0);
  let detached = 0;
  runtime.subscribe = listener => { listener({ type: 'destroy' }); return () => { detached += 1; }; };
  attachLayoutSession(spec, runtime).destroy(); assert.equal(detached, 1);
});

test('incomplete runtime contracts reject before attaching', () => {
  assert.throws(() => attachLayoutSession(spec, {}), /PANEL_LAYOUT_RUNTIME_REQUIRED/);
});
