import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';
import { CODEX_MODEL, CODEX_EFFORT, findCodexExecutable, planWithCodex, editWithCodex, validateCodexReceipt, validateCodexEditReceipt } from '../src/codex-planner.mjs';
import { createPanelEditContext, checkPanelEditProposal } from '../src/edit-planning.mjs';
import { digestJson, digestBytes } from '../src/canonical.mjs';
import { validateCodexDiagnostic } from '../src/codex-diagnostics.mjs';
import { buildCodexEditResponseSchema } from '../src/codex-edit-schema.mjs';
import { applyPanelPatch } from '../src/patch.mjs';
import { harnessRoot } from '../src/io.mjs';
import { createPlanningContext } from '../src/planning-context.mjs';
import { proposalTargets } from '../src/proposal.mjs';
import { PANEL_EVALUATION_SUITE } from '../examples/panel-evaluation/suite.mjs';
import { compactIntentFixture } from '../examples/panel-evaluation/intent-fixture.mjs';

const json = async path => JSON.parse(await readFile(path, 'utf8'));
const catalog = await json(join(harnessRoot, 'examples/modern-mint-controls.catalog.json'));
const sourceSpec = await json(join(harnessRoot, 'examples/settings-controls.panel.json'));
const request = { requestVersion: '0.1', id: 'codex-transport', target: 'pixi',
  text: await readFile(join(harnessRoot, 'examples/controls-planning/request.txt'), 'utf8') };
const context = await createPlanningContext(request, catalog);
const editContext = await createPanelEditContext(sourceSpec, catalog, { ...request, id: 'panel-edit', text: '把标题改成声音设置，其他设置保持不变。' });
const editProposalFor = input => ({ editProposalVersion: '0.1', contextSha256: input.sha256,
  patch: { patchVersion: '0.1', baseSpecSha256: input.baseSpecSha256, reason: '按当前请求修改标题。',
    operations: [{ op: 'set-panel-title', title: '声音设置' }] },
  decisions: [{ operationIndex: 0, basis: { kind: 'request-interpretation', start: 0, end: input.request.text.length, quote: input.request.text } }], unresolved: [] });
await mkdir(join(harnessRoot, '.tmp'), { recursive: true });
const work = await mkdtemp(join(harnessRoot, '.tmp', 'codex-transport-'));
const executable = join(work, process.platform === 'win32' ? 'codex.exe' : 'codex');
await writeFile(executable, 'This is a non-executable fixture. Tests only use fake child processes.');
let folderIndex = 0;
const output = () => join(work, `case-${folderIndex++}`);
const threadId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const beginning = [{ type: 'thread.started', thread_id: threadId }, { type: 'turn.started' }];
function proposalFor(input = context) {
  const spec = structuredClone(sourceSpec);
  spec.provenance = { kind: 'agent-authored', description: 'An external Agent proposal fixture, never a real model call.', assumptions: [] };
  return { proposalVersion: input.planningContextVersion, contextSha256: input.sha256, spec, unresolved: [],
    decisions: proposalTargets(spec, input.planningContextVersion).map(target => ({ target,
      basis: { kind: 'request-interpretation', start: 0, end: input.request.text.length, quote: input.request.text } })) };
}
const wrap = proposal => JSON.stringify({ proposalJson: JSON.stringify(proposal) });
function draftFor(input = context) {
  const proposal = proposalFor(input), spec = proposal.spec;
  const basis = target => structuredClone(proposal.decisions.find(item => item.target === target).basis);
  return { codexPanelDraftVersion: '0.1', contextSha256: input.sha256, spec, unresolved: [],
    bases: { panel: basis('panel'), theme: basis('theme'), canvas: basis('canvas'), layout: basis('layout'),
      assets: spec.assets ? { overall: basis('assets'), surface: spec.assets.panelSurface ? basis('asset:surface') : null,
        rowIcons: spec.assets.rowIcons.map(icon => basis(`asset:row:${icon.rowId}`)) } : null,
      sections: spec.sections.map(section => ({ section: basis(`section:${section.id}`), rows: section.rows.map(row => basis(`row:${row.id}`)) })),
      state: spec.state.map(field => basis(`state:${field.id}`)) } };
}
function completedEvents(final = wrap(proposalFor())) {
  return [...beginning, { type: 'item.completed', item: { type: 'agent_message', text: final } },
    { type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 50, private_endpoint: 'not copied' } }];
}
const sendEvents = (child, events, { trailingNewline = true } = {}) => child.stdout.write(Buffer.from(events.map(event => JSON.stringify(event)).join('\n') + (trailingNewline ? '\n' : '')));

/** Faithful child surface, no shell, executable, network or model is ever started. */
function fakeProcess(scenario = child => { sendEvents(child, completedEvents()); child.close(0); }) {
  const calls = [];
  const runProcess = (command, args, options) => {
    const child = new EventEmitter();
    const call = { command, args, options, prompt: '', child, kills: [] }; calls.push(call);
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    let closed = false;
    child.close = code => { if (closed) return; closed = true; child.emit('close', code); };
    child.kill = signal => { call.kills.push(signal); queueMicrotask(() => child.close(null)); return true; };
    child.stdin = new Writable({ write(chunk, encoding, callback) { call.prompt += chunk.toString(); callback(); },
      final(callback) { callback(); queueMicrotask(() => scenario(child, call)); } });
    return child;
  };
  return { calls, runProcess };
}
async function rejected(fake, code, { input = context, ...options } = {}) {
  const outputRoot = output();
  let caught;
  await assert.rejects(planWithCodex(input, { outputRoot, executable, runProcess: fake.runProcess, ...options }), error => {
    caught = error; assert.equal(error.code, code); assert.equal(error.message, code);
    assert.equal(error.message.includes(work), false); return true;
  });
  if (caught.receipt) {
    assert.equal(caught.receipt.status, 'FAILED'); assert.equal(caught.receipt.automaticRetries, 0);
    assert.equal(caught.receipt.failureCode, code);
    assert.equal(caught.receipt.proposalSha256, null);
    validateCodexReceipt(caught.receipt, { contextSha256: context.sha256 });
    assert.equal(JSON.stringify(caught.receipt).includes('private_endpoint'), false);
  }
  assert.ok(fake.calls.length <= 1, 'never retries failed or indeterminate requests');
  return { error: caught, outputRoot };
}

