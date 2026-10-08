import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkbenchServer } from '../src/workbench-server.mjs';
import { renderWorkbenchHtml } from '../src/workbench-shell.mjs';
import { createPlanningContext } from '../src/planning-context.mjs';
import { checkPanelProposal, proposalTargets } from '../src/proposal.mjs';
import { createPanelEditContext, checkPanelEditProposal } from '../src/edit-planning.mjs';
import { createCodexDiagnostic } from '../src/codex-diagnostics.mjs';
import { createWorkbenchAssetPool, workbenchRetrieval } from '../src/workbench-assets.mjs';
import { digestBytes, digestJson } from '../src/canonical.mjs';
import { createStudioBuildInfo } from '../src/studio-build-info.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const catalog = JSON.parse(await readFile(join(root, 'catalog/modern-core.json'), 'utf8'));
const spec = JSON.parse(await readFile(join(root, 'examples/audio-settings.panel.json'), 'utf8'));
await mkdir(join(root, '.tmp'), { recursive: true });
const work = await mkdtemp(join(root, '.tmp', 'workbench-server-'));
const request = { requestVersion: '0.1', id: 'audio', target: 'pixi', text: '设置面板，音量 80，声音开启。' };
const context = await createPlanningContext(request, catalog);
const copy = value => structuredClone(value);
let fixtureIndex = 0;

async function buildFixture({ pool = null, changeManifest, changeHtml, studio = false } = {}) {
  const path = join(work, `build-${fixtureIndex++}`); await mkdir(path);
  const seed = { workbenchSeedVersion: '0.1', catalog, pool, example: null };
  const buildInfo = studio ? await createStudioBuildInfo('0.1.0', { shellSha256: await digestBytes(Buffer.from(renderWorkbenchHtml(seed))),
    scriptSha256: await digestBytes(Buffer.from('/* deterministic transport test fixture */')) }) : null;
  let html = renderWorkbenchHtml(seed, buildInfo);
  if (changeHtml) html = changeHtml(html);
  const contents = [{ path: 'index.html', bytes: Buffer.from(html) }, { path: 'workbench.js', bytes: Buffer.from('/* deterministic transport test fixture */') }];
  const manifest = { workbenchBuildVersion: '0.1', status: 'COMPLETE', catalogSha256: await digestJson(catalog),
    poolSha256: pool?.sha256 ?? null, library: pool ? { id: pool.index.id, sha256: pool.index.sha256 } : null,
    recordCount: pool?.index.records.length ?? 0, imageCount: pool?.resources.length ?? 0,
    sourceReplay: pool ? 'VERIFIED_AT_BUILD' : 'NOT_APPLICABLE', example: null,
    files: await Promise.all(contents.map(async item => ({ path: item.path, bytes: item.bytes.length, sha256: await digestBytes(item.bytes) }))),
    browser: 'NOT_RUN', humanVisualReview: 'NOT_RUN', nativeEngines: 'NOT_RUN' };
  if (buildInfo) manifest.studio = buildInfo;
  changeManifest?.(manifest);
  for (const item of contents) await writeFile(join(path, item.path), item.bytes);
  await writeFile(join(path, 'workbench-build.json'), JSON.stringify(manifest));
  return path;
}
const basicBuild = await buildFixture();
function proposed(value, unresolved = false) {
  return { proposalVersion: value.planningContextVersion, contextSha256: value.sha256, spec: unresolved ? null : copy(spec),
    decisions: unresolved ? [] : proposalTargets(spec, value.planningContextVersion).map(target => ({ target,
      basis: { kind: 'request-interpretation', start: 0, end: value.request.text.length, quote: value.request.text } })),
    unresolved: unresolved ? [{ id: 'behavior', question: '确认按钮行为？' }] : [] };
}
async function planned(value, unresolved = false) {
  const proposal = proposed(value, unresolved), report = await checkPanelProposal(value, proposal);
  return { proposal, report, receipt: { codexPlanningReceiptVersion: '0.1', model: 'gpt-6-luna', effort: 'xhigh',
    contextSha256: value.sha256, proposalSha256: report.proposalSha256, status: report.status, failureCode: null,
    invocationCount: 1, automaticRetries: 0, elapsedMs: 10, usage: null } };
}
async function start(t, options = {}) {
  const server = await createWorkbenchServer({ workbench: basicBuild, outputRoot: join(work, 'calls'), planner: planned, ...options });
  t.after(() => server.close()); return server;
}
async function post(server, body = { requestId: randomUUID(), context }, headers = {}, action = 'plan') {
  return fetch(`${server.url}api/panel/${action}`, { method: 'POST', headers: {
    'Content-Type': 'application/json', Origin: server.url.slice(0, -1), 'Sec-Fetch-Site': 'same-origin', ...headers,
  }, body: typeof body === 'string' ? body : JSON.stringify(body) });
}
const expected = async (response, status, code) => { assert.equal(response.status, status); assert.deepEqual(await response.json(), { code }); };

