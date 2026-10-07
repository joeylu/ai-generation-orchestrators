#!/usr/bin/env node
/** Exact regression fixtures through the visible Studio flow. Never invokes a real model. */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { loadWorkspaceTool } from './lib/workspace-tools.mjs';
const { chromium } = await loadWorkspaceTool('@playwright/test');
import { createOutputDirectory, readJson, writeNewJson } from '../src/io.mjs';
import { createWorkbenchServer } from '../src/workbench-server.mjs';
import { materializePanelIntent, buildPanelIntentResponseSchema } from '../src/panel-intent.mjs';
import { materializeCodexEditDraft } from '../src/codex-edit-draft.mjs';
import { checkPanelProposal } from '../src/proposal.mjs';
import { checkPanelEditProposal } from '../src/edit-planning.mjs';
import { digestBytes } from '../src/canonical.mjs';
import { controlId } from '../src/compiler.mjs';

const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  assert(['--workbench', '--output', '--url'].includes(key) && value && !options[key]); options[key] = value;
}
assert(options['--workbench'] && options['--output']);
const output = await createOutputDirectory(options['--output']);
const request = '生成设置面板，包含声音和显示两个页签。声音页有主音量和静音开关；显示页有亮度滑条。默认打开声音页。';
const questions = [
  { id: 'q0', question: '主音量的范围、步长和初始值是多少？' },
  { id: 'q1', question: '静音开关默认开启还是关闭？开启时是否表示静音？' },
  { id: 'q2', question: '亮度的范围、步长和初始值是多少？' },
];
const answers = ['主音量范围0～100，步长1，初始70。', '静音开关默认关闭，开启表示静音。', '亮度范围0～100，步长1，初始60。'];
const report = { version: '0.1', status: 'RUNNING', modelRequests: 0, fixtureCalls: 0,
  automaticRetries: 0, browserPlugin: 'NOT_AVAILABLE', humanVisualReview: 'NOT_RUN',
  checks: [], consoleErrors: [], pageErrors: [], screenshots: [] };