test('Codex editing accepts legacy native proposals under draft dispatch and writes distinct program-owned edit evidence', async () => {
  const fake = fakeProcess(async child => {
    const call = fake.calls[0];
    call.schema = await json(call.args[call.args.indexOf('--output-schema') + 1]);
    sendEvents(child, completedEvents(JSON.stringify(editProposalFor(editContext)))); child.close(0);
  });
  const outputRoot = output(), result = await editWithCodex(editContext, { outputRoot, executable, runProcess: fake.runProcess });
  assert.equal(fake.calls.length, 1); const call = fake.calls[0];
  assert.equal(call.options.shell, false); assert.equal(call.options.windowsHide, true);
  assert.equal(call.args[call.args.indexOf('--model') + 1], CODEX_MODEL);
  assert.ok(call.args.includes('model_reasoning_effort="xhigh"'));
  assert.ok(call.args.includes('features.shell_tool=false'));
  assert.ok(call.prompt.includes('UNTRUSTED TASK DATA')); assert.ok(call.prompt.includes('panel-editor.md'));
  assert.ok(call.prompt.includes('panel-edit-proposal.schema.json')); assert.ok(call.prompt.includes('reset-initial'));
  assert.ok(call.prompt.includes('Do not wrap it in proposalJson'));
  assert.deepEqual(call.schema.required.sort(), ['bases', 'codexEditDraftVersion', 'contextSha256', 'patch', 'unresolved']);
  assert.equal(Object.hasOwn(call.schema.properties, 'proposalJson'), false);
  assert.ok(call.prompt.includes(JSON.stringify(editContext.request.text))); assert.ok(call.prompt.includes(editContext.baseSpecSha256));
  assert.equal(call.prompt.includes(executable), false);
  assert.deepEqual(result.report, await checkPanelEditProposal(editContext, result.proposal));
  assert.equal(result.report.status, 'READY_TO_APPLY'); assert.equal(result.report.compilation, 'NOT_RUN');
  assert.equal(result.receipt.codexEditingReceiptVersion, '0.1'); assert.equal(result.receipt.automaticRetries, 0);
  validateCodexEditReceipt(result.receipt, { contextSha256: editContext.sha256, proposalSha256: await digestJson(result.proposal) });
  const names = await readdir(outputRoot); assert.equal(names.length, 1); assert.match(names[0], /^codex-edit-[0-9a-f-]{36}$/);
  const directory = join(outputRoot, names[0]);
  assert.deepEqual((await readdir(directory)).sort(), ['codex-edit-receipt.json', 'edit-context.json', 'edit-planning-report.json', 'edit-proposal.json']);
  assert.deepEqual(await json(join(directory, 'edit-context.json')), editContext);
  assert.deepEqual(await json(join(directory, 'edit-proposal.json')), result.proposal);
  assert.deepEqual(await json(join(directory, 'edit-planning-report.json')), result.report);
  assert.deepEqual(await json(join(directory, 'codex-edit-receipt.json')), result.receipt);
  assert.throws(() => validateCodexReceipt(result.receipt), { code: 'CODEX_RECEIPT_INVALID' });
  for (const change of [{ status: 'READY_TO_COMPILE' }, { privatePath: 'private' }, { invocationCount: 2 }])
    assert.throws(() => validateCodexEditReceipt({ ...result.receipt, ...change }), { code: 'CODEX_RECEIPT_INVALID' });
});

test('0.4 generation uses concise native intent, deterministic bindings and preserved accepted intent', async () => {
  const item = PANEL_EVALUATION_SUITE.cases[15], layoutCatalog = await json(join(harnessRoot, 'examples/modern-mint-layout.catalog.json'));
  const input = await createPlanningContext(item.request, layoutCatalog), intent = compactIntentFixture(input, item);
  const fake = fakeProcess(async (child, call) => {
    call.schema = await json(call.args[call.args.indexOf('--output-schema') + 1]);
    sendEvents(child, completedEvents(JSON.stringify(intent))); child.close(0);
  });
  const outputRoot = output(), result = await planWithCodex(input, { outputRoot, executable, runProcess: fake.runProcess });
  assert.equal(fake.calls.length, 1); const call = fake.calls[0];
  assert(!call.schema.properties.proposalJson); assert(call.schema.properties.panelIntentVersion);
  assert.deepEqual(Object.keys(call.schema.properties), ['panelIntentVersion', 'contextSha256', 'panel', 'unresolved']);
  assert.deepEqual(Object.keys(call.schema.$defs.container.properties), ['kind', 'children']);
  const dispatchedRows = call.schema.$defs.body.anyOf[0].properties.rows.items.anyOf;
  for (const row of dispatchedRows) assert.equal(Object.keys(row.properties)[0], 'kind');
  const selectSchema = dispatchedRows.find(row => row.properties.kind.enum[0] === 'select');
  assert.deepEqual(Object.keys(selectSchema.properties.options.items.properties), ['label', 'initial']);
  assert(call.prompt.length < 50000); assert(call.prompt.includes(JSON.stringify(input.request.text)));
  assert.equal(result.report.status, 'READY_TO_COMPILE'); assert.equal(result.proposal.spec.state.length, 13);
  const [name] = await readdir(outputRoot);
  assert.deepEqual(await json(join(outputRoot, name, 'panel-intent.json')), intent);
  const broken = structuredClone(intent); broken.panel.body.children[0].rows[0].sourceQuote = 'absent';
  const bad = fakeProcess(child => { sendEvents(child, completedEvents(JSON.stringify(broken))); child.close(0); });
  await assert.rejects(planWithCodex(input, { outputRoot: output(), executable, runProcess: bad.runProcess }), error => {
    assert.equal(error.diagnostic.stage, 'intent-validation'); assert.equal(error.diagnostic.validatorCode, 'INTENT_QUOTE'); return true;
  });
  assert.equal(bad.calls.length, 1);
});

test('editing output schema has strict native shapes, all ten operations and local recursive layout references', async () => {
  const schema = await buildCodexEditResponseSchema(), operations = new Set(); let recursiveChildren = false;
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (value.$ref) {
      assert.match(value.$ref, /^#\/\$defs\/d\d+$/u);
      assert(schema.$defs[value.$ref.slice('#/$defs/'.length)]);
    }
    if (value.type === 'object') {
      assert.equal(value.additionalProperties, false);
      assert.deepEqual([...value.required].sort(), Object.keys(value.properties).sort());
      if (value.properties.op) operations.add(value.properties.op.enum[0]);
      if (value.properties.children?.items?.$ref) recursiveChildren = true;
    }
    for (const key of ['oneOf', 'allOf', 'if', 'then', 'else', '$id', 'pattern']) assert.equal(Object.hasOwn(value, key), false);
    Object.values(value).forEach(visit);
  };
  visit(schema);
  assert.deepEqual([...operations].sort(), ['add-row', 'remove-row', 'set-button-action', 'set-button-label', 'set-layout', 'set-panel-title', 'set-row-enabled', 'set-row-label', 'set-state-initial', 'set-theme']);
  assert.equal(recursiveChildren, true);
});

