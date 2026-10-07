import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readJson } from '../src/io.mjs';
import { digestJson, digestBytes } from '../src/canonical.mjs';
import { APPEARANCE_KEYS } from '../src/appearance.mjs';
import { validatePanelSpec } from '../src/spec.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { createPlanningContext } from '../src/planning-context.mjs';
import { materializePanelIntent } from '../src/panel-intent.mjs';
import { createPanelBundle, validatePanelBundle, panelBundleAssetInputs } from '../src/panel-bundle.mjs';
import { applyPanelPatch } from '../src/patch.mjs';
import { createPanelEditContext, validatePanelEditContext, checkPanelEditProposal } from '../src/edit-planning.mjs';
import { buildCodexEditResponseSchema, codexEditOperationContracts } from '../src/codex-edit-schema.mjs';
import { materializeCodexEditDraft } from '../src/codex-edit-draft.mjs';
import { createUnityDocument } from '../src/unity-export.mjs';
import { createWorkbenchModel } from '../src/workbench-model.mjs';
import { composePanelBundles } from '../src/panel-composition.mjs';
import { roleRequest, roleIntent } from '../examples/adaptive-v1/fixture.mjs';

const core = await loadWorkspaceCore(), catalog = await readJson(new URL('../examples/modern-adaptive.catalog.json', import.meta.url));
const context = await createPlanningContext(roleRequest, catalog);
const original = await createPanelBundle((await materializePanelIntent(context, roleIntent(context))).spec, catalog, core, { row0: '蓝莓玩家' });
const empty = () => Object.fromEntries(APPEARANCE_KEYS.map(key => [key, null]));
const appearance = { ...empty(), canvasColor: '#061D1B', panelColor: '#123D32', controlColor: '#1B5142', accentColor: '#B8E986',
  textColor: '#F3FFF8', mutedColor: '#A7CDBA', borderColor: '#3B7862', buttonColor: '#B8E986', buttonTextColor: '#123521', panelRadius: 24, controlRadius: 12, buttonRadius: 22 };
const request = text => ({ requestVersion: '0.1', id: 'appearance-edit', text, target: 'pixi' });
const patch = async (spec, operations) => ({ patchVersion: '0.1', baseSpecSha256: await digestJson(spec), reason: 'Explicit appearance fixture.', operations });
const nodes = document => { const all = []; const visit = n => { all.push(n); n.children?.forEach(visit); }; visit(document.root); return all; };
async function styled(value = appearance) {
  const { spec } = await applyPanelPatch(original.spec, await patch(original.spec, [{ op: 'set-appearance', appearance: value }]));
  return createPanelBundle(spec, catalog, core, original.state);
}
const proposal = (c, operations, basis) => ({ editProposalVersion: '0.1', contextSha256: c.sha256,
  patch: { patchVersion: '0.1', baseSpecSha256: c.baseSpecSha256, reason: 'Explicit fixture request.', operations }, unresolved: [],
  decisions: operations.map((_, operationIndex) => ({ operationIndex, basis: basis ?? { kind: 'request-interpretation', start: 0, end: c.request.text.length, quote: c.request.text } })) });

test('custom colors/radii reach the actual compiled nodes and survive bundle replay without mutating the catalog', async () => {
  const bundle = await styled(), all = nodes(bundle.componentBundle.document);
  assert.equal(bundle.spec.panelSpecVersion, '0.8'); assert.equal(bundle.panelBundleVersion, '0.8'); assert.equal(bundle.compilerVersion, '0.8.0');
  assert.deepEqual(await validatePanelBundle(bundle, core), bundle); assert.deepEqual(bundle.catalog, catalog);
  assert.deepEqual(bundle.state, original.state); assert.deepEqual(bundle.spec.sections, original.spec.sections);
  const panel = all.find(n => n.id.endsWith('.panel')), input = all.find(n => n.type === 'Input');
  assert.equal(panel.props.style.backgroundColor, '#123D32'); assert.equal(panel.props.style.cornerRadius, 24);
  assert.equal(all[0].props.style.backgroundColor, '#061D1B');
  assert.equal(input.props.style.backgroundColor, '#1B5142'); assert.equal(input.props.style.textColor, '#F3FFF8'); assert.equal(input.props.style.cornerRadius, 12);
  for (const button of all.filter(n => n.type === 'Button')) {
    assert.equal(button.props.style.backgroundColor, '#B8E986'); assert.equal(button.props.style.textColor, '#123521'); assert.equal(button.props.style.cornerRadius, 22);
  }
});

test('clearing appearance restores the original rendered styles; old compiler output remains unchanged', async () => {
  const bundle = await styled(null);
  const styles = b => nodes(b.componentBundle.document).map(n => [n.id, n.props.style]);
  assert.deepEqual(styles(bundle), styles(original));
  assert.equal(original.compilerVersion, '0.7.3'); assert.deepEqual(await validatePanelBundle(original, core), original);
  const forged = structuredClone(bundle); forged.compilerVersion = '0.7.3'; await assert.rejects(validatePanelBundle(forged, core), /PANEL_BUNDLE_VERSION/);
});

