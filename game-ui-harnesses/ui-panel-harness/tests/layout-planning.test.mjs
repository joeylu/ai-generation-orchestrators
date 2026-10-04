import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { digestJson, canonicalJson } from '../src/canonical.mjs';
import { createPlanningContext, validatePlanningContext } from '../src/planning-context.mjs';
import { proposalTargets, validatePanelProposal, checkPanelProposal, requireReadyProposal } from '../src/proposal.mjs';
import { planWithCodex } from '../src/codex-planner.mjs';
import { harnessRoot } from '../src/io.mjs';

const readJson = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const legacyCatalog = await readJson('../examples/modern-mint-light.catalog.json');
const controlsCatalog = await readJson('../examples/modern-mint-controls.catalog.json');
const catalog = await readJson('../examples/modern-mint-layout.catalog.json');
const legacySpec = await readJson('../examples/settings-controls.panel.json');
const request = { requestVersion: '0.1', id: 'layout-profile', target: 'pixi',
  text: '角色资料显示姓名“蓝莓”和等级“12”，只读文字无需交互。用纵向布局，保留角色资料分组。' };
const emptyRetrieval = { assetRetrievalVersion: '0.1', library: { id: 'layout-test', sha256: 'a'.repeat(64) },
  policy: { algorithm: 'lexical-v1', latestOnly: true, limitPerSlot: 16, style: null }, candidates: [] };
const copy = value => structuredClone(value);
function profileSpec() {
  const spec = copy(legacySpec);
  spec.panelSpecVersion = '0.4'; spec.id = 'profile'; spec.title = '角色资料'; spec.state = [];
  spec.layout = { ...spec.layout, maxHeight: 700, overflow: 'scroll', body: {
    id: 'profile-body', kind: 'column', width: 'fill', gap: 24, align: 'start',
    children: [{ kind: 'section', sectionId: 'profile-details', width: 'fill' }],
  } };
  spec.sections = [{ id: 'profile-details', title: '角色资料', rows: [
    { id: 'name-row', kind: 'text', recipe: { id: 'settings.text', version: '0.1.0' }, label: '姓名', text: '蓝莓' },
    { id: 'level-row', kind: 'text', recipe: { id: 'settings.text', version: '0.1.0' }, label: '等级', text: '12' },
  ] }];
  spec.provenance = { kind: 'programmatic-fixture', description: 'Explicit read-only profile fixture; no real model invocation.', assumptions: [] };
  return spec;
}
function proposalFor(context, spec = profileSpec()) {
  return { proposalVersion: context.planningContextVersion, contextSha256: context.sha256, spec, unresolved: [],
    decisions: proposalTargets(spec, context.planningContextVersion).map(target => ({ target,
      basis: target.startsWith('row:') || target.startsWith('state:')
        ? { kind: 'request-interpretation', start: 0, end: context.request.text.length, quote: context.request.text }
        : { kind: 'design-choice', reason: 'Explicit fixture layout and visual configuration; not a semantic approval.' },
    })) };
}
async function rehash(context) {
  const { sha256, ...payload } = context;
  return { ...payload, sha256: await digestJson(payload) };
}

test('layout integration preserves all pre-layout context versions and canonical hashes', async () => {
  const input = { requestVersion: '0.1', id: 'layout-regression', text: '音量 slider 设置面板', target: 'pixi' };
  const cases = [
    [legacyCatalog, undefined, '0.1', 'dbcf282f188a336883665e4638f4892558cb8fceff8848a4b1a712f695ed4289'],
    [legacyCatalog, emptyRetrieval, '0.2', 'bc644d9e4a0c99d1aebc6513b8c84c3d98e0da6b3fe83fb8107b20d954ddcb89'],
    [controlsCatalog, undefined, '0.3', '005d3cc3155e6f54f85774fddb0d1767447f33c88692f7eecddbcf87e26ad7e8'],
    [controlsCatalog, emptyRetrieval, '0.3', 'c70d8f9157d28b21c08e8fd25d43073c79add64c397c73ed21aa228ee25e6976'],
  ];
  for (const [source, retrieval, version, digest] of cases) {
    const context = await createPlanningContext(input, source, retrieval);
    assert.equal(context.planningContextVersion, version); assert.equal(context.sha256, digest);
    assert.deepEqual(await validatePlanningContext(context), context);
  }
});