test('native multi-operation sound edits preserve existing IDs, reset scope and untouched defaults', async () => {
  const spec = await json(join(harnessRoot, 'examples/layout-v1/settings.panel.json'));
  const flowCatalog = await json(join(harnessRoot, 'examples/modern-mint-layout.catalog.json'));
  // Isolate the original three-control scenario from the larger layout fixture.
  const firstRows = spec.sections.flatMap(section => section.rows), originalSlider = firstRows.find(row => row.kind === 'slider');
  const originalToggle = firstRows.find(row => row.kind === 'switch');
  spec.state = spec.state.filter(field => [originalSlider.bind, originalToggle.bind].includes(field.id));
  spec.sections = [{ id: 'audio', title: '声音设置', rows: [originalSlider, originalToggle,
    { ...firstRows.find(row => row.kind === 'button'), action: { kind: 'reset-initial', fields: spec.state.map(field => field.id) } }] }];
  spec.layout = { ...spec.layout, width: 520, maxHeight: 400, overflow: 'error',
    body: { id: 'sound-column', kind: 'column', width: 'fill', gap: 12, align: 'start', children: [{ kind: 'section', sectionId: 'audio', width: 'fill' }] } };
  const source = await createPanelEditContext(spec, flowCatalog, { ...request, id: 'native-sound-edit',
    text: '保留现有控件和行为。主音量默认值改为 50；静音后新增音效音量滑条，范围 0～100，步长 1，默认 40。面板高度上限改为 480，其余布局保持。恢复默认按钮保留原有重置范围。' });
  const rows = spec.sections.flatMap(section => section.rows), slider = rows.find(row => row.kind === 'slider');
  const toggle = rows.find(row => row.kind === 'switch'), section = spec.sections.find(item => item.rows.includes(toggle));
  const operations = [{ op: 'set-state-initial', fieldId: slider.bind, value: 50 },
    { op: 'set-layout', layout: { ...spec.layout, maxHeight: 480 } },
    { op: 'add-row', sectionId: section.id, afterRowId: toggle.id,
      row: { ...slider, id: 'sfx-volume-row', bind: 'sfxVolume', label: '音效音量', event: 'audio.sfxVolumeChanged' },
      state: { id: 'sfxVolume', type: 'number', initial: 40, min: 0, max: 100, step: 1 } }];
  const proposal = { editProposalVersion: '0.1', contextSha256: source.sha256,
    patch: { patchVersion: '0.1', baseSpecSha256: source.baseSpecSha256, reason: '按当前原文修改默认值、布局和新增音效行。', operations },
    decisions: operations.map((_operation, operationIndex) => ({ operationIndex,
      basis: { kind: 'request-interpretation', start: 0, end: source.request.text.length, quote: source.request.text } })), unresolved: [] };
  const fake = fakeProcess(child => { sendEvents(child, completedEvents(JSON.stringify(proposal))); child.close(0); });
  const result = await editWithCodex(source, { outputRoot: output(), executable, runProcess: fake.runProcess });
  assert.equal(result.report.status, 'READY_TO_APPLY'); assert.equal(fake.calls.length, 1);
  const applied = (await applyPanelPatch(spec, result.proposal.patch)).spec;
  assert.equal(applied.id, spec.id); assert.equal(applied.layout.maxHeight, 480);
  assert.equal(applied.state.find(field => field.id === slider.bind).initial, 50);
  assert.equal(applied.state.find(field => field.id === 'sfxVolume').initial, 40);
  for (const row of rows) assert.deepEqual(applied.sections.flatMap(item => item.rows).find(item => item.id === row.id), row);
  for (const field of spec.state.filter(field => field.id !== slider.bind)) assert.deepEqual(applied.state.find(item => item.id === field.id), field);
});

test('native literal-quote edit drafts retain original input and derive a separately validated public proposal', async () => {
  const original = editProposalFor(editContext);
  const draft = { codexEditDraftVersion: '0.1', contextSha256: editContext.sha256, patch: original.patch,
    bases: [{ kind: 'request-interpretation', quote: '把标题改成声音设置' }], unresolved: [] };
  const fake = fakeProcess(child => { sendEvents(child, completedEvents(JSON.stringify(draft))); child.close(0); });
  const outputRoot = output(), result = await editWithCodex(editContext, { outputRoot, executable, runProcess: fake.runProcess });
  assert.equal(fake.calls.length, 1); assert.equal(result.receipt.automaticRetries, 0);
  assert.deepEqual(result.proposal.patch, draft.patch);
  assert.deepEqual(result.proposal.decisions, [{ operationIndex: 0, basis: { kind: 'request-interpretation', quote: draft.bases[0].quote, start: 0, end: 9 } }]);
  const directory = join(outputRoot, (await readdir(outputRoot))[0]);
  assert.deepEqual(await json(join(directory, 'codex-edit-draft.json')), draft);
  assert.deepEqual(await json(join(directory, 'edit-proposal.json')), result.proposal);
  assert.equal(result.receipt.proposalSha256, await digestJson(result.proposal));
  assert.notEqual(result.receipt.proposalSha256, await digestJson(draft));
});

test('invalid literal quotes are terminal and never fabricated, repaired or saved as an accepted draft', async () => {
  const draft = { codexEditDraftVersion: '0.1', contextSha256: editContext.sha256, patch: editProposalFor(editContext).patch,
    bases: [{ kind: 'request-interpretation', quote: 'SECRET_PRIVATE_QUOTE' }], unresolved: [] };
  const fake = fakeProcess(child => { sendEvents(child, completedEvents(JSON.stringify(draft))); child.close(0); });
  const outputRoot = output(); let caught;
  await assert.rejects(editWithCodex(editContext, { outputRoot, executable, runProcess: fake.runProcess }), error => { caught = error; return error.code === 'CODEX_PROPOSAL_INVALID'; });
  assert.equal(fake.calls.length, 1); assert.equal(caught.receipt.automaticRetries, 0);
  assert.equal(caught.diagnostic.validatorCode, 'EDIT_QUOTE'); assert.equal(caught.diagnostic.path, '$.bases[0].quote');
  assert.equal(caught.diagnostic.proposalJsonSha256, await digestBytes(new TextEncoder().encode(JSON.stringify(draft))));
  const directory = join(outputRoot, (await readdir(outputRoot))[0]);
  assert.deepEqual((await readdir(directory)).sort(), ['codex-edit-diagnostic.json', 'codex-edit-receipt.json', 'edit-context.json']);
  assert(!JSON.stringify(caught.diagnostic).includes('SECRET_PRIVATE_QUOTE'));
});

