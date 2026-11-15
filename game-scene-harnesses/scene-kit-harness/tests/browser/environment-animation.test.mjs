import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { buildStudio, dependency } from '../../scripts/studio-build.mjs';
import { openEnvironmentAnimationExchange } from '../../src/generation/environment-animation-exchange.mjs';
import { hash } from '../../src/generation/common.mjs';
import { loadSceneKit, readMap } from '../../src/kit.mjs';
import { encodeRgbaPng, inspectPng } from '../../src/png.mjs';
import { startStudio } from '../../src/studio/host.mjs';
import { animationAtlas } from '../helpers/environment-animation.mjs';
import { fixtureRoot } from '../helpers/generation.mjs';

test('environment animation editor saves a loop and independent interactive states, with portable assets', { timeout: 120000 }, async t => {
  const base = resolve(tmpdir()), folder = mkdtempSync(join(base, 'scene-animation-ui-'));
  let host, independent, browser;
  t.after(async () => {
    await browser?.close();
    await host?.close();
    await independent?.close();
    assert.equal(dirname(folder), base);
    rmSync(folder, { recursive: true, force: true });
  });
  const author = readMap(loadSceneKit(fixtureRoot));
  author.terrainRuns = []; author.assemblyInstances = []; author.inspectionCases = [];
  const assetId = 'environment-marker';
  author.instances = [384, 576].map((x, i) => ({ instanceId: 'animation.actor' + i, assetId, layerId: 'environment', x, y: 224 }));
  const staticRoot = await buildStudio({ output: join(folder, 'static') });
  const animationExchangeRoot = join(folder, 'exchange');
  const exchange = openEnvironmentAnimationExchange(animationExchangeRoot), worker = exchange.registerWorker();
  host = await startStudio({ root: fixtureRoot, staticRoot, initialDocument: author, workspaceRoot: join(folder, 'project'), animationExchangeRoot });
  independent = await startStudio({ root: fixtureRoot, staticRoot, workspaceRoot: join(folder, 'independent') });
  const { chromium } = dependency('playwright').require('playwright');
  browser = await chromium.launch({ headless: true, channel: process.env.SCENE_KIT_BROWSER_CHANNEL ?? 'msedge',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--explicitly-allowed-ports=' + [host, independent].map(server => new URL(server.url).port).join(',')] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 920 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(8000);
  const errors = [], external = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    if ([host.url, independent.url].includes(new URL(route.request().url()).origin)) return route.continue();
    external.push(route.request().url());
    return route.abort();
  });
  await page.goto(host.url + '/editor');
  await page.waitForSelector('body[data-ready="true"]');
  const snapshot = () => page.evaluate(async () => (await fetch('/api/state')).json());
  const initial = await snapshot();
  assert.equal(initial.modules.find(module => module.assetId === assetId).animation, undefined);
  const entry = page.locator(`.asset-card:has([data-asset-id="${assetId}"]) .asset-animation`);
  const dialog = page.getByRole('dialog', { name: '环境素材动画' });
  const field = label => dialog.getByLabel(label, { exact: true });
  const click = name => dialog.getByRole('button', { name, exact: true }).click();
  const upload = (label, buffer) => field(label).setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer });
  const grid = async () => { await field('列数').fill('2'); await field('行数').fill('1'); await field('每帧毫秒').fill('250'); };
  const red = [211, 40, 40], yellow = [223, 204, 42], blue = [41, 90, 216], green = [35, 193, 80];
  const atlasWidth = 129, atlasHeight = 64;
  const atlas = Buffer.alloc(atlasWidth * atlasHeight * 4);
  for (const [index, color] of [red, yellow].entries()) {
    for (let y = 7; y < 29; y++) for (let x = 32; x < 54; x++)
      atlas.set([...color, 255], ((y + 7 - index * 7) * atlasWidth + x + index * 67) * 4);
  }
  atlas.set([70, 90, 110, 96], 0);
  const loop = encodeRgbaPng(atlasWidth, atlasHeight, atlas);
  const closed = animationAtlas([blue]), open = animationAtlas([green]);
  await entry.click();
  await dialog.waitFor({ state: 'visible' });
  await field('素材类型').selectOption('idle');
  assert.equal(await field('初始状态').count(), 0);
  await grid();
  const preview = dialog.getByLabel('当前状态动画预览');
  const previewBounds = (canvas, color) => {
    const { width, height } = canvas;
    const rgba = canvas.getContext('2d').getImageData(0, 0, width, height).data;
    let left = width, right = 0, bottom = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      if (rgba[at + 3] < 128 || (color && !color.every((value, channel) => value === rgba[at + channel]))) continue;
      left = Math.min(left, x);
      right = Math.max(right, x + 1);
      bottom = Math.max(bottom, y + 1);
    }
    return right > left && { center: (left + right) / 2, bottom };
  };
  const baseline = await preview.evaluate(previewBounds);
  assert.ok(baseline);
  await dialog.getByText('生成当前状态的帧表', { exact: true }).click();
  await click('生成帧表');
  const projectId = initial.workspace.activeProjectId;
  const generation = () => exchange.get(projectId, initial.kit.bundleSha256);
  assert.equal(generation(), null);
  await click('确认生成一次');
  await page.waitForFunction(async () => (await (await fetch('/api/environment-animation/generation')).json()).current?.status === 'ready');
  const blocked = generation();
  const badWorkspace = () => ({
    preflight() { throw new Error('CODEX_WORKSPACE_PATH_TOO_LONG'); },
    generate() { assert.fail('Blocked preflight cannot dispatch generation'); },
  });
  assert.equal(await exchange.dispatch(worker, badWorkspace), true);
  assert.equal(await exchange.dispatch(worker, badWorkspace), false);
  assert.equal(generation().status, 'blocked');
  assert.equal(existsSync(join(animationExchangeRoot, 'runs', blocked.planSha256, 'reservation.json')), false);
  await dialog.getByText('本机生成工作目录过长，Codex 未启动。原计划已终止。').waitFor();
  assert.equal(await dialog.getByText('已提交给本机动画生成进程。').count(), 0);
  await click('生成帧表');
  await click('确认生成一次');
  await page.waitForFunction(async () => (await (await fetch('/api/environment-animation/generation')).json()).current?.status === 'ready');
  const submitted = generation();
  assert.notEqual(submitted.planSha256, blocked.planSha256);
  assert.deepEqual([submitted.input.stateId, submitted.input.columns, submitted.input.rows, submitted.input.frameMs], ['idle', 2, 1, 250]);
  let dispatches = 0;
  const createAdapter = workspace => {
    assert.equal(workspace, join(realpathSync(animationExchangeRoot), 'adapter'));
    return { generate() { dispatches++; return loop; } };
  };
  assert.equal(await exchange.dispatch(worker, createAdapter), true);
  assert.equal(await exchange.dispatch(worker, createAdapter), false);
  assert.equal(dispatches, 1);
  assert.equal(exchange.get(projectId, '0'.repeat(64)), null);
  await dialog.getByText('帧表已载入预览。保存动画设置后生效。').waitFor();
  assert.equal((await snapshot()).revision, initial.revision);
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.animation-dialog canvas');
    return canvas.getContext('2d').getImageData(240, 110, 1, 1).data[0] === 211;
  });
  const registered = await preview.evaluate(previewBounds, red);
  assert.ok(registered);
  assert.ok(Math.abs(baseline.center - registered.center) <= 1, `${baseline.center} vs ${registered.center}`);
  assert.ok(Math.abs(baseline.bottom - registered.bottom) <= 1, `${baseline.bottom} vs ${registered.bottom}`);
  async function secondPose() {
    await click('播放当前状态');
    const measurement = await page.waitForFunction(color => {
      const canvas = document.querySelector('.animation-dialog canvas');
      const { width, height } = canvas;
      const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data;
      if (pixels[(96 * width + 240) * 4] !== color) return false;
      let left = width, right = 0, bottom = 0;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        if (pixels[(y * width + x) * 4 + 3] < 128) continue;
        left = Math.min(left, x);
        right = Math.max(right, x + 1);
        bottom = Math.max(bottom, y + 1);
      }
      return { center: (left + right) / 2, bottom };
    }, yellow[0]);
    return measurement.jsonValue();
  }
  const firstPose = await preview.evaluate(previewBounds);
  assert.equal(await field('逐帧定位').inputValue(), 'original');
  assert.ok((await secondPose()).bottom < firstPose.bottom - 10);
  await field('逐帧定位').selectOption('locked');
  const locked = await secondPose();
  assert.ok(Math.abs(locked.bottom - firstPose.bottom) <= 1, `${locked.bottom} vs ${firstPose.bottom}`);
  assert.ok(Math.abs(locked.center - firstPose.center) <= 1, `${locked.center} vs ${firstPose.center}`);
  await click('保存动画设置');
  await dialog.waitFor({ state: 'hidden' });
  const defaultState = await snapshot();
  assert.equal(defaultState.scene.environmentAnimations[assetId].states[0].playback, 'loop');
  assert.equal(defaultState.scene.environmentAnimations[assetId].states[0].clip.source.sha256, hash(loop));
  const offsets = [{ x: 0, y: 0 }, { x: -3, y: 7 }];
  assert.deepEqual(defaultState.scene.environmentAnimations[assetId].states[0].clip.baseLock, offsets);
  const retained = await page.evaluate(async url => [...new Uint8Array(await (await fetch(url)).arrayBuffer())],
    defaultState.animationAtlases[hash(loop)]);
  assert.deepEqual(Buffer.from(retained), loop);
  assert.equal(await entry.getAttribute('data-animation-type'), 'idle');
  const mode = name => page.getByRole('button', { name, exact: true }).click();
  const canvas = page.locator('#canvas-host canvas');
  async function point(x, y) {
    const box = await canvas.boundingBox(), view = author.defaultCamera;
    const scale = Math.min(box.width / view.viewport.width, box.height / view.viewport.height);
    return { x: Math.floor(box.x + box.width / 2 + (x - view.center.x) * scale),
      y: Math.floor(box.y + box.height / 2 + (y - view.center.y) * scale) };
  }
  const actor = i => point(author.instances[i].x + 32, author.instances[i].y + 32);
  async function pixel(i) {
    const p = await actor(i);
    const png = await page.screenshot({ clip: { ...p, width: 1, height: 1 } });
    return [...inspectPng(png, { includePixels: true }).rgba.subarray(0, 3)];
  }
  await mode('Play Mode');
  const seen = new Set(), start = Date.now();
  while (Date.now() - start < 3000 && seen.size < 2) seen.add((await pixel(0)).join(','));
  assert.deepEqual(seen, new Set([red.join(','), yellow.join(',')]));
  await mode('退出 Play Mode');

  await entry.click();
  assert.equal(await field('逐帧定位').inputValue(), 'locked');
  await field('逐帧定位').selectOption('original');
  await click('保存动画设置');
  await dialog.waitFor({ state: 'hidden' });
  const restored = (await snapshot()).scene.environmentAnimations[assetId].states[0].clip;
  assert.equal(restored.baseLock, undefined);
  assert.equal(restored.source.sha256, hash(loop));

  await entry.click();
  await field('素材类型').selectOption('interactive');
  await field('状态名称').fill('关闭');
  await upload('静止姿态 PNG（可选）', closed);
  await click('添加状态');
  const openingId = await field('编辑状态').inputValue();
  await field('状态名称').fill('打开中');
  await field('播放方式').selectOption('once');
  await grid();
  await upload('动画帧表 PNG', loop);
  await field('逐帧定位').selectOption('locked');
  await click('添加状态');
  const openId = await field('编辑状态').inputValue();
  await field('状态名称').fill('已打开');
  await upload('静止姿态 PNG（可选）', open);
  await field('编辑状态').selectOption(openingId);
  await field('播放完成后').selectOption(openId);
  await field('编辑状态').selectOption('idle');
  await field('点击后').selectOption(openingId);
  await click('保存动画设置');
  await dialog.waitFor({ state: 'hidden' });
  const configured = await snapshot();
  assert.deepEqual(configured.scene.environmentAnimations[assetId].states.map(state => state.playback), ['hold', 'once', 'hold']);
  assert.deepEqual(configured.scene.environmentAnimations[assetId].states[1].clip.baseLock, offsets);
  assert.equal(configured.modules.find(module => module.assetId === assetId).source.sha256,
    initial.modules.find(module => module.assetId === assetId).source.sha256);
  await mode('Play Mode');
  assert.deepEqual(await pixel(0), blue);
  assert.deepEqual(await pixel(1), blue);
  const at = await actor(0);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 40, at.y);
  await page.mouse.move(at.x, at.y);
  await page.mouse.up();
  await page.keyboard.press('Home');
  assert.deepEqual(await pixel(0), blue);
  await page.mouse.click(at.x, at.y);
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('已打开'));
  assert.deepEqual(await pixel(0), green);
  assert.deepEqual(await pixel(1), blue);
  assert.equal((await snapshot()).revision, configured.revision);
  await mode('退出 Play Mode');
  await page.reload();
  await page.waitForSelector('body[data-ready="true"]');
  assert.equal(await entry.getAttribute('data-animation-type'), 'interactive');

  await page.locator('#project-switch').click();
  const projectDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载当前项目', exact: true }).click();
  const projectFile = join(folder, 'animation-project.zip');
  await (await projectDownload).saveAs(projectFile);
  await page.goto(independent.url + '/editor');
  await page.waitForSelector('body[data-ready="true"]');
  await page.locator('#project-file').setInputFiles(projectFile);
  await page.waitForFunction(() => document.body.dataset.ready === 'true'
    && document.querySelector('.asset-animation[data-animation-type="interactive"]'));
  const imported = await snapshot();
  assert.deepEqual(imported.scene.environmentAnimations, configured.scene.environmentAnimations);
  assert.deepEqual(imported.document.instances, configured.document.instances);
  await mode('Play Mode');
  assert.deepEqual(await pixel(0), blue);
  assert.deepEqual(await pixel(1), blue);
  const importedActor = await actor(1);
  await page.mouse.click(importedActor.x, importedActor.y);
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('已打开'));
  assert.deepEqual(await pixel(0), blue);
  assert.deepEqual(await pixel(1), green);
  await mode('退出 Play Mode');

  const rejected = await page.evaluate(async ({ revision, assetId }) => {
    const response = await fetch('/api/environment-animation', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision, assetId, animation: { type: 'idle', initial: 'idle', states: [
        { id: 'idle', name: 'Idle', playback: 'loop', clip: { columns: 2, rows: 1, frameMs: 250, png: 'AAAA' } },
      ] } }) });
    return { status: response.status, code: (await response.json()).errors?.[0]?.code };
  }, { revision: imported.revision, assetId });
  assert.deepEqual(rejected, { status: 422, code: 'ANIMATION_PNG_INVALID' });
  assert.equal((await snapshot()).revision, imported.revision);
  await entry.click();
  await page.setViewportSize({ width: 390, height: 620 });
  const sticky = await dialog.evaluate(element => {
    element.scrollTop = element.scrollHeight;
    const visible = selector => {
      const button = element.querySelector(selector).getBoundingClientRect(), box = element.getBoundingClientRect();
      return button.top >= box.top && button.bottom <= box.bottom;
    };
    return { scrolled: element.scrollTop > 0, close: visible('.project-dialog-heading button'), save: visible('button[type=submit]') };
  });
  assert.deepEqual(sticky, { scrolled: true, close: true, save: true });
  await field('素材类型').selectOption('static');
  await click('保存动画设置');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal((await snapshot()).scene.environmentAnimations, undefined);
  assert.equal(await entry.getAttribute('data-animation-type'), 'static');
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
});