const editContext = await createPanelEditContext(spec, catalog, { ...request, id: 'panel-edit', text: '把标题改成声音设置，其他设置保持不变。' });
async function edited(value, questions = false) {
  const proposal = { editProposalVersion: '0.1', contextSha256: value.sha256,
    patch: questions ? null : { patchVersion: '0.1', baseSpecSha256: value.baseSpecSha256, reason: '修改标题。',
      operations: [{ op: 'set-panel-title', title: '声音设置' }] },
    decisions: questions ? [] : [{ operationIndex: 0, basis: { kind: 'request-interpretation', start: 0, end: value.request.text.length, quote: value.request.text } }],
    unresolved: questions ? [{ id: 'meaning', question: '开关开启代表什么？' }] : [] };
  const report = await checkPanelEditProposal(value, proposal);
  return { proposal, report, receipt: { codexEditingReceiptVersion: '0.1', model: 'gpt-6-luna', effort: 'xhigh',
    contextSha256: value.sha256, proposalSha256: report.proposalSha256, status: report.status, failureCode: null,
    invocationCount: 1, automaticRetries: 0, elapsedMs: 10, usage: null } };
}
const postEdit = (server, body = { requestId: randomUUID(), context: editContext }, headers) => post(server, body, headers, 'edit');

test('editing admission freezes the complete source and checks patch evidence independently', async t => {
  let calls = 0;
  const server = await start(t, { editor: async (value, options) => {
    calls++; assert(Object.isFrozen(value.spec.sections[0].rows)); assert(Object.isFrozen(value.spec.state));
    assert.equal(value.baseSpecSha256, await digestJson(spec)); assert(options.signal instanceof AbortSignal);
    return edited(value);
  } });
  assert.equal((await (await fetch(`${server.url}api/panel/capabilities`)).json()).editingAvailable, true);
  const input = { requestId: randomUUID(), context: editContext }, response = await postEdit(server, input);
  assert.equal(response.status, 200); const result = await response.json();
  assert.equal(result.requestId, input.requestId); assert.equal(result.contextSha256, editContext.sha256);
  assert.deepEqual(result.report, await checkPanelEditProposal(editContext, result.proposal));
  assert.equal(result.receipt.status, 'READY_TO_APPLY'); assert.equal(result.receipt.codexEditingReceiptVersion, '0.1');
  await expected(await post(server, { requestId: input.requestId, context }), 409, 'WORKBENCH_SERVER_DUPLICATE');
  assert.equal(calls, 1);
});

test('explicit no-change editing returns its independently verified report and receipt without applying a patch', async t => {
  let calls = 0;
  const context = await createPanelEditContext(spec, catalog, { ...request, text: '保持当前面板完全一样，这次不用修改任何内容。' });
  const server = await start(t, { editor: async value => {
    calls++;
    const proposal = { editProposalVersion: '0.2', contextSha256: value.sha256, patch: null, decisions: [], unresolved: [],
      noChange: { reason: '本轮明确无需修改。', basis: { kind: 'request-interpretation', start: 0, end: value.request.text.length, quote: value.request.text } } };
    const report = await checkPanelEditProposal(value, proposal);
    return { proposal, report, receipt: { codexEditingReceiptVersion: '0.2', model: 'gpt-6-luna', effort: 'xhigh',
      contextSha256: value.sha256, proposalSha256: report.proposalSha256, status: report.status, failureCode: null,
      invocationCount: 1, automaticRetries: 0, elapsedMs: 1, usage: null } };
  } });
  const input = { requestId: randomUUID(), context }, response = await postEdit(server, input);
  assert.equal(response.status, 200); const result = await response.json();
  assert.equal(result.report.status, 'NO_CHANGES'); assert.equal(result.receipt.codexEditingReceiptVersion, '0.2');
  assert.deepEqual(result.report, await checkPanelEditProposal(context, result.proposal));
  assert.deepEqual(context.spec, spec); assert.equal(result.proposal.patch, null);
  await expected(await postEdit(server, input), 409, 'WORKBENCH_SERVER_DUPLICATE'); assert.equal(calls, 1);
});

