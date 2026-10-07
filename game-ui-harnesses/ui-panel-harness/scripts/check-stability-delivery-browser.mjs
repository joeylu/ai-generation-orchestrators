#!/usr/bin/env node
/** Fixture or saved-real-bundle QA. Imports only; all POST/external requests blocked. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadWorkspaceTool } from './lib/workspace-tools.mjs';
const { chromium } = await loadWorkspaceTool('@playwright/test');
import { createWorkbenchServer } from '../src/workbench-server.mjs';
import { readJson, writeNewJson, createOutputDirectory } from '../src/io.mjs';
import { digestBytes } from '../src/canonical.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { validatePanelBundle } from '../src/panel-bundle.mjs';
import { readPanelEvaluationRun } from '../src/panel-evaluation-io.mjs';
import { evaluatePanelSemantics } from '../src/panel-evaluation.mjs';
import { controlId } from '../src/compiler.mjs';
import { readStoredZip } from '../tests/unity-kit-helpers.mjs';
const options = {}, args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) { assert(['--prepared', '--workbench', '--output', '--mode', '--run'].includes(args[i]) && args[i + 1] && !options[args[i]]); options[args[i]] = args[i + 1]; }
assert(options['--prepared'] && options['--workbench'] && options['--output']); assert(['fixture', 'real'].includes(options['--mode']));
assert.equal(Boolean(options['--run']), options['--mode'] === 'real');
const output = await createOutputDirectory(options['--output']), core = await loadWorkspaceCore();
const suite = await readJson(resolve(options['--prepared'], 'suite.json')); assert.equal(suite.cases.length, 16);
const report = { stabilityDeliveryBrowserVersion: '0.1', status: 'RUNNING', mode: options['--mode'], modelCalls: 0, blockedComputeRequests: 0,
  imports: 0, checks: [], deliveries: [], nativeEngines: 'NOT_RUN', humanVisualReview: 'NOT_RUN',
  scope: 'Imported program fixtures or accepted real bundles; all authored interactions, tabs, resets, actual ZIP download/offline/reimport. No generation/edit clicks.' };
let server, browser, lastPage, stage = 'source';
const pass = (id, name) => report.checks.push({ id, name, status: 'PASS' });
try {
  const genuine = options['--mode'] === 'real' ? await readPanelEvaluationRun(options['--run'], core) : null;
  if (genuine) { assert.equal(genuine.report.status, 'PASS_BEFORE_BROWSER'); assert.deepEqual(genuine.suite, suite); assert.equal(genuine.bundles.size, 16); report.planSha256 = genuine.plan.sha256; }
  const fixtures = genuine ? null : await readJson(resolve(options['--prepared'], 'fixture-validation.json'));
  if (fixtures) { assert.equal(fixtures.status, 'FIXTURE_PASS'); assert.equal(fixtures.modelCalls, 0); assert.equal(fixtures.cases.length, 16); assert.equal(fixtures.compositions.length, 5); }
  const items = [...suite.cases, ...(fixtures ? fixtures.compositions.map(item => ({ id: item.id, composition: true })) : [])];
  server = await createWorkbenchServer({ workbench: options['--workbench'], outputRoot: resolve(output, 'forbidden-model-calls'), port: 0,
    planner: async () => { throw new Error('MODEL_FORBIDDEN'); }, editor: async () => { throw new Error('MODEL_FORBIDDEN'); } });
  browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], proxy: { server: 'http://127.0.0.1:1', bypass: '127.0.0.1' } });
  for (const item of items) {
    const source = genuine ? genuine.bundles.get(item.id) : await validatePanelBundle(await readJson(resolve(options['--prepared'], item.composition ? 'fixture-compositions' : 'fixture-bundles', `${item.id}.panel.bundle.json`)), core);
    assert(source);
    if (fixtures) { const record = (item.composition ? fixtures.compositions : fixtures.cases).find(value => value.id === item.id); assert.equal(record.status, 'PASS'); assert.equal(record.fixtureBundleSha256, source.sha256); }
    if (!item.composition) assert.equal(evaluatePanelSemantics(source.spec, item.expected).status, 'PASS');
    const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, acceptDownloads: true, serviceWorkers: 'block' }), errors = [];
    const origin = new URL(server.url).origin;
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() !== 'GET') { report.blockedComputeRequests++; return route.abort(); }
      if (url.origin === origin || ['file:', 'blob:', 'data:'].includes(url.protocol)) return route.continue(); errors.push('EXTERNAL_REQUEST'); return route.abort();
    });
    const page = await context.newPage(); lastPage = page; page.setDefaultTimeout(25000); page.on('pageerror', () => errors.push('PAGE_ERROR'));
    const idle = () => page.waitForFunction(() => window.panelWorkbench?.snapshot() && !window.panelWorkbench.busy);
    const values = () => page.evaluate(() => window.panelWorkbench.getState());
    const inspect = () => page.evaluate(() => window.panelWorkbench.inspect());
    const menu = async () => { if (!await page.locator('#panel-menu').evaluate(node => node.open)) await page.locator('#panel-menu > summary').click(); };
    let offline;
    try {
      stage = `${item.id}:import`; await page.goto(server.url); await idle(); await menu();
      await page.locator('#panel-file').setInputFiles({ name: 'panel.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) }); await idle();
      assert.deepEqual((await page.evaluate(() => window.panelWorkbench.snapshot())).panel, source); report.imports++; pass(item.id, 'exact-bundle-visible-import');
      const spec = source.spec, rows = spec.sections.flatMap(section => section.rows), canvas = page.locator('#canvas-host canvas'); assert(await canvas.isVisible());
      const focus = async id => { await canvas.scrollIntoViewIfNeeded(); await canvas.focus(); for (let n = 0; n < 160; n++) {
        if (await canvas.getAttribute('data-focused-component') === controlId(spec.id, id)) return; await page.keyboard.press('Tab');
      } throw new Error('FOCUS_UNREACHABLE'); };
      const choose = async index => {
        const tabs = (await inspect()).nodes.find(node => node.type === 'Tabs'); assert(tabs); await canvas.scrollIntoViewIfNeeded(); const box = await canvas.boundingBox();
        await page.mouse.click(box.x + (tabs.bounds.x + (index + .5) * tabs.bounds.width / spec.tabs.pages.length) * box.width / spec.canvas.width,
          box.y + (tabs.bounds.y + 24) * box.height / spec.canvas.height);
        assert.equal((await values())[spec.tabs.bind], spec.tabs.pages[index].id);
      };
      for (const row of rows) {
        stage = `${item.id}:row:${row.id}`;
        if (spec.tabs) { const section = spec.sections.find(section => section.rows.some(value => value.id === row.id)); await choose(spec.tabs.pages.findIndex(page => page.sections.includes(section.id))); }
        const field = spec.state.find(field => field.id === row.bind), before = await values(), wanted = { ...before };
        const eventCount = await page.evaluate(() => window.panelWorkbench.events().length);
        const visible = (await inspect()).nodes.find(node => node.id === controlId(spec.id, row.id)); assert(visible?.visible);
        if (row.kind === 'text') { pass(item.id, `row:${row.id}:read-only`); continue; }
        if (!row.enabled && row.kind !== 'progress') {
          assert.equal(visible.enabled, false); await canvas.scrollIntoViewIfNeeded(); let current = visible;
          for (let n = 0; n < 6; n++) {
            const nodes = (await inspect()).nodes, view = nodes.find(node => node.type === 'ScrollView'); current = nodes.find(node => node.id === visible.id);
            if (!view || current.bounds.y >= view.bounds.y && current.bounds.y + current.bounds.height <= view.bounds.y + view.bounds.height) break;
            const box = await canvas.boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + (view.bounds.y + 20) * box.height / spec.canvas.height);
            await page.mouse.wheel(0, current.bounds.y - view.bounds.y - 8); await page.waitForTimeout(50);
          }
          const view = (await inspect()).nodes.find(node => node.type === 'ScrollView');
          assert(!view || current.bounds.y >= view.bounds.y - 1 && current.bounds.y + current.bounds.height <= view.bounds.y + view.bounds.height + 1);
          const box = await canvas.boundingBox();
          await page.mouse.click(box.x + (current.bounds.x + current.bounds.width / 2) * box.width / spec.canvas.width,
            box.y + (current.bounds.y + current.bounds.height / 2) * box.height / spec.canvas.height);
          assert.deepEqual(await values(), before); assert.equal(await page.evaluate(() => window.panelWorkbench.events().length), eventCount);
          pass(item.id, `row:${row.id}:disabled-no-state-or-event-change`); continue;
        }
        if (row.kind === 'progress') {
          const value = field.max * .376123456789; await page.evaluate(({ id, value }) => window.panelHost.setProgress(id, value), { id: row.bind, value });
          wanted[row.bind] = value; assert.deepEqual(await values(), wanted); pass(item.id, 'host-progress-retains-exact-value'); continue;
        }
        assert(row.enabled); await focus(row.id);
        if (row.kind === 'slider') { const end = before[row.bind] !== field.max; await page.keyboard.press(end ? 'End' : 'Home'); wanted[row.bind] = end ? field.max : field.min; }
        else if (row.kind === 'switch') { await page.keyboard.press('Enter'); wanted[row.bind] = !before[row.bind]; }
        else if (row.kind === 'select') {
          await page.keyboard.press('Enter'); const end = before[row.bind] !== field.options.at(-1).id; await page.keyboard.press(end ? 'End' : 'Home'); await page.keyboard.press('Escape'); wanted[row.bind] = end ? field.options.at(-1).id : field.options[0].id;
        } else { await page.keyboard.press('Enter'); for (const id of row.action.fields ?? []) wanted[id] = spec.state.find(field => field.id === id).initial; }
        assert.deepEqual(await values(), wanted);
        const events = await page.evaluate(() => window.panelWorkbench.events()); assert(events.length > eventCount); assert.equal(events.at(-1).name, row.event);
        pass(item.id, `row:${row.id}:${row.kind}`);
      }
      if (spec.tabs) {
        stage = `${item.id}:cross-page-reset`; await choose(0);
        const before = await values(), reset = rows.find(row => row.action?.kind === 'reset-initial'), wanted = { ...before };
        await focus(reset.id); await page.keyboard.press('Enter'); for (const id of reset.action.fields) wanted[id] = spec.state.find(field => field.id === id).initial;
        assert.deepEqual(await values(), wanted); pass(item.id, 'reset-retains-other-page-values');
        await focus(spec.tabs.id); await page.keyboard.press('End'); wanted[spec.tabs.bind] = spec.tabs.pages.at(-1).id; assert.deepEqual(await values(), wanted);
        const nodes = (await inspect()).nodes; assert(!nodes.find(node => node.id === controlId(spec.id, rows[0].id)).visible); pass(item.id, 'keyboard-tab-navigation-preserves-state-and-hides-inactive-controls');
      }
      stage = `${item.id}:delivery`; const played = await values(); await menu(); const waiting = page.waitForEvent('download'); await page.locator('#download-delivery').click(); await idle();
      const download = await waiting; assert.equal(await download.failure(), null); const zip = `${item.id}.panel-delivery.zip`; await download.saveAs(resolve(output, zip));
      const bytes = await readFile(resolve(output, zip)), files = readStoredZip(bytes), manifest = JSON.parse(files.get('delivery-manifest.json'));
      assert.equal(manifest.status, 'COMPLETE'); assert.equal(files.size, manifest.files.length + 1);
      for (const file of manifest.files) { assert.equal(files.get(file.path).length, file.bytes); assert.equal(await digestBytes(files.get(file.path)), file.sha256); }
      const delivered = await validatePanelBundle(JSON.parse(files.get('pixi/panel.bundle.json')), core); assert.deepEqual(delivered.spec, spec); assert.deepEqual(delivered.state, played);
      assert.deepEqual(JSON.parse(files.get('unity/panel.bundle.json')), delivered); assert.equal(manifest.panelSha256, delivered.sha256); assert.equal(manifest.verification.unityImport, 'NOT_RUN'); pass(item.id, 'actual-zip-crc-digests-and-shared-source');
      const extracted = await createOutputDirectory(resolve(output, `${item.id}-delivery`));
      for (const [path, content] of files) { assert(/^[A-Za-z0-9._/-]+$/.test(path) && !path.split('/').some(part => ['', '.', '..'].includes(part))); const target = resolve(extracted, path); assert(!relative(extracted, target).startsWith('..')); await mkdir(dirname(target), { recursive: true }); await writeFile(target, content, { flag: 'wx' }); }
      offline = await browser.newContext({ viewport: { width: 1280, height: 960 }, serviceWorkers: 'block' }); await offline.setOffline(true);
      await offline.route('**/*', route => ['file:', 'blob:', 'data:'].includes(new URL(route.request().url()).protocol) ? route.continue() : route.abort());
      const offlinePage = await offline.newPage(); offlinePage.on('pageerror', () => errors.push('OFFLINE_PAGE_ERROR')); await offlinePage.goto(pathToFileURL(resolve(extracted, 'pixi/index.html')).href);
      await offlinePage.waitForFunction(() => ['ready', 'error'].includes(document.getElementById('status').dataset.state)); assert.equal(await offlinePage.locator('#status').getAttribute('data-state'), 'ready');
      assert.deepEqual(await offlinePage.evaluate(() => window.panelDelivery.getState()), played); pass(item.id, 'actual-delivery-opens-offline');
      await page.locator('#panel-file').setInputFiles(resolve(extracted, 'pixi/panel.bundle.json')); await idle(); assert.deepEqual(await values(), played); pass(item.id, 'delivery-reimport-preserves-played-state');
      await page.setViewportSize({ width: 390, height: 844 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); pass(item.id, 'narrow-page-no-horizontal-overflow');
      assert.deepEqual(errors, []); pass(item.id, 'no-browser-error-or-external-request'); await page.screenshot({ path: resolve(output, `${item.id}.png`), fullPage: true });
      report.deliveries.push({ id: item.id, zip, zipSha256: await digestBytes(bytes), sourceBundleSha256: source.sha256, deliveredBundleSha256: delivered.sha256, unityImport: 'NOT_RUN' });
    } finally { await offline?.close(); await context.close(); lastPage = null; }
  }
  assert.equal(report.imports, items.length); assert.equal(report.deliveries.length, items.length); assert.equal(report.blockedComputeRequests, 0);
  report.individuals = suite.cases.length; report.fixtureCompositions = fixtures?.compositions.length ?? 0; report.status = 'PASS';
} catch (error) { report.status = 'FAIL'; report.failure = { stage, code: error.code ?? error.name }; process.exitCode = 1; await lastPage?.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => {}); }
finally { await browser?.close(); await server?.close(); await writeNewJson(output, 'browser-report.json', report); console.log(JSON.stringify({ status: report.status, mode: report.mode, checks: report.checks.length, imports: report.imports, modelCalls: 0, failure: report.failure ?? null })); }
