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
import { buildCodexEditResponseSchema, codexEditOperationContracts } from '../src/codex-edit-schema.mjs';
import { applyPanelPatch } from '../src/patch.mjs';
import { harnessRoot } from '../src/io.mjs';
import { createPlanningContext } from '../src/planning-context.mjs';
import { proposalTargets } from '../src/proposal.mjs';
import { PANEL_EVALUATION_SUITE } from '../examples/panel-evaluation/suite.mjs';
import { compactIntentFixture } from '../examples/panel-evaluation/intent-fixture.mjs';
import { formRequest, formIntent } from '../examples/forms-v1/fixture.mjs';
import { formEditRequest, formEditDraft } from '../examples/forms-v1/edit-fixture.mjs';
import { materializePanelIntent } from '../src/panel-intent.mjs';
import { ordinalFixture } from './ordinal-intent-fixture.mjs';
import { requestReferenceFixture } from '../examples/request-reference-v1/fixture.mjs';
import { roleRequest, roleIntent } from '../examples/adaptive-v1/fixture.mjs';



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
test('after a button-layout upgrade the CLI prompt retains form instructions and exposes the new layout operation', async () => {
  const catalog = await json(join(harnessRoot, 'examples/modern-adaptive.catalog.json'));
  const planning = await createPlanningContext(roleRequest, catalog);
  const base = (await materializePanelIntent(planning, roleIntent(planning))).spec;
  const spec = { ...base, panelSpecVersion: '0.9', appearance: null, actionLayouts: [] };
  const context = await createPanelEditContext(spec, catalog, { ...roleRequest, text: '保持当前界面不变。' });
  const draft = { codexEditDraftVersion: '0.3', contextSha256: context.sha256, patch: null, bases: null,
    unresolved: [], noChange: { reason: '当前请求明确保持不变。', quote: context.request.text } };
  let schema;
  const fake = fakeProcess(async (child, call) => { schema = await json(call.args[call.args.indexOf('--output-schema') + 1]); sendEvents(child, completedEvents(JSON.stringify(draft))); child.close(0); });
  const result = await editWithCodex(context, { outputRoot: output(), executable, runProcess: fake.runProcess });
  assert.equal(result.report.status, 'NO_CHANGES'); assert.equal(fake.calls.length, 1);
  assert(fake.calls[0].prompt.includes('It does not need a separate public capability named add-input-row'));
  assert(fake.calls[0].prompt.includes('prompts/panel-action-layout-editor.md'));
  const native = codexEditOperationContracts(schema, context);
  assert(native.some(value => value.operation === 'set-action-layout'));
  assert(native.some(value => value.operation === 'add-input-row'));
});

test('selected-object CLI dispatch carries separate ID scope and exact original request without retries', async () => {
  const catalog = await json(join(harnessRoot, 'examples/modern-adaptive.catalog.json'));
  const planning = await createPlanningContext(roleRequest, catalog);
  const spec = (await materializePanelIntent(planning, roleIntent(planning))).spec;
  const row = spec.sections.flatMap(section => section.rows).find(row => row.kind === 'button');
  const context = await createPanelEditContext(spec, catalog, { ...roleRequest, id: 'panel-edit', text: '把这个按钮的文字改为继续，其他不变。' }, { rowId: row.id });
  const draft = { codexEditDraftVersion: '0.3', contextSha256: context.sha256,
    patch: { patchVersion: '0.1', baseSpecSha256: context.baseSpecSha256, reason: context.request.text,
      operations: [{ op: 'set-button-label', rowId: row.id, buttonLabel: '继续' }] },
    bases: [{ kind: 'request-interpretation', quote: context.request.text }], unresolved: [], noChange: null };
  let selectedSchema;
  const fake = fakeProcess(async (child, call) => {
    selectedSchema = await json(call.args[call.args.indexOf('--output-schema') + 1]);
    sendEvents(child, completedEvents(JSON.stringify(draft))); child.close(0);
  });
  const result = await editWithCodex(context, { outputRoot: output(), executable, runProcess: fake.runProcess });
  assert.equal(result.report.status,'READY_TO_APPLY'); assert.equal(fake.calls.length,1);
  assert.deepEqual(new Set(codexEditOperationContracts(selectedSchema, context).map(op => op.operation)), new Set(context.capabilities.operations));
  assert(fake.calls[0].prompt.includes('Selected-object scope: context.selection.rowId'));
  assert(fake.calls[0].prompt.includes('Quote the unmodified current request'));
  assert(fake.calls[0].prompt.includes(JSON.stringify(context.selection)));
  assert.equal(result.proposal.patch.operations[0].rowId,row.id);
  assert.equal(result.proposal.decisions[0].basis.quote,context.request.text);
});

async function compositionEditFixture() {
  const catalog = await json(join(harnessRoot, 'examples/modern-adaptive.catalog.json'));
  const request = { ...roleRequest, id: 'composition-menu', text: '暂停菜单，提供继续游戏、声音设置、返回首页三个可用按钮，均发出点击事件。' };
  const planning = await createPlanningContext(request, catalog);
  const intent = roleIntent(planning); intent.panel.title = '暂停游戏';
  intent.panel.body.children = [{ kind: 'section', title: '操作', rows: ['继续游戏', '声音设置', '返回首页'].map(label => ({
    kind: 'button', label, recipeKey: 'settings.button@0.1.0', sourceRef: 'request', icon: null,
    enabled: true, action: 'emit', resetRows: [], submitRows: [],
  })) }];
  const base = (await materializePanelIntent(planning, intent)).spec;
  const titleStyle = { horizontalAlign: 'center', verticalAlign: null, backgroundColor: null,
    textColor: null, cornerRadius: null, fontSize: 24, padding: 0 };
  const layout = { direction: 'column', align: 'center', gap: 12, buttonWidth: 280, buttonHeight: 48, shape: 'default' };
  const style = { backgroundColor: '#2464C8', textColor: null, borderColor: null,
    borderWidth: null, cornerRadius: null, width: null, height: null, shape: null };
  const spec = (await applyPanelPatch(base, { patchVersion: '0.1', baseSpecSha256: await digestJson(base), reason: '程序夹具，明确保存的现有构图。', operations: [
    { op: 'set-title-bar', style: titleStyle },
    { op: 'set-action-layout', sectionId: base.sections[0].id, layout },
    { op: 'set-button-style', rowId: base.sections[0].rows[0].id, style },
    { op: 'set-button-font-size', rowId: base.sections[0].rows[0].id, fontSize: 16 },
  ] })).spec;
  return { catalog, request, spec };
}

for (const selected of [false, true]) test(`composition guidance retains saved geometry through a ${selected ? 'selected button caption' : 'panel title'} edit`, async () => {
  const { catalog, request, spec } = await compositionEditFixture();
  const original = structuredClone(spec), rowId = spec.sections[0].rows[0].id;
  const text = selected ? '只把这个按钮的文字改为继续，其他不变。' : '只把标题文字改为游戏已暂停，其他不变。';
  const context = await createPanelEditContext(spec, catalog, { ...request, text }, selected ? { rowId } : null);
  const operation = selected ? { op: 'set-button-label', rowId, buttonLabel: '继续' } : { op: 'set-panel-title', title: '游戏已暂停' };
  const draft = { codexEditDraftVersion: '0.3', contextSha256: context.sha256,
    patch: { patchVersion: '0.1', baseSpecSha256: context.baseSpecSha256, reason: text, operations: [operation] },
    bases: [{ kind: 'request-interpretation', quote: text }], unresolved: [], noChange: null };
  const fake = fakeProcess((child, call) => {
    assert(call.prompt.includes('Panel composition by purpose'));
    assert(call.prompt.includes('A text-only or selected-object edit preserves unmentioned title alignment'));
    assert(call.prompt.includes('Do not mechanically apply a settings page'));
    assert(call.prompt.includes(JSON.stringify(text)));
    sendEvents(child, completedEvents(JSON.stringify(draft))); child.close(0);
  });
  const result = await editWithCodex(context, { outputRoot: output(), executable, runProcess: fake.runProcess });
  assert.equal(result.report.status, 'READY_TO_APPLY'); assert.equal(fake.calls.length, 1);
  const applied = await applyPanelPatch(spec, result.proposal.patch), expected = structuredClone(original);
  if (selected) expected.sections[0].rows[0].buttonLabel = '继续'; else expected.title = '游戏已暂停';
  assert.deepEqual(applied.spec, expected); assert.deepEqual(spec, original);
  assert.deepEqual(result.proposal.patch.operations, [operation]);
});

