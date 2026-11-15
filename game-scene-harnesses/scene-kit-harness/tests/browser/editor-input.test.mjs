import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { buildStudio, dependency } from '../../scripts/studio-build.mjs';
import { startStudio } from '../../src/studio/host.mjs';
import { loadSceneKit, readMap } from '../../src/kit.mjs';
import { fixtureRoot } from '../helpers/generation.mjs';
import { canvasField } from './canvas-controls.mjs';

test('Studio input cancels accidental edits and keeps valid mouse, pen, keyboard and touch operations usable', { timeout: 120000 }, async t => {
  const base = resolve(process.env.SCENE_KIT_BROWSER_TEMP_ROOT ?? tmpdir());
  const temp = mkdtempSync(join(base, 'scene-editor-input-'));
  let browser, host;
  t.after(async () => {
    await browser?.close();
    await host?.close();
    assert.equal(dirname(temp), base);
    rmSync(temp, { recursive: true, force: true });
  });
  const document = readMap(loadSceneKit(fixtureRoot));
  document.terrainRuns = [];
  document.assemblyInstances = [];
  document.inspectionCases = [];
  document.instances = [{ instanceId: 'input.marker', assetId: 'environment-marker', layerId: 'environment', x: 400, y: 200 }];
  host = await startStudio({ root: fixtureRoot, staticRoot: await buildStudio({ output: join(temp, 'static') }),
    initialDocument: document, workspaceRoot: join(temp, 'workspace') });
  const { chromium } = dependency('playwright').require('playwright');
  browser = await chromium.launch({ headless: true, channel: process.env.SCENE_KIT_BROWSER_CHANNEL ?? 'msedge',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--explicitly-allowed-ports=' + new URL(host.url).port] });
  const writes = [], errors = [], external = [];
  async function openPage(options) {
    const page = await browser.newPage(options);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== host.url) { external.push(url.href); return route.abort(); }
      if (request.method() === 'POST') writes.push(url.pathname);
      return route.continue();
    });
    await page.goto(host.url + '/editor');
    await page.waitForSelector('body[data-ready="true"]');
    return page;
  }
  const page = await openPage({ viewport: { width: 1440, height: 950 } });
  async function capture(page, name) {
    const dir = process.env.SCENE_KIT_SCREENSHOTS;
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: join(dir, name) });
  }
  const snapshot = async () => (await fetch(host.url + '/api/state', { headers: { connection: 'close' } })).json();
  const waitRevision = (page, revision) => page.waitForFunction(value => Number(document.body.dataset.revision) > value, revision);
  async function point(page, worldX, worldY) {
    const rect = await page.locator('canvas').boundingBox();
    const view = await page.locator('#minimap rect').last().evaluate(e =>
      Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Number(e.getAttribute(key))])));
    return { x: rect.x + (worldX - view.x) * rect.width / view.width, y: rect.y + (worldY - view.y) * rect.height / view.height };
  }
  async function expectUntouched(before, count) {
    const after = await snapshot();
    assert.equal(after.revision, before.revision);
    assert.equal(after.scene.source.authorSha256, before.scene.source.authorSha256);
    assert.deepEqual(after.history, before.history);
    assert.equal(writes.length, count);
  }

  await t.test('click-to-place commits on release and ignores drag-away and canceled pen strokes', async () => {
    await page.locator('#tab-environment').click();
    const module = page.locator('#palette [data-asset-id="environment-marker"]');
    await module.click();
    const start = await point(page, 700, 200), before = await snapshot(), count = writes.length;
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    try {
      await expectUntouched(before, count);
      await page.mouse.move(start.x + 80, start.y, { steps: 4 });
    } finally { await page.mouse.up(); }
    await expectUntouched(before, count);
    assert.equal(await module.getAttribute('aria-pressed'), 'true');
    const cdp = await page.context().newCDPSession(page);
    const pen = type => cdp.send('Input.dispatchMouseEvent', { type, x: start.x, y: start.y,
      pointerType: 'pen', button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    await pen('mousePressed');
    await page.keyboard.press('Escape');
    await pen('mouseReleased');
    await expectUntouched(before, count);
    if (await module.getAttribute('aria-pressed') !== 'true') await module.click();
    await pen('mousePressed');
    await pen('mouseReleased');
    await waitRevision(page, before.revision);
    const placed = await snapshot();
    assert.equal(placed.document.instances.length, before.document.instances.length + 1);
    assert.equal(placed.history.undoDepth, before.history.undoDepth + 1);
    await page.getByRole('checkbox', { name: '显示对象 input.marker', exact: true }).focus();
    await page.keyboard.press('Control+z');
    await waitRevision(page, placed.revision);
    const undone = await snapshot();
    assert.equal(undone.scene.source.authorSha256, before.scene.source.authorSha256);
    await page.keyboard.press('Control+y');
    await waitRevision(page, undone.revision);
    assert.equal((await snapshot()).scene.source.authorSha256, placed.scene.source.authorSha256);
    await cdp.detach();
  });

  await t.test('Ctrl-drag previews and commits whole-cell offsets without realigning an off-grid asset', async () => {
    await page.locator('[data-tool="select"]').click();
    const before = await snapshot(), count = writes.length;
    const instance = state => state.document.instances.find(row => row.instanceId === 'input.marker');
    const { width, height } = before.scene.grid;
    const marker = before.scene.layers.flatMap(layer => layer.nodes).find(node => node.nodeId === 'visual/input.marker');
    const x = marker.position.x + marker.size.width / 2, y = marker.position.y + marker.size.height / 2;
    const start = await point(page, x, y), target = await point(page, x + width * .72, y - height * .72);
    const snapped = await point(page, x + width, y - height);
    const hint = page.getByText('按格移动', { exact: true });
    const selectionX = () => page.locator('#selection-tools').evaluate(el => el.getBoundingClientRect().x);

    await page.mouse.move(start.x, start.y);
    await page.keyboard.down('Control');
    await page.mouse.down();
    try {
      await hint.waitFor({ state: 'visible' });
      const originalX = await selectionX();
      await page.mouse.move(target.x, target.y, { steps: 4 });
      assert(Math.abs(await selectionX() - originalX - (snapped.x - start.x)) < 2);
      await expectUntouched(before, count);
      await page.keyboard.up('Control');
      await hint.waitFor({ state: 'hidden' });
      assert(Math.abs(await selectionX() - originalX - (target.x - start.x)) < 2);
      await page.keyboard.down('Control');
      await hint.waitFor({ state: 'visible' });
    } finally { await page.mouse.up(); await page.keyboard.up('Control'); }
    await waitRevision(page, before.revision);
    const moved = await snapshot(), item = instance(before);
    assert.deepEqual(instance(moved), { ...item, x: item.x + width, y: item.y - height });
    assert.equal(moved.history.undoDepth, before.history.undoDepth + 1);
    assert.equal(writes.length, count + 1);

    await page.keyboard.press('Control+z');
    await waitRevision(page, moved.revision);
    const undone = await snapshot(), restoredWrites = writes.length;
    assert.deepEqual(instance(undone), item);
    await page.mouse.move(start.x, start.y);
    await page.keyboard.down('Control');
    await page.mouse.down();
    try {
      await page.mouse.move(target.x, target.y, { steps: 4 });
      await hint.waitFor({ state: 'visible' });
      await page.keyboard.press('Escape');
    } finally { await page.mouse.up(); await page.keyboard.up('Control'); }
    await hint.waitFor({ state: 'hidden' });
    await expectUntouched(undone, restoredWrites);
  });

  await t.test('empty and fractional coordinates receive field feedback, and explicit zero still works', async () => {
    await page.locator('[data-instance-id="input.marker"]').click();
    const x = await canvasField(page, 'object-x'), y = page.locator('#object-y'), apply = page.locator('#move');
    const before = await snapshot(), count = writes.length;
    await x.fill('');
    await apply.click();
    assert.equal(await x.getAttribute('aria-invalid'), 'true');
    assert.equal(await page.locator('#object-x-error').innerText(), '请输入整数。');
    assert.equal(await x.evaluate(input => document.activeElement === input), true);
    await expectUntouched(before, count);
    await capture(page, 'invalid-coordinate.png');
    await x.fill('1.5');
    await apply.click();
    assert.equal(await x.getAttribute('aria-invalid'), 'true');
    await expectUntouched(before, count);
    await x.fill('0');
    assert.notEqual(await x.getAttribute('aria-invalid'), 'true');
    await y.fill('0');
    await y.press('Enter');
    await waitRevision(page, before.revision);
    assert.deepEqual((await snapshot()).document.instances.find(row => row.instanceId === 'input.marker'),
      { instanceId: 'input.marker', assetId: 'environment-marker', layerId: 'environment', x: 0, y: 0 });
  });

  await t.test('composing text, editable controls and repeated Delete leave the selected instance intact', async () => {
    await page.locator('[data-instance-id="input.marker"]').click();
    const before = await snapshot(), count = writes.length;
    const tool = () => page.locator('body').getAttribute('data-active-tool');
    await page.locator('body').dispatchEvent('keydown', { key: 'Delete', isComposing: true, bubbles: true });
    await page.locator('body').dispatchEvent('keydown', { key: 'b', isComposing: true, bubbles: true });
    await page.locator('body').dispatchEvent('keydown', { key: 'Delete', repeat: true, bubbles: true });
    await page.locator('body').evaluate(body => {
      const field = body.appendChild(document.createElement('div'));
      field.id = 'input-test-editable';
      field.contentEditable = 'true';
      field.focus();
    });
    await page.keyboard.type('be');
    await page.keyboard.press('Delete');
    await page.keyboard.press('Control+z');
    assert.equal(await tool(), 'select');
    await expectUntouched(before, count);
    await page.locator('#input-test-editable').evaluate(field => field.remove());
  });

  await t.test('a malformed file and a file read overtaken by an edit preserve the current map', async () => {
    const input = page.locator('#file'), before = await snapshot(), count = writes.length;
    const selectInvalid = () => input.setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{') });
    const waitInvalid = () => page.waitForFunction(() => document.querySelector('#status').textContent.includes('JSON'));
    const selectDelayed = doc => input.evaluate((input, source) => {
      const file = new File([source], 'late.json', { type: 'application/json' });
      file.text = () => new Promise(resolve => { window.finishTestFile = () => resolve(source); });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, JSON.stringify(doc));
    await selectInvalid();
    await waitInvalid();
    await expectUntouched(before, count);
    await selectDelayed(before.document);
    await page.getByRole('button', { name: '画刷 B' }).click();
    const target = await point(page, 550, 180);
    await page.mouse.click(target.x, target.y);
    await waitRevision(page, before.revision);
    const edited = await snapshot();
    await page.evaluate(() => window.finishTestFile());
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('读取期间'));
    await expectUntouched(edited, count + 1);
    assert.equal(edited.workspace.activeMapId, before.workspace.activeMapId);
    await selectDelayed(before.document);
    await selectInvalid();
    await waitInvalid();
    await page.evaluate(() => window.finishTestFile());
    await expectUntouched(edited, count + 1);
    const loaded = page.waitForEvent('load');
    await input.setInputFiles({ name: 'reopened.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(edited.document)) });
    await loaded;
    await page.waitForSelector('body[data-ready="true"]');
    const imported = await snapshot();
    assert.notEqual(imported.workspace.activeMapId, before.workspace.activeMapId);
    assert.equal(imported.scene.source.authorSha256, edited.scene.source.authorSha256);
  });

  await t.test('a two-finger interruption cancels a touch stroke and a subsequent tap paints once', async () => {
    const mobile = await openPage({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce' });
    await mobile.getByRole('button', { name: '画刷 B' }).tap();
    const first = await point(mobile, 680, 200), second = { x: first.x + 45, y: first.y + 15 };
    const cdp = await mobile.context().newCDPSession(mobile);
    const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
    const before = await snapshot(), count = writes.length;
    await touch('touchStart', [{ ...first, id: 1 }]);
    await touch('touchMove', [{ x: first.x + 16, y: first.y, id: 1 }]);
    await touch('touchStart', [{ x: first.x + 16, y: first.y, id: 1 }, { ...second, id: 2 }]);
    await touch('touchEnd', []);
    await expectUntouched(before, count);
    await mobile.touchscreen.tap(first.x, first.y);
    await waitRevision(mobile, before.revision);
    const painted = await snapshot();
    assert.equal(painted.history.undoDepth, before.history.undoDepth + 1);
    assert.equal(writes.length, count + 1);
    for (const viewport of [{ width: 375, height: 812 }, { width: 812, height: 375 }]) {
      await mobile.setViewportSize(viewport);
      assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    await mobile.close();
  });

  await t.test('touch swipes scroll over library cards and a horizontal asset drag still places one object', async () => {
    const mobile = await openPage({ viewport: { width: 812, height: 375 }, hasTouch: true, reducedMotion: 'reduce' });
    const cdp = await mobile.context().newCDPSession(mobile);
    const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
    const library = mobile.locator('#module-library');
    await mobile.getByRole('button', { name: '模块库', exact: true }).tap();
    await mobile.locator('#tab-curves').tap();
    const card = await mobile.getByRole('button', { name: '丘陵', exact: true }).boundingBox();
    assert(await library.evaluate(panel => panel.scrollHeight > panel.clientHeight));
    const before = await snapshot(), count = writes.length, x = card.x + card.width / 2, y = card.y + card.height / 2;
    await touch('touchStart', [{ x, y, id: 1 }]);
    for (let i = 1; i <= 5; i++) await touch('touchMove', [{ x, y: y - i * 14, id: 1 }]);
    await touch('touchEnd', []);
    await mobile.waitForFunction(() => document.querySelector('#module-library').scrollTop > 10);
    assert.equal(await mobile.locator('body').getAttribute('data-active-tool'), 'select');
    await expectUntouched(before, count);
    await capture(mobile, 'touch-library.png');
    await mobile.locator('#tab-environment').tap();
    const asset = await mobile.locator('#palette [data-asset-id="environment-marker"]').boundingBox();
    const start = { x: asset.x + asset.width / 2, y: asset.y + asset.height / 2, id: 1 };
    const target = { ...(await point(mobile, 700, 220)), id: 1 };
    await touch('touchStart', [start]);
    await touch('touchMove', [{ ...start, x: start.x + 24 }]);
    await touch('touchMove', [target]);
    await touch('touchEnd', []);
    await waitRevision(mobile, before.revision);
    assert.equal((await snapshot()).document.instances.length, before.document.instances.length + 1);
    assert.equal(writes.length, count + 1);
    await mobile.close();
  });

  await t.test('a stale tab keeps its local copy, shows the conflict, and recovers on reload', async () => {
    await page.reload();
    await page.waitForSelector('body[data-ready="true"]');
    const other = await openPage({ viewport: { width: 1366, height: 850 } });
    const before = await snapshot();
    const brush = view => view.getByRole('button', { name: '画刷 B' }).click();
    await brush(page);
    const first = await point(page, 880, 180);
    await page.mouse.click(first.x, first.y);
    await waitRevision(page, before.revision);
    const winner = await snapshot(), count = writes.length;
    await brush(other);
    const second = await point(other, 800, 250);
    await other.mouse.click(second.x, second.y);
    await other.waitForFunction(() => document.querySelector('#save-state').textContent === '版本已变化');
    assert.match(await other.locator('#status').innerText(), /另一个窗口.*地图 JSON.*刷新/);
    assert.equal(await other.locator('body').getAttribute('data-revision'), String(before.revision));
    await expectUntouched(winner, count + 1);
    await capture(other, 'stale-map.png');
    const downloading = other.waitForEvent('download');
    await other.keyboard.press('Control+s');
    const downloaded = await downloading;
    assert.deepEqual(JSON.parse(readFileSync(await downloaded.path(), 'utf8')), before.document);
    assert.equal(await other.locator('#save-state').innerText(), '版本已变化');
    await other.reload();
    await other.waitForSelector('body[data-ready="true"]');
    assert.equal(await other.locator('#save-state').innerText(), '已保存到本机');
    assert.equal(await other.locator('body').getAttribute('data-revision'), String(winner.revision));
    await other.close();
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
});
