import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { encodePng, decodePng } from '../../../../src/skins/png.mjs';
import { previewHeaders } from '../../../../src/editor/policy.mjs';

function fixturePng() {
  const pixels = Buffer.alloc(128 * 128 * 4);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    let rgba = x < 16 ? [255, 0, 0, 255] : x >= 104 ? [0, 0, 255, 255] : y < 12 ? [0, 255, 255, 255] : y >= 108 ? [255, 255, 0, 255] : [0, 255, 0, 255];
    if (y < 4 && x < 4) rgba = [0, 0, 0, 0];
    else if (y < 4 && x < 8) rgba = [255, 0, 0, 128];
    pixels.set(rgba, (y * 128 + x) * 4);
  }
  return encodePng({ width: 128, height: 128, pixels });
}
async function downloadBytes(download) {
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  return Buffer.concat(chunks);
}
export async function checkSliceEditor(candidate, channel = 'chrome') {
  const browser = await chromium.launch({ channel, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 980 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  const checks = [], errors = [], images = {};
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().isNavigationRequest()
    ? route.fulfill({ status: 200, headers: previewHeaders, body: candidate.sliceHtml }) : route.abort());
  const check = async (id, description, fn) => {
    try { await fn(); checks.push({ id, description, status: 'passed' }); }
    catch (e) { checks.push({ id, description, status: 'failed', message: e.message }); }
    console.log(`${id} ${checks.at(-1).status}${checks.at(-1).message ? ' ' + checks.at(-1).message : ''}`);
  };
  try {
    await page.goto('http://127.0.0.1:4175/slice.html');
    await page.waitForFunction(() => window.sliceEditorReady || window.sliceEditorError);
    await check('SL01.boot', '实际 Panel 适配器启动，示例九宫格保留边角', async () => {
      assert.equal(await page.evaluate(() => window.sliceEditorError), undefined);
      assert.equal(await page.evaluate(() => sliceEditor.panel.recipe.type), 'Panel');
      assert.equal(await page.evaluate(() => sliceEditor.panel.adapter.bg.width), 480);
      images['slicing.png'] = await page.screenshot();
    });
    if (!(await page.evaluate(() => !!window.sliceEditorReady))) return { checks, errors, images };
    await check('SL13.automatic', '默认导入自动配置；不可靠素材拒绝且不替换，配置可原样重开', async () => {
      assert.equal(await page.locator('#advanced').getAttribute('open'), null);
      for (const id of ['open-json', 'save-json', 'save-package', 'save-source']) assert.equal(await page.locator('#' + id).isVisible(), false);
      assert.equal(await page.locator('[data-side="left"]').isVisible(), false);
      assert.equal(await page.locator('#open-png').isVisible(), true);
      assert.equal(await page.locator('#export-png').isVisible(), true);
      await page.evaluate(async bytes => sliceEditor.openPng(new Uint8Array(bytes), '自动分析样本'), [...fixturePng()]);
      const configured = await page.evaluate(() => sliceEditor.document);
      assert.deepEqual(configured.bordersPx, { left: 17, top: 13, right: 25, bottom: 21 });
      assert.equal(configured.multiplier, 1);
      const pixels = Buffer.alloc(64 * 64 * 4);
      const unsupported = encodePng({ width: 64, height: 64, pixels });
      await page.locator('#png-file').setInputFiles({ name: 'transparent.png', mimeType: 'image/png', buffer: unsupported });
      await page.waitForFunction(() => document.getElementById('status').textContent.includes('无法自动配置'));
      assert.deepEqual(await page.evaluate(() => sliceEditor.document), configured);
      await page.evaluate(text => sliceEditor.openConfig(text), JSON.stringify(configured));
      assert.deepEqual(await page.evaluate(() => sliceEditor.document), configured);
      await page.locator('#advanced summary').click();
    });
    await check('SL02.fields', '四边独立编辑、倍率、撤销与重做', async () => {
      await page.locator('[data-field="left"]').fill('40');
      await page.locator('[data-field="multiplier"]').fill('2');
      assert.equal(await page.evaluate(() => sliceEditor.panel.adapter.bg.geometry.displayedBorders.left), 20);
      await page.locator('#undo').click();
      assert.equal(await page.evaluate(() => sliceEditor.document.multiplier), 1);
      await page.locator('#redo').click();
      assert.equal(await page.evaluate(() => sliceEditor.document.multiplier), 2);
      assert.equal(await page.evaluate(() => sliceEditor.panel.root.scale.x), 1);
    });
    await check('SL03.drag', '切线与组件尺寸实际拖动，撤销一次恢复完整手势', async () => {
      const before = await page.evaluate(() => sliceEditor.document);
      const line = await page.locator('[data-side="left"]').boundingBox();
      await page.mouse.move(line.x + line.width / 2, line.y + line.height / 2);
      await page.mouse.down(); await page.mouse.move(line.x + line.width / 2 + 12, line.y + line.height / 2, { steps: 3 }); await page.mouse.up();
      assert.ok(await page.evaluate(() => sliceEditor.document.bordersPx.left) > before.bordersPx.left);
      await page.locator('#undo').click();
      assert.deepEqual(await page.evaluate(() => sliceEditor.document), before);
      const handle = await page.locator('#resize').boundingBox();
      await page.mouse.move(handle.x + 8, handle.y + 8); await page.mouse.down(); await page.mouse.move(handle.x + 40, handle.y + 26, { steps: 3 }); await page.mouse.up();
      assert.ok(await page.evaluate(() => sliceEditor.document.target.width) > before.target.width);
      assert.equal(await page.evaluate(() => sliceEditor.panel.adapter.bg.width === sliceEditor.document.target.width), true);
    });
    await check('SL04.reject', '无效切线保留有效预览，三个出口下载有效参数和像素', async () => {
      const before = await page.evaluate(() => sliceEditor.document);
      const baseline = Buffer.from(await page.evaluate(async () => [...new Uint8Array(await (await sliceEditor.exportPng()).blob.arrayBuffer())]));
      await page.locator('[data-field="left"]').fill('999');
      assert.deepEqual(await page.evaluate(() => sliceEditor.document), before);
      assert.equal(await page.locator('#export-png').isEnabled(), true);
      assert.match(await page.locator('#export-png').textContent(), /当前有效/);
      for (const id of ['save-json', 'save-package', 'export-png']) {
        const [file] = await Promise.all([page.waitForEvent('download'), page.locator('#' + id).click()]);
        const bytes = await downloadBytes(file);
        if (id === 'save-json') assert.deepEqual(JSON.parse(bytes), before);
        else if (id === 'save-package') {
          const pack = JSON.parse(bytes);
          assert.deepEqual(pack.asset.bordersPx, before.bordersPx);
          assert.equal(pack.defaultMultiplier, before.multiplier);
        } else assert.deepEqual(decodePng(bytes), decodePng(baseline));
        assert.match(await page.locator('#status').textContent(), /无效修改未应用/);
      }
      await page.locator('#restore').click();
      assert.equal(await page.locator('#export-png').isEnabled(), true);
      assert.equal(await page.evaluate(() => { const before = sliceEditor.document; try { sliceEditor.apply({ ...before, target: { width: 2048, height: 280 }, exportResolution: 4 }); return false; } catch (e) { return e.code === 'slice.export-size' && JSON.stringify(before) === JSON.stringify(sliceEditor.document); } }), true);
    });
    await check('SL05.roundtrip', '下载配置、核对原图并恢复；错误摘要不能覆盖原配置', async () => {
      const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#save-json').click()]);
      const saved = JSON.parse((await downloadBytes(download)).toString('utf8'));
      await page.locator('[data-field="multiplier"]').fill('3');
      await page.locator('#json-file').setInputFiles({ name: 'saved.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) });
      await page.waitForFunction(m => sliceEditor.document.multiplier === m, saved.multiplier);
      const bad = { ...saved, source: { ...saved.source, sha256: '0'.repeat(64) } };
      await page.locator('#json-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) });
      await page.waitForFunction(() => document.getElementById('status').classList.contains('error'));
      assert.deepEqual(await page.evaluate(() => sliceEditor.document), saved);
    });
    await check('SL06.pixels', '12 组源密度/倍率/输出分辨率：原始切线、非对称边框、透明与连续 alpha', async () => {
      const bytes = fixturePng();
      await page.locator('#png-file').setInputFiles({ name: 'asymmetric.png', mimeType: 'image/png', buffer: bytes });
      await page.waitForFunction(() => sliceEditor.document.source.width === 128);
      for (const density of [1, 2]) for (const multiplier of [0.5, 1, 2]) for (const exportResolution of [1, 2]) {
        const result = await page.evaluate(async ({ density, multiplier, exportResolution }) => {
          sliceEditor.apply({ ...sliceEditor.document, density, multiplier, exportResolution, bordersPx: { left: 16, top: 12, right: 24, bottom: 20 }, target: { width: 300, height: 120 } });
          const png = await sliceEditor.exportPng(); return Array.from(new Uint8Array(await png.blob.arrayBuffer()));
        }, { density, multiplier, exportResolution });
        const png = decodePng(Buffer.from(result)), s = density * multiplier;
        assert.equal(png.width, 300 * exportResolution); assert.equal(png.height, 120 * exportResolution);
        const pixel = (x, y) => [...png.pixels.subarray((Math.floor(y * exportResolution) * png.width + Math.floor(x * exportResolution)) * 4, (Math.floor(y * exportResolution) * png.width + Math.floor(x * exportResolution)) * 4 + 4)];
        assert.deepEqual(pixel(0, 0), [0, 0, 0, 0]);
        assert.ok(Math.abs(pixel(5 / s, 1 / s)[3] - 128) <= 1);
        assert.deepEqual(pixel(8 / s, 60), [255, 0, 0, 255]);
        assert.deepEqual(pixel(16 / s + 2, 60), [0, 255, 0, 255]);
        assert.deepEqual(pixel(300 - 12 / s, 60), [0, 0, 255, 255]);
        assert.deepEqual(pixel(150, 6 / s), [0, 255, 255, 255]);
        assert.deepEqual(pixel(150, 120 - 10 / s), [255, 255, 0, 255]);
      }
    });
    await check('SL07.download', '真实下载 PNG 使用目标区域，不包含编辑选框或棋盘格', async () => {
      const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export-png').click()]);
      const png = decodePng(await downloadBytes(download));
      assert.equal(png.width, 600); assert.equal(png.height, 240); assert.equal(png.pixels[3], 0);
    });
    await check('SL08.runtime-resize', '组件自身 resize 保持倍率；尺寸失败不污染尺寸、纹理或命中区', async () => {
      assert.equal(await page.evaluate(() => {
        const panel = sliceEditor.panel, bg = panel.adapter.bg, texture = bg.texture;
        panel.resize(340, 120);
        if (bg.width !== 340 || bg.geometry.displayedBorders.left !== 4 || bg.texture !== texture || panel.root.hitArea.width !== 340) return false;
        bg.setSize(350, 120);
        if (bg.width !== 350 || bg.scale.x !== 1 || bg.geometry.displayedBorders.left !== 4) return false;
        bg.setSize(340, 120);
        try { panel.resize(1, 120); return false; } catch { return panel.size.width === 340 && bg.width === 340 && panel.root.hitArea.width === 340; }
      }), true);
    });
    await check('SL09.lifecycle', '重复配置和原图替换释放旧视图、共享纹理保持有效', async () => {
      assert.equal(await page.evaluate(() => {
        const texture = sliceEditor.panel.adapter.bg.texture;
        for (let i = 0; i < 10; i++) { const old = sliceEditor.panel; sliceEditor.apply({ ...sliceEditor.document, multiplier: i % 2 ? 1 : 2 }); if (!old.disposed || sliceEditor.panel.adapter.bg.texture !== texture) return false; }
        return sliceEditor.app.stage.children.length === 2 && !sliceEditor.panel.adapter.bg.texture.destroyed;
      }), true);
      await page.locator('#png-file').setInputFiles({ name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('not-png') });
      await page.waitForFunction(() => document.getElementById('status').classList.contains('error'));
      assert.equal(await page.evaluate(() => sliceEditor.document.source.width), 128);
    });
    await check('SL10.stale-export', 'PNG 编码期间修改参数，不下载过期快照', async () => {
      let downloads = 0; const count = () => downloads++; page.on('download', count);
      try {
        await page.evaluate(() => {
          window.originalToBlob = HTMLCanvasElement.prototype.toBlob;
          HTMLCanvasElement.prototype.toBlob = function (...args) { window.releasePng = () => originalToBlob.apply(this, args); };
        });
        await page.locator('#export-png').click();
        await page.waitForFunction(() => !!window.releasePng);
        await page.locator('[data-field="multiplier"]').fill('3');
        await page.evaluate(() => releasePng());
        await page.waitForFunction(() => document.getElementById('status').textContent.includes('参数已变化'));
        assert.equal(downloads, 0);
      } finally {
        await page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = originalToBlob; delete window.releasePng; });
        page.off('download', count);
      }
    });
    await check('SL11.minimum', '倍率扩大边框后，运行时最小尺寸失败在修改背景前发生', async () => {
      assert.equal(await page.evaluate(() => {
        sliceEditor.apply({ ...sliceEditor.document, density: 1, multiplier: 0.125, target: { width: 480, height: 320 } });
        const panel = sliceEditor.panel;
        try { panel.resize(300, 320); return false; }
        catch (e) { return e.code === 'slice.minimum' && panel.size.width === 480 && panel.adapter.bg.width === 480 && panel.root.hitArea.width === 480; }
      }), true);
    });
    await check('SL14.texture-size', '纹理默认保持比例；尺寸失败保留预览，背景包重开保留策略', async () => {
      const width = 400, height = 120, pixels = Buffer.alloc(width * height * 4);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const grain = (x * 7 + y * 11) % 17;
        const rgba = x < 4 || x >= width - 4 || y < 4 || y >= height - 4 ? [0, 0, 0, 0]
          : x < 16 || x >= width - 16 || y < 16 || y >= height - 16 ? [65, 35, 15, 255] : [220 + grain, 180 + grain, 110 + grain, 255];
        pixels.set(rgba, (y * width + x) * 4);
      }
      await page.evaluate(async bytes => sliceEditor.openPng(new Uint8Array(bytes), 'texture.png'), [...encodePng({ width, height, pixels })]);
      const before = await page.evaluate(() => sliceEditor.document);
      assert.equal(before.resizePolicy, 'texture-balanced-v1');
      assert.deepEqual(before.target, { width, height });
      await page.locator('[data-size="240,480"]').click();
      assert.ok(await page.locator('#status').textContent().then(text => text.includes('不适合当前尺寸')));
      assert.deepEqual(await page.evaluate(() => sliceEditor.document), before);
      assert.equal(await page.locator('#export-png').isEnabled(), true);
      const [file] = await Promise.all([page.waitForEvent('download'), page.locator('#save-package').click()]);
      const pack = JSON.parse(await downloadBytes(file));
      assert.equal(pack.asset.resizePolicy, 'texture-balanced-v1');
      await page.evaluate(text => sliceEditor.openConfig(text), JSON.stringify(pack));
      assert.equal(await page.evaluate(() => sliceEditor.document.resizePolicy), 'texture-balanced-v1');
      const png = decodePng(Buffer.from(await page.evaluate(async () => [...new Uint8Array(await (await sliceEditor.exportPng()).blob.arrayBuffer())])));
      assert.equal(png.width, width); assert.equal(png.height, height);
    });
    await check('SL12.errors', '无离线页面错误', async () => assert.deepEqual(errors, []));
    return { checks, errors, images };
  } finally { await browser.close(); }
}
