#!/usr/bin/env node
/** Player-task examples and clarification choices through visible UI. Fixture adapters only. */
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { loadWorkspaceTool } from './lib/workspace-tools.mjs';
const { chromium } = await loadWorkspaceTool('@playwright/test');
import { createOutputDirectory, readJson, writeNewJson } from '../src/io.mjs';
import { createWorkbenchServer } from '../src/workbench-server.mjs';
import { materializePanelIntent } from '../src/panel-intent.mjs';
import { checkPanelProposal } from '../src/proposal.mjs';
import { checkPanelEditProposal } from '../src/edit-planning.mjs';
import { beginnerExamples } from '../src/workbench-guidance.mjs';
import { digestBytes } from '../src/canonical.mjs';
import { readFile } from 'node:fs/promises';

const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  assert(['--workbench', '--output'].includes(key) && value && !options[key]); options[key] = value;
}
assert(options['--workbench'] && options['--output']);
const output = await createOutputDirectory(options['--output']), workbench = resolve(options['--workbench']);
const report = { version: '0.1', status: 'RUNNING', modelRequests: 0, fixtureCalls: { plan: 0, edit: 0 },
  checks: [], blockedRequests: 0, browserErrors: [], nativeEngines: 'NOT_RUN', realModelInterpretation: 'NOT_RUN' };
const pass = name => report.checks.push({ name, status: 'PASS' });
const questions = [
  { id: 'q0', question: '音量怎么设置？【推荐回答：音量0～100，每次变化1，默认70。】【备选回答：音量0～100，每次变化1，默认50。】' },
  { id: 'q1', question: '静音默认是什么状态？开启表示什么？' },
  { id: 'q2', question: '恢复默认影响哪些设置？【推荐回答：恢复默认只重置音量和静音。】' },
];
const receipt = (context, checked, editing = false) => ({ [editing ? 'codexEditingReceiptVersion' : 'codexPlanningReceiptVersion']: '0.1',
  model: 'gpt-6-luna', effort: 'xhigh', contextSha256: context.sha256, proposalSha256: checked.proposalSha256,
  status: checked.status, failureCode: null, invocationCount: 1, automaticRetries: 0, elapsedMs: 0, usage: null });
