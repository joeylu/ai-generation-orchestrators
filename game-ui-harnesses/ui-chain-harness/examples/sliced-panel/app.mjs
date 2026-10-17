import '@fontsource/noto-sans-sc/400.css';
import './style.css';
import '@pixi/layout';
import { Application, Text } from 'pixi.js';
import { LayoutContainer } from '@pixi/layout/components';
import { SlicedBackground } from '../../src/runtime/sliced-background.mjs';
import { createRuntime } from '../../src/runtime/runtime.mjs';
import { createFixtureSkin } from '../../src/runtime/skin.mjs';
import { createBackgroundPool } from '../../src/panel/background-pool.mjs';
import { createBackgroundPackage, validateBackgroundPackage, maxPanelJsonBytes } from '../../src/slicing/package.mjs';
import { newSliceDocument } from '../../src/slicing/document.mjs';
import { measureSlices } from '../../src/slicing/geometry.mjs';
import { exportBackgroundPng } from '../../src/slicing/export.mjs';
import { sliceSamplePng } from '../../fixtures/slice-sample.mjs';

const $ = id => document.getElementById(id), data = window.UI_CHAIN_DATA;
const pool = createBackgroundPool(), parentPadding = 16;
let app, skin, scene, revision = 0, loadToken = 0, disposed = false, exporting = false;
const status = (text, error = false) => { $('status').textContent = text; $('status').classList.toggle('error', error); };
function download(blob, name) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function fitView() {
  if (!scene) return;
  const width = scene.parent.layout.computedLayout.width, height = scene.parent.layout.computedLayout.height;
  const ratio = Math.min(1, Math.max(1, $('preview').clientWidth - 32) / width);
  $('canvas-frame').style.width = width * ratio + 'px';
  $('canvas-frame').style.height = height * ratio + 'px';
  app.canvas.style.width = width * ratio + 'px'; app.canvas.style.height = height * ratio + 'px';
}
function sync() {
  const { background, parent } = scene, size = parent.layout.computedLayout;
  $('width').value = size.width; $('height').value = size.height;
  $('parent-size').textContent = `父容器 ${size.width} × ${size.height}`;
  $('panel-size').textContent = `Panel 背景 ${background.width} × ${background.height}`;
  $('border-size').textContent = '显示边框 L / T / R / B：' + ['left', 'top', 'right', 'bottom'].map(k => Number(background.geometry.displayedBorders[k].toFixed(2))).join(' / ');
  $('source-info').textContent = `${scene.pack.asset.source.width} × ${scene.pack.asset.source.height} 原图 · ${scene.pack.asset.density}× 密度 · ${scene.pack.defaultMultiplier} 倍率`;
  $('export').disabled = exporting; fitView();
}
function dimensions(width, height, background) {
  if (![width, height].every(n => Number.isInteger(n) && n >= 320 && n <= 2048)) throw Error('父容器宽高须为 320–2048 的整数。');
  const panelSize = { width: width - parentPadding * 2, height: height - parentPadding * 2 };
  measureSlices({ sourceWidth: background.texture.orig.width, sourceHeight: background.texture.orig.height,
    borders: { left: background.leftWidth, top: background.topHeight, right: background.rightWidth, bottom: background.bottomHeight },
    ...panelSize, multiplier: background.geometry.multiplier, resizePolicy: background.resizePolicy });
  return panelSize;
}
function resize(width, height) {
  dimensions(width, height, scene.background); // Validate before changing parent or renderer.
  // Only the parent changes. Native LayoutContainer calls background.setSize
  // with Yoga's computed size; there is no second resize/slicing algorithm.
  scene.parent.layout = { width, height };
  app.renderer.resize(width, height); scene.runtime.flush(); revision++; sync();
}
async function openPackage(input, label = '已导入的背景') {
  const token = ++loadToken, before = revision, pack = validateBackgroundPackage(input);
  const lease = await pool.acquire({ 'background-1': pack.asset });
  if (token !== loadToken || before !== revision || disposed) { lease.release(); throw Error('预览已变化，请重新导入。'); }
  let parent, runtime;
  const oldSize = { width: app.screen.width, height: app.screen.height };
  try {
    const spec = lease.backgrounds.get('background-1');
    const multiplier = pack.defaultMultiplier;
    const minimumWidth = Math.ceil((spec.borders.left + spec.borders.right) / multiplier) + parentPadding * 2;
    const minimumHeight = Math.ceil((spec.borders.top + spec.borders.bottom) / multiplier) + parentPadding * 2;
    const width = spec.resizePolicy ? Math.max(minimumWidth, Math.round(spec.texture.orig.width / multiplier) + parentPadding * 2) : Math.max(720, minimumWidth);
    const height = spec.resizePolicy ? Math.max(minimumHeight, Math.round(spec.texture.orig.height / multiplier) + parentPadding * 2) : Math.max(420, minimumHeight);
    if (width > 2048 || height > 2048) throw Error('当前边框需要超过 2048 的父容器，请先在九宫格工具调整倍率。');
    const background = new SlicedBackground({ ...spec, width: width - parentPadding * 2, height: height - parentPadding * 2, multiplier });
    parent = new LayoutContainer({ layout: { width, height, padding: parentPadding, backgroundColor: '#293b48', overflow: 'hidden' } });
    const panel = new LayoutContainer({ background, layout: {
      width: '100%', height: '100%', flexShrink: 0, padding: 24,
      flexDirection: 'column', justifyContent: 'space-between', gap: 16, overflow: 'hidden',
    } });
    parent.addChild(panel);
    const title = new Text({ text: '跟随父容器的面板', style: { fontFamily: skin.profile.fontFamily, fontSize: 20, fill: '#eef7ff' } });
    title.layout = { width: '100%', height: 32, flexShrink: 0, objectFit: 'none' };
    const description = new Text({ text: '改变父容器宽高，观察四角与边框。按钮和文字保持原大小。', style: { fontFamily: skin.profile.fontFamily, fontSize: 14, fill: '#c4d6df', wordWrap: true, breakWords: true } });
    description.layout = { width: '100%', height: 72, flexShrink: 0, objectFit: 'none' };
    panel.addChild(title, description);
    runtime = createRuntime({ app, registry: data.registry, usage: data.usage, skin,
      onEvent: () => status('按钮交互正常；改变尺寸不会缩放按钮或写入原始切线配置。') });
    const button = runtime.create({ id: 'example-button', recipeRef: 'button@1.0.0', props: { label: '测试按钮交互' }, size: { width: 160, height: 40 } });
    app.renderer.resize(width, height); app.stage.addChild(parent); runtime.mount(button, panel);
    const candidate = { parent, panel, background, button, title, runtime, pack, dispose() {
      runtime.dispose(); parent.destroy({ children: true }); lease.release();
    } };
    scene?.dispose(); scene = candidate; revision++; sync();
    $('source-name').textContent = label;
    status('就绪。调整的是父容器；Panel 背景由布局自动适配。');
  } catch (e) {
    runtime?.dispose(); parent?.destroy({ children: true }); lease.release();
    app.renderer.resize(oldSize.width, oldSize.height); app.render(); throw e;
  }
}
async function start() {
  await Promise.all([...document.fonts].map(f => f.load())); await document.fonts.ready;
  app = new Application();
  await app.init({ width: 720, height: 420, backgroundAlpha: 0, resolution: 1, antialias: true, preference: 'webgl', layout: { autoUpdate: false } });
  $('canvas-frame').append(app.canvas);
  skin = createFixtureSkin(data.template, data.usage, data.profile);
  $('sizes').onsubmit = e => {
    e.preventDefault();
    try { resize(Number($('width').value), Number($('height').value)); status('父容器尺寸已更新，四边切线保持不变。'); }
    catch (error) { status(error.message + ' 当前保留上一次有效尺寸。', true); }
  };
  for (const button of document.querySelectorAll('[data-size]')) button.onclick = () => {
    try { resize(...button.dataset.size.split(',').map(Number)); status('已切换父容器尺寸。'); }
    catch (error) { status(error.message, true); }
  };
  $('open').onclick = () => $('file').click();
  $('resolution').onchange = () => { revision++; };
  $('file').onchange = async () => {
    const file = $('file').files[0]; $('file').value = ''; if (!file) return;
    const before = revision;
    try {
      if (file.size > maxPanelJsonBytes) throw Error('背景包最大为 12 MiB。');
      const text = await file.text(); if (revision !== before) throw Error('预览已变化，请重新导入。');
      await openPackage(JSON.parse(text), file.name);
    } catch (error) { status(error.message, true); }
  };
  $('export').onclick = async () => {
    const before = revision; exporting = true; sync();
    try {
      const result = await exportBackgroundPng(app.renderer, scene.background, Number($('resolution').value));
      if (disposed || before !== revision) throw Error('尺寸或素材已变化，请重新导出。');
      download(result.blob, `adaptive-panel-${result.width}x${result.height}.png`);
      status(`已导出 ${result.width} × ${result.height} PNG，仅包含当前 Panel 背景。`);
    } catch (error) { status(error.message, true); }
    finally { exporting = false; if (!disposed) sync(); }
  };
  const bytes = await sliceSamplePng();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const source = { sha256: [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join(''), width: 256, height: 192 };
  const doc = { ...newSliceDocument(source), bordersPx: { left: 36, top: 36, right: 36, bottom: 36 } };
  await openPackage(await createBackgroundPackage(doc, new Blob([bytes], { type: 'image/png' })), '程序示例 · 可导入自己的背景包');
  const observer = new ResizeObserver(fitView); observer.observe($('preview'));
  window.layoutExample = { app, resize, openPackage, get scene() { return scene; }, get revision() { return revision; } };
  window.addEventListener('pagehide', () => {
    disposed = true; loadToken++; observer.disconnect(); scene?.dispose(); skin.dispose(); app.destroy(true, { children: true });
  }, { once: true });
  window.layoutExampleReady = true;
}
start().catch(error => { window.layoutExampleError = error.message; status(error.message, true); });