test('explicit layout edits can override composition preferences without changing other saved properties', async () => {
  const { catalog, request, spec } = await compositionEditFixture();
  const text = '标题改成左对齐，按钮列改为左对齐、宽372高48、间距16，其他不变。';
  const context = await createPanelEditContext(spec, catalog, { ...request, text });
  const style = { ...spec.titleBar, horizontalAlign: 'left' };
  const { sectionId, ...oldLayout } = spec.actionLayouts[0];
  const layout = { ...oldLayout, align: 'start', buttonWidth: 372, gap: 16 };
  const operations = [{ op: 'set-title-bar', style }, { op: 'set-action-layout', sectionId, layout }];
  const draft = { codexEditDraftVersion: '0.3', contextSha256: context.sha256,
    patch: { patchVersion: '0.1', baseSpecSha256: context.baseSpecSha256, reason: text, operations },
    bases: operations.map(() => ({ kind: 'request-interpretation', quote: text })), unresolved: [], noChange: null };
  const fake = fakeProcess((child, call) => {
    assert(call.prompt.includes('Explicit user layout instructions take precedence'));
    assert(call.prompt.includes('even when they differ from these preferences'));
    sendEvents(child, completedEvents(JSON.stringify(draft))); child.close(0);
  });
  const result = await editWithCodex(context, { outputRoot: output(), executable, runProcess: fake.runProcess });
  assert.equal(result.report.status, 'READY_TO_APPLY'); assert.equal(fake.calls.length, 1);
  assert.deepEqual(result.proposal.patch.operations, operations);
  const applied = await applyPanelPatch(spec, result.proposal.patch);
  assert.deepEqual(applied.spec, { ...spec, titleBar: style, actionLayouts: [{ ...layout, sectionId }] });
});

test('a necessary unsupported animation in an aesthetic edit can be clarified once without a partial restyle', async () => {
  const { catalog, request, spec } = await compositionEditFixture(), sourceDigest = await digestJson(spec);
  const text = '改得好看点，必须加淡入动画，其他内容保持。';
  const context = await createPanelEditContext(spec, catalog, { ...request, text });
  const draft = { codexEditDraftVersion: '0.3', contextSha256: context.sha256, patch: null, bases: null,
    unresolved: [{ id: 'animation', question: '当前面板协议不支持淡入动画，是否去掉这项要求后继续调整静态样式？' }], noChange: null };
  const fake = fakeProcess((child, call) => {
    assert(call.prompt.includes('A vague aesthetic request'));
    assert(call.prompt.includes('Never return a partial supported subset'));
    sendEvents(child, completedEvents(JSON.stringify(draft))); child.close(0);
  });
  const result = await editWithCodex(context, { outputRoot: output(), executable, runProcess: fake.runProcess });
  assert.equal(result.report.status, 'NEEDS_INPUT'); assert.equal(fake.calls.length, 1);
  assert.equal(result.proposal.patch, null); assert.deepEqual(result.proposal.unresolved, draft.unresolved);
  assert.equal(await digestJson(spec), sourceDigest);
});

test('button font dispatch advertises the operation and distinguishes glyph size from hit target size', async () => {
  const catalog = await json(join(harnessRoot, 'examples/modern-adaptive.catalog.json'));
  const planning = await createPlanningContext(roleRequest, catalog);
  const spec = (await materializePanelIntent(planning, roleIntent(planning))).spec;
  const row = spec.sections.flatMap(section => section.rows).find(row => row.kind === 'button');
  const context = await createPanelEditContext(spec, catalog, { ...roleRequest, id: 'panel-edit', text: '只把这个按钮文字字号改成24，按钮尺寸和其他内容不变。' }, { rowId: row.id });
  const draft = { codexEditDraftVersion: '0.3', contextSha256: context.sha256,
    patch: { patchVersion: '0.1', baseSpecSha256: context.baseSpecSha256, reason: context.request.text,
      operations: [{ op: 'set-button-font-size', rowId: row.id, fontSize: 24 }] },
    bases: [{ kind: 'request-interpretation', quote: context.request.text }], unresolved: [], noChange: null };
  let selectedSchema;
  const fake = fakeProcess(async (child, call) => {
    selectedSchema = await json(call.args[call.args.indexOf('--output-schema') + 1]);
    sendEvents(child, completedEvents(JSON.stringify(draft))); child.close(0);
  });
  const result = await editWithCodex(context, { outputRoot: output(), executable, runProcess: fake.runProcess });
  assert.equal(result.report.status, 'READY_TO_APPLY'); assert.equal(fake.calls.length, 1);
  assert(codexEditOperationContracts(selectedSchema, context).some(op => op.operation === 'set-button-font-size'));
  assert(fake.calls[0].prompt.includes('这是按钮字号修改'));
  assert(fake.calls[0].prompt.includes('不改变按钮宽高'));
  assert.deepEqual(result.proposal.patch.operations, draft.patch.operations);
});

async function clarifiedAudioFixture() {
  const formsCatalog = await json(join(harnessRoot, 'examples/modern-mint-forms.catalog.json'));
  const text = '做个声音设置，放音量滑条和静音开关，再加恢复默认。\n【补充回答】\n问题：音量范围、步长、初值和静音初值是多少？\n回答：音量0到100、步长1、默认70；静音默认关闭，开启表示静音；恢复默认只重置这两项；全部可用';
  const input = await createPlanningContext({ ...request, id: 'clarified-audio', text }, formsCatalog);
  const common = (id, kind, label) => ({ id, kind, label, recipeKey: `settings.${kind}@0.1.0`, sourceQuote: text, icon: null, enabled: true });
  const intent = { panelIntentVersion: '0.6', contextSha256: input.sha256, unresolved: [], panel: {
    id: input.request.id, title: '声音设置', themeKey: 'modern-mint-light@0.1.0', panelSurface: null,
    layout: { width: null, canvasWidth: null, canvasHeight: null, maxHeight: 480, overflow: 'auto' },
    body: { kind: 'column', children: [{ kind: 'section', id: 'section0', title: '声音', rows: [
      { ...common('row0', 'slider', '音量'), min: 0, max: 100, step: 1, initial: 70, prefix: '', suffix: '' },
      { ...common('row1', 'switch', '静音'), initial: false },
      { ...common('row2', 'button', '恢复默认'), action: 'reset-initial', resetRows: ['row0', 'row1'], submitRows: [] },
    ] }] },
  } };
  return { input, intent: ordinalFixture(intent), formsCatalog };
}
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

test('native 0.9 initial layout and per-button editing use the actual CLI boundary with one fixture child each', async () => {
  const catalog = await json(join(harnessRoot, 'examples/modern-adaptive.catalog.json'));
  const request = { ...roleRequest, id: 'player-dispatch', text: '生成音乐播放器，上一首播放下一首用⏮⏯⏭表示，三个56像素圆形按钮横向居中，间距16。' };
  const context = await createPlanningContext(request, catalog, undefined, { actionLayouts: true });
  const intent = roleIntent(context); intent.panelIntentVersion = '0.9'; intent.panel.title = '音乐播放器';
  intent.panel.body.children = [{ kind: 'section', title: '播放控制', actionLayout: { direction: 'row', align: 'center', gap: 16, buttonWidth: 56, buttonHeight: 56, shape: 'circle', sourceRef: 'request' },
    rows: ['⏮', '⏯', '⏭'].map(label => ({ kind: 'button', label, recipeKey: 'settings.button@0.1.0', sourceRef: 'request', icon: null, enabled: true, action: 'emit', resetRows: [], submitRows: [] })) }];
  let generatedSchema;
  const fake = fakeProcess(async (child, call) => {
    generatedSchema = await json(call.args[call.args.indexOf('--output-schema') + 1]);
    assert(call.prompt.includes('Intent 0.9')); assert(call.prompt.includes('actionLayout'));
    assert(call.prompt.includes('Icon usage: restrained-v1'));
    assert(call.prompt.includes('Whole-request interpretation'));
    assert(call.prompt.includes('Panel composition by purpose'));
    assert(call.prompt.includes('New-panel scope'));
    assert(call.prompt.includes('A later number alone is not a correction'));
    assert(call.prompt.includes('do not adopt an example or superseded value'));
    assert(call.prompt.includes('Optional decoration does not require clarification'));
    sendEvents(child, completedEvents(JSON.stringify(intent))); child.close(0);
  });
  const generated = await planWithCodex(context, { outputRoot: output(), executable, runProcess: fake.runProcess });
  assert.equal(fake.calls.length, 1); assert.equal(generated.report.status, 'READY_TO_COMPILE');
  assert.deepEqual(generatedSchema.properties.panelIntentVersion.enum, ['0.9']);
  assert.equal(generated.proposal.spec.panelSpecVersion, '0.9');
  assert.deepEqual(generated.proposal.spec.actionLayouts, [{ sectionId: 'section0', direction: 'row', align: 'center', gap: 16, buttonWidth: 56, buttonHeight: 56, shape: 'circle' }]);
  const editing = await createPanelEditContext(generated.proposal.spec, catalog, { ...request, text: '交换上一首和下一首，播放键改为紫色80像素圆形，其他不变。' });
  const operations = [{ op: 'set-row-order', sectionId: 'section0', rowIds: ['row2', 'row1', 'row0'] },
    { op: 'set-button-style', rowId: 'row1', style: { backgroundColor: '#7C3AED', textColor: null, borderColor: null, borderWidth: null, cornerRadius: null, width: 80, height: 80, shape: 'circle' } }];
  const draft = { codexEditDraftVersion: '0.3', contextSha256: editing.sha256,
    patch: { patchVersion: '0.1', baseSpecSha256: editing.baseSpecSha256, reason: editing.request.text, operations },
    bases: operations.map(() => ({ kind: 'request-interpretation', quote: editing.request.text })), unresolved: [], noChange: null };
  const editFake = fakeProcess(async (child, call) => {
    assert(call.prompt.includes('prompts/panel-control-editor.md'));
    assert(call.prompt.includes('Whole-request interpretation'));
    assert(call.prompt.includes('Never guess the first matching row'));
    assert(call.prompt.includes('Never return a partial supported subset'));
    const schema = await json(call.args[call.args.indexOf('--output-schema') + 1]);
    assert(codexEditOperationContracts(schema, editing).some(op => op.operation === 'set-button-style'));
    sendEvents(child, completedEvents(JSON.stringify(draft))); child.close(0);
  });
  const edited = await editWithCodex(editing, { outputRoot: output(), executable, runProcess: editFake.runProcess });
  assert.equal(editFake.calls.length, 1); assert.equal(edited.report.status, 'READY_TO_APPLY');
  assert.deepEqual(edited.proposal.patch.operations, operations);
});
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
    validateCodexReceipt(caught.receipt, { contextSha256: input.sha256 });
    assert.equal(JSON.stringify(caught.receipt).includes('private_endpoint'), false);
  }
  assert.ok(fake.calls.length <= 1, 'never retries failed or indeterminate requests');
  return { error: caught, outputRoot };
}

