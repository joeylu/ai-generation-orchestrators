#!/usr/bin/env node
/** Real offline ZIP previews produced by check-release, with fixture state only. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createOutputDirectory, writeNewJson } from '../src/io.mjs';
import { loadWorkspaceTool } from './lib/workspace-tools.mjs';

const args = process.argv.slice(2);
assert(args.length === 4 && args[0] === '--acceptance' && args[2] === '--output', 'HEADING_BROWSER_ARGUMENTS');
const input = resolve(args[1]), output = await createOutputDirectory(args[3]);
const installed = JSON.parse(await readFile(resolve(input, 'heading-report.json'), 'utf8'));
assert.equal(installed.status, 'PASS');
const { chromium } = await loadWorkspaceTool('@playwright/test');
const checks = [], errors = [], observations = [], pass = name => checks.push({ name, status: 'PASS' });
let browser, page, report;
const url = id => pathToFileURL(resolve(input, 'headings', id, 'pixi/index.html')).href;
const ready = async () => {
  await page.waitForFunction(() => document.getElementById('status')?.dataset.state === 'ready');
  assert.equal(await page.title(), '面板交付预览');
  assert.equal(await page.locator('canvas').count(), 1);
  const box = await page.locator('canvas').boundingBox();
  assert(box.width > 200 && box.height > 100);
  assert(await page.evaluate(() => {
    const canvas = document.querySelector('canvas'), b = canvas.getBoundingClientRect();
    return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2) === canvas;
  }), 'CANVAS_OBSCURED');
};
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  page = await browser.newPage({ viewport: { width: 1000, height: 850 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/*', async route => {
    if (['file:', 'data:', 'blob:'].includes(new URL(route.request().url()).protocol)) await route.continue();
    else { errors.push('UNEXPECTED_NETWORK_REQUEST'); await route.abort(); }
  });
  for (const fixture of installed.cases) {
    await page.goto(url(fixture.id)); await ready();
    const actual = await page.evaluate(() => ({ inspection: window.panelDelivery.inspect(), state: window.panelDelivery.getState(),
      bundleSha256: window.panelDelivery.bundle.sha256, compilerVersion: window.panelDelivery.bundle.compilerVersion }));
    assert.equal(actual.bundleSha256, fixture.panelSha256);
    assert.equal(actual.compilerVersion, fixture.compilerVersion);
    assert.deepEqual(actual.state, fixture.state);
    const headings = actual.inspection.nodes.filter(node => /\.section\.[^.]+\.title$/.test(node.id));
    assert.equal(headings.length, fixture.headings.length);
    assert(actual.inspection.nodes.some(node => node.id.endsWith('.row.row0.label') && node.visible && node.renderedTextBounds));
    observations.push({ id: fixture.id, compilerVersion: actual.compilerVersion, headingIds: headings.map(node => node.id), state: actual.state });
    if (['legacy-rc1', 'single', 'single-dark', 'distinct-groups', 'tabs'].includes(fixture.id))
      await page.screenshot({ path: resolve(output, fixture.id + '.png'), fullPage: true });
    pass('actual-offline-preview-' + fixture.id);
  }
  await page.goto(url('single')); await ready();
  // Enter from the page: the runtime focuses its first control on canvas entry.
  await page.keyboard.press('Tab');
  assert(await page.evaluate(() => document.activeElement === document.querySelector('canvas')));
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => window.panelDelivery.getState().row0 === 58);
  assert.equal(await page.evaluate(() => window.panelDelivery.events().length), 1);
  pass('collapsed-heading-slider-accepts-one-real-keyboard-change-57-to-58');
  await page.reload(); await ready();
  assert.equal(await page.evaluate(() => window.panelDelivery.getState().row0), 57);
  assert.equal(await page.evaluate(() => window.panelDelivery.events().length), 0);
  pass('bundle-reopen-restores-57-without-an-initial-change-event');
  await page.setViewportSize({ width: 390, height: 760 });
  for (const id of ['single', 'single-dark']) {
    await page.goto(url(id)); await ready();
    const box = await page.locator('canvas').boundingBox();
    assert(box.x >= 0 && box.x + box.width <= 390);
    await page.screenshot({ path: resolve(output, id + '-mobile.png'), fullPage: true });
    pass('390px-offline-preview-' + id);
  }
  await page.evaluate(() => window.panelDelivery.destroy());
  assert.equal(await page.locator('canvas').count(), 0);
  pass('preview-destroy-removes-owned-canvas');
  assert.deepEqual(errors, []); pass('no-console-errors-or-network-requests');
  report = { status: 'PASS', browser: browser.version(), viewports: [{ width: 1000, height: 850 }, { width: 390, height: 760 }],
    browserPlugin: 'ABSENT', fallbackReason: 'Browser plugin not available', checks, observations, errors, realModelCalls: 0, unityNative: 'NOT_RUN' };
} catch (error) {
  report = { status: 'FAIL', checks, observations, errors, code: String(error.message), realModelCalls: 0, unityNative: 'NOT_RUN' };
  if (page) await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser?.close(); await writeNewJson(output, 'heading-browser-report.json', report);
  console.log(JSON.stringify({ status: report.status, checks: checks.length, errors, code: report.code, realModelCalls: 0 }));
}