for (const [label, value] of [
  ['CSS/code', { ...appearance, panelColor: 'url(javascript:alert(1))' }],
  ['alpha colors', { ...appearance, panelColor: '#00640080' }],
  ['trailing newline', { ...appearance, panelColor: '#006400\n' }],
  ['independent corners', { ...appearance, panelRadius: [0, 8, 16, 32] }],
  ['negative radius', { ...appearance, buttonRadius: -1 }],
  ['unknown animation', { ...appearance, hover: 'rotate' }],
  ['omitted inheritance', { panelColor: '#006400' }],
]) test(`reject ${label} atomically and keep the source intact`, async () => {
  const before = await digestJson(original);
  await assert.rejects(applyPanelPatch(original.spec, await patch(original.spec, [{ op: 'set-panel-title', title: '不可部分应用' }, { op: 'set-appearance', appearance: value }])));
  assert.equal(await digestJson(original), before);
});

test('styles and layout compose in one edit, retain live text, undo together and consume one round', async () => {
  const m = await createWorkbenchModel({ catalog, pool: null }, core); await m.importPanel(original);
  const layout = { ...original.spec.layout, padding: 16, gap: 8 };
  await m.patch(await patch(original.spec, [{ op: 'set-appearance', appearance }, { op: 'set-layout', layout }]));
  assert.deepEqual(m.getSnapshot().panel.state, original.state); assert.equal(m.getEditBudget().used, 1);
  assert.equal(m.getSnapshot().panel.spec.layout.gap, 8);
  const before = m.getSnapshot();
  await assert.rejects(m.patch(await patch(before.panel.spec, [{ op: 'set-layout', layout: { ...layout, padding: 4096 } }, { op: 'set-appearance', appearance: null }])));
  assert.deepEqual(m.getSnapshot(), before); assert.equal(m.getEditBudget().used, 1);
  await m.undo(); assert.deepEqual(m.getSnapshot().panel, original); assert.equal(m.getEditBudget().used, 1);
});

test('native schema advertises appearance only in the new bound context and materializes exact quoted evidence', async () => {
  const c = await createPanelEditContext(original.spec, catalog, request('面板背景改为#006400，其他保持不变。'));
  assert.equal(c.editContextVersion, '0.8'); assert(c.capabilities.operations.includes('set-appearance')); assert.deepEqual(await validatePanelEditContext(c), c);
  const schema = await buildCodexEditResponseSchema({ draft: true, context: c });
  assert(codexEditOperationContracts(schema, c).some(o => o.operation === 'set-appearance'));
  const operations = [{ op: 'set-appearance', appearance: { ...empty(), panelColor: '#006400' } }];
  const publicProposal = await materializeCodexEditDraft(c, { codexEditDraftVersion: '0.3', contextSha256: c.sha256,
    patch: proposal(c, operations).patch, bases: [{ kind: 'request-interpretation', quote: c.request.text }], unresolved: [], noChange: null });
  assert.equal((await checkPanelEditProposal(c, publicProposal, core)).status, 'READY_TO_APPLY');
  const legacy = structuredClone(c); legacy.editContextVersion = '0.1'; delete legacy.selection; delete legacy.capabilities.buttonFontPolicy; delete legacy.capabilities.titleBarPolicy; delete legacy.capabilities.textWrapPolicy; legacy.capabilities.operations = legacy.capabilities.operations.filter(op => op !== 'set-text-wrap'); legacy.capabilities.operations = legacy.capabilities.operations.filter(op => op !== 'set-title-bar'); legacy.capabilities.operations = legacy.capabilities.operations.filter(op => op !== 'set-button-font-size'); legacy.capabilities.operations = legacy.capabilities.operations.filter(op => !['set-appearance', 'set-action-layout', 'set-row-order','set-text','set-button-style'].includes(op)); delete legacy.capabilities.appearancePolicy; delete legacy.capabilities.actionLayoutPolicy; delete legacy.capabilities.buttonStylePolicy;
  delete legacy.sha256; legacy.sha256 = await digestJson(legacy);
  assert.deepEqual(await validatePanelEditContext(legacy), legacy);
  const oldSchema = await buildCodexEditResponseSchema({ draft: true, context: legacy });
  assert(!JSON.stringify(oldSchema).includes('set-appearance'));
  await assert.rejects(materializeCodexEditDraft(legacy, { codexEditDraftVersion: '0.3', contextSha256: legacy.sha256,
    patch: proposal(legacy, operations).patch, bases: [{ kind: 'request-interpretation', quote: legacy.request.text }], unresolved: [], noChange: null }), /EDIT_PATCH/);
});

