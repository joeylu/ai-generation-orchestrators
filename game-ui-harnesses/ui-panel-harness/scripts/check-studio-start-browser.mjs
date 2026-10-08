#!/usr/bin/env node
/** Real builds, fixed-origin restarts and browser persistence; zero model requests. */
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { launchStudio, parseStudioArguments } from './lib/studio-launcher.mjs';
import { loadWorkspaceTool } from './lib/workspace-tools.mjs';
import { listenLoopback } from '../src/loopback-listener.mjs';
import { createWorkbenchServer } from '../src/workbench-server.mjs';
import { createOutputDirectory, readJson, writeNewJson, harnessRoot } from '../src/io.mjs';
import { createPlanningContext } from '../src/planning-context.mjs';
import { materializePanelIntent } from '../src/panel-intent.mjs';
import { createPanelBundle, validatePanelBundle } from '../src/panel-bundle.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { formRequest, formIntent } from '../examples/forms-v1/fixture.mjs';

assert(process.argv.length === 4 && process.argv[2] === '--output', 'Required: --output <fresh directory>');
const output = await createOutputDirectory(process.argv[3]);
const report = { status: 'RUNNING', modelCalls: 0, modelRequests: 0, fixtureAdapterCalls: 0, checks: [], builds: [],
  scope: 'Current real builds; authored form and catalog-upgrade fixtures; isolated browser; same fixed origin', nativeEngines: 'NOT_RUN' };
