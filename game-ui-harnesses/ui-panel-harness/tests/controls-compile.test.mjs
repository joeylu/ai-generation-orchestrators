import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { core, fixture, catalog, copy, nodesOf, freeze } from './helpers.mjs';
import { validatePanelSpec, validatePanelState } from '../src/spec.mjs';
import { compilePanel, choiceId, controlId, initialPanelState } from '../src/compiler.mjs';
import { createPanelBundle, validatePanelBundle, panelBundleAssetInputs } from '../src/panel-bundle.mjs';
import { digestJson, digestBytes } from '../src/canonical.mjs';

const controlsCatalog = copy(catalog);
for (const kind of ['select', 'button']) controlsCatalog.recipes.push({ id: `test.${kind}`, version: '1.0.0', kind: `${kind}-row`,
  description: `Deterministic ${kind} compile fixture`, tags: [kind], states: ['idle', 'hover', 'disabled'],
  supports: ['pixi'], minWidth: 280, minHeight: 40 });
function controlsSpec() {
  const spec = copy(fixture); spec.panelSpecVersion = '0.3'; spec.assets = null;
  spec.state.push({ id: 'quality', type: 'enum', initial: 'high', options: [{ id: 'low', label: '低' }, { id: 'high', label: '高' }] });
  spec.sections[0].rows.unshift({ id: 'quality-row', kind: 'select', recipe: { id: 'test.select', version: '1.0.0' },
    label: '画质', bind: 'quality', enabled: true, event: 'settings.qualityChanged' });
  spec.sections[0].rows.push({ id: 'reset-row', kind: 'button', recipe: { id: 'test.button', version: '1.0.0' },
    label: '恢复默认', buttonLabel: '重置设置', enabled: true, event: 'settings.reset',
    action: { kind: 'reset-initial', fields: ['volume', 'audioEnabled', 'quality'] } });
  return spec;
}
const quality = spec => spec.state.find(field => field.id === 'quality');
const selectRow = spec => spec.sections[0].rows.find(row => row.kind === 'select');
const buttonRow = spec => spec.sections[0].rows.find(row => row.kind === 'button');
const compile = (spec, state, assets) => compilePanel(spec, controlsCatalog, core, state, assets);
const node = (document, id) => nodesOf(document).find(item => item.id === id);
function globalY(document, id) {
  const visit = (current, y) => {
    const actual = y + current.layout.y;
    if (current.id === id) return actual;
    for (const child of current.children ?? []) { const result = visit(child, actual); if (result !== undefined) return result; }
  };
  return visit(document.root, 0);
}

test('PanelSpec 0.3 requires explicit assets and enum choices; 0.1 and 0.2 do not accept new state or row kinds', () => {
  const spec = controlsSpec();
  assert.deepEqual(validatePanelSpec(spec), spec);
  const missing = copy(spec); delete missing.assets;
  assert.throws(() => validatePanelSpec(missing), { code: 'required', path: '$.assets' });
  const old = copy(spec); old.panelSpecVersion = '0.1'; delete old.assets;
  assert.throws(() => validatePanelSpec(old), { code: 'state-type' });
  const oldAssets = copy(spec); oldAssets.panelSpecVersion = '0.2';
  assert.throws(() => validatePanelSpec(oldAssets), { code: 'state-type' });
  const oldButton = copy(fixture); oldButton.sections[0].rows.push(buttonRow(spec));
  assert.throws(() => validatePanelSpec(oldButton), { code: 'row-kind' });
});

test('enum initial values and state snapshots use option IDs, with strict bounded unique choice definitions', () => {
  const spec = controlsSpec();
  assert.deepEqual(initialPanelState(spec), { volume: 80, audioEnabled: true, quality: 'high' });
  const state = { volume: 25, audioEnabled: false, quality: 'low' };
  assert.deepEqual(validatePanelState(spec, state), state);
  for (const value of ['missing', '高', null, 0, false]) assert.throws(() => validatePanelState(spec, { ...state, quality: value }));
  for (const mutate of [
    value => { quality(value).initial = 'missing'; },
    value => { quality(value).options = []; },
    value => { quality(value).options = Array.from({ length: 9 }, (_, i) => ({ id: `option${i}`, label: `${i}` })); },
    value => { quality(value).options[1].id = 'low'; },
    value => { quality(value).options[0].id = '../bad'; },
    value => { quality(value).options[0].label = ''; },
    value => { quality(value).options[0].execute = 'run()'; },
    value => { quality(value).min = 0; },
  ]) { const bad = copy(spec); mutate(bad); assert.throws(() => validatePanelSpec(bad)); }
});

