import test from 'node:test';
import assert from 'node:assert/strict';
import { core, fixture, catalog, copy } from './helpers.mjs';
import { createPanelBundle } from '../src/panel-bundle.mjs';
import { createWorkbenchModel } from '../src/workbench-model.mjs';
import { createWorkbenchStorage, emptyWorkbenchDraft } from '../src/workbench-storage.mjs';

function memory() {
  let raw = null, quota = false, writes = 0;
  return { getItem: () => raw, setItem(_key, value) { if (quota) throw new Error('QuotaExceededError'); raw = value; writes++; },
    replace(value) { raw = value; }, setQuota(value) { quota = value; }, get writes() { return writes; } };
}
const panel = (title = fixture.title) => createPanelBundle({ ...copy(fixture), title }, catalog, core);
const draft = text => ({ ...emptyWorkbenchDraft(), text, editText: '把标题改一下' });
const controller = () => createWorkbenchModel({ catalog, pool: null }, core);

test('refresh restores exact authored defaults, played state and drafts without planning or undo state', async () => {
  const storage = memory(), first = createWorkbenchStorage(storage); first.read();
  const bundle = await panel(), field = bundle.spec.state.find(item => item.type === 'number');
  const state = { ...bundle.state, [field.id]: 37 };
  first.save({ draft: draft('用户未提交的需求'), panel: bundle, state });
  const second = createWorkbenchStorage(storage), saved = second.read(), version = saved.versions[0];
  const model = await controller(); await model.importPanel(version.panel, version.state);
  assert.equal(model.getSnapshot().panel.state[field.id], 37);
  assert.deepEqual(model.getSnapshot().panel.spec, bundle.spec);
  assert.equal(saved.draft.text, '用户未提交的需求'); assert.equal(saved.draft.editText, '把标题改一下');
  assert.equal(model.getSnapshot().context, null); assert.equal(model.getEditSnapshot().context, null);
  assert.deepEqual(model.getSnapshot().history, []); assert.equal(model.getSnapshot().canUndo, false);
});

test('draft-only refresh, no-op saves and player changes do not create versions or redundant writes', async () => {
  const storage = memory(), store = createWorkbenchStorage(storage); store.read();
  store.save({ draft: draft('只输入需求') });
  assert.equal(createWorkbenchStorage(storage).read().draft.text, '只输入需求');
  const bundle = await panel(); store.save({ draft: draft('只输入需求'), panel: bundle });
  const writes = storage.writes; store.save({ draft: draft('只输入需求'), panel: bundle });
  assert.equal(storage.writes, writes); assert.equal(store.snapshot().versions.length, 1);
  store.save({ draft: draft('继续修改草稿'), panel: bundle });
  assert.equal(store.snapshot().versions.length, 1);
});

test('restoring old versions retains later work and future edits add a separate version', async () => {
  const storage = memory(), store = createWorkbenchStorage(storage); store.read();
  const a = await panel('版本一'), b = await panel('版本二'), c = await panel('从一继续修改');
  store.save({ draft: draft('一'), panel: a }); store.save({ draft: draft('二'), panel: b });
  const oldest = store.snapshot().versions[0];
  store.save({ draft: oldest.draft, panel: oldest.panel, state: oldest.state });
  assert.equal(store.snapshot().currentId, oldest.id); assert.equal(store.snapshot().versions.length, 2);
  store.save({ draft: draft('从一继续'), panel: c }); assert.equal(store.snapshot().versions.length, 3);
  assert(store.snapshot().versions.some(entry => entry.panel.spec.title === '版本二'));
});

test('invalid bundle/state restore is atomic and keeps the current panel', async () => {
  const model = await controller(), bundle = await panel(); await model.importPanel(bundle);
  const before = model.getSnapshot();
  await assert.rejects(model.importPanel({ ...bundle, sha256: '0'.repeat(64) }, bundle.state));
  assert.deepEqual(model.getSnapshot(), before);
  await assert.rejects(model.importPanel(bundle, { extra: 1 })); assert.deepEqual(model.getSnapshot(), before);
});

test('quota and oversize failures leave the last saved bytes intact', async () => {
  const storage = memory(), bundle = await panel(), store = createWorkbenchStorage(storage); store.read();
  store.save({ draft: draft('已保存'), panel: bundle }); const bytes = storage.getItem();
  storage.setQuota(true); assert.throws(() => store.save({ draft: draft('未保存'), panel: bundle }), /WORKSPACE_QUOTA/);
  assert.equal(storage.getItem(), bytes); assert.equal(store.snapshot().draft.text, '已保存');
  storage.setQuota(false);
  const small = createWorkbenchStorage(memory(), { limits: { versions: 8, chars: 200 } }); small.read();
  assert.throws(() => small.save({ draft: draft('太大'), panel: bundle }), /WORKSPACE_TOO_LARGE/);
  assert.equal(small.backup(), null);
});

test('history is bounded by count and byte budget, keeping the selected panel', async () => {
  const storage = memory(), store = createWorkbenchStorage(storage, { limits: { versions: 2, chars: 1_800_000 } }); store.read();
  for (const title of ['一', '二', '三']) store.save({ draft: draft(title), panel: await panel(title) });
  assert.deepEqual(store.snapshot().versions.map(entry => entry.panel.spec.title), ['二', '三']);
  const budget = JSON.stringify(store.snapshot()).length - 500, storage2 = memory();
  const bounded = createWorkbenchStorage(storage2, { limits: { versions: 8, chars: budget } }); bounded.read();
  bounded.save({ draft: draft('一'), panel: await panel('一') });
  const result = bounded.save({ draft: draft('二'), panel: await panel('二') });
  assert.equal(result.removed, 1); assert.equal(result.workspace.versions[0].panel.spec.title, '二');
});

