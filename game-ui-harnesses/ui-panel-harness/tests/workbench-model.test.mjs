import test from 'node:test';
import assert from 'node:assert/strict';
import { core, fixture, catalog, copy } from './helpers.mjs';
import { createWorkbenchModel } from '../src/workbench-model.mjs';
import { createPanelBundle, validatePanelBundle } from '../src/panel-bundle.mjs';
import { proposalTargets } from '../src/proposal.mjs';
import { digestBytes, digestJson } from '../src/canonical.mjs';

const request = (id = 'settings-request') => ({ requestVersion: '0.1', id,
  text: '设置面板，音量初始 80，范围 0 到 100，声音开关初始开启，两个控件保持独立。', target: 'pixi' });
const model = customCore => createWorkbenchModel({ catalog, pool: null }, customCore ?? core);
const bundle = () => createPanelBundle(fixture, catalog, core);
function proposalFor(context, spec = copy(fixture)) {
  return { proposalVersion: context.planningContextVersion, contextSha256: context.sha256, spec, unresolved: [],
    decisions: proposalTargets(spec, context.planningContextVersion).map(target => ({ target,
      basis: { kind: 'request-interpretation', start: 0, end: context.request.text.length, quote: context.request.text },
    })) };
}
async function patchFor(spec, operations) {
  return { patchVersion: '0.1', baseSpecSha256: await digestJson(spec), reason: 'Explicit workbench fixture edit.', operations };
}
async function titlePatch(controller, title = '已修改的设置') {
  return patchFor(controller.getSnapshot().panel.spec, [{ op: 'set-panel-title', title }]);
}
function editProposalFor(context, operations, unresolved = []) {
  return { editProposalVersion: '0.1', contextSha256: context.sha256,
    patch: operations === null ? null : { patchVersion: '0.1', baseSpecSha256: context.baseSpecSha256,
      reason: 'Explicit editing fixture, not a model call.', operations },
    decisions: (operations ?? []).map((_, operationIndex) => ({ operationIndex,
      basis: { kind: 'request-interpretation', start: 0, end: context.request.text.length, quote: context.request.text } })),
    unresolved };
}
function gatedCore() {
  let pending = null;
  return { core: { ...core, async createBundle(...args) {
    if (pending) { const gate = pending; pending = null; gate.enter(); await gate.wait; }
    return core.createBundle(...args);
  } }, arm() {
    let release, enter;
    const wait = new Promise(resolve => { release = resolve; });
    const entered = new Promise(resolve => { enter = resolve; });
    pending = { wait, enter };
    return { release, entered };
  } };
}

test('prepare preserves exact request, exposes planning, and compiles an externally supplied proposal with the real core', async () => {
  const controller = await model();
  assert.deepEqual(controller.getSnapshot(), { phase: 'empty', context: null, proposal: null, report: null,
    panel: null, assetEvidence: null, history: [], canUndo: false });
  const input = request(), original = copy(input), pending = controller.prepare(input);
  assert.equal(controller.getSnapshot().phase, 'planning');
  input.text = 'caller changed input';
  const prepared = await pending;
  assert.equal(prepared.phase, 'awaiting-proposal'); assert.deepEqual(prepared.context.request, original);
  const proposed = proposalFor(prepared.context), accepted = controller.acceptProposal(proposed);
  proposed.spec.title = 'caller changed proposal';
  const ready = await accepted;
  assert.equal(ready.phase, 'ready'); assert.equal(ready.report.status, 'READY_TO_COMPILE');
  assert.equal(ready.panel.spec.title, fixture.title); assert.equal(ready.assetEvidence, null);
  assert.deepEqual(await validatePanelBundle(ready.panel, core), ready.panel);
  ready.panel.spec.title = 'caller changed snapshot'; ready.history.push({ forged: true });
  assert.equal(controller.getSnapshot().panel.spec.title, fixture.title);
  assert.deepEqual(controller.getSnapshot().history, []);
});

