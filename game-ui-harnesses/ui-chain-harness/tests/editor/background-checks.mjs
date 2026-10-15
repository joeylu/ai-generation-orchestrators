import assert from 'node:assert/strict';
import { encodePng, decodePng } from '../../src/skins/png.mjs';
import { previewHeaders } from '../../src/editor/policy.mjs';
import { presetDocument } from '../../src/panel/data.mjs';

async function downloaded(file) {
  const chunks = []; for await (const chunk of await file.createReadStream()) chunks.push(chunk);
  return Buffer.concat(chunks);
}
export async function checkPanelBackgrounds({ browser, page, candidate, check, images }) {
  const slice = await browser.newPage({ viewport: { width: 1500, height: 980 }, serviceWorkers: 'block' });
  await slice.route('**/*', route => route.request().isNavigationRequest()
    ? route.fulfill({ status: 200, headers: previewHeaders, body: candidate.sliceHtml }) : route.abort());
  let pack;
  const pixels = Buffer.alloc(128 * 96 * 4);
  for (let y = 0; y < 96; y++) for (let x = 0; x < 128; x++) {
    let rgba = x < 16 ? [255, 0, 0, 255] : x >= 104 ? [0, 0, 255, 255] : y < 12 ? [0, 255, 255, 255] : y >= 76 ? [255, 255, 0, 255] : [0, 255, 0, 255];
    if (x < 4 && y < 4) rgba = [0, 0, 0, 0];
    else if (x < 8 && y < 4) rgba = [255, 0, 0, 128];
    pixels.set(rgba, (y * 128 + x) * 4);
  }
  const png = encodePng({ width: 128, height: 96, pixels });
  const importPack = async input => {
    const before = await page.evaluate(() => editor.session.revision);
    const message = await page.locator('#status').textContent();
    await page.locator('#panel-background-file').setInputFiles({ name: 'test.background.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(input)) });
    await page.waitForFunction(({ before, message }) => editor.session.revision > before || (document.getElementById('status').classList.contains('error') && document.getElementById('status').textContent !== message), { before, message });
  };
  try {
    await check('BG01.package', '九宫格页面下载可重开的背景包，原始 PNG 字节不变', async () => {
      await slice.goto('http://127.0.0.1:4175/slice.html'); await slice.waitForFunction(() => window.sliceEditorReady);
      await slice.locator('#advanced summary').click();
      await slice.evaluate(async bytes => {
        await sliceEditor.openPng(Uint8Array.from(bytes), 'test.png');
        sliceEditor.apply({ ...sliceEditor.document, density: 2, multiplier: 2, bordersPx: { left: 16, top: 12, right: 24, bottom: 20 } });
      }, [...png]);
      const [file] = await Promise.all([slice.waitForEvent('download'), slice.locator('#save-package').click()]);
      pack = JSON.parse(await downloaded(file));
      assert.deepEqual(Buffer.from(pack.asset.pngBase64, 'base64'), png);
      await slice.evaluate(text => sliceEditor.openConfig(text), JSON.stringify(pack));
      assert.equal(await slice.evaluate(() => sliceEditor.document.multiplier), 2);
      assert.equal(await slice.evaluate(() => sliceEditor.panel.adapter.bg.geometry.displayedBorders.left), 4);
    });
    await check('BG02.attach', '只替换所选 Panel，尺寸与文字独立，素材随文档保存', async () => {
      const doc = presetDocument(candidate.data.presets.presets[0], candidate.data), root = doc.nodes.find(n => n.id === doc.rootId);
      root.layout = { childrenMode: 'free', padding: 0 }; root.slots = { children: ['custom-panel'] };
      doc.nodes = [root,
        { id: 'custom-panel', name: '九宫格 Panel', recipeRef: 'panel@1.0.0', props: { title: '内容保持独立' }, size: { width: 400, height: 240 }, position: { x: 80, y: 80 }, slots: { content: ['custom-text'] } },
        { id: 'custom-text', name: '文字', recipeRef: 'text@1.0.0', props: { text: '这行文字不会导出到背景 PNG', textStyleRef: 'body' }, size: { width: 280, height: 40 }, slots: {} }];
      await page.evaluate(doc => editor.open(doc), doc);
      await page.locator('[data-node="custom-panel"]').click();
      await importPack(pack);
      const state = await page.evaluate(() => {
        const h = editor.session.current.runtime.handles.get('custom-panel'); window.backgroundTexture = h.adapter.bg.texture;
        return { size: h.size, ref: h.props.backgroundRef, left: h.adapter.bg.geometry.displayedBorders.left, version: editor.session.document.version };
      });
      assert.deepEqual(state, { size: { width: 400, height: 240 }, ref: 'background-1', left: 4, version: '0.2' });
      assert.equal(await page.evaluate(() => editor.session.document.panelBackgrounds['background-1'].pngBase64), pack.asset.pngBase64);
    });
    await check('BG03.drag', '拖动过程中真实背景更新，取消回滚；一次拖动一次撤销并复用纹理', async () => {
      const start = await page.locator('#resize-handle').boundingBox();
      const before = await page.evaluate(() => editor.session.revision);
      await page.mouse.move(start.x + 4, start.y + 4); await page.mouse.down();
      await page.mouse.move(start.x + 45, start.y + 29, { steps: 4 });
      assert.equal(await page.evaluate(() => editor.session.revision), before);
      assert.ok(await page.evaluate(() => editor.session.current.runtime.handles.get('custom-panel').adapter.bg.width) > 400);
      await page.keyboard.press('Escape'); await page.mouse.up();
      assert.equal(await page.evaluate(() => editor.session.current.runtime.handles.get('custom-panel').adapter.bg.width), 400);
      const again = await page.locator('#resize-handle').boundingBox();
      await page.mouse.move(again.x + 4, again.y + 4); await page.mouse.down(); await page.mouse.move(again.x + 45, again.y + 29, { steps: 4 }); await page.mouse.up();
      await page.waitForFunction(before => editor.session.revision > before, before);
      assert.equal(await page.evaluate(() => editor.session.current.runtime.handles.get('custom-panel').adapter.bg.texture === backgroundTexture), true);
      await page.evaluate(() => editor.session.undo());
      assert.equal(await page.evaluate(() => editor.session.current.runtime.handles.get('custom-panel').adapter.bg.width), 400);
      await page.evaluate(() => editor.session.redo());
      assert.equal(await page.evaluate(() => editor.session.current.runtime.handles.get('custom-panel').adapter.bg.geometry.displayedBorders.left), 4);
    });
    await check('BG04.roundtrip', '背景包去重、文档实际下载/重开及试玩切换保持素材与倍率', async () => {
      await importPack(pack);
      assert.equal(await page.evaluate(() => Object.keys(editor.session.document.panelBackgrounds).length), 1);
      const [file] = await Promise.all([page.waitForEvent('download'), page.locator('#save').click()]);
      const saved = await downloaded(file);
      await page.locator('#file').setInputFiles({ name: 'saved.json', mimeType: 'application/json', buffer: saved });
      await page.waitForFunction(() => document.getElementById('status').textContent.includes('JSON 已载入'));
      await page.evaluate(async () => { await editor.setMode('play'); await editor.setMode('edit'); });
      assert.equal(await page.evaluate(() => editor.session.current.runtime.handles.get('custom-panel').adapter.bg.texture === backgroundTexture && !backgroundTexture.destroyed), true);
      assert.equal(await page.evaluate(() => editor.session.current.runtime.handles.get('custom-panel').props.pixelsPerUnitMultiplier), 2);
      images['panel-background.png'] = await page.screenshot();
    });
    await check('BG05.reject', '篡改摘要和不适用尺寸失败后，文档/历史/活纹理不变', async () => {
      const before = await page.evaluate(() => editor.session.exportDocument());
      const bad = structuredClone(pack); bad.asset.source.sha256 = '0'.repeat(64);
      await importPack(bad);
      assert.equal(await page.evaluate(() => editor.session.exportDocument()), before);
      assert.equal(await page.evaluate(() => !backgroundTexture.destroyed && editor.session.current.runtime.handles.get('custom-panel').adapter.bg.texture === backgroundTexture), true);
      const wide = structuredClone(pack); wide.asset.density = 1; wide.asset.bordersPx.left = 90; wide.defaultMultiplier = 0.125;
      await importPack(wide);
      assert.equal(await page.evaluate(() => editor.session.exportDocument()), before);
      assert.equal(await page.evaluate(async () => {
        const doc = editor.session.document; doc.panelBackgrounds['background-1'].source.width++;
        try { await editor.open(doc); return false; } catch { return !backgroundTexture.destroyed; }
      }), true);
    });
    await check('BG06.png', '画布实际下载背景 PNG：精确尺寸、透明度、边框像素及无文字', async () => {
      await page.locator('#panel-png-resolution').selectOption('2');
      const [file] = await Promise.all([page.waitForEvent('download'), page.locator('#export-panel-background').click()]);
      const output = decodePng(await downloaded(file));
      const size = await page.evaluate(() => editor.session.current.runtime.handles.get('custom-panel').size);
      assert.equal(output.width, size.width * 2); assert.equal(output.height, size.height * 2);
      const pixel = (x, y) => [...output.pixels.subarray((y * output.width + x) * 4, (y * output.width + x) * 4 + 4)];
      assert.deepEqual(pixel(0, 0), [0, 0, 0, 0]); assert.deepEqual(pixel(2, 0), [255, 0, 0, 128]);
      // Sample away from the source cut: linear filtering mixes the source
      // border/center texels immediately beside that boundary.
      assert.deepEqual(pixel(5, 100), [255, 0, 0, 255]); assert.deepEqual(pixel(32, 100), [0, 255, 0, 255]);
      assert.deepEqual(pixel(output.width - 3, 100), [0, 0, 255, 255]);
      // Text would change these interior pixels if the whole Panel were baked.
      for (let y = 20; y < output.height - 20; y += 7) for (let x = 20; x < output.width - 20; x += 7)
        assert.deepEqual(pixel(x, y), [0, 255, 0, 255]);
    });
    await check('BG07.instances', '复制 Panel 共用素材，实例倍率独立；切回旧文档释放源纹理', async () => {
      await page.evaluate(async () => {
        await editor.session.mutate({ type: 'duplicate', id: 'custom-panel', prefix: 'copy' });
        await editor.session.mutate({ type: 'update', id: 'custom-panel', patch: { props: { pixelsPerUnitMultiplier: 4 } } });
      });
      assert.deepEqual(await page.evaluate(() => {
        const a = editor.session.current.runtime.handles.get('custom-panel').adapter.bg, b = editor.session.current.runtime.handles.get('copy-0').adapter.bg;
        return [a.texture === b.texture, a.geometry.displayedBorders.left, b.geometry.displayedBorders.left, Object.keys(editor.session.document.panelBackgrounds).length];
      }), [true, 2, 4, 1]);
      await page.evaluate(doc => editor.open(doc), presetDocument(candidate.data.presets.presets[0], candidate.data));
      assert.equal(await page.evaluate(() => backgroundTexture.destroyed), true);
      await page.evaluate(() => editor.session.undo());
      assert.equal(await page.evaluate(() => !editor.session.current.runtime.handles.get('custom-panel').adapter.bg.texture.destroyed), true);
    });
    await check('BG08.auto-import', '画布直接导入 PNG 自动配置，撤销恢复旧参数，不可靠素材不污染文档', async () => {
      await page.locator('[data-node="custom-panel"]').click();
      const before = await page.evaluate(() => editor.session.exportDocument());
      const base = await page.evaluate(() => editor.session.revision);
      await page.locator('#panel-background-png').setInputFiles({ name: 'auto-panel.png', mimeType: 'image/png', buffer: png });
      await page.waitForFunction(base => editor.session.revision > base, base);
      assert.equal(await page.evaluate(() => editor.session.current.runtime.handles.get('custom-panel').props.pixelsPerUnitMultiplier), 1);
      await page.evaluate(() => editor.session.undo());
      const restored = await page.evaluate(() => editor.session.exportDocument());
      // Undo restores content but intentionally advances the session revision.
      assert.deepEqual({ ...JSON.parse(restored), revision: 0 }, { ...JSON.parse(before), revision: 0 });
      await page.locator('[data-node="custom-panel"]').click();
      const unsupported = encodePng({ width: 64, height: 64, pixels: Buffer.alloc(64 * 64 * 4) });
      await page.locator('#panel-background-png').setInputFiles({ name: 'transparent.png', mimeType: 'image/png', buffer: unsupported });
      await page.waitForFunction(() => document.getElementById('status').textContent.includes('无法自动配置'));
      assert.equal(await page.evaluate(() => editor.session.exportDocument()), restored);
    });
    await check('BG09.texture-policy', '纹理尺寸策略保存重开保持；拒绝变形不污染文档和运行时', async () => {
      await page.evaluate(async () => editor.session.mutate({ type: 'update', id: 'custom-panel', patch: { size: { width: 320, height: 240 } } }));
      await page.locator('[data-node="custom-panel"]').click();
      const guarded = structuredClone(pack);
      guarded.asset.density = 1; guarded.defaultMultiplier = 1; guarded.asset.resizePolicy = 'texture-balanced-v1';
      await importPack(guarded);
      assert.equal(await page.evaluate(() => editor.session.current.runtime.handles.get('custom-panel').adapter.bg.resizePolicy), 'texture-balanced-v1');
      const saved = await page.evaluate(() => editor.session.exportDocument());
      await page.evaluate(async text => editor.open(JSON.parse(text)), saved);
      assert.equal(await page.evaluate(() => editor.session.current.runtime.handles.get('custom-panel').adapter.bg.resizePolicy), 'texture-balanced-v1');
      const before = await page.evaluate(() => editor.session.exportDocument());
      const rejected = await page.evaluate(async () => {
        const handle = editor.session.current.runtime.handles.get('custom-panel');
        const size = { ...handle.size };
        let runtimeRejected = false, documentRejected = false;
        try { handle.resize(240, 600); } catch (e) { runtimeRejected = e.code === 'slice.distortion'; }
        try { await editor.session.mutate({ type: 'update', id: 'custom-panel', patch: { size: { width: 240, height: 600 } } }); } catch (e) { documentRejected = e.code === 'slice.distortion'; }
        return { runtimeRejected, documentRejected, unchanged: JSON.stringify(handle.size) === JSON.stringify(size) };
      });
      assert.deepEqual(rejected, { runtimeRejected: true, documentRejected: true, unchanged: true });
      assert.equal(await page.evaluate(() => editor.session.exportDocument()), before);
    });
  } finally { await slice.close(); }
}