test('selects retain one typed binding per state and option IDs are isolated across controls', () => {
  const spec = controlsSpec();
  spec.state.push({ id: 'mode', type: 'enum', initial: 'low', options: copy(quality(spec).options) });
  spec.sections[0].rows.splice(1, 0, { ...copy(selectRow(spec)), id: 'mode-row', bind: 'mode', event: 'settings.modeChanged' });
  const compiled = compile(freeze(spec));
  const first = node(compiled.document, controlId(spec.id, 'quality-row')), second = node(compiled.document, controlId(spec.id, 'mode-row'));
  assert.equal(first.type, 'Select'); assert.equal(second.type, 'Select');
  assert.equal(first.props.selectedId, choiceId(spec.id, 'quality-row', 'high'));
  assert.equal(second.props.selectedId, choiceId(spec.id, 'mode-row', 'low'));
  assert.equal(new Set([...first.props.options, ...second.props.options].map(option => option.id)).size, 4);
  assert.deepEqual(first.props.options.map(option => option.label), ['低', '高']);
  assert.deepEqual(compiled.bindings.find(binding => binding.fieldId === 'quality'), {
    nodeId: controlId(spec.id, 'quality-row'), fieldId: 'quality', event: 'settings.qualityChanged', type: 'enum', enabled: true,
  });
  const wrong = controlsSpec(); selectRow(wrong).bind = 'volume';
  assert.throws(() => validatePanelSpec(wrong), { code: 'binding-type' });
  const duplicate = controlsSpec(); duplicate.sections[0].rows.push({ ...copy(selectRow(duplicate)), id: 'duplicate-row', event: 'different.event' });
  assert.throws(() => validatePanelSpec(duplicate), { code: 'duplicate' });
});

test('button actions are separate from state bindings and preserve emit/reset intent without executing it', () => {
  const spec = controlsSpec();
  spec.sections[0].rows.push({ ...copy(buttonRow(spec)), id: 'apply-row', label: '应用设置', buttonLabel: '应用',
    enabled: false, event: 'settings.apply', action: { kind: 'emit' } });
  const state = { volume: 30, audioEnabled: false, quality: 'low' };
  const result = compile(freeze(spec), state);
  assert.deepEqual(result.state, state, 'compilation must not perform reset actions');
  assert.deepEqual(result.actions, [
    { nodeId: controlId(spec.id, 'reset-row'), rowId: 'reset-row', event: 'settings.reset', enabled: true,
      action: { kind: 'reset-initial', fields: ['volume', 'audioEnabled', 'quality'] } },
    { nodeId: controlId(spec.id, 'apply-row'), rowId: 'apply-row', event: 'settings.apply', enabled: false, action: { kind: 'emit' } },
  ]);
  assert.equal(result.bindings.length, spec.state.length);
  assert.ok(!result.bindings.some(binding => binding.nodeId.includes('reset-row') || binding.nodeId.includes('apply-row')));
  const reset = node(result.document, controlId(spec.id, 'reset-row'));
  assert.equal(reset.type, 'Button'); assert.equal(reset.props.label, '重置设置');
  assert.equal(node(result.document, `${spec.id}.row.reset-row.label`).props.text, '恢复默认');
  assert.equal(node(result.document, controlId(spec.id, 'apply-row')).props.enabled, false);
});

test('button actions reject scripts, missing/duplicate reset fields, data bindings and duplicate event channels', () => {
  for (const mutate of [
    spec => { buttonRow(spec).action = { kind: 'execute', script: 'arbitrary()' }; },
    spec => { buttonRow(spec).action = { kind: 'emit', fields: ['volume'] }; },
    spec => { buttonRow(spec).action.fields = []; },
    spec => { buttonRow(spec).action.fields = ['volume', 'volume']; },
    spec => { buttonRow(spec).action.fields = ['missing']; },
    spec => { buttonRow(spec).bind = 'volume'; },
    spec => { buttonRow(spec).event = selectRow(spec).event; },
    spec => { delete buttonRow(spec).buttonLabel; },
    spec => { buttonRow(spec).buttonLabel = ''; },
    spec => { spec.state.push({ id: 'unbound', type: 'boolean', initial: false }); buttonRow(spec).action.fields.push('unbound'); },
  ]) { const spec = controlsSpec(); mutate(spec); assert.throws(() => validatePanelSpec(spec)); }
});

