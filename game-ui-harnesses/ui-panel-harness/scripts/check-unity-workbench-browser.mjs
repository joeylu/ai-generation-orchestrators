#!/usr/bin/env node
/** Actual offline/browser downloads. No model, Unity process, or server invocation. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '../../ui-component-harness/node_modules/@playwright/test/index.mjs';
import { createOutputDirectory, harnessRoot, readJson, writeNewJson } from '../src/io.mjs';
import { digestBytes } from '../src/canonical.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { createPanelBundle, validatePanelBundle } from '../src/panel-bundle.mjs';
import { createUnityDocument } from '../src/unity-export.mjs';
import { exportUnityKit } from '../src/unity-export-io.mjs';
import { controlId } from '../src/compiler.mjs';
import { readStoredZip } from '../tests/unity-kit-helpers.mjs';

const options = {}, args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 2) {
  assert(['--workbench', '--output'].includes(args[index]) && args[index + 1] && !options[args[index]], 'Expected unique --workbench / --output');
  options[args[index]] = args[index + 1];
}
assert.equal(Object.keys(options).length, 2);
const directory = await createOutputDirectory(options['--output']);
const report = { unityWorkbenchBrowserVersion: '0.1', status: 'RUNNING', checks: [], screenshots: [], providerCalls: 0,
  nativeEngines: 'NOT_RUN', humanVisualReview: 'NOT_RUN',
  scope: 'Real Pixi and visible upload/edit/download UI on offline file and routed local HTTP pages; deterministic fixtures only.' };
const pass = (name, evidence = {}) => report.checks.push({ name, status: 'PASS', ...evidence });
const problems = [], contexts = [], origin = 'http://127.0.0.1:4183';
let browser, context, page, stage = 'validate-static-build', downloadCount = 0;
try {
  const core = await loadWorkspaceCore(), manifest = await readJson(resolve(options['--workbench'], 'workbench-build.json'));
  assert.equal(manifest.status, 'COMPLETE');
  const staticFiles = new Map();
  for (const file of manifest.files) {
    const bytes = await readFile(resolve(options['--workbench'], file.path));
    assert.equal(bytes.length, file.bytes); assert.equal(await digestBytes(bytes), file.sha256);
    staticFiles.set(`/${file.path}`, bytes);
  }
  assert.deepEqual([...staticFiles.keys()].sort(), ['/index.html', '/workbench.js']);
  report.build = manifest; pass(stage);
  browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  report.browser = { channel: 'msedge', version: browser.version() };
  const idle = () => page.waitForFunction(() => window.panelWorkbench?.snapshot() && !window.panelWorkbench.busy);
  const snapshot = () => page.evaluate(() => window.panelWorkbench.snapshot());
  const state = () => page.evaluate(() => window.panelWorkbench.getState());
  const events = () => page.evaluate(() => window.panelWorkbench.events());
  const click = async selector => { await page.locator(selector).click(); await idle(); };
  const upload = async (name, bundle) => {
    const path = resolve(directory, name); await writeFile(path, JSON.stringify(bundle));
    await page.locator('#panel-file').setInputFiles(path); await idle();
  };
  const screenshot = async name => { await page.screenshot({ path: resolve(directory, name), fullPage: true }); report.screenshots.push(name); };
  const healthy = async () => {
    assert.deepEqual(problems, []);
    assert.equal((await page.locator('#preview-error').textContent()).trim(), '');
  };
  const open = async scheme => {
    context = await browser.newContext({ viewport: { width: 1560, height: 1100 }, serviceWorkers: 'block', acceptDownloads: true });
    contexts.push(context); if (scheme === 'file') await context.setOffline(true);
    const fileUrls = new Set([...staticFiles.keys()].map(path => pathToFileURL(resolve(options['--workbench'], path.slice(1))).href));
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (scheme === 'http' && request.method() === 'GET' && url.origin === origin && !url.search) {
        if (url.pathname === '/api/panel/capabilities') return route.fulfill({ contentType: 'application/json',
          body: JSON.stringify({ protocol: '0.1', model: 'gpt-6-luna', effort: 'xhigh', available: false }) });
        if (staticFiles.has(url.pathname)) return route.fulfill({ body: staticFiles.get(url.pathname),
          contentType: url.pathname.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8' });
      }
      if (['blob:', 'data:'].includes(url.protocol) || (scheme === 'file' && request.method() === 'GET' && fileUrls.has(url.href))) return route.continue();
      problems.push('Unexpected model/network/unlisted file request'); return route.abort();
    });
    await context.addInitScript(() => {
      window.unityBusySamples = [];
      new MutationObserver(() => {
        if (document.body?.classList.contains('busy')) window.unityBusySamples.push({
          disabled: document.getElementById('download-unity')?.disabled,
          previewLocked: document.getElementById('canvas-host')?.inert,
        });
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class', 'disabled', 'inert'] });
    });
    page = await context.newPage(); page.setDefaultTimeout(30000);
    page.on('pageerror', () => problems.push('Uncaught browser exception'));
    page.on('console', entry => { if (entry.type() === 'error') problems.push('Browser console error'); });
    page.on('download', () => downloadCount++);
    await page.goto(`${scheme === 'file' ? pathToFileURL(resolve(options['--workbench'], 'index.html')).href : `${origin}/index.html`}#advanced`);
    await idle();
  };
  const downloadKit = async name => {
    const before = await snapshot(), values = await state(), priorEvents = await events();
    const waiting = page.waitForEvent('download'); await page.locator('#download-unity').click();
    const downloaded = await waiting; assert.equal(await downloaded.failure(), null);
    assert.equal(downloaded.suggestedFilename(), `${before.panel.spec.id}.unity-kit.zip`);
    const target = resolve(directory, `${name}.zip`); await downloaded.saveAs(target); await idle();
    const bytes = await readFile(target), files = readStoredZip(bytes);
    const saved = await validatePanelBundle(JSON.parse(files.get('panel.bundle.json')), core);
    assert.deepEqual(saved.spec, before.panel.spec); assert.deepEqual(saved.state, values);
    assert.deepEqual(await state(), values); assert.deepEqual(await events(), priorEvents);
    assert.deepEqual(await snapshot(), before, 'Export must preserve model, history and planning context');
    const native = JSON.parse(files.get('panel.unity.json')), evidence = JSON.parse(files.get('export-manifest.json'));
    assert.deepEqual(native, await createUnityDocument(saved, core));
    assert.equal(evidence.verification.unityImport, 'NOT_RUN'); assert.equal(evidence.verification.nativeInteraction, 'NOT_RUN');
    assert.equal(evidence.verification.humanVisualReview, 'NOT_RUN');
    assert.equal(files.size, evidence.files.length + 1);
    const cliOutput = resolve(directory, `${name}-cli-kit`); await exportUnityKit(saved, core, cliOutput);
    for (const [path, content] of files) assert.deepEqual(content, await readFile(resolve(cliOutput, path)), `Browser/CLI byte parity: ${path}`);
    for (const file of evidence.files) {
      assert.equal(files.get(file.path).length, file.bytes); assert.equal(await digestBytes(files.get(file.path)), file.sha256);
    }
    assert(![...files.keys()].some(path => /Tests|Smoke|TestFont|\.unitypackage$/.test(path)));
    const busy = await page.evaluate(() => window.unityBusySamples);
    assert(busy.length && busy.every(sample => sample.disabled && sample.previewLocked));
    assert.match(await page.locator('#unity-export-status').textContent(), /已下载/u);
    await healthy();
    return { saved, native, files, zipSha256: await digestBytes(bytes), zipBytes: bytes.length };
  };

  stage = 'empty-workbench-disables-unity-download'; await open('file');
  assert.equal(await page.locator('#download-unity').isDisabled(), true); pass(stage);
  stage = 'offline-example-download-preserves-actual-trial-value'; await click('#example');
  const original = await snapshot(), spec = original.panel.spec, row = spec.sections.flatMap(s => s.rows).find(row => row.kind === 'slider');
  const node = (await page.evaluate(() => window.panelWorkbench.inspect())).nodes.find(node => node.id === controlId(spec.id, row.id));
  const canvas = page.locator('#canvas-host canvas'); await canvas.scrollIntoViewIfNeeded(); const box = await canvas.boundingBox();
  const field = spec.state.find(field => field.id === row.bind), trial = 21;
  await page.mouse.click(box.x + (node.bounds.x + 14 + (trial - field.min) / (field.max - field.min) * (node.bounds.width - 28)) * box.width / spec.canvas.width,
    box.y + (node.bounds.y + node.bounds.height / 2) * box.height / spec.canvas.height);
  assert.equal((await state())[row.bind], trial);
  const first = await downloadKit('offline-trial');
  assert.equal(first.native.fields.find(f => f.id === row.bind).initialNumber, field.initial);
  assert.equal(first.native.fields.find(f => f.id === row.bind).numberValue, trial);
  pass(stage, { zipSha256: first.zipSha256, zipBytes: first.zipBytes, current: trial, initial: field.initial });

  stage = 'repeated-download-is-byte-identical';
  const repeated = await downloadKit('offline-repeat'); assert.equal(repeated.zipSha256, first.zipSha256); pass(stage);
  stage = 'edited-title-and-authored-initial-export-with-current-state';
  await page.locator('#edit-title').fill('Unity 设置面板'); await page.locator('#edit-row').selectOption(row.id);
  await page.locator('#edit-initial').fill('65'); await click('#apply-edit');
  assert.equal((await state())[row.bind], trial);
  assert.equal(await page.locator('#unity-export-status').textContent(), '', 'A changed panel must clear the old download receipt');
  const edited = await downloadKit('edited'); assert.equal(edited.saved.spec.title, 'Unity 设置面板');
  assert.equal(edited.native.fields.find(f => f.id === row.bind).initialNumber, 65);
  assert.equal((await snapshot()).history.length, 1); await screenshot('unity-workbench-desktop.png'); pass(stage);
  stage = 'undo-restores-source-without-losing-unity-export'; await click('#undo');
  assert.equal(await page.locator('#unity-export-status').textContent(), '');
  const undone = await downloadKit('undone'); assert.deepEqual(undone.saved.spec, spec); pass(stage);

  stage = 'selected-png-and-asymmetric-nine-slice-survive-browser-zip';
  const imageBundle = await validatePanelBundle(await readJson(resolve(harnessRoot, 'output/unity-verification-source-v1/panel.bundle.json')), core);
  await upload('image-input.panel.bundle.json', imageBundle);
  const imageKit = await downloadKit('selected-image');
  assert.equal(imageKit.native.assets.length, 1); assert.equal(imageKit.native.nodes.filter(n => n.hasRegion).length, 9);
  const png = imageKit.native.assets[0]; assert.equal(await digestBytes(imageKit.files.get(png.path)), png.sha256); pass(stage);

  stage = 'unsupported-slider-rejects-download-and-preserves-model-and-trial-state';
  const precisionSpec = structuredClone(spec), precisionField = precisionSpec.state.find(f => f.id === row.bind);
  Object.assign(precisionField, { min: 0, max: 2, step: 0.000001, initial: 0 });
  const precision = await createPanelBundle(precisionSpec, original.panel.catalog, core);
  await upload('unsupported-precision.panel.bundle.json', precision);
  const beforeFailure = await snapshot(), failureState = await state(), downloads = downloadCount;
  await click('#download-unity');
  assert.match(await page.locator('#preview-error').textContent(), /一百万/u);
  assert.deepEqual(await snapshot(), beforeFailure); assert.deepEqual(await state(), failureState);
  assert.equal(downloadCount, downloads); assert.equal(await page.locator('#download-unity').isDisabled(), false); pass(stage);
  stage = 'ordinary-export-still-works-after-native-export-rejection';
  const waiting = page.waitForEvent('download'); await page.locator('#download-panel').click();
  const ordinary = await waiting; const ordinaryPath = resolve(directory, 'after-rejection.panel.bundle.json');
  await ordinary.saveAs(ordinaryPath); await idle();
  assert.deepEqual((await validatePanelBundle(await readJson(ordinaryPath), core)).state, failureState); await healthy(); pass(stage);

  stage = 'stateless-menu-downloads-without-synthetic-business-fields';
  const pause = await validatePanelBundle(await readJson(resolve(harnessRoot, 'output/layout-v2/pause/panel.bundle.json')), core);
  await upload('pause-input.panel.bundle.json', pause);
  const pauseKit = await downloadKit('stateless-menu'); assert.deepEqual(pauseKit.native.fields, []); assert.deepEqual(pauseKit.saved.state, {}); pass(stage);
  stage = 'mobile-unity-button-remains-visible-without-horizontal-overflow';
  await page.setViewportSize({ width: 375, height: 900 });
  assert.equal(await page.locator('#download-unity').isVisible(), true);
  const widths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, width: document.documentElement.scrollWidth }));
  assert(widths.width <= widths.viewport + 1); await screenshot('unity-workbench-mobile.png'); pass(stage);

  stage = 'context-loss-disables-unity-download-and-reopen-recovers';
  assert(await canvas.evaluate(element => {
    const gl = element.getContext('webgl2') ?? element.getContext('webgl'), fault = gl?.getExtension('WEBGL_lose_context');
    if (!fault) return false; fault.loseContext(); return true;
  }));
  await page.waitForFunction(() => document.getElementById('download-unity').disabled);
  await upload('recovery.panel.bundle.json', pause); assert.equal(await page.locator('#download-unity').isDisabled(), false);
  await downloadKit('recovered'); pass(stage);

  stage = 'local-http-workbench-download-needs-no-server-export-endpoint';
  await open('http'); await click('#example');
  const http = await downloadKit('local-http'); assert.deepEqual(http.saved.spec, spec); pass(stage, { endpointCalls: 0 });
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.failure = { stage, code: error.code ?? error.name ?? 'ACCEPTANCE_FAILED', message: String(error.message).slice(0, 1200) };
  if (page) try {
    await page.screenshot({ path: resolve(directory, 'failure.png'), fullPage: true }); report.screenshots.push('failure.png');
  } catch {}
  process.exitCode = 1;
} finally {
  report.browserProblems = problems;
  for (const item of contexts) await item.close().catch(() => {});
  await browser?.close().catch(() => {});
  await writeNewJson(directory, 'unity-workbench-browser-report.json', report);
  process.stdout.write(`${JSON.stringify({ status: report.status, checks: report.checks.length, failure: report.failure ?? null })}\n`);
}