test('unresolved questions retain the previous panel and never invoke compilation', async () => {
  let compilationCalls = 0;
  const counting = { ...core, createBundle(...args) { compilationCalls++; return core.createBundle(...args); } };
  const controller = await model(counting), previous = await bundle();
  await controller.importPanel(previous);
  const prepared = await controller.prepare(request());
  assert.deepEqual(prepared.panel, previous);
  const before = compilationCalls;
  const result = await controller.acceptProposal({ proposalVersion: prepared.context.planningContextVersion,
    contextSha256: prepared.context.sha256, spec: null, decisions: [],
    unresolved: [{ id: 'defaults', question: '恢复默认应包含哪些设置？' }] });
  assert.equal(result.phase, 'needs-input'); assert.equal(result.report.status, 'NEEDS_INPUT');
  assert.deepEqual(result.panel, previous); assert.equal(compilationCalls, before);
});

test('wrong context, missing context and failed prepare preserve the last stable model', async () => {
  const controller = await model();
  await assert.rejects(controller.acceptProposal({}), /WORKBENCH_CONTEXT_REQUIRED/);
  const prepared = await controller.prepare(request());
  const wrong = proposalFor(prepared.context); wrong.contextSha256 = '0'.repeat(64);
  await assert.rejects(controller.acceptProposal(wrong), { code: 'PLAN_CONTEXT_MISMATCH' });
  assert.deepEqual(controller.getSnapshot(), prepared);
  await assert.rejects(controller.prepare({ ...request(), text: '' }));
  assert.deepEqual(controller.getSnapshot(), prepared);
});

async function awaitingAnswers(controller, id = 'clarification-request') {
  const prepared = await controller.prepare(request(id));
  const proposal = { proposalVersion: prepared.context.planningContextVersion, contextSha256: prepared.context.sha256,
    spec: null, decisions: [], unresolved: [{ id: 'defaults', question: '默认音量是多少？' }] };
  await controller.acceptProposal(proposal);
  return { context: prepared.context, proposal, input: { clarificationVersion: '0.1', contextSha256: prepared.context.sha256,
    proposalSha256: await digestJson(proposal), answers: [{ questionId: 'defaults', text: '默认音量为 60。' }] } };
}

test('answers prepare a new context without compiling, preserving the old panel and rejecting the old proposal', async () => {
  let compilationCalls = 0;
  const counting = { ...core, createBundle(...args) { compilationCalls++; return core.createBundle(...args); } };
  const controller = await model(counting), previous = await bundle();
  await controller.importPanel(previous);
  const source = await awaitingAnswers(controller), before = compilationCalls;
  const pending = controller.clarify(source.input);
  assert.equal(controller.getSnapshot().phase, 'planning');
  source.input.answers[0].text = 'caller changed answer';
  const next = await pending;
  assert.equal(next.phase, 'awaiting-proposal'); assert.equal(next.proposal, null); assert.equal(next.report, null);
  assert.deepEqual(next.panel, previous); assert.equal(compilationCalls, before);
  assert(next.context.request.text.startsWith(source.context.request.text));
  assert(next.context.request.text.includes('默认音量为 60。')); assert(!next.context.request.text.includes('caller changed answer'));
  assert.notEqual(next.context.sha256, source.context.sha256);
  await assert.rejects(controller.acceptProposal(source.proposal), { code: 'PLAN_CONTEXT_MISMATCH' });
  assert.deepEqual(controller.getSnapshot(), next);
});

test('missing answers, stale question sets and answers outside needs-input leave the model unchanged', async () => {
  const controller = await model();
  await assert.rejects(controller.clarify({}), /WORKBENCH_CLARIFICATION_REQUIRED/);
  const source = await awaitingAnswers(controller), before = controller.getSnapshot();
  await assert.rejects(controller.clarify({ ...source.input, answers: [] }));
  assert.deepEqual(controller.getSnapshot(), before);
  const revised = { ...source.proposal, unresolved: [{ id: 'defaults', question: '默认音量及范围是多少？' }] };
  await controller.acceptProposal(revised); const current = controller.getSnapshot();
  await assert.rejects(controller.clarify(source.input));
  assert.deepEqual(controller.getSnapshot(), current);
  await controller.prepare(request('new-request')); const prepared = controller.getSnapshot();
  await assert.rejects(controller.clarify(source.input), /WORKBENCH_CLARIFICATION_REQUIRED/);
  assert.deepEqual(controller.getSnapshot(), prepared);
});