test('theme generation dispatch supplies the exact eight choices and a default without new UI fields', async () => {
  const themes = await json(join(harnessRoot, 'examples/modern-game-themes.catalog.json'));
  const input = await createPlanningContext({...formRequest, text:formRequest.text+' 使用深色蓝色主题。'}, themes);
  const intent = requestReferenceFixture(ordinalFixture(formIntent(input)));
  intent.panel.themeKey = 'modern-blue-dark@0.3.0';
  const fake = fakeProcess(async (child, call) => {
    assert(call.prompt.includes('### Theme selection'));
    assert(call.prompt.includes('defaultThemeKey'));
    for(const theme of themes.themes) assert(call.prompt.includes(`${theme.id}@${theme.version}`));
    assert(call.prompt.includes('arbitrary hex color'));
    sendEvents(child, completedEvents(JSON.stringify(intent))); child.close(0);
  });
  const result = await planWithCodex(input, {outputRoot:output(), executable, runProcess:fake.runProcess});
  assert.equal(fake.calls.length,1);assert.equal(result.report.status,'READY_TO_COMPILE');
  assert.deepEqual(result.proposal.spec.theme,{id:'modern-blue-dark',version:'0.3.0'});
});

test('theme edit dispatch pins exact theme/version pairs and retains the unrequested mode/accent', async () => {
  const themes = await json(join(harnessRoot, 'examples/modern-game-themes.catalog.json'));
  const input = await createPlanningContext(formRequest, themes), intent = requestReferenceFixture(ordinalFixture(formIntent(input)));
  intent.panel.themeKey = 'modern-blue-dark@0.3.0';
  const spec = (await materializePanelIntent(input,intent)).spec;
  const editing = await createPanelEditContext(spec,themes,{...formRequest,text:'只把主色换成橙色，其他不变。'});
  const draft = {codexEditDraftVersion:'0.3',contextSha256:editing.sha256,noChange:null,unresolved:[],
    patch:{patchVersion:'0.1',baseSpecSha256:editing.baseSpecSha256,reason:'Change explicitly requested accent.',operations:[{op:'set-theme',theme:{id:'modern-orange-dark',version:'0.3.0'}}]},
    bases:[{kind:'request-interpretation',quote:editing.request.text}]};
  const fake = fakeProcess(async (child, call) => {
    assert(call.prompt.includes('currentThemeKey'));assert(call.prompt.includes('modern-blue-dark@0.3.0'));
    assert(call.prompt.includes('keep the current mode'));assert(call.prompt.includes('unless this edit explicitly requests'));
    const schema = await json(call.args[call.args.indexOf('--output-schema')+1]);
    const operation = Object.values(schema.$defs).find(s=>s.properties?.op?.enum?.[0]==='set-theme');
    assert.equal(operation.properties.theme.anyOf.length,8);
    sendEvents(child, completedEvents(JSON.stringify(draft)));child.close(0);
  });
  const result = await editWithCodex(editing,{outputRoot:output(),executable,runProcess:fake.runProcess});
  assert.equal(fake.calls.length,1);assert.equal(result.report.status,'READY_TO_APPLY');
  assert.deepEqual(result.proposal.patch.operations,draft.patch.operations);
});

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
  assert.ok(call.prompt.includes('Do not rebalance or replace saved icons as a side effect'));
  assert.ok(call.prompt.includes('### Native CLI output schema')); assert.ok(call.prompt.includes('reset-initial'));
  assert.ok(!call.prompt.includes('panel-edit-proposal.schema.json'));
  assert.ok(call.prompt.includes('Do not wrap it in proposalJson'));
  assert.deepEqual(call.schema.required.sort(), ['bases', 'codexEditDraftVersion', 'contextSha256', 'noChange', 'patch', 'unresolved']);
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

test('editing output schema has strict native shapes, all thirteen operations and local recursive layout references', async () => {
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
  assert.deepEqual([...operations].sort(), ['add-row', 'remove-row', 'set-button-action', 'set-button-label', 'set-input-properties', 'set-layout', 'set-panel-title', 'set-row-enabled', 'set-row-label', 'set-state-initial', 'set-tab-label', 'set-tabs-enabled', 'set-theme']);
  assert.equal(recursiveChildren, true);
});

test('native generation schema bounds containers, rows, options, pages and action scopes while invalid trees stay terminal', async () => {
  const { input, intent } = await clarifiedAudioFixture();
  const fake = fakeProcess(async (child, call) => {
    const schema = await json(call.args[call.args.indexOf('--output-schema') + 1]);
    const limits = (shape, min, max) => { assert.equal(shape.minItems, min); assert.equal(shape.maxItems, max); };
    limits(schema.$defs.container.properties.children, 1, 96);
    const rows = schema.$defs.body.anyOf[0].properties.rows;
    limits(rows, 1, 128);
    const rowSchemas = rows.items.anyOf;
    limits(rowSchemas.find(row => row.properties.kind.enum[0] === 'select').properties.options, 1, 8);
    const button = rowSchemas.find(row => row.properties.kind.enum[0] === 'button');
    limits(button.properties.resetRows, 0, 128); limits(button.properties.submitRows, 0, 128);
    limits(schema.properties.panel.anyOf[1].properties.body.anyOf[1].properties.pages, 2, 8);
    assert(call.prompt.includes('不允许空容器、空分组或占位节点'));
    sendEvents(child, completedEvents(JSON.stringify(intent))); child.close(0);
  });
  assert.equal((await planWithCodex(input, { outputRoot: output(), executable, runProcess: fake.runProcess })).report.status, 'READY_TO_COMPILE');
  for (const children of [[], Array.from({ length: 97 }, () => intent.panel.body.children[0])]) {
    const broken = structuredClone(intent); broken.panel.body.children = structuredClone(children);
    const bad = fakeProcess(child => { sendEvents(child, completedEvents(JSON.stringify(broken))); child.close(0); });
    await assert.rejects(planWithCodex(input, { outputRoot: output(), executable, runProcess: bad.runProcess }), error => {
      assert.equal(error.code, 'CODEX_PROPOSAL_INVALID'); assert.equal(error.diagnostic.validatorCode, 'INTENT_COUNT');
      assert.equal(error.diagnostic.path, '$.panel.body.children'); assert.equal(error.receipt.automaticRetries, 0); return true;
    });
    assert.equal(bad.calls.length, 1);
  }
});