test('planner-only test adapters cannot accidentally dispatch a real edit process', async t => {
  const server = await start(t);
  await expected(await postEdit(server), 503, 'WORKBENCH_SERVER_CODEX_UNAVAILABLE');
});

test('failed adapters expose only validated diagnostics matching this exact operation and context', async t => {
  for (const change of [{}, { operation: 'edit' }, { contextSha256: 'b'.repeat(64) }, { rawOutput: 'SECRET' }]) {
    let calls = 0;
    const server = await start(t, { planner: async value => {
      calls++;
      const error = Object.assign(new Error('SECRET_PRIVATE_MESSAGE'), { code: 'CODEX_PROPOSAL_INVALID' });
      error.diagnostic = { ...createCodexDiagnostic({ code: 'required', path: '$.state[0].initial' },
        { operation: 'plan', contextSha256: value.sha256, proposalJsonSha256: 'a'.repeat(64), stage: 'proposal-validation' }), ...change };
      throw error;
    } });
    const response = await post(server); assert.equal(response.status, 502);
    const value = await response.json(); assert.equal(value.code, 'CODEX_PROPOSAL_INVALID');
    assert.equal(Boolean(value.diagnostic), Object.keys(change).length === 0); assert.equal(calls, 1);
    assert.equal(JSON.stringify(value).includes('SECRET'), false);
  }
});

test('editing format failures expose bound constants, preserve one-shot request IDs and redact raw messages', async t => {
  for (const change of [{}, { operation: 'plan' }, { contextSha256: 'b'.repeat(64) }, { path: '$.state' },
    { validatorCode: 'EDIT_BASE_MISMATCH', path: '$.patch.baseSpecSha256', stage: 'proposal-validation' }, { rawOutput: 'SECRET' }]) {
    let calls = 0;
    const server = await start(t, { editor: async value => {
      calls++;
      const error = Object.assign(new Error('SECRET_PRIVATE_MESSAGE'), { code: 'CODEX_OUTPUT_INVALID' });
      error.diagnostic = { ...createCodexDiagnostic({ code: 'OUTPUT_JSON', path: '$' },
        { operation: 'edit', contextSha256: value.sha256, proposalJsonSha256: 'e'.repeat(64), stage: 'output-validation' }), ...change };
      throw error;
    } });
    const input = { requestId: randomUUID(), context: editContext }, response = await postEdit(server, input);
    assert.equal(response.status, 502); const value = await response.json(); assert.equal(value.code, 'CODEX_OUTPUT_INVALID');
    assert.equal(Boolean(value.diagnostic), Object.keys(change).length === 0); assert.equal(JSON.stringify(value).includes('SECRET'), false);
    await expected(await postEdit(server, input), 409, 'WORKBENCH_SERVER_DUPLICATE'); assert.equal(calls, 1);
  }
});

test('editing rejects tampering, other catalogs, wrong operation contexts and cross-origin requests before inference', async t => {
  let calls = 0; const server = await start(t, { editor: async value => { calls++; return edited(value); } });
  const changed = copy(editContext); changed.spec.title = 'tampered';
  assert.equal((await postEdit(server, { requestId: randomUUID(), context: changed })).status, 400);
  assert.equal((await postEdit(server, { requestId: randomUUID(), context })).status, 400);
  const otherCatalog = copy(catalog); otherCatalog.id = 'other';
  const other = await createPanelEditContext(spec, otherCatalog, editContext.request);
  await expected(await postEdit(server, { requestId: randomUUID(), context: other }), 400, 'WORKBENCH_SERVER_CATALOG_MISMATCH');
  await expected(await postEdit(server, undefined, { Origin: 'null' }), 403, 'WORKBENCH_SERVER_ORIGIN');
  await expected(await postEdit(server, { requestId: randomUUID(), context: editContext, model: 'other' }), 400, 'WORKBENCH_SERVER_REQUEST');
  assert.equal(calls, 0);
});

