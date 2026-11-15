import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { buildStudio, dependency, packageRoot } from '../../scripts/studio-build.mjs';
import { contextFor, loadSceneKit } from '../../src/kit.mjs';
import { encodeRgbaPng } from '../../src/png.mjs';
import { startStudio } from '../../src/studio/host.mjs';
import { sceneDisplayRole } from '../../src/studio/layer-groups.mjs';
import { canvasField } from './canvas-controls.mjs';

test('environment generation adds sprites to the selected groups and places them on the matching layers', { timeout: 90000 }, async t => {
  const base = resolve(tmpdir()), folder = mkdtempSync(join(base, 'scene-environment-ui-'));
  let host, independent, browser, worker, workerDone;
  t.after(async () => {
    worker?.kill();
    await workerDone;
    await browser?.close();
    await host?.close();
    await independent?.close();
    assert.equal(dirname(folder), base);
    rmSync(folder, { recursive: true, force: true });
  });
  const root = join(packageRoot, 'tests/fixtures/synthetic'), kit = loadSceneKit(root);
  const marker = contextFor(kit).modules.get('environment-marker');
  const exchangeRoot = join(folder, 'exchange'), privateRoot = join(folder, 'private');
  const style = { kitId: kit.kitId, anchorAssetId: marker.assetId, anchorSha256: marker.source.sha256,
    name: '已绑定项目风格', rules: ['Muted diffuse fill'] };
  const staticRoot = await buildStudio({ output: join(folder, 'static') });
  host = await startStudio({ root, staticRoot, workspaceRoot: join(folder, 'project'), environmentLibrary: { root: exchangeRoot, style } });
  independent = await startStudio({ root, staticRoot, workspaceRoot: join(folder, 'independent') });
  const side = 96, rgba = Buffer.alloc(side * side * 4);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const index = (y * side + x) * 4;
    if (y >= 49 && y < 83 && Math.abs(x - 48) < 11 + (y - 49) / 8) rgba.set([224 - Math.abs(x - 48) * 3, 196, 158, 255], index);
    if (y < 58 && ((x - 48) / 38) ** 2 + ((y - 50) / 35) ** 2 < 1) rgba.set([163 + Math.round((58 - y) / 3), 70 + Math.round((58 - y) / 2), 49, 255], index);
  }
  const image = encodeRgbaPng(side, side, rgba);
  writeFileSync(join(folder, 'mushroom.png'), image);
  const adapterPath = join(folder, 'synthetic-adapter.mjs');
  writeFileSync(adapterPath, `
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export function createEnvironmentLibraryAdapter({ workspace }) {
  return {
    async interpretContent(input) {
      assert.equal(input.prompt, '生成一个蘑菇');
      assert.equal(input.reference, null);
      assert.equal('style' in input, false);
      assert.equal('placementRole' in input, false);
      writeFileSync(join(workspace, 'content-call-' + input.attemptSha256 + '.json'), JSON.stringify({ attempt: input.attemptSha256 }), { flag: 'wx' });
      return { subject: '蘑菇', structure: '圆形菌盖和短菌柄', materials: '', details: '' };
    },
    async generate(input) {
      assert.match(input.request.prompt, /圆形菌盖和短菌柄/);
      assert.doesNotMatch(input.request.prompt, /生成一个蘑菇/);
      assert.match(input.request.prompt, /Muted diffuse fill/);
      assert.deepEqual(input.images.map(({ role, artifact }) => [role, artifact.sha256]), [['project-style-anchor', ${JSON.stringify(style.anchorSha256)}]]);
      writeFileSync(join(workspace, 'image-call-' + input.attemptSha256 + '.json'), JSON.stringify({ attempt: input.attemptSha256 }), { flag: 'wx' });
      await sleep(1400);
      return readFileSync(new URL('./mushroom.png', import.meta.url));
    },
  };
}
`);
  worker = spawn(process.execPath, [join(packageRoot, 'scripts/environment-library-worker.mjs'),
    '--exchange', exchangeRoot, '--private-workspace', privateRoot, '--adapter', adapterPath], { windowsHide: true });
  workerDone = new Promise(resolve => worker.once('close', resolve));
  await new Promise((resolve, reject) => {
    worker.once('error', reject);
    worker.once('exit', code => reject(new Error(`Synthetic worker exited before readiness (${code})`)));
    let output = '';
    worker.stdout.on('data', chunk => {
      output += chunk;
      if (output.includes('environment-library-worker-ready')) resolve();
    });
    worker.stderr.resume();
  });
  const { chromium } = dependency('playwright').require('playwright');
  browser = await chromium.launch({ headless: true, channel: process.env.SCENE_KIT_BROWSER_CHANNEL ?? 'msedge',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--explicitly-allowed-ports=' + [host, independent].map(server => new URL(server.url).port).join(',')] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [], external = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    if ([host.url, independent.url].includes(new URL(route.request().url()).origin)) return route.continue();
    external.push(route.request().url());
    return route.abort();
  });
  await page.goto(host.url + '/editor');
  await page.waitForSelector('body[data-ready="true"]');
  const state = () => page.evaluate(async () => (await fetch('/api/state')).json());
  const initial = await state(), projectId = initial.workspace.activeProjectId;
  await page.locator('#tab-environment').click();
  const group = page.locator('#palette [data-palette-group="platform"] [data-palette-group="environment"]');
  const entry = group.getByRole('button', { name: '生成环境素材', exact: true });
  assert.equal(await entry.count(), 1);
  assert.equal(await page.locator('#palette').getByRole('button', { name: /^生成.*素材$/ }).count(), 5);
  assert.equal(await group.locator('.palette-group-count').textContent(), '1');
  await entry.click();
  const modal = page.getByRole('dialog', { name: '生成环境素材' });
  const generate = modal.getByRole('button', { name: '生成', exact: true });
  await generate.click();
  await modal.getByText('请填写设定或选择一张参考图。').waitFor();
  await modal.getByLabel('提示词').fill('生成一个蘑菇');
  await modal.getByLabel('参考图（可选）').setInputFiles({ name: 'mushroom.png', mimeType: 'image/png', buffer: image });
  const thumbnail = modal.getByRole('img', { name: '参考图预览' });
  await thumbnail.evaluate(node => node.decode());
  if (process.env.SCENE_KIT_SCREENSHOTS) {
    mkdirSync(process.env.SCENE_KIT_SCREENSHOTS, { recursive: true });
    await modal.screenshot({ path: join(process.env.SCENE_KIT_SCREENSHOTS, 'environment-reference-preview.png') });
  }
  await modal.getByRole('button', { name: '移除参考图' }).click();
  assert.equal(await thumbnail.count(), 0);
  await generate.click();
  const progress = modal.getByRole('progressbar', { name: '环境素材生成进度' });
  await progress.waitFor();
  await modal.getByText('2 / 3 · 生成透明素材').waitFor();
  assert.equal(await progress.getAttribute('value'), '1');
  if (process.env.SCENE_KIT_SCREENSHOTS)
    await modal.screenshot({ path: join(process.env.SCENE_KIT_SCREENSHOTS, 'environment-generation-progress.png') });
  const { jobId } = await page.evaluate(async () => (await fetch('/api/environment-library')).json());
  const jobDir = join(exchangeRoot, jobId);
  await modal.getByRole('button', { name: '关闭' }).click();
  const generated = group.locator('[data-asset-id="environment-' + jobId + '"]');
  await generated.waitFor();
  assert.equal(await generated.innerText(),'生成一个蘑菇');
  assert.equal(await generated.locator('..').getAttribute('class'),'asset-card asset-fresh');
  assert.equal(await page.locator('body').getAttribute('data-revision'), String(initial.revision + 1));
  const status = await page.evaluate(async () => (await fetch('/api/environment-library')).json());
  assert.equal(status.status, 'added');
  for (const stage of ['content', 'image']) {
    const reservation = JSON.parse(readFileSync(join(jobDir, stage + '-reservation.json'), 'utf8'));
    const authorization = JSON.parse(readFileSync(join(jobDir, stage + '-authorization.json'), 'utf8'));
    const invocation = JSON.parse(readFileSync(join(privateRoot, stage + '-call-' + reservation.sha256 + '.json'), 'utf8'));
    assert.equal(reservation.pid, worker.pid);
    assert.equal(reservation.sha256, invocation.attempt);
    assert.equal(reservation.authorizationSha256, authorization.sha256);
    assert.equal(reservation.targetSha256, stage === 'content' ? status.briefSha256 : status.planSha256);
  }
  assert.deepEqual(readFileSync(join(jobDir, 'raw.png')), image);
  assert.equal(existsSync(join(jobDir, 'visual-review.json')), false);
  await entry.click();
  await modal.getByLabel('提示词').waitFor();
  await modal.getByRole('button', { name: '关闭' }).click();
  assert.equal(await group.locator('.palette-group-count').textContent(), '2');
  assert.deepEqual((await state()).document.instances, initial.document.instances);
  const module = (await state()).modules.find(item => item.assetId === 'environment-' + jobId);
  const bytes = await page.request.get(new URL(module.url, host.url).href);
  assert.ok(bytes.ok());
  await group.getByRole('button',{name:'重命名素材 生成一个蘑菇',exact:true}).click();
  const naming=page.getByRole('dialog',{name:'重命名素材',exact:true});
  await naming.getByLabel('素材名称').fill('溪边蘑菇');
  await naming.getByRole('button',{name:'保存名称',exact:true}).click();
  await naming.waitFor({state:'hidden'});
  assert.equal(await generated.innerText(),'溪边蘑菇');
  assert.equal((await state()).assetNames[module.assetId],'溪边蘑菇');
  await generated.click();
  assert.match(await page.locator('#placement-target').innerText(),/目标图层/);
  await (await canvasField(page, 'cell-x')).fill('3');
  await (await canvasField(page, 'cell-y')).fill('2');
  await (await canvasField(page, 'apply-cell')).click();
  await page.waitForFunction(revision => Number(document.body.dataset.revision) > revision, initial.revision + 2);
  const placed = await state();
  assert.equal(placed.document.instances.filter(item => item.assetId === module.assetId).length, 1);
  await page.reload();
  await page.waitForSelector('body[data-ready="true"]');
  assert.deepEqual((await state()).document, placed.document);
  assert.equal(await generated.innerText(),'溪边蘑菇');

  const newAssets = new Map();
  for (const [role, label, newParallax] of [['foreground', '前景', 1.1], ['middle', '中景', 0.65],
    ['far', '远景', 0.3], ['background', '背景', null]]) {
    const destination = page.locator('#palette [data-palette-group="' + role + '"]');
    await destination.getByRole('button', { name: '生成' + label + '素材', exact: true }).click();
    await modal.getByText('加入分组 · ' + label, { exact: true }).waitFor();
    await modal.getByLabel('提示词').fill('生成一个蘑菇');
    const before = await state();
    const submitted = page.waitForResponse(response => response.url().endsWith('/api/environment-library') && response.request().method() === 'POST');
    await generate.click();
    const response = await submitted;
    assert.equal(response.request().postDataJSON().placementRole, role);
    const job = await response.json();
    assert.equal(job.placementRole, role);
    const assetId = 'environment-' + job.jobId;
    await modal.getByRole('button', { name: '关闭' }).click();
    const card = destination.locator('[data-asset-id="' + assetId + '"]');
    await card.waitFor();
    for (const name of ['brief', 'plan']) {
      const record = JSON.parse(readFileSync(join(exchangeRoot, job.jobId, name + '.json'), 'utf8'));
      assert.equal(record.placementRole, role);
    }
    const added = await state();
    assert.deepEqual(added.document, { ...before.document, kitRef: added.document.kitRef });
    assert.equal(added.modules.find(item => item.assetId === assetId).placementRole, role);
    newAssets.set(assetId, role);

    if (role === 'foreground') {
      await card.scrollIntoViewIfNeeded();
      const source = await card.boundingBox();
      const canvas = await page.locator('canvas').boundingBox();
      await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
      await page.mouse.down();
      await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2, { steps: 12 });
      await page.mouse.up();
    } else {
      await card.click();
      if (newParallax !== null) assert.match(await page.locator('#placement-target').innerText(), new RegExp(label));
      await (await canvasField(page, 'cell-x')).fill('3');
      await (await canvasField(page, 'cell-y')).fill('2');
      await (await canvasField(page, 'apply-cell')).click();
    }
    const waitForRevision = revision => page.waitForFunction(value => Number(document.body.dataset.revision) > value, revision);
    await waitForRevision(added.revision);
    const next = await state();
    const instance = next.document.instances.find(item => item.assetId === assetId);
    const layer = next.document.layers.find(item => item.layerId === instance.layerId);
    assert.equal(sceneDisplayRole(layer), role);
    if (newParallax === null) assert.deepEqual(next.document.layers, added.document.layers);
    else {
      assert.equal(next.document.layers.length, added.document.layers.length + 1);
      assert.equal(layer.parallax.x, newParallax);
    }
    if (role === 'foreground') {
      await page.locator('#undo').click();
      await waitForRevision(next.revision);
      const undone = await state();
      assert.deepEqual(undone.document, added.document);
      await page.locator('#redo').click();
      await waitForRevision(undone.revision);
      assert.deepEqual((await state()).document, next.document);
    }
  }
  const finalDocument = (await state()).document;
  await page.locator('#download-menu>summary').click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '整个项目 ZIP', exact: true }).click();
  const file = await (await download).path();
  await page.goto(independent.url + '/editor');
  await page.waitForSelector('body[data-ready="true"]');
  await Promise.all([page.waitForEvent('load'), page.locator('#project-file').setInputFiles(file)]);
  await page.waitForSelector('body[data-ready="true"]');
  const reopened = await state();
  assert.notEqual(reopened.workspace.activeProjectId, projectId);
  assert.deepEqual(reopened.document, finalDocument);
  for (const [assetId, role] of newAssets) {
    assert.equal(reopened.modules.find(item => item.assetId === assetId).placementRole, role);
  }
  assert.equal(reopened.assetNames[module.assetId],'溪边蘑菇');
  const reopenedAsset = reopened.modules.find(item => item.assetId === module.assetId);
  const reopenedBytes = await page.request.get(new URL(reopenedAsset.url, independent.url).href);
  assert.deepEqual(await reopenedBytes.body(), await bytes.body());
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
});