test('text-row catalog enables context 0.4 flow layout and read-only text capabilities', async () => {
  const context = await createPlanningContext(request, catalog);
  assert.equal(context.planningContextVersion, '0.4'); assert.equal(context.assetRetrieval, null);
  assert.deepEqual(context.capabilities.rowKinds, ['slider', 'switch', 'select', 'button', 'text']);
  assert.deepEqual(context.capabilities.panelSpecVersions, ['0.1', '0.2', '0.3', '0.4']);
  assert.equal(context.capabilities.layout, 'flow-containers-v1');
  assert.deepEqual(context.capabilities.actions, ['emit', 'reset-initial']);
  assert.equal(context.capabilities.semanticReview, 'NOT_RUN');
  assert.deepEqual(await createPlanningContext(request, catalog, null), context);
  assert.deepEqual(await validatePlanningContext(context), context);
  assert.ok(context.candidates.some(candidate => candidate.kind === 'text-row'));
  const onlyTextAdded = copy(legacyCatalog); onlyTextAdded.recipes.push(copy(catalog.recipes.find(r => r.kind === 'text-row')));
  assert.equal((await createPlanningContext(request, onlyTextAdded)).planningContextVersion, '0.4');
});

test('layout context capabilities and version are derived, not accepted from a caller-rehashed claim', async () => {
  const context = await createPlanningContext(request, catalog);
  for (const change of [
    input => { input.planningContextVersion = '0.3'; },
    input => { input.capabilities.layout = 'absolute-script-layout'; },
    input => { input.capabilities.rowKinds.push('input'); },
    input => { input.capabilities.actions.push('run-script'); },
  ]) {
    const altered = copy(context); change(altered);
    await assert.rejects(validatePlanningContext(await rehash(altered)), { code: 'context-mismatch' });
  }
  const missing = copy(context); delete missing.assetRetrieval;
  await assert.rejects(validatePlanningContext(await rehash(missing)), { code: 'required' });
});

test('read-only text still requires exact request evidence and has no invented state target', async () => {
  const context = await createPlanningContext(request, catalog), proposal = proposalFor(context);
  assert.deepEqual(await validatePanelProposal(context, proposal), proposal);
  assert.ok(proposalTargets(proposal.spec, '0.4').includes('row:name-row'));
  assert.ok(!proposalTargets(proposal.spec, '0.4').some(target => target.startsWith('state:')));
  const report = await checkPanelProposal(context, proposal);
  assert.equal(report.planningReportVersion, '0.4'); assert.equal(report.status, 'READY_TO_COMPILE');
  assert.equal(report.semanticReview, 'NOT_RUN'); assert.equal(report.humanVisualReview, 'NOT_RUN');
  const invented = copy(proposal);
  invented.decisions.find(item => item.target === 'row:level-row').basis = { kind: 'design-choice', reason: 'Invent a decorative role level.' };
  await assert.rejects(validatePanelProposal(context, invented), { code: 'PLAN_BUSINESS_ORIGIN' });
  const badQuote = copy(proposal); badQuote.decisions.find(item => item.target === 'row:name-row').basis.quote = '姓名蓝莓';
  await assert.rejects(validatePanelProposal(context, badQuote), { code: 'PLAN_QUOTE' });
  const incomplete = copy(proposal); incomplete.decisions = incomplete.decisions.filter(item => item.target !== 'row:name-row');
  await assert.rejects(validatePanelProposal(context, incomplete), { code: 'PLAN_COVERAGE' });
});

test('proposal 0.4 accepts older specs but a layout spec cannot enter older contexts', async () => {
  const context = await createPlanningContext(request, catalog);
  assert.deepEqual((await validatePanelProposal(context, proposalFor(context, copy(legacySpec)))).spec, legacySpec);
  const oldContext = await createPlanningContext(request, controlsCatalog);
  await assert.rejects(validatePanelProposal(oldContext, proposalFor(oldContext)), { code: 'PLAN_SPEC_CONTEXT_VERSION' });
  for (const version of ['0.1', '0.2', '0.3']) {
    const mismatched = proposalFor(context); mismatched.proposalVersion = version;
    await assert.rejects(validatePanelProposal(context, mismatched), { code: 'PLAN_ASSET_CONTEXT_VERSION' });
  }
  const future = proposalFor(context); future.proposalVersion = '0.6';
  await assert.rejects(validatePanelProposal(context, future), { code: 'PLAN_VERSION' });
  const blocked = { proposalVersion: '0.4', contextSha256: context.sha256, spec: null, decisions: [],
    unresolved: [{ id: 'profile-content', question: '需要显示哪些角色资料？' }] };
  assert.equal((await checkPanelProposal(context, blocked)).status, 'NEEDS_INPUT');
  await assert.rejects(requireReadyProposal(context, blocked), { code: 'PLAN_NEEDS_INPUT' });
});

