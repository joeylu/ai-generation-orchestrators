import test from 'node:test';
import assert from 'node:assert/strict';
import { core, fixture, catalog, copy, freeze, nodesOf } from './helpers.mjs';
import { compilePanel, controlId } from '../src/compiler.mjs';

test('deterministic lowering preserves frozen authored inputs and produces a strictly valid component document', () => {
  const spec = freeze(copy(fixture)), library = freeze(copy(catalog));
  const a = compilePanel(spec, library, core), b = compilePanel(spec, library, core);
  assert.deepEqual(a, b); assert.deepEqual(spec, fixture); assert.deepEqual(library, catalog);
  assert.deepEqual(core.validateDocument(a.document), a.document);
  assert.deepEqual(Object.keys(a.policy.layout).sort(), nodesOf(a.document).map(n => n.id).sort());
  assert.equal(a.document.valueTextBindings.bindings[0].sourceId, controlId(spec.id, spec.sections[0].rows[0].id));
  assert.deepEqual(a.state, { volume: 80, audioEnabled: true });
  assert.equal(a.bindings.length, 2);
});

test('layout centers the panel and keeps each generated rectangle within its parent', () => {
  const { document } = compilePanel(fixture, catalog, core);
  const visit = parent => { for (const child of parent.children ?? []) {
    assert.ok(child.layout.x >= 0 && child.layout.y >= 0, child.id);
    assert.ok(child.layout.x + child.layout.width <= parent.layout.width, child.id);
    assert.ok(child.layout.y + child.layout.height <= parent.layout.height, child.id);
    visit(child);
  } }; visit(document.root);
  const panel = document.root.children[0];
  assert.equal(panel.layout.x * 2 + panel.layout.width, fixture.canvas.width);
  assert.equal(panel.layout.y * 2 + panel.layout.height, fixture.canvas.height);
});

test('state hydration changes values and derived initial text without mutating the authored initial state', () => {
  assert.throws(() => compilePanel(fixture, catalog, core, null));
  const { document } = compilePanel(fixture, catalog, core, { volume: 35, audioEnabled: false });
  const nodes = nodesOf(document);
  assert.equal(nodes.find(n => n.type === 'Slider').props.value, 35);
  assert.equal(nodes.find(n => n.type === 'Switch').props.checked, false);
  assert.equal(nodes.find(n => n.id.endsWith('.value')).props.text, '35%');
  assert.equal(fixture.state[0].initial, 80);
});

test('editing labels or moving a row does not change its binding identity', () => {
  const spec = copy(fixture); spec.sections[0].rows.reverse(); spec.sections[0].title = 'Audio';
  const original = compilePanel(fixture, catalog, core), changed = compilePanel(spec, catalog, core);
  assert.deepEqual(original.bindings.map(b => b.nodeId).sort(), changed.bindings.map(b => b.nodeId).sort());
});

test('missing recipes, versions and mismatched kinds fail instead of choosing a substitute', () => {
  for (const change of [
    s => { s.sections[0].rows[0].recipe.id = 'missing.slider'; },
    s => { s.theme.version = '9.9.9'; },
    s => { s.sections[0].rows[0].recipe.id = 'settings.switch'; },
  ]) { const spec = copy(fixture); change(spec); assert.throws(() => compilePanel(spec, catalog, core)); }
});

test('canvas overflow and insufficient control/text slots fail before any bundle exists', () => {
  for (const change of [
    s => { s.canvas.height = 100; },
    s => { s.layout.labelWidth = s.layout.width; },
    s => { s.layout.titleHeight = 1; },
    s => { s.layout.width = s.canvas.width + 1; },
  ]) { const spec = copy(fixture); change(spec); assert.throws(() => compilePanel(spec, catalog, core)); }
});

test('compiled style comes from exact theme tokens, with no dependency on MUIP or file resources', () => {
  const changed = copy(catalog); changed.themes[0].tokens.accent = '#FF55AA';
  const result = compilePanel(fixture, changed, core);
  assert.equal(nodesOf(result.document).find(n => n.type === 'Slider').props.style.borderColor, '#FF55AA');
  assert.equal(result.selection.recipes.length, 4);
  assert.equal(JSON.stringify(result).includes('MUIP'), false);
});