test('corrupt and future-version saves remain untouched until explicit reset', () => {
  for (const raw of ['{', '{"workspaceVersion":"99"}', 'null']) {
    const storage = memory(); storage.replace(raw); const store = createWorkbenchStorage(storage);
    assert.throws(() => store.read(), /WORKSPACE_INVALID/);
    assert.throws(() => store.save({ draft: draft('替换') }), /WORKSPACE_BLOCKED/);
    assert.equal(store.backup(), raw); store.reset(); assert.equal(store.read().versions.length, 0);
  }
});

test('other tabs cannot silently overwrite each other; explicit reread resumes saving', () => {
  const storage = memory(), a = createWorkbenchStorage(storage), b = createWorkbenchStorage(storage); a.read(); b.read();
  a.save({ draft: draft('标签页 A') }); const bytes = storage.getItem();
  assert.throws(() => b.save({ draft: draft('标签页 B') }), /WORKSPACE_CONFLICT/);
  assert.equal(storage.getItem(), bytes); assert.throws(() => b.save({ draft: draft('B') }), /WORKSPACE_BLOCKED/);
  assert.equal(b.read().draft.text, '标签页 A'); b.save({ draft: draft('明确接续') });
  assert.equal(createWorkbenchStorage(storage).read().draft.text, '明确接续');
});

test('unavailable browser storage does not pretend to save; invalid played state preserves bytes', async () => {
  const denied = createWorkbenchStorage({ getItem() { throw new Error('SecurityError'); } });
  assert.throws(() => denied.read(), /WORKSPACE_UNAVAILABLE/);
  const storage = memory(), store = createWorkbenchStorage(storage); store.read(); const bundle = await panel();
  store.save({ draft: draft('正常'), panel: bundle }); const bytes = storage.getItem();
  assert.throws(() => store.save({ draft: draft('错误'), panel: bundle, state: { unknown: true } }));
  assert.equal(storage.getItem(), bytes);
});

test('restoring an empty workspace clears panel, contexts and undo without retaining a stale export', async () => {
  const model = await controller(); await model.importPanel(await panel());
  await model.prepare({ requestVersion: '0.1', id: 'draft', text: '修改声音设置', target: 'pixi' });
  model.clear();
  assert.equal(model.getSnapshot().panel, null); assert.equal(model.getSnapshot().context, null);
  assert.equal(model.getSnapshot().phase, 'empty'); assert.equal(model.getSnapshot().canUndo, false);
  await assert.rejects(model.exportPanel(), /WORKBENCH_PANEL_REQUIRED/);
});

test('starting a new panel persists a blank active draft while retaining exact history, played values and edit usage', async () => {
  const storage = memory(), store = createWorkbenchStorage(storage); store.read();
  const bundle = await panel(), values = { ...bundle.state, [bundle.spec.state.find(f => f.type === 'number').id]: 37 };
  store.save({ draft: draft('原需求'), panel: bundle, state: values, editUsage: { [bundle.spec.id]: 4 } });
  const previous = store.snapshot(), next = store.startNew();
  assert.equal(next.currentId, null); assert.deepEqual(next.draft, emptyWorkbenchDraft());
  assert.deepEqual(next.versions, previous.versions); assert.deepEqual(next.editUsage, previous.editUsage);
  const reopened = createWorkbenchStorage(storage), read = reopened.read(); assert.deepEqual(read, next);
  reopened.save({ draft: draft('新需求'), editUsage: read.editUsage });
  assert.equal(reopened.snapshot().currentId, null); assert.deepEqual(reopened.snapshot().versions, previous.versions);
  const old = previous.versions[0]; reopened.save({ draft: old.draft, panel: old.panel, state: old.state });
  assert.equal(reopened.snapshot().currentId, old.id); assert.deepEqual(reopened.snapshot().editUsage, previous.editUsage);
});

test('new-panel quota and concurrent-tab failures preserve the last complete save and selected history', async () => {
  const storage = memory(), store = createWorkbenchStorage(storage); store.read();
  store.save({ draft: draft('保留'), panel: await panel() }); const before = store.snapshot(), raw = storage.getItem();
  storage.setQuota(true); assert.throws(() => store.startNew(), /WORKSPACE_QUOTA/);
  assert.equal(storage.getItem(), raw); assert.deepEqual(store.snapshot(), before); storage.setQuota(false);
  storage.replace(raw + ' '); assert.throws(() => store.startNew(), /WORKSPACE_CONFLICT/);
  assert.equal(storage.getItem(), raw + ' '); assert.deepEqual(store.snapshot(), before);
  assert.throws(() => store.startNew(), /WORKSPACE_BLOCKED/);
});

test('new-panel action is idempotent on a blank draft and requires an initialized, readable store', () => {
  const storage = memory(), store = createWorkbenchStorage(storage);
  assert.throws(() => store.startNew(), /WORKSPACE_BLOCKED/); store.read();
  const first = store.startNew(), writes = storage.writes; assert.deepEqual(store.startNew(), first); assert.equal(storage.writes, writes);
  storage.replace('{'); assert.throws(() => store.read(), /WORKSPACE_INVALID/);
  assert.throws(() => store.startNew(), /WORKSPACE_BLOCKED/); assert.equal(storage.getItem(), '{');
});

test('clearing the active panel never refunds its already used edit rounds', async () => {
  const model = await controller(), bundle = await panel(); await model.importPanel(bundle);
  model.restoreEditUsage({ [bundle.spec.id]: 4 }); model.clear();
  assert.equal(model.getSnapshot().panel, null); assert.equal(model.getEditSnapshot().context, null);
  assert.deepEqual(model.getEditUsage(), { [bundle.spec.id]: 4 });
  await model.importPanel(bundle); assert.equal(model.getEditBudget().used, 4);
});