test('edit questions preserve readiness boundaries and forged reports or planning receipts cannot be used as editing evidence', async t => {
  const questions = await start(t, { editor: value => edited(value, true) });
  const result = await (await postEdit(questions)).json();
  assert.equal(result.report.status, 'NEEDS_INPUT'); assert.equal(result.proposal.patch, null);
  const mutations = [
    value => { value.report.compilation = 'PASS'; },
    value => { value.proposal.patch.baseSpecSha256 = '0'.repeat(64); },
    value => { delete value.receipt.codexEditingReceiptVersion; value.receipt.codexPlanningReceiptVersion = '0.1'; },
    value => { value.receipt.status = 'READY_TO_COMPILE'; },
    value => { value.receipt.privateLog = 'secret'; },
  ];
  for (const change of mutations) {
    const server = await start(t, { editor: async value => { const output = await edited(value); change(output); return output; } });
    const response = await postEdit(server); assert.notEqual(response.status, 200);
    assert.deepEqual(Object.keys(await response.json()), ['code']);
  }
});

test('editing and new generation share one active invocation and consumed failures are never reissued', async t => {
  let release, entered; const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; }); let calls = 0;
  const server = await start(t, { editor: async () => { calls++; entered(); await gate; throw new Error('private path'); } });
  const input = { requestId: randomUUID(), context: editContext }, pending = postEdit(server, input); await started;
  await expected(await post(server), 409, 'WORKBENCH_SERVER_BUSY');
  release(); await expected(await pending, 502, 'WORKBENCH_SERVER_FAILED');
  await expected(await postEdit(server, input), 409, 'WORKBENCH_SERVER_DUPLICATE'); assert.equal(calls, 1);
});

test('startup is read only, serves only verified snapshots and capabilities, and performs no planning', async t => {
  let calls = 0;
  const server = await start(t, { planner: async value => { calls++; return planned(value); } });
  assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  assert.deepEqual(await (await fetch(`${server.url}api/panel/capabilities`)).json(), { protocol: '0.1', model: 'gpt-6-luna', effort: 'xhigh', available: true, editingAvailable: false });
  for (const name of ['', 'index.html', 'workbench.js']) {
    const response = await fetch(`${server.url}${name}`); assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  }
  for (const name of ['workbench-build.json', 'index.html?query=1', '%2e%2e%2fpackage.json', 'api/unknown']) {
    await expected(await fetch(`${server.url}${name}`), 404, 'WORKBENCH_SERVER_NOT_FOUND');
  }
  assert.equal(calls, 0);
});

test('verified metadata and a fixed-origin restart stay read only; legacy manifests still work', async t => {
  const workbench = await buildFixture({ studio: true });
  let calls = 0;
  const planner = async () => { calls++; throw new Error('No inference authorized'); };
  const first = await start(t, { workbench, planner });
  const metadata = await (await fetch(`${first.url}api/panel/studio`)).json();
  assert.deepEqual(metadata, { protocol: '0.1', kind: 'ui-panel-studio', build: first.studio, active: false });
  assert.equal(metadata.build.appVersion, '0.1.0');
  await first.close();
  const next = await start(t, { workbench, port: Number(new URL(first.url).port), planner });
  assert.equal(next.url, first.url); assert.deepEqual(next.studio, first.studio); assert.equal(calls, 0);
  const legacy = await start(t); assert.equal((await (await fetch(`${legacy.url}api/panel/studio`)).json()).build, null);
  const tampered = await buildFixture({ studio: true, changeManifest: manifest => { manifest.studio.buildSha256 = 'c'.repeat(64); } });
  await assert.rejects(createWorkbenchServer({ workbench: tampered, outputRoot: join(work, 'calls'), planner }), { code: 'WORKBENCH_SERVER_BUILD_IDENTITY' });
  const htmlChanged = await buildFixture({ studio: true, changeHtml: html => html.replace('<title>Panel Studio', '<title>Changed Studio') });
  await assert.rejects(createWorkbenchServer({ workbench: htmlChanged, outputRoot: join(work, 'calls'), planner }), { code: 'WORKBENCH_SERVER_BUILD_IDENTITY' });
});

