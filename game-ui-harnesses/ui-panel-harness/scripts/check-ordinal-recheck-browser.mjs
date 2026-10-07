#!/usr/bin/env node
/** Replay exact saved real proposals in Studio and use actual downloaded delivery ZIPs. Zero model calls. */
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadWorkspaceTool } from './lib/workspace-tools.mjs';
const { chromium } = await loadWorkspaceTool('@playwright/test');
import { createWorkbenchServer } from '../src/workbench-server.mjs';
import { createOutputDirectory, readJson, writeNewJson } from '../src/io.mjs';
import { digestBytes, digestJson } from '../src/canonical.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { readPanelEvaluationRun } from '../src/panel-evaluation-io.mjs';
import { validatePanelBundle } from '../src/panel-bundle.mjs';
import { evaluatePanelSemantics } from '../src/panel-evaluation.mjs';
import { controlId } from '../src/compiler.mjs';
import { readStoredZip } from '../tests/unity-kit-helpers.mjs';

const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) {
  assert(['--run', '--workbench', '--output'].includes(args[i]) && args[i + 1] && !options[args[i]]);
  options[args[i]] = args[i + 1];
}
assert.equal(Object.keys(options).length, 3);
const directory = await createOutputDirectory(options['--output']);
const report = { ordinalRecheckBrowserVersion: '0.1', status: 'RUNNING', modelCalls: 0, replayCalls: 0,
  evidence: 'SAVED_REAL_PROPOSALS_REPLAY', checks: [], deliveries: [], screenshots: [],
  nativeEngines: 'NOT_RUN', humanVisualReview: 'NOT_RUN',
  scope: 'Visible Studio generation replays exact saved real proposals and original receipts; actual downloaded ZIPs run offline. No synthetic proposals or model invocation.' };
