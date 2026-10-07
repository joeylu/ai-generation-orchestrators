#!/usr/bin/env node
/** Browser regression entry point uses deterministic adapters only; no CLI/model calls. */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { loadWorkspaceTool } from './lib/workspace-tools.mjs';
const { chromium } = await loadWorkspaceTool('@playwright/test');
import { createOutputDirectory, readJson, writeNewJson } from '../src/io.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { validatePanelBundle } from '../src/panel-bundle.mjs';
import { validatePanelEditContext, checkPanelEditProposal } from '../src/edit-planning.mjs';
import { materializeCodexEditDraft } from '../src/codex-edit-draft.mjs';
import { validateCodexEditReceipt } from '../src/codex-planner.mjs';
import { createWorkbenchServer } from '../src/workbench-server.mjs';
import { createFormsFixtures } from './write-forms-fixture.mjs';
import { controlId } from '../src/compiler.mjs';
import { digestJson } from '../src/canonical.mjs';

export const FIXED_EDIT_REQUESTS = Object.freeze([
  { id: 'E07', text: '将角色名输入改为只读，其他属性、确认按钮提交范围和取消按钮行为都不变。' },
  { id: 'E12', text: '保持当前面板完全一样，这次不用修改任何内容。' },
]);

// Shared UI assertions. The default executable below always supplies a fixture server.
export async function verifyFixedEdits({ url, base, output, realModel = false }) {
  const core = await loadWorkspaceCore(), root = await createOutputDirectory(output);
  base = await validatePanelBundle(base, core);
  const report = { version: '0.1', status: 'RUNNING', mode: realModel ? 'REAL_CLI_ACCEPTANCE' : 'DETERMINISTIC_BROWSER_REGRESSION',
    model: realModel ? 'gpt-6-luna' : null, effort: realModel ? 'xhigh' : null,
    modelCalls: 0, fixtureCalls: 0, automaticRetries: 0, blockedRequests: 0, cases: [], consoleErrors: [], pageErrors: [],
    baseBundleSha256: base.sha256, requests: FIXED_EDIT_REQUESTS, nativeEngines: 'NOT_RUN' };
  let browser, page, active, consumed = false, currentSpec = base.spec;
  const rows = spec => spec.sections.flatMap(section => section.rows);
  try {
    browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
      proxy: { server: 'http://127.0.0.1:1', bypass: '127.0.0.1' } });
    page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, acceptDownloads: true }); page.setDefaultTimeout(20000);
    page.on('console', item => { if (item.type() === 'error') report.consoleErrors.push(item.text()); });
    page.on('pageerror', error => report.pageErrors.push(error.message));
    await page.route(u => /^\/api\/panel\/(?:plan|edit)$/.test(u.pathname), async route => {
      try {
        assert(active && !consumed); assert.equal(new URL(route.request().url()).pathname, '/api/panel/edit');
        const body = route.request().postDataJSON(), context = await validatePanelEditContext(body.context);
        assert.equal(context.request.text, active.text); assert.equal(context.baseSpecSha256, await digestJson(currentSpec));
        consumed = true; active.calls++; report[realModel ? 'modelCalls' : 'fixtureCalls']++;
        await writeNewJson(active.directory, 'dispatch.json', body);
        console.log(JSON.stringify({ event: 'dispatch', id: active.id, mode: report.mode, contextSha256: context.sha256 }));
        await route.continue();
      } catch (error) {
        report.blockedRequests++; await route.fulfill({ status: 409, contentType: 'application/json', body: '{"code":"ACCEPTANCE_DISPATCH_BLOCKED"}' });
      }
    });
    const idle = () => page.waitForFunction(() => window.panelWorkbench?.snapshot() && !window.panelWorkbench.busy, null, { timeout: 930000 });
    const snap = () => page.evaluate(() => window.panelWorkbench.snapshot());
    const trial = () => page.evaluate(() => window.panelWorkbench.getState());
    const events = () => page.evaluate(() => window.panelWorkbench.events());
    const menu = async () => { if (!await page.locator('#panel-menu').evaluate(n => n.open)) await page.locator('#panel-menu > summary').click(); };
    const focus = async row => {
      const canvas = page.locator('#canvas-host canvas'), target = controlId(currentSpec.id, row.id);
      await canvas.scrollIntoViewIfNeeded(); await canvas.focus();
      for (let i = 0; i < rows(currentSpec).length + 12; i++) {
        if (await canvas.getAttribute('data-focused-component') === target) return;
        await page.keyboard.press('Tab');
      }
      throw Error('FOCUS_UNREACHABLE');
    };
    await page.goto(url); await idle(); assert.match(await page.title(), /Panel Studio/);
    await menu(); await page.locator('#panel-file').setInputFiles({ name: 'panel.bundle.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(base)) }); await idle();
    const inputRow = rows(base.spec).find(row => row.kind === 'input');
    await focus(inputRow); await page.keyboard.insertText('小蓝莓😀'); assert.equal((await trial())[inputRow.bind], '小蓝莓😀');
    for (const request of FIXED_EDIT_REQUESTS) {
      active = { ...request, status: 'RUNNING', calls: 0, checks: [], directory: await createOutputDirectory(resolve(root, request.id)) };
      report.cases.push(active); consumed = false;
      const pass = name => active.checks.push({ name, status: 'PASS' });
      try {
        const before = await snap(), beforeTrial = await trial(), beforeEvents = await events();
        await writeNewJson(active.directory, 'before.json', { snapshot: before, currentState: beforeTrial, events: beforeEvents });
        await page.locator('#edit-request-text').fill(request.text);
        const waiting = page.waitForResponse(r => new URL(r.url()).pathname === '/api/panel/edit' && r.request().method() === 'POST', { timeout: 930000 });
        await page.locator('#generate-edit').click(); const response = await waiting, body = await response.json(); await idle();
        await writeNewJson(active.directory, 'response.json', { httpStatus: response.status(), body });
        console.log(JSON.stringify({ event: 'model-return', id: request.id, httpStatus: response.status(), status: body.report?.status ?? body.code }));
        assert.equal(response.status(), 200, body.code); assert.equal(active.calls, 1);
        const context = response.request().postDataJSON().context, checked = await checkPanelEditProposal(context, body.proposal);
        assert.deepEqual(checked, body.report);
        active.receipt = validateCodexEditReceipt(body.receipt, { contextSha256: context.sha256, proposalSha256: checked.proposalSha256 });
        assert.equal(active.receipt.invocationCount, 1); assert.equal(active.receipt.automaticRetries, 0); pass('one-shot-bound-public-gates');
        if (request.id === 'E07') {
          assert.equal(checked.status, 'READY_TO_APPLY'); const after = await snap();
          const expected = structuredClone(base.spec); rows(expected).find(row => row.id === inputRow.id).readOnly = true;
          assert.deepEqual(after.panel.spec, expected); currentSpec = after.panel.spec;
          assert.deepEqual(await trial(), beforeTrial); assert.equal(after.history.length, 1); pass('only-readonly-changed-preserved-current-input');
          await focus(inputRow); assert(await page.locator('#canvas-host input').evaluate(node => node.readOnly));
          await page.keyboard.insertText('不能修改'); assert.deepEqual(await trial(), beforeTrial); pass('readonly-blocks-actual-keyboard-input');
          await focus(rows(currentSpec).find(row => row.action?.kind === 'submit')); await page.keyboard.press('Enter');
          assert.deepEqual((await events()).at(-1).values, { [inputRow.bind]: '小蓝莓😀' }); pass('submit-preserves-raw-current-value');
        } else {
          assert.equal(checked.status, 'NO_CHANGES'); const after = await snap();
          assert.deepEqual(after.panel, before.panel); assert.deepEqual(after.history, before.history); assert.equal(after.canUndo, before.canUndo);
          assert.deepEqual(await trial(), beforeTrial); assert.deepEqual(await events(), beforeEvents); pass('panel-history-input-events-unchanged');
          assert.equal((await page.evaluate(() => window.panelWorkbench.editSnapshot())).report.status, 'NO_CHANGES');
          assert.match(await page.locator('#edit-plan-status').textContent(), /无需修改/);
          assert.equal((await page.locator('#edit-questions').textContent()).trim(), '');
          assert.equal((await page.locator('#edit-plan-error').textContent()).trim(), ''); pass('normal-no-change-message-without-error-or-question');
        }
        await menu(); const download = page.waitForEvent('download'); await page.locator('#download-panel').click();
        await (await download).saveAs(resolve(active.directory, 'exported-panel.bundle.json')); await idle();
        const exported = await validatePanelBundle(await readJson(resolve(active.directory, 'exported-panel.bundle.json')), core);
        assert.deepEqual(exported.spec, currentSpec); assert.deepEqual(exported.state, await trial()); pass('validated-export-current-state');
        await writeNewJson(active.directory, 'after.json', { snapshot: await snap(), currentState: await trial(), events: await events() });
        await page.locator('#canvas-host').scrollIntoViewIfNeeded(); await page.screenshot({ path: resolve(active.directory, 'desktop.png'), fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.screenshot({ path: resolve(active.directory, 'mobile.png'), fullPage: true }); await page.setViewportSize({ width: 1440, height: 1080 }); pass('desktop-mobile-no-overflow');
        if (request.id === 'E12' && before.history.length) {
          await menu(); await page.locator('#advanced-tools').click(); await page.locator('#undo').click(); await idle();
          assert.deepEqual((await snap()).panel.spec, base.spec); assert.deepEqual(await trial(), beforeTrial); pass('undo-still-reverts-previous-real-edit');
        }
        active.status = 'PASS';
      } catch (error) {
        active.status = 'FAIL'; active.failure = String(error.code ?? error.message).slice(0, 1000);
        try { await page.screenshot({ path: resolve(active.directory, 'failure.png'), fullPage: true }); } catch {}
      }
      await writeNewJson(active.directory, 'case-report.json', active);
      console.log(JSON.stringify({ event: 'case-complete', id: active.id, status: active.status, checks: active.checks.length, failure: active.failure }));
      if (active.status === 'FAIL' && /CONNECTION|AUTH_REQUIRED|RATE_LIMIT|MODEL_UNAVAILABLE/.test(active.failure)) break;
    }
    assert.equal(report.blockedRequests, 0); assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []);
    report.status = report.cases.length === 2 && report.cases.every(c => c.status === 'PASS') ? 'PASS' : 'FAIL';
  } catch (error) { report.status = 'FAIL'; report.failure = String(error.message).slice(0, 1000); }
  finally { await browser?.close(); await writeNewJson(root, 'suite-report.json', report); }
  console.log(JSON.stringify({ status: report.status, modelCalls: report.modelCalls, fixtureCalls: report.fixtureCalls, automaticRetries: 0, cases: report.cases.map(c => ({ id: c.id, status: c.status })) }));
  return report;
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/check-no-change-workbench-browser.mjs')) {
  const args = process.argv.slice(2); assert.equal(args.length, 4); assert.equal(args[0], '--workbench'); assert.equal(args[2], '--output');
  const { role } = await createFormsFixtures(await loadWorkspaceCore());
  const server = await createWorkbenchServer({ workbench: args[1], outputRoot: resolve(args[3], 'fixture-evidence'),
    planner: async () => { throw Error('UNEXPECTED_GENERATION_FIXTURE'); }, editor: async context => {
      const row = context.spec.sections.flatMap(section => section.rows).find(row => row.kind === 'input');
      const field = context.spec.state.find(field => field.id === row.bind), unchanged = context.request.text === FIXED_EDIT_REQUESTS[1].text;
      const draft = { codexEditDraftVersion: '0.3', contextSha256: context.sha256,
        patch: unchanged ? null : { patchVersion: '0.1', baseSpecSha256: context.baseSpecSha256, reason: 'Exact browser regression fixture.',
          operations: [{ op: 'set-input-properties', rowId: row.id, placeholder: row.placeholder, inputType: row.inputType,
            readOnly: true, maxLength: field.maxLength, validation: row.validation }] },
        bases: unchanged ? null : [{ kind: 'request-interpretation', quote: context.request.text }], unresolved: [],
        noChange: unchanged ? { reason: '本轮明确无需修改。', quote: context.request.text } : null };
      const proposal = await materializeCodexEditDraft(context, draft), report = await checkPanelEditProposal(context, proposal);
      return { proposal, report, receipt: { codexEditingReceiptVersion: unchanged ? '0.2' : '0.1', model: 'gpt-6-luna', effort: 'xhigh',
        contextSha256: context.sha256, proposalSha256: report.proposalSha256, status: report.status, failureCode: null,
        invocationCount: 1, automaticRetries: 0, elapsedMs: 0, usage: null } };
    } });
  try { const report = await verifyFixedEdits({ url: server.url, base: role, output: args[3] }); if (report.status !== 'PASS') process.exitCode = 1; }
  finally { await server.close(); }
}