test('admission fixes the immutable context, returns independently checked results and never reuses a request ID', async t => {
  let calls = 0;
  const server = await start(t, { planner: async (value, options) => {
    calls++; assert.ok(Object.isFrozen(value.request)); assert.ok(Object.isFrozen(value.catalog));
    assert.equal(options.outputRoot, join(work, 'calls')); assert.ok(options.signal instanceof AbortSignal);
    return planned(value);
  } });
  const input = { requestId: randomUUID(), context };
  const response = await post(server, input); assert.equal(response.status, 200);
  const result = await response.json(); assert.equal(result.requestId, input.requestId); assert.equal(result.contextSha256, context.sha256);
  assert.deepEqual(result.report, await checkPanelProposal(context, result.proposal));
  assert.equal(result.receipt.model, 'gpt-6-luna'); assert.equal(result.receipt.effort, 'xhigh');
  await expected(await post(server, input), 409, 'WORKBENCH_SERVER_DUPLICATE');
  await expected(await post(server, { ...input, requestId: input.requestId.toUpperCase() }), 409, 'WORKBENCH_SERVER_DUPLICATE');
  assert.equal(calls, 1);
});

test('the loopback bridge denies other hosts, null/file origins, cross-site calls and non-JSON or oversized bodies', async t => {
  let calls = 0; const server = await start(t, { planner: async value => { calls++; return planned(value); } });
  for (const origin of ['null', 'file://', 'https://example.com', 'http://localhost:4184']) {
    await expected(await post(server, undefined, { Origin: origin }), 403, 'WORKBENCH_SERVER_ORIGIN');
  }
  await expected(await post(server, undefined, { 'Sec-Fetch-Site': 'cross-site' }), 403, 'WORKBENCH_SERVER_ORIGIN');
  await expected(await post(server, undefined, { 'Content-Type': 'text/plain' }), 415, 'WORKBENCH_SERVER_CONTENT_TYPE');
  await expected(await post(server, ' '.repeat(2 * 1024 * 1024 + 1)), 413, 'WORKBENCH_SERVER_BODY_LIMIT');
  await expected(await post(server, '{'), 400, 'WORKBENCH_SERVER_JSON');
  await expected(await fetch(`${server.url}api/panel/plan`, { method: 'OPTIONS' }), 405, 'WORKBENCH_SERVER_METHOD');
  const hostResponse = await new Promise((resolveResponse, reject) => {
    const operation = httpRequest(server.url, { headers: { Host: 'attacker.invalid' } }, response => {
      let body = ''; response.on('data', chunk => { body += chunk; }); response.on('end', () => resolveResponse({ status: response.statusCode, body: JSON.parse(body) }));
    }); operation.on('error', reject); operation.end();
  });
  assert.deepEqual(hostResponse, { status: 403, body: { code: 'WORKBENCH_SERVER_HOST' } }); assert.equal(calls, 0);
});

test('tampered contexts and extra command/model fields fail before invoking the planner', async t => {
  let calls = 0; const server = await start(t, { planner: async value => { calls++; return planned(value); } });
  await expected(await post(server, { requestId: randomUUID(), context, command: 'arbitrary' }), 400, 'WORKBENCH_SERVER_REQUEST');
  const changed = copy(context); changed.request.text = 'rewritten';
  assert.equal((await post(server, { requestId: randomUUID(), context: changed })).status, 400);
  const otherCatalog = copy(catalog); otherCatalog.id = 'other-catalog';
  const other = await createPlanningContext(request, otherCatalog);
  await expected(await post(server, { requestId: randomUUID(), context: other }), 400, 'WORKBENCH_SERVER_CATALOG_MISMATCH');
  assert.equal(calls, 0);
});

test('one flight runs at a time; an indeterminate failed call is consumed and diagnostics redact private messages', async t => {
  let release, entered; const gate = new Promise(resolveGate => { release = resolveGate; });
  const started = new Promise(resolveStart => { entered = resolveStart; }); let calls = 0;
  const server = await start(t, { planner: async () => { calls++; entered(); await gate; throw new Error('private C:\\Users\\name\\secret'); } });
  const input = { requestId: randomUUID(), context }, pending = post(server, input); await started;
  await expected(await post(server), 409, 'WORKBENCH_SERVER_BUSY');
  release(); await expected(await pending, 502, 'WORKBENCH_SERVER_FAILED');
  await expected(await post(server, input), 409, 'WORKBENCH_SERVER_DUPLICATE'); assert.equal(calls, 1);
});

