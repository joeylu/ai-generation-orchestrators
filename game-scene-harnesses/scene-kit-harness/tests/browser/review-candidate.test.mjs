import {panCanvas,scenePixels} from './canvas-controls.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareReviewCandidate } from '../helpers/review-candidate.mjs';
import { buildStudio, dependency } from '../../scripts/studio-build.mjs';
import { startStudio } from '../../src/studio/host.mjs';
import { loadSceneKit, readMap, exportScene, openSceneExport } from '../../src/index.mjs';
import { unpackStored } from '../helpers/archive.mjs';
import { inspectPng } from '../../src/png.mjs';

test('layered review: finite backgrounds render across four screens and survive ZIP reopen and mobile resize', { timeout: 180000 }, async t => {
  const c = prepareReviewCandidate(t); c.buildReview();
  const kit = loadSceneKit(join(c.reviewOut, 'kit')), document = readMap(kit), exported = join(c.parent, 'portable');
  exportScene(kit, document, exported);
  const staticRoot = await buildStudio({ output: join(c.parent, 'static') }), host = await startStudio({ root: join(exported, 'kit'), staticRoot });
  t.after(() => host.close()); const { chromium } = dependency('playwright').require('playwright');
  const browser = await chromium.launch({ headless: true, ...(process.env.SCENE_KIT_BROWSER_CHANNEL ? { channel: process.env.SCENE_KIT_BROWSER_CHANNEL } : {}),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--explicitly-allowed-ports='+new URL(host.url).port] }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 1 }), errors = [], external = [];
  page.on('pageerror', error => errors.push(error.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/*', route => new URL(route.request().url()).origin === host.url ? route.continue() : (external.push(route.request().url()), route.abort()));
  await page.goto(host.url); await page.waitForSelector('body[data-ready="true"]', { timeout: 60000 });
  const state = () => page.evaluate(async () => (await fetch('/api/state')).json()), before = await state();
  assert.equal(before.modules.length, 758); assert.equal(before.scene.counts.visualNodes, 15);
  await page.locator('#tab-environment').click(); assert.equal(await page.locator('#palette button').count(), 6);
  assert.match(await page.locator('#appearance-badge').innerText(), /整包未验收/);
  await page.getByRole('checkbox', { name: '网格', exact: true }).uncheck();

  await page.getByRole('button', { name: 'Play Mode', exact: true }).click();
  for (let index = 0; index < 7; index++) {
    const box = await page.locator('#minimap rect').last().evaluate(e => ({ x: +e.getAttribute('x'), width: +e.getAttribute('width') }));
    assert.equal(box.x, index * 512); assert.equal(box.width, 1024);
    const image = inspectPng(await scenePixels(page), { includePixels: true });
    const scale = Math.min(image.width / 1024, image.height / 576), x = Math.floor((image.width - scale * 1024) / 2 + 512 * scale),
      y = Math.floor((image.height - scale * 576) / 2 + 20 * scale), p = (y * image.width + x) * 4;
    assert.deepEqual([...image.rgba.subarray(p, p + 4)], [140, 210, 240, 255], 'Opaque sky must cover the fixed viewport at every camera stop');
    await page.keyboard.press('ArrowRight');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector('canvas').width === Math.round(document.getElementById('canvas-host').clientWidth));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByRole('button', { name: '退出 Play Mode', exact: true }).click();
  const download = page.waitForEvent('download'); await page.locator('#download-menu>summary').click();await page.locator('#export-pack').click();
  const zip = readFileSync(await (await download).path()), unpacked = join(c.parent, 'unpacked'); unpackStored(zip, unpacked);
  assert.deepEqual(openSceneExport(unpacked).compiled, before.scene);
  const after = await state(); assert.deepEqual(after.document, before.document); assert.deepEqual(after.history, before.history);
  assert.equal(after.revision, 0); assert.deepEqual(errors, []); assert.deepEqual(external, []);
});
