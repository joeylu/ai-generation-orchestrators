#!/usr/bin/env node
/** Visible browser regression against a real loopback server and an explicit planner test double. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '../../ui-component-harness/node_modules/@playwright/test/index.mjs';
import { createOutputDirectory, readJson, writeNewJson } from '../src/io.mjs';
import { digestBytes, digestJson } from '../src/canonical.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { validatePanelBundle } from '../src/panel-bundle.mjs';
import { checkPanelProposal } from '../src/proposal.mjs';
import { initialPanelState, controlId } from '../src/compiler.mjs';
import { createWorkbenchServer } from '../src/workbench-server.mjs';
import { checkPanelEditProposal } from '../src/edit-planning.mjs';
import { createCodexDiagnostic } from '../src/codex-diagnostics.mjs';
import { materializeCodexPanelDraft } from '../src/codex-panel-draft.mjs';

const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) {
  assert(['--workbench', '--output'].includes(args[i]) && args[i + 1] && !options[args[i]], 'Expected --workbench and --output exactly once');
  options[args[i]] = args[i + 1];
}
assert.equal(Object.keys(options).length, 2, 'Required: --workbench <built directory> --output <fresh directory>');
const directory = await createOutputDirectory(options['--output']);
const report = { version: '0.1', status: 'RUNNING', checks: [], screenshots: [], providerCalls: 0,
  scope: 'Real local server, built workbench and Pixi; planner responses are test doubles; no Codex/model process is launched',
  browserPath: { driver: 'Playwright', mode: 'repository-acceptance-script' },
  humanVisualReview: 'NOT_RUN', nativeEngines: 'NOT_RUN' };
const pass = (name, evidence = {}) => report.checks.push({ name, status: 'PASS', ...evidence });
const pause = () => { let release; const wait = new Promise(resolve => { release = resolve; }); return { wait, release }; };
let browser, context, page, server, stage = 'validate-static-build', behavior = 'ready', gate;
let faultExpected = false, expectedAborts = 0, expectedHttpErrors = 0, capabilityRequests = 0, planRequests = 0;
const problems = [], calls = [];
const expectedCancelledRequests = new Set(), latestModelRequests = new Map(), requestFailures = [];
const transportObservations = [], requestBindings = new WeakMap();
const requestFailureChecks = [];
let editBehavior = 'ready', editRequests = 0;
const editCalls = [];
function editProposalFor(editing, mode = 'ready') {
  const rows = editing.spec.sections.flatMap(section => section.rows), toggle = rows.find(row => row.kind === 'switch');
  const volume = editing.spec.state.find(field => field.type === 'number');
  const section = editing.spec.sections.find(section => section.rows.some(row => row.id === toggle.id));
  const operations = [{ op: 'set-panel-title', title: mode === 'overflow' ? '宽'.repeat(120) : '声音设置' }];
  if (mode !== 'title-only') operations.push(
    { op: 'set-state-initial', fieldId: volume.id, value: 30 },
    { op: 'add-row', sectionId: section.id, afterRowId: toggle.id,
      row: { ...toggle, id: 'sfx-enabled-row', label: '音效', bind: 'sfxEnabled', event: 'sfx.enabledChanged', enabled: true },
      state: { id: 'sfxEnabled', type: 'boolean', initial: true } });
  return { editProposalVersion: '0.1', contextSha256: editing.sha256,
    patch: { patchVersion: '0.1', baseSpecSha256: editing.baseSpecSha256, reason: '修改标题、创作默认值并增加音效开关。', operations },
    decisions: operations.map((_operation, operationIndex) => ({ operationIndex,
      basis: { kind: 'request-interpretation', start: 0, end: editing.request.text.length, quote: editing.request.text } })),
    unresolved: mode === 'questions' ? [{ id: 'sfx-meaning', question: '新增开关开启时代表什么？' }] : [] };
}

try {
  const core = await loadWorkspaceCore();
  const manifest = await readJson(resolve(options['--workbench'], 'workbench-build.json'));
  assert.equal(manifest.workbenchBuildVersion, '0.1'); assert.equal(manifest.status, 'COMPLETE');
  assert.deepEqual(manifest.files.map(file => file.path).sort(), ['index.html', 'workbench.js']);
  const files = new Map();
  for (const file of manifest.files) {
    const bytes = await readFile(resolve(options['--workbench'], file.path));
    assert.equal(bytes.length, file.bytes); assert.equal(await digestBytes(bytes), file.sha256); files.set(file.path, bytes);
  }
  const match = files.get('index.html').toString('utf8').match(/<script id="workbench-seed" type="application\/json">([\s\S]*?)<\/script>/u);
  assert(match, 'Static HTML must embed its seed');
  const seed = JSON.parse(match[1]); assert(seed.example, 'Acceptance fixture requires a complete example');
  assert.equal(await digestJson(seed.catalog), manifest.catalogSha256);
  report.build = manifest; pass(stage);

  const planner = async (planning, transport) => {
    const call = { contextSha256: planning.sha256, request: structuredClone(planning.request), behavior,
      signal: transport.signal, aborted: false };
    calls.push(call);
    const ownBehavior = behavior;
    if (ownBehavior === 'validation-fail') {
      const error = Object.assign(new Error('SECRET_PRIVATE_MESSAGE'), { code: 'CODEX_PROPOSAL_INVALID' });
      error.diagnostic = createCodexDiagnostic({ code: 'PLAN_COVERAGE', path: '$.decisions' },
        { operation: 'plan', contextSha256: planning.sha256, proposalJsonSha256: 'd'.repeat(64), stage: 'proposal-validation' });
      throw error;
    }
    if (['target-duplicate', 'target-unmatched'].includes(ownBehavior)) {
      const error = Object.assign(new Error('SECRET_PRIVATE_MESSAGE'), { code: 'CODEX_PROPOSAL_INVALID' });
      error.diagnostic = createCodexDiagnostic({ code: 'PLAN_TARGET', path: '$.decisions[10].target',
        targetIssue: ownBehavior === 'target-duplicate' ? 'duplicate' : 'unmatched' },
        { operation: 'plan', contextSha256: planning.sha256, proposalJsonSha256: 'f'.repeat(64), stage: 'proposal-validation' });
      throw error;
    }
    if (ownBehavior === 'hold') await new Promise((resolveWait, rejectWait) => {
      const aborted = () => { call.aborted = true; cleanup(); rejectWait(Object.assign(new Error('CODEX_PLANNER_ABORTED'), { code: 'CODEX_PLANNER_ABORTED' })); };
      const cleanup = () => transport.signal.removeEventListener('abort', aborted);
      transport.signal.addEventListener('abort', aborted, { once: true });
      if (transport.signal.aborted) return aborted();
      gate.wait.then(() => { cleanup(); resolveWait(); });
    });
    if (ownBehavior === 'fail') throw Object.assign(new Error('CODEX_PLANNER_FAILED'), { code: 'CODEX_PLANNER_FAILED' });
    const spec = structuredClone(seed.example.proposal.spec);
    spec.title = ownBehavior === 'overflow' ? '宽'.repeat(120) : '自动生成的设置';
    spec.provenance = { kind: 'agent-authored', description: 'Explicit browser acceptance proposal fixture; no model was called.', assumptions: [] };
    const basis = () => ({ kind: 'request-interpretation', start: 0, end: planning.request.text.length, quote: planning.request.text });
    const draft = ownBehavior === 'questions'
      ? { codexPanelDraftVersion: '0.1', contextSha256: planning.sha256, spec: null, bases: null,
        unresolved: [{ id: 'reset-scope', question: '恢复默认应包含哪些设置？' }] }
      : { codexPanelDraftVersion: '0.1', contextSha256: planning.sha256, spec, unresolved: [],
        bases: { panel: basis(), theme: basis(), canvas: basis(), layout: basis(),
          assets: spec.assets ? { overall: basis(), surface: spec.assets.panelSurface ? basis() : null, rowIcons: spec.assets.rowIcons.map(basis) } : null,
          sections: spec.sections.map(section => ({ section: basis(), rows: section.rows.map(basis) })), state: spec.state.map(basis) } };
    if (ownBehavior === 'draft-count') draft.bases.state.pop();
    let proposal;
    try { proposal = await materializeCodexPanelDraft(planning, draft); }
    catch (cause) {
      const error = Object.assign(new Error('SECRET_PRIVATE_MESSAGE'), { code: 'CODEX_PROPOSAL_INVALID' });
      error.diagnostic = createCodexDiagnostic(cause,
        { operation: 'plan', contextSha256: planning.sha256, proposalJsonSha256: await digestJson(draft), stage: 'draft-validation' });
      throw error;
    }
    const checked = await checkPanelProposal(planning, proposal);
    // This is a deterministic test-double receipt, never evidence of a real provider run.
    const receipt = { codexPlanningReceiptVersion: '0.1', status: checked.status,
      model: 'gpt-6-luna', effort: 'xhigh', contextSha256: planning.sha256,
      proposalSha256: checked.proposalSha256, failureCode: null, invocationCount: 1,
      automaticRetries: 0, elapsedMs: 0, usage: null };
    return { proposal, report: checked, receipt };
  };
  const editor = async (editing, transport) => {
    const ownBehavior = editBehavior, call = { contextSha256: editing.sha256, request: structuredClone(editing.request),
      baseSpecSha256: editing.baseSpecSha256, behavior: ownBehavior, signal: transport.signal, aborted: false };
    editCalls.push(call);
    if (ownBehavior.startsWith('output-')) {
      const error = Object.assign(new Error('SECRET_PRIVATE_MESSAGE'), { code: 'CODEX_OUTPUT_INVALID' });
      const codes = { 'output-json': 'OUTPUT_JSON', 'output-wrapper': 'OUTPUT_WRAPPER', 'output-proposal-json': 'OUTPUT_PROPOSAL_JSON' };
      error.diagnostic = createCodexDiagnostic({ code: codes[ownBehavior], path: ownBehavior === 'output-json' ? '$' : '$.proposalJson' },
        { operation: 'edit', contextSha256: editing.sha256, proposalJsonSha256: 'a'.repeat(64), stage: 'output-validation' });
      throw error;
    }
    if (ownBehavior === 'validation-fail') {
      const error = Object.assign(new Error('SECRET_PRIVATE_MESSAGE'), { code: 'CODEX_PROPOSAL_INVALID' });
      error.diagnostic = createCodexDiagnostic({ code: 'EDIT_BASE_MISMATCH', path: '$.patch.baseSpecSha256' },
        { operation: 'edit', contextSha256: editing.sha256, proposalJsonSha256: 'e'.repeat(64), stage: 'proposal-validation' });
      throw error;
    }
    if (ownBehavior === 'hold') await new Promise((resolveWait, rejectWait) => {
      const aborted = () => { call.aborted = true; cleanup(); rejectWait(Object.assign(new Error('CODEX_ABORTED_NO_RETRY'), { code: 'CODEX_ABORTED_NO_RETRY' })); };
      const cleanup = () => transport.signal.removeEventListener('abort', aborted);
      transport.signal.addEventListener('abort', aborted, { once: true });
      if (transport.signal.aborted) return aborted();
      gate.wait.then(() => { cleanup(); resolveWait(); });
    });
    if (ownBehavior === 'fail') throw Object.assign(new Error('CODEX_CONNECTION_FAILED_NO_RETRY'), { code: 'CODEX_CONNECTION_FAILED_NO_RETRY' });
    const proposal = editProposalFor(editing, ownBehavior), checked = await checkPanelEditProposal(editing, proposal);
    await writeNewJson(directory, `edit-${editCalls.length}.context.json`, editing);
    await writeNewJson(directory, `edit-${editCalls.length}.proposal.json`, proposal);
    return { proposal, report: checked, receipt: { codexEditingReceiptVersion: '0.1', status: checked.status,
      model: 'gpt-6-luna', effort: 'xhigh', contextSha256: editing.sha256, proposalSha256: checked.proposalSha256,
      failureCode: null, invocationCount: 1, automaticRetries: 0, elapsedMs: 0, usage: null } };
  };
  server = await createWorkbenchServer({ workbench: resolve(options['--workbench']),
    outputRoot: resolve(directory, 'planner-fixtures'), port: 0, planner, editor });
  const origin = new URL(server.url).origin;
  assert.equal(new URL(server.url).hostname, '127.0.0.1');
  // A refused local proxy keeps outbound HTTP off the network. Loopback fixture
  // requests bypass it and do not enable CDP Fetch interception for response streams.
  browser = await chromium.launch({ headless: true, channel: 'msedge',
    proxy: { server: 'http://127.0.0.1:1', bypass: '127.0.0.1' },
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  report.browser = { channel: 'msedge', version: browser.version(), viewport: { width: 1560, height: 1100 } };
  const snapshot = () => page.evaluate(() => window.panelWorkbench.snapshot());
  const values = () => page.evaluate(() => window.panelWorkbench.getState());
  const idle = () => page.waitForFunction(() => window.panelWorkbench?.snapshot() && !window.panelWorkbench.busy);
  const screenshot = async name => { await page.screenshot({ path: resolve(directory, name), fullPage: true }); report.screenshots.push(name); };
  const healthy = async () => {
    await Promise.all(requestFailureChecks);
    assert.deepEqual(problems, []);
    for (const id of ['request-error', 'proposal-error', 'clarification-error', 'edit-plan-error', 'edit-error', 'preview-error'])
      assert.equal((await page.locator(`#${id}`).textContent()).trim(), '', `${id} must be empty`);
  };
  const open = async (offline = false) => {
    context = await browser.newContext({ viewport: report.browser.viewport, serviceWorkers: 'block', acceptDownloads: true });
    const permitted = url => ['data:', 'blob:'].includes(url.protocol) || (offline && url.protocol === 'file:')
      || (!offline && url.origin === origin && !url.search
        && ['/', '/index.html', '/workbench.js', '/api/panel/capabilities', '/api/panel/plan', '/api/panel/edit'].includes(url.pathname));
    // Routing even a nonmatching URL predicate enables global CDP Fetch
    // interception. Observe the allowlist here; the browser proxy blocks outbound
    // HTTP, and the offline context blocks every HTTP request in file mode.
    if (offline) await context.setOffline(true);
    await context.addInitScript(() => {
      // Observe the caller's own reads; never read, clone, replay or cancel a stream ourselves.
      window.modelTransportSignals = [];
      const original = window.fetch;
      window.fetch = async (...args) => {
        if (!['/api/panel/plan', '/api/panel/edit'].includes(args[0])) return original(...args);
        const requestId = JSON.parse(args[1].body).requestId;
        const signal = args[1].signal;
        const observation = { requestId, operation: args[0].endsWith('/edit') ? 'edit' : 'plan', aborted: signal.aborted };
        window.modelTransportSignals.push(observation);
        signal.addEventListener('abort', () => { observation.aborted = true; }, { once: true });
        try {
          const response = await original(...args); observation.status = response.status;
          observation.contentLength = Number(response.headers.get('content-length'));
          observation.bodyBytes = 0; observation.bodyComplete = false;
          const getReader = response.body.getReader.bind(response.body);
          response.body.getReader = (...readerArgs) => {
            const reader = getReader(...readerArgs), read = reader.read.bind(reader);
            reader.read = async () => {
              try {
                const chunk = await read();
                observation.bodyBytes += chunk.value?.byteLength ?? 0;
                if (chunk.done) observation.bodyComplete = true;
                return chunk;
              } catch (error) { observation.bodyError = error.name; throw error; }
            };
            return reader;
          };
          return response;
        }
        catch (error) { observation.error = error.name; throw error; }
      };
    });
    page = await context.newPage(); page.setDefaultTimeout(30000);
    page.on('request', request => {
      if (!permitted(new URL(request.url()))) problems.push('Unexpected external or unlisted browser request');
      const path = new URL(request.url()).pathname;
      if (path === '/api/panel/capabilities') capabilityRequests++;
      if (path === '/api/panel/plan') planRequests++;
      if (path === '/api/panel/edit') editRequests++;
      if (['/api/panel/plan', '/api/panel/edit'].includes(path)) {
        latestModelRequests.set(path, request);
        requestBindings.set(request, { requestId: request.postDataJSON().requestId, admittedAtStage: stage });
      }
    });
    page.on('pageerror', error => problems.push(`Uncaught browser exception: ${String(error.message).slice(0, 120)}`));
    page.on('console', entry => {
      if (entry.type() !== 'error') return;
      if (faultExpected && /Failed to load resource.*status of (?:4\d\d|5\d\d)/.test(entry.text())) { expectedHttpErrors++; return; }
      problems.push(`Browser console error: ${entry.text().slice(0, 160)}`);
    });
    page.on('requestfailed', request => {
      const path = new URL(request.url()).pathname, expected = expectedCancelledRequests.delete(request);
      const aborted = /ABORTED|CANCELLED/i.test(request.failure()?.errorText ?? '');
      const failure = { operation: path === '/api/panel/plan' ? 'plan' : path === '/api/panel/edit' ? 'edit' : 'other',
        classification: aborted ? 'ABORTED' : 'OTHER', expected, stage, ...requestBindings.get(request), errorText: request.failure()?.errorText };
      requestFailures.push(failure);
      if (expected && aborted) { expectedAborts++; return; }
      const owner = page;
      requestFailureChecks.push((async () => {
        const completed = await owner.evaluate(id => window.modelTransportSignals.find(item => item.requestId === id), failure.requestId).catch(() => null);
        // Edge can emit ERR_ABORTED after the caller received the full body and EOF,
        // notably after an intentional candidate-render rejection. Prove completion
        // byte-for-byte before treating it as a browser notice. Partial bodies,
        // caller aborts, read errors and all other request failures remain fatal.
        if (failure.errorText === 'net::ERR_ABORTED' && completed?.status === 200 && !completed.aborted
          && completed.bodyComplete && !completed.bodyError && completed.contentLength > 0
          && completed.bodyBytes === completed.contentLength) {
          failure.classification = 'COMPLETED_RESPONSE_ABORT_NOTICE'; failure.completion = completed;
          return;
        }
        problems.push(`Unexpected browser request failure (${aborted ? 'ABORTED' : 'OTHER'})`);
      })());
    });
    // Legacy protocol/import/editor coverage deliberately opens the advanced tools.
    await page.goto(`${offline ? pathToFileURL(resolve(options['--workbench'], 'index.html')).href : server.url}#advanced`);
    await idle(); assert.match(await page.title(), /Panel Studio/u);
    assert.equal(await page.getByRole('heading', { name: 'Panel Studio', exact: true }).count(), 1);
    assert.equal(await page.locator('vite-error-overlay').count(), 0); await healthy();
  };
  const click = async selector => {
    if (['#cancel-plan', '#cancel-edit'].includes(selector)) {
      const request = latestModelRequests.get(selector === '#cancel-plan' ? '/api/panel/plan' : '/api/panel/edit');
      assert(request, 'Cancellation must target an observed model request'); expectedCancelledRequests.add(request);
    }
    await page.locator(selector).click(); await idle();
  };
  const mismatchNextResponse = async path => page.evaluate(target => {
    const original = window.fetch;
    window.fetch = async (...args) => {
      const response = await original(...args);
      if (args[0] !== target) return response;
      window.fetch = original;
      const body = await response.json(); body.contextSha256 = '0'.repeat(64);
      // Inject one wrong response binding after the real local response has been
      // fully read. No CDP route proxy, extra HTTP request or UI state mutation.
      return new Response(JSON.stringify(body), { status: response.status, headers: { 'Content-Type': 'application/json' } });
    };
  }, path);
  const preserve = async (before, live) => {
    assert.equal((await snapshot()).panel.sha256, before.panel.sha256);
    assert.deepEqual((await snapshot()).history, before.history); assert.deepEqual(await values(), live);
    assert.equal(await page.locator('#canvas-host canvas').count(), 1);
    assert.equal(await page.locator('#download-panel').isDisabled(), false);
  };
  const errorVisible = async () => {
    const text = (await Promise.all(['request-error', 'proposal-error', 'preview-error', 'edit-plan-error'].map(id => page.locator(`#${id}`).textContent()))).join('').trim();
    assert(text, 'The visible UI must explain the failed request'); return text;
  };

  stage = 'local-model-capability-and-empty-screen'; await open();
  await page.waitForFunction(() => /gpt-6-luna/.test(document.getElementById('model-status').textContent));
  assert.match(await page.locator('#model-status').textContent(), /xhigh/u);
  assert.equal((await snapshot()).panel, null); assert.equal(calls.length, 0); assert.equal(capabilityRequests, 1); pass(stage);

  stage = 'existing-preview-live-state'; await click('#example'); await healthy();
  const original = await snapshot(), spec = original.panel.spec;
  const row = spec.sections.flatMap(section => section.rows).find(row => row.kind === 'switch' && row.enabled);
  assert(row, 'Example fixture needs an enabled switch');
  const control = (await page.evaluate(() => window.panelWorkbench.inspect())).nodes.find(node => node.id === controlId(spec.id, row.id));
  const canvas = page.locator('#canvas-host canvas'); await canvas.scrollIntoViewIfNeeded(); const box = await canvas.boundingBox(); assert(box);
  await page.mouse.click(box.x + (control.bounds.x + control.bounds.width / 2) * box.width / spec.canvas.width,
    box.y + (control.bounds.y + control.bounds.height / 2) * box.height / spec.canvas.height);
  const originalLive = await values(); assert.notEqual(originalLive[row.bind], initialPanelState(spec)[row.bind]); pass(stage, { state: originalLive });

  stage = 'one-click-prepares-latest-request-and-holds-old-preview';
  const requestText = `${seed.example.context.request.text}\n此次由本地生成入口整理方案，保持上述控件定义。`;
  await page.locator('#request-text').fill(requestText);
  behavior = 'hold'; gate = pause();
  const sliderRow = spec.sections.flatMap(section => section.rows).find(item => item.kind === 'slider' && item.enabled);
  const sliderNode = (await page.evaluate(() => window.panelWorkbench.inspect())).nodes.find(item => item.id === controlId(spec.id, sliderRow.id));
  await canvas.scrollIntoViewIfNeeded(); const dragBox = await canvas.boundingBox(); assert(dragBox);
  const dragPoint = fraction => ({ x: dragBox.x + (sliderNode.bounds.x + sliderNode.bounds.width * fraction) * dragBox.width / spec.canvas.width,
    y: dragBox.y + (sliderNode.bounds.y + sliderNode.bounds.height / 2) * dragBox.height / spec.canvas.height });
  const dragStart = dragPoint(.8), dragEnd = dragPoint(.2);
  await page.mouse.move(dragStart.x, dragStart.y); await page.mouse.down(); await page.mouse.move(dragEnd.x, dragEnd.y, { steps: 4 });
  // Keyboard activation while the pointer remains down exercises cancellation of an existing drag.
  await page.locator('#generate-plan').press('Enter');
  await page.waitForFunction(() => window.panelWorkbench.busy && !document.getElementById('cancel-plan').disabled);
  for (let count = 0; calls.length < 1 && count < 200; count++) await new Promise(resolveWait => setTimeout(resolveWait, 20));
  assert.equal(calls.length, 1); assert.equal(calls[0].request.text, requestText);
  assert.notEqual(calls[0].contextSha256, seed.example.context.sha256);
  assert.equal(await page.locator('#request-text').isDisabled(), true);
  assert.equal(await page.locator('#generate-plan').isDisabled(), true);
  await page.mouse.up();
  assert.equal(await page.locator('#canvas-host').evaluate(host => host.inert), true);
  const locked = await page.evaluate(() => window.panelWorkbench.inspect());
  assert(locked.nodes.filter(item => ['Slider', 'Switch', 'Select', 'Button'].includes(item.type)).every(item => item.enabled === false));
  await canvas.scrollIntoViewIfNeeded(); const lockedBox = await canvas.boundingBox(); assert(lockedBox);
  await page.mouse.click(lockedBox.x + (control.bounds.x + control.bounds.width / 2) * lockedBox.width / spec.canvas.width,
    lockedBox.y + (control.bounds.y + control.bounds.height / 2) * lockedBox.height / spec.canvas.height);
  await page.keyboard.press('ArrowRight');
  assert.equal((await snapshot()).panel.sha256, original.panel.sha256); assert.deepEqual(await values(), originalLive);
  pass('busy-preview-cancels-drag-and-blocks-new-input', { retainedState: originalLive });
  await screenshot('planner-pending.png'); gate.release(); await idle(); await healthy();
  assert.equal(await page.locator('#canvas-host').evaluate(host => host.inert), false);
  const generated = await snapshot(); await validatePanelBundle(generated.panel, core);
  assert.equal(generated.panel.spec.title, '自动生成的设置'); assert.equal(generated.panel.spec.provenance.kind, 'agent-authored');
  assert.equal(generated.context.sha256, calls[0].contextSha256); assert.deepEqual(await values(), initialPanelState(generated.panel.spec));
  const evidence = JSON.parse(await page.locator('#evidence-output').textContent());
  assert.equal(evidence.lastCodexCall.model, 'gpt-6-luna'); assert.equal(evidence.lastCodexCall.effort, 'xhigh');
  assert.equal(evidence.lastCodexCall.contextSha256, generated.context.sha256); assert.equal(evidence.lastCodexCall.automaticRetries, 0);
  assert.equal(calls.length, 1); assert.equal(planRequests, 1); assert.equal(await page.locator('#cancel-plan').isVisible(), false);
  await screenshot('planner-ready.png'); pass(stage, { contextSha256: generated.context.sha256, plannerCalls: 1 });

  // Keep a non-default interaction value so every failure detects accidental resets.
  await canvas.scrollIntoViewIfNeeded(); const nextBox = await canvas.boundingBox(); assert(nextBox);
  await page.mouse.click(nextBox.x + (control.bounds.x + control.bounds.width / 2) * nextBox.width / spec.canvas.width,
    nextBox.y + (control.bounds.y + control.bounds.height / 2) * nextBox.height / spec.canvas.height);
  const stable = await snapshot(), live = await values();
  assert.notEqual(live[row.bind], initialPanelState(stable.panel.spec)[row.bind]);
  stage = 'needs-input-retains-panel'; behavior = 'questions'; await click('#generate-plan'); await healthy();
  assert.equal((await snapshot()).phase, 'needs-input'); assert.equal(await page.locator('#questions li').textContent(), '恢复默认应包含哪些设置？');
  await preserve(stable, live); assert.equal(calls.length, 2); pass(stage);

  stage = 'answering-questions-never-submits-a-model-request';
  const beforeAnswer = await snapshot();
  await page.locator('#clarification-answer-0').fill('恢复全部三项设置到面板的创作初值。');
  await click('#clarify'); await healthy(); await preserve(stable, live);
  const afterAnswer = await snapshot();
  assert.equal(afterAnswer.phase, 'awaiting-proposal');
  assert.notEqual(afterAnswer.context.sha256, beforeAnswer.context.sha256);
  assert(afterAnswer.context.request.text.startsWith(beforeAnswer.context.request.text));
  await page.waitForTimeout(150); assert.equal(calls.length, 2); assert.equal(planRequests, 2);
  pass(stage, { newContextSha256: afterAnswer.context.sha256, automaticModelRequests: 0 });

  stage = 'planner-failure-retains-panel-without-retry'; behavior = 'fail'; faultExpected = true;
  await click('#generate-plan'); await errorVisible(); await preserve(stable, live);
  await page.waitForTimeout(150); assert.equal(calls.length, 3); faultExpected = false; pass(stage, { retries: 0 });

  stage = 'mismatched-response-rejected-before-panel-replacement'; behavior = 'ready';
  await mismatchNextResponse('/api/panel/plan');
  await click('#generate-plan'); await errorVisible(); await preserve(stable, live); assert.equal(calls.length, 4); pass(stage);

  stage = 'cancel-aborts-planner-and-keeps-old-preview'; behavior = 'hold'; gate = pause(); faultExpected = true;
  await page.locator('#generate-plan').click();
  for (let count = 0; calls.length < 5 && count < 200; count++) await new Promise(resolveWait => setTimeout(resolveWait, 20));
  assert.equal(calls.length, 5); assert.equal(calls[4].signal.aborted, false);
  await click('#cancel-plan'); await preserve(stable, live);
  for (let count = 0; !calls[4].aborted && count < 200; count++) await new Promise(resolveWait => setTimeout(resolveWait, 20));
  assert.equal(calls[4].aborted, true, 'Browser cancellation must reach the server planner signal');
  gate.release(); await page.waitForTimeout(150); assert.equal(calls.length, 5); faultExpected = false;
  assert.equal(await page.locator('#generate-plan').isDisabled(), false); pass(stage, { plannerAborted: true, retries: 0 });

  stage = 'generated-text-overflow-keeps-old-panel-editable'; behavior = 'overflow'; await click('#generate-plan');
  assert.match(await errorVisible(), /文字超出/u); await preserve(stable, live); assert.equal(calls.length, 6);
  assert.equal(await page.locator('#edit-title').isDisabled(), false); pass(stage);

  stage = 'changed-request-rebuilds-context-on-next-click'; behavior = 'ready';
  const revisedText = `${requestText}\n增加一条新的说明，按原控件继续生成。`;
  await page.locator('#request-text').fill(revisedText); await click('#generate-plan'); await healthy();
  assert.equal(calls.length, 7); assert.equal(calls[6].request.text, revisedText);
  assert.notEqual(calls[6].contextSha256, calls[0].contextSha256);
  assert.equal((await snapshot()).context.sha256, calls[6].contextSha256); assert.equal(planRequests, 7); pass(stage);

  stage = 'edit-preparation-never-submits-model-request';
  await canvas.scrollIntoViewIfNeeded(); const editBox = await canvas.boundingBox(); assert(editBox);
  await page.mouse.click(editBox.x + (control.bounds.x + control.bounds.width / 2) * editBox.width / spec.canvas.width,
    editBox.y + (control.bounds.y + control.bounds.height / 2) * editBox.height / spec.canvas.height);
  const editBase = await snapshot(), editLive = await values();
  const editText = '把标题改成声音设置，主音量创作默认值改成30，再增加默认开启的音效开关；开启表示播放音效，其他设置保持不变。';
  await page.locator('#edit-request-text').fill(editText); await click('#prepare-edit-context'); await healthy();
  assert.equal(editCalls.length, 0); assert.equal(editRequests, 0); assert.equal(calls.length, 7);
  assert.equal(await page.locator('#generate-edit').isDisabled(), false); pass(stage);

  stage = 'edit-call-locks-preview-and-preserves-complete-source'; editBehavior = 'hold'; gate = pause();
  await page.locator('#generate-edit').click();
  await page.waitForFunction(() => window.panelWorkbench.busy && !document.getElementById('cancel-edit').disabled);
  for (let count = 0; editCalls.length < 1 && count < 200; count++) await page.waitForTimeout(20);
  assert.equal(editCalls.length, 1); assert.equal(editCalls[0].request.text, editText);
  assert.equal(editCalls[0].baseSpecSha256, await digestJson(editBase.panel.spec));
  assert.equal(await page.locator('#generate-plan').isDisabled(), true);
  assert.equal(await page.locator('#edit-request-text').isDisabled(), true);
  assert.equal(await page.locator('#cancel-plan').isVisible(), false);
  assert.equal(await page.locator('#canvas-host').evaluate(host => host.inert), true);
  assert.deepEqual(await values(), editLive); assert.equal((await snapshot()).panel.sha256, editBase.panel.sha256);
  pass(stage); gate.release(); await idle(); await healthy();

  stage = 'edit-applies-one-batch-with-stable-ids-live-values-and-new-defaults';
  const editApplied = await snapshot(); await validatePanelBundle(editApplied.panel, core);
  assert.equal(editApplied.panel.spec.id, editBase.panel.spec.id); assert.equal(editApplied.panel.spec.title, '声音设置');
  assert.deepEqual(await values(), { ...editLive, sfxEnabled: true });
  const oldRows = editBase.panel.spec.sections.flatMap(section => section.rows);
  const nextRows = editApplied.panel.spec.sections.flatMap(section => section.rows);
  for (const before of oldRows) assert.deepEqual(nextRows.find(row => row.id === before.id), before);
  const volumeField = editBase.panel.spec.state.find(field => field.type === 'number');
  assert.equal(editApplied.panel.spec.state.find(field => field.id === volumeField.id).initial, 30);
  assert.equal(editApplied.history.length, editBase.history.length + 1);
  assert.equal(editApplied.history.at(-1).editEvidence.context.sha256, editCalls[0].contextSha256);
  const editEvidence = JSON.parse(await page.locator('#evidence-output').textContent()).lastCodexEditCall;
  assert.equal(editEvidence.codexEditingReceiptVersion, '0.1'); assert.equal(editEvidence.status, 'READY_TO_APPLY');
  assert.equal(editEvidence.automaticRetries, 0); assert.equal(editCalls.length, 1); assert.equal(editRequests, 1);
  await screenshot('editor-ready.png'); pass(stage);

  stage = 'edited-panel-export-revalidates-live-values-and-authoring-defaults';
  const downloadPending = page.waitForEvent('download'); await page.locator('#download-panel').click();
  const downloaded = await downloadPending; assert.equal(await downloaded.failure(), null);
  await downloaded.saveAs(resolve(directory, 'edited.panel.bundle.json')); await idle();
  const exported = await validatePanelBundle(await readJson(resolve(directory, 'edited.panel.bundle.json')), core);
  assert.equal(exported.spec.id, editBase.panel.spec.id); assert.deepEqual(exported.state, { ...editLive, sfxEnabled: true });
  assert.equal(exported.spec.state.find(field => field.id === volumeField.id).initial, 30); pass(stage);

  stage = 'edit-undo-restores-whole-source-and-pre-edit-live-values'; await click('#undo'); await healthy();
  const undoBase = await snapshot(); await validatePanelBundle(undoBase.panel, core);
  assert.deepEqual(undoBase.panel.spec, editBase.panel.spec); assert.deepEqual(undoBase.history, editBase.history);
  assert.deepEqual(undoBase.panel.state, editLive); assert.deepEqual(await values(), editLive); pass(stage);

  stage = 'partial-edit-with-questions-never-applies-any-operation'; editBehavior = 'questions';
  await click('#generate-edit'); await healthy(); await preserve(undoBase, editLive);
  const questions = await page.evaluate(() => window.panelWorkbench.editSnapshot());
  assert.equal(questions.report.status, 'NEEDS_INPUT'); assert(questions.proposal.patch.operations.length > 0);
  assert.match(await page.locator('#edit-questions').textContent(), /开启时代表/u); assert.equal(editCalls.length, 2); pass(stage);

  stage = 'revised-edit-description-prepares-new-context-without-inference';
  await page.locator('#edit-request-text').fill(`${editText} 明确说明：开关为true时播放音效。`);
  await click('#prepare-edit-context'); await healthy(); await preserve(undoBase, editLive);
  const revisedEdit = await page.evaluate(() => window.panelWorkbench.editSnapshot());
  assert.notEqual(revisedEdit.context.sha256, questions.context.sha256); assert.equal(revisedEdit.proposal, null);
  assert.equal(editCalls.length, 2); assert.equal(editRequests, 2); pass(stage);

  stage = 'edit-transport-failure-retains-history-and-state-without-retry'; editBehavior = 'fail'; faultExpected = true;
  await click('#generate-edit'); assert.match(await errorVisible(), /连接中断/u); await preserve(undoBase, editLive);
  await page.waitForTimeout(150); assert.equal(editCalls.length, 3); faultExpected = false; pass(stage);

  stage = 'mismatched-edit-response-is-rejected'; editBehavior = 'ready';
  await mismatchNextResponse('/api/panel/edit');
  await click('#generate-edit'); await errorVisible(); await preserve(undoBase, editLive); assert.equal(editCalls.length, 4); pass(stage);

  stage = 'edit-rendering-overflow-retains-old-preview-and-history'; editBehavior = 'overflow';
  await click('#generate-edit'); assert.match(await errorVisible(), /文字超出/u); await preserve(undoBase, editLive);
  assert.equal(editCalls.length, 5); pass(stage);

  stage = 'edit-cancellation-reaches-server-and-keeps-existing-panel'; editBehavior = 'hold'; gate = pause(); faultExpected = true;
  await page.locator('#generate-edit').click();
  for (let count = 0; editCalls.length < 6 && count < 200; count++) await page.waitForTimeout(20);
  assert.equal(editCalls.length, 6); await click('#cancel-edit'); await preserve(undoBase, editLive);
  for (let count = 0; !editCalls[5].aborted && count < 200; count++) await page.waitForTimeout(20);
  assert.equal(editCalls[5].aborted, true); gate.release(); await page.waitForTimeout(150);
  assert.equal(editCalls.length, 6); faultExpected = false; assert.equal(await page.locator('#generate-edit').isDisabled(), false); pass(stage);

  stage = 'planning-validation-diagnostic-shows-specific-cause-and-field'; behavior = 'validation-fail'; faultExpected = true;
  await click('#generate-plan'); await preserve(undoBase, editLive);
  const planDiagnosticText = await errorVisible();
  assert.match(planDiagnosticText, /缺少部分控件或状态的需求依据/u); assert.match(planDiagnosticText, /\$\.decisions/u);
  assert.equal(planDiagnosticText.includes('SECRET_PRIVATE_MESSAGE'), false); assert.equal(calls.length, 8); pass(stage);

  stage = 'editing-validation-diagnostic-shows-specific-cause-and-field'; editBehavior = 'validation-fail';
  await click('#generate-edit'); await preserve(undoBase, editLive);
  const editDiagnosticText = await errorVisible();
  assert.match(editDiagnosticText, /旧版面板/u); assert.match(editDiagnosticText, /\$\.patch\.baseSpecSha256/u);
  assert.equal(editDiagnosticText.includes('SECRET_PRIVATE_MESSAGE'), false); assert.equal(editCalls.length, 7);
  await page.waitForTimeout(150); assert.equal(calls.length, 8); assert.equal(editCalls.length, 7); faultExpected = false;
  await screenshot('validation-diagnostic.png'); pass(stage);

  for (const [mode, message, path] of [['target-duplicate', /同一个目标填写了多条/u, /\$\.decisions\[10\]\.target/u],
    ['target-unmatched', /不存在或协议不支持的目标/u, /\$\.decisions\[10\]\.target/u],
    ['draft-count', /依据数量与控件或状态不一致/u, /\$\.bases\.state/u]]) {
    stage = `planning-${mode}-is-visible-and-keeps-old-panel`; behavior = mode; faultExpected = true;
    const count = calls.length; await click('#generate-plan'); await preserve(undoBase, editLive);
    const messageText = await errorVisible(); assert.match(messageText, message); assert.match(messageText, path);
    assert.equal(messageText.includes('SECRET_PRIVATE_MESSAGE'), false);
    await page.waitForTimeout(150); assert.equal(calls.length, count + 1); pass(stage);
  }
  faultExpected = false; await screenshot('target-diagnostic.png');

  for (const [mode, message] of [['output-json', /返回内容不是有效 JSON/u],
    ['output-wrapper', /传输格式不符合协议/u], ['output-proposal-json', /方案字符串中的 JSON 格式不合法/u]]) {
    stage = `editing-${mode}-is-visible-and-keeps-old-panel`; editBehavior = mode; faultExpected = true;
    const count = editCalls.length; await click('#generate-edit'); await preserve(undoBase, editLive);
    const messageText = await errorVisible(); assert.match(messageText, message);
    assert.equal(messageText.includes('SECRET_PRIVATE_MESSAGE'), false); assert.match(messageText, /未自动重试/u);
    await page.waitForTimeout(150); assert.equal(editCalls.length, count + 1); pass(stage);
  }
  faultExpected = false; await screenshot('edit-output-diagnostic.png');

  stage = 'mobile-layout-retains-generation-control'; await page.setViewportSize({ width: 375, height: 900 });
  const widths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth,
    body: document.body.scrollWidth, root: document.documentElement.scrollWidth }));
  assert(widths.body <= widths.viewport + 1 && widths.root <= widths.viewport + 1);
  assert.equal(await page.locator('#generate-plan').isVisible(), true);
  assert.equal(await page.locator('#generate-edit').isVisible(), true); await screenshot('planner-mobile.png'); pass(stage, widths);

  stage = 'file-offline-manual-fallback-never-fetches-model';
  const beforeOffline = { calls: calls.length, editCalls: editCalls.length, planRequests, editRequests, capabilityRequests };
  transportObservations.push(...await page.evaluate(() => window.modelTransportSignals ?? []));
  await context.close(); await open(true);
  assert.match(await page.locator('#model-status').textContent(), /离线|手动/u);
  assert(!await page.locator('#generate-plan').isVisible() || await page.locator('#generate-plan').isDisabled());
  await click('#example'); await healthy(); assert.equal((await snapshot()).panel.sha256, manifest.example.panelSha256);
  assert.equal(await page.locator('#generate-edit').isDisabled(), true);
  await page.locator('#edit-request-text').fill('把标题改成声音设置，其他设置保持不变。'); await click('#prepare-edit-context');
  const offlineEdit = await page.evaluate(() => window.panelWorkbench.editSnapshot());
  const offlineProposal = editProposalFor(offlineEdit.context, 'title-only');
  await writeNewJson(directory, 'offline-edit.proposal.json', offlineProposal);
  await page.locator('#edit-proposal-file').setInputFiles(resolve(directory, 'offline-edit.proposal.json')); await idle(); await healthy();
  assert.equal((await snapshot()).panel.spec.title, '声音设置'); await click('#undo'); await healthy();
  assert.deepEqual({ calls: calls.length, editCalls: editCalls.length, planRequests, editRequests, capabilityRequests }, beforeOffline);
  await screenshot('planner-offline.png'); pass(stage, { protocol: 'file', network: 'OFFLINE', modelRequests: 0 });

  assert.deepEqual(problems, []); report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.failure = { stage, code: error.code ?? error.name ?? 'ACCEPTANCE_FAILED', message: String(error.message).slice(0, 1600) };
  if (page) try { await page.screenshot({ path: resolve(directory, 'failure.png'), fullPage: true }); report.screenshots.push('failure.png'); } catch {}
  process.exitCode = 1;
} finally {
  gate?.release();
  report.browserProblems = problems; report.expectedFaults = { abortedRequests: expectedAborts, httpErrors: expectedHttpErrors };
  report.browserRequestFailures = requestFailures;
  report.plannerTestDoubleCalls = calls.map(call => ({ contextSha256: call.contextSha256, requestId: call.request.id,
    behavior: call.behavior, aborted: call.aborted }));
  report.editorTestDoubleCalls = editCalls.map(call => ({ contextSha256: call.contextSha256, baseSpecSha256: call.baseSpecSha256,
    requestId: call.request.id, behavior: call.behavior, aborted: call.aborted }));
  report.requests = { capabilities: capabilityRequests, plans: planRequests, edits: editRequests };
  if (page) try { transportObservations.push(...await page.evaluate(() => window.modelTransportSignals ?? [])); } catch {}
  report.transportSignals = transportObservations;
  await context?.close().catch(() => {}); await browser?.close().catch(() => {}); await server?.close().catch(() => {});
  await writeNewJson(directory, 'codex-workbench-browser-report.json', report);
  process.stdout.write(`${JSON.stringify({ status: report.status, checks: report.checks.length,
    plannerTestDoubleCalls: calls.length, editorTestDoubleCalls: editCalls.length, providerCalls: 0, failedStage: report.failure?.stage ?? null })}\n`);
}