test('a newer request or disposal supersedes in-flight clarification without committing its answers', async () => {
  const controller = await model(), source = await awaitingAnswers(controller);
  const pending = controller.clarify(source.input);
  const newest = await controller.prepare(request('newest-request'));
  assert.deepEqual(await pending, { status: 'STALE' }); assert.deepEqual(controller.getSnapshot(), newest);
  const other = await model(), second = await awaitingAnswers(other);
  const discarded = other.clarify(second.input); other.dispose();
  assert.deepEqual(await discarded, { status: 'STALE' });
});

test('asset-bearing proposals cannot bypass retrieval by attaching assets to a context without a pool', async () => {
  const controller = await model(), prepared = await controller.prepare(request());
  const spec = copy(fixture); spec.panelSpecVersion = '0.2';
  spec.assets = { library: { id: 'test-kit', sha256: 'a'.repeat(64) }, panelSurface: null,
    rowIcons: [{ rowId: 'volume-row', asset: 'test-kit/volume@1.0.0' }] };
  await assert.rejects(controller.acceptProposal(proposalFor(prepared.context, spec)), /WORKBENCH_ASSET_CONTEXT_REQUIRED/);
  assert.deepEqual(controller.getSnapshot(), prepared);
});

test('patches preserve live values, initialize added fields explicitly, and undo restores the exact pre-edit state bundle', async () => {
  const controller = await model(); await controller.importPanel(await bundle());
  const original = controller.getSnapshot().panel;
  const operations = [
    { op: 'set-state-initial', fieldId: 'volume', value: 40 },
    { op: 'add-row', sectionId: 'audio', afterRowId: 'audio-enabled-row',
      row: { id: 'music-row', kind: 'switch', recipe: { id: 'settings.switch', version: '0.1.0' }, label: '音乐',
        bind: 'music', enabled: true, event: 'audio.musicChanged' },
      state: { id: 'music', type: 'boolean', initial: false } },
  ];
  const instruction = await patchFor(original.spec, operations), saved = { volume: 25, audioEnabled: false };
  const pending = controller.patch(instruction, saved);
  instruction.operations[0].value = 90; saved.volume = 99;
  const edited = await pending;
  assert.deepEqual(edited.panel.state, { volume: 25, audioEnabled: false, music: false });
  assert.equal(edited.panel.spec.state[0].initial, 40); assert.equal(edited.history.length, 1);
  assert.equal(edited.history[0].receipt.status, 'APPLIED'); assert.equal(edited.canUndo, true);
  const expected = await createPanelBundle(original.spec, original.catalog, core, { volume: 25, audioEnabled: false });
  const restored = await controller.undo();
  assert.deepEqual(restored.panel, expected); assert.deepEqual(restored.history, []); assert.equal(restored.canUndo, false);
  await assert.rejects(controller.undo(), /WORKBENCH_UNDO_EMPTY/);
});

test('patch failure is atomic across malformed state, source pin and valid spec with impossible geometry', async () => {
  const controller = await model(); await controller.importPanel(await bundle());
  await controller.patch(await titlePatch(controller));
  const before = controller.getSnapshot(), valid = await titlePatch(controller, 'Next');
  await assert.rejects(controller.patch(valid, { volume: 500, audioEnabled: true }));
  const wrong = copy(valid); wrong.baseSpecSha256 = 'a'.repeat(64);
  await assert.rejects(controller.patch(wrong), { code: 'base-digest' });
  const impossible = await patchFor(before.panel.spec, [{ op: 'set-layout', layout: { ...before.panel.spec.layout, labelWidth: 500 } }]);
  await assert.rejects(controller.patch(impossible));
  assert.deepEqual(controller.getSnapshot(), before);
});

