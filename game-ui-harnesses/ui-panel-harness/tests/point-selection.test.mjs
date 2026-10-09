import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { core } from './helpers.mjs';
import { createPlanningContext } from '../src/planning-context.mjs';
import { roleRequest, roleIntent } from '../examples/adaptive-v1/fixture.mjs';
import { materializePanelIntent } from '../src/panel-intent.mjs';
import { createPanelBundle } from '../src/panel-bundle.mjs';
import { createPanelEditContext, validatePanelEditContext, checkPanelEditProposal } from '../src/edit-planning.mjs';
import { createWorkbenchModel } from '../src/workbench-model.mjs';
import { buildCodexEditResponseSchema, codexEditOperationContracts } from '../src/codex-edit-schema.mjs';
import { materializeCodexEditDraft } from '../src/codex-edit-draft.mjs';
import { digestJson } from '../src/canonical.mjs';
import { previewSelectionTargets, selectionLabel, attachWorkbenchSelection } from '../src/workbench-selection.mjs';

const catalog = JSON.parse(await readFile(new URL('../examples/modern-adaptive.catalog.json', import.meta.url), 'utf8'));
const planning = await createPlanningContext(roleRequest, catalog);
const spec = (await materializePanelIntent(planning, roleIntent(planning))).spec;
const rows = spec.sections.flatMap(section => section.rows);
const button = rows.find(row => row.kind === 'button'), input = rows.find(row => row.kind === 'input');
const request = { requestVersion: '0.1', id: 'panel-edit', text: '把这个按钮改成紫色，其他不变。', target: 'pixi' };
const context = await createPanelEditContext(spec, catalog, request, { rowId: button.id });
const proposal = (c, operations) => ({ editProposalVersion: '0.1', contextSha256: c.sha256,
  patch: { patchVersion: '0.1', baseSpecSha256: c.baseSpecSha256, reason: c.request.text, operations },
  decisions: operations.map((_, operationIndex) => ({ operationIndex, basis: { kind: 'request-interpretation', start: 0, end: c.request.text.length, quote: c.request.text } })), unresolved: [] });

test('selection is a separately hashed exact stable ID; original text remains untouched', async () => {
  assert.equal(context.editContextVersion, '0.8'); assert.equal(context.request.text, request.text);
  assert.deepEqual(context.selection, { rowId: button.id });
  assert.equal(context.capabilities.selectionPolicy, 'selected-row-v1');
  assert(!context.capabilities.operations.includes('set-theme'));
  assert.deepEqual(await validatePanelEditContext(context), context);
  const another = await createPanelEditContext(spec, catalog, request, { rowId: input.id });
  assert.notEqual(context.sha256, another.sha256);
  assert.equal(context.baseSpecSha256, another.baseSpecSha256);
});

test('no selection defaults to context 0.8 with explicit null scope', async () => {
  const plain = await createPanelEditContext(spec, catalog, request);
  assert.equal(plain.editContextVersion, '0.8'); assert.equal(plain.selection, null);
  assert.deepEqual(plain, await createPanelEditContext(spec, catalog, request, null));
  assert.deepEqual(plain, await validatePanelEditContext(plain));
});

for (const bad of [{ rowId: 'missing' }, { rowId: 0 }, { rowId: button.id, label: 'forged' }, {}, 'row0'])
  test(`invalid selection ${JSON.stringify(bad)} cannot prepare an edit`, async () => {
    await assert.rejects(createPanelEditContext(spec, catalog, request, bad), /EDIT_SELECTION/);
  });

test('selection and capability tampering is rejected even when rehashed', async () => {
  for (const change of [c => { c.selection.rowId = input.id; }, c => { c.capabilities.operations.push('set-theme'); }, c => { c.capabilities.selectionPolicy = 'unbounded'; }]) {
    const forged = structuredClone(context); change(forged);
    const { sha256, ...payload } = forged; forged.sha256 = await digestJson(payload);
    await assert.rejects(validatePanelEditContext(forged), /EDIT_CONTEXT_MISMATCH/);
  }
});

test('selected row operation applies; another row is rejected by the public gate', async () => {
  assert.equal((await checkPanelEditProposal(context, proposal(context, [{ op: 'set-button-label', rowId: button.id, buttonLabel: '继续' }]))).status, 'READY_TO_APPLY');
  await assert.rejects(checkPanelEditProposal(context, proposal(context, [{ op: 'set-row-label', rowId: input.id, label: '误改' }])), /EDIT_SELECTION_SCOPE/);
  await assert.rejects(checkPanelEditProposal(context, proposal(context, [{ op: 'set-panel-title', title: '误改整页' }])), /EDIT_PATCH/);
});

test('input selection grants only its bound authored state and input properties', async () => {
  const c = await createPanelEditContext(spec, catalog, { ...request, text: '把这个输入框默认值改为蓝莓玩家' }, { rowId: input.id });
  assert(c.capabilities.operations.includes('set-state-initial'));
  assert(!c.capabilities.operations.includes('set-button-style'));
  assert.equal((await checkPanelEditProposal(c, proposal(c, [{ op: 'set-state-initial', fieldId: input.bind, value: '蓝莓玩家' }]))).status, 'READY_TO_APPLY');
  await assert.rejects(checkPanelEditProposal(c, proposal(c, [{ op: 'set-state-initial', fieldId: 'other', value: '蓝莓玩家' }])), /EDIT_SELECTION_SCOPE/);
});