test('successive edit invocations pin both current digests and stale bindings remain failures without repair', async () => {
  const first = editProposalFor(editContext);
  const nextSpec = (await applyPanelPatch(sourceSpec, first.patch)).spec;
  const secondContext = await createPanelEditContext(nextSpec, catalog, { ...request, id: 'panel-edit', text: '将主音量默认值改成50，其他保持不变。' });
  assert.notEqual(secondContext.sha256, editContext.sha256); assert.notEqual(secondContext.baseSpecSha256, editContext.baseSpecSha256);
  for (const input of [editContext, secondContext]) {
    const reply = input === editContext ? first : { ...editProposalFor(input), patch: {
      patchVersion: '0.1', baseSpecSha256: input.baseSpecSha256, reason: '调整明确的创作默认值。',
      operations: [{ op: 'set-state-initial', fieldId: 'volume', value: 50 }] } };
    const fake = fakeProcess(async (child, call) => {
      const schema = await json(call.args[call.args.indexOf('--output-schema') + 1]);
      assert.deepEqual(schema.properties.contextSha256.enum, [input.sha256]);
      const follow = shape => shape.$ref ? follow(schema.$defs[shape.$ref.slice('#/$defs/'.length)]) : shape;
      const patch = follow(follow(schema.properties.patch).anyOf.find(shape => shape.type !== 'null'));
      assert.deepEqual(patch.properties.baseSpecSha256.enum, [input.baseSpecSha256]);
      assert.equal(patch.properties.operations.minItems, 1); assert.equal(patch.properties.operations.maxItems, 32);
      const binding = JSON.stringify({ baseSpecSha256: input.baseSpecSha256, contextSha256: input.sha256 });
      assert(call.prompt.includes('Authoritative invocation binding')); assert(call.prompt.includes(binding));
      assert(call.prompt.includes('Final binding check before returning'));
      sendEvents(child, completedEvents(JSON.stringify(reply))); child.close(0);
    });
    assert.equal((await editWithCodex(input, { outputRoot: output(), executable, runProcess: fake.runProcess })).report.status, 'READY_TO_APPLY');
    assert.equal(fake.calls.length, 1);
  }
  const before = structuredClone(secondContext);
  for (const changes of [{ contextSha256: editContext.sha256 }, { baseSpecSha256: editContext.baseSpecSha256 }]) {
    const stale = editProposalFor(secondContext);
    if (changes.contextSha256) stale.contextSha256 = changes.contextSha256;
    else stale.patch.baseSpecSha256 = changes.baseSpecSha256;
    const fake = fakeProcess(child => { sendEvents(child, completedEvents(JSON.stringify(stale))); child.close(0); });
    await assert.rejects(editWithCodex(secondContext, { outputRoot: output(), executable, runProcess: fake.runProcess }), error => {
      assert.equal(error.code, 'CODEX_PROPOSAL_INVALID');
      assert.equal(error.diagnostic.validatorCode, changes.contextSha256 ? 'EDIT_CONTEXT_MISMATCH' : 'EDIT_BASE_MISMATCH');
      assert.equal(error.receipt.automaticRetries, 0); return true;
    });
    assert.equal(fake.calls.length, 1); assert.deepEqual(secondContext, before);
  }
});

test('forms generation uses the native intent schema in exactly one CLI invocation', async () => {
  const catalog = await json(join(harnessRoot, 'examples/modern-mint-forms.catalog.json'));
  const context = await createPlanningContext(formRequest, catalog);
  const fake = fakeProcess(async (child, call) => {
    call.schema = await json(call.args[call.args.indexOf('--output-schema') + 1]);
    sendEvents(child, completedEvents(JSON.stringify(requestReferenceFixture(ordinalFixture(formIntent(context)))))); child.close(0);
  });
  const result = await planWithCodex(context, { outputRoot: output(), executable, runProcess: fake.runProcess });
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(fake.calls[0].schema.properties.panelIntentVersion.enum, ['0.8']);
  const nativeSchema = fake.calls[0].prompt.split('### Native CLI output schema\n')[1].split('\n\nComplete validated task data:')[0];
  assert.deepEqual(JSON.parse(nativeSchema), fake.calls[0].schema);
  assert(fake.calls[0].prompt.includes('A name like 仅收藏 must not become 收藏'));
  const outputFolder = dirname(fake.calls[0].args[fake.calls[0].args.indexOf('--output-schema') + 1]);
  assert.deepEqual(await json(join(outputFolder, 'panel-intent.json')), requestReferenceFixture(ordinalFixture(formIntent(context))));
  assert(fake.calls[0].prompt.includes('submitRows'));
  assert.equal(result.proposal.spec.panelSpecVersion, '0.7');
  assert.equal(result.report.status, 'READY_TO_COMPILE');
  assert.equal(result.receipt.automaticRetries, 0);
});

test('no-change CLI drafts produce separate bound evidence once without an applied edit receipt', async () => {
  const context = await createPanelEditContext(sourceSpec, catalog, { ...request, text: '保持当前面板完全一样，这次不用修改任何内容。' });
  const draft = { codexEditDraftVersion: '0.3', contextSha256: context.sha256, patch: null, bases: null, unresolved: [],
    noChange: { reason: '用户明确要求无需修改。', quote: context.request.text } };
  const outputRoot = output();
  const fake = fakeProcess(async (child, call) => {
    const schema = await json(call.args[call.args.indexOf('--output-schema') + 1]);
    assert.deepEqual(schema.properties.codexEditDraftVersion.enum, ['0.3']);
    assert(schema.required.includes('noChange')); assert(call.prompt.includes('noChange MUST be null'));
    sendEvents(child, completedEvents(JSON.stringify(draft))); child.close(0);
  });
  const result = await editWithCodex(context, { outputRoot, executable, runProcess: fake.runProcess });
  assert.equal(fake.calls.length, 1); assert.equal(result.report.status, 'NO_CHANGES');
  assert.equal(result.receipt.codexEditingReceiptVersion, '0.2'); assert.equal(result.receipt.automaticRetries, 0);
  assert.equal(result.proposal.editProposalVersion, '0.2'); assert.equal(result.proposal.patch, null);
  assert.equal(result.receipt.proposalSha256, await digestJson(result.proposal));
  const directory = join(outputRoot, (await readdir(outputRoot))[0]);
  assert.deepEqual(await json(join(directory, 'codex-edit-draft.json')), draft);
  assert.deepEqual(await json(join(directory, 'edit-proposal.json')), result.proposal);
  assert.deepEqual(await json(join(directory, 'codex-edit-receipt.json')), result.receipt);
});

test('existing readonly input edits advertise exact current capabilities and preserve every unrequested input property', async () => {
  const catalog = await json(join(harnessRoot, 'examples/modern-mint-forms.catalog.json'));
  const planning = await createPlanningContext(formRequest, catalog);
  const spec = (await materializePanelIntent(planning, formIntent(planning))).spec;
  const request = { ...formRequest, text: '将角色名输入改为只读，其他属性和按钮行为不变。' };
  const context = await createPanelEditContext(spec, catalog, request);
  const row = spec.sections.flatMap(section => section.rows).find(value => value.kind === 'input');
  const field = spec.state.find(value => value.id === row.bind);
  const draft = { codexEditDraftVersion: '0.2', contextSha256: context.sha256,
    patch: { patchVersion: '0.1', baseSpecSha256: context.baseSpecSha256, reason: request.text,
      operations: [{ op: 'set-input-properties', rowId: row.id, placeholder: row.placeholder,
        inputType: row.inputType, readOnly: true, maxLength: field.maxLength, validation: row.validation }] },
    bases: [{ kind: 'request-interpretation', quote: request.text }], unresolved: [] };
  const fake = fakeProcess((child, call) => {
    const marker = 'Authoritative current editing capabilities, copied by the program from the validated context: ';
    const line = call.prompt.split('\n').find(value => value.startsWith(marker));
    assert.deepEqual(JSON.parse(line.slice(marker.length)), { sourceSpecVersion: spec.panelSpecVersion,
      allowedPatchOperations: context.capabilities.operations });
    assert(call.prompt.indexOf(marker) < call.prompt.indexOf('### CLI editing instructions:'));
    sendEvents(child, completedEvents(JSON.stringify(draft))); child.close(0);
  });
  const result = await editWithCodex(context, { outputRoot: output(), executable, runProcess: fake.runProcess });
  assert.equal(result.report.status, 'READY_TO_APPLY'); assert.equal(fake.calls.length, 1);
  const changed = (await applyPanelPatch(spec, result.proposal.patch)).spec;
  const expected = structuredClone(spec);
  expected.sections.flatMap(section => section.rows).find(value => value.id === row.id).readOnly = true;
  assert.deepEqual(changed, expected); assert.equal(result.receipt.automaticRetries, 0);
});