test('presentation failure retains the committed panel and undo history for every panel replacement', async () => {
  let rejectPresentation = false;
  const controller = await createWorkbenchModel({ catalog, pool: null }, core, async () => {
    if (rejectPresentation) throw new Error('TEXT_OVERFLOW');
  });
  const prepared = await controller.prepare(request());
  await controller.acceptProposal(proposalFor(prepared.context));
  await controller.patch(await titlePatch(controller), { volume: 25, audioEnabled: false });
  const before = controller.getSnapshot();
  rejectPresentation = true;
  await assert.rejects(controller.patch(await titlePatch(controller, '设置'.repeat(60))), /TEXT_OVERFLOW/);
  assert.deepEqual(controller.getSnapshot(), before);
  await assert.rejects(controller.undo(), /TEXT_OVERFLOW/);
  assert.deepEqual(controller.getSnapshot(), before);
  await assert.rejects(controller.importPanel(await bundle()), /TEXT_OVERFLOW/);
  assert.deepEqual(controller.getSnapshot(), before);
  await assert.rejects(controller.acceptProposal(proposalFor(before.context)), /TEXT_OVERFLOW/);
  assert.deepEqual(controller.getSnapshot(), before);
  // Export is independent of presentation and remains usable after a failed edit.
  assert.deepEqual((await controller.exportPanel()).state, { volume: 25, audioEnabled: false });
  rejectPresentation = false;
  const undone = await controller.undo();
  assert.equal(undone.panel.spec.title, fixture.title);
  assert.deepEqual(undone.panel.state, { volume: 25, audioEnabled: false });
  assert.deepEqual(undone.history, []);
});

test('presentation receives an isolated candidate while the previous model stays committed', async () => {
  let controller, presented = null;
  controller = await createWorkbenchModel({ catalog, pool: null }, core, async (candidate, isCurrent) => {
    assert.equal(isCurrent(), true);
    assert.equal(controller.getSnapshot().panel, null);
    presented = copy(candidate);
    candidate.spec.title = 'host changed its copy';
  });
  const ready = await controller.importPanel(await bundle());
  assert.deepEqual(ready.panel, presented);
  assert.equal(ready.panel.spec.title, fixture.title);
});

test('a superseded presentation cannot commit over a newer request', async () => {
  let enter, release, current;
  const entered = new Promise(resolve => { enter = resolve; });
  const wait = new Promise(resolve => { release = resolve; });
  const controller = await createWorkbenchModel({ catalog, pool: null }, core, async (_candidate, isCurrent) => {
    current = isCurrent; enter(); await wait;
  });
  const pending = controller.importPanel(await bundle());
  await entered;
  assert.equal(current(), true);
  const fresh = await controller.prepare(request('newer'));
  assert.equal(current(), false);
  release();
  assert.deepEqual(await pending, { status: 'STALE' });
  assert.deepEqual(controller.getSnapshot(), fresh);
  assert.equal(fresh.panel, null);
});

test('patch history does not rewrite original proposal or planning evidence and is bounded to sixteen edits', async () => {
  const controller = await model(), prepared = await controller.prepare(request());
  const ready = await controller.acceptProposal(proposalFor(prepared.context));
  for (let i = 0; i < 16; i++) await controller.patch(await titlePatch(controller, `设置 ${i}`));
  const full = controller.getSnapshot();
  assert.equal(full.history.length, 16); assert.deepEqual(full.context, ready.context);
  assert.deepEqual(full.proposal, ready.proposal); assert.deepEqual(full.report, ready.report);
  await assert.rejects(controller.patch(await titlePatch(controller, 'Overflow')), /WORKBENCH_HISTORY_LIMIT/);
  assert.deepEqual(controller.getSnapshot(), full);
  await controller.undo(); assert.equal(controller.getSnapshot().history.length, 15);
});

test('export is a separately validated live-state snapshot and never changes model state or undo history', async () => {
  const controller = await model(); await controller.importPanel(await bundle());
  await controller.patch(await titlePatch(controller));
  const before = controller.getSnapshot(), values = { volume: 17, audioEnabled: false };
  const pending = controller.exportPanel(values); values.volume = 99;
  const exported = await pending;
  assert.deepEqual(exported.state, { volume: 17, audioEnabled: false });
  assert.deepEqual(await validatePanelBundle(exported, core), exported);
  assert.deepEqual(controller.getSnapshot(), before);
  exported.spec.title = 'changed export';
  await assert.rejects(controller.exportPanel({ volume: -1, audioEnabled: true }));
  assert.deepEqual(controller.getSnapshot(), before);
});