test('proposal 0.4 includes per-asset decisions and enforces the pinned candidate slots', async () => {
  const context = await createPlanningContext(request, catalog, emptyRetrieval), spec = profileSpec();
  spec.assets = { library: copy(emptyRetrieval.library), panelSurface: 'layout-test/surface@1.0.0',
    rowIcons: [{ rowId: 'name-row', asset: 'layout-test/person@1.0.0' }] };
  const targets = proposalTargets(spec, '0.4');
  for (const target of ['assets', 'asset:surface', 'asset:row:name-row']) assert.ok(targets.includes(target));
  await assert.rejects(validatePanelProposal(context, proposalFor(context, spec)), { code: 'PLAN_ASSET_CANDIDATE' });
  const unpinnedContext = await createPlanningContext(request, catalog), proposal = proposalFor(unpinnedContext, spec);
  await validatePanelProposal(unpinnedContext, proposal);
  proposal.decisions = proposal.decisions.filter(decision => decision.target !== 'asset:row:name-row');
  await assert.rejects(validatePanelProposal(unpinnedContext, proposal), { code: 'PLAN_COVERAGE' });
});

test('proposal 0.4 schema registers all spec generations and restricts row decisions to request evidence', async () => {
  const schema = await readJson('../schemas/panel-proposal-v0.4.schema.json');
  assert.equal(schema.$id, 'urn:ai-game-assets:panel-proposal:0.4');
  assert.equal(schema.properties.proposalVersion.const, '0.4');
  assert.deepEqual(schema.properties.spec.oneOf[1].allOf[0].oneOf.map(item => item.$ref),
    ['0.1', '0.2', '0.3', '0.4'].map(version => `urn:ai-game-assets:panel-spec:${version}`));
  const designTarget = schema.$defs.decision.allOf[0].then.properties.target;
  assert.equal(designTarget.oneOf.some(item => item.enum?.includes('row:name-row')), false);
  assert.ok(designTarget.oneOf.every(item => !item.pattern || !new RegExp(item.pattern).test('row:name-row')));
});

test('local planner transport pins the complete 0.4 context and accepts strictly checked legacy proposals', async () => {
  const context = await createPlanningContext(request, catalog);
  await mkdir(join(harnessRoot, '.tmp'), { recursive: true });
  const directory = await mkdtemp(join(harnessRoot, '.tmp', 'layout-contract-'));
  const executable = join(directory, process.platform === 'win32' ? 'codex.exe' : 'codex');
  await writeFile(executable, 'Non-executable fixture; this test only uses an in-memory child-process double.');
  const calls = [];
  const runProcess = (command, args, options) => {
    const child = new EventEmitter(), call = { command, args, options, prompt: '' }; calls.push(call);
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
    child.stdin = new Writable({
      write(chunk, encoding, callback) { call.prompt += chunk.toString(); callback(); },
      final(callback) { callback(); queueMicrotask(() => {
        const proposal = { proposalVersion: '0.4', contextSha256: context.sha256, spec: null, decisions: [],
          unresolved: [{ id: 'fixture-question', question: '这是传输测试替身，等待测试问题的答案。' }] };
        child.stdout.end([
          { type: 'thread.started', thread_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
          { type: 'turn.started' },
          { type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify({ proposalJson: JSON.stringify(proposal) }) } },
          { type: 'turn.completed' },
        ].map(event => JSON.stringify(event)).join('\n') + '\n');
        child.emit('close', 0);
      }); },
    });
    return child;
  };
  const result = await planWithCodex(context, { executable, outputRoot: join(directory, 'output'), runProcess });
  assert.equal(calls.length, 1); assert.equal(result.report.status, 'NEEDS_INPUT');
  assert.equal(result.report.planningReportVersion, '0.4'); assert.equal(result.receipt.automaticRetries, 0);
  assert.ok(calls[0].prompt.includes('Return ONE PanelIntent 0.3 JSON object directly'));
  assert.ok(calls[0].prompt.includes('UNTRUSTED DATA'));
  assert.ok(calls[0].prompt.includes(JSON.stringify(context.request.text)));
  assert.ok(calls[0].prompt.includes(canonicalJson(context.catalog)));
  assert.ok(!calls[0].prompt.includes('Public contract reference: examples/controls-planning/proposal.json'));
  assert.ok(calls[0].prompt.includes('flow-containers-v1')); assert.ok(calls[0].prompt.includes(context.sha256));
});