test('declaration edits dispatch draft 0.3 once while preserving accepted legacy form drafts', async () => {
  const catalog = await json(join(harnessRoot, 'examples/modern-mint-forms.catalog.json'));
  const planning = await createPlanningContext(formRequest, catalog);
  const spec = (await materializePanelIntent(planning, formIntent(planning))).spec;
  const context = await createPanelEditContext(spec, catalog, { ...formRequest, text: formEditRequest });
  const draft = formEditDraft(context), outputRoot = output();
  const fake = fakeProcess(async (child, call) => {
    call.schema = await json(call.args[call.args.indexOf('--output-schema') + 1]);
    sendEvents(child, completedEvents(JSON.stringify(draft))); child.close(0);
  });
  const result = await editWithCodex(context, { outputRoot, executable, runProcess: fake.runProcess });
  assert.equal(fake.calls.length, 1); assert.equal(result.receipt.automaticRetries, 0);
  assert.deepEqual(fake.calls[0].schema.properties.codexEditDraftVersion.enum, ['0.3']);
  assert(fake.calls[0].prompt.includes('add-input-row')); assert(fake.calls[0].prompt.includes('validationMessages:null'));
  assert.equal(result.report.status, 'READY_TO_APPLY'); assert.equal(result.proposal.patch.operations[1].op, 'add-row');
  assert.deepEqual(result.proposal.patch.operations[2].action.fields, ['row0', 'declaration']);
  const directory = join(outputRoot, (await readdir(outputRoot))[0]);
  assert.deepEqual(await json(join(directory, 'codex-edit-draft.json')), draft);
  assert.deepEqual(await json(join(directory, 'edit-proposal.json')), result.proposal);
});

test('native edit operation mapping comes from reachable schema branches and respects the source capabilities', async () => {
  const formCatalog = await json(join(harnessRoot, 'examples/modern-mint-forms.catalog.json'));
  const planning = await createPlanningContext(formRequest, formCatalog);
  const spec = (await materializePanelIntent(planning, formIntent(planning))).spec;
  const context = await createPanelEditContext(spec, formCatalog, { ...formRequest, text: '新增一个角色宣言输入框。' });
  const schema = await buildCodexEditResponseSchema({ draft: true, context });
  const contracts = codexEditOperationContracts(schema, context), input = contracts.find(value => value.operation === 'add-input-row');
  assert(context.capabilities.operations.includes('add-row')); assert(!context.capabilities.operations.includes('add-input-row'));
  assert.equal(input.publicOperation, 'add-row');
  assert.deepEqual(input.required, ['op','sectionId','afterRowId','id','recipeKey','label','enabled','initial','placeholder','inputType','readOnly','maxLength','required','minLength','validationMessages']);
  assert(contracts.every(value => context.capabilities.operations.includes(value.publicOperation)));
  const oldSchema = await buildCodexEditResponseSchema({ draft: true, context: editContext });
  const old = codexEditOperationContracts(oldSchema, editContext);
  assert(!old.some(value => ['add-input-row', 'set-input-properties', 'set-tab-label'].includes(value.operation)));
});

test('two successive declaration edits receive one current native schema contract, preserve IDs and submit dependencies', async () => {
  const catalog = await json(join(harnessRoot, 'examples/modern-mint-forms.catalog.json'));
  const planning = await createPlanningContext(formRequest, catalog);
  const base = (await materializePanelIntent(planning, formIntent(planning))).spec;
  const firstText = '在角色名下新增“角色宣言”单行输入，初始为空，非必填，最多30字符，可编辑。确认同时提交角色名和宣言，其他不变。';
  const secondText = '将角色宣言改为必填、最少3字符、最多30字符，其他不变。';
  let draft;
  const fake = fakeProcess(async (child, call) => {
    const schema = await json(call.args[call.args.indexOf('--output-schema') + 1]);
    const nativeText = call.prompt.split('### Native CLI output schema\n')[1].split('\n### Complete validated task data')[0].trim();
    assert.deepEqual(JSON.parse(nativeText), schema);
    assert.deepEqual(schema.properties.codexEditDraftVersion.enum, ['0.3']);
    assert(!call.prompt.includes('schemas/panel-patch.schema.json'));
    assert(!call.prompt.includes('schemas/codex-edit-draft-v0.2.schema.json'));
    assert(!call.prompt.includes('### Public contract reference:'));
    assert(call.prompt.includes('It does not need a separate public capability named add-input-row'));
    const marker = "Native edit operation contracts, derived from this invocation's output schema: ";
    const native = JSON.parse(call.prompt.split('\n').find(line => line.startsWith(marker)).slice(marker.length));
    assert.equal(native.find(value => value.operation === 'add-input-row').publicOperation, 'add-row');
    sendEvents(child, completedEvents(JSON.stringify(draft))); child.close(0);
  });
  const firstContext = await createPanelEditContext(base, catalog, { ...formRequest, text: firstText });
  draft = { codexEditDraftVersion: '0.3', contextSha256: firstContext.sha256, noChange: null, unresolved: [],
    patch: { patchVersion: '0.1', baseSpecSha256: firstContext.baseSpecSha256, reason: '新增可选角色宣言并同时提交两个输入。', operations: [
      { op: 'add-input-row', sectionId: 'section0', afterRowId: 'row0', id: 'declaration', recipeKey: 'forms.input@0.1.0', label: '角色宣言', enabled: true, initial: '', placeholder: '', inputType: 'text', readOnly: false, maxLength: 30, required: false, minLength: 0, validationMessages: null },
      { op: 'set-button-action', rowId: 'row1', action: { kind: 'submit', fields: ['row0', 'declaration'] } },
    ] }, bases: Array.from({length:2}, () => ({kind:'request-interpretation',quote:firstText})) };
  const first = await editWithCodex(firstContext, { outputRoot: output(), executable, runProcess: fake.runProcess });
  assert.equal(first.report.status, 'READY_TO_APPLY'); assert.equal(first.receipt.invocationCount, 1);
  const next = (await applyPanelPatch(base, first.proposal.patch)).spec;
  assert.deepEqual(next.sections[0].rows.map(row => row.id), ['row0','declaration','row1','row2']);
  assert.deepEqual(next.sections[0].rows.find(row => row.id === 'row0'), base.sections[0].rows[0]);
  assert.deepEqual(next.sections[0].rows.find(row => row.id === 'row2'), base.sections[0].rows[2]);
  assert.deepEqual(next.sections[0].rows.find(row => row.id === 'row1').action.fields, ['row0','declaration']);
  assert.equal(next.state.find(field => field.id === 'declaration').initial, '');
  const input = next.sections[0].rows.find(row => row.id === 'declaration');
  const secondContext = await createPanelEditContext(next, catalog, { ...formRequest, text: secondText });
  draft = { codexEditDraftVersion:'0.3',contextSha256:secondContext.sha256,noChange:null,unresolved:[],
    patch:{patchVersion:'0.1',baseSpecSha256:secondContext.baseSpecSha256,reason:'角色宣言改为必填且至少三个字符。',operations:[
      {op:'set-input-properties',rowId:input.id,placeholder:input.placeholder,inputType:input.inputType,readOnly:input.readOnly,maxLength:30,
        validation:{...input.validation,required:true,minLength:3,minLengthMessage:'至少输入 3 个字符'}},
    ]},bases:[{kind:'request-interpretation',quote:secondText}]};
  const second = await editWithCodex(secondContext, { outputRoot: output(), executable, runProcess: fake.runProcess });
  assert.equal(second.report.status,'READY_TO_APPLY'); assert.equal(second.receipt.invocationCount,1);
  const actual=(await applyPanelPatch(next,second.proposal.patch)).spec, expected=structuredClone(next);
  expected.sections[0].rows.find(row=>row.id===input.id).validation={...input.validation,required:true,minLength:3,minLengthMessage:'至少输入 3 个字符'};
  assert.deepEqual(actual,expected);assert.equal(fake.calls.length,2);assert.equal(first.receipt.automaticRetries,0);assert.equal(second.receipt.automaticRetries,0);
});

test('a model question is retained after the native-contract fix instead of repaired or resubmitted', async () => {
  const catalog=await json(join(harnessRoot,'examples/modern-mint-forms.catalog.json'));
  const planning=await createPlanningContext(formRequest,catalog),spec=(await materializePanelIntent(planning,formIntent(planning))).spec;
  const context=await createPanelEditContext(spec,catalog,{...formRequest,text:'在角色名下新增角色宣言，其他不变。'});
  const draft={codexEditDraftVersion:'0.3',contextSha256:context.sha256,patch:null,bases:null,noChange:null,
    unresolved:[{id:'q0',question:'How should the required input addition be represented?'}]};
  const fake=fakeProcess(child=>{sendEvents(child,completedEvents(JSON.stringify(draft)));child.close(0);});
  const result=await editWithCodex(context,{outputRoot:output(),executable,runProcess:fake.runProcess});
  assert.equal(result.report.status,'NEEDS_INPUT');assert.deepEqual(result.proposal.unresolved,draft.unresolved);
  assert.equal(result.proposal.patch,null);assert.equal(fake.calls.length,1);assert.equal(result.receipt.automaticRetries,0);
});