test('malformed structured and legacy edit outputs yield bound format diagnostics without repair or retry', async () => {
  for (const [final, validatorCode, path] of [
    ['{"editProposalVersion":"0.1", "private":"SECRET_VALUE"', 'OUTPUT_JSON', '$'],
    [JSON.stringify({ proposalJson: '{}', private: 'SECRET_VALUE' }), 'OUTPUT_WRAPPER', '$.proposalJson'],
    [JSON.stringify({ proposalJson: { private: 'SECRET_VALUE' } }), 'OUTPUT_WRAPPER', '$.proposalJson'],
    [JSON.stringify({ proposalJson: '{"private":"SECRET_VALUE"' }), 'OUTPUT_PROPOSAL_JSON', '$.proposalJson'],
  ]) {
    const fake = fakeProcess(child => { sendEvents(child, completedEvents(final)); child.close(0); });
    const outputRoot = output(); let caught;
    await assert.rejects(editWithCodex(editContext, { outputRoot, executable, runProcess: fake.runProcess }), error => {
      caught = error; return error.code === 'CODEX_OUTPUT_INVALID';
    });
    assert.equal(caught.diagnostic.stage, 'output-validation'); assert.equal(caught.diagnostic.validatorCode, validatorCode);
    assert.equal(caught.diagnostic.path, path); assert.equal(caught.diagnostic.proposalJsonSha256, await digestBytes(new TextEncoder().encode(final)));
    validateCodexDiagnostic(caught.diagnostic, { operation: 'edit', contextSha256: editContext.sha256 });
    assert.equal(fake.calls.length, 1); assert.equal(caught.receipt.automaticRetries, 0); assert.equal(caught.receipt.proposalSha256, null);
    const directory = join(outputRoot, (await readdir(outputRoot))[0]);
    assert.deepEqual((await readdir(directory)).sort(), ['codex-edit-diagnostic.json', 'codex-edit-receipt.json', 'edit-context.json']);
    const saved = await json(join(directory, 'codex-edit-diagnostic.json')); assert.deepEqual(saved, caught.diagnostic);
    assert.equal(JSON.stringify(saved).includes('SECRET_VALUE'), false);
  }
});

test('native edits cannot bypass source, evidence, operation or range checks', async () => {
  for (const mutate of [value => { value.contextSha256 = '0'.repeat(64); },
    value => { value.patch.baseSpecSha256 = '0'.repeat(64); },
    value => { value.decisions[0].basis.quote = 'fabricated'; },
    value => { value.patch.operations[0] = { op: 'set-state-initial', fieldId: sourceSpec.state.find(field => field.type === 'number').id, value: -1000 }; },
    value => { value.patch.operations[0] = { op: 'set-canvas', width: 960 }; },
    value => { value.approval = true; }]) {
    const proposal = editProposalFor(editContext); mutate(proposal);
    const fake = fakeProcess(child => { sendEvents(child, completedEvents(JSON.stringify(proposal))); child.close(0); });
    await assert.rejects(editWithCodex(editContext, { outputRoot: output(), executable, runProcess: fake.runProcess }), { code: 'CODEX_PROPOSAL_INVALID' });
    assert.equal(fake.calls.length, 1);
  }
});

test('edit contexts are snapshotted and invalid digests or accessors never start a process', async () => {
  const original = structuredClone(editContext);
  const fake = fakeProcess(child => { sendEvents(child, completedEvents(wrap(editProposalFor(editContext)))); child.close(0); });
  const pending = editWithCodex(original, { outputRoot: output(), executable, runProcess: fake.runProcess });
  original.request.text = 'later'; assert.equal((await pending).receipt.contextSha256, editContext.sha256);
  let reads = 0; const accessor = structuredClone(editContext);
  Object.defineProperty(accessor.spec, 'title', { enumerable: true, get() { reads++; return 'forbidden'; } });
  const blocked = fakeProcess();
  for (const input of [accessor, { ...editContext, sha256: '0'.repeat(64) }, context])
    await assert.rejects(editWithCodex(input, { outputRoot: output(), executable, runProcess: blocked.runProcess }), { code: 'CODEX_CONTEXT_INVALID' });
  assert.equal(reads, 0); assert.equal(blocked.calls.length, 0);
});

test('invalid edit replies are consumed once without replacing IDs, repairing evidence or retrying', async () => {
  const mutations = [
    value => { value.contextSha256 = '0'.repeat(64); },
    value => { value.patch.baseSpecSha256 = '0'.repeat(64); },
    value => { value.patch.operations[0] = { op: 'set-canvas', width: 10 }; },
    value => { value.decisions[0].basis.quote = 'history is not current authorization'; },
    value => { value.approval = true; },
  ];
  for (const change of mutations) {
    const proposal = editProposalFor(editContext); change(proposal);
    const fake = fakeProcess(child => { sendEvents(child, completedEvents(wrap(proposal))); child.close(0); });
    let caught;
    await assert.rejects(editWithCodex(editContext, { outputRoot: output(), executable, runProcess: fake.runProcess }), error => {
      caught = error; return error.code === 'CODEX_PROPOSAL_INVALID';
    });
    assert.equal(fake.calls.length, 1); assert.equal(caught.receipt.status, 'FAILED');
    assert.equal(caught.receipt.proposalSha256, null); assert.equal(caught.receipt.automaticRetries, 0);
    validateCodexEditReceipt(caught.receipt);
  }
});

test('edit questions may accompany a patch but never claim readiness or successful application', async () => {
  for (const withPatch of [false, true]) {
    const proposal = editProposalFor(editContext);
    proposal.unresolved = [{ id: 'switch-meaning', question: '新增开关开启时代表什么？' }];
    if (!withPatch) { proposal.patch = null; proposal.decisions = []; }
    const fake = fakeProcess(child => { sendEvents(child, completedEvents(wrap(proposal))); child.close(0); });
    const result = await editWithCodex(editContext, { outputRoot: output(), executable, runProcess: fake.runProcess });
    assert.equal(result.report.status, 'NEEDS_INPUT'); assert.equal(result.receipt.status, 'NEEDS_INPUT');
    assert.equal(result.report.compilation, 'NOT_RUN'); assert.equal(fake.calls.length, 1);
  }
});

test('tool events and cancellation terminate an edit invocation with no fallback or retry', async () => {
  const controller = new AbortController();
  const scenarios = [
    { code: 'CODEX_TOOL_EVENT_NO_RETRY', run(child) { sendEvents(child, [...beginning, { type: 'item.started', item: { type: 'command_execution' } }]); child.close(0); } },
    { code: 'CODEX_ABORTED_NO_RETRY', run() { controller.abort(); } },
  ];
  for (const scenario of scenarios) {
    const fake = fakeProcess(scenario.run);
    await assert.rejects(editWithCodex(editContext, { outputRoot: output(), executable, runProcess: fake.runProcess,
      ...(scenario.code === 'CODEX_ABORTED_NO_RETRY' ? { signal: controller.signal } : {}) }), { code: scenario.code });
    assert.equal(fake.calls.length, 1); assert.equal(fake.calls[0].kills.length, 1);
  }
});

