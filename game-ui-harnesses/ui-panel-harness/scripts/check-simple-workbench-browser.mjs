#!/usr/bin/env node
/** Default Studio journeys through the visible UI. Only injected fixture adapters run. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '../../ui-component-harness/node_modules/@playwright/test/index.mjs';
import { createOutputDirectory, readJson, writeNewJson } from '../src/io.mjs';
import { digestBytes } from '../src/canonical.mjs';
import { createWorkbenchServer } from '../src/workbench-server.mjs';
import { checkPanelProposal, proposalTargets } from '../src/proposal.mjs';
import { checkPanelEditProposal } from '../src/edit-planning.mjs';
import { validatePanelBundle } from '../src/panel-bundle.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { controlId } from '../src/compiler.mjs';

const options = {}, args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  assert(['--workbench', '--output'].includes(args[i]) && args[i + 1] && !options[args[i]]);
  options[args[i]] = args[i + 1];
}
assert.equal(Object.keys(options).length, 2, 'Required: --workbench <build> --output <fresh directory>');
const output = await createOutputDirectory(options['--output']);
const report = { version: '0.1', status: 'RUNNING', checks: [], screenshots: [], providerCalls: 0,
  scope: 'Default two-input Studio, real loopback transport and Pixi; injected fixtures, no model process',
  humanVisualReview: 'NOT_RUN', nativeEngines: 'NOT_RUN' };
const pass = name => report.checks.push({ name, status: 'PASS' });
const calls = [], problems = [], requests = { plan: 0, edit: 0 };
let browser, context, page, server, gate, mode = 'ready', expectedFault = false, stage = 'verify-build';
const hold = () => { let release; const wait = new Promise(done => { release = done; }); return { wait, release }; };
const basis = request => ({ kind: 'request-interpretation', start: 0, end: request.text.length, quote: request.text });
try {
  const core = await loadWorkspaceCore();
  const manifest = await readJson(resolve(options['--workbench'], 'workbench-build.json'));
  assert.equal(manifest.status, 'COMPLETE');
  for (const file of manifest.files) {
    const bytes = await readFile(resolve(options['--workbench'], file.path));
    assert.equal(await digestBytes(bytes), file.sha256); assert.equal(bytes.length, file.bytes);
  }
  report.build = manifest; pass(stage);
  // A small independent settings fixture avoids hiding the new default workflow behind a large demo.
  const fixture = await readJson(new URL('../examples/settings-controls.panel.json', import.meta.url));
  fixture.state.find(field => field.id === 'volume').initial = 70;
  fixture.state.find(field => field.id === 'muted').initial = false;
  Object.assign(fixture.state.find(field => field.id === 'quality'), { initial: 'balanced',
    options: [{ id: 'smooth', label: '流畅' }, { id: 'balanced', label: '均衡' }, { id: 'fine', label: '精致' }] });
  fixture.provenance = { kind: 'agent-authored', description: 'Explicit UI regression fixture; not a model result.', assumptions: [] };
  const pauseAdapter = async signal => {
    if (mode !== 'hold') return;
    await new Promise((done, reject) => {
      const abort = () => { cleanup(); reject(Object.assign(new Error('CODEX_PLANNER_ABORTED'), { code: 'CODEX_PLANNER_ABORTED' })); };
      const cleanup = () => signal.removeEventListener('abort', abort);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) return abort();
      gate.wait.then(() => { cleanup(); done(); });
    });
  };
  const invoke = operation => async (input, transport) => {
    const ownMode = mode;
    calls.push({ operation, mode: ownMode, contextSha256: input.sha256, request: input.request });
    await pauseAdapter(transport.signal);
    if (ownMode === 'fail') throw Object.assign(new Error('CODEX_CONNECTION_FAILED_NO_RETRY'), { code: 'CODEX_CONNECTION_FAILED_NO_RETRY' });
    let proposal, checked;
    if (operation === 'plan') {
      const spec = structuredClone(fixture);
      spec.id = input.request.id;
      proposal = { proposalVersion: input.planningContextVersion, contextSha256: input.sha256,
        spec: ownMode === 'questions' ? null : spec,
        decisions: ownMode === 'questions' ? [] : proposalTargets(spec, input.planningContextVersion).map(target => ({ target, basis: basis(input.request) })),
        unresolved: ownMode === 'questions' ? [{ id: 'reset-scope', question: '恢复默认应包含哪些设置？' }] : [] };
      checked = await checkPanelProposal(input, proposal);
    } else {
      let operations = [{ op: 'set-panel-title', title: '声音设置' }, { op: 'set-state-initial', fieldId: 'volume', value: 50 },
        { op: 'add-row', sectionId: 'preferences', afterRowId: 'mute-row',
          row: { ...fixture.sections[0].rows.find(row => row.kind === 'switch'), id: 'sfx-row', label: '音效开关',
            bind: 'sfxEnabled', event: 'sfx.changed' }, state: { id: 'sfxEnabled', type: 'boolean', initial: true } }];
      if (['button-reset', 'button-disabled'].includes(ownMode)) {
        const reset = input.spec.sections.flatMap(section => section.rows).find(row => row.kind === 'button' && row.action.kind === 'reset-initial');
        operations = [{ op: 'set-button-label', rowId: reset.id, buttonLabel: ownMode === 'button-reset' ? '恢复声音' : '暂不可恢复' }];
        if (ownMode === 'button-disabled') operations.push({ op: 'set-row-enabled', rowId: reset.id, enabled: false });
        else operations.push(
          { op: 'add-row', sectionId: input.spec.sections[0].id, afterRowId: 'sfx-row',
            row: { ...input.spec.sections[0].rows.find(row => row.kind === 'slider'), id: 'ui-volume-row', label: '界面音量', bind: 'uiVolume', event: 'ui.volumeChanged' },
            state: { id: 'uiVolume', type: 'number', initial: 30, min: 0, max: 100, step: 1 } },
          { op: 'set-button-action', rowId: reset.id, action: { kind: 'reset-initial', fields: [...reset.action.fields, 'uiVolume'] } });
      }
      proposal = { editProposalVersion: '0.1', contextSha256: input.sha256,
        patch: { patchVersion: '0.1', baseSpecSha256: input.baseSpecSha256, reason: 'Explicit UI fixture edit.', operations },
        decisions: operations.map((_item, operationIndex) => ({ operationIndex, basis: basis(input.request) })),
        unresolved: ownMode === 'questions' ? [{ id: 'sfx-default', question: '音效开关的默认值是什么？' }] : [] };
      checked = await checkPanelEditProposal(input, proposal);
    }
    return { proposal, report: checked, receipt: {
      [operation === 'plan' ? 'codexPlanningReceiptVersion' : 'codexEditingReceiptVersion']: '0.1',
      status: checked.status, model: 'gpt-6-luna', effort: 'xhigh', contextSha256: input.sha256,
      proposalSha256: checked.proposalSha256, failureCode: null, invocationCount: 1, automaticRetries: 0, elapsedMs: 0, usage: null } };
  };
  server = await createWorkbenchServer({ workbench: resolve(options['--workbench']), outputRoot: resolve(output, 'fixtures'),
    port: 0, planner: invoke('plan'), editor: invoke('edit') });
  const origin = new URL(server.url).origin;
  browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  report.browser = { channel: 'msedge', version: browser.version() };
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', acceptDownloads: true });
  await context.route(url => !['data:', 'blob:', 'file:'].includes(url.protocol) && url.origin !== origin, route => {
    problems.push('Unexpected external request'); return route.abort();
  });
  page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => problems.push(error.message.slice(0, 160)));
  page.on('console', entry => {
    if (entry.type() === 'error' && !(expectedFault && /Failed to load resource/.test(entry.text()))) problems.push(entry.text().slice(0, 160));
  });
  page.on('request', request => { for (const operation of ['plan', 'edit']) if (new URL(request.url()).pathname === `/api/panel/${operation}`) requests[operation]++; });
  const idle = () => page.waitForFunction(() => window.panelWorkbench?.snapshot() && !window.panelWorkbench.busy);
  const snapshot = () => page.evaluate(() => window.panelWorkbench.snapshot());
  const values = () => page.evaluate(() => window.panelWorkbench.getState());
  const click = async id => { await page.locator(`#${id}`).click(); await idle(); };
  const menu = async () => { if (!await page.locator('#panel-menu').evaluate(node => node.open)) await page.locator('#panel-menu > summary').click(); };
  const screenshot = async name => { await page.screenshot({ path: resolve(output, name), fullPage: true }); report.screenshots.push(name); };
  const preserve = async (before, state) => {
    assert.equal((await snapshot()).panel.sha256, before.panel.sha256);
    assert.deepEqual((await snapshot()).history, before.history); assert.deepEqual(await values(), state);
    assert.equal(await page.locator('#canvas-host canvas').count(), 1);
  };
  const noErrors = async () => {
    assert.deepEqual(problems, []);
    for (const id of ['request-error', 'proposal-error', 'clarification-error', 'edit-plan-error', 'edit-error', 'preview-error'])
      assert.equal((await page.locator(`#${id}`).textContent()).trim(), '', id);
  };
  const admitted = async count => {
    for (let attempt = 0; calls.length < count && attempt < 200; attempt++) await new Promise(done => setTimeout(done, 20));
    assert.equal(calls.length, count, 'Exactly one fixture adapter invocation was admitted');
  };
  stage = 'default-only-two-inputs-two-actions-and-preview';
  await page.goto(server.url); await idle();
  await page.waitForFunction(() => document.getElementById('model-status').textContent.includes('gpt-6-luna'));
  assert.equal(await page.locator('textarea:visible').count(), 2);
  assert.deepEqual(await page.locator('button:visible').allTextContents(), ['生成面板', '修改面板']);
  for (const id of ['advanced-area', 'library-badge', 'prepare', 'proposal-json', 'editor-form', 'live-state', 'evidence-output', 'download-panel'])
    assert.equal(await page.locator(`#${id}`).isVisible(), false, id);
  assert.equal(await page.locator('#generate-plan').isDisabled(), true);
  assert.equal(await page.locator('#edit-request-text').isDisabled(), true);
  await screenshot('empty-desktop.png'); pass(stage);

  stage = 'labels-focus-and-menu-keyboard-dismissal';
  await page.getByText('需求描述', { exact: true }).click(); assert.equal(await page.locator('#request-text').evaluate(node => node === document.activeElement), true);
  await page.locator('#request-text').fill('生成设置面板：音量 0～100，步长 1，默认 70；静音默认关闭；画质流畅、均衡、精致，默认均衡；恢复默认重置这些设置。');
  await page.keyboard.press('Tab'); assert.equal(await page.locator('#generate-plan').evaluate(node => node === document.activeElement), true);
  await menu(); assert.equal(await page.locator('#download-panel').isVisible(), true);
  await page.locator('#panel-menu > summary').press('Escape'); assert.equal(await page.locator('#panel-menu').evaluate(node => node.open), false);
  assert.equal(await page.locator('#panel-menu > summary').evaluate(node => node === document.activeElement), true);
  await menu(); await page.locator('#request-text').click(); assert.equal(await page.locator('#panel-menu').evaluate(node => node.open), false); pass(stage);

  stage = 'generation-loading-locks-and-renders-without-manual-planning';
  gate = hold(); mode = 'hold'; await page.locator('#generate-plan').click();
  await page.waitForFunction(() => window.panelWorkbench.busy && !document.getElementById('cancel-plan').disabled);
  assert.equal(await page.locator('#request-text').isDisabled(), true);
  assert.match(await page.locator('#generate-plan').textContent(), /生成中/u);
  assert.match(await page.locator('#status').textContent(), /生成/u);
  await admitted(1);
  gate.release(); await idle(); mode = 'ready'; await noErrors();
  const generated = await snapshot(); await validatePanelBundle(generated.panel, core);
  assert.equal(generated.phase, 'ready'); assert.equal(calls.length, 1); assert.equal(requests.plan, 1);
  assert.match(generated.panel.spec.id, /^panel-[a-f0-9]{32}$/); assert.equal(generated.panel.spec.id, calls[0].request.id);
  assert.equal(await page.locator('#generate-edit').isDisabled(), true); // empty modification text
  assert.equal(await page.locator('#edit-request-text').isDisabled(), false);
  assert.equal(await page.locator('#cancel-plan').isVisible(), false); pass(stage);

  stage = 'preview-interaction-records-real-play-values';
  const spec = generated.panel.spec, toggle = spec.sections[0].rows.find(row => row.kind === 'switch');
  const node = (await page.evaluate(() => window.panelWorkbench.inspect())).nodes.find(item => item.id === controlId(spec.id, toggle.id));
  const canvas = page.locator('#canvas-host canvas'); await canvas.scrollIntoViewIfNeeded(); const box = await canvas.boundingBox();
  await page.mouse.click(box.x + (node.bounds.x + node.bounds.width / 2) * box.width / spec.canvas.width,
    box.y + (node.bounds.y + node.bounds.height / 2) * box.height / spec.canvas.height);
  const live = await values(); assert.equal(live[toggle.bind], !generated.panel.state[toggle.bind]); pass(stage);

  stage = 'one-click-modification-preserves-play-values-and-adds-control';
  const editText = '标题改为声音设置；音量默认值改为 50；在静音后新增音效开关，默认开启；保留其余设置和恢复默认的原有范围。';
  await page.locator('#edit-request-text').fill(editText); gate = hold(); mode = 'hold';
  await page.locator('#generate-edit').click(); await page.waitForFunction(() => window.panelWorkbench.busy && !document.getElementById('cancel-edit').disabled);
  assert.match(await page.locator('#generate-edit').textContent(), /修改中/u);
  assert.equal(await page.locator('#canvas-host').evaluate(host => host.inert), true);
  assert.equal((await snapshot()).panel.sha256, generated.panel.sha256);
  gate.release(); await idle(); mode = 'ready'; await noErrors();
  const edited = await snapshot(); assert.equal(edited.panel.spec.title, '声音设置');
  assert.equal(edited.panel.spec.id, generated.panel.spec.id);
  assert.equal(edited.panel.spec.state.find(field => field.id === 'volume').initial, 50);
  assert.deepEqual(await values(), { ...live, sfxEnabled: true }); assert.equal(edited.history.length, 1);
  assert.equal(calls.filter(call => call.operation === 'edit').length, 1); assert.equal(requests.edit, 1);
  assert.match(await page.locator('#edit-plan-status').textContent(), /修改已应用.*试玩值.*恢复默认/u);
  assert.equal(await page.locator('#edit-request-text').inputValue(), editText);
  assert((await page.evaluate(() => window.panelWorkbench.inspect())).nodes.some(item => item.id === controlId(spec.id, 'sfx-row')));
  await screenshot('modified-desktop.png'); pass(stage);

  stage = 'panel-menu-export-import-and-undo-remain-portable';
  await menu(); const pending = page.waitForEvent('download'); await click('download-panel');
  const downloaded = await pending; assert.equal(await downloaded.failure(), null);
  await downloaded.saveAs(resolve(output, 'edited.panel.bundle.json'));
  const saved = await validatePanelBundle(await readJson(resolve(output, 'edited.panel.bundle.json')), core);
  assert.deepEqual(saved.state, { ...live, sfxEnabled: true }); assert.deepEqual(saved.spec, edited.panel.spec);
  await menu(); await click('undo');
  const undone = await snapshot(); await validatePanelBundle(undone.panel, core);
  assert.deepEqual(undone.panel.spec, generated.panel.spec); assert.deepEqual(undone.history, generated.history);
  assert.deepEqual(undone.panel.state, live); assert.deepEqual(await values(), live);
  assert.equal(await page.locator('#request-text').inputValue(), calls[0].request.text);
  await menu(); await page.locator('#panel-file').setInputFiles(resolve(output, 'edited.panel.bundle.json')); await idle();
  assert.deepEqual((await snapshot()).panel.spec, saved.spec); assert.deepEqual(await values(), saved.state);
  assert.equal(await page.locator('#panel-menu').evaluate(node => node.open), false); await noErrors(); pass(stage);

  stage = 'button-text-and-new-reset-field-apply-together';
  const buttonBase = await snapshot(), buttonTrial = await values();
  const resetRow = saved.spec.sections.flatMap(section => section.rows).find(row => row.kind === 'button' && row.action.kind === 'reset-initial');
  mode = 'button-reset';
  await page.locator('#edit-request-text').fill('恢复按钮文字改成恢复声音，在音效开关后添加界面音量，0到100步进1默认30，恢复声音同时重置新滑条，其余不变。');
  await click('generate-edit'); await noErrors();
  const withReset = await snapshot(), resetSpec = withReset.panel.spec;
  assert.deepEqual(await values(), { ...buttonTrial, uiVolume: 30 });
  assert.equal(resetSpec.sections.flatMap(section => section.rows).find(row => row.id === resetRow.id).buttonLabel, '恢复声音');
  assert.deepEqual(withReset.history.at(-1).receipt.changedRowIds, [resetRow.id, 'ui-volume-row'].sort());
  assert.deepEqual(resetSpec.sections.flatMap(section => section.rows).find(row => row.id === resetRow.id).action.fields, [...resetRow.action.fields, 'uiVolume']);
  await screenshot('button-reset-applied.png'); pass(stage);

  stage = 'new-slider-real-reset-keeps-outside-field';
  const focusRow = async (currentSpec, rowId) => {
    await canvas.scrollIntoViewIfNeeded(); await canvas.focus();
    for (let i = 0; i < currentSpec.sections.flatMap(section => section.rows).length + 5; i++) {
      // Tab legitimately leaves the canvas after its last control. Re-enter it
      // before continuing the bounded search from the first eligible control.
      if (!await canvas.evaluate(element => element === document.activeElement)) await canvas.focus();
      if (await canvas.getAttribute('data-focused-component') === controlId(currentSpec.id, rowId)) return;
      await page.keyboard.press('Tab');
    }
    throw new Error(`FOCUS_UNREACHABLE:${rowId}:${await canvas.getAttribute('data-focused-component')}`);
  };
  await focusRow(resetSpec, 'ui-volume-row'); await page.keyboard.press('End'); assert.equal((await values()).uiVolume, 100);
  await focusRow(resetSpec, 'sfx-row'); await page.keyboard.press('Space'); assert.equal((await values()).sfxEnabled, false);
  await focusRow(resetSpec, resetRow.id); await page.keyboard.press('Enter');
  const resetValues = { ...buttonTrial, uiVolume: 30, sfxEnabled: false };
  for (const id of resetRow.action.fields) resetValues[id] = resetSpec.state.find(field => field.id === id).initial;
  assert.deepEqual(await values(), resetValues); assert.equal(resetValues.volume, 50);
  await screenshot('button-reset-interacted.png'); pass(stage);

  stage = 'button-edit-export-and-whole-batch-undo';
  await menu(); const resetDownload = page.waitForEvent('download'); await click('download-panel');
  await (await resetDownload).saveAs(resolve(output, 'button-reset.panel.bundle.json'));
  const resetBundle = await validatePanelBundle(await readJson(resolve(output, 'button-reset.panel.bundle.json')), core);
  assert.deepEqual(resetBundle.spec, resetSpec); assert.deepEqual(resetBundle.state, resetValues);
  await menu(); await click('undo'); await noErrors();
  assert.deepEqual((await snapshot()).panel.spec, buttonBase.panel.spec); assert.deepEqual(await values(), buttonTrial); pass(stage);

  stage = 'renamed-disabled-button-real-click-does-not-emit-and-undo-restores-it';
  mode = 'button-disabled'; await page.locator('#edit-request-text').fill('恢复按钮文字改成暂不可恢复并禁用，其他保持不变。');
  await click('generate-edit'); await noErrors();
  const disabledNode = (await page.evaluate(() => window.panelWorkbench.inspect())).nodes.find(item => item.id === controlId(saved.spec.id, resetRow.id));
  assert(disabledNode.visible); assert.equal(disabledNode.enabled, false);
  assert(JSON.stringify(disabledNode.renderedTextBounds).includes('暂不可恢复'));
  const eventCount = (await page.evaluate(() => window.panelWorkbench.events())).length;
  await canvas.scrollIntoViewIfNeeded(); const disabledBox = await canvas.boundingBox();
  await page.mouse.click(disabledBox.x + (disabledNode.bounds.x + disabledNode.bounds.width / 2) * disabledBox.width / saved.spec.canvas.width,
    disabledBox.y + (disabledNode.bounds.y + disabledNode.bounds.height / 2) * disabledBox.height / saved.spec.canvas.height);
  assert.deepEqual(await values(), buttonTrial); assert.equal((await page.evaluate(() => window.panelWorkbench.events())).length, eventCount);
  await screenshot('button-renamed-disabled.png'); await menu(); await click('undo'); await noErrors();
  assert.deepEqual((await snapshot()).panel.spec, buttonBase.panel.spec); assert.deepEqual(await values(), buttonTrial); pass(stage);

  stage = 'failed-generation-keeps-input-and-existing-panel-no-retry';
  let before = await snapshot(), state = await values(), count = calls.length;
  expectedFault = true; mode = 'fail'; await click('generate-plan');
  assert.match(await page.locator('#request-error').textContent(), /连接中断/u);
  assert.equal(await page.locator('#request-error').isVisible(), true); await preserve(before, state);
  assert.equal(calls.length, count + 1); assert.equal(await page.locator('#request-text').inputValue(), calls[0].request.text); pass(stage);

  stage = 'clarification-appears-only-when-needed-and-answer-never-auto-calls';
  expectedFault = false; mode = 'questions'; await click('generate-plan'); await noErrors(); await preserve(before, state);
  const clarificationId = (await snapshot()).context.request.id;
  assert.equal(await page.locator('#clarification-form').isVisible(), true);
  await page.locator('#clarification-answer-0').fill('重置音量、静音和画质，不重置音效开关。'); count = calls.length;
  await click('clarify'); assert.equal(calls.length, count); assert.equal(await page.locator('#clarification-form').isVisible(), false);
  assert.equal((await snapshot()).context.request.id, clarificationId);
  assert.match(await page.locator('#status').textContent(), /回答已补充.*生成面板/u);
  assert.match(await page.locator('#request-text').inputValue(), /不重置音效开关/u);
  mode = 'ready'; await click('generate-plan'); await noErrors(); assert.equal(calls.length, count + 1);
  assert.equal((await snapshot()).panel.spec.id, clarificationId); pass(stage);

  stage = 'modification-questions-stay-next-to-description';
  before = await snapshot(); state = await values(); mode = 'questions'; await page.locator('#edit-request-text').fill(editText);
  await click('generate-edit'); await preserve(before, state);
  assert.equal(await page.locator('#edit-questions').isVisible(), true);
  assert.match(await page.locator('#edit-plan-status').textContent(), /补充.*修改面板/u);
  count = calls.length; await page.locator('#edit-request-text').fill(`${editText}音效默认 true。`);
  assert.equal(await page.locator('#edit-questions').isVisible(), false); assert.equal(calls.length, count); pass(stage);

  for (const operation of ['plan', 'edit']) {
    stage = `cancel-${operation}-retains-panel-and-restores-actions`;
    gate = hold(); mode = 'hold'; count = calls.length;
    await page.locator(`#generate-${operation}`).click();
    await page.waitForFunction(kind => window.panelWorkbench.busy && !document.getElementById(`cancel-${kind}`).disabled, operation);
    await admitted(count + 1);
    await click(`cancel-${operation}`); gate.release(); await preserve(before, state);
    assert.match(await page.locator(operation === 'plan' ? '#request-error' : '#edit-plan-error').textContent(), /已取消/u);
    assert.equal(await page.locator(`#cancel-${operation}`).isVisible(), false);
    assert.equal(await page.locator(`#generate-${operation}`).isDisabled(), false);
    assert.equal(calls.length, count + 1); pass(stage);
  }

  stage = 'advanced-tools-toggle-does-not-replace-working-panel';
  count = calls.length; await menu(); await click('advanced-tools'); await page.waitForFunction(() => document.body.classList.contains('advanced-mode'));
  assert.equal(await page.locator('#advanced-area').isVisible(), true); await preserve(before, state);
  await click('advanced-tools'); await page.waitForFunction(() => !document.body.classList.contains('advanced-mode'));
  assert.equal(await page.locator('#advanced-area').isVisible(), false); assert.equal(calls.length, count); await preserve(before, state); pass(stage);

  stage = 'different-simple-requirements-get-independent-ids';
  mode = 'ready'; const oldId = (await snapshot()).panel.spec.id;
  await page.locator('#request-text').fill('生成另一份设置面板，原有控件和初值都相同。');
  await click('generate-plan'); await noErrors(); const nextId = (await snapshot()).panel.spec.id;
  assert.match(nextId, /^panel-[a-f0-9]{32}$/); assert.notEqual(nextId, oldId);
  assert.equal(nextId, calls.at(-1).request.id);
  await menu(); await click('advanced-tools'); await page.waitForFunction(() => document.body.classList.contains('advanced-mode'));
  count = calls.length; await click('prepare'); assert.equal((await snapshot()).context.request.id, nextId); assert.equal(calls.length, count); pass(stage);

  stage = 'explicit-advanced-name-is-preserved';
  await page.getByText('需求标识与资源风格', { exact: true }).click();
  await page.locator('#request-id').fill('explicit-settings');
  await page.locator('#request-text').fill('使用手动标识的设置面板。'); await click('generate-plan'); await noErrors();
  assert.equal((await snapshot()).panel.spec.id, 'explicit-settings'); assert.equal(calls.at(-1).request.id, 'explicit-settings'); pass(stage);

  stage = 'clearing-explicit-name-restores-automatic-identity';
  count = calls.length; await page.locator('#request-id').fill(''); await click('prepare');
  assert.match((await snapshot()).context.request.id, /^panel-[a-f0-9]{32}$/); assert.notEqual((await snapshot()).context.request.id, 'explicit-settings'); assert.equal(calls.length, count);
  await click('advanced-tools'); await page.waitForFunction(() => !document.body.classList.contains('advanced-mode')); pass(stage);

  stage = 'responsive-no-overflow-and-reduced-motion';
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 }); await menu();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px overflow`);
    for (const id of ['generate-plan', 'generate-edit']) {
      const bounds = await page.locator(`#${id}`).boundingBox(); assert(bounds.width >= 44 && bounds.height >= 44);
      assert.equal(await page.locator(`#${id}`).evaluate(element => getComputedStyle(element).transitionDuration), '0s');
    }
    await page.locator('#panel-menu > summary').press('Escape');
    if (width === 375) {
      const request = await page.locator('#request-text').boundingBox(), preview = await page.locator('#preview-heading').boundingBox();
      assert(request.y < preview.y); await screenshot('mobile-375.png');
    }
  }
  await page.setViewportSize({ width: 812, height: 375 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); pass(stage);

  stage = 'file-preview-keeps-import-menu-without-probing-model';
  count = calls.length; const priorRequests = structuredClone(requests);
  await page.goto(pathToFileURL(resolve(options['--workbench'], 'index.html')).href); await idle();
  assert.equal(await page.locator('#bridge-notice').isVisible(), true);
  assert.equal(await page.locator('#generate-plan').isDisabled(), true);
  await menu(); await page.locator('#panel-file').setInputFiles(resolve(output, 'edited.panel.bundle.json')); await idle();
  assert.deepEqual(await values(), saved.state); assert.deepEqual((await snapshot()).panel.spec, saved.spec);
  assert.equal(await page.locator('#generate-edit').isDisabled(), true); assert.equal(calls.length, count);
  assert.deepEqual(requests, priorRequests); await noErrors(); pass(stage);
  assert.deepEqual(problems, []); report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.failure = { stage, code: error.code ?? error.name, message: String(error.message).slice(0, 1600) };
  if (page) try { await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }); report.screenshots.push('failure.png'); } catch {}
  process.exitCode = 1;
} finally {
  gate?.release(); report.fixtureCalls = calls; report.requests = requests; report.browserProblems = problems;
  await context?.close().catch(() => {}); await browser?.close().catch(() => {}); await server?.close().catch(() => {});
  await writeNewJson(output, 'simple-workbench-browser-report.json', report);
  process.stdout.write(`${JSON.stringify({ status: report.status, checks: report.checks.length, providerCalls: 0, failedStage: report.failure?.stage ?? null })}\n`);
}
