import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { core, nodesOf } from './helpers.mjs';
import { roleRequest, roleIntent } from '../examples/adaptive-v1/fixture.mjs';
import { createPlanningContext } from '../src/planning-context.mjs';
import { materializePanelIntent } from '../src/panel-intent.mjs';
import { createPanelBundle, validatePanelBundle } from '../src/panel-bundle.mjs';
import { validatePanelSpec } from '../src/spec.mjs';
import { digestJson } from '../src/canonical.mjs';
import { applyPanelPatch } from '../src/patch.mjs';
import { createPanelEditContext, validatePanelEditContext, checkPanelEditProposal } from '../src/edit-planning.mjs';
import { buildCodexEditResponseSchema, codexEditOperationContracts } from '../src/codex-edit-schema.mjs';
import { materializeCodexEditDraft } from '../src/codex-edit-draft.mjs';
import { createUnityDocument } from '../src/unity-export.mjs';
import { composePanelBundles, validatePanelComposition } from '../src/panel-composition.mjs';
import { createWorkbenchModel } from '../src/workbench-model.mjs';

const catalog = JSON.parse(await readFile(new URL('../examples/modern-adaptive.catalog.json', import.meta.url), 'utf8'));
const planning = await createPlanningContext(roleRequest, catalog);
const role = (await materializePanelIntent(planning, roleIntent(planning))).spec;
const rows = ['⏮', '⏯', '⏭'].map((buttonLabel,i) => ({ id: `play${i}`, kind: 'button', label: '', buttonLabel, enabled: true,
  recipe: { id: 'settings.button', version: '0.1.0' }, event: `music.action${i}`, action: { kind: 'emit' } }));
const spec = { ...role, panelSpecVersion: '0.9', id: 'font-player', state: [], sections: [{ id: 'transport', title: '播放控制', rows }], appearance: null,
  actionLayouts: [{ sectionId: 'transport', direction: 'row', align: 'center', gap: 16, buttonWidth: 56, buttonHeight: 56, shape: 'circle' }],
  layout: { ...role.layout, body: { ...role.layout.body, children: [{ kind: 'section', sectionId: 'transport', width: 'fill' }] } } };
const source = await createPanelBundle(spec, catalog, core);
const op = fontSize => ({ op: 'set-button-font-size', rowId: 'play1', fontSize });
const patch = async (s, operations) => ({ patchVersion: '0.1', baseSpecSha256: await digestJson(s), reason: 'Fixture: button font only.', operations });
async function changed(operations, b = source) {
  const result = await applyPanelPatch(b.spec, await patch(b.spec, operations));
  return { result, bundle: await validatePanelBundle(await createPanelBundle(result.spec, b.catalog, core, b.state), core) };
}
const buttonNodes = b => nodesOf(b.componentBundle.document).filter(n => n.type === 'Button');

test('only the selected glyph grows; exact button geometry, siblings, events and action layout survive', async () => {
  const { bundle: b, result } = await changed([op(28)]);
  assert.equal(b.spec.panelSpecVersion, '0.11'); assert.equal(b.compilerVersion, '0.11.0');
  assert.deepEqual(b.spec.buttonFonts, [{ rowId: 'play1', fontSize: 28 }]);
  assert.deepEqual(result.receipt.changedRowIds, ['play1']);
  const after = buttonNodes(b), before = buttonNodes(source);
  for (let i = 0; i < after.length; i++) {
    assert.deepEqual(after[i].layout, before[i].layout);
    assert.equal(after[i].props.style.cornerRadius, 28);
    if (i !== 1) assert.deepEqual(after[i], before[i]);
  }
  assert.equal(after[1].props.style.fontSize, 28); assert.equal(after[1].children[0].props.style.fontSize, 28);
  assert.equal(after[1].children[0].layout.height, Math.ceil(28*1.3));
  assert.deepEqual(b.actions, source.actions); assert.deepEqual(b.state, source.state);
  assert.deepEqual(b.spec.sections, source.spec.sections); assert.deepEqual(b.spec.actionLayouts, source.spec.actionLayouts);
});

