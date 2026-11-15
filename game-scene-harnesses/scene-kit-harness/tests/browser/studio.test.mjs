import {canvasField,selectObject,dismissCanvasPanels,panCanvas} from './canvas-controls.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { buildStudio, dependency, packageRoot } from '../../scripts/studio-build.mjs';
import { startStudio } from '../../src/studio/host.mjs';

const roots = process.env.SCENE_KIT_DEPENDENCIES?.split(delimiter).filter(Boolean) ?? [];
test('local Pixi Studio: rendered editing, cancellation, history, round trip and responsive layout', { timeout: 120000 }, async t => {
  const temporary = mkdtempSync(join(tmpdir(), 'scene-kit-browser-'));
  const staticRoot = await buildStudio({ roots, output: join(temporary, 'static') });
  const host = await startStudio({ root: join(packageRoot, 'tests/fixtures/synthetic'), staticRoot });
  let browser;
  t.after(async () => { await browser?.close(); await host.close(); rmSync(temporary, { recursive: true, force: true }); });
  const { chromium } = dependency('playwright', roots).require('playwright');
  browser = await chromium.launch({ headless: true, ...(process.env.SCENE_KIT_BROWSER_CHANNEL ? { channel: process.env.SCENE_KIT_BROWSER_CHANNEL } : {}), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--explicitly-allowed-ports='+new URL(host.url).port] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 1 });
  const errors = [], warnings = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); if (message.type() === 'warning') warnings.push(message.text()); });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== host.url) { requests.push(url.origin); return route.abort(); }
    return route.continue();
  });
  await page.goto(host.url);
  await page.waitForSelector('body[data-ready="true"]', { timeout: 30000 });
  assert.match(await page.title(), /Scene Kit Studio/);
  assert.match(await page.locator('body').innerText(), /模块库/);
  const snapshot = () => page.evaluate(async () => (await fetch('/api/state')).json());
  const waitRevision = revision => page.waitForFunction(value => Number(document.body.dataset.revision) > value, revision);
  async function screenPoint(x, y) {
    await dismissCanvasPanels(page);
    const rect = await page.locator('canvas').boundingBox();
    const visible = await page.locator('#minimap rect').last().evaluate(element => ({ x: +element.getAttribute('x'), y: +element.getAttribute('y'), width: +element.getAttribute('width'), height: +element.getAttribute('height') }));
    return { x: rect.x + (x - visible.x) / visible.width * rect.width, y: rect.y + (y - visible.y) / visible.height * rect.height };
  }
  const clickCell = (x, y) => screenPoint((x + .5) * 64, (y + .5) * 64);
  const initial = await snapshot();
  assert.equal(await page.locator('vite-error-overlay,nextjs-portal').count(), 0);
  const screenshots = process.env.SCENE_KIT_SCREENSHOTS;
  if (screenshots) { mkdirSync(screenshots, { recursive: true }); await page.screenshot({ path: join(screenshots, 'scene-kit-default.png'), fullPage: true }); }
  await t.test('one sparse pointer stroke paints four cells and undoes/redoes as one operation after zoom', async () => {
    await page.getByRole('button', { name: '放大', exact: true }).click();
    await page.getByRole('button', { name: '画刷 B' }).click();
    const start = await clickCell(9, 2), end = await clickCell(12, 2);
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y); await page.mouse.up();
    await waitRevision(0);
    const drawn = await snapshot();
    assert.equal(drawn.scene.counts.terrainNodes, 103); assert.equal(drawn.history.undoDepth, 1);
    await page.getByRole('button', { name: '撤销', exact: true }).click(); await waitRevision(1);
    assert.equal((await snapshot()).scene.contentSha256, initial.scene.contentSha256);
    await page.getByRole('button', { name: '重做', exact: true }).click(); await waitRevision(2);
    assert.equal((await snapshot()).scene.contentSha256, drawn.scene.contentSha256);
  });
  await t.test('Esc, blur and pointer cancellation discard an uncommitted stroke', async () => {
    const before = await snapshot();
    for (const type of ['escape', 'blur', 'pointercancel', 'lostpointercapture']) {
      const position = await clickCell(10, 3);
      await page.mouse.move(position.x, position.y); await page.mouse.down(); await page.mouse.move(position.x + 30, position.y);
      if (type === 'escape') await page.keyboard.press('Escape');
      else await page.evaluate(value => value === 'blur' ? window.dispatchEvent(new Event('blur')) : document.querySelector('canvas').dispatchEvent(new PointerEvent(value, { pointerId: 1 })), type);
      await page.mouse.up();
      assert.equal((await snapshot()).scene.contentSha256, before.scene.contentSha256);
      assert.equal((await snapshot()).history.undoDepth, before.history.undoDepth);
    }
  });
  await t.test('environment placement, explicit movement, duplication and delete use the core editor', async () => {
    await page.getByRole('button', { name: '素材', exact: true }).click();
    await page.getByRole('button', { name: '放置模块 environment-marker', exact: true }).click();
    await (await canvasField(page,'cell-x')).fill('10'); await (await canvasField(page,'cell-y')).fill('3');
    let before = await snapshot();
    await (await canvasField(page,'apply-cell')).click(); await waitRevision(before.revision);
    const added = await snapshot();
    assert.equal(added.scene.counts.visualNodes, 5);
    const instance = added.document.instances.find(item => item.instanceId.startsWith('user.'));
    await selectObject(page,instance.instanceId);
    await (await canvasField(page,'object-x')).fill('700'); await (await canvasField(page,'object-y')).fill('260');
    await page.getByRole('button', { name: '应用位置', exact: true }).click(); await waitRevision(added.revision);
    assert.equal((await snapshot()).document.instances.find(item => item.instanceId === instance.instanceId).x, 700);
    await page.getByRole('button', { name: '选择 V' }).click();
    const moveScene = await snapshot();
    const node = moveScene.scene.layers.flatMap(layer => layer.nodes).find(node => node.nodeId === `visual/${instance.instanceId}`);
    const dragStart = await screenPoint(node.position.x + node.size.width / 2, node.position.y + node.size.height / 2);
    const dragEnd = await screenPoint(node.position.x + node.size.width / 2 + 64, node.position.y + node.size.height / 2);
    await page.mouse.move(dragStart.x, dragStart.y); await page.mouse.down(); await page.mouse.move(dragEnd.x, dragEnd.y); await page.mouse.up();
    await waitRevision(moveScene.revision);
    assert.equal((await snapshot()).document.instances.find(item => item.instanceId === instance.instanceId).x, 764);
    before = await snapshot(); await page.getByRole('button', { name: '复制', exact: true }).click(); await waitRevision(before.revision);
    assert.equal((await snapshot()).scene.counts.visualNodes, 6);
    before = await snapshot(); await page.getByRole('button', { name: '删除', exact: true }).click(); await waitRevision(before.revision);
    assert.equal((await snapshot()).scene.counts.visualNodes, 5);
  });
  await t.test('a module-library preset is placed as one undoable assembly', async () => {
    const before = await snapshot();
    await page.getByRole('button', { name: '组合', exact: true }).click();
    await page.getByRole('button', { name: '放置组合 platform.small', exact: true }).click();
    await (await canvasField(page,'cell-x')).fill('22'); await (await canvasField(page,'cell-y')).fill('1');
    await (await canvasField(page,'apply-cell')).click(); await waitRevision(before.revision);
    const after = await snapshot();
    assert.equal(after.document.assemblyInstances.length, before.document.assemblyInstances.length + 1);
    assert.equal(after.scene.counts.terrainNodes, before.scene.counts.terrainNodes + 4);
    assert.equal(after.scene.counts.visualNodes, before.scene.counts.visualNodes + 1);
    await page.getByRole('button', { name: '撤销', exact: true }).click(); await waitRevision(after.revision);
    assert.equal((await snapshot()).scene.contentSha256, before.scene.contentSha256);
  });
  await t.test('painting existing assembly terrain skips a no-op; explicit expansion remains available', async () => {
    await selectObject(page,'pair.main');
    const before = await snapshot();
    await page.getByRole('button', { name: '画刷 B' }).click();
    await (await canvasField(page,'cell-x')).fill('50'); await (await canvasField(page,'cell-y')).fill('3');
    await (await canvasField(page,'apply-cell')).click();
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('未重复绘制'));
    assert.equal((await snapshot()).revision, before.revision);
    await page.getByRole('button', { name: '展开组合', exact: true }).click(); await waitRevision(before.revision);
    const after = await snapshot(); assert.deepEqual(after.scene.counts, before.scene.counts);
    assert.equal(after.document.assemblyInstances.length, 0);
    await page.getByRole('button', { name: '擦除 E' }).click();
    await (await canvasField(page,'apply-cell')).click(); await waitRevision(after.revision);
    assert.equal((await snapshot()).scene.counts.terrainNodes, after.scene.counts.terrainNodes - 1);
  });
  await t.test('bounds extend without moving old data; layers/preview/camera do not edit the author document', async () => {
    const before = await snapshot();
    await (await canvasField(page,'extend')).click(); await waitRevision(before.revision);
    const after = await snapshot(); assert.equal(after.document.bounds.width, 80);
    assert.deepEqual(after.document.terrainRuns, before.document.terrainRuns);
    const environmentEye=page.locator('[data-layer-group="environment"] [data-source-layer="environment"] .layer-heading input');
    await environmentEye.uncheck();
    await (await canvasField(page,'collision')).check();
    await page.getByRole('button', { name: 'Play Mode', exact: true }).click();
    assert.equal(await page.locator('#apply-cell').isDisabled(), true);
    assert.equal(await page.locator('#fit').isDisabled(), true);
    await panCanvas(page,'ArrowRight');
    assert.equal((await snapshot()).scene.contentSha256, after.scene.contentSha256);
    await page.getByRole('button', { name: '退出 Play Mode', exact: true }).click();
    await environmentEye.check();
    const rect = await page.locator('canvas').boundingBox();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(rect.x + rect.width / 2 + 40, rect.y + rect.height / 2);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    const stopped = await page.locator('#minimap rect').last().getAttribute('x');
    await page.mouse.up({ button: 'right' });
    await page.mouse.move(rect.x + rect.width / 2 + 80, rect.y + rect.height / 2);
    assert.equal(await page.locator('#minimap rect').last().getAttribute('x'), stopped, 'blur releases camera drag ownership');
    await page.getByRole('button', { name: '全图', exact: true }).focus();
    await page.keyboard.press('Control+z'); await waitRevision(after.revision);
    assert.equal((await snapshot()).document.bounds.width, before.document.bounds.width);
    const undone = await snapshot();
    await page.keyboard.press('Control+Shift+z'); await waitRevision(undone.revision);
    assert.equal((await snapshot()).scene.contentSha256, after.scene.contentSha256);
  });
  await t.test('browser download and file import preserve the author digest; a rejected import preserves history', async () => {
    const before = await snapshot();
    await page.locator('#download-menu>summary').click();
    const downloadEvent = page.waitForEvent('download'); await page.getByRole('button', { name: '地图 JSON', exact: true }).click();
    const download = await downloadEvent; const path = join(temporary, 'saved.json'); await download.saveAs(path);
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), before.document);
    await page.locator('#file').setInputFiles(path); await waitRevision(before.revision);
    const opened = await snapshot(); assert.equal(opened.scene.contentSha256, before.scene.contentSha256); assert.equal(opened.history.undoDepth, 0);
    const invalid = structuredClone(opened.document); invalid.kitRef.revision = 'wrong-revision';
    await page.locator('#file').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(invalid)) });
    await page.waitForFunction(() => document.getElementById('status').dataset.error === 'true');
    assert.equal((await snapshot()).revision, opened.revision); assert.deepEqual((await snapshot()).history, opened.history);
  });
  // Restore a valid document after deliberate rejection before visual capture.
  const current = await snapshot();
  await page.locator('#file').setInputFiles({ name: 'valid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(current.document)) });
  await waitRevision(current.revision);
  await page.getByRole('button', { name: '默认镜头', exact: true }).click();
  if (screenshots) { mkdirSync(screenshots, { recursive: true }); await page.screenshot({ path: join(screenshots, 'scene-kit-desktop.png'), fullPage: true }); }
  await t.test('desktop and narrow layout keep controls readable without horizontal overflow', async () => {
    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: 1050 });
      await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `overflow at ${width}`);
      assert.equal(await page.locator('canvas').isVisible(), true);
      assert.equal(await page.locator('#download-menu>summary').isVisible(), true);
    }
    if (screenshots) await page.screenshot({ path: join(screenshots, 'scene-kit-narrow.png'), fullPage: true });
  });
  const deliberateRejections = errors.filter(message => message === 'Failed to load resource: the server responded with a status of 422 (Unprocessable Entity)');
  assert.equal(deliberateRejections.length, 1, 'invalid map import returns HTTP 422; painting existing terrain makes no request');
  assert.deepEqual(errors.filter(message => !deliberateRejections.includes(message)), []);
  assert.deepEqual(warnings, []); assert.deepEqual(requests, []);
});