test('discovery honors absolute override, searches absolute PATH entries, and never falls back from bad override', async () => {
  assert.equal(CODEX_MODEL, 'gpt-6-luna'); assert.equal(CODEX_EFFORT, 'xhigh');
  assert.equal(findCodexExecutable({ UI_PANEL_CODEX_COMMAND: executable, PATH: '' }), executable);
  assert.equal(findCodexExecutable({ PATH: `.${delimiter}${work}` }), executable);
  assert.equal(findCodexExecutable({ Path: work }), executable);
  assert.equal(findCodexExecutable({ UI_PANEL_CODEX_COMMAND: 'codex', PATH: work }), undefined);
  assert.equal(findCodexExecutable({ UI_PANEL_CODEX_COMMAND: work, PATH: work }), undefined);
  assert.equal(findCodexExecutable({ UI_PANEL_CODEX_COMMAND: '', PATH: work }), undefined);
  assert.equal(findCodexExecutable({ PATH: '.' }), undefined);
  if (process.platform === 'win32') {
    const wrapper = join(work, 'codex.cmd'); await writeFile(wrapper, 'do not execute');
    assert.equal(findCodexExecutable({ UI_PANEL_CODEX_COMMAND: wrapper, PATH: work }), undefined);
  }
});

test('one fixed-model tool-less invocation validates final proposal and saves public artifacts only', async () => {
  const fake = fakeProcess(), outputRoot = output();
  const result = await planWithCodex(context, { outputRoot, executable, runProcess: fake.runProcess });
  assert.equal(fake.calls.length, 1);
  const call = fake.calls[0];
  assert.equal(call.command, executable); assert.equal(call.options.shell, false); assert.equal(call.options.windowsHide, true);
  assert.deepEqual(call.options.stdio, ['pipe', 'pipe', 'pipe']);
  const value = flag => call.args[call.args.indexOf(flag) + 1];
  assert.equal(value('--model'), 'gpt-6-luna'); assert.equal(value('--sandbox'), 'read-only');
  for (const flag of ['--strict-config', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check', '--json']) assert.ok(call.args.includes(flag));
  assert.ok(!call.args.includes('--ignore-rules')); assert.ok(!call.args.includes('--output-last-message'));
  assert.equal(call.args.at(-1), '-');
  for (const setting of ['model_reasoning_effort="xhigh"', 'approval_policy="never"', 'project_doc_max_bytes=0',
    'features.shell_tool=false', 'features.unified_exec=false', 'features.apps=false', 'features.plugins=false',
    'features.image_generation=false', 'features.browser_use=false', 'features.skip_host_skill_discovery=true']) assert.ok(call.args.includes(setting));
  assert.ok(call.prompt.includes('UNTRUSTED TASK DATA')); assert.ok(call.prompt.includes('agent-authored'));
  assert.ok(call.prompt.includes('panel-spec-v0.3.schema.json')); assert.ok(call.prompt.includes('panel-proposal-v0.3.schema.json'));
  assert.ok(call.prompt.includes(JSON.stringify(context.request.text)));
  assert.equal(call.prompt.includes(executable), false);
  assert.equal(result.report.status, 'READY_TO_COMPILE'); assert.equal(result.report.semanticReview, 'NOT_RUN');
  assert.equal(result.receipt.contextSha256, context.sha256); assert.equal(result.receipt.proposalSha256, await digestJson(result.proposal));
  assert.equal(result.receipt.invocationCount, 1); assert.equal(result.receipt.automaticRetries, 0);
  assert.deepEqual(result.receipt.usage, { inputTokens: 100, cachedInputTokens: 20, outputTokens: 50 });
  const names = await readdir(outputRoot); assert.equal(names.length, 1); assert.match(names[0], /^codex-[0-9a-f-]{36}$/);
  const directory = join(outputRoot, names[0]);
  assert.equal(directory, call.options.cwd);
  assert.deepEqual((await readdir(directory)).sort(), ['codex-receipt.json', 'planning-context.json', 'planning-report.json', 'proposal.json']);
  assert.deepEqual(await json(join(directory, 'planning-context.json')), context);
  assert.deepEqual(await json(join(directory, 'proposal.json')), result.proposal);
  assert.deepEqual(await json(join(directory, 'planning-report.json')), result.report);
  assert.deepEqual(await json(join(directory, 'codex-receipt.json')), result.receipt);
  assert.equal(JSON.stringify(result.receipt).includes(threadId), false);
});

test('NEEDS_INPUT is a checked outcome, not a failed model call or compile success', async () => {
  const proposal = { proposalVersion: '0.3', contextSha256: context.sha256, spec: null, decisions: [],
    unresolved: [{ id: 'volume-initial', question: '音量初值是多少？' }] };
  const fake = fakeProcess(child => { sendEvents(child, completedEvents(wrap(proposal)), { trailingNewline: false }); child.close(0); });
  const result = await planWithCodex(context, { outputRoot: output(), executable, runProcess: fake.runProcess });
  assert.deepEqual(result.proposal, proposal); assert.equal(result.receipt.status, 'NEEDS_INPUT');
  assert.equal(result.report.status, 'NEEDS_INPUT'); assert.equal(result.receipt.failureCode, null);
});

test('input is snapshotted before awaits; forged contexts and getters cannot dispatch', async () => {
  const original = structuredClone(context), fake = fakeProcess();
  const pending = planWithCodex(original, { outputRoot: output(), executable, runProcess: fake.runProcess });
  original.request.text = 'a later change';
  assert.equal((await pending).receipt.contextSha256, context.sha256);
  let reads = 0;
  const accessor = structuredClone(context);
  Object.defineProperty(accessor.request, 'text', { enumerable: true, get() { reads++; return request.text; } });
  const blocked = fakeProcess();
  await rejected(blocked, 'CODEX_CONTEXT_INVALID', { input: accessor }); assert.equal(reads, 0);
  await rejected(blocked, 'CODEX_CONTEXT_INVALID', { input: { ...context, sha256: '0'.repeat(64) } });
  assert.equal(blocked.calls.length, 0);
});

test('options, missing executable, outside output root and pre-abort cannot launch a process', async () => {
  const fake = fakeProcess();
  await rejected(fake, 'CODEX_OPTIONS_INVALID', { timeoutMs: 900001 });
  await rejected(fake, 'CODEX_NOT_CONFIGURED', { executable: join(work, 'absent.exe') });
  await assert.rejects(planWithCodex(context, { outputRoot: dirname(harnessRoot), executable, runProcess: fake.runProcess }), { code: 'CODEX_OUTPUT_DIRECTORY_INVALID' });
  const controller = new AbortController(); controller.abort();
  const { error } = await rejected(fake, 'CODEX_ABORTED_NO_RETRY', { signal: controller.signal });
  assert.equal(error.receipt.invocationCount, 0); assert.equal(fake.calls.length, 0);
});

test('malformed envelope, provenance, context and source evidence are rejected without repairing output', async () => {
  const cases = [
    ['CODEX_OUTPUT_INVALID', 'not JSON'],
    ['CODEX_OUTPUT_INVALID', JSON.stringify({ proposalJson: '{}', extra: true })],
    ['CODEX_OUTPUT_INVALID', JSON.stringify({ proposalJson: '{' })],
    ['CODEX_PROPOSAL_INVALID', wrap({ ...proposalFor(), contextSha256: '0'.repeat(64) })],
  ];
  const fixtureProposal = proposalFor(); fixtureProposal.spec.provenance.kind = 'programmatic-fixture';
  cases.push(['CODEX_PROVENANCE_INVALID', wrap(fixtureProposal)]);
  const badQuote = proposalFor(); badQuote.decisions[0].basis.quote = 'invented';
  cases.push(['CODEX_PROPOSAL_INVALID', wrap(badQuote)]);
  for (const [code, final] of cases) {
    const fake = fakeProcess(child => { sendEvents(child, completedEvents(final)); child.close(0); });
    const { outputRoot } = await rejected(fake, code);
    const directory = join(outputRoot, (await readdir(outputRoot))[0]);
    assert.deepEqual((await readdir(directory)).sort(),
      ['codex-diagnostic.json', 'codex-receipt.json', 'planning-context.json']);
  }
});

test('rejected real-shaped proposals retain exact safe validation cause and JSON fingerprint without saving raw output', async () => {
  const proposal = proposalFor(); proposal.spec.state[0].initial = 'SECRET_VALUE';
  const fake = fakeProcess(child => { sendEvents(child, completedEvents(wrap(proposal))); child.close(0); });
  const { error, outputRoot } = await rejected(fake, 'CODEX_PROPOSAL_INVALID');
  assert.equal(error.diagnostic.validatorCode, 'number'); assert.equal(error.diagnostic.path, '$.state[0].initial');
  assert.equal(error.diagnostic.proposalJsonSha256, await digestBytes(new TextEncoder().encode(JSON.stringify(proposal))));
  validateCodexDiagnostic(error.diagnostic, { operation: 'plan', contextSha256: context.sha256 });
  const directory = join(outputRoot, (await readdir(outputRoot))[0]);
  const saved = await json(join(directory, 'codex-diagnostic.json')); assert.deepEqual(saved, error.diagnostic);
  assert.equal(JSON.stringify(saved).includes('SECRET_VALUE'), false); assert.equal(fake.calls.length, 1);
  assert.equal(error.receipt.proposalSha256, null); assert.equal(error.receipt.automaticRetries, 0);
});

test('Codex draft response uses one invocation, derives targets and saves original accepted evidence', async () => {
  const draft = draftFor(), fake = fakeProcess(child => { sendEvents(child, completedEvents(wrap(draft))); child.close(0); });
  const outputRoot = output(), result = await planWithCodex(context, { outputRoot, executable, runProcess: fake.runProcess });
  assert.deepEqual(result.proposal, proposalFor()); assert.equal(result.receipt.status, 'READY_TO_COMPILE');
  assert.equal(result.receipt.proposalSha256, await digestJson(result.proposal)); assert.equal(fake.calls.length, 1);
  assert.ok(fake.calls[0].prompt.includes('CodexPanelDraft 0.1')); assert.ok(fake.calls[0].prompt.includes('codex-panel-draft.schema.json'));
  const directory = join(outputRoot, (await readdir(outputRoot))[0]);
  assert.deepEqual(await json(join(directory, 'codex-draft.json')), draft);
  assert.deepEqual((await readdir(directory)).sort(), ['codex-draft.json', 'codex-receipt.json', 'planning-context.json', 'planning-report.json', 'proposal.json']);
});

test('missing draft evidence and invalid public basis are terminal; no source is fabricated or raw failure saved', async () => {
  for (const [code, path, mutate] of [
    ['DRAFT_COUNT', '$.bases.state', value => value.bases.state.pop()],
    ['PLAN_QUOTE', '$.decisions[0]', value => { value.bases.panel.quote = 'SECRET_PRIVATE_VALUE'; }]
  ]) {
    const draft = draftFor(); mutate(draft);
    const fake = fakeProcess(child => { sendEvents(child, completedEvents(wrap(draft))); child.close(0); });
    const { error, outputRoot } = await rejected(fake, 'CODEX_PROPOSAL_INVALID');
    assert.equal(error.diagnostic.validatorCode, code); assert.equal(error.diagnostic.path, path);
    assert.equal(error.diagnostic.stage, 'draft-validation'); assert.equal(fake.calls.length, 1);
    const directory = join(outputRoot, (await readdir(outputRoot))[0]);
    assert.deepEqual((await readdir(directory)).sort(), ['codex-diagnostic.json', 'codex-receipt.json', 'planning-context.json']);
    assert.equal(JSON.stringify(await json(join(directory, 'codex-diagnostic.json'))).includes('SECRET_PRIVATE_VALUE'), false);
  }
});

test('legacy proposals still reject duplicate, unmatched and non-string targets with distinct safe evidence', async () => {
  for (const [targetIssue, target] of [['duplicate', 'panel'], ['unmatched', 'action:SECRET_PRIVATE_VALUE'], ['non-string', 7]]) {
    const proposal = proposalFor(); proposal.decisions.push({ ...structuredClone(proposal.decisions[0]), target });
    const fake = fakeProcess(child => { sendEvents(child, completedEvents(wrap(proposal))); child.close(0); });
    const { error } = await rejected(fake, 'CODEX_PROPOSAL_INVALID');
    assert.equal(error.diagnostic.validatorCode, 'PLAN_TARGET'); assert.equal(error.diagnostic.targetIssue, targetIssue);
    assert.equal(JSON.stringify(error.diagnostic).includes('SECRET_PRIVATE_VALUE'), false); assert.equal(fake.calls.length, 1);
  }
});

test('tool events immediately terminate the child and never trigger a second process', async () => {
  const fake = fakeProcess(child => {
    sendEvents(child, [...beginning, { type: 'item.started', item: { type: 'command_execution', command: 'PRIVATE COMMAND' } }]);
  });
  const { error } = await rejected(fake, 'CODEX_TOOL_EVENT_NO_RETRY');
  assert.deepEqual(fake.calls[0].kills, ['SIGTERM']);
  assert.equal(JSON.stringify(error.receipt).includes('PRIVATE'), false);
});

const reconnect = (number = 2, detail = '') => ({ type: 'error', message: `Reconnecting... ${number}/5${detail}` });
const fallback = (detail = '') => ({ type: 'item.completed', item: { type: 'error',
  message: `Falling back from WebSockets to HTTPS transport.${detail}` } });

test('bounded CLI transport notices may precede a single valid final response without a new invocation', async () => {
  const events = [...beginning, ...[2, 3, 4, 5].map(number => reconnect(number, ' (https://private.invalid?token=SECRET)')),
    fallback(' stream disconnected'), ...completedEvents().slice(2)];
  const fake = fakeProcess(child => { sendEvents(child, events); child.close(0); });
  const outputRoot = output();
  const result = await planWithCodex(context, { outputRoot, executable, runProcess: fake.runProcess });
  assert.equal(result.receipt.status, 'READY_TO_COMPILE');
  assert.equal(result.receipt.invocationCount, 1); assert.equal(result.receipt.automaticRetries, 0);
  assert.equal(fake.calls.length, 1); assert.deepEqual(fake.calls[0].kills, []);
  const directory = join(outputRoot, (await readdir(outputRoot))[0]);
  for (const filename of await readdir(directory)) {
    assert.equal((await readFile(join(directory, filename), 'utf8')).includes('SECRET'), false);
  }
});

test('transport notices cannot replace completion, mask terminal failure or permit tool calls', async () => {
  for (const [ending, code] of [
    [[], 'CODEX_INCOMPLETE_NO_RETRY'],
    [[{ type: 'turn.failed', error: { message: 'connection reset' } }], 'CODEX_CONNECTION_FAILED_NO_RETRY'],
    [[{ type: 'error', message: 'Authentication failed' }], 'CODEX_AUTH_REQUIRED_NO_RETRY'],
    [[{ type: 'item.started', item: { type: 'command_execution' } }], 'CODEX_TOOL_EVENT_NO_RETRY'],
  ]) {
    await rejected(fakeProcess(child => { sendEvents(child, [...beginning, reconnect(), fallback(), ...ending]); child.close(0); }), code);
  }
});

test('repeated, out-of-order, out-of-window and spoofed transport notices are rejected', async () => {
  const cases = [
    [reconnect(), ...completedEvents()],
    [...beginning, reconnect(), reconnect(), ...completedEvents().slice(2)],
    [...beginning, reconnect(3), reconnect(2), ...completedEvents().slice(2)],
    [...beginning, fallback(), fallback(), ...completedEvents().slice(2)],
    [...completedEvents(), reconnect()],
    [...beginning, completedEvents()[2], fallback(), completedEvents()[3]],
    ...[reconnect(1), reconnect(6), reconnect(2, '\nprivate'), reconnect(2, ' (bad\u0000detail)'),
      reconnect(2, ` (${'x'.repeat(2049)})`), fallback(' \nprivate'), fallback(` ${'x'.repeat(2049)}`),
      { type: 'item.started', item: fallback().item },
      { type: 'item.completed', item: { type: 'error', message: 'Other error' } },
      { type: 'item.completed', item: { type: 'command_execution', message: fallback().item.message } },
    ].map(event => [...beginning, event, ...completedEvents().slice(2)]),
  ];
  for (const events of cases) {
    const fake = fakeProcess(child => { sendEvents(child, events); child.close(0); });
    await assert.rejects(planWithCodex(context, { outputRoot: output(), executable, runProcess: fake.runProcess }));
    assert.equal(fake.calls.length, 1); assert.deepEqual(fake.calls[0].kills, ['SIGTERM']);
  }
});

test('transport progress does not reset the original deadline or disable cancellation', async () => {
  const fake = fakeProcess(child => sendEvents(child, [...beginning, reconnect()]));
  await rejected(fake, 'CODEX_TIMEOUT_NO_RETRY', { timeoutMs: 10 });
  assert.equal(fake.calls.length, 1);
  const controller = new AbortController();
  const aborted = fakeProcess(child => { sendEvents(child, [...beginning, reconnect(), fallback()]); controller.abort(); });
  await rejected(aborted, 'CODEX_ABORTED_NO_RETRY', { signal: controller.signal });
  assert.deepEqual(aborted.calls[0].kills, ['SIGTERM']);
});

test('exactly one complete ordered turn and one final message are required', async () => {
  const final = completedEvents();
  const cases = [
    ['CODEX_INCOMPLETE_NO_RETRY', beginning],
    ['CODEX_INCOMPLETE_NO_RETRY', [...beginning, { type: 'turn.completed' }]],
    ['CODEX_EVENT_INVALID_NO_RETRY', [...beginning, beginning[1]]],
    ['CODEX_EVENT_INVALID_NO_RETRY', [...final, { type: 'turn.completed' }]],
    ['CODEX_OUTPUT_INVALID', [...beginning, final[2], final[2], final[3]]],
    ['CODEX_EVENT_INVALID_NO_RETRY', [{ type: 'turn.started' }]],
    ['CODEX_TRANSPORT_FAILED_NO_RETRY', [...beginning, { type: 'turn.failed', error: { message: 'secret path' } }]],
    ['CODEX_INCOMPLETE_NO_RETRY', [...beginning, { type: 'error', message: 'Reconnecting... 2/5 (private endpoint)' }]],
  ];
  for (const [code, events] of cases) {
    await rejected(fakeProcess(child => { sendEvents(child, events); child.close(0); }), code);
  }
});

test('stream bounds cover total stdout, an unterminated event line, total stderr and one stderr line', async () => {
  const scenarios = [
    child => child.stdout.write(Buffer.alloc(2 * 1024 * 1024 + 1, 32)),
    child => { for (let i = 0; i < 5; i++) child.stdout.write(Buffer.alloc(1024 * 1024, 10)); },
    child => child.stderr.write(Buffer.alloc(32 * 1024 + 1, 65)),
    child => child.stderr.write(Buffer.alloc(128 * 1024 + 1, 10)),
  ];
  for (const scenario of scenarios) {
    const fake = fakeProcess(scenario); await rejected(fake, 'CODEX_OUTPUT_LIMIT_NO_RETRY');
    assert.deepEqual(fake.calls[0].kills, ['SIGTERM']);
  }
});

test('invalid JSONL and invalid UTF-8 fail closed while split Unicode succeeds', async () => {
  for (const bytes of [Buffer.from('not-json\n'), Buffer.from([0xc3, 0x28, 10])]) {
    await rejected(fakeProcess(child => child.stdout.write(bytes)), 'CODEX_EVENT_INVALID_NO_RETRY');
  }
  const fake = fakeProcess(child => {
    const bytes = Buffer.from(completedEvents().map(event => JSON.stringify(event)).join('\n'));
    for (let i = 0; i < bytes.length; i += 7) child.stdout.write(bytes.subarray(i, i + 7));
    child.close(0);
  });
  assert.equal((await planWithCodex(context, { outputRoot: output(), executable, runProcess: fake.runProcess })).report.status, 'READY_TO_COMPILE');
});

test('abort and timeout kill the same child and produce terminal sanitized receipts', async () => {
  const controller = new AbortController();
  const aborted = fakeProcess(() => controller.abort());
  await rejected(aborted, 'CODEX_ABORTED_NO_RETRY', { signal: controller.signal });
  assert.deepEqual(aborted.calls[0].kills, ['SIGTERM']);
  const timed = fakeProcess(() => {});
  await rejected(timed, 'CODEX_TIMEOUT_NO_RETRY', { timeoutMs: 5 });
  assert.deepEqual(timed.calls[0].kills, ['SIGTERM']);
});

test('a child ignoring TERM is killed without hanging the request', async () => {
  const fake = fakeProcess((child, call) => {
    child.kill = signal => { call.kills.push(signal); return true; };
  });
  await rejected(fake, 'CODEX_TIMEOUT_NO_RETRY', { timeoutMs: 5 });
  assert.deepEqual(fake.calls[0].kills, ['SIGTERM', 'SIGKILL']);
});

test('spawn failures and private stderr never leak into receipts', async () => {
  const noStart = { calls: [], runProcess() { noStart.calls.push({}); throw new Error('C:\\private\\credentials SECRET'); } };
  await rejected(noStart, 'CODEX_START_FAILED');
  const fake = fakeProcess(child => { child.stderr.write('C:\\private\\credentials SECRET https://private.example?token=x'); child.close(1); });
  const { error } = await rejected(fake, 'CODEX_TRANSPORT_FAILED_NO_RETRY');
  assert.equal(JSON.stringify(error).includes('SECRET'), false); assert.equal(JSON.stringify(error).includes('private.example'), false);
});

test('error events and failed turns classify explicit causes without saving their private text', async () => {
  const cases = [
    ['CODEX_AUTH_REQUIRED_NO_RETRY', 'Not logged in. Please run codex login.'],
    ['CODEX_AUTH_REQUIRED_NO_RETRY', 'Authentication error: invalid_api_key'],
    ['CODEX_AUTH_REQUIRED_NO_RETRY', 'HTTP 401 Unauthorized'],
    ['CODEX_AUTH_REQUIRED_NO_RETRY', 'Your authentication token could not be refreshed because your refresh token was already used.'],
    ['CODEX_RATE_LIMIT_NO_RETRY', 'You have hit your usage limit.'],
    ['CODEX_RATE_LIMIT_NO_RETRY', 'Rate limit reached for requests.'],
    ['CODEX_RATE_LIMIT_NO_RETRY', 'insufficient_quota: quota exceeded'],
    ['CODEX_MODEL_UNAVAILABLE_NO_RETRY', "The 'gpt-6-luna' model is not supported with your ChatGPT account."],
    ['CODEX_MODEL_UNAVAILABLE_NO_RETRY', 'The model gpt-6-luna does not exist or you do not have access to it.'],
    ['CODEX_MODEL_UNAVAILABLE_NO_RETRY', 'model_not_found'],
    ['CODEX_CONNECTION_FAILED_NO_RETRY', 'Reconnecting... 2/5'],
    ['CODEX_CONNECTION_FAILED_NO_RETRY', 'Network connection error: connection reset by peer'],
    ['CODEX_CONNECTION_FAILED_NO_RETRY', 'stream disconnected before completion: error sending request'],
    ['CODEX_TRANSPORT_FAILED_NO_RETRY', 'The operation failed for an unspecified reason.'],
    ['CODEX_TRANSPORT_FAILED_NO_RETRY', 'Login page mention and model reference; configuration not supported.'],
  ];
  for (const [code, cause] of cases) for (const type of ['error', 'turn.failed']) {
    const privateText = `${cause} C:\\Users\\private-user\\auth.json https://internal.invalid?token=SECRET_TOKEN`;
    const event = type === 'error' ? { type, message: privateText } : { type, error: { message: privateText } };
    const fake = fakeProcess(child => sendEvents(child, [...beginning, event]));
    const { outputRoot, error } = await rejected(fake, code);
    assert.deepEqual(fake.calls[0].kills, ['SIGTERM']);
    const directory = join(outputRoot, (await readdir(outputRoot))[0]);
    assert.deepEqual((await readdir(directory)).sort(), ['codex-receipt.json', 'planning-context.json']);
    const saved = await readFile(join(directory, 'codex-receipt.json'), 'utf8');
    for (const secret of ['SECRET_TOKEN', 'private-user', 'internal.invalid', cause]) {
      assert.equal(saved.includes(secret), false);
      assert.equal(JSON.stringify(error).includes(secret), false);
    }
  }
});

test('nonzero exit classifies bounded stderr across chunks; successful exits ignore warning text', async () => {
  const causes = [
    ['CODEX_AUTH_REQUIRED_NO_RETRY', 'Authentication failed: token expired'],
    ['CODEX_RATE_LIMIT_NO_RETRY', 'HTTP 429 Too Many Requests'],
    ['CODEX_MODEL_UNAVAILABLE_NO_RETRY', 'Unsupported model: gpt-6-luna'],
    ['CODEX_CONNECTION_FAILED_NO_RETRY', 'Failed to connect: connection refused'],
    ['CODEX_TRANSPORT_FAILED_NO_RETRY', 'Unknown error at private endpoint'],
  ];
  for (const [code, cause] of causes) {
    const text = `${cause}\nC:\\private\\auth.json https://internal.invalid?token=SECRET_TOKEN`;
    const fake = fakeProcess(child => {
      const bytes = Buffer.from(text);
      for (let index = 0; index < bytes.length; index += 3) child.stderr.write(bytes.subarray(index, index + 3));
      child.close(1);
    });
    const { error } = await rejected(fake, code);
    assert.equal(JSON.stringify(error).includes('SECRET_TOKEN'), false);
    assert.equal(JSON.stringify(error).includes('private'), false);
    assert.equal(fake.calls.length, 1);
  }
  const fake = fakeProcess(child => { child.stderr.write('Warning: rate limit reference only'); sendEvents(child, completedEvents()); child.close(0); });
  assert.equal((await planWithCodex(context, { outputRoot: output(), executable, runProcess: fake.runProcess })).receipt.status, 'READY_TO_COMPILE');
});

test('receipt validator rejects operational fields, wrong pins, invalid usage and false success claims', async () => {
  const fake = fakeProcess();
  const { receipt } = await planWithCodex(context, { outputRoot: output(), executable, runProcess: fake.runProcess });
  assert.deepEqual(validateCodexReceipt(receipt, { contextSha256: context.sha256, proposalSha256: receipt.proposalSha256 }), receipt);
  for (const change of [
    { path: 'C:\\secret' }, { model: 'other' }, { effort: 'high' }, { automaticRetries: 1 },
    { invocationCount: 0 }, { failureCode: 'CODEX_SAVE_FAILED' }, { proposalSha256: null },
    { proposalSha256: `${receipt.proposalSha256}\n` },
    { usage: { inputTokens: 1, cachedInputTokens: 2, outputTokens: 1 } },
    { usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, endpoint: 'hidden' } },
    { status: 'FAILED', failureCode: 'CODEX_SAVE_FAILED' }, { elapsedMs: -1 },
  ]) assert.throws(() => validateCodexReceipt({ ...receipt, ...change }), { code: 'CODEX_RECEIPT_INVALID' });
  assert.throws(() => validateCodexReceipt(receipt, { contextSha256: '0'.repeat(64) }), { code: 'CODEX_RECEIPT_INVALID' });
  assert.throws(() => validateCodexReceipt(receipt, { proposalSha256: '0'.repeat(64) }), { code: 'CODEX_RECEIPT_INVALID' });
});