test('planner questions are honest successful NEEDS_INPUT outputs and forged reports or receipts never pass', async t => {
  const questions = await start(t, { planner: value => planned(value, true) });
  const result = await (await post(questions)).json(); assert.equal(result.report.status, 'NEEDS_INPUT'); assert.equal(result.proposal.spec, null);
  const mutations = [
    value => { value.report.semanticReview = 'PASS'; },
    value => { value.receipt.model = 'another-model'; },
    value => { value.receipt.privatePath = 'C:\\private'; },
    value => { value.receipt.proposalSha256 = '0'.repeat(64); },
    value => { value.proposal.contextSha256 = '0'.repeat(64); },
  ];
  for (const change of mutations) {
    const server = await start(t, { planner: async value => { const result = await planned(value); change(result); return result; } });
    const response = await post(server); assert.notEqual(response.status, 200);
    assert.deepEqual(Object.keys(await response.json()), ['code']);
  }
});

test('client disconnect and close abort the active planner signal without resubmission', async t => {
  let entered, aborted; const started = new Promise(resolveStart => { entered = resolveStart; });
  const cancelled = new Promise(resolveCancel => { aborted = resolveCancel; }); let calls = 0;
  const server = await start(t, { planner: async (_value, { signal }) => {
    calls++; entered(); await new Promise(resolveAbort => signal.addEventListener('abort', resolveAbort, { once: true }));
    aborted(); throw Object.assign(new Error('cancelled'), { code: 'CODEX_ABORTED' });
  } });
  const controller = new AbortController();
  const pending = fetch(`${server.url}api/panel/plan`, { method: 'POST', signal: controller.signal,
    headers: { Origin: server.url.slice(0, -1), 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: randomUUID(), context }) });
  await started; controller.abort(); await assert.rejects(pending); await cancelled; assert.equal(calls, 1);
  let closeEntered, closeAborted;
  const closeStarted = new Promise(resolveStart => { closeEntered = resolveStart; });
  const closeCancelled = new Promise(resolveCancel => { closeAborted = resolveCancel; });
  const closingServer = await start(t, { planner: async (_value, { signal }) => {
    closeEntered(); await new Promise(resolveAbort => signal.addEventListener('abort', resolveAbort, { once: true }));
    closeAborted(); throw new Error('cancelled');
  } });
  const closingRequest = post(closingServer).catch(() => null);
  await closeStarted; await closingServer.close(); await closeCancelled; await closingRequest;
});

test('the bounded single-use ledger refuses request 257 without calling a model again', async t => {
  let calls = 0; const server = await start(t, { planner: async value => { calls++; return planned(value, true); } });
  for (let i = 0; i < 256; i++) assert.equal((await post(server)).status, 200);
  await expected(await post(server), 429, 'WORKBENCH_SERVER_REQUEST_LIMIT'); assert.equal(calls, 256);
});

test('startup rejects altered bytes, manifest path tricks, seed mismatches, symlink ancestry and output escape', async t => {
  const wrongBytes = await buildFixture(); await writeFile(join(wrongBytes, 'workbench.js'), 'changed');
  const wrongPath = await buildFixture({ changeManifest: manifest => { manifest.files[1].path = '../workbench.js'; } });
  const wrongSeed = await buildFixture({ changeManifest: manifest => { manifest.catalogSha256 = '0'.repeat(64); } });
  const wrongSeedCount = await buildFixture({ changeHtml: html => html.replace('</body>', '<script id="workbench-seed" type="application/json">{}</script></body>') });
  for (const workbench of [wrongBytes, wrongPath, wrongSeed, wrongSeedCount]) {
    await assert.rejects(createWorkbenchServer({ workbench, outputRoot: join(work, 'calls'), planner: planned }));
  }
  await assert.rejects(createWorkbenchServer({ workbench: basicBuild, outputRoot: join(root, '..', 'outside'), planner: planned }), { code: 'OUTPUT_OUTSIDE_HARNESS' });
  const linked = join(work, 'linked-build');
  try { await symlink(basicBuild, linked, 'junction'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.diagnostic('Host denied symlink creation; symlink fixture unavailable.'); return; } throw error; }
  await assert.rejects(createWorkbenchServer({ workbench: linked, outputRoot: join(work, 'calls'), planner: planned }), { code: 'WORKBENCH_SERVER_LINK_FORBIDDEN' });
});