const pass = name => report.checks.push({ name, status: 'PASS' });
const receipt = (context, checked, editing = false) => ({
  [editing ? 'codexEditingReceiptVersion' : 'codexPlanningReceiptVersion']: '0.1',
  model: 'gpt-6-luna', effort: 'xhigh', contextSha256: context.sha256, proposalSha256: checked.proposalSha256,
  status: checked.status, failureCode: null, invocationCount: 1, automaticRetries: 0, elapsedMs: 0, usage: null,
});
function completeIntent(context) {
  const slider = (id, label, initial) => ({ id, kind: 'slider', label, recipeKey: 'settings.slider@0.1.0',
    sourceQuote: context.request.text, icon: null, enabled: true, min: 0, max: 100, step: 1, initial, prefix: '', suffix: '' });
  const body = (id, title, rows) => ({ kind: 'column', children: [{ kind: 'section', id, title, rows }] });
  return { panelIntentVersion: '0.5', contextSha256: context.sha256, unresolved: [], panel: {
    id: context.request.id, title: '设置', themeKey: `${context.catalog.themes[0].id}@${context.catalog.themes[0].version}`, panelSurface: null,
    layout: { width: null, canvasWidth: null, canvasHeight: null, maxHeight: null, overflow: 'auto' },
    body: { kind: 'tabs', enabled: true, sourceQuote: context.request.text, pages: [
      { id: 'page0', label: '声音', sourceQuote: '声音页有主音量和静音开关', initial: true,
        body: body('section0', '声音', [slider('row0', '主音量', 70), { id: 'row1', kind: 'switch',
          label: '静音', recipeKey: 'settings.switch@0.1.0', sourceQuote: context.request.text, icon: null, enabled: true, initial: false }]) },
      { id: 'page1', label: '显示', sourceQuote: '显示页有亮度滑条', initial: false,
        body: body('section1', '显示', [slider('row2', '亮度', 60)]) },
    ] },
  } };
}
async function planner(context) {
  report.fixtureCalls++;
  assert.deepEqual(buildPanelIntentResponseSchema(context).properties.unresolved.items.properties.id.enum,
    Array.from({ length: 64 }, (_, i) => `q${i}`));
  const completed = context.request.text.includes('【补充回答】');
  if (completed) for (const answer of answers) assert(context.request.text.includes(answer));
  else assert.equal(context.request.text, request);
  const intent = completed ? completeIntent(context) : { panelIntentVersion: '0.5', contextSha256: context.sha256, panel: null, unresolved: questions };
  const proposal = await materializePanelIntent(context, intent), checked = await checkPanelProposal(context, proposal);
  return { proposal, report: checked, receipt: receipt(context, checked) };
}
async function editor(context) {
  report.fixtureCalls++;
  const proposal = await materializeCodexEditDraft(context, { codexEditDraftVersion: '0.1', contextSha256: context.sha256,
    patch: null, bases: null, unresolved: [{ id: 'q0', question: '音效音量的范围、步长和初值是多少？' }] });
  const checked = await checkPanelEditProposal(context, proposal);
  return { proposal, report: checked, receipt: receipt(context, checked, true) };
}
let server, browser, page, stage = 'initialize';
try {
  server = await createWorkbenchServer({ workbench: resolve(options['--workbench']), outputRoot: resolve(output, 'fixture-calls'), port: 0, planner, editor });
  browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    proxy: { server: 'http://127.0.0.1:1', bypass: '127.0.0.1' } });
  report.browser = { channel: 'msedge', version: browser.version() };
  page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, serviceWorkers: 'block' });
  page.setDefaultTimeout(20000);
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  page.on('pageerror', error => report.pageErrors.push(error.message));
  const idle = () => page.waitForFunction(() => window.panelWorkbench?.snapshot() && !window.panelWorkbench.busy);
  const snapshot = () => page.evaluate(() => window.panelWorkbench.snapshot());
  const state = () => page.evaluate(() => window.panelWorkbench.getState());
  const generate = async () => {
    const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/panel/plan');
    await page.locator('#generate-plan').click(); const received = await response;
    const data = await received.json(); assert(received.ok(), JSON.stringify(data)); await idle(); return data;
  };
  const shot = async name => { await page.screenshot({ path: resolve(output, name), fullPage: true }); report.screenshots.push(name); };
  const focus = async (spec, id) => {
    const canvas = page.locator('#canvas-host canvas'); await canvas.scrollIntoViewIfNeeded(); await canvas.focus();
    for (let i = 0; i < 10; i++) { if (await canvas.getAttribute('data-focused-component') === controlId(spec.id, id)) return; await page.keyboard.press('Tab'); }
    throw Error('FOCUS_UNREACHABLE');
  };
  await page.goto(server.url); await idle(); await page.waitForFunction(() => document.getElementById('model-status').textContent.includes('本地 Codex CLI'));
  stage = 'incomplete-request-shows-questions'; await page.locator('#request-text').fill(request);
  const pending = await generate(); assert.equal(pending.report.status, 'NEEDS_INPUT');
  assert.deepEqual((await snapshot()).proposal.unresolved, questions); assert.equal((await snapshot()).panel, null);
  assert(await page.locator('#clarification-form').isVisible()); assert.equal(await page.locator('#questions textarea').count(), 3);
  assert.equal(await page.locator('#request-error').textContent(), ''); await shot('questions.png'); pass(stage);
  stage = 'answers-do-not-trigger-compute'; const calls = report.fixtureCalls;
  await page.locator('#clarify').click(); await idle(); assert.match(await page.locator('#clarification-error').textContent(), /逐项/u);
  assert.equal(report.fixtureCalls, calls);
  for (const [i, answer] of answers.entries()) await page.locator(`#clarification-answer-${i}`).fill(answer);
  await page.locator('#clarify').click(); await idle(); assert.equal(report.fixtureCalls, calls);
  const amended = await page.locator('#request-text').inputValue(); assert(amended.startsWith(request));
  for (const answer of answers) assert(amended.includes(answer)); assert(!(await page.locator('#clarification-form').isVisible())); pass(stage);
  stage = 'completed-request-compiles-tabs'; const result = await generate(); assert.equal(result.report.status, 'READY_TO_COMPILE');
  const accepted = (await snapshot()).panel; assert(accepted); assert.deepEqual(accepted.spec.tabs.pages.map(p => p.label), ['声音', '显示']);
  assert.equal((await state()).row0, 70); assert.equal((await state()).row1, false); assert.equal((await state()).row2, 60); pass(stage);
  stage = 'tabs-preserve-current-values'; await focus(accepted.spec, 'row0'); await page.keyboard.press('ArrowLeft'); assert.equal((await state()).row0, 69);
  await focus(accepted.spec, 'navigation'); await page.keyboard.press('End'); assert.equal((await state()).navigation, 'page1');
  await focus(accepted.spec, 'row2'); await page.keyboard.press('ArrowRight'); assert.equal((await state()).row2, 61);
  await focus(accepted.spec, 'navigation'); await page.keyboard.press('Home'); assert.equal((await state()).row0, 69); await shot('tabs.png'); pass(stage);
  stage = 'new-questions-retain-existing-preview'; const before = await state(); await page.locator('#request-text').fill(request);
  assert.equal((await generate()).report.status, 'NEEDS_INPUT'); assert.deepEqual((await snapshot()).panel.spec, accepted.spec);
  assert.deepEqual(await state(), before); assert(await page.locator('#canvas-host canvas').isVisible()); pass(stage);
  stage = 'edit-questions-retain-existing-preview'; await page.locator('#edit-request-text').fill('在声音页增加音效音量滑条，其他设置保持不变。');
  const waiting = page.waitForResponse(r => new URL(r.url()).pathname === '/api/panel/edit'); await page.locator('#generate-edit').click();
  const response = await waiting; assert(response.ok()); assert.equal((await response.json()).report.status, 'NEEDS_INPUT'); await idle();
  assert(await page.locator('#edit-questions').isVisible()); assert.match(await page.locator('#edit-questions').textContent(), /音效音量/u);
  assert.deepEqual((await snapshot()).panel.spec, accepted.spec); assert.deepEqual(await state(), before); pass(stage);
  stage = 'mobile-questions'; await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.locator('#clarification-form').isVisible()); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await shot('mobile-questions.png'); pass(stage);
  if (options['--url']) {
    stage = 'live-build-bytes-and-capability'; const manifest = await readJson(resolve(options['--workbench'], 'workbench-build.json'));
    for (const file of manifest.files) { const res = await fetch(new URL(file.path, options['--url'])); assert(res.ok);
      const bytes = new Uint8Array(await res.arrayBuffer()); assert.equal(bytes.length, file.bytes); assert.equal(await digestBytes(bytes), file.sha256); }
    await page.goto(options['--url']); await idle(); const capabilities = await (await fetch(new URL('api/panel/capabilities', options['--url']))).json();
    assert(capabilities.available && capabilities.editingAvailable);
    assert.match(await page.locator('#request-text').getAttribute('placeholder'), /范围|0～100/u); pass(stage);
  }
  assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.pageErrors, []); pass('no-browser-errors'); report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.failedStage = stage; report.error = { code: error.code ?? 'CLARIFICATION_BROWSER_FAILED', message: String(error.message).slice(0, 1600) };
  if (page) try { await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }); } catch {}
} finally {
  await browser?.close(); await server?.close(); await writeNewJson(output, 'clarification-workbench-browser-report.json', report);
}
console.log(JSON.stringify({ status: report.status, checks: report.checks.length, modelRequests: report.modelRequests, fixtureCalls: report.fixtureCalls, failedStage: report.failedStage }));
if (report.status !== 'PASS') process.exitCode = 1;
