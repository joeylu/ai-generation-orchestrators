import {scenePixels} from './canvas-controls.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildStudio, dependency } from '../../scripts/studio-build.mjs';
import { startStudio } from '../../src/studio/host.mjs';
import { buildFiniteEnvironmentDemo } from '../../src/generation/index.mjs';
import { inspectPng } from '../../src/png.mjs';
import { prepareFiniteEnvironment } from '../helpers/finite-environment.mjs';

test('finite environment: game viewport clamps camera, renders parallax, preserves editor and survives resize', { timeout: 180000 }, async t => {
  const c = prepareFiniteEnvironment(t); c.accept(); const out = join(c.parent, 'demo');
  buildFiniteEnvironmentDemo(c.root, c.plan.sha256, c.kit, c.options, out);
  const staticRoot = await buildStudio({ output: join(c.parent, 'static') });
  const host = await startStudio({ root: join(out, 'kit'), staticRoot }); t.after(() => host.close());
  const { chromium } = dependency('playwright').require('playwright');
  const browser = await chromium.launch({ headless: true, ...(process.env.SCENE_KIT_BROWSER_CHANNEL ? { channel: process.env.SCENE_KIT_BROWSER_CHANNEL } : {}),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--explicitly-allowed-ports='+new URL(host.url).port] }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 1 });
  const errors = [], external = [], warnings = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); if (m.type() === 'warning') warnings.push(m.text()); });
  await page.route('**/*', route => new URL(route.request().url()).origin === host.url ? route.continue() : (external.push(route.request().url()), route.abort()));
  await page.goto(host.url); await page.waitForSelector('body[data-ready="true"]', { timeout: 60000 });
  assert.match(await page.title(), /Scene Kit Studio/); assert.match(await page.locator('body').innerText(), /模块库/);
  assert.equal(await page.locator('vite-error-overlay,nextjs-portal').count(), 0);
  const state = () => page.evaluate(async () => (await fetch('/api/state')).json());
  const visible = () => page.locator('#minimap rect').last().evaluate(e => ({ x: +e.getAttribute('x'), y: +e.getAttribute('y'), width: +e.getAttribute('width'), height: +e.getAttribute('height') }));
  const before = await state(), editCamera = await visible();

  await page.getByRole('button', { name: 'Play Mode', exact: true }).click();
  const start = await visible(); assert.deepEqual(start, { x: 0, y: 0, width: 1024, height: 576 });
  assert.equal(await page.locator('#zoom-in').isDisabled(), true);
  // Sample the raster in a terrain-free row; the encoded synthetic source has
  // a horizontal color ramp, so camera motion must change the sampled color.
  async function sample() {
    const image = inspectPng(await scenePixels(page), { includePixels: true });
    const s = Math.min(image.width / 1024, image.height / 576), x = Math.floor((image.width - s * 1024) / 2 + 512 * s),
      y = Math.floor((image.height - s * 576) / 2 + 250 * s), p = (y * image.width + x) * 4;
    return [...image.rgba.subarray(p, p + 4)];
  }
  const first = await sample();
  await page.keyboard.press('ArrowRight'); const middle = await visible(); assert.equal(middle.x, 512);
  assert.notDeepEqual(await sample(), first);
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight');
  assert.deepEqual(await visible(), { x: 3072, y: 0, width: 1024, height: 576 });
  const box = await page.locator('canvas').boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(0, 500);
  assert.deepEqual(await visible(), { x: 3072, y: 0, width: 1024, height: 576 });
  if (process.env.SCENE_KIT_SCREENSHOTS) { mkdirSync(process.env.SCENE_KIT_SCREENSHOTS, { recursive: true }); await page.screenshot({ path: join(process.env.SCENE_KIT_SCREENSHOTS, 'finite-game-desktop.png'), fullPage: true }); }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector('canvas').width === Math.round(document.getElementById('canvas-host').clientWidth));
  assert.deepEqual(await visible(), { x: 3072, y: 0, width: 1024, height: 576 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (process.env.SCENE_KIT_SCREENSHOTS) await page.screenshot({ path: join(process.env.SCENE_KIT_SCREENSHOTS, 'finite-game-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: '退出 Play Mode', exact: true }).click();
  const after = await state(); assert.deepEqual(after.document, before.document); assert.deepEqual(after.history, before.history);
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.waitForFunction(() => document.querySelector('canvas').width === Math.round(document.getElementById('canvas-host').clientWidth));
  const restored = await visible();
  for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(restored[key] - editCamera[key]) < 1, `Editor camera ${key} was not restored`);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  assert.ok(warnings.every(m => /ReadPixels|GPU stall|deprecated|powerPreference/i.test(m)), warnings.join('\n'));
});
