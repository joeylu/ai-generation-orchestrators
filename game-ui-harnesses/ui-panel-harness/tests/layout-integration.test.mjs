import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { core, copy, nodesOf } from './helpers.mjs';
import { compilePanel, controlId, initialPanelState, FLOW_PANEL_COMPILER_VERSION, LEGACY_FLOW_PANEL_COMPILER_VERSION } from '../src/compiler.mjs';
import { createPanelBundle, validatePanelBundle } from '../src/panel-bundle.mjs';
import { projectPanelEvent, attachPanelSession } from '../src/state.mjs';
import { createWorkbenchModel } from '../src/workbench-model.mjs';
import { digestJson } from '../src/canonical.mjs';
const json = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const catalog = await json('../examples/modern-mint-layout.catalog.json');
const settings = await json('../examples/layout-v1/settings.panel.json');
const compact = await json('../examples/layout-v1/settings-compact.panel.json');
const pause = await json('../examples/layout-v1/pause.panel.json');
const character = await json('../examples/layout-v1/character.panel.json');

test('all four layout fixtures lower through the actual component contract deterministically', () => {
  for (const spec of [settings, compact, pause, character]) {
    const a = compilePanel(spec, catalog, core), b = compilePanel(copy(spec), copy(catalog), core);
    assert.deepEqual(a, b); assert.deepEqual(core.validateDocument(a.document), a.document);
    assert.equal(Object.keys(a.policy.layout).length, nodesOf(a.document).length);
    assert.equal(a.actions.length, spec.sections.flatMap(section => section.rows).filter(row => row.kind === 'button').length);
    assert.equal(a.bindings.length, spec.state.length);
  }
});

test('a declared narrow canvas recomputes the same grid into one column without changing business definitions', () => {
  const smaller = copy(settings); smaller.canvas = { width: 400, height: 640 };
  const wide = compilePanel(settings, catalog, core), narrow = compilePanel(smaller, catalog, core);
  const boxes = compiled => nodesOf(compiled.document).filter(node => node.id.startsWith(`${settings.id}.section.`) && node.type === 'Container');
  const [left, right] = boxes(wide), [top, bottom] = boxes(narrow);
  assert.equal(left.layout.y, right.layout.y); assert(right.layout.x >= left.layout.x + left.layout.width);
  assert.equal(top.layout.x, bottom.layout.x); assert(bottom.layout.y >= top.layout.y + top.layout.height);
  assert.deepEqual(wide.bindings, narrow.bindings); assert.deepEqual(wide.actions, narrow.actions);
  assert.deepEqual(smaller.state, settings.state); assert.deepEqual(smaller.sections, settings.sections);
  for (const compiled of [wide, narrow]) {
    const scroller = nodesOf(compiled.document).find(node => node.type === 'ScrollView'); assert(scroller);
    assert(scroller.props.contentHeight > scroller.layout.height);
    for (const section of scroller.children) assert(section.layout.y + section.layout.height <= scroller.props.contentHeight);
  }
});

test('layout bundle version 0.4 round-trips and rejects forged compiler and authored geometry', async () => {
  const bundle = await createPanelBundle(settings, catalog, core);
  assert.equal(bundle.panelBundleVersion, '0.4'); assert.equal(bundle.compilerVersion, FLOW_PANEL_COMPILER_VERSION);
  assert.equal(bundle.capabilities.layout, 'flow-containers-v1'); assert.equal(bundle.capabilities.sessionRequired, true);
  assert.deepEqual(await validatePanelBundle(bundle, core), bundle);
  const wrong = copy(bundle); wrong.compilerVersion = '0.3.0';
  await assert.rejects(validatePanelBundle(wrong, core), /PANEL_BUNDLE_VERSION/);
  const changed = copy(bundle); changed.spec.layout.body.gap += 1;
  const { sha256, ...payload } = changed; changed.sha256 = await digestJson(payload);
  await assert.rejects(validatePanelBundle(changed, core), /PANEL_BUNDLE_MISMATCH/);
});

test('stateless full-width menu buttons emit without introducing hidden state', () => {
  const compiled = compilePanel(pause, catalog, core), row = pause.sections[0].rows[0];
  assert.deepEqual(compiled.state, {}); assert.deepEqual(compiled.bindings, []);
  const control = nodesOf(compiled.document).find(node => node.id === controlId(pause.id, row.id));
  const section = nodesOf(compiled.document).find(node => node.id === `${pause.id}.section.${pause.sections[0].id}`);
  assert.equal(section.children.includes(control), true);
  assert.equal(control.layout.width, section.layout.width - 24);
  const result = projectPanelEvent(pause, {}, { id: control.id, type: 'activate', source: 'keyboard' });
  assert.deepEqual(result.state, {}); assert.equal(result.event.name, row.event); assert.equal(result.event.action, 'emit');
});