test('invalid imported bundles preserve an existing panel and history; valid import clears planning and history', async () => {
  const controller = await model(), prepared = await controller.prepare(request());
  await controller.acceptProposal(proposalFor(prepared.context));
  await controller.patch(await titlePatch(controller));
  const before = controller.getSnapshot(), bad = copy(before.panel); bad.state.volume = 10;
  await assert.rejects(controller.importPanel(bad), /MISMATCH/);
  assert.deepEqual(controller.getSnapshot(), before);
  const replacement = await bundle(), pending = controller.importPanel(replacement);
  replacement.spec.title = 'changed after call';
  const imported = await pending;
  assert.equal(imported.phase, 'ready'); assert.equal(imported.context, null); assert.equal(imported.proposal, null);
  assert.equal(imported.report, null); assert.equal(imported.assetEvidence, null);
  assert.deepEqual(imported.history, []); assert.equal(imported.canUndo, false); assert.equal(imported.panel.spec.title, fixture.title);
});

test('overlapping prepare calls commit only the newest context', async () => {
  const controller = await model();
  const old = controller.prepare(request('old')), fresh = controller.prepare(request('fresh'));
  assert.deepEqual(await old, { status: 'STALE' });
  const result = await fresh;
  assert.equal(result.context.request.id, 'fresh'); assert.deepEqual(controller.getSnapshot(), result);
});

test('a pending proposal cannot replace a newer request and stale failures cannot reset its phase', async () => {
  const gated = gatedCore(), controller = await model(gated.core);
  const first = await controller.prepare(request('old')), gate = gated.arm();
  const pending = controller.acceptProposal(proposalFor(first.context)); await gate.entered;
  const next = await controller.prepare(request('fresh'));
  gate.release();
  assert.deepEqual(await pending, { status: 'STALE' }); assert.deepEqual(controller.getSnapshot(), next);
  assert.equal(next.panel, null);
});

test('new imports supersede pending patches and dispose prevents a pending compile from committing', async () => {
  const gated = gatedCore(), controller = await model(gated.core);
  const original = await bundle(); await controller.importPanel(original);
  const gate = gated.arm(), pending = controller.patch(await titlePatch(controller)); await gate.entered;
  const replacement = await controller.importPanel(original); gate.release();
  assert.deepEqual(await pending, { status: 'STALE' }); assert.deepEqual(controller.getSnapshot(), replacement);
  const disposeGate = gated.arm(), finishing = controller.exportPanel(); await disposeGate.entered;
  controller.dispose(); controller.dispose(); disposeGate.release();
  assert.deepEqual(await finishing, { status: 'STALE' });
  await assert.rejects(controller.prepare(request()), /WORKBENCH_DISPOSED/);
  await assert.rejects(controller.undo(), /WORKBENCH_DISPOSED/);
});

test('seed, proposal, patch and state accessors are rejected without invoking caller code', async () => {
  let invoked = false;
  const getter = () => { invoked = true; throw new Error('caller getter'); };
  const seed = { pool: null }; Object.defineProperty(seed, 'catalog', { enumerable: true, get: getter });
  await assert.rejects(createWorkbenchModel(seed, core), /WORKBENCH_SEED/);
  const controller = await model(); await controller.importPanel(await bundle());
  const before = controller.getSnapshot(), instruction = await titlePatch(controller);
  const input = { audioEnabled: true }; Object.defineProperty(input, 'volume', { enumerable: true, get: getter });
  await assert.rejects(controller.patch(instruction, input), { code: 'accessor' });
  Object.defineProperty(instruction, 'operations', { enumerable: true, get: getter });
  await assert.rejects(controller.patch(instruction), { code: 'accessor' });
  const proposed = {}; Object.defineProperty(proposed, 'spec', { enumerable: true, get: getter });
  await assert.rejects(controller.acceptProposal(proposed), { code: 'accessor' });
  assert.equal(invoked, false); assert.deepEqual(controller.getSnapshot(), before);
});

