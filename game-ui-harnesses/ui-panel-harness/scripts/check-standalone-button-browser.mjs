#!/usr/bin/env node
/** Real offline Pixi controls and reset action; no model or local service is started. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadWorkspaceTool } from './lib/workspace-tools.mjs';
const { chromium } = await loadWorkspaceTool('@playwright/test');
import { createOutputDirectory, readJson, writeNewJson } from '../src/io.mjs';
import { digestBytes } from '../src/canonical.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { validatePanelBundle } from '../src/panel-bundle.mjs';
import { controlId, initialPanelState } from '../src/compiler.mjs';

const options = {}, args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  assert(['--preview', '--bundle', '--output'].includes(args[i]) && args[i + 1] && !options[args[i]], 'Expected preview, bundle and fresh output');
  options[args[i]] = args[i + 1];
}
assert.equal(Object.keys(options).length, 3);
const directory = await createOutputDirectory(options['--output']);
const report = { standaloneButtonBrowserVersion: '0.1', status: 'RUNNING', checks: [], screenshots: [], providerCalls: 0,
  scope: 'Real offline Pixi pointer interaction and portable export; no model or service calls', nativeEngines: 'NOT_RUN', humanVisualReview: 'NOT_RUN' };
const pass = name => report.checks.push({ name, status: 'PASS' });
let browser, stage = 'validate-preview-artifacts';
try {
  const core = await loadWorkspaceCore(), bundle = await validatePanelBundle(await readJson(options['--bundle']), core);
  const manifest = await readJson(resolve(options['--preview'], 'preview-build.json'));
  assert.equal(manifest.status, 'COMPLETE'); assert.equal(manifest.panelSha256, bundle.sha256);
  for (const item of manifest.files) assert.equal(await digestBytes(await readFile(resolve(options['--preview'], item.path))), item.sha256);
  report.panelSha256 = bundle.sha256; report.compilerVersion = bundle.compilerVersion; pass(stage);
  const rows = bundle.spec.sections.flatMap(section => section.rows), slider = rows.find(row => row.kind === 'slider' && row.enabled);
  const toggle = rows.find(row => row.kind === 'switch' && row.enabled), reset = rows.find(row => row.kind === 'button' && row.label === '' && row.enabled && row.action.kind === 'reset-initial');
  assert(slider && toggle && reset); assert(reset.action.fields.includes(slider.bind) && reset.action.fields.includes(toggle.bind));
  const problems = [];
  browser = await chromium.launch({ headless: true, channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 920 }, serviceWorkers: 'block' });
  await context.setOffline(true);
  await context.route('**/*', route => {
    if (['file:', 'blob:', 'data:'].includes(new URL(route.request().url()).protocol)) return route.continue();
    problems.push('Unexpected external request'); return route.abort();
  });
  const page = await context.newPage(); page.on('pageerror', () => problems.push('Browser exception'));
  page.on('console', entry => { if (entry.type() === 'error') problems.push('Browser console error'); });
  await page.goto(pathToFileURL(resolve(options['--preview'], 'index.html')).href);
  await page.waitForFunction(() => window.panelHarness?.inspect().nodes?.length && document.getElementById('status').dataset.state === 'ready');
  const values = () => page.evaluate(() => window.panelHarness.getState());
  const point = async (id, fraction = 0.5) => {
    const node = await page.evaluate(id => window.panelHarness.inspect().nodes.find(node => node.id === id), id);
    assert(node?.visible); const canvas = await page.locator('canvas').boundingBox();
    return { x: canvas.x + (node.bounds.x + node.bounds.width * fraction) * canvas.width / bundle.spec.canvas.width,
      y: canvas.y + (node.bounds.y + node.bounds.height / 2) * canvas.height / bundle.spec.canvas.height };
  };
  const click = async (id, fraction) => { const p = await point(id, fraction); await page.mouse.click(p.x, p.y); };
  stage = 'standalone-button-has-no-painted-row';
  const document = await page.evaluate(() => window.panelHarness.getDocument()), nodes = [];
  const visit = node => { nodes.push(node); for (const child of node.children ?? []) visit(child); }; visit(document.root);
  assert.equal(nodes.some(node => node.id === `${bundle.spec.id}.row.${reset.id}`), false);
  const section = bundle.spec.sections.find(section => section.rows.some(row => row.id === reset.id));
  assert(nodes.find(node => node.id === `${bundle.spec.id}.section.${section.id}`).children.some(node => node.id === controlId(bundle.spec.id, reset.id)));
  await page.screenshot({ path: resolve(directory, 'standalone-button.png'), fullPage: true }); report.screenshots.push('standalone-button.png'); pass(stage);
  stage = 'slider-and-switch-change-live-state';
  const before = await values(); await click(controlId(bundle.spec.id, slider.id), 0.25); await click(controlId(bundle.spec.id, toggle.id));
  const played = await values(); assert.notEqual(played[slider.bind], before[slider.bind]); assert.equal(played[toggle.bind], !before[toggle.bind]); pass(stage);
  stage = 'restore-defaults-restores-both-authored-initial-values';
  await click(controlId(bundle.spec.id, reset.id)); assert.deepEqual(await values(), initialPanelState(bundle.spec));
  const events = await page.evaluate(() => window.panelHarness.events()); assert(events.some(event => event.name === reset.event && event.action === 'reset-initial')); pass(stage);
  stage = 'export-and-reopen-keeps-spec-state-and-button';
  const exported = await validatePanelBundle(await page.evaluate(() => window.panelHarness.exportBundle()), core);
  assert.deepEqual(exported.spec, bundle.spec); assert.deepEqual(exported.state, initialPanelState(bundle.spec));
  await writeNewJson(directory, 'exported.panel.bundle.json', exported);
  await page.locator('#import').setInputFiles(resolve(directory, 'exported.panel.bundle.json'));
  await page.waitForFunction(() => document.getElementById('status').dataset.state === 'ready'); assert.deepEqual(await values(), exported.state); pass(stage);
  stage = 'offline-rendering-has-no-browser-errors'; assert.deepEqual(problems, []); pass(stage);
  await context.close(); report.status = 'PASS';
} catch (error) { report.status = 'FAIL'; report.failedStage = stage; report.failureCode = error.code ?? 'ACCEPTANCE_FAILED'; }
finally {
  await browser?.close(); await writeNewJson(directory, 'standalone-button-browser-report.json', report);
  process.stdout.write(`${JSON.stringify({ status: report.status, checks: report.checks.length, providerCalls: 0, failedStage: report.failedStage ?? null })}\n`);
  if (report.status !== 'PASS') process.exitCode = 1;
}