test('select/button right-hand controls are centered, keep existing controls stable, and use a legible default Select palette', () => {
  const spec = controlsSpec(), result = compile(spec), old = compilePanel(fixture, catalog, core);
  for (const rowId of ['quality-row', 'reset-row']) {
    const control = node(result.document, controlId(spec.id, rowId));
    assert.equal(control.layout.height, 40);
    assert.equal(control.layout.y, (spec.layout.rowHeight - 40) / 2);
    assert.equal(control.layout.x, spec.layout.labelWidth + spec.layout.gap + 12);
    assert.ok(control.layout.width >= 120);
    assert.equal(control.layout.x + control.layout.width, spec.layout.width - spec.layout.padding * 2 - 12);
  }
  for (const rowId of ['volume-row', 'audio-enabled-row']) {
    assert.deepEqual(node(result.document, controlId(spec.id, rowId)), node(old.document, controlId(spec.id, rowId)));
  }
  const select = node(result.document, controlId(spec.id, 'quality-row'));
  assert.equal(select.props.style.backgroundColor, '#F1F5FC'); assert.equal(select.props.style.textColor, '#111622');
  assert.match(result.policy.layoutSource.description, /compiler 0\.3\.0/);
});

test('a full eight-choice popup must fit the canvas, including the runtime two-pixel gap', () => {
  const spec = controlsSpec(); quality(spec).options = Array.from({ length: 8 }, (_, i) => ({ id: `choice${i}`, label: `选项 ${i}` }));
  quality(spec).initial = 'choice0';
  const compiled = compile(spec), select = node(compiled.document, controlId(spec.id, 'quality-row'));
  const bottom = globalY(compiled.document, select.id) + select.layout.height + 2 + Math.max(32, select.layout.height) * 8;
  assert.ok(bottom <= spec.canvas.height);
  spec.sections[0].rows.push(spec.sections[0].rows.shift());
  assert.throws(() => compile(spec), { code: 'SELECT_POPUP_OVERFLOW' });
  spec.canvas.height = 1032;
  const boundary = compile(spec), last = node(boundary.document, controlId(spec.id, 'quality-row'));
  assert.equal(globalY(boundary.document, last.id) + 40 + 2 + 40 * 8, 1032);
  spec.canvas.height = 1031;
  assert.throws(() => compile(spec), { code: 'SELECT_POPUP_OVERFLOW' });
});

test('button text selects the higher black/white contrast against light or dark theme accents', () => {
  for (const [accent, expected] of [['#71DBC3', '#000000'], ['#FFFFFF', '#000000'], ['#000000', '#FFFFFF'], ['#101D35', '#FFFFFF']]) {
    const themed = copy(controlsCatalog); themed.themes[0].tokens.accent = accent;
    themed.themes[0].tokens.background = '#FFFFFF';
    const result = compilePanel(controlsSpec(), themed, core), button = node(result.document, controlId(fixture.id, 'reset-row'));
    assert.equal(button.props.style.backgroundColor, accent);
    assert.equal(button.props.style.textColor, expected);
  }
});

test('right-hand width and text height gates reject layouts that would clip new controls', () => {
  const spec = controlsSpec(); spec.state = [quality(spec)];
  spec.sections[0].rows = [selectRow(spec), { ...buttonRow(spec), action: { kind: 'emit' } }];
  spec.layout.labelWidth = 412;
  assert.equal(node(compile(spec).document, controlId(spec.id, 'quality-row')).layout.width, 120);
  spec.layout.labelWidth = 413;
  assert.throws(() => compile(spec), { code: 'CONTROL_WIDTH' });
  const largeType = copy(controlsCatalog); largeType.themes[0].tokens.fontSize = 32;
  assert.throws(() => compilePanel(controlsSpec(), largeType, core), { code: 'CONTROL_HEIGHT' });
});