test('imported asset bundles patch offline by selecting only still-referenced verified embedded bytes', async () => {
  // Explicit PNG header fixtures exercise the portable byte contract, not image decoding.
  const entries = await Promise.all(['volume', 'speaker'].map(async (name, index) => {
    const bytes = new Uint8Array(45); bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(bytes.buffer); view.setUint32(8, 13); bytes.set([73, 72, 68, 82], 12);
    view.setUint32(16, 24); view.setUint32(20, 24); bytes[24] = 8; bytes[25] = 6; bytes[44] = index;
    const sha256 = await digestBytes(bytes);
    return { record: { key: `test-kit/${name}@1.0.0`, role: 'icon', width: 24, height: 24, slice: null, sha256, bytes: bytes.length },
      resource: { path: `textures/${sha256}.png`, mime: 'image/png', bytes } };
  }));
  const spec = copy(fixture); spec.panelSpecVersion = '0.2';
  spec.assets = { library: { id: 'offline-assets', sha256: 'a'.repeat(64) }, panelSurface: null,
    rowIcons: [{ rowId: 'volume-row', asset: entries[0].record.key }, { rowId: 'audio-enabled-row', asset: entries[1].record.key }] };
  const assets = { closure: { assetClosureVersion: '0.1', library: copy(spec.assets.library),
    records: entries.map(entry => entry.record).sort((a, b) => a.key.localeCompare(b.key)) }, resources: entries.map(entry => entry.resource) };
  const original = await createPanelBundle(spec, catalog, core, undefined, assets), controller = await model();
  await controller.importPanel(original);
  const instruction = await patchFor(spec, [{ op: 'remove-row', rowId: 'volume-row' }]);
  const edited = await controller.patch(instruction, { volume: 25, audioEnabled: false });
  assert.deepEqual(edited.panel.state, { audioEnabled: false });
  assert.deepEqual(edited.panel.assetClosure.records.map(record => record.key), [entries[1].record.key]);
  assert.equal(edited.panel.componentBundle.resources.length, 1); assert.equal(edited.assetEvidence, null);
  assert.deepEqual(await validatePanelBundle(edited.panel, core), edited.panel);
  const restored = await controller.undo();
  assert.equal(restored.panel.assetClosure.records.length, 2); assert.deepEqual(restored.panel.state, { volume: 25, audioEnabled: false });
});

test('edit proposals add only the requested field, keep current values and undo the whole edit with planning evidence', async () => {
  const controller = await model(); await controller.importPanel(await bundle());
  const before = controller.getSnapshot(), instruction = { ...request('panel-edit'), text: '在声音开关后新增独立的音效滑条，0–100、步长1、默认60，其他不变。' };
  const prepared = await controller.prepareEdit(instruction);
  assert.deepEqual(controller.getSnapshot(), before);
  assert.equal(Object.hasOwn(prepared.context, 'state'), false);
  const row = { id: 'sfx-row', kind: 'slider', recipe: { id: 'settings.slider', version: '0.1.0' }, label: '音效',
    bind: 'sfx', enabled: true, event: 'audio.sfxChanged', format: { fractionDigits: 0, prefix: '', suffix: '%' } };
  const proposed = editProposalFor(prepared.context, [{ op: 'add-row', sectionId: 'audio', afterRowId: 'audio-enabled-row', row,
    state: { id: 'sfx', type: 'number', initial: 60, min: 0, max: 100, step: 1 } }]);
  const current = { volume: 25, audioEnabled: false }, applying = controller.acceptEditProposal(proposed, current);
  current.volume = 99; proposed.patch.operations[0].row.label = 'caller mutation';
  const edited = await applying;
  assert.deepEqual(edited.panel.state, { volume: 25, audioEnabled: false, sfx: 60 });
  assert.deepEqual(edited.panel.spec.sections[0].rows.slice(0, 2), before.panel.spec.sections[0].rows);
  assert.equal(edited.panel.spec.sections[0].rows[2].label, '音效');
  assert.equal(edited.history[0].editEvidence.context.sha256, prepared.context.sha256);
  assert.equal(edited.history[0].editEvidence.report.status, 'READY_TO_APPLY');
  assert.equal(controller.getEditSnapshot().context, null);
  const undone = await controller.undo();
  assert.deepEqual(undone.panel.spec, before.panel.spec); assert.deepEqual(undone.panel.state, { volume: 25, audioEnabled: false });
});