test('clearing font inherits the theme without resetting color, dimensions or shape', async () => {
  const style = { backgroundColor: '#7C3AED', textColor: null, borderColor: null, borderWidth: null, cornerRadius: null, width: 80, height: 80, shape: 'circle' };
  const { bundle: b } = await changed([op(32), { op: 'set-button-style', rowId: 'play1', style }]);
  const { bundle: cleared, result } = await changed([op(null)], b);
  assert.deepEqual(cleared.spec.buttonFonts, []); assert.deepEqual(cleared.spec.buttonStyles, b.spec.buttonStyles);
  assert.deepEqual(result.receipt.changedRowIds, ['play1']);
  assert.equal(buttonNodes(cleared)[1].props.style.fontSize, catalog.themes[0].tokens.fontSize);
  const { bundle: stylesCleared } = await changed([{ op: 'set-button-style', rowId: 'play1', style: null }], b);
  assert.equal(stylesCleared.spec.panelSpecVersion, '0.11'); assert.equal(buttonNodes(stylesCleared)[1].props.style.fontSize, 32);
});

for (const fontSize of [7, 97, 24.5, '24', NaN, Infinity]) test(`invalid font ${fontSize} cannot change any source data`, async () => {
  const digest = await digestJson(source);
  await assert.rejects(changed([{ op: 'set-panel-title', title: '不能部分应用' }, op(fontSize)]));
  assert.equal(await digestJson(source), digest);
});

test('unfitting font and wrong target fail atomically without growing the button', async () => {
  await assert.rejects(changed([op(48)]), /do(?:es)? not fit/);
  await assert.rejects(changed([{ ...op(24), rowId: 'missing' }]));
  await assert.rejects(applyPanelPatch(role, await patch(role, [{ ...op(24), rowId: role.sections[0].rows[0].id }])), /button required/);
  await assert.rejects(changed([op(24), op(28)]), /overlap/);
  const model = await createWorkbenchModel({ catalog, pool: null }, core); await model.importPanel(source);
  await assert.rejects(model.patch(await patch(source.spec, [op(48)])), /do(?:es)? not fit/);
  assert.deepEqual(model.getSnapshot().panel, source); assert.equal(model.getEditBudget().used, 0); model.dispose();
});

test('override structure is exact, bounded, button-only and unique', async () => {
  const { bundle: b } = await changed([op(24)]);
  for (const buttonFonts of [null, [{ rowId: 'play1', fontSize: null }], [{ rowId: 'missing', fontSize: 24 }],
    [{ rowId: 'play1', fontSize: 24, width: 80 }], [{ rowId: 'play1' }], [b.spec.buttonFonts[0], b.spec.buttonFonts[0]]]) {
    assert.throws(() => validatePanelSpec({ ...b.spec, buttonFonts }));
  }
  assert.throws(() => validatePanelSpec({ ...source.spec, buttonFonts: [] }), /unknown field/);
  assert.deepEqual((await changed([op(null)])).bundle, source);
});