async function fixturePool() {
  const bytes = new Uint8Array(await readFile(join(root, 'examples/custom-assets/panel-surface.png'))), sha256 = await digestBytes(bytes);
  const path = `textures/${sha256}.png`, metadata = { id: 'volume', version: '1.0.0', name: '音量', role: 'icon',
    tags: ['音量', '声音', '面板'], size: { width: 64, height: 64 }, family: 'volume', style: 'mint', variant: 'default', slice: null };
  const body = { key: 'test-kit/volume@1.0.0', namespace: 'test-kit', metadata,
    source: { format: 'png', file: { path: `sources/${sha256}.png`, sha256, bytes: bytes.length } },
    file: { path, sha256, bytes: bytes.length }, image: { width: 64, height: 64, channels: 4,
      alpha: { mode: 'opaque', opaquePixels: 4096, softPixels: 0, transparentPixels: 0, hiddenRgbPixels: 0, visibleBounds: { x: 0, y: 0, width: 64, height: 64 } } } };
  const revision = await digestJson(body), record = { ...body, revision, preview: { path: `previews/${revision}.png`, sha256, bytes: bytes.length } };
  const payload = { assetLibraryVersion: '0.1', id: 'test-library', parent: null, renderer: { name: 'test-fixture', version: '1' }, records: [record],
    summary: { versions: 1, assets: 1, pngFiles: 1, sourceFiles: 1, roles: { icon: 1, shape: 0, effect: 0, 'layout-primitive': 0, 'animation-part': 0 } },
    changes: { added: [record.key], reused: [], retained: [] },
    verification: { files: 'HASHED', images: 'DECODED_NONEMPTY_ALPHA_CLEAN', semanticReview: 'NOT_RUN', visualReview: 'NOT_RUN', nativeEngines: 'NOT_RUN' } };
  return createWorkbenchAssetPool({ ...payload, sha256: await digestJson(payload) }, [{ path, mime: 'image/png', bytes }]);
}

test('editing requires the exact embedded asset library and existing PNG selection before any invocation', async t => {
  const pool = await fixturePool(), workbench = await buildFixture({ pool });
  const source = copy(spec); source.panelSpecVersion = '0.2';
  source.assets = { library: { id: pool.index.id, sha256: pool.index.sha256 }, panelSurface: null,
    rowIcons: [{ rowId: source.sections[0].rows[0].id, asset: pool.index.records[0].key }] };
  const valid = await createPanelEditContext(source, catalog, editContext.request);
  let calls = 0; const server = await start(t, { workbench, editor: async value => { calls++; return edited(value); } });
  assert.equal((await postEdit(server, { requestId: randomUUID(), context: valid })).status, 200);
  const wrongLibrary = copy(source); wrongLibrary.assets.library.id = 'another-library';
  await expected(await postEdit(server, { requestId: randomUUID(), context: await createPanelEditContext(wrongLibrary, catalog, editContext.request) }),
    400, 'PANEL_ASSET_LIBRARY_MISMATCH');
  const missing = copy(source); missing.assets.rowIcons[0].asset = 'test-kit/missing@1.0.0';
  await expected(await postEdit(server, { requestId: randomUUID(), context: await createPanelEditContext(missing, catalog, editContext.request) }),
    400, 'PANEL_ASSET_SELECTION');
  const noPool = await start(t, { editor: async value => { calls++; return edited(value); } });
  await expected(await postEdit(noPool, { requestId: randomUUID(), context: valid }), 400, 'WORKBENCH_SERVER_POOL_REQUIRED');
  assert.equal(calls, 1);
});

test('the server recomputes candidate membership against the entire pinned pool, including omitted candidates', async t => {
  const pool = await fixturePool(), workbench = await buildFixture({ pool });
  const retrieval = workbenchRetrieval(request.text, pool), valid = await createPlanningContext(request, catalog, retrieval);
  assert.ok(retrieval.candidates.length > 0);
  let calls = 0; const server = await start(t, { workbench, planner: async value => { calls++; return planned(value); } });
  assert.equal((await post(server, { requestId: randomUUID(), context: valid })).status, 200);
  const missing = copy(retrieval); missing.candidates = [];
  const forged = await createPlanningContext(request, catalog, missing);
  await expected(await post(server, { requestId: randomUUID(), context: forged }), 400, 'PLAN_ASSET_RETRIEVAL_MISMATCH');
  await expected(await post(server), 400, 'PLAN_ASSET_CONTEXT_REQUIRED');
  assert.equal(calls, 1);
});