test('appearance needs current-request evidence; forged/stale contexts and overlapping writes fail', async () => {
  const c = await createPanelEditContext(original.spec, catalog, request('只改背景颜色'));
  const op = { op: 'set-appearance', appearance };
  await assert.rejects(checkPanelEditProposal(c, proposal(c, [op], { kind: 'design-choice', reason: '我喜欢这个配色' }), core), /EDIT_BUSINESS_ORIGIN/);
  await assert.rejects(applyPanelPatch(original.spec, await patch(original.spec, [op, op])), /overlap/);
  const forged = structuredClone(c); forged.spec.title = '已修改的面板'; await assert.rejects(validatePanelEditContext(forged), /EDIT_CONTEXT_MISMATCH/);
});

test('Unity receives the same exact colors/radii and keeps native single-label buttons, fields and actions', async () => {
  const bundle = await styled(), unity = await createUnityDocument(bundle, core), old = await createUnityDocument(original, core);
  const compiled = nodes(bundle.componentBundle.document);
  for (const node of unity.nodes) {
    const style = compiled.find(n => n.id === node.id).props.style;
    for (const key of ['backgroundColor', 'textColor', 'borderColor', 'cornerRadius']) assert.equal(node[key], style[key]);
  }
  assert(!unity.nodes.some(n => n.id.endsWith('.center-label'))); assert.deepEqual(unity.fields, old.fields); assert.deepEqual(unity.controls, old.controls);
});

test('composition keeps a common appearance and rejects mismatched styling instead of silently discarding it', async () => {
  const a = await styled(), b = await styled();
  const request = { panelCompositionRequestVersion: '0.1', id: 'styled-composition', title: '角色组合',
    sources: [{ namespace: 'first', bundleSha256: a.sha256 }, { namespace: 'second', bundleSha256: b.sha256 }],
    layout: 'column', width: 500, canvasWidth: 600, canvasHeight: 700, maxHeight: 620, surfaceFrom: null };
  const result = await composePanelBundles(request, [a, b], core);
  assert.equal(result.bundle.spec.panelSpecVersion, '0.8'); assert.deepEqual(result.bundle.spec.appearance, appearance);
  const different = await styled({ ...appearance, panelColor: '#006400' }); request.sources[1].bundleSha256 = different.sha256;
  await assert.rejects(composePanelBundles(request, [a, different], core), /COMPOSITION_APPEARANCE/);
});

test('style edits do not bypass the ten-round limit after schema upgrade or import', async () => {
  const m = await createWorkbenchModel({ catalog, pool: null }, core); await m.importPanel(original);
  for (let i = 0; i < 10; i++) await m.patch(await patch(m.getSnapshot().panel.spec, [{ op: 'set-appearance', appearance: { ...appearance, panelRadius: i } }]));
  const saved = await m.exportPanel(); await m.importPanel(saved);
  await assert.rejects(m.prepareEdit(request('再改颜色')), /WORKBENCH_EDIT_LIMIT/);
  await assert.rejects(m.patch(await patch(saved.spec, [{ op: 'set-appearance', appearance: null }])), /WORKBENCH_EDIT_LIMIT/);
  assert.equal(m.getEditBudget().used, 10);
});

test('explicit panel color/radius takes precedence over a textured surface, without losing its portable bytes or restore path', async () => {
  const bytes = new Uint8Array(await readFile(new URL('../examples/custom-assets/panel-surface.png', import.meta.url))), sha256 = await digestBytes(bytes);
  const spec = structuredClone(original.spec), library = { id: 'appearance-fixture', sha256: 'a'.repeat(64) }, key = 'fixture/panel@1.0.0';
  spec.assets = { library, panelSurface: key, rowIcons: [] };
  const assets = { closure: { assetClosureVersion: '0.1', library, records: [{ key, role: 'shape', width: 64, height: 64,
    slice: { left: 8, right: 8, top: 8, bottom: 8 }, sha256, bytes: bytes.length }] }, resources: [{ path: `textures/${sha256}.png`, mime: 'image/png', bytes }] };
  const textured = await createPanelBundle(spec, catalog, core, original.state, assets);
  assert.equal(nodes(textured.componentBundle.document).filter(n => n.type === 'Image').length, 9);
  for (const value of [{ ...empty(), panelColor: '#006400' }, { ...empty(), panelRadius: 0 }]) {
    const result = await applyPanelPatch(spec, await patch(spec, [{ op: 'set-appearance', appearance: value }]));
    const changed = await createPanelBundle(result.spec, catalog, core, original.state, panelBundleAssetInputs(textured, core));
    assert.equal(nodes(changed.componentBundle.document).filter(n => n.type === 'Image').length, 0);
    assert.deepEqual(changed.spec.assets, spec.assets); assert.deepEqual(changed.componentBundle.resources, textured.componentBundle.resources);
    const restore = await applyPanelPatch(changed.spec, await patch(changed.spec, [{ op: 'set-appearance', appearance: null }]));
    const restored = await createPanelBundle(restore.spec, catalog, core, original.state, panelBundleAssetInputs(changed, core));
    assert.equal(nodes(restored.componentBundle.document).filter(n => n.type === 'Image').length, 9);
  }
});