const pass = name => report.checks.push({ name, status: 'PASS' });
let browser, context, page, server, stage = 'build-and-start';
const problems = [];
const forbidden = async () => { report.fixtureAdapterCalls++; throw new Error('MODEL_FORBIDDEN'); };
try {
  const catalog = await readJson(resolve(harnessRoot, 'examples/modern-navigation.catalog.json'));
  const planning = await createPlanningContext(formRequest, catalog), intent = formIntent(planning);
  intent.panel.themeKey = `${catalog.themes[0].id}@${catalog.themes[0].version}`;
  intent.panel.body.children[0].rows[1].recipeKey = 'settings.button.primary@0.1.0';
  intent.panel.body.children[0].rows[2].recipeKey = 'settings.button.secondary@0.1.0';
  const proposal = await materializePanelIntent(planning, intent), core = await loadWorkspaceCore();
  const bundle = await createPanelBundle(proposal.spec, catalog, core);
  await writeNewJson(output, 'fixture.panel.bundle.json', bundle);
  const probe = createServer(); await listenLoopback(probe, 0); const port = probe.address().port;
  await new Promise(done => probe.close(done));
  const options = { ...parseStudioArguments([]), port };
  const start = async custom => launchStudio({ ...options, ...custom }, { serve: async args => {
    const result = await createWorkbenchServer({ ...args, planner: forbidden, editor: forbidden });
    report.builds.push({ workbench: args.workbench.replace(harnessRoot, '').replaceAll('\\', '/'), ...result.studio });
    return result;
  } });
  server = await start(); const url = server.url, firstBuild = server.studio.buildSha256;
  const { chromium } = await loadWorkspaceTool('@playwright/test');
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  page = await context.newPage(); page.on('pageerror', error => problems.push(error.message));
  page.on('console', entry => { if (entry.type() === 'error') problems.push(entry.text()); });
  await page.route('**/*', route => {
    const request = route.request(), target = new URL(request.url());
    if (target.pathname === '/api/panel/plan' || target.pathname === '/api/panel/edit') { report.modelRequests++; return route.abort(); }
    if (target.protocol.startsWith('http') && target.origin !== new URL(url).origin) { problems.push('EXTERNAL_REQUEST'); return route.abort(); }
    return route.continue();
  });
  const idle = () => page.waitForFunction(() => window.panelWorkbench?.snapshot() && !window.panelWorkbench.busy);
  const snapshot = () => page.evaluate(() => window.panelWorkbench.snapshot());
  const state = () => page.evaluate(() => window.panelWorkbench.getState());
  const menu = async () => { if (!await page.locator('#panel-menu').evaluate(n => n.open)) await page.locator('#panel-menu > summary').click(); };
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('ui-panel-studio.workspace.v1')));
  await page.goto(url); await idle();
  await page.waitForFunction(() => document.getElementById('model-status').textContent.includes('gpt-6-luna'));
  assert.equal(await page.locator('#studio-version').getAttribute('data-build'), firstBuild);
  assert.equal(await page.locator('textarea:visible').count(), 2); pass(stage);

  stage = 'same-address-open-play-and-edit-without-model';
  await menu(); await page.locator('#panel-file').setInputFiles(resolve(output, 'fixture.panel.bundle.json')); await idle();
  await page.waitForFunction(() => Boolean(window.panelWorkbench.snapshot().panel));
  await page.locator('#canvas-host canvas').scrollIntoViewIfNeeded();
  const position = await page.evaluate(() => {
    const w = window.panelWorkbench, b = w.snapshot().panel, r = b.spec.sections[0].rows.find(r => r.kind === 'input');
    const n = w.inspect().nodes.find(n => n.id === `${b.spec.id}.row.${r.id}.control`);
    const c = document.querySelector('#canvas-host canvas').getBoundingClientRect();
    return { x: c.x + (n.bounds.x + n.bounds.width / 2) * c.width / b.spec.canvas.width,
      y: c.y + (n.bounds.y + n.bounds.height / 2) * c.height / b.spec.canvas.height };
  });
  await page.mouse.click(position.x, position.y); await page.keyboard.insertText('青莓');
  const field = bundle.spec.sections[0].rows.find(r => r.kind === 'input').bind;
  assert.equal((await state())[field], '青莓');
  await menu(); await page.locator('#advanced-tools').click();
  await page.locator('#edit-title').fill('重启验收'); await page.locator('#apply-edit').click(); await idle();
  assert.equal((await snapshot()).panel.spec.title, '重启验收');
  assert.match(await page.locator('#edit-rounds').textContent(), /1 \/ 10/);
  await page.locator('#advanced-tools').click();
  await page.locator('#request-text').fill('生成角色命名界面，稍后继续填写需求。');
  await page.locator('#edit-request-text').fill('把确认按钮改成蓝色，其余保持不变。');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('ui-panel-studio.workspace.v1')).draft.editText.includes('蓝色'));
  const before = await snapshot(), values = await state(), workspace = await saved(); pass(stage);

  stage = 'fixed-origin-restart-restores-drafts-panel-live-values-and-rounds';
  await server.close(); server = await start(); assert.equal(server.url, url); assert.equal(server.studio.buildSha256, firstBuild);
  await page.reload(); await idle(); await page.waitForFunction(() => Boolean(window.panelWorkbench.snapshot().panel));
  assert.deepEqual((await snapshot()).panel.spec, before.panel.spec); assert.deepEqual(await state(), values);
  assert.equal(await page.locator('#request-text').inputValue(), workspace.draft.text);
  assert.equal(await page.locator('#edit-request-text').inputValue(), workspace.draft.editText);
  assert.deepEqual((await saved()).editUsage, workspace.editUsage);
  assert.match(await page.locator('#edit-rounds').textContent(), /1 \/ 10/); pass(stage);

  stage = 'occupied-fixed-port-keeps-current-server-and-storage';
  await assert.rejects(start(), { code: 'STUDIO_PORT_IN_USE' });
  assert.equal((await fetch(`${url}api/panel/studio`)).status, 200);
  assert.deepEqual((await saved()).editUsage, workspace.editUsage); pass(stage);

  stage = 'updated-build-blocks-model-actions-until-save-and-refresh';
  const changedCatalog = structuredClone(catalog); changedCatalog.version = '0.7.1';
  await writeNewJson(output, 'upgrade-fixture.catalog.json', changedCatalog);
  await server.close(); server = await start({ catalog: resolve(output, 'upgrade-fixture.catalog.json') });
  assert.equal(server.url, url); assert.notEqual(server.studio.buildSha256, firstBuild);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.locator('#studio-update').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#generate-plan').isDisabled(), true); assert.equal(await page.locator('#generate-edit').isDisabled(), true);
  assert.deepEqual(await state(), values);
  await page.locator('#refresh-studio').click(); await idle();
  await page.waitForFunction(build => document.getElementById('studio-version').dataset.build === build, server.studio.buildSha256);
  await page.waitForFunction(() => Boolean(window.panelWorkbench.snapshot().panel));
  assert.deepEqual((await snapshot()).panel.spec, before.panel.spec); assert.deepEqual(await state(), values);
  assert.equal(await page.locator('#edit-request-text').inputValue(), workspace.draft.editText);
  assert.deepEqual((await saved()).editUsage, workspace.editUsage); pass(stage);

  stage = 'refresh-save-failure-retains-unsaved-text-and-current-preview';
  await page.route('**/api/panel/studio', route => route.fulfill({ json: { protocol: '0.1', kind: 'ui-panel-studio', build: { ...server.studio, buildSha256: 'e'.repeat(64) } } }));
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await page.locator('#studio-update').waitFor({ state: 'visible' });
  await page.evaluate(() => { window.originalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new DOMException('fixture full', 'QuotaExceededError'); }; });
  await page.locator('#request-text').fill('尚未保存的需求必须保留'); await page.locator('#refresh-studio').click();
  await page.locator('#studio-update-error').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#request-text').inputValue(), '尚未保存的需求必须保留'); assert.deepEqual(await state(), values);
  await page.evaluate(() => { Storage.prototype.setItem = window.originalSetItem; });
  await page.unroute('**/api/panel/studio'); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.locator('#studio-update').waitFor({ state: 'hidden' }); pass(stage);

  stage = 'export-after-upgrade-preserves-authored-spec-and-played-values';
  await menu(); const downloadReady = page.waitForEvent('download'); await page.locator('#download-panel').click();
  const download = await downloadReady, path = resolve(output, 'downloaded.panel.bundle.json'); await download.saveAs(path);
  const downloaded = await validatePanelBundle(JSON.parse(await readFile(path, 'utf8')), core);
  assert.deepEqual(downloaded.spec, before.panel.spec); assert.deepEqual(downloaded.state, values); pass(stage);

  stage = 'desktop-and-mobile-version-label-without-horizontal-overflow';
  await page.screenshot({ path: resolve(output, 'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.locator('#studio-version').isVisible(), true);
  await page.screenshot({ path: resolve(output, 'mobile.png'), fullPage: true }); pass(stage);
  assert.deepEqual(problems, []); assert.equal(report.modelRequests, 0); assert.equal(report.fixtureAdapterCalls, 0);
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.failure = { stage, code: error.code ?? error.name, message: String(error.message).slice(0, 1000) };
  if (page) await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await context?.close().catch(() => {}); await browser?.close().catch(() => {}); await server?.close().catch(() => {});
  report.browserErrors = problems; await writeNewJson(output, 'browser-report.json', report);
  process.stdout.write(`${JSON.stringify({ status: report.status, checks: report.checks.length, failedStage: report.failure?.stage ?? null, modelCalls: 0 })}\n`);
}
