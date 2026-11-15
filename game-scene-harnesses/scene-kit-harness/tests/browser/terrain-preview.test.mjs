import {canvasField,selectObject,dismissCanvasPanels,panCanvas,scenePixels,centerCanvasHorizontally} from './canvas-controls.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { buildStudio, dependency } from '../../scripts/studio-build.mjs';
import { startStudio } from '../../src/studio/host.mjs';
import { inspectPng } from '../../src/png.mjs';
import { hash } from '../../src/generation/common.mjs';
import { fixtureRoot } from '../helpers/generation.mjs';
import { prepareTerrainPreview } from '../helpers/terrain-preview.mjs';
import {terrainStudyTextureKey} from '../../src/pixi/terrain-appearance.mjs';

const roots = process.env.SCENE_KIT_DEPENDENCIES?.split(delimiter).filter(Boolean) ?? [];
test('terrain appearance: rendered phase selection, brushing, scrolling, downloads and explicit failure recovery', { timeout: 180000 }, async t => {
  const context = prepareTerrainPreview(t), staticRoot = await buildStudio({ roots, output: join(context.parent, 'static') });
  const host = await startStudio({ root: fixtureRoot, staticRoot, terrainPreview: context.preview });
  t.after(() => host.close());
  const { chromium } = dependency('playwright', roots).require('playwright');
  const browser = await chromium.launch({ headless: true,
    ...(process.env.SCENE_KIT_BROWSER_CHANNEL ? { channel: process.env.SCENE_KIT_BROWSER_CHANNEL } : {}),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--explicitly-allowed-ports='+new URL(host.url).port] });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 1 });
  const errors = [], warnings = [], external = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); if (message.type() === 'warning') warnings.push(message.text()); });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== host.url) { external.push(url.origin); return route.abort(); }
    return route.continue();
  });
  await page.goto(host.url); await page.waitForSelector('body[data-ready="true"]', { timeout: 60000 });
  assert.equal(await page.title(), 'Scene Kit Studio · 横版场景编辑');
  assert.doesNotMatch(await page.locator('body').innerText(), /合成来源测试|真实美术生成尚未接入/); await page.getByRole('button',{name:'画刷',exact:true}).click();
  assert.equal(await page.locator('vite-error-overlay,nextjs-portal').count(), 0);
  assert.equal(await page.locator('#canvas-host').getAttribute('data-terrain-appearance'), 'study');
  const snapshot = () => page.evaluate(async () => (await fetch('/api/state')).json());
  const waitRevision = previous => page.waitForFunction(revision => Number(document.body.dataset.revision) > revision, previous);
  const waitAppearance = mode => page.waitForFunction(value => document.getElementById('canvas-host').dataset.terrainAppearance === value
    && !document.getElementById('terrain-appearance').disabled, mode);
  const screenshots = process.env.SCENE_KIT_SCREENSHOTS;
  async function capture(name) { if (screenshots) { mkdirSync(screenshots, { recursive: true }); await page.screenshot({ path: join(screenshots, name), fullPage: true }); } }
  async function visible() { return page.locator('#minimap rect').last().evaluate(e => ({ x: +e.getAttribute('x'), y: +e.getAttribute('y'), width: +e.getAttribute('width'), height: +e.getAttribute('height') })); }
  async function screenPoint(x, y) {
    await dismissCanvasPanels(page);
    const rect = await page.locator('canvas').boundingBox(), bounds = await visible();
    return { x: rect.x + (x - bounds.x) / bounds.width * rect.width, y: rect.y + (y - bounds.y) / bounds.height * rect.height };
  }
  const initial = await snapshot();
  await t.test('appearance switch visibly changes terrain without editing the document, source or undo history', async () => {
    const study = await scenePixels(page);
    await (await canvasField(page,'terrain-appearance')).selectOption('fixture'); await waitAppearance('fixture');
    const fixture = await scenePixels(page); assert.notEqual(hash(study), hash(fixture));
    assert.deepEqual((await snapshot()).document, initial.document);
    assert.deepEqual((await snapshot()).history, initial.history);
    assert.equal((await snapshot()).scene.contentSha256, initial.scene.contentSha256);
    await (await canvasField(page,'terrain-appearance')).selectOption('study'); await waitAppearance('study');
    assert.equal(await page.locator('#palette img').first().getAttribute('src'), '/terrain-assets/p0-blob-124.png');
    assert.match(await page.locator('#appearance-note').innerText(), /未评审/);
    await capture('terrain-study-desktop.png');
  });
  await t.test('assembly thumbnails follow study phases and base artwork without editing or rebuilding the author map',async()=>{
    const before=await snapshot();await page.getByRole('button',{name:'组合',exact:true}).click();
    for(const mode of ['study','fixture','study']){
      if(mode!==await page.locator('#canvas-host').getAttribute('data-terrain-appearance')){await(await canvasField(page,'terrain-appearance')).selectOption(mode);await waitAppearance(mode);await dismissCanvasPanels(page);}
      for(const preset of initial.presets){const expected=preset.thumbnail.nodes.map(node=>{const key=mode==='study'?terrainStudyTextureKey(node):null;return key?initial.terrainPreview.modules.find(m=>m.key===key).url:initial.modules.find(m=>m.assetId===node.assetId).url;});
        const actual=await page.locator(`[data-asset-id="${preset.presetId}"] svg image`).evaluateAll(images=>images.map(image=>image.getAttribute('href')));assert.deepEqual(actual,expected);}
    }
    assert.equal((await snapshot()).revision,before.revision);assert.deepEqual((await snapshot()).history,before.history);assert.deepEqual((await snapshot()).document,before.document);await page.getByRole('button',{name:'画刷',exact:true}).click();
  });
  await t.test('a sparse brush stroke uses the existing atomic editor and one undo restores every affected role', async () => {
    await page.getByRole('button', { name: '画刷 B' }).click();
    const a = await screenPoint(9.5 * 64, 2.5 * 64), b = await screenPoint(12.5 * 64, 2.5 * 64);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y); await page.mouse.up(); await waitRevision(initial.revision);
    const painted = await snapshot(); assert.equal(painted.scene.counts.terrainNodes, 103); assert.equal(painted.history.undoDepth, 1);
    assert.equal(await page.locator('#canvas-host').getAttribute('data-terrain-appearance'), 'study');
    await page.getByRole('button', { name: '撤销', exact: true }).click(); await waitRevision(painted.revision);
    assert.equal((await snapshot()).scene.contentSha256, initial.scene.contentSha256);
    let before = await snapshot(); await page.getByRole('button', { name: '重做', exact: true }).click(); await waitRevision(before.revision);
    assert.equal((await snapshot()).scene.contentSha256, painted.scene.contentSha256);
    before = await snapshot(); await page.getByRole('button', { name: '撤销', exact: true }).click(); await waitRevision(before.revision);
  });
  await t.test('extension and camera travel keep world texture phase; sampled joins contain no background gaps', async () => {
    await page.getByRole('checkbox', { name: '网格', exact: true }).uncheck();
    await page.getByRole('button', { name: '默认镜头', exact: true }).click();
    const before = await snapshot(), imageBefore = await scenePixels(page);
    await (await canvasField(page,'extend')).click(); await waitRevision(before.revision);
    const expanded = await snapshot(); assert.equal(expanded.document.bounds.width, 80);
    assert.deepEqual(expanded.document.terrainRuns, before.document.terrainRuns);
    await panCanvas(page,'ArrowRight');
    await page.getByRole('button', { name: '默认镜头', exact: true }).click();
    assert.equal(hash(await scenePixels(page)), hash(imageBefore));
    // Full-height canvas now fits by width. Center the entire 64..384 sampling
    // domain before zooming so every original join and both neighbors stay visible.
    await centerCanvasHorizontally(page,(64+384)/2);
    for (const zoom of ['home', 'in', 'out']) {
      if (zoom !== 'home') await page.getByRole('button', { name: zoom === 'in' ? '放大' : '缩小', exact: true }).click();
      const image = inspectPng(await scenePixels(page), { includePixels: true }), bounds = await visible();
      const y = Math.floor((480 - bounds.y) / bounds.height * image.height);
      assert.ok(y > 0 && y < image.height);
      for (let cell = 1; cell <= 6; cell++) for (const offset of [-1, 0, 1]) {
        const x = Math.floor((cell * 64 - bounds.x) / bounds.width * image.width) + offset, p = (y * image.width + x) * 4;
        assert.ok(x>=1&&x<image.width-1,`join ${cell}/${zoom} must be inside the screenshot`);
        assert.notDeepEqual([...image.rgba.subarray(p, p + 3)], [29, 43, 59], `gap at join ${cell}/${zoom}`);
      }
    }
    assert.equal((await snapshot()).scene.contentSha256, expanded.scene.contentSha256);
    await capture('terrain-study-expanded.png');
  });
  await t.test('save and import keep author identity and retain the explicitly configured study appearance', async () => {
    const before = await snapshot(), event = page.waitForEvent('download');
    await page.locator('#download-menu>summary').click();
    await page.getByRole('button', { name: '地图 JSON', exact: true }).click();
    const download = await event, file = join(context.parent, 'saved.json'); await download.saveAs(file);
    const document = JSON.parse(readFileSync(file)); assert.deepEqual(document, before.document);
    assert.ok(!JSON.stringify(document).includes('terrainPreview'));
    await page.locator('#file').setInputFiles(file); await waitRevision(before.revision);
    const after = await snapshot(); assert.equal(after.scene.contentSha256, before.scene.contentSha256);
    assert.equal(after.history.undoDepth, 0); assert.equal(await (await canvasField(page,'terrain-appearance')).inputValue(), 'study');
  });
  await t.test('appearance controls and evidence remain readable at desktop and narrow sizes', async () => {
    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: 1050 }); await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow ${width}`);
      assert.equal(await page.locator('canvas').isVisible(), true); assert.equal(await (await canvasField(page,'terrain-appearance')).isVisible(), true);
    }
    await capture('terrain-study-narrow.png');
  });
  await t.test('an image load failure keeps the fixture and document, then an explicit user selection can recover', async () => {
    const failure = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
    const pageErrors = []; failure.on('pageerror', error => pageErrors.push(error.message));
    const blocked = '**/terrain-assets/p0-blob-000.png'; await failure.route(blocked, route => route.abort());
    await failure.goto(host.url); await failure.waitForSelector('body[data-ready="true"]', { timeout: 60000 });
    assert.equal(await failure.locator('#canvas-host').getAttribute('data-terrain-appearance'), 'fixture');
    assert.match(await failure.locator('#status').innerText(), /原外观与地图保留/);
    const before = await snapshot();
    await failure.unroute(blocked); await (await canvasField(failure,'terrain-appearance')).selectOption('study');
    await failure.waitForFunction(() => document.getElementById('canvas-host').dataset.terrainAppearance === 'study');
    assert.equal((await snapshot()).scene.contentSha256, before.scene.contentSha256);
    assert.deepEqual(pageErrors, []); await failure.close();
  });
  assert.deepEqual(errors, []); assert.deepEqual(warnings, []); assert.deepEqual(external, []);
});
