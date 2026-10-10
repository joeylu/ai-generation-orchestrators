#!/usr/bin/env node
/** Check the actual installed delivery and ES browser module; no external services or models. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createOutputDirectory, writeNewJson } from '../src/io.mjs';
import { loadWorkspaceTool } from './lib/workspace-tools.mjs';

const args = process.argv.slice(2);
assert(args.length === 4 && args[0] === '--acceptance' && args[2] === '--output', 'RELEASE_BROWSER_ARGUMENTS');
const input = resolve(args[1]), output = await createOutputDirectory(args[3]);
const { chromium } = await loadWorkspaceTool('@playwright/test');
const checks = [], errors = [], pass = name => checks.push({ name, status: 'PASS' });
const runtime = await readFile(resolve(input, 'browser-runtime.js'));
const bundle = await readFile(resolve(input, 'pixi/panel.bundle.json'));
const html = `<!doctype html><meta charset="utf-8"><div id="surface"></div><script type="module">
import * as runtime from './browser-runtime.js';
const bundle=await runtime.validateBundle(await(await fetch('./panel.bundle.json')).json());
const host=runtime.createPixiPanelHost();const panel=await host.add('module',bundle,{container:document.getElementById('surface')});
window.sdkModule={runtime,host,panel,bundle};</script>`;
const server = createServer((request, response) => {
  const resources = { '/': ['text/html; charset=utf-8', html], '/browser-runtime.js': ['text/javascript; charset=utf-8', runtime],
    '/panel.bundle.json': ['application/json', bundle] };
  const item = resources[request.url];
  response.writeHead(item ? 200 : 404, { 'Content-Type': item?.[0] ?? 'text/plain' }); response.end(item?.[1] ?? 'not found');
});
let browser, page, report;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  page = await browser.newPage({ viewport: { width: 1000, height: 850 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (['file:', 'data:', 'blob:'].includes(url.protocol) || url.hostname === '127.0.0.1') await route.continue();
    else { errors.push('UNEXPECTED_REMOTE_REQUEST'); await route.abort(); }
  });
  await page.goto(pathToFileURL(resolve(input, 'pixi/index.html')).href);
  await page.waitForFunction(() => document.getElementById('status')?.dataset.state === 'ready');
  assert.equal(await page.locator('canvas').count(), 1);
  assert.equal(await page.evaluate(() => window.panelDelivery.bundle.spec.sections.flatMap(section => section.rows).find(row => row.buttonLabel === '继续').buttonLabel), '继续');
  pass('actual-exported-zip-opens-offline-and-mounts-edited-panel');
  await page.locator('canvas').focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.panelDelivery.events().length === 1);
  pass('offline-pixi-button-delivers-one-actual-keyboard-action');
  await page.screenshot({ path: resolve(output, 'offline-panel.png'), fullPage: true });
  await page.evaluate(() => window.panelDelivery.destroy());
  assert.equal(await page.locator('canvas').count(), 0);
  pass('offline-panel-releases-owned-canvas');
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.sdkModule?.panel.status === 'OPEN');
  assert.equal(await page.locator('canvas').count(), 1);
  assert.equal(await page.evaluate(() => window.sdkModule.runtime.version), '0.1.0');
  const exported = await page.evaluate(() => window.sdkModule.panel.exportBundle());
  assert.deepEqual(exported, JSON.parse(bundle.toString('utf8')));
  pass('self-contained-es-module-renders-and-exports-the-same-bundle');
  await page.evaluate(() => window.sdkModule.host.destroy());
  assert.equal(await page.locator('canvas').count(), 0);
  assert.deepEqual(errors, []);
  pass('module-cleanup-and-both-runtimes-have-no-browser-errors-or-remote-requests');
  report = { status: 'PASS', browser: browser.version(), checks, errors, realModelCalls: 0, unityNative: 'NOT_RUN' };
} catch (error) {
  report = { status: 'FAIL', checks, errors, code: String(error.message), realModelCalls: 0, unityNative: 'NOT_RUN' };
  if (page) await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
  await writeNewJson(output, 'browser-report.json', report);
  console.log(JSON.stringify({ status: report.status, checks: checks.length, realModelCalls: 0, errors }));
}