test('new contexts pin one font operation to the selected row; old context 0.4 and 0.5 retain exact hashes and no new operation', async () => {
  const request = { ...roleRequest, id: 'font-edit', text: '把这个icon放大到28，按钮大小和其他内容不变。' };
  const c = await createPanelEditContext(source.spec, catalog, request, { rowId: 'play1' });
  assert.equal(c.editContextVersion, '0.8'); assert.deepEqual(await validatePanelEditContext(c), c);
  assert(c.capabilities.operations.includes(op(28).op));
  const schema = await buildCodexEditResponseSchema({ draft: true, context: c });
  assert(codexEditOperationContracts(schema, c).some(o => o.operation === op(28).op));
  const follow = value => value.$ref ? follow(schema.$defs[value.$ref.slice(8)]) : value;
  const nativePatch = follow(follow(schema.properties.patch).anyOf.find(value => value.type !== 'null'));
  const font = follow(nativePatch.properties.operations.items).anyOf.map(follow).find(shape => shape.properties.op.enum[0] === op(28).op);
  assert.deepEqual(font.properties.rowId.enum, ['play1']);
  const draft = { codexEditDraftVersion: '0.3', contextSha256: c.sha256, patch: await patch(c.spec, [op(28)]), bases: [{ kind: 'request-interpretation', quote: request.text }], unresolved: [], noChange: null };
  const proposal = await materializeCodexEditDraft(c, draft);
  assert.equal((await checkPanelEditProposal(c, proposal)).status, 'READY_TO_APPLY');
  await assert.rejects(materializeCodexEditDraft(c, { ...draft, patch: { ...draft.patch, operations: [{ ...op(28), rowId: 'play0' }] } }), /EDIT_SELECTION_SCOPE/);
  for (const version of ['0.4','0.5']) {
    const old = structuredClone(version === '0.5' ? c : await createPanelEditContext(source.spec, catalog, request));
    old.editContextVersion = version; if (version === '0.4') delete old.selection;
    old.capabilities.operations = old.capabilities.operations.filter(value => value !== op(28).op); delete old.capabilities.buttonFontPolicy; delete old.capabilities.titleBarPolicy; delete old.capabilities.textWrapPolicy; old.capabilities.operations = old.capabilities.operations.filter(op => op !== 'set-text-wrap'); old.capabilities.operations = old.capabilities.operations.filter(op => op !== 'set-title-bar');
    delete old.sha256; old.sha256 = await digestJson(old);
    assert.deepEqual(await validatePanelEditContext(old), old);
    assert(!JSON.stringify(await buildCodexEditResponseSchema({ draft: true, context: old })).includes(op(28).op));
    await assert.rejects(materializeCodexEditDraft(old, { ...draft, contextSha256: old.sha256 }), /EDIT_PATCH/);
  }
});

test('composition remaps font targets and Unity exports one native centered text at the same size', async () => {
  const { bundle: a } = await changed([op(28)]);
  const b = await createPanelBundle({ ...source.spec, id: 'second-player' }, catalog, core);
  const request = { panelCompositionRequestVersion: '0.1', id: 'font-composite', title: '组合', sources: [{ namespace: 'one', bundleSha256: a.sha256 }, { namespace: 'two', bundleSha256: b.sha256 }],
    layout: 'column', width: 420, canvasWidth: 484, canvasHeight: 640, maxHeight: 560, surfaceFrom: null };
  const composition = await composePanelBundles(request, [a,b], core); await validatePanelComposition(composition, [a,b], core);
  assert.equal(composition.bundle.spec.panelSpecVersion, '0.11'); assert.equal(composition.bundle.spec.buttonFonts.length, 1);
  assert.equal(buttonNodes(composition.bundle).filter(n => n.props.style.fontSize === 28).length, 1);
  const unity = await createUnityDocument(a, core), before = await createUnityDocument(source, core);
  const button = buttonNodes(a)[1], exported = unity.nodes.find(n => n.id === button.id);
  assert.equal(exported.fontSize, 28); assert.equal(exported.width, 56); assert.equal(exported.height, 56);
  assert(!unity.nodes.some(n => n.id === `${button.id}.center-label`)); assert.deepEqual(unity.controls, before.controls);
});

test('font edits preserve entered form state, remove-row cleans overrides, and ten successful edits remain the limit', async () => {
  const s = structuredClone(role); s.sections.push(...source.spec.sections); s.layout.body.children.push({ kind: 'section', sectionId: 'transport', width: 'fill' });
  const b = await createPanelBundle(s, catalog, core, { row0: '蓝莓玩家' }), model = await createWorkbenchModel({ catalog, pool: null }, core); await model.importPanel(b);
  for (let i = 0; i < 10; i++) await model.patch(await patch(model.getSnapshot().panel.spec, [op(i%2 ? 20 : 24)]));
  assert.deepEqual(model.getSnapshot().panel.state, b.state); assert.equal(model.getEditBudget().used, 10);
  const removed = await applyPanelPatch(model.getSnapshot().panel.spec, await patch(model.getSnapshot().panel.spec, [{ op: 'remove-row', rowId: 'play1' }]));
  assert.deepEqual(removed.spec.buttonFonts, []);
  await model.undo(); await assert.rejects(model.patch(await patch(model.getSnapshot().panel.spec, [op(null)])), /WORKBENCH_EDIT_LIMIT/); model.dispose();
});