test('unresolved edits do not compile and failed edit application preserves both panel and prepared edit context', async () => {
  let calls = 0, rejectRender = false;
  const counting = { ...core, createBundle(...args) { calls++; return core.createBundle(...args); } };
  const controller = await createWorkbenchModel({ catalog, pool: null }, counting, async () => { if (rejectRender) throw new Error('TEXT_OVERFLOW'); });
  await controller.importPanel(await bundle());
  const prepared = await controller.prepareEdit(request('panel-edit')), before = controller.getSnapshot(), count = calls;
  const question = editProposalFor(prepared.context, null, [{ id: 'value', question: '新默认值是多少？' }]);
  const needsInput = await controller.acceptEditProposal(question, { volume: 25, audioEnabled: false });
  assert.equal(needsInput.report.status, 'NEEDS_INPUT'); assert.equal(calls, count); assert.deepEqual(controller.getSnapshot(), before);
  const proposal = editProposalFor(prepared.context, [{ op: 'set-panel-title', title: '音频偏好' }]);
  const oldEdit = controller.getEditSnapshot(); rejectRender = true;
  await assert.rejects(controller.acceptEditProposal(proposal), /TEXT_OVERFLOW/);
  assert.deepEqual(controller.getSnapshot(), before); assert.deepEqual(controller.getEditSnapshot(), oldEdit);
});

test('changing a panel invalidates edit context, while failed unrelated patches retain it', async () => {
  const controller = await model(); await controller.importPanel(await bundle());
  const prepared = await controller.prepareEdit(request('panel-edit'));
  const proposed = editProposalFor(prepared.context, [{ op: 'set-panel-title', title: '新标题' }]);
  const bad = await titlePatch(controller); bad.baseSpecSha256 = '0'.repeat(64);
  await assert.rejects(controller.patch(bad)); assert.deepEqual(controller.getEditSnapshot(), prepared);
  await controller.patch(await titlePatch(controller));
  assert.equal(controller.getEditSnapshot().context, null);
  await assert.rejects(controller.acceptEditProposal(proposed), /WORKBENCH_EDIT_CONTEXT_REQUIRED/);
  const next = await controller.prepareEdit(request('different-edit'));
  await assert.rejects(controller.acceptEditProposal(proposed)); assert.deepEqual(controller.getEditSnapshot(), next);
});

test('a successful no-op edit consumes its context and any earlier unresolved report', async () => {
  const controller = await model(); await controller.importPanel(await bundle());
  const before = controller.getSnapshot(), prepared = await controller.prepareEdit(request('panel-edit'));
  await controller.acceptEditProposal(editProposalFor(prepared.context, null, [{ id: 'title', question: '保留原标题吗？' }]));
  const proposal = editProposalFor(prepared.context, [{ op: 'set-panel-title', title: before.panel.spec.title }]);
  const result = await controller.acceptEditProposal(proposal);
  assert.equal(result.panel.sha256, before.panel.sha256); assert.equal(result.history.length, 1);
  assert.deepEqual(controller.getEditSnapshot(), { context: null, proposal: null, report: null });
  await assert.rejects(controller.acceptEditProposal(proposal), /WORKBENCH_EDIT_CONTEXT_REQUIRED/);
  assert.equal(controller.getSnapshot().history.length, 1);
});

test('new edits and panel imports supersede pending edit work; disposal prevents committing an edit', async () => {
  const gated = gatedCore(), controller = await model(gated.core); await controller.importPanel(await bundle());
  const pending = controller.prepareEdit(request('old-edit')), newest = await controller.prepareEdit(request('new-edit'));
  assert.deepEqual(await pending, { status: 'STALE' }); assert.deepEqual(controller.getEditSnapshot(), newest);
  const proposed = editProposalFor(newest.context, [{ op: 'set-panel-title', title: '新标题' }]), gate = gated.arm();
  const applying = controller.acceptEditProposal(proposed); await gate.entered;
  const replacement = await controller.importPanel(await bundle()); gate.release();
  assert.deepEqual(await applying, { status: 'STALE' }); assert.deepEqual(controller.getSnapshot(), replacement);
  const last = await controller.prepareEdit(request('last-edit')), secondGate = gated.arm();
  const discarded = controller.acceptEditProposal(editProposalFor(last.context, [{ op: 'set-panel-title', title: '丢弃' }]));
  await secondGate.entered; controller.dispose(); secondGate.release(); assert.deepEqual(await discarded, { status: 'STALE' });
});