test('invalid optional input messages preserve the exact underlying field without retries or raw values', async () => {
  const catalog = await json(join(harnessRoot, 'examples/modern-mint-forms.catalog.json'));
  const planning = await createPlanningContext(formRequest, catalog);
  const spec = (await materializePanelIntent(planning, formIntent(planning))).spec;
  const context = await createPanelEditContext(spec, catalog, { ...formRequest, text: formEditRequest });
  const draft = formEditDraft(context);
  draft.patch.operations[1].validationMessages = { requiredMessage: '', minLengthMessage: 'SECRET_NOT_RECORDED' };
  const fake = fakeProcess(child => { sendEvents(child, completedEvents(JSON.stringify(draft))); child.close(0); });
  const outputRoot = output(); let caught;
  await assert.rejects(editWithCodex(context, { outputRoot, executable, runProcess: fake.runProcess }), error => {
    caught = error; return error.code === 'CODEX_PROPOSAL_INVALID';
  });
  assert.equal(fake.calls.length, 1); assert.equal(caught.receipt.automaticRetries, 0);
  assert.equal(caught.diagnostic.validatorCode, 'EDIT_RESULT_SPEC');
  assert.deepEqual(caught.diagnostic.cause, { validatorCode: 'text', path: '$.sections[0].rows[1].validation.requiredMessage' });
  const directory = join(outputRoot, (await readdir(outputRoot))[0]);
  const saved = await json(join(directory, 'codex-edit-diagnostic.json'));
  assert.deepEqual(saved, caught.diagnostic); assert(!JSON.stringify(saved).includes('SECRET'));
  assert.deepEqual((await readdir(directory)).sort(), ['codex-edit-diagnostic.json', 'codex-edit-receipt.json', 'edit-context.json']);
});

test('Tabs request with missing defaults returns native questions with schema-constrained IDs', async () => {
  const tabsCatalog = await json(join(harnessRoot, 'examples/modern-mint-tabs.catalog.json'));
  const input = await createPlanningContext({ ...request, text: '生成设置面板，包含声音和显示两个页签。声音页有主音量和静音开关；显示页有亮度滑条。默认打开声音页。' }, tabsCatalog);
  const intent = { panelIntentVersion: '0.5', contextSha256: input.sha256, panel: null, unresolved: [
    { id: 'q0', question: '主音量的范围、步长和初始值是多少？' },
    { id: 'q1', question: '静音开关默认开启还是关闭？' },
    { id: 'q2', question: '亮度的范围、步长和初始值是多少？' },
  ] };
  const fake = fakeProcess(async (child, call) => {
    const schema = await json(call.args[call.args.indexOf('--output-schema') + 1]);
    assert.deepEqual(schema.properties.unresolved.items.properties.id.enum, Array.from({ length: 64 }, (_, i) => `q${i}`));
    assert(call.prompt.includes('q0、q1')); assert(call.prompt.includes('不能翻译成中文'));
    sendEvents(child, completedEvents(JSON.stringify(intent))); child.close(0);
  });
  const outputRoot = output(), result = await planWithCodex(input, { outputRoot, executable, runProcess: fake.runProcess });
  assert.equal(fake.calls.length, 1); assert.equal(result.receipt.status, 'NEEDS_INPUT');
  assert.equal(result.receipt.automaticRetries, 0); assert.equal(result.proposal.spec, null);
  assert.deepEqual(result.proposal.unresolved, intent.unresolved);
  const [name] = await readdir(outputRoot);
  assert.deepEqual(await json(join(outputRoot, name, 'panel-intent.json')), intent);
});

test('malformed native question IDs, duplicates and empty text still fail once without repair', async () => {
  const tabsCatalog = await json(join(harnessRoot, 'examples/modern-mint-tabs.catalog.json'));
  const input = await createPlanningContext({ ...request, text: '生成设置面板，包含声音和显示两个页签。' }, tabsCatalog);
  for (const [unresolved, code] of [
    [[{ id: '音量初值', question: '音量初值是多少？' }], 'PLAN_UNRESOLVED_ID'],
    [[{ id: 'question 0', question: '音量初值是多少？' }], 'PLAN_UNRESOLVED_ID'],
    [[{ id: 'q0', question: '音量初值是多少？' }, { id: 'q0', question: '亮度初值是多少？' }], 'PLAN_UNRESOLVED_ID'],
    [[{ id: 'q0', question: '' }], 'PLAN_TEXT'],
  ]) {
    const fake = fakeProcess(child => {
      sendEvents(child, completedEvents(JSON.stringify({ panelIntentVersion: '0.5', contextSha256: input.sha256, panel: null, unresolved })));
      child.close(0);
    });
    await assert.rejects(planWithCodex(input, { outputRoot: output(), executable, runProcess: fake.runProcess }), error => {
      assert.equal(error.diagnostic.validatorCode, code); assert.equal(error.receipt.automaticRetries, 0); return true;
    });
    assert.equal(fake.calls.length, 1);
  }
});