test('PanelBundle 0.3 preserves enum state and declarative actions through offline validation', async () => {
  const spec = controlsSpec(), state = { volume: 23, audioEnabled: false, quality: 'low' };
  const bundle = await createPanelBundle(spec, controlsCatalog, core, state);
  assert.equal(bundle.panelBundleVersion, '0.3'); assert.equal(bundle.compilerVersion, '0.3.0');
  assert.equal(bundle.capabilities.sessionRequired, true); assert.equal(bundle.actions.length, 1);
  assert.deepEqual(bundle.state, state); assert.deepEqual(bundle.componentBundle.resources, []);
  assert.equal(panelBundleAssetInputs(bundle, core), undefined);
  const restored = await validatePanelBundle(JSON.parse(JSON.stringify(bundle)), core);
  assert.deepEqual(restored, bundle);
  assert.deepEqual(await createPanelBundle(restored.spec, restored.catalog, core, restored.state), bundle);
  assert.equal(restored.verification.nativeEngines, 'NOT_RUN');
});

test('PanelBundle 0.3 asset resources remain embedded and restorable when assets are enabled', async () => {
  const spec = controlsSpec(), bytes = new Uint8Array(await readFile(new URL('../examples/custom-assets/panel-surface.png', import.meta.url)));
  const sha256 = await digestBytes(bytes), key = 'test-kit/quality@1.0.0';
  spec.assets = { library: { id: 'test-library', sha256: 'a'.repeat(64) }, panelSurface: null, rowIcons: [{ rowId: 'quality-row', asset: key }] };
  const inputs = { closure: { assetClosureVersion: '0.1', library: copy(spec.assets.library), records: [
    { key, role: 'icon', width: 64, height: 64, slice: null, sha256, bytes: bytes.length },
  ] }, resources: [{ path: `textures/${sha256}.png`, mime: 'image/png', bytes }] };
  const bundle = await createPanelBundle(spec, controlsCatalog, core, undefined, inputs);
  assert.equal(bundle.panelBundleVersion, '0.3'); assert.equal(bundle.componentBundle.resources.length, 1);
  const restored = await validatePanelBundle(JSON.parse(JSON.stringify(bundle)), core);
  const embedded = panelBundleAssetInputs(restored, core);
  assert.deepEqual(embedded.closure, inputs.closure);
  assert.deepEqual(Buffer.from(embedded.resources[0].bytes), Buffer.from(bytes));
  assert.deepEqual(await createPanelBundle(restored.spec, restored.catalog, core, restored.state, embedded), bundle);
});

test('rehashed bundle actions, enum snapshots or session capability cannot contradict authored intent', async () => {
  const bundle = await createPanelBundle(controlsSpec(), controlsCatalog, core);
  for (const change of [
    value => { value.actions[0].action = { kind: 'emit' }; },
    value => { value.actions = []; },
    value => { value.actions[0].enabled = false; },
    value => { value.state.quality = 'undeclared'; },
    value => { value.capabilities.sessionRequired = false; },
    value => { value.panelBundleVersion = '0.2'; value.compilerVersion = '0.2.0'; },
  ]) {
    const bad = copy(bundle); change(bad); const { sha256, ...payload } = bad; bad.sha256 = await digestJson(payload);
    await assert.rejects(validatePanelBundle(bad, core));
  }
});

test('legacy compiler and bundle output digest remains byte-identical and gains no action/session fields', async () => {
  const oldCatalog = copy(catalog);
  oldCatalog.recipes = oldCatalog.recipes.filter(recipe => ['settings.panel', 'settings.section', 'settings.slider', 'settings.switch'].includes(recipe.id));
  oldCatalog.themes = oldCatalog.themes.filter(theme => theme.id === 'modern-dark' && theme.version === '0.1.0');
  oldCatalog.version = '0.1.0';
  const old = compilePanel(fixture, oldCatalog, core), bundle = await createPanelBundle(fixture, oldCatalog, core);
  assert.equal(await digestJson(old.document), '0277aaa22cd1adae6354737f47acc12d3f75b3c5a1321ea22591ff83870c0fa8');
  assert.equal(bundle.sha256, '532d16fe4bdf907e6032ac15e8c3178d2257adc56a72f5aa5ab860d7e92e613a');
  assert.equal(Object.hasOwn(old, 'actions'), false); assert.equal(Object.hasOwn(bundle, 'actions'), false);
  assert.equal(Object.hasOwn(bundle.capabilities, 'sessionRequired'), false);
});
