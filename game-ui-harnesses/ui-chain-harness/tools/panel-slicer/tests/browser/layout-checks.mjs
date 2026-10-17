import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { previewHeaders } from '../../../../src/editor/policy.mjs';
import { encodePng, decodePng } from '../../../../src/skins/png.mjs';

async function downloaded(file) {
  const chunks = []; for await (const chunk of await file.createReadStream()) chunks.push(chunk);
  return Buffer.concat(chunks);
}
function fixturePackage() {
  const pixels = Buffer.alloc(128 * 128 * 4);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    let rgba = x < 16 ? [255, 0, 0, 255] : x >= 104 ? [0, 0, 255, 255] : y < 12 ? [0, 255, 255, 255] : y >= 108 ? [255, 255, 0, 255] : [0, 255, 0, 255];
    if (x < 4 && y < 4) rgba = [0, 0, 0, 0]; else if (x < 8 && y < 4) rgba = [255, 0, 0, 128];
    pixels.set(rgba, (y * 128 + x) * 4);
  }
  const png = encodePng({ width: 128, height: 128, pixels });
  return { kind: 'ui_panel_background', version: '1.0', defaultMultiplier: 2, asset: {
    source: { sha256: createHash('sha256').update(png).digest('hex'), width: 128, height: 128 },
    density: 2, bordersPx: { left: 16, top: 12, right: 24, bottom: 20 }, pngBase64: png.toString('base64'),
  } };
}
export async function checkLayoutExample(candidate, channel = 'chrome') {
  const browser = await chromium.launch({ channel, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 980 }, serviceWorkers: 'block' });
  const checks = [], errors = [], images = {};
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().isNavigationRequest()
    ? route.fulfill({ status: 200, headers: previewHeaders, body: candidate.layoutHtml }) : route.abort());
  const check = async (id, description, fn) => {
    try { await fn(); checks.push({ id, description, status: 'passed' }); }
    catch (e) { checks.push({ id, description, status: 'failed', message: e.message }); }
    console.log(`${id} ${checks.at(-1).status}${checks.at(-1).message ? ' ' + checks.at(-1).message : ''}`);
  };
  try {
    await page.goto('http://127.0.0.1:4175/slice-runtime.html');
    await page.waitForFunction(() => window.layoutExampleReady || window.layoutExampleError);
    await check('LA01.boot', '独立运行时消费示例启动，程序示例明确标记且无编辑器依赖', async () => {
      assert.equal(await page.evaluate(() => window.layoutExampleError), undefined);
      assert.match(await page.locator('#source-name').textContent(), /程序示例/);
      assert.deepEqual(await page.evaluate(() => {
        const { parent, panel, background, button } = layoutExample.scene;
        return [parent.layout.computedLayout.width, panel.layout.computedLayout.width, background.width, background.height,
          panel.background === background, button.recipe.type];
      }), [720, 688, 688, 388, true, 'Button']);
      images['slice-runtime.png'] = await page.screenshot();
    });
    if (!(await page.evaluate(() => !!window.layoutExampleReady))) return { checks, errors, images };
    await check('LA02.native-layout', '只改变原生父布局：宽/高/缩回更新背景，切线、纹理及内容比例不变', async () => {
      assert.equal(await page.evaluate(() => {
        const { parent, panel, background, button, title, runtime } = layoutExample.scene;
        const texture = background.texture;
        for (const [width, height] of [[480, 360], [960, 360], [420, 680], [720, 420]]) {
          parent.layout = { width, height }; layoutExample.app.renderer.resize(width, height); runtime.flush();
          if (background.width !== width - 32 || background.height !== height - 32 || background.texture !== texture ||
              background.geometry.displayedBorders.left !== 36 || background.leftWidth !== 36 ||
              button.root.scale.x !== 1 || button.size.width !== 160 || title.style.fontSize !== 20 || panel.scale.x !== 1) return false;
        }
        return true;
      }), true);
    });
    await check('LA03.controls', '尺寸预设、键盘输入、按钮交互与窄屏查看可用', async () => {
      await page.locator('[data-size="960,360"]').click();
      assert.equal(await page.evaluate(() => layoutExample.scene.background.width), 928);
      await page.locator('#width').fill('600'); await page.locator('#height').fill('400');
      await page.locator('#height').press('Enter');
      assert.equal(await page.evaluate(() => layoutExample.scene.background.width), 568);
      const point = await page.evaluate(() => {
        const { button } = layoutExample.scene, p = button.root.toGlobal({ x: 80, y: 20 });
        const rect = layoutExample.app.canvas.getBoundingClientRect();
        const scale = rect.width / layoutExample.app.screen.width;
        return { x: rect.left + p.x * scale, y: rect.top + p.y * scale };
      });
      await page.mouse.click(point.x, point.y);
      await page.waitForFunction(() => document.getElementById('status').textContent.includes('按钮交互正常'));
      await page.setViewportSize({ width: 375, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await page.evaluate(() => layoutExample.scene.background.width), 568);
      images['slice-runtime-mobile.png'] = await page.screenshot({ fullPage: true });
      await page.setViewportSize({ width: 1500, height: 980 });
    });
    const pack = fixturePackage();
    await check('LA04.package-png', '用户背景包实际导入，父布局后的 PNG 下载尺寸和透明边框像素正确', async () => {
      await page.locator('#file').setInputFiles({ name: 'asymmetric.background.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(pack)) });
      await page.waitForFunction(() => layoutExample.scene.pack.asset.source.width === 128);
      await page.locator('[data-size="480,360"]').click();
      await page.locator('#resolution').selectOption('2');
      const [file] = await Promise.all([page.waitForEvent('download'), page.locator('#export').click()]);
      const png = decodePng(await downloaded(file));
      assert.equal(png.width, 896); assert.equal(png.height, 656);
      const pixel = (x, y) => [...png.pixels.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4)];
      assert.deepEqual(pixel(0, 0), [0, 0, 0, 0]); assert.deepEqual(pixel(2, 0), [255, 0, 0, 128]);
      assert.deepEqual(pixel(5, 100), [255, 0, 0, 255]); assert.deepEqual(pixel(32, 100), [0, 255, 0, 255]);
      assert.deepEqual(pixel(png.width - 3, 100), [0, 0, 255, 255]);
      for (let y = 24; y < png.height - 24; y += 11) for (let x = 24; x < png.width - 24; x += 11)
        assert.deepEqual(pixel(x, y), [0, 255, 0, 255]);
    });
    await check('LA05.failure-lifecycle', '无效尺寸和篡改素材保留旧场景；重复导入共享纹理并销毁旧视图', async () => {
      assert.equal(await page.evaluate(async pack => {
        const original = layoutExample.scene, texture = original.background.texture, revision = layoutExample.revision;
        try { layoutExample.resize(100, 400); return false; } catch {}
        const bad = structuredClone(pack); bad.asset.source.sha256 = '0'.repeat(64);
        try { await layoutExample.openPackage(bad); return false; } catch {}
        if (layoutExample.scene !== original || layoutExample.revision !== revision || texture.destroyed) return false;
        for (let i = 0; i < 3; i++) {
          const old = layoutExample.scene;
          await layoutExample.openPackage(pack);
          if (!old.parent.destroyed || old.background === layoutExample.scene.background || layoutExample.scene.background.texture !== texture || texture.destroyed) return false;
        }
        return layoutExample.app.stage.children.length === 2;
      }, pack), true);
    });
    await check('LA06.stale-png', 'PNG 编码期间父容器变化，不下载过期尺寸', async () => {
      let downloads = 0; const count = () => downloads++; page.on('download', count);
      try {
        await page.evaluate(() => {
          window.originalToBlob = HTMLCanvasElement.prototype.toBlob;
          HTMLCanvasElement.prototype.toBlob = function (...args) { window.releasePng = () => originalToBlob.apply(this, args); };
        });
        await page.locator('#export').click(); await page.waitForFunction(() => !!window.releasePng);
        await page.locator('[data-size="960,360"]').click(); await page.evaluate(() => releasePng());
        await page.waitForFunction(() => document.getElementById('status').textContent.includes('请重新导出'));
        assert.equal(downloads, 0);
      } finally {
        await page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = originalToBlob; delete window.releasePng; });
        page.off('download', count);
      }
    });
    await check('LA07.errors', '离线消费无未捕获异常', async () => assert.deepEqual(errors, []));
    return { checks, errors, images };
  } finally { await browser.close(); }
}
