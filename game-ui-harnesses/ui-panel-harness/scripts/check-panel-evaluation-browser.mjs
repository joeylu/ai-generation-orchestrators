#!/usr/bin/env node
/** Offline real Pixi acceptance of actual generated bundles. This script never calls a model. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '../../ui-component-harness/node_modules/@playwright/test/index.mjs';
import { createOutputDirectory, readJson, writeNewJson } from '../src/io.mjs';
import { digestBytes, digestJson } from '../src/canonical.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { validatePanelBundle } from '../src/panel-bundle.mjs';
import { controlId, initialPanelState } from '../src/compiler.mjs';
import { validatePanelComposition } from '../src/panel-composition.mjs';

const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) {
  assert(['--preview', '--run', '--output', '--mode'].includes(args[i]) && args[i + 1] && !options[args[i]], 'Expected preview, run and fresh output');
  options[args[i]] = args[i + 1];
}
assert(options['--preview'] && options['--run'] && options['--output']);
const composition = options['--mode'] === 'composition'; assert(!options['--mode'] || composition);
const directory = await createOutputDirectory(options['--output']);
const report = { panelEvaluationBrowserVersion: '0.1', status: 'RUNNING', planSha256: null, cases: [], totals: null,
  providerCalls: 0, automaticRetries: 0, nativeEngines: 'NOT_RUN', humanVisualReview: 'NOT_RUN',
  scope: 'All authored rows: real keyboard changes, button events/reset scope, disabled pointer clicks, scroll reveal, export and file reopen' };
let browser, stage = 'verify-preview-artifacts';
try {
  const manifest = await readJson(resolve(options['--preview'], composition ? 'composition-preview-build.json' : 'evaluation-preview-build.json'));
  const source = await readJson(resolve(options['--run'], 'evaluation-report.json'));
  assert.equal(manifest.status, 'COMPLETE'); assert.equal(manifest.sourceReportSha256, await digestJson(source));
  assert.equal(manifest.planSha256, source.planSha256); report.planSha256 = manifest.planSha256;
  if (composition) { assert.equal(manifest.panelCompositionPreviewVersion, '0.1'); assert.equal(manifest.modelCalls, 0); assert.equal(manifest.sourceCases.length, source.cases.length); }
  else assert.equal(manifest.cases.length, source.cases.length);
  assert(manifest.cases.length >= 1 && manifest.cases.length <= 64); report.mode = composition ? 'composition' : 'generation';
  for (const item of manifest.files) {
    assert(/^[A-Za-z0-9._-]+$/.test(item.path));
    assert.equal(await digestBytes(await readFile(resolve(options['--preview'], item.path))), item.sha256);
  }
  const core = await loadWorkspaceCore();
  browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  report.browser = { channel: 'msedge', version: browser.version(), graphics: 'software-WebGL', offline: true,
    pixiVersion: (await readJson(new URL('../../ui-component-harness/node_modules/pixi.js/package.json', import.meta.url))).version };
  for (const item of manifest.cases) {
    assert(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(item.id));
    if (item.previewFile) assert.equal(item.previewFile, `${item.id}.html`);
    const result = { id: item.id, title: item.title, status: item.previewFile ? 'RUNNING' : 'NOT_RUN',
      generation: item.model, semantic: item.semantic, compile: item.compile, checks: [], failedStage: null, failureCode: null,
      bundleSha256: item.bundleSha256, screenshot: null, exportSha256: null };
    report.cases.push(result);
    if (!item.previewFile) continue;
    let context;
    const check = name => result.checks.push({ name, status: 'PASS' });
    try {
      stage = 'load-real-generated-panel';
      assert(/^[A-Za-z0-9_-]+\.html$/.test(item.previewFile));
      let bundle;
      if (composition) {
        assert.equal(item.compositionFile, `${item.id}.composition.json`); assert(item.sourceCaseIds.length >= 2);
        const sources = await Promise.all(item.sourceCaseIds.map(id => {
          assert(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id));
          assert(source.cases.some(c => c.id === id && c.status === 'PASS_BEFORE_BROWSER'));
          return readJson(resolve(options['--run'], id, 'panel.bundle.json'));
        }));
        const composed = await validatePanelComposition(await readJson(resolve(options['--preview'], item.compositionFile)), sources, core);
        assert.equal(composed.receipt.sha256, item.receiptSha256); bundle = composed.bundle;
      } else bundle = await validatePanelBundle(await readJson(resolve(options['--run'], item.id, 'panel.bundle.json')), core);
      assert.equal(bundle.sha256, item.bundleSha256); const spec = bundle.spec, rows = spec.sections.flatMap(section => section.rows);
      context = await browser.newContext({ viewport: { width: Math.max(1280, spec.canvas.width + 350), height: Math.max(920, spec.canvas.height + 150) }, serviceWorkers: 'block' });
      await context.setOffline(true);
      const problems = [];
      await context.route('**/*', route => {
        if (['file:', 'blob:', 'data:'].includes(new URL(route.request().url()).protocol)) return route.continue();
        problems.push('Unexpected external request'); return route.abort();
      });
      const page = await context.newPage(); page.on('pageerror', () => problems.push('Browser exception'));
      page.on('console', entry => { if (entry.type() === 'error') problems.push('Browser console error'); });
      await page.goto(pathToFileURL(resolve(options['--preview'], item.previewFile)).href);
      await page.waitForFunction(() => ['ready', 'error'].includes(document.getElementById('status').dataset.state), null, { timeout: 20000 });
      assert.equal(await page.locator('#status').getAttribute('data-state'), 'ready');
      assert.deepEqual(await page.evaluate(() => window.panelHarness.getState()), bundle.state); check(stage);
      stage = 'bounded-layout-and-two-column-grid';
      const initialNodes = await page.evaluate(() => window.panelHarness.inspect().nodes), panel = initialNodes.find(node => node.id === `${spec.id}.panel`);
      assert(panel && panel.bounds.x >= 0 && panel.bounds.y >= 0 && panel.bounds.x + panel.bounds.width <= spec.canvas.width + 1 && panel.bounds.y + panel.bounds.height <= spec.canvas.height + 1);
      if (spec.panelSpecVersion === '0.4') assert(panel.bounds.height <= spec.layout.maxHeight + 1);
      if (spec.layout.body?.kind === 'grid' && spec.layout.body.children.length === 2 && spec.layout.body.children.every(node => node.kind === 'section')) {
        const sections = spec.layout.body.children.map(section => initialNodes.find(node => node.id === `${spec.id}.section.${section.sectionId}`));
        assert(sections.every(Boolean)); assert(sections[0].bounds.x + sections[0].bounds.width <= sections[1].bounds.x + 1);
        assert(Math.abs(sections[0].bounds.y - sections[1].bounds.y) <= 1);
      }
      check(stage);
      stage = 'text-fits-authored-slots-without-truncation';
      for (const node of initialNodes) for (const text of node.renderedTextBounds ?? []) {
        assert(!text.implicitTruncation && text.bounds.width <= node.bounds.width + 1 && text.bounds.height <= node.bounds.height + 1);
      }
      check(stage);
      result.screenshot = `${item.id}.png`;
      await page.screenshot({ path: resolve(directory, result.screenshot), fullPage: true });
      const values = () => page.evaluate(() => window.panelHarness.getState());
      const inspect = () => page.evaluate(() => window.panelHarness.inspect());
      const focus = async id => {
        await page.locator('canvas').focus();
        for (let i = 0; i < rows.length + 5; i++) {
          const focused = await page.locator('canvas').getAttribute('data-focused-component');
          if (focused === id) return;
          await page.keyboard.press('Tab');
        }
        throw new Error('KEYBOARD_FOCUS_UNREACHABLE');
      };
      const point = async id => {
        const nodes = (await inspect()).nodes, node = nodes.find(node => node.id === id); assert(node?.visible);
        const canvas = await page.locator('canvas').boundingBox();
        return { x: canvas.x + (node.bounds.x + node.bounds.width / 2) * canvas.width / spec.canvas.width,
          y: canvas.y + (node.bounds.y + node.bounds.height / 2) * canvas.height / spec.canvas.height };
      };
      let scrolled = false;
      for (const row of rows) {
        const id = controlId(spec.id, row.id), field = spec.state.find(field => field.id === row.bind);
        stage = `row:${row.id}:${row.kind}`;
        const nodes = (await inspect()).nodes, node = nodes.find(node => node.id === id); assert(node?.visible);
        if (row.kind === 'text') {
          const document = await page.evaluate(() => window.panelHarness.getDocument()), all = [];
          const visit = node => { all.push(node); for (const child of node.children ?? []) visit(child); }; visit(document.root);
          assert.equal(all.find(node => node.id === id).props.text, row.text); check(stage); continue;
        }
        assert.equal(node.enabled, row.enabled);
        if (!row.enabled) {
          const viewport = nodes.find(node => node.type === 'ScrollView');
          if (viewport) {
            const canvas = await page.locator('canvas').boundingBox();
            await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + viewport.bounds.y + 20);
            for (let n = 0; n < 4; n++) {
              const currentNodes = (await inspect()).nodes, current = currentNodes.find(node => node.id === id), view = currentNodes.find(node => node.type === 'ScrollView');
              if (current.bounds.y >= view.bounds.y && current.bounds.y + current.bounds.height <= view.bounds.y + view.bounds.height) break;
              await page.mouse.wheel(0, current.bounds.y - view.bounds.y - 8); await page.waitForTimeout(50);
            }
            const currentNodes = (await inspect()).nodes, current = currentNodes.find(node => node.id === id), view = currentNodes.find(node => node.type === 'ScrollView');
            assert(current.bounds.y >= view.bounds.y - 1 && current.bounds.y + current.bounds.height <= view.bounds.y + view.bounds.height + 1);
          }
          const before = await values(), count = await page.evaluate(() => window.panelHarness.events().length);
          const p = await point(id); await page.mouse.click(p.x, p.y);
          assert.deepEqual(await values(), before); assert.equal(await page.evaluate(() => window.panelHarness.events().length), count); check(stage); continue;
        }
        await focus(id);
        const focusedNodes = (await inspect()).nodes, viewport = focusedNodes.find(node => node.type === 'ScrollView'), focused = focusedNodes.find(node => node.id === id);
        if (viewport) {
          assert(focused.bounds.y >= viewport.bounds.y - 1 && focused.bounds.y + focused.bounds.height <= viewport.bounds.y + viewport.bounds.height + 1);
          if (viewport.value.y > 0) scrolled = true;
        }
        if (row.action?.kind === 'reset-initial') {
          const primed = Object.fromEntries(spec.state.map(field => [field.id, field.type === 'boolean' ? !field.initial
            : field.type === 'number' ? field.initial === field.min ? field.max : field.min
            : field.initial === field.options[0].id ? field.options.at(-1).id : field.options[0].id]));
          await page.evaluate(state => window.panelHarness.setState(state), primed); assert.deepEqual(await values(), primed);
        }
        const before = await values(), expected = { ...before }, count = await page.evaluate(() => window.panelHarness.events().length);
        if (row.kind === 'slider') {
          for (const value of [field.min, field.max, field.step]) assert.equal(Number(value.toFixed(row.format.fractionDigits)), value, 'Visible slider precision preserves range and step');
          const useEnd = before[row.bind] === field.min; await page.keyboard.press(useEnd ? 'End' : 'Home'); expected[row.bind] = useEnd ? field.max : field.min;
        } else if (row.kind === 'switch') { await page.keyboard.press('Enter'); expected[row.bind] = !before[row.bind]; }
        else if (row.kind === 'select') {
          await page.keyboard.press('Enter'); const open = (await inspect()).nodes.find(node => node.id === id); assert(open.popupOpen);
          assert.deepEqual(open.popupItems.map(option => option.text), field.options.map(option => option.label));
          const popup = open.popupBounds;
          assert(popup && popup.x >= -1 && popup.y >= -1 && popup.x + popup.width <= spec.canvas.width + 1 && popup.y + popup.height <= spec.canvas.height + 1);
          for (const option of open.popupItems) for (const text of option.textBounds ?? []) {
            assert(text.bounds.x >= popup.x - 1 && text.bounds.y >= popup.y - 1
              && text.bounds.x + text.bounds.width <= popup.x + popup.width + 1
              && text.bounds.y + text.bounds.height <= popup.y + popup.height + 1);
          }
          const useHome = before[row.bind] === field.options.at(-1).id;
          await page.keyboard.press(useHome ? 'Home' : 'End'); expected[row.bind] = useHome ? field.options[0].id : field.options.at(-1).id;
          await page.keyboard.press('Escape'); assert.equal((await inspect()).nodes.find(node => node.id === id).popupOpen, false);
        } else {
          await page.keyboard.press('Enter');
          if (row.action.kind === 'reset-initial') for (const fieldId of row.action.fields) expected[fieldId] = spec.state.find(field => field.id === fieldId).initial;
        }
        assert.deepEqual(await values(), expected);
        if (row.kind === 'slider') {
          const value = (await inspect()).nodes.find(node => node.id === `${spec.id}.row.${row.id}.value`);
          assert.equal(value.renderedTextBounds.map(item => item.text).join(''), `${row.format.prefix}${expected[row.bind].toFixed(row.format.fractionDigits)}${row.format.suffix}`);
        }
        const events = await page.evaluate(() => window.panelHarness.events());
        assert(events.length > count); const event = events.at(-1);
        assert.equal(event.name, row.event); assert.equal(event.source, 'keyboard');
        if (row.kind === 'button') { assert.equal(event.rowId, row.id); assert.equal(event.action, row.action.kind); }
        else { assert.equal(event.fieldId, row.bind); assert.equal(event.value, expected[row.bind]); }
        check(stage);
      }
      stage = 'long-list-keyboard-focus-reveals-lower-controls';
      if (spec.layout.overflow === 'scroll' && (await inspect()).nodes.some(node => node.type === 'ScrollView')) { assert(scrolled); check(stage); }
      stage = 'export-and-file-reopen';
      const state = await values(), exported = await validatePanelBundle(await page.evaluate(() => window.panelHarness.exportBundle()), core);
      assert.deepEqual(exported.spec, spec); assert.deepEqual(exported.state, state); result.exportSha256 = exported.sha256;
      await writeNewJson(directory, `${item.id}.exported.panel.bundle.json`, exported);
      stage = 'download-current-panel-through-preview-button';
      const downloadPromise = page.waitForEvent('download'); await page.locator('#export').click();
      const download = await downloadPromise, downloadedFile = resolve(directory, `${item.id}.downloaded.panel.bundle.json`);
      await download.saveAs(downloadedFile);
      assert.deepEqual(await validatePanelBundle(await readJson(downloadedFile), core), exported); check(stage);
      stage = 'file-reopen-retains-exported-spec-and-state';
      await page.locator('#import').setInputFiles(resolve(directory, `${item.id}.exported.panel.bundle.json`));
      await page.waitForFunction(() => document.getElementById('status').dataset.state === 'ready' && window.panelHarness.events().length === 0);
      assert.deepEqual(await values(), state); check(stage);
      stage = 'offline-rendering-has-no-browser-errors'; assert.deepEqual(problems, []); check(stage);
      result.status = 'PASS';
    } catch (error) { result.status = 'FAIL'; result.failedStage = stage; result.failureCode = error.code ?? 'BROWSER_ACCEPTANCE_FAILED'; }
    finally { await context?.close(); await writeNewJson(directory, `${item.id}.browser-result.json`, result); }
    process.stdout.write(`${JSON.stringify({ event: 'BROWSER_CASE', id: item.id, status: result.status, checks: result.checks.length, failedStage: result.failedStage })}\n`);
  }
  report.totals = { cases: manifest.cases.length, browserPass: report.cases.filter(item => item.status === 'PASS').length,
    browserFail: report.cases.filter(item => item.status === 'FAIL').length, browserNotRun: report.cases.filter(item => item.status === 'NOT_RUN').length,
    endToEndPass: report.cases.filter(item => item.status === 'PASS' && item.semantic === 'PASS' && item.generation === (composition ? 'PROGRAM_COMPOSED' : 'READY_TO_COMPILE')).length,
    checks: report.cases.reduce((count, item) => count + item.checks.length, 0) };
  report.status = report.totals.endToEndPass === manifest.cases.length ? 'PASS' : 'FAIL';
} catch (error) { report.status = 'FAIL'; report.failedStage = stage; report.failureCode = error.code ?? 'BROWSER_SETUP_FAILED'; }
finally {
  await browser?.close(); await writeNewJson(directory, 'panel-evaluation-browser-report.json', report);
  process.stdout.write(`${JSON.stringify({ event: 'BROWSER_FINISHED', status: report.status, totals: report.totals, providerCalls: 0 })}\n`);
  if (report.status !== 'PASS') process.exitCode = 1;
}