test('standalone button rows lose only their painted wrapper, preserving control bounds and action bindings', () => {
  const old = compilePanel(settings, catalog, core, undefined, undefined, LEGACY_FLOW_PANEL_COMPILER_VERSION);
  const current = compilePanel(settings, catalog, core);
  const bounds = document => {
    const result = new Map();
    const visit = (node, x = 0, y = 0) => {
      const box = { ...node.layout, x: x + node.layout.x, y: y + node.layout.y }; result.set(node.id, box);
      for (const child of node.children ?? []) visit(child, box.x, box.y);
    }; visit(document.root); return result;
  };
  const oldBoxes = bounds(old.document), newBoxes = bounds(current.document), oldNodes = nodesOf(old.document), nodes = nodesOf(current.document);
  for (const section of settings.sections) for (const row of section.rows) {
    assert.deepEqual(newBoxes.get(controlId(settings.id, row.id)), oldBoxes.get(controlId(settings.id, row.id)));
    const rowId = `${settings.id}.row.${row.id}`;
    if (row.kind === 'button' && row.label === '') {
      assert.equal(oldNodes.find(node => node.id === rowId).props.style.backgroundColor, catalog.themes[0].tokens.control);
      assert.equal(nodes.some(node => node.id === rowId), false);
      const parent = nodes.find(node => node.id === `${settings.id}.section.${section.id}`);
      assert(parent.children.some(node => node.id === controlId(settings.id, row.id)));
    } else assert.deepEqual(nodes.find(node => node.id === rowId), oldNodes.find(node => node.id === rowId));
  }
  assert.deepEqual(current.state, old.state); assert.deepEqual(current.bindings, old.bindings); assert.deepEqual(current.actions, old.actions);
  const reset = settings.sections.flatMap(section => section.rows).find(row => row.kind === 'button' && row.action.kind === 'reset-initial');
  const played = { ...initialPanelState(settings), volume: 21, soundEnabled: false };
  const projected = projectPanelEvent(settings, played, { id: controlId(settings.id, reset.id), type: 'activate', source: 'keyboard' });
  for (const field of reset.action.fields) assert.equal(projected.state[field], settings.state.find(item => item.id === field).initial);
});

test('legacy flow bundles keep exact recompilation while new compiler versions cannot disguise old geometry', async () => {
  const old = await createPanelBundle(settings, catalog, core, undefined, undefined, LEGACY_FLOW_PANEL_COMPILER_VERSION);
  assert.deepEqual(await validatePanelBundle(old, core), old);
  const current = await createPanelBundle(settings, catalog, core); assert.notEqual(current.sha256, old.sha256);
  assert.deepEqual(await validatePanelBundle(current, core), current);
  const relabeled = { ...old, compilerVersion: FLOW_PANEL_COMPILER_VERSION };
  const { sha256, ...payload } = relabeled; relabeled.sha256 = await digestJson(payload);
  await assert.rejects(validatePanelBundle(relabeled, core), /PANEL_BUNDLE_MISMATCH/);
  await assert.rejects(createPanelBundle(settings, catalog, core, undefined, undefined, '0.4.2'), { code: 'COMPILER_VERSION' });
  const labeled = copy(settings), button = labeled.sections.flatMap(section => section.rows).find(row => row.kind === 'button');
  button.label = '操作';
  const compiled = compilePanel(labeled, catalog, core);
  assert.equal(nodesOf(compiled.document).find(node => node.id === `${settings.id}.row.${button.id}`).type, 'Container');
});

test('full-width icon buttons do not require unused label space, while labeled controls still do', () => {
  const spec = copy(pause), row = spec.sections[0].rows[0], key = 'test-kit/speaker@1.0.0';
  spec.layout.labelWidth = 48;
  spec.assets = { library: { id: 'test-library', sha256: 'a'.repeat(64) }, panelSurface: null, rowIcons: [{ rowId: row.id, asset: key }] };
  // Metadata fixture tests pure geometry, not image decoding or visual quality.
  const closure = { assetClosureVersion: '0.1', library: copy(spec.assets.library), records: [
    { key, role: 'icon', width: 24, height: 24, slice: null, sha256: 'b'.repeat(64), bytes: 45 },
  ] };
  const document = compilePanel(spec, catalog, core, undefined, closure).document;
  const button = nodesOf(document).find(node => node.id === controlId(spec.id, row.id));
  assert.equal(button.layout.x, 52);
  row.label = '操作';
  assert.throws(() => compilePanel(spec, catalog, core, undefined, closure), { code: 'ICON_GEOMETRY' });
});

test('read-only text participates in runtime validation without creating state or accepting change events', () => {
  const document = compilePanel(character, catalog, core).document, listeners = new Set(), events = [];
  const runtime = { getDocument: () => copy(document), setValue() { throw new Error('UNEXPECTED_WRITE'); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
  const session = attachPanelSession(character, runtime, event => events.push(event));
  assert.deepEqual(session.getState(), initialPanelState(character));
  const row = character.sections.flatMap(section => section.rows).find(row => row.kind === 'text');
  assert.deepEqual(projectPanelEvent(character, session.getState(), { type: 'change', source: 'control', id: controlId(character.id, row.id), value: 'forged' }), { state: session.getState(), event: null });
  assert.deepEqual(events, []); session.destroy(); assert.equal(listeners.size, 0);
  const node = nodesOf(document).find(node => node.id === controlId(character.id, row.id)); node.props.text = 'forged';
  assert.throws(() => attachPanelSession(character, runtime, () => {}), /PANEL_RUNTIME_MISMATCH/);
});

test('layout edits preserve current values and undo; too narrow controls reject atomically', async () => {
  const model = await createWorkbenchModel({ catalog, pool: null }, core);
  await model.importPanel(await createPanelBundle(settings, catalog, core));
  const before = model.getSnapshot(), live = { ...before.panel.state, volume: 21 };
  const layout = copy(settings.layout); layout.body.kind = 'column'; delete layout.body.minColumnWidth;
  await model.patch({ patchVersion: '0.1', baseSpecSha256: await digestJson(settings), reason: 'Explicit geometry regression fixture', operations: [{ op: 'set-layout', layout }] }, live);
  assert.deepEqual(model.getSnapshot().panel.state, live);
  const restored = await model.undo(); assert.deepEqual(restored.panel.spec, settings); assert.deepEqual(restored.panel.state, live);
  const bad = copy(settings.layout); bad.width = 200;
  await assert.rejects(model.patch({ patchVersion: '0.1', baseSpecSha256: await digestJson(settings), reason: 'Invalid narrow fixture', operations: [{ op: 'set-layout', layout: bad }] }, live));
  assert.deepEqual(model.getSnapshot(), restored);
});