let browser, server, active, stage = 'validate-saved-source', lastPage;
const pass = (id, name) => report.checks.push({ id, name, status: 'PASS' });
try {
  const core = await loadWorkspaceCore(), run = await readPanelEvaluationRun(options['--run'], core);
  assert.equal(run.report.status, 'PASS_BEFORE_BROWSER'); assert.equal(run.cases.length, 3);
  report.planSha256 = run.plan.sha256; report.sourceReportSha256 = await digestJson(run.report);
  const saved = new Map();
  for (const item of run.cases) {
    const output = resolve(options['--run'], item.id);
    const names = (await readdir(output)).filter(name => /^codex-[a-f0-9-]{36}$/.test(name)); assert.equal(names.length, 1);
    const attempt = resolve(output, names[0]);
    saved.set(item.id, { item, context: await readJson(resolve(attempt, 'planning-context.json')),
      proposal: await readJson(resolve(attempt, 'proposal.json')), report: await readJson(resolve(attempt, 'planning-report.json')), receipt: item.receipt });
  }
  server = await createWorkbenchServer({ workbench: options['--workbench'], outputRoot: resolve(directory, 'saved-response-replay'), port: 0,
    planner: async context => {
      assert(active && !active.used); const source = saved.get(active.id); assert(source);
      assert.deepEqual(context, source.context); active.used = true; report.replayCalls++;
      return { proposal: source.proposal, report: source.report, receipt: source.receipt };
    }, editor: async () => { throw new Error('UNEXPECTED_EDIT'); } });
  browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    proxy: { server: 'http://127.0.0.1:1', bypass: '127.0.0.1' } });
  const origin = new URL(server.url).origin;
  for (const item of run.suite.cases) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, acceptDownloads: true, serviceWorkers: 'block' });
    const errors = [], page = await context.newPage(); lastPage = page; page.setDefaultTimeout(25000);
    page.on('pageerror', () => errors.push('PAGE_ERROR'));
    await context.route(url => !['file:', 'blob:', 'data:'].includes(url.protocol) && url.origin !== origin,
      route => { errors.push('EXTERNAL_REQUEST'); return route.abort(); });
    let offline;
    const idle = () => page.waitForFunction(() => window.panelWorkbench?.snapshot() && !window.panelWorkbench.busy);
    try {
      stage = `${item.id}:visible-generate-saved-result`;
      active = { id: item.id, used: false }; await page.goto(server.url); await idle();
      await page.waitForFunction(() => document.getElementById('model-status').textContent.includes('gpt-6-luna'));
      await page.locator('#panel-menu > summary').click(); await page.locator('#advanced-tools').click();
      await page.locator('#request-id').locator('xpath=..').evaluate(node => { if (node.tagName === 'DETAILS') node.open = true; });
      await page.locator('#request-id').fill(item.id); await page.locator('#request-text').fill(item.request.text);
      await page.locator('#advanced-tools').click(); await page.locator('#generate-plan').click(); await idle(); assert(active.used);
      const source = run.bundles.get(item.id), bundle = (await page.evaluate(() => window.panelWorkbench.snapshot())).panel;
      assert.deepEqual(bundle, source); assert.equal(evaluatePanelSemantics(bundle.spec, item.expected).status, 'PASS'); pass(item.id, 'exact-real-proposal-visible-generation');
      const canvas = page.locator('#canvas-host canvas'); assert(await canvas.isVisible()); pass(item.id, 'real-pixi-canvas-visible');
      const rows = bundle.spec.sections.flatMap(section => section.rows), toggle = rows.find(row => row.kind === 'switch' && row.enabled);
      const reset = rows.find(row => row.action?.kind === 'reset-initial' && row.enabled);
      const focus = async id => {
        await canvas.scrollIntoViewIfNeeded(); await canvas.focus();
        for (let n = 0; n < 140; n++) { if (await canvas.getAttribute('data-focused-component') === controlId(bundle.spec.id, id)) return; await page.keyboard.press('Tab'); }
        throw new Error('FOCUS_UNREACHABLE');
      };
      if (toggle) {
        await focus(toggle.id); const before = (await page.evaluate(() => window.panelWorkbench.getState()))[toggle.bind];
        await page.keyboard.press('Enter'); assert.equal((await page.evaluate(() => window.panelWorkbench.getState()))[toggle.bind], !before);
        pass(item.id, 'keyboard-switch-changes-real-state');
      }
      if (reset) {
        await focus(reset.id); await page.keyboard.press('Enter'); const state = await page.evaluate(() => window.panelWorkbench.getState());
        for (const id of reset.action.fields) assert.equal(state[id], bundle.spec.state.find(field => field.id === id).initial);
        pass(item.id, 'real-reset-scope');
      }
      stage = `${item.id}:actual-download-zip`;
      const played = await page.evaluate(() => window.panelWorkbench.getState());
      if (!await page.locator('#panel-menu').evaluate(node => node.open)) await page.locator('#panel-menu > summary').click();
      const waiting = page.waitForEvent('download'); await page.locator('#download-delivery').click(); await idle();
      const download = await waiting; assert.equal(await download.failure(), null);
      const zipName = `${item.id}.panel-delivery.zip`; await download.saveAs(resolve(directory, zipName));
      const bytes = await readFile(resolve(directory, zipName)), files = readStoredZip(bytes);
      const manifest = JSON.parse(files.get('delivery-manifest.json')); assert.equal(manifest.status, 'COMPLETE');
      assert.equal(files.size, manifest.files.length + 1);
      for (const file of manifest.files) { assert.equal(files.get(file.path).length, file.bytes); assert.equal(await digestBytes(files.get(file.path)), file.sha256); }
      pass(item.id, 'downloaded-zip-crc-and-all-file-digests');
      const delivered = await validatePanelBundle(JSON.parse(files.get('pixi/panel.bundle.json')), core);
      assert.deepEqual(delivered.spec, bundle.spec); assert.deepEqual(delivered.state, played);
      assert.deepEqual(JSON.parse(files.get('unity/panel.bundle.json')), delivered); assert.equal(manifest.panelSha256, delivered.sha256);
      assert.equal(manifest.verification.unityImport, 'NOT_RUN'); assert.equal(manifest.verification.nativeInteraction, 'NOT_RUN');
      assert.equal(JSON.parse(files.get('integration-contract.json')).panelSha256, delivered.sha256);
      pass(item.id, 'pixi-unity-contract-share-exact-source-and-current-state');
      const extracted = await createOutputDirectory(resolve(directory, `${item.id}-delivery`));
      for (const [path, content] of files) {
        assert(/^[A-Za-z0-9._/-]+$/.test(path) && !path.split('/').some(part => ['', '.', '..'].includes(part)));
        const target = resolve(extracted, path); assert(!relative(extracted, target).startsWith('..'));
        await mkdir(dirname(target), { recursive: true }); await writeFile(target, content, { flag: 'wx' });
      }
      stage = `${item.id}:offline-delivery-open`;
      offline = await browser.newContext({ viewport: { width: 1280, height: 960 }, serviceWorkers: 'block' }); await offline.setOffline(true);
      await offline.route('**/*', route => ['file:', 'blob:', 'data:'].includes(new URL(route.request().url()).protocol) ? route.continue() : route.abort());
      const offlinePage = await offline.newPage(); offlinePage.on('pageerror', () => errors.push('OFFLINE_PAGE_ERROR'));
      await offlinePage.goto(pathToFileURL(resolve(extracted, 'pixi/index.html')).href);
      await offlinePage.waitForFunction(() => ['ready', 'error'].includes(document.getElementById('status').dataset.state));
      assert.equal(await offlinePage.locator('#status').getAttribute('data-state'), 'ready');
      assert.deepEqual(await offlinePage.evaluate(() => window.panelDelivery.getState()), played); pass(item.id, 'actual-delivery-runs-offline');
      stage = `${item.id}:studio-reimport`;
      await page.locator('#panel-file').setInputFiles(resolve(extracted, 'pixi/panel.bundle.json')); await idle();
      assert.deepEqual((await page.evaluate(() => window.panelWorkbench.snapshot())).panel.spec, bundle.spec);
      assert.deepEqual(await page.evaluate(() => window.panelWorkbench.getState()), played); pass(item.id, 'delivery-reimport-preserves-spec-and-played-state');
      await page.setViewportSize({ width: 390, height: 844 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      pass(item.id, 'narrow-page-no-horizontal-overflow'); assert.deepEqual(errors, []); pass(item.id, 'no-page-error-or-external-request');
      const screenshot = `${item.id}.png`; await page.screenshot({ path: resolve(directory, screenshot), fullPage: true }); report.screenshots.push(screenshot);
      report.deliveries.push({ id: item.id, zip: zipName, zipSha256: await digestBytes(bytes), panelSha256: delivered.sha256, files: files.size,
        sourceBundleSha256: source.sha256, unityImport: 'NOT_RUN', nativeInteraction: 'NOT_RUN' });
    } finally { await offline?.close(); await context.close(); lastPage = null; }
  }
  assert.equal(report.replayCalls, 3); assert.equal(report.deliveries.length, 3); report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.failure = { stage, code: error.code ?? error.name }; process.exitCode = 1;
  if (lastPage) await lastPage.screenshot({ path: resolve(directory, 'failure.png'), fullPage: true }).catch(() => {});
} finally {
  await browser?.close().catch(() => {}); await server?.close().catch(() => {});
  await writeNewJson(directory, 'browser-report.json', report);
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, replayCalls: report.replayCalls,
    deliveries: report.deliveries.length, modelCalls: 0, failure: report.failure ?? null }));
}