function audioIntent(context) {
  const common = (kind, label) => ({ kind, label, recipeKey: `settings.${kind}@0.1.0`, sourceRef: 'request', icon: null, enabled: true });
  return { panelIntentVersion: '0.8', contextSha256: context.sha256, unresolved: [], panel: {
    id: context.request.id, title: '声音设置', themeKey: `${context.catalog.themes[0].id}@${context.catalog.themes[0].version}`, panelSurface: null,
    layout: { width: null, canvasWidth: null, canvasHeight: null, maxHeight: 480, overflow: 'auto' },
    body: { kind: 'column', children: [{ kind: 'section', title: '声音设置', rows: [
      { ...common('slider', '音量'), min: 0, max: 100, step: 1, initial: 70, prefix: '', suffix: '' },
      { ...common('switch', '静音'), initial: false },
      { ...common('button', '恢复默认'), action: 'reset-initial', resetRows: [0, 1], submitRows: [] },
    ] }] },
  } };
}
async function planner(context) {
  report.fixtureCalls.plan++;
  let intent;
  if (report.fixtureCalls.plan === 1) {
    assert.equal(context.request.text, beginnerExamples[0].text);
    intent = { panelIntentVersion: '0.8', contextSha256: context.sha256, panel: null, unresolved: questions };
  } else if (report.fixtureCalls.plan === 2) {
    assert(context.request.text.startsWith(beginnerExamples[0].text + '\n\n【补充回答】'));
    for (const text of ['回答：音量0～100，每次变化1，默认70。', '回答：默认关闭，开启表示静音。', '回答：恢复默认只重置音量和静音。']) assert(context.request.text.includes(text));
    intent = audioIntent(context);
  } else if (report.fixtureCalls.plan === 3) {
    assert.equal(report.fixtureCalls.plan, 3); assert.equal(context.request.text, '新需求');
    intent = { panelIntentVersion: '0.8', contextSha256: context.sha256, panel: null, unresolved: [
      { id: 'q0', question: '初值多少？【推荐回答：50】缺少结束格式' },
      { id: 'q1', question: '提示文字？【推荐回答：<img src=x onerror=alert(1)>】' },
      { id: 'q2', question: '建议默认70，也可以50，你想用多少？' },
    ] };
  } else {
    assert(report.fixtureCalls.plan <= 6);
    assert(context.request.text.startsWith('做一个声音设置。'));
    intent = report.fixtureCalls.plan === 6 ? audioIntent(context)
      : { panelIntentVersion: '0.8', contextSha256: context.sha256, panel: null,
        unresolved: report.fixtureCalls.plan === 4 ? [questions[0]] : [
          { id: 'q0', question: '静音与恢复默认如何设置？【推荐回答：静音默认关闭，开启表示静音；恢复默认只重置音量和静音。】' },
        ] };
    if (report.fixtureCalls.plan === 6) {
      assert(context.request.text.includes('【备选回答：'));
      assert(context.request.text.includes('回答：静音默认关闭，开启表示静音；恢复默认只重置音量和静音。'));
    }
  }
  const proposal = await materializePanelIntent(context, intent), checked = await checkPanelProposal(context, proposal);
  return { proposal, report: checked, receipt: receipt(context, checked) };
}
async function editor(context) {
  report.fixtureCalls.edit++;
  const complete = report.fixtureCalls.edit === 2;
  assert(report.fixtureCalls.edit <= 2);
  assert(context.request.text.startsWith('调整默认音量，其他保持不变。'));
  if (complete) assert(context.request.text.includes('回答：默认音量50。'));
  const proposal = { editProposalVersion: '0.1', contextSha256: context.sha256,
    patch: complete ? { patchVersion: '0.1', baseSpecSha256: context.baseSpecSha256, reason: 'Explicit fixture default edit.',
      operations: [{ op: 'set-state-initial', fieldId: 'row0', value: 50 }] } : null,
    decisions: complete ? [{ operationIndex: 0, basis: { kind: 'request-interpretation', start: 0, end: context.request.text.length, quote: context.request.text } }] : [],
    unresolved: complete ? [] : [{ id: 'q0', question: '默认音量改为多少？【推荐回答：默认音量50。】【备选回答：默认音量30。】' }],
  };
  const checked = await checkPanelEditProposal(context, proposal);
  return { proposal, report: checked, receipt: receipt(context, checked, true) };
}
let server, browser, page, stage = 'initialize';
const until = async predicate => {
  const end = Date.now() + 25000;
  while (Date.now() < end) { if (await predicate()) return; await new Promise(r => setTimeout(r, 100)); }
  throw Error('GUIDANCE_BROWSER_TIMEOUT');
};
try {
  const build = await readJson(join(workbench, 'workbench-build.json'));
  report.buildFiles = build.files; report.catalogSha256 = build.catalogSha256;
  server = await createWorkbenchServer({ workbench, outputRoot: join(output, 'fixture-calls'), port: 0, planner, editor });
  browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    proxy: { server: 'http://127.0.0.1:1', bypass: '127.0.0.1' } });
  report.browser = { channel: 'msedge', version: browser.version() };
  page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, serviceWorkers: 'block' });
  page.on('pageerror', error => report.browserErrors.push(error.message));
  page.setDefaultTimeout(20000);
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === new URL(server.url).origin && (request.method() === 'GET'
        || request.method() === 'POST' && ['/api/panel/plan', '/api/panel/edit'].includes(url.pathname))) return route.continue();
    if (['data:', 'blob:'].includes(url.protocol)) return route.continue();
    report.blockedRequests++; return route.abort();
  });
  const idle = () => until(() => page.evaluate(() => Boolean(window.panelWorkbench?.snapshot()) && !window.panelWorkbench.busy));
  const click = async selector => {
    const locator = page.locator(selector); await locator.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
    assert(await locator.isEnabled()); const bounds = await locator.boundingBox(); assert(bounds);
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  };
  const submit = async (button, kind) => {
    const response = page.waitForResponse(value => new URL(value.url()).pathname === `/api/panel/${kind}`);
    await click(button); assert.equal((await response).status(), 200); await idle();
  };
  await page.goto(server.url, { waitUntil: 'commit' }); await idle();
  assert.equal(await page.locator('#requirement-examples').evaluate(element => element.open), false);
  assert(await page.locator('#requirement-summary').isHidden()); assert(await page.locator('#generate-edit').isDisabled());
  pass('home keeps examples collapsed, result summary absent and editing disabled until a panel exists');

  stage = 'examples'; await page.locator('#request-text').fill('可替换的旧文字'); await click('#requirement-examples>summary');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#example-choices button').first().focus(); await page.keyboard.press('Enter');
  assert.equal(await page.locator('#request-text').inputValue(), beginnerExamples[0].text);
  assert.deepEqual(report.fixtureCalls, { plan: 0, edit: 0 });
  assert.equal(await page.locator('#requirement-examples').evaluate(element => element.open), false);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: join(output, 'examples-mobile.png') });
  pass('plain-language example is keyboard selectable, visibly replaces input and never generates automatically');

  stage = 'generation-choices'; await submit('#generate-plan', 'plan');
  assert.equal(await page.locator('#questions textarea').count(), 3);
  assert.equal(await page.locator('#questions button[aria-pressed=true]').count(), 0);
  for (const input of await page.locator('#questions textarea').all()) assert.equal(await input.inputValue(), '');
  const pinned = (await page.evaluate(() => window.panelWorkbench.snapshot())).context.sha256;
  await page.locator('#questions li').nth(0).locator('button').first().focus(); await page.keyboard.press('Enter');
  await click('#questions li:nth-child(3) button');
  await click('#clarify'); await idle();
  assert((await page.locator('#clarification-error').textContent()).includes('填写有效回答'));
  assert.equal(await page.locator('#questions li:nth-child(1) textarea').inputValue(), '音量0～100，每次变化1，默认70。');
  assert.equal((await page.evaluate(() => window.panelWorkbench.snapshot())).context.sha256, pinned);
  assert.deepEqual(report.fixtureCalls, { plan: 1, edit: 0 });
  pass('no choices preselected; incomplete submission preserves chosen answer, pinned context and call count');
  await click('#questions li:nth-child(1) button:nth-child(2)');
  await page.locator('#questions li:nth-child(1) textarea').fill('我想用65。');
  assert.equal(await page.locator('#questions li:nth-child(1) button[aria-pressed=true]').count(), 0);
  await click('#questions li:nth-child(1) button:nth-child(1)');
  await page.locator('#questions li:nth-child(2) textarea').fill('默认关闭，开启表示静音。');
  await page.screenshot({ path: join(output, 'choices-mobile.png') });
  await click('#clarify'); await idle();
  const clarified = await page.locator('#request-text').inputValue(); assert(clarified.startsWith(beginnerExamples[0].text));
  assert(clarified.includes('回答：默认关闭，开启表示静音。')); assert.equal(report.fixtureCalls.plan, 1);
  assert.equal(clarified.includes('备选回答'), false);
  assert((await page.evaluate(() => window.panelWorkbench.snapshot())).context.request.text.includes('【备选回答：'));
  assert(await page.locator('#clarification-form').isHidden());
  pass('suggestions can be replaced by free text; adopting all answers preserves original request and does not call a model');
  await page.setViewportSize({ width: 1440, height: 1080 }); await submit('#generate-plan', 'plan');
  const accepted = await page.evaluate(() => window.panelWorkbench.snapshot());
  assert.equal(accepted.phase, 'ready'); assert.equal(accepted.panel.spec.state[0].initial, 70);
  assert.equal(await page.locator('#summary-overview').textContent(), '当前面板：包含音量、静音、恢复默认。');
  await click('#requirement-summary summary');
  const details = await page.locator('#summary-details').textContent();
  assert(details.includes('默认 70')); assert(details.includes('恢复音量、静音的默认值')); assert.equal(report.fixtureCalls.plan, 2);
  pass('explicit second click generates a real Pixi fixture; summary reads exact accepted values and reset scope');

  stage = 'edit-choices';
  const nodes = await page.evaluate(() => window.panelWorkbench.inspect().nodes), slider = nodes.find(node => node.type === 'Slider');
  await page.locator('canvas').evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const bounds = await page.locator('canvas').boundingBox();
  await page.mouse.click(bounds.x + (slider.bounds.x + slider.bounds.width * .35) * bounds.width / accepted.panel.spec.canvas.width,
    bounds.y + (slider.bounds.y + slider.bounds.height * .5) * bounds.height / accepted.panel.spec.canvas.height);
  const played = await page.evaluate(() => window.panelWorkbench.getState()); assert.notEqual(played.row0, 70);
  await page.locator('#edit-request-text').fill('调整默认音量，其他保持不变。'); await submit('#generate-edit', 'edit');
  assert.equal((await page.evaluate(() => window.panelWorkbench.snapshot())).panel.sha256, accepted.panel.sha256);
  assert.deepEqual(await page.evaluate(() => window.panelWorkbench.getState()), played);
  await page.locator('#edit-questions button').first().focus(); await page.keyboard.press('Enter');
  await click('#clarify-edit'); await idle(); assert.equal(report.fixtureCalls.edit, 1);
  assert((await page.locator('#edit-request-text').inputValue()).startsWith('调整默认音量，其他保持不变。\n\n【补充回答】'));
  assert.equal((await page.locator('#edit-request-text').inputValue()).includes('备选回答'), false);
  assert.equal(await page.locator('#edit-plan-status').textContent(), '回答已补充，请点击「修改面板」。');
  await submit('#generate-edit', 'edit');
  assert.equal((await page.evaluate(() => window.panelWorkbench.snapshot())).panel.spec.state[0].initial, 50);
  assert.deepEqual(await page.evaluate(() => window.panelWorkbench.getState()), played);
  assert((await page.locator('#summary-details').textContent()).includes('默认 50'));
  assert(await page.locator('#edit-clarification-form').isHidden());
  await page.locator('#requirement-summary').evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await page.screenshot({ path: join(output, 'summary-desktop.png') });
  pass('edit choices adopt answers without compute; explicit edit click updates summary and preserves played values');
  await click('#panel-menu>summary'); await click('#undo'); await idle();
  assert((await page.locator('#summary-details').textContent()).includes('默认 70'));
  assert.deepEqual(await page.evaluate(() => window.panelWorkbench.getState()), played);
  const restored = await page.evaluate(() => window.panelWorkbench.snapshot());
  pass('undo restores summary defaults while keeping current played state');

  stage = 'fallback-and-stale'; await page.locator('#request-text').fill('新需求'); await submit('#generate-plan', 'plan');
  assert.equal(await page.locator('#questions li:nth-child(1) button').count(), 0);
  assert.equal(await page.locator('#questions li:nth-child(3) button').count(), 0);
  assert((await page.locator('#questions li:nth-child(1) label').textContent()).endsWith('缺少结束格式'));
  assert.equal(await page.locator('#questions img').count(), 0);
  assert((await page.locator('#questions li:nth-child(2) button').textContent()).includes('<img src=x onerror=alert(1)>'));
  await click('#questions li:nth-child(2) button'); assert.equal(await page.locator('#questions li:nth-child(2) textarea').inputValue(), '<img src=x onerror=alert(1)>');
  assert.equal(report.fixtureCalls.plan, 3);
  await page.locator('#request-text').fill('与旧问题不同的新需求');
  assert(await page.locator('#clarification-form').isHidden()); assert(await page.locator('#clarify').isDisabled());
  assert.equal((await page.evaluate(() => window.panelWorkbench.snapshot())).panel.sha256, restored.panel.sha256);
  pass('malformed suggestions and ordinary prose stay free-text; markup stays inert; editing requirement hides stale questions and keeps last panel');

  stage = 'successive-clarifications'; await page.locator('#request-text').fill('做一个声音设置。');
  for (let round = 0; round < 2; round++) {
    await submit('#generate-plan', 'plan'); await click('#questions button:nth-child(1)'); await click('#clarify'); await idle();
    assert.equal((await page.locator('#request-text').inputValue()).includes('备选回答'), false);
    assert((await page.locator('#request-text').inputValue()).includes('回答：音量0～100，每次变化1，默认70。'));
  }
  await submit('#generate-plan', 'plan');
  assert.equal((await page.evaluate(() => window.panelWorkbench.snapshot())).phase, 'ready');
  pass('successive clarification rounds retain every adopted fact without reintroducing unselected alternatives in input');

  for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 1080 }]) {
    await page.setViewportSize(viewport);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    pass(`no page overflow at ${viewport.width}px`);
  }
  assert.deepEqual(report.browserErrors, []); assert.equal(report.blockedRequests, 0); assert.deepEqual(report.fixtureCalls, { plan: 6, edit: 2 });
  for (const name of ['examples-mobile.png', 'choices-mobile.png', 'summary-desktop.png']) {
    const bytes = await readFile(join(output, name)); (report.screenshots ??= []).push({ path: name, bytes: bytes.length, sha256: await digestBytes(bytes) });
  }
  pass('zero browser errors or real model requests; exactly six fixture generations and two fixture edits');
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.failure = { stage, message: error.message, code: error.code ?? error.name }; process.exitCode = 1;
  await page?.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {});
} finally {
  await page?.close(); await browser?.close(); await server?.close();
  await writeNewJson(output, 'guidance-browser-report.json', report);
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, modelRequests: 0, fixtureCalls: report.fixtureCalls, failure: report.failure ?? null }));
}