test('native editing questions use the same ID constraints and preserve the source panel', async () => {
  const draft = { codexEditDraftVersion: '0.1', contextSha256: editContext.sha256, patch: null, bases: null,
    unresolved: [{ id: 'q0', question: '新的音量初值是多少？' }] };
  const source = structuredClone(editContext.spec);
  const fake = fakeProcess(async (child, call) => {
    const schema = await json(call.args[call.args.indexOf('--output-schema') + 1]);
    assert.deepEqual(schema.properties.unresolved.items.properties.id.enum, Array.from({ length: 64 }, (_, i) => `q${i}`));
    assert(call.prompt.includes('distinct schema-provided ASCII IDs q0'));
    sendEvents(child, completedEvents(JSON.stringify(draft))); child.close(0);
  });
  const result = await editWithCodex(editContext, { outputRoot: output(), executable, runProcess: fake.runProcess });
  assert.equal(fake.calls.length, 1); assert.equal(result.receipt.status, 'NEEDS_INPUT');
  assert.equal(result.proposal.patch, null); assert.deepEqual(result.proposal.unresolved, draft.unresolved);
  assert.deepEqual(editContext.spec, source);
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
  assert.ok(call.prompt.includes('Panel composition by purpose'));
  assert.ok(call.prompt.includes('Unspecified geometry and decoration still use the pinned catalog/compiler defaults'));
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

test('clarified native generation binds the current source without copying quotations and compiles all answered facts', async () => {
  const { input, intent: legacy } = await clarifiedAudioFixture(), intent = requestReferenceFixture(legacy);
  const fake = fakeProcess((child, call) => {
    const copied = JSON.parse(call.prompt.split('### Request source binding\n')[1].split('\n')[0]);
    assert.deepEqual(copied, { contextSha256: input.sha256, sourceRef: 'request' });
    const schema = JSON.parse(call.prompt.split('### Native CLI output schema\n')[1].split('\n\nComplete validated task data:')[0]);
    assert.deepEqual(schema.$defs.requestSourceRef, { type: 'string', enum: ['request'] });
    assert.equal(schema.$defs.exactRequestQuote, undefined);
    for (const row of schema.$defs.body.anyOf[0].properties.rows.items.anyOf)
      assert.deepEqual(row.properties.sourceRef, { $ref: '#/$defs/requestSourceRef' });
    assert(call.prompt.includes('Do not output sourceQuote'));
    assert(call.prompt.includes('【补充回答】'));
    sendEvents(child, completedEvents(JSON.stringify(intent))); child.close(0);
  });
  const result = await planWithCodex(input, { outputRoot: output(), executable, runProcess: fake.runProcess });
  assert.equal(result.report.status, 'READY_TO_COMPILE');
  assert.deepEqual(result.proposal.spec.state.map(field => field.initial), [70, false]);
  assert.deepEqual(result.proposal.spec.sections[0].rows[2].action.fields, ['row0', 'row1']);
  assert.equal(fake.calls.length, 1); assert.equal(result.receipt.automaticRetries, 0);
});

test('current native CLI rejects a provider-returned unique short quote once while saved intent compatibility remains', async () => {
  const { input, intent } = await clarifiedAudioFixture();
  intent.panel.body.children[0].rows.forEach(row => { row.sourceQuote = '音量0到100、步长1、默认70；静音默认关闭'; });
  const before = structuredClone(intent);
  assert.equal((await materializePanelIntent(input, intent)).spec.sections[0].rows.length, 3, 'saved unique short quotes remain public-valid');
  const fake = fakeProcess(child => { sendEvents(child, completedEvents(JSON.stringify(intent))); child.close(0); });
  const { error, outputRoot } = await rejected(fake, 'CODEX_PROPOSAL_INVALID', { input });
  assert.equal(error.diagnostic.validatorCode, 'INTENT_NATIVE_QUOTE');
  assert.equal(error.diagnostic.path, '$.panel.body.children[0].rows[0].sourceQuote');
  assert.equal(error.receipt.invocationCount, 1); assert.equal(error.receipt.automaticRetries, 0); assert.equal(fake.calls.length, 1);
  assert.deepEqual(intent, before);
  const attempt = join(outputRoot, (await readdir(outputRoot))[0]);
  assert.deepEqual((await readdir(attempt)).sort(), ['codex-diagnostic.json', 'codex-receipt.json', 'planning-context.json']);
});

test('current native request-reference instructions avoid competing quotation output contracts', async () => {
  const { input, intent: legacy } = await clarifiedAudioFixture(), intent = requestReferenceFixture(legacy);
  const fake = fakeProcess((child, call) => {
    assert(call.prompt.includes('EVERY row, tabs-root and page must have sourceRef:"request"'));
    assert(call.prompt.includes('Older quotation-based responses are not converted'));
    assert(!call.prompt.includes('sourceQuoteCopy'));
    assert(!call.prompt.includes('prefer the complete sourceQuoteCopy'));
    assert(!call.prompt.includes('use longer quotes where short words repeat'));
    sendEvents(child, completedEvents(JSON.stringify(intent))); child.close(0);
  });
  assert.equal((await planWithCodex(input, { outputRoot: output(), executable, runProcess: fake.runProcess })).report.status, 'READY_TO_COMPILE');
});

test('native 0.8 rejects invalid source references once before saving an accepted intent', async () => {
  const { input, intent: legacy } = await clarifiedAudioFixture(), intent = requestReferenceFixture(legacy);
  intent.panel.body.children[0].rows[0].sourceRef = 'previous-request'; const before = structuredClone(intent);
  const fake = fakeProcess(child => { sendEvents(child, completedEvents(JSON.stringify(intent))); child.close(0); });
  const { error, outputRoot } = await rejected(fake, 'CODEX_PROPOSAL_INVALID', { input });
  assert.equal(error.diagnostic.validatorCode, 'INTENT_SOURCE_REFERENCE');
  assert.equal(error.diagnostic.path, '$.panel.body.children[0].rows[0].sourceRef');
  assert.equal(error.receipt.invocationCount, 1); assert.equal(error.receipt.automaticRetries, 0); assert.equal(fake.calls.length, 1);
  assert.deepEqual(intent, before);
  const attempt = join(outputRoot, (await readdir(outputRoot))[0]);
  assert.deepEqual((await readdir(attempt)).sort(), ['codex-diagnostic.json', 'codex-receipt.json', 'planning-context.json']);
});

test('native CLI refuses an explicit read-only label/content substitution once and saves only failure evidence', async () => {
  const { ORDINAL_STABILITY_SUITE } = await import('../examples/ordinal-stability-v1/suite.mjs');
  const item = ORDINAL_STABILITY_SUITE.cases.find(value => value.id === 'eval-confirm'), forms = await json(join(harnessRoot, 'examples/modern-mint-forms.catalog.json'));
  const input = await createPlanningContext(item.request, forms), intent = requestReferenceFixture(ordinalFixture(compactIntentFixture(input, item)));
  intent.panel.body.children[0].rows[0].label = '删除后无法恢复'; const before = structuredClone(intent);
  const fake = fakeProcess((child, call) => { assert(call.prompt.includes('是两个独立字段')); assert(call.prompt.includes('Literal read-only label/content pairs')); sendEvents(child, completedEvents(JSON.stringify(intent))); child.close(0); });
  const { error, outputRoot } = await rejected(fake, 'CODEX_PROPOSAL_INVALID', { input });
  assert.equal(error.diagnostic.validatorCode, 'INTENT_TEXT_LABEL'); assert.equal(error.diagnostic.path, '$.panel.body.children[0].rows[0].label');
  assert.equal(error.receipt.invocationCount, 1); assert.equal(error.receipt.automaticRetries, 0); assert.equal(fake.calls.length, 1); assert.deepEqual(intent, before);
  const attempt = join(outputRoot, (await readdir(outputRoot))[0]); assert.deepEqual((await readdir(attempt)).sort(), ['codex-diagnostic.json', 'codex-receipt.json', 'planning-context.json']);
});

test('native CLI rejects shortened complete body copy once and retains only failure evidence',async()=>{
  const {bodyFixture}=await import('./literal-body-fixture.mjs'),{context:input,intent}=await bodyFixture();
  intent.panel.body.children[0].rows[0].text='角色名会显示在排行榜和好友列表中。';const before=structuredClone(intent);
  const fake=fakeProcess((child,call)=>{assert(call.prompt.includes('不能只取冒号之后的第一句'));assert(call.prompt.includes('Explicit complete body copies'));sendEvents(child,completedEvents(JSON.stringify(intent)));child.close(0);});
  const {error,outputRoot}=await rejected(fake,'CODEX_PROPOSAL_INVALID',{input});
  assert.equal(error.diagnostic.validatorCode,'INTENT_TEXT_CONTENT');assert.equal(error.diagnostic.path,'$.panel.body.children[0].rows[0].text');assert.equal(error.receipt.invocationCount,1);assert.equal(error.receipt.automaticRetries,0);assert.equal(fake.calls.length,1);assert.deepEqual(intent,before);
  const attempt=join(outputRoot,(await readdir(outputRoot))[0]);assert.deepEqual((await readdir(attempt)).sort(),['codex-diagnostic.json','codex-receipt.json','planning-context.json']);
});

test('the native transport sends overall-panel title guidance and retains title and task-name content independently', async () => {
  const { ORDINAL_STABILITY_SUITE } = await import('../examples/ordinal-stability-v1/suite.mjs');
  const { evaluatePanelSemantics } = await import('../src/panel-evaluation.mjs');
  const item = ORDINAL_STABILITY_SUITE.cases.find(value => value.id === 'eval-quest');
  const forms = await json(join(harnessRoot, 'examples/modern-mint-forms.catalog.json'));
  const input = await createPlanningContext(item.request, forms), intent = requestReferenceFixture(ordinalFixture(compactIntentFixture(input, item)));
  const fake = fakeProcess(async (child, call) => {
    assert(call.prompt.includes('panel.title 是面板整体的名称'));
    assert(call.prompt.includes('是两个独立字段'));
    const schema = await json(call.args[call.args.indexOf('--output-schema') + 1]);
    assert.match(schema.properties.panel.anyOf[1].properties.title.description, /overall panel name/);
    sendEvents(child, completedEvents(JSON.stringify(intent))); child.close(0);
  });
  const result = await planWithCodex(input, { outputRoot: output(), executable, runProcess: fake.runProcess });
  assert.equal(fake.calls.length, 1); assert.equal(result.receipt.automaticRetries, 0);
  assert.equal(result.proposal.spec.title, '任务详情');
  assert.equal(result.proposal.spec.sections[0].rows[0].text, '森林巡逻');
  assert.equal(evaluatePanelSemantics(result.proposal.spec, item.expected).status, 'PASS');
});

test('repeated clarification snippets still fail the unique quote gate without repair or retry', async () => {
  const { input, intent } = await clarifiedAudioFixture();
  intent.panel.body.children[0].rows[1].sourceQuote = '静音';
  const fake = fakeProcess(child => { sendEvents(child, completedEvents(JSON.stringify(intent))); child.close(0); });
  await assert.rejects(planWithCodex(input, { outputRoot: output(), executable, runProcess: fake.runProcess }), error => {
    assert.equal(error.code, 'CODEX_PROPOSAL_INVALID');
    assert.equal(error.diagnostic.validatorCode, 'INTENT_QUOTE');
    assert.match(error.diagnostic.path, /rows\[1\]\.sourceQuote$/);
    assert.equal(error.receipt.automaticRetries, 0); return true;
  });
  assert.equal(fake.calls.length, 1);
});

test('ambiguous numeric editing requests a value role before a separate explicit default edit', async () => {
  const { input, intent, formsCatalog } = await clarifiedAudioFixture();
  const base = (await materializePanelIntent(input, intent)).spec, unchanged = structuredClone(base);
  const ambiguous = await createPanelEditContext(base, formsCatalog, { ...request, text: '把音量改成40，其他不变。' });
  let draft = { codexEditDraftVersion: '0.3', contextSha256: ambiguous.sha256, patch: null, bases: null, noChange: null,
    unresolved: [{ id: 'q0', question: '40 是当前试玩值还是创作默认值？' }] };
  const fake = fakeProcess((child, call) => {
    assert(call.prompt.includes('Do not infer a default from a bare numeric change'));
    assert(call.prompt.includes('“其他不变”不能消除这个歧义'));
    sendEvents(child, completedEvents(JSON.stringify(draft))); child.close(0);
  });
  const question = await editWithCodex(ambiguous, { outputRoot: output(), executable, runProcess: fake.runProcess });
  assert.equal(question.report.status, 'NEEDS_INPUT'); assert.equal(question.proposal.patch, null); assert.deepEqual(base, unchanged);
  const clarified = await createPanelEditContext(base, formsCatalog, { ...request, text: '音量创作默认值改40，当前试玩值保留，其他配置全部不变。' });
  draft = { codexEditDraftVersion: '0.3', contextSha256: clarified.sha256, noChange: null, unresolved: [],
    patch: { patchVersion: '0.1', baseSpecSha256: clarified.baseSpecSha256, reason: '只改创作默认值。', operations: [
      { op: 'set-state-initial', fieldId: 'row0', value: 40 },
    ] }, bases: [{ kind: 'request-interpretation', quote: clarified.request.text }] };
  const result = await editWithCodex(clarified, { outputRoot: output(), executable, runProcess: fake.runProcess });
  assert.equal(result.report.status, 'READY_TO_APPLY');
  const expected = structuredClone(base); expected.state.find(field => field.id === 'row0').initial = 40;
  assert.deepEqual((await applyPanelPatch(base, result.proposal.patch)).spec, expected); assert.deepEqual(base, unchanged);
  assert.equal(fake.calls.length, 2); assert.equal(question.receipt.automaticRetries, 0); assert.equal(result.receipt.automaticRetries, 0);
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
  assert(fake.calls[0].prompt.includes('Whole-request interpretation'));
  assert(fake.calls[0].prompt.includes('Negation and scope matter'));
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

test('empty, non-text and duplicate final messages save safe diagnoses without accepting or retrying', async () => {
  const privateText = 'SECRET_RESPONSE https://private.invalid?token=SECRET';
  const cases = [
    ['OUTPUT_MESSAGE_EMPTY', [{ type: 'item.completed', item: { type: 'agent_message', text: ' \t\r\n' } }]],
    ['OUTPUT_MESSAGE_NOT_TEXT', [{ type: 'item.completed', item: { type: 'agent_message', text: { privateText } } }]],
    ['OUTPUT_MESSAGE_NOT_TEXT', [{ type: 'item.completed', item: { type: 'agent_message' } }]],
    ['OUTPUT_MESSAGE_DUPLICATE', [privateText, privateText].map(text => ({ type: 'item.completed', item: { type: 'agent_message', text } }))],
  ];
  for (const editing of [false, true]) for (const [validatorCode, messages] of cases) {
    for (const trailingNewline of [true, false]) {
      const fake = fakeProcess(child => { sendEvents(child, [...beginning, ...messages], { trailingNewline }); child.close(0); });
      const outputRoot = output(); let error;
      await assert.rejects((editing ? editWithCodex : planWithCodex)(editing ? editContext : context,
        { outputRoot, executable, runProcess: fake.runProcess }), value => { error = value; return value.code === 'CODEX_OUTPUT_INVALID'; });
      assert.equal(fake.calls.length, 1); assert.equal(error.receipt.invocationCount, 1); assert.equal(error.receipt.automaticRetries, 0);
      assert.equal(error.receipt.status, 'FAILED'); assert.equal(error.receipt.proposalSha256, null); assert.equal(error.receipt.usage, null);
      const diagnostic = validateCodexDiagnostic(error.diagnostic, { operation: editing ? 'edit' : 'plan',
        contextSha256: (editing ? editContext : context).sha256, failureCode: error.code });
      assert.equal(diagnostic.validatorCode, validatorCode); assert.equal(diagnostic.proposalJsonSha256, null);
      assert.deepEqual(diagnostic.stream, { eventCount: 2 + messages.length, completedAgentMessages: messages.length,
        acceptedFinalMessages: validatorCode === 'OUTPUT_MESSAGE_DUPLICATE' ? 1 : 0 });
      const directory = join(outputRoot, (await readdir(outputRoot))[0]), prefix = editing ? 'codex-edit' : 'codex';
      assert.deepEqual((await readdir(directory)).sort(), [`${prefix}-diagnostic.json`, `${prefix}-receipt.json`, editing ? 'edit-context.json' : 'planning-context.json'].sort());
      assert.deepEqual(await json(join(directory, `${prefix}-diagnostic.json`)), diagnostic);
      assert(!JSON.stringify(diagnostic).includes('SECRET')); assert(!JSON.stringify(diagnostic).includes(threadId));
      assert(!JSON.stringify(diagnostic).includes('private.invalid'));
    }
  }
});

test('message rejection evidence survives child errors and forced termination without a second invocation', async () => {
  for (const termination of ['error', 'unresponsive']) {
    const fake = fakeProcess(child => {
      child.kill = () => { if (termination === 'error') queueMicrotask(() => child.emit('error', new Error('SECRET'))); return true; };
      sendEvents(child, [...beginning, { type: 'item.completed', item: { type: 'agent_message', text: '' } }]);
    });
    const { error } = await rejected(fake, 'CODEX_OUTPUT_INVALID');
    assert.equal(error.diagnostic.validatorCode, 'OUTPUT_MESSAGE_EMPTY'); assert.equal(fake.calls.length, 1);
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

test('title bar CLI transport supplies real alignment capabilities instead of a height-only substitute', async () => {
  const catalog = await json(join(harnessRoot, 'examples/modern-adaptive.catalog.json'));
  const planning = await createPlanningContext(roleRequest, catalog), spec = (await materializePanelIntent(planning, roleIntent(planning))).spec;
  const context = await createPanelEditContext(spec, catalog, { ...roleRequest, id: 'panel-edit', text: '把面板标题横向居中，其他不变。' });
  const style = { horizontalAlign: 'center', verticalAlign: null, backgroundColor: null, textColor: null, cornerRadius: null, fontSize: null, padding: 0 };
  const draft = { codexEditDraftVersion: '0.3', contextSha256: context.sha256,
    patch: { patchVersion: '0.1', baseSpecSha256: context.baseSpecSha256, reason: context.request.text, operations: [{ op: 'set-title-bar', style }] },
    bases: [{ kind: 'request-interpretation', quote: context.request.text }], unresolved: [], noChange: null };
  let dispatched;
  const fake = fakeProcess(async (child, call) => {
    dispatched = await json(call.args[call.args.indexOf('--output-schema') + 1]);
    sendEvents(child, completedEvents(JSON.stringify(draft))); child.close(0);
  });
  const result = await editWithCodex(context, { outputRoot: output(), executable, runProcess: fake.runProcess });
  assert.equal(result.report.status, 'READY_TO_APPLY'); assert.equal(fake.calls.length, 1);
  assert(codexEditOperationContracts(dispatched, context).some(op => op.operation === 'set-title-bar'));
  assert(fake.calls[0].prompt.includes('不能只改高度冒充居中成功'));
  assert(fake.calls[0].prompt.includes('不能把普通行文本的限制套在面板标题上'));
  assert.equal(fake.calls[0].prompt.includes('不支持其他文本的独立字号'),false);
  assert(fake.calls[0].prompt.includes('任一必要部分不支持就返回具体缺口'));
  assert.deepEqual(result.proposal.patch.operations, draft.patch.operations);
});

test('Text wrapping uses the real native edit schema and guide through one fake CLI child without a model call', async () => {
  const {createTextWrapFixture} = await import('../examples/text-wrap-v1/fixture.mjs');
  const {loadWorkspaceCore} = await import('../src/component-adapter.mjs');
  const fixture = await createTextWrapFixture(await json(join(harnessRoot,'examples/modern-adaptive.catalog.json')),await loadWorkspaceCore());
  const {context,proposal}=fixture;
  const draft={codexEditDraftVersion:'0.3',contextSha256:context.sha256,patch:proposal.patch,
    bases:proposal.patch.operations.map(()=>({kind:'request-interpretation',quote:context.request.text})),unresolved:[],noChange:null};
  let schema;
  const fake=fakeProcess(async(child,call)=>{schema=await json(call.args[call.args.indexOf('--output-schema')+1]);sendEvents(child,completedEvents(JSON.stringify(draft)));child.close(0);});
  const result=await editWithCodex(context,{outputRoot:output(),executable,runProcess:fake.runProcess});
  assert.equal(result.report.status,'READY_TO_APPLY');assert.equal(fake.calls.length,1);assert.equal(result.receipt.automaticRetries,0);
  assert(codexEditOperationContracts(schema,context).some(op=>op.operation==='set-text-wrap'));
  assert(fake.calls[0].prompt.includes('prompts/panel-text-wrap-editor.md'));
  assert(fake.calls[0].prompt.includes('set-text-wrap'));
  assert(!fake.calls[0].prompt.includes('文本换行、动态文案'));
  assert.deepEqual(result.proposal.patch.operations,proposal.patch.operations);
});
