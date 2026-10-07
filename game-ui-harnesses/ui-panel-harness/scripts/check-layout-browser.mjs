#!/usr/bin/env node
/** Offline file previews, real Pixi, and visible controls only. No model or server. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '../../ui-component-harness/node_modules/@playwright/test/index.mjs';
import { readJson, createOutputDirectory, writeNewJson } from '../src/io.mjs';
import { digestBytes } from '../src/canonical.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { validatePanelBundle } from '../src/panel-bundle.mjs';
import { controlId, choiceId, initialPanelState } from '../src/compiler.mjs';

const options = {}, args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 2) {
  assert(['--root', '--output'].includes(args[index]) && args[index + 1] && !options[args[index]], 'Expected --root and --output exactly once');
  options[args[index]] = args[index + 1];
}
assert.equal(Object.keys(options).length, 2);
const directory = await createOutputDirectory(options['--output']);
const report = { version: '0.1', status: 'RUNNING', checks: [], screenshots: [], samples: [], providerCalls: 0,
  network: 'offline', scheme: 'file', scope: 'Real Pixi previews with visible mouse, keyboard, file import and download actions',
  humanVisualReview: 'NOT_RUN', nativeEngines: 'NOT_RUN' };
let browser, context, page, current, stage = 'validate-builds';
const pass = (name, details = {}) => report.checks.push({ name, status: 'PASS', ...details });
const problems = [];
try {
  const core = await loadWorkspaceCore(), samples = [];
  for (const name of ['settings', 'settings-compact', 'pause', 'character']) {
    const base = resolve(options['--root'], name), bundle = await validatePanelBundle(await readJson(resolve(base, 'panel.bundle.json')), core);
    const build = await readJson(resolve(base, 'preview', 'preview-build.json'));
    assert.equal(build.status, 'COMPLETE'); assert.equal(build.panelSha256, bundle.sha256);
    assert.deepEqual(build.files.map(file => file.path).sort(), ['index.html', 'preview.js']);
    for (const file of build.files) assert.equal(await digestBytes(await readFile(resolve(base, 'preview', file.path))), file.sha256);
    samples.push({ name, base, bundle });
    report.samples.push({ name, panelSha256: bundle.sha256, previewFiles: build.files });
  }
  pass(stage, { samples: 4, manifestAndBundleValidation: 'PASS' });
  browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  report.browser = { channel: 'msedge', version: browser.version() };
  const healthy = async () => {
    assert.deepEqual(problems, []);
    assert.equal(await page.locator('#status').getAttribute('data-state'), 'ready');
  };
  const open = async () => {
    context = await browser.newContext({ viewport: { width: 1500, height: 1100 }, serviceWorkers: 'block', offline: true });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (['file:', 'data:', 'blob:'].includes(url.protocol)) return route.continue();
      problems.push('Unexpected nonlocal request'); return route.abort();
    });
    page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', error => problems.push(error.message));
    page.on('console', message => { if (message.type() === 'error') problems.push(message.text()); });
    await page.goto(pathToFileURL(resolve(current.base, 'preview', 'index.html')).href);
    await page.waitForFunction(() => document.getElementById('status').dataset.state === 'ready');
    await healthy();
  };
  const inspect = () => page.evaluate(() => window.panelHarness.inspect());
  const state = () => page.evaluate(() => window.panelHarness.getState());
  const events = () => page.evaluate(() => window.panelHarness.events());
  const nodes = async () => (await inspect()).nodes;
  const node = async id => (await nodes()).find(item => item.id === id);
  const bodyId = () => `${current.bundle.spec.id}.body`;
  const rows = () => current.bundle.spec.sections.flatMap(section => section.rows);
  const id = row => controlId(current.bundle.spec.id, row.id);
  const point = async bounds => {
    const canvas = page.locator('#canvas-host canvas'); await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox(); assert(box);
    return { x: box.x + bounds.x * box.width / current.bundle.spec.canvas.width,
      y: box.y + bounds.y * box.height / current.bundle.spec.canvas.height,
      sx: box.width / current.bundle.spec.canvas.width, sy: box.height / current.bundle.spec.canvas.height };
  };
  const screenshot = async suffix => {
    const name = `${current.name}-${suffix}.png`;
    await page.locator('#canvas-host canvas').screenshot({ path: resolve(directory, name) });
    report.screenshots.push(name);
  };
  const textCheck = async () => {
    for (const item of await nodes()) for (const text of item.renderedTextBounds ?? []) {
      assert(!text.implicitTruncation && text.bounds.width <= item.bounds.width + 1 && text.bounds.height <= item.bounds.height + 1,
        `Text overflow: ${item.id}`);
    }
  };
  const visibleRow = async row => {
    const body = await node(bodyId()); if (body.type !== 'ScrollView') return;
    const bounds = (await node(`${current.bundle.spec.id}.row.${row.id}`)).bounds;
    assert(bounds.y >= body.bounds.y - .5 && bounds.y + bounds.height <= body.bounds.y + body.bounds.height + .5, `Focused row must be fully visible: ${row.id}`);
  };
  const focus = async target => {
    const canvas = page.locator('#canvas-host canvas'); await canvas.focus();
    for (let count = 0; count < (rows().length + 4) * 3; count += 1) {
      if (await canvas.getAttribute('data-focused-component') === target) return;
      if (!await canvas.evaluate(element => document.activeElement === element)) await canvas.focus();
      await page.keyboard.press('Tab');
    }
    assert.fail(`Keyboard focus unavailable: ${target}`);
  };
  const focusRow = async row => { await focus(id(row)); await visibleRow(row); };
  const clickRow = async row => {
    await focusRow(row); const bounds = (await node(id(row))).bounds, p = await point(bounds);
    await page.mouse.click(p.x + bounds.width / 2 * p.sx, p.y + bounds.height / 2 * p.sy);
  };
  const wheel = async delta => {
    const body = await node(bodyId()), p = await point(body.bounds);
    // The left inset of the viewport avoids controls and any open menu.
    await page.mouse.move(p.x + 3 * p.sx, p.y + body.bounds.height / 2 * p.sy);
    const before = body.value.y;
    const docBody = current.bundle.componentBundle.document.root.children.flatMap(child => child.children ?? []).find(child => child.id === bodyId());
    assert(docBody);
    const expected = Math.max(0, Math.min(docBody.props.contentHeight - docBody.layout.height, before + delta));
    await page.mouse.wheel(0, delta);
    await page.waitForFunction(({ id, expected }) => Math.abs(window.panelHarness.inspect().nodes.find(node => node.id === id).value.y - expected) < .1, { id: bodyId(), expected });
  };
  const popupCheck = async row => {
    const select = await node(id(row)), popup = select.popupBounds;
    assert(select.popupOpen && popup);
    assert(popup.x >= 0 && popup.y >= 0 && popup.x + popup.width <= current.bundle.spec.canvas.width + 1 && popup.y + popup.height <= current.bundle.spec.canvas.height + 1, 'Select overlay must fit the logical canvas');
    await visibleRow(row); return select;
  };
  const choose = async (row, option) => {
    await clickRow(row); const select = await popupCheck(row), popup = select.popupBounds;
    const field = current.bundle.spec.state.find(field => field.id === row.bind), index = field.options.findIndex(item => item.id === option);
    assert.deepEqual(select.popupItems.map(item => item.optionId), field.options.map(item => choiceId(current.bundle.spec.id, row.id, item.id)));
    const p = await point(popup);
    await page.mouse.click(p.x + popup.width / 2 * p.sx, p.y + (index + .5) * popup.height / field.options.length * p.sy);
    assert.equal((await state())[row.bind], option); assert.equal((await node(id(row))).popupOpen, false);
  };
  for (current of samples) {
    stage = `${current.name}:initial-offline-render`; await open();
    assert.deepEqual(await state(), current.bundle.state); assert.deepEqual(await events(), []);
    assert.equal((await page.locator('#status').textContent()).includes('滚轮'), current.name.startsWith('settings'), 'Only scrollable previews show the wheel hint');
    await textCheck(); await screenshot('initial'); pass(stage);
    stage = `${current.name}:declared-layout`;
    const sectionNodes = await Promise.all(current.bundle.spec.sections.map(section => node(`${current.bundle.spec.id}.section.${section.id}`)));
    if (current.name === 'settings' || current.name === 'character') {
      assert(sectionNodes[1].bounds.x > sectionNodes[0].bounds.x + sectionNodes[0].bounds.width);
      if (current.name === 'settings') assert.equal(sectionNodes[0].bounds.y, sectionNodes[1].bounds.y);
    } else if (current.name === 'settings-compact') {
      assert.equal(sectionNodes[0].bounds.x, sectionNodes[1].bounds.x);
      assert(sectionNodes[1].bounds.y > sectionNodes[0].bounds.y + sectionNodes[0].bounds.height);
      assert.equal(current.bundle.spec.canvas.width, 400);
    } else {
      const body = await node(bodyId()); assert.equal(sectionNodes[0].bounds.width, 360);
      assert.equal(sectionNodes[0].bounds.x - body.bounds.x, (body.bounds.width - 360) / 2);
    }
    pass(stage);
    if (current.name.startsWith('settings')) {
      const select = rows().find(row => row.kind === 'select'), reset = rows().find(row => row.kind === 'button');
      const slider = rows().find(row => row.kind === 'slider'), toggle = rows().find(row => row.kind === 'switch');
      const defaults = initialPanelState(current.bundle.spec), initial = await state();
      stage = `${current.name}:wheel-and-drag-scroll`;
      const body = await node(bodyId()); assert.equal(body.type, 'ScrollView');
      await wheel(10000); const end = (await node(bodyId())).value.y; assert(end > 0);
      const b = (await node(bodyId())).bounds, p = await point(b);
      await page.mouse.move(p.x + 3 * p.sx, p.y + 50 * p.sy); await page.mouse.down();
      await page.mouse.move(p.x + 3 * p.sx, p.y + 110 * p.sy, { steps: 8 }); await page.mouse.up();
      assert((await node(bodyId())).value.y < end); assert.deepEqual(await state(), initial);
      pass(stage, { maximumScroll: end, businessStatePreserved: true });
      stage = `${current.name}:keyboard-scroll-and-focus-reveal`;
      await focus(bodyId()); await page.keyboard.press('Home'); assert.equal((await node(bodyId())).value.y, 0);
      await page.keyboard.press('End'); assert.equal((await node(bodyId())).value.y, end);
      for (const row of rows().filter(row => row.kind !== 'text')) await focusRow(row);
      assert.deepEqual(await state(), initial); pass(stage, { focusedControls: rows().length, businessStatePreserved: true });
      stage = `${current.name}:select-popup-and-scroll-close`;
      await clickRow(select); await popupCheck(select); await screenshot('select-open');
      const scrollY = (await node(bodyId())).value.y; await wheel(scrollY > 0 ? -10 : 10);
      assert.equal((await node(id(select))).popupOpen, false); assert.deepEqual(await state(), initial); pass(stage);
      if (current.name === 'settings-compact') {
        stage = `${current.name}:partly-clipped-pointer-select`;
        await focus(bodyId()); await page.keyboard.press('Home');
        const area = (await node(bodyId())).bounds, rowBounds = (await node(`${current.bundle.spec.id}.row.${select.id}`)).bounds;
        const desiredScroll = rowBounds.y - area.y - (area.height - 20);
        assert(desiredScroll > 0); await wheel(desiredScroll);
        const clipped = (await node(id(select))).bounds;
        assert(clipped.y < area.y + area.height && clipped.y + clipped.height > area.y + area.height);
        const p = await point({ x: clipped.x + clipped.width / 2, y: area.y + area.height - 5 });
        await page.mouse.click(p.x, p.y); await popupCheck(select); await screenshot('partial-select-revealed');
        await page.keyboard.press('Escape'); assert.deepEqual(await state(), initial); pass(stage);
      }
      stage = `${current.name}:independent-controls`;
      const before = await state(); await focusRow(slider);
      const sliderBounds = (await node(id(slider))).bounds, sliderPoint = await point(sliderBounds);
      const sliderField = current.bundle.spec.state.find(field => field.id === slider.bind);
      await page.mouse.click(sliderPoint.x + (sliderBounds.width - 14) * sliderPoint.sx, sliderPoint.y + sliderBounds.height / 2 * sliderPoint.sy);
      assert.deepEqual(await state(), { ...before, [slider.bind]: sliderField.max });
      await clickRow(toggle); assert.deepEqual(await state(), { ...before, [slider.bind]: sliderField.max, [toggle.bind]: !before[toggle.bind] });
      const otherSlider = rows().filter(row => row.kind === 'slider').at(-1), priorOther = await state();
      await focusRow(otherSlider); await page.keyboard.press('Home');
      assert.deepEqual(await state(), { ...priorOther, [otherSlider.bind]: 0 });
      const priorChoice = await state(), choice = current.bundle.spec.state.find(field => field.id === select.bind).options.find(option => option.id !== priorChoice[select.bind]).id;
      await choose(select, choice); assert.deepEqual(await state(), { ...priorChoice, [select.bind]: choice });
      pass(stage, { mouseSlider: true, independentToggle: true, independentSecondSlider: true, choice });
      stage = `${current.name}:bounded-reset-action`;
      const eventCount = (await events()).length; await focusRow(reset); await page.keyboard.press('Space');
      assert.deepEqual(await state(), defaults);
      assert.deepEqual((await events()).slice(eventCount), [{ name: reset.event, rowId: reset.id, action: 'reset-initial', state: defaults, source: 'keyboard' }]);
      await textCheck(); pass(stage);
      // Export a nondefault value, proving that opening the saved artifact is not
      // merely reconstructing the original fixture's initial values.
      await focusRow(slider); await page.keyboard.press('Home');
    } else {
      stage = `${current.name}:stateless-content-and-host-events`;
      assert.deepEqual(current.bundle.spec.state, []); assert.deepEqual(await state(), {});
      for (const row of rows().filter(row => row.kind === 'text')) {
        assert.equal((await node(id(row))).renderedTextBounds.map(item => item.text).join(''), row.text);
        assert(!current.bundle.bindings.some(binding => binding.nodeId === id(row)));
      }
      for (const row of rows().filter(row => row.kind === 'button')) {
        const eventCount = (await events()).length; await clickRow(row);
        assert.deepEqual((await events()).slice(eventCount), [{ name: row.event, rowId: row.id, action: 'emit', state: {}, source: 'mouse' }]);
      }
      assert.deepEqual(await state(), {}); pass(stage, { textRows: rows().filter(row => row.kind === 'text').length, emittedActions: rows().filter(row => row.kind === 'button').length });
    }
    stage = `${current.name}:visible-download-and-fresh-context-restore`;
    await screenshot('interacted'); const savedState = await state();
    const downloaded = page.waitForEvent('download'); await page.locator('#export').click();
    const download = await downloaded, downloadPath = resolve(directory, `${current.name}.downloaded.panel.bundle.json`);
    await download.saveAs(downloadPath);
    const saved = await validatePanelBundle(await readJson(downloadPath), core);
    assert.deepEqual(saved.spec, current.bundle.spec); assert.deepEqual(saved.state, savedState);
    assert.deepEqual(saved.componentBundle.resources, current.bundle.componentBundle.resources);
    await healthy(); await context.close(); context = null; await open();
    const originalCanvas = await page.locator('#canvas-host canvas').elementHandle(); assert(originalCanvas);
    await page.locator('#import').setInputFiles(downloadPath);
    // Stateless samples have the same {} value before and after import. Wait
    // for the old canvas to detach so value equality cannot pass prematurely.
    await page.waitForFunction(canvas => !canvas.isConnected, originalCanvas);
    await originalCanvas.dispose();
    await page.waitForFunction(expected => document.getElementById('status').dataset.state === 'ready'
      && JSON.stringify(window.panelHarness.getState()) === JSON.stringify(expected), savedState);
    await healthy(); assert.deepEqual(await state(), savedState); assert.deepEqual(await events(), []);
    await textCheck(); await screenshot('restored'); pass(stage, { state: savedState, separateBrowserContext: true });
    await context.close(); context = null;
  }
  assert.deepEqual(problems, []); report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.failedStage = stage;
  report.failure = { name: error.name, message: String(error.message).slice(0, 1500) };
  process.exitCode = 1;
  if (page && !page.isClosed()) {
    try { await page.screenshot({ path: resolve(directory, 'failure.png'), fullPage: true }); report.screenshots.push('failure.png'); } catch {}
  }
} finally {
  await context?.close().catch(() => {}); await browser?.close().catch(() => {});
  await writeNewJson(directory, 'browser-report.json', report);
}
process.stdout.write(`${JSON.stringify({ status: report.status, checks: report.checks.length, failedStage: report.failedStage })}\n`);
