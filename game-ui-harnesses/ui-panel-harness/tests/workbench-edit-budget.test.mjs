import test from 'node:test';
import assert from 'node:assert/strict';
import { core, fixture, catalog, copy } from './helpers.mjs';
import { createPanelBundle } from '../src/panel-bundle.mjs';
import { createWorkbenchModel } from '../src/workbench-model.mjs';
import { createWorkbenchStorage, emptyWorkbenchDraft } from '../src/workbench-storage.mjs';
import { validateWorkbenchEditUsage } from '../src/workbench-edit-budget.mjs';
import { digestJson } from '../src/canonical.mjs';
import { proposalTargets } from '../src/proposal.mjs';

const bundle = () => createPanelBundle(fixture, catalog, core);
const model = present => createWorkbenchModel({ catalog, pool: null }, core, present);
const request = text => ({ requestVersion: '0.1', id: 'edit-test', text, target: 'pixi' });
const patch = async (m, title) => ({ patchVersion: '0.1', baseSpecSha256: await digestJson(m.getSnapshot().panel.spec),
  reason: 'Deterministic edit-limit fixture.', operations: [{ op: 'set-panel-title', title }] });
function memory(raw = null) { return { getItem: () => raw, setItem(_key, value) { raw = value; } }; }

test('ten successful edits block the eleventh patch and planning before any new computation', async () => {
  let presentations = 0;
  const m = await model(() => { presentations++; }); await m.importPanel(await bundle());
  for (let i = 1; i <= 10; i++) await m.patch(await patch(m, `修改 ${i}`));
  assert.equal(presentations, 11); const before = m.getSnapshot();
  await assert.rejects(m.prepareEdit(request('再改一个标题')), /WORKBENCH_EDIT_LIMIT/);
  await assert.rejects(m.patch(await patch(m, '第十一轮')), /WORKBENCH_EDIT_LIMIT/);
  assert.deepEqual(m.getSnapshot(), before); assert.equal(presentations, 11);
  assert.equal((await m.exportPanel()).spec.title, '修改 10');
});

test('failed patches, no-op changes, clarification and no-change responses do not consume rounds', async () => {
  const m = await model(); await m.importPanel(await bundle());
  await assert.rejects(m.patch(await patch(m, ''))); assert.equal(m.getEditBudget().used, 0);
  await m.patch(await patch(m, fixture.title)); assert.equal(m.getEditBudget().used, 0);
  let context = (await m.prepareEdit(request('保持当前标题'))).context;
  await m.acceptEditProposal({ editProposalVersion: '0.2', contextSha256: context.sha256,
    patch: null, decisions: [], unresolved: [], noChange: { reason: '标题已满足要求', basis: {
      kind: 'request-interpretation', start: 0, end: context.request.text.length, quote: context.request.text } } });
  assert.equal(m.getEditBudget().used, 0);
  context = (await m.prepareEdit(request('改一下'))).context;
  await m.acceptEditProposal({ editProposalVersion: '0.1', contextSha256: context.sha256,
    patch: null, decisions: [], unresolved: [{ id: 'target', question: '希望修改哪个标题？' }] });
  assert.equal(m.getEditBudget().used, 0);
});

test('render failure or a stale transaction cannot consume a round', async () => {
  let reject = false, release, entered;
  const wait = new Promise(resolve => { release = resolve; });
  const signal = new Promise(resolve => { entered = resolve; });
  let gate = false;
  const m = await model(async () => { if (reject) throw new Error('RENDER_FAILED'); if (gate) { entered(); await wait; } });
  await m.importPanel(await bundle()); reject = true;
  await assert.rejects(m.patch(await patch(m, '渲染失败')), /RENDER_FAILED/); assert.equal(m.getEditBudget().used, 0);
  reject = false; gate = true; const pending = m.patch(await patch(m, '过期修改')); await signal;
  m.restoreEditUsage({ [fixture.id]: 2 }); release();
  assert.equal((await pending).status, 'STALE'); assert.equal(m.getEditBudget().used, 2);
});

test('undo, history import, export/reimport and lower saved counters do not refund used rounds', async () => {
  const m = await model(), original = await bundle(); await m.importPanel(original);
  for (let i = 0; i < 10; i++) await m.patch(await patch(m, `版 ${i}`));
  await m.undo(); await m.importPanel(original); m.restoreEditUsage({ [fixture.id]: 1 });
  assert.equal(m.getEditBudget().used, 10);
  await m.importPanel(await m.exportPanel()); assert.equal(m.getEditBudget().remaining, 0);
});

test('budget is persisted separately from old versions and survives a fresh model restore', async () => {
  const m = await model(), original = await bundle(); await m.importPanel(original);
  await m.patch(await patch(m, '新标题'));
  const storage = memory(), store = createWorkbenchStorage(storage); store.read();
  store.save({ draft: emptyWorkbenchDraft(), panel: original, editUsage: m.getEditUsage() });
  const saved = createWorkbenchStorage(storage).read(), next = await model();
  await next.importPanel(saved.versions[0].panel); next.restoreEditUsage(saved.editUsage);
  assert.equal(next.getEditBudget().used, 1); assert.equal(next.getSnapshot().panel.spec.title, original.spec.title);
  assert.equal(Object.hasOwn(await next.exportPanel(), 'editUsage'), false);
});

test('a successfully generated replacement starts a new budget, while failed generation keeps it', async () => {
  const m = await model(); await m.importPanel(await bundle()); m.restoreEditUsage({ [fixture.id]: 10 });
  const prepared = await m.prepare(request('生成一个声音设置面板'));
  await assert.rejects(m.acceptProposal({})); assert.equal(m.getEditBudget().used, 10);
  const spec = copy(fixture), context = prepared.context;
  const proposal = { proposalVersion: context.planningContextVersion, contextSha256: context.sha256, spec, unresolved: [],
    decisions: proposalTargets(spec, context.planningContextVersion).map(target => ({ target, basis: {
      kind: 'request-interpretation', start: 0, end: context.request.text.length, quote: context.request.text } })) };
  await m.acceptProposal(proposal); assert.equal(m.getEditBudget().used, 0);
});

test('old workspace records migrate without rewriting their original bytes on read', async () => {
  const raw = JSON.stringify({ workspaceVersion: '0.1', draft: emptyWorkbenchDraft(), currentId: null, versions: [] });
  const storage = memory(raw), store = createWorkbenchStorage(storage), saved = store.read();
  assert.equal(saved.workspaceVersion, '0.2'); assert.deepEqual(saved.editUsage, {}); assert.equal(storage.getItem(), raw);
  for (const bad of [-1, 11, 1.5, '10']) assert.throws(() => validateWorkbenchEditUsage({ panel: bad }), /WORKBENCH_EDIT_USAGE/);
  assert.throws(() => validateWorkbenchEditUsage(JSON.parse('{"__proto__":1}')), /WORKBENCH_EDIT_USAGE/);
  const version2 = { ...saved, editUsage: { panel: 11 } }; const corrupt = memory(JSON.stringify(version2));
  assert.throws(() => createWorkbenchStorage(corrupt).read(), /WORKSPACE_INVALID/);
});
