import {canvasField,selectObject,dismissCanvasPanels,scenePixels} from './canvas-controls.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { buildStudio, dependency } from '../../scripts/studio-build.mjs';
import { startStudio } from '../../src/studio/host.mjs';
import { prepareTerrainPreview } from '../helpers/terrain-preview.mjs';
import { fixtureRoot } from '../helpers/generation.mjs';
import { inspectPng } from '../../src/png.mjs';

const roots = process.env.SCENE_KIT_DEPENDENCIES?.split(delimiter).filter(Boolean) ?? [];
test('height curves: rendered material, point/tangent gestures, cancellation, validation and v6 round trip', { timeout: 180000 }, async t => {
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
  await page.route('**/*', route => { if (new URL(route.request().url()).origin !== host.url) { external.push(route.request().url()); return route.abort(); } return route.continue(); });
  await page.goto(host.url); await page.waitForSelector('body[data-ready="true"]', { timeout: 60000 });
  assert.match(await page.title(), /Scene Kit Studio/); assert.equal(await page.locator('vite-error-overlay,nextjs-portal').count(), 0);
  const snapshot = () => page.evaluate(async () => (await fetch('/api/state')).json());
  const waitRevision = revision => page.waitForFunction(value => Number(document.body.dataset.revision) > value, revision);
  async function screenPoint(x, y) {
    await dismissCanvasPanels(page);
    const rect = await page.locator('canvas').boundingBox(), visible = await page.locator('#minimap rect').last().evaluate(e => ({ x: +e.getAttribute('x'), y: +e.getAttribute('y'), width: +e.getAttribute('width'), height: +e.getAttribute('height') }));
    return { x: rect.x + (x - visible.x) / visible.width * rect.width, y: rect.y + (y - visible.y) / visible.height * rect.height };
  }
  async function capture(name) { if (process.env.SCENE_KIT_SCREENSHOTS) { mkdirSync(process.env.SCENE_KIT_SCREENSHOTS, { recursive: true }); await page.screenshot({ path: join(process.env.SCENE_KIT_SCREENSHOTS, name), fullPage: true }); } }
  const initial = await snapshot();
  await t.test('add hill explicitly upgrades once, extends one screen and renders both material meshes', async () => {
    await (await canvasField(page,'add-curve')).click(); await waitRevision(initial.revision);
    const after = await snapshot(); assert.equal(after.document.format, 'ai_scene_document_v6');
    assert.equal(after.scene.format, 'ai_scene_compiled_v7'); assert.equal(after.document.bounds.width, 80);
    assert.equal(after.document.curveTerrains.length, 1); assert.equal(after.history.undoDepth, 1);
    assert.deepEqual(after.document.terrainRuns, initial.document.terrainRuns);
    assert.equal(after.scene.collisionSuggestions.curveContours.length, 1);
    assert.equal(await page.getByRole('button', { name: '曲线 C', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('checkbox', { name: '网格', exact: true }).uncheck();
    const center = after.document.curveTerrains[0].points[1], point = await screenPoint(center.x, 540), rect = await page.locator('canvas').boundingBox();
    const image = inspectPng(await scenePixels(page), { includePixels: true });
    const p = (Math.floor(point.y - rect.y) * image.width + Math.floor(point.x - rect.x)) * 4;
    assert.notDeepEqual([...image.rgba.subarray(p, p + 3)], [29, 43, 59]);
    assert.equal((await snapshot()).terrainPreview.materialFields.body.key, 'body-field');
    await capture('curve-hill-desktop.png');
  });
  await t.test('point dragging previews without a commit and releases as one undoable command', async () => {
    const before = await snapshot(), anchor = before.document.curveTerrains[0].points[1], a = await screenPoint(anchor.x, anchor.y), b = await screenPoint(anchor.x, anchor.y - 48);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y);
    assert.equal((await snapshot()).revision, before.revision);
    await page.mouse.up(); await waitRevision(before.revision);
    const moved = await snapshot(); assert.ok(Math.abs(moved.document.curveTerrains[0].points[1].y - (anchor.y - 48)) <= 2);
    assert.equal(moved.history.undoDepth, before.history.undoDepth + 1);
    await page.getByRole('button', { name: '撤销', exact: true }).click(); await waitRevision(moved.revision);
    assert.equal((await snapshot()).scene.contentSha256, before.scene.contentSha256);
    const undo = await snapshot(); await page.getByRole('button', { name: '重做', exact: true }).click(); await waitRevision(undo.revision);
    assert.equal((await snapshot()).scene.contentSha256, moved.scene.contentSha256);
  });
  await t.test('tangent dragging changes a shared interior tangent and canceled gestures leave author/history intact', async () => {
    const before = await snapshot(), anchor = before.document.curveTerrains[0].points[1];
    const a = await screenPoint(anchor.x + 64, anchor.y), b = await screenPoint(anchor.x + 64, anchor.y + 24);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y); await page.mouse.up(); await waitRevision(before.revision);
    const changed = await snapshot(); assert.ok(changed.document.curveTerrains[0].points[1].slope > .3 && changed.document.curveTerrains[0].points[1].slope < .45);
    for (const type of ['escape', 'blur', 'pointercancel', 'lostpointercapture']) {
      const p = changed.document.curveTerrains[0].points[1], start = await screenPoint(p.x, p.y), end = await screenPoint(p.x, p.y + 20);
      await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y);
      if (type === 'escape') await page.keyboard.press('Escape');
      else await page.evaluate(value => value === 'blur' ? window.dispatchEvent(new Event('blur')) : document.querySelector('canvas').dispatchEvent(new PointerEvent(value, { pointerId: 1 })), type);
      await page.mouse.up(); assert.equal((await snapshot()).scene.contentSha256, changed.scene.contentSha256);
      assert.deepEqual((await snapshot()).history, changed.history);
    }
  });
  await t.test('invalid point order is rejected atomically, while insertion and deletion remain editable', async () => {
    const before = await snapshot(); await (await canvasField(page,'curve-x')).fill(String(before.document.curveTerrains[0].points[0].x + 1));
    await page.getByRole('button', { name: '应用曲线参数', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('status').dataset.error === 'true');
    assert.equal((await snapshot()).revision, before.revision); assert.deepEqual((await snapshot()).history, before.history);
    await (await canvasField(page,'curve-x')).fill(String(before.document.curveTerrains[0].points[1].x));
    await page.getByRole('button', { name: '插入点', exact: true }).click(); await waitRevision(before.revision);
    const inserted = await snapshot(); assert.equal(inserted.document.curveTerrains[0].points.length, 4);
    await (await canvasField(page,'curve-point')).selectOption('2');
    await page.getByRole('button', { name: '删除点', exact: true }).click(); await waitRevision(inserted.revision);
    assert.equal((await snapshot()).document.curveTerrains[0].points.length, 3);
  });
  await t.test('layer lock blocks both curve handles and contextual actions without changing history', async () => {
    const before=await snapshot(),point=before.document.curveTerrains[0].points[1];
    const lock=page.getByRole('button',{name:'锁定图层 terrain',exact:true});await lock.click();
    assert.equal(await page.locator('#insert-curve-point').isDisabled(),true);
    const start=await screenPoint(point.x,point.y),end=await screenPoint(point.x,point.y+20);
    await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:6});await page.mouse.up();
    await page.locator('#tab-curves').click();const entry=await page.locator('#palette button').first().boundingBox();
    await page.mouse.move(entry.x+entry.width/2,entry.y+entry.height/2);await page.mouse.down();
    await page.mouse.move(entry.x+entry.width/2+15,entry.y+entry.height/2,{steps:4});await page.mouse.move(start.x,start.y,{steps:14});await page.mouse.up();
    const after=await snapshot();assert.equal(after.scene.source.authorSha256,before.scene.source.authorSha256);assert.deepEqual(after.history,before.history);
    await lock.click();assert.equal(await page.locator('#remove-curve').isEnabled(),true);
  });
  await t.test('curve save/open, collision overlay and editor/preview modes keep the v6 author identity', async () => {
    await page.locator('#download-menu>summary').click();
    const before = await snapshot(), event = page.waitForEvent('download'); await page.getByRole('button', { name: '地图 JSON', exact: true }).click();
    const download = await event, file = join(context.parent, 'curves.saved.json'); await download.saveAs(file);
    assert.deepEqual(JSON.parse(readFileSync(file)), before.document);
    await page.locator('#file').setInputFiles(file); await waitRevision(before.revision);
    const opened = await snapshot(); assert.equal(opened.scene.contentSha256, before.scene.contentSha256); assert.equal(opened.history.undoDepth, 0);
    await (await canvasField(page,'collision')).check();
    await page.getByRole('button', { name: 'Play Mode', exact: true }).click(); assert.equal(await page.locator('#apply-curve').isDisabled(), true);
    await page.getByRole('button', { name: '退出 Play Mode', exact: true }).click();
    assert.equal((await snapshot()).scene.contentSha256, opened.scene.contentSha256);
    await (await canvasField(page,'curve-selection')).selectOption(opened.document.curveTerrains[0].curveId); await capture('curve-edited-collision.png');
  });
  await t.test('valley and slope presets work, and all controls fit desktop and narrow viewports', async () => {
    for (const preset of ['valley', 'slope']) {
      await (await canvasField(page,'curve-template')).selectOption(preset); const before = await snapshot();
      await (await canvasField(page,'add-curve')).click(); await waitRevision(before.revision);
      assert.equal((await snapshot()).document.curveTerrains.length, before.document.curveTerrains.length + 1);
    }
    for (const width of [1440, 1024, 390]) { await page.setViewportSize({ width, height: 1050 }); await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow at ${width}`);
      assert.equal(await (await canvasField(page,'add-curve')).isVisible(), true); }
    await capture('curve-narrow.png');
  });
  const deliberate = errors.filter(message => message.includes('422 (Unprocessable Entity)'));
  assert.equal(deliberate.length, 1); assert.deepEqual(errors.filter(message => !deliberate.includes(message)), []);
  assert.deepEqual(warnings, []); assert.deepEqual(external, []);
});