test('native schema pins selected row, bound field and only current scoped operations', async () => {
  const follow = (schema, value) => value.$ref ? follow(schema, schema.$defs[value.$ref.slice('#/$defs/'.length)]) : value;
  for (const c of [context, await createPanelEditContext(spec, catalog, request, { rowId: input.id })]) {
    const schema = await buildCodexEditResponseSchema({ draft: true, context: c });
    const contracts = codexEditOperationContracts(schema, c);
    assert.deepEqual(new Set(contracts.map(op => op.operation)), new Set(c.capabilities.operations));
    const patch = follow(schema, follow(schema, schema.properties.patch).anyOf.find(item => item.type !== 'null'));
    const branches = follow(schema, patch.properties.operations.items).anyOf.map(item => follow(schema, item));
    for (const branch of branches) {
      if (branch.properties.rowId) assert.deepEqual(branch.properties.rowId.enum, [c.selection.rowId]);
      if (branch.properties.fieldId) assert.deepEqual(branch.properties.fieldId.enum, [input.bind]);
    }
  }
});

test('Codex draft quotes the literal this-request and cannot escape selected scope', async () => {
  const draft = { codexEditDraftVersion: '0.3', contextSha256: context.sha256,
    patch: { patchVersion: '0.1', baseSpecSha256: context.baseSpecSha256, reason: request.text,
      operations: [{ op: 'set-button-label', rowId: button.id, buttonLabel: '继续' }] },
    bases: [{ kind: 'request-interpretation', quote: request.text }], unresolved: [], noChange: null };
  const p = await materializeCodexEditDraft(context, draft);
  assert.equal(p.decisions[0].basis.quote, request.text);
  draft.patch.operations[0] = { op: 'set-row-label', rowId: input.id, label: '错误' };
  await assert.rejects(materializeCodexEditDraft(context, draft), /EDIT_SELECTION_SCOPE/);
});

test('selection snapshot is isolated before await; stale target proposal cannot apply to new selection', async () => {
  const selected = { rowId: button.id };
  const creating = createPanelEditContext(spec, catalog, request, selected); selected.rowId = input.id;
  assert.equal((await creating).selection.rowId, button.id);
  const model = await createWorkbenchModel({ catalog, pool: null }, core);
  await model.importPanel(await createPanelBundle(spec, catalog, core));
  await model.prepareEdit(request, { rowId: button.id });
  await model.prepareEdit(request, { rowId: input.id });
  const before = model.getSnapshot();
  await assert.rejects(model.acceptEditProposal(proposal(context, [{ op: 'set-button-label', rowId: button.id, buttonLabel: '错误' }])), /EDIT_CONTEXT_MISMATCH/);
  assert.deepEqual(model.getSnapshot().panel, before.panel); assert.equal(model.getEditBudget().used, 0);
});

test('selected editing preserves live input, clears prepared context and retains ten-round guard', async () => {
  const model = await createWorkbenchModel({ catalog, pool: null }, core);
  const bundle = await createPanelBundle(spec, catalog, core);
  await model.importPanel(bundle);
  const c = (await model.prepareEdit(request, { rowId: button.id })).context;
  const live = { ...bundle.state, [input.bind]: '蓝莓玩家' };
  await model.acceptEditProposal(proposal(c, [{ op: 'set-button-label', rowId: button.id, buttonLabel: '继续' }]), live);
  assert.equal(model.getSnapshot().panel.state[input.bind], '蓝莓玩家');
  assert.equal(model.getEditSnapshot().context, null); assert.equal(model.getEditBudget().used, 1);
  model.restoreEditUsage({ [spec.id]: 10 });
  await assert.rejects(model.prepareEdit(request, { rowId: button.id }), /WORKBENCH_EDIT_LIMIT/);
  assert.equal(model.getEditBudget().used, 10);
});

test('selection geometry clips nested scrollers, excludes hidden pages, and includes disabled/readonly rows', () => {
  const s = { id: 'p', canvas: { width: 300, height: 200 }, sections: [{ rows: [
    { id: 'a', kind: 'button', buttonLabel: '确认', label: '', enabled: false },
    { id: 'b', kind: 'text', text: '说明', label: '提示' },
    { id: 'c', kind: 'button', buttonLabel: '页二', label: '' },
  ] }] };
  const d = { root: { id: 'root', children: [{ id: 'outer', type: 'ScrollView', children: [{ id: 'inner', type: 'ScrollView', children: [{ id: 'p.row.a.control' }, { id: 'p.row.b' }, { id: 'p.row.c.control' }] }] }] } };
  const inspect = { nodes: [
    { id: 'outer', visible: true, bounds: { x: 20, y: 20, width: 200, height: 100 } },
    { id: 'inner', visible: true, bounds: { x: 30, y: 30, width: 100, height: 100 } },
    { id: 'p.row.a.control', visible: true, enabled: false, bounds: { x: 0, y: 40, width: 80, height: 40 } },
    { id: 'p.row.b', visible: true, bounds: { x: 40, y: 110, width: 80, height: 40 } },
    { id: 'p.row.c.control', visible: false, bounds: { x: 40, y: 40, width: 80, height: 40 } },
  ] };
  const targets = previewSelectionTargets(s, d, inspect);
  assert.deepEqual(targets.map(t => t.rowId), ['a','b']);
  assert.deepEqual(targets[0].bounds, { x: 30, y: 40, width: 50, height: 40 });
  assert.equal(targets[1].bounds.height, 10);
  inspect.nodes[1].visible = false; assert.deepEqual(previewSelectionTargets(s,d,inspect), []);
  assert.equal(selectionLabel(s.sections[0].rows[0]), '确认 · 按钮');
});

test('selection overlay is event driven, never activates preview, preserves focus on resize and detaches', () => {
  const previousDocument = globalThis.document, previousObserver = globalThis.ResizeObserver;
  let focused, observer, listener, detached = 0, inspected = 0, chosen, exits = 0, visible = true;
  const bounds = { x: 40, y: 40, width: 60, height: 60 };
  let canvasWidth = 150;
  class Element extends EventTarget {
    style = {}; dataset = {}; children = []; attributes = {}; hidden = false;
    setAttribute(key,value) { this.attributes[key] = value; }
    append(child) { this.children.push(child); child.parent = this; }
    remove() { this.parent.children.splice(this.parent.children.indexOf(this),1); }
    querySelector() { return this.children[0]; }
    focus() { focused = this; }
    getBoundingClientRect() { return { left: 10, top: 20, width: 150, height: 100 }; }
  }
  try {
    globalThis.document = { createElement: () => new Element() };
    globalThis.ResizeObserver = class { constructor(callback) { this.callback = callback; observer = this; } observe() {} disconnect() { detached++; } };
    const s = { id: 'p', canvas: { width: 300, height: 200 }, sections: [{ rows: [{ id: 'r', kind: 'button', label: '', buttonLabel: '确认' }] }] };
    const host = new Element();
    const preview = { canvas: new Element(), getDocument: () => ({ root: { id: 'p.row.r.control' } }),
      inspect: () => { inspected++; return { nodes: [{ id: 'p.row.r.control', visible, bounds }] }; },
      subscribe: fn => { listener = fn; return () => { detached++; }; },
    };
    preview.canvas.getBoundingClientRect = () => ({ left: 15, top: 30, width: canvasWidth, height: 100 });
    const overlay = attachWorkbenchSelection(host, s, preview, id => { chosen = id; }, () => { exits++; });
    const layer = host.children[0]; assert.equal(layer.hidden,true); assert.equal(inspected,0);
    overlay.setActive(true); const button = layer.children[0]; assert.equal(focused,button);
    assert.equal(button.style.width,'20%'); observer.callback(); assert.equal(layer.children[0],button);
    listener({ type: 'change' }); assert.equal(layer.children.length,1);
    button.dispatchEvent(new Event('click')); assert.equal(chosen,'r');
    const escape = new Event('keydown', { cancelable: true }); escape.key = 'Escape'; layer.dispatchEvent(escape);
    assert.equal(exits,1); assert(escape.defaultPrevented);
    overlay.setSuspended(true); assert.equal(layer.hidden,true);
    overlay.setSuspended(false); assert.equal(layer.hidden,false);
    overlay.setActive(false); assert.equal(layer.hidden,true);
    const outline = host.children[1], beforeFocus = focused;
    overlay.setSelectedRow('r'); assert.equal(outline.hidden, false); assert.equal(layer.hidden, true);
    assert.equal(outline.attributes['aria-hidden'], 'true'); assert.equal(outline.dataset.rowId, 'r');
    assert.deepEqual(outline.style, { left: '25px', top: '30px', width: '30px', height: '30px' });
    assert.equal(focused, beforeFocus, 'Passive outline never moves focus');
    canvasWidth = 300; observer.callback(); assert.equal(outline.style.left, '45px'); assert.equal(outline.style.width, '60px');
    bounds.y = 190; listener({ type: 'scroll' }); assert.equal(outline.style.height, '5px');
    visible = false; listener({ type: 'change' }); assert.equal(outline.hidden, true);
    visible = true; listener({ type: 'change' }); assert.equal(outline.hidden, false);
    overlay.setActive(true); assert.equal(outline.hidden, true); assert.equal(layer.hidden, false);
    overlay.setActive(false); assert.equal(outline.hidden, false);
    overlay.setSuspended(true); assert.equal(outline.hidden, true);
    overlay.setSuspended(false); assert.equal(outline.hidden, false);
    overlay.setSelectedRow(null); assert.equal(outline.hidden, true);
    overlay.setSelectedRow('missing'); assert.equal(outline.hidden, true);
    overlay.destroy(); assert.equal(detached,2); assert.equal(host.children.length,0);
    const calls = inspected; observer.callback(); assert.equal(inspected,calls);
  } finally { globalThis.document = previousDocument; globalThis.ResizeObserver = previousObserver; }
});
