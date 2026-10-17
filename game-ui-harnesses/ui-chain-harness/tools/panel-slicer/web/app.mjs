import '@fontsource/noto-sans-sc/400.css';
import './style.css';
import { Application } from 'pixi.js';
import { createFixtureSkin } from '../../../src/runtime/skin.mjs';
import { createRuntime } from '../../../src/runtime/runtime.mjs';
import { newSliceDocument, validateSliceDocument, sliceViewOptions } from '../src/document.mjs';
import { sides, measureSlices } from '../src/geometry.mjs';
import { maxSourceBytes } from '../src/source.mjs';
import { loadSliceAsset } from '../src/asset.mjs';
import { automaticSliceDocument } from '../src/automatic.mjs';
import { exportBackgroundPng } from '../src/export.mjs';
import { sliceSamplePng } from '../fixtures/slice-sample.mjs';
import { createBackgroundPackage, validateBackgroundPackage, decodePng, maxPanelJsonBytes, backgroundGeometry } from '../src/package.mjs';

const $ = id => document.getElementById(id);
const inputs = Object.fromEntries([...document.querySelectorAll('[data-field]')].map(el => [el.dataset.field, el]));
const data = window.UI_CHAIN_DATA;
let app, fixtureSkin, asset, scene, doc, sourceUrl, revision = 0, loadToken = 0;
let invalid = false, exporting = false, disposed = false;
const undo = [], redo = [];
function status(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}
function buttons() {
  $('undo').disabled = !undo.length;
  $('redo').disabled = !redo.length;
  $('export-png').disabled = !doc || exporting;
  $('save-json').disabled = !doc;
  $('save-package').disabled = !doc;
  $('export-png').textContent = invalid ? '导出当前有效 PNG' : '导出背景 PNG';
  $('save-json').textContent = invalid ? '保存当前有效配置' : '保存配置';
  $('save-package').textContent = invalid ? '导出当前有效背景包' : '导出背景包';
  $('save-source').disabled = !asset;
  $('open-json').disabled = !doc;
}
function fitPreview() {
  if (!doc) return;
  const area = $('preview-area');
  const scale = Math.min(1, (area.clientWidth - 50) / doc.target.width, (area.clientHeight - 50) / doc.target.height);
  $('preview-frame').style.width = `${doc.target.width * scale}px`;
  $('preview-frame').style.height = `${doc.target.height * scale}px`;
}
function sync() {
  for (const side of sides) inputs[side].value = doc.bordersPx[side];
  for (const key of ['density', 'multiplier', 'exportResolution']) inputs[key].value = doc[key];
  for (const key of ['width', 'height']) inputs[key].value = doc.target[key];
  const { width, height } = doc.source, b = doc.bordersPx;
  const positions = { left: b.left / width, right: 1 - b.right / width, top: b.top / height, bottom: 1 - b.bottom / height };
  for (const [side, position] of Object.entries(positions)) {
    const button = document.querySelector(`[data-side="${side}"]`);
    button.style[side === 'left' || side === 'right' ? 'left' : 'top'] = `${position * 100}%`;
    button.setAttribute('aria-label', `${{ left: '左', top: '上', right: '右', bottom: '下' }[side]}切线 ${b[side]} 像素`);
  }
  $('source-size').textContent = `${width} × ${height} px`;
  $('target-size').textContent = `${doc.target.width} × ${doc.target.height}`;
  const borders = measureSlices(sliceViewOptions(doc)).displayedBorders;
  $('border-summary').textContent = `显示边框 L / T / R / B：${sides.map(k => Number(borders[k].toFixed(2))).join(' / ')}`;
  $('export-size').textContent = `成品尺寸 ${doc.target.width * doc.exportResolution} × ${doc.target.height * doc.exportResolution} px`;
  fitPreview(); buttons();
}

// The workbench renders the same real Panel adapter as the canvas editor. Its
// empty content is intentional: exported backgrounds never contain demo text.
function buildScene(next, nextAsset) {
  const options = sliceViewOptions(next);
  const texture = nextAsset.texture(next.density);
  const skin = Object.create(fixtureSkin);
  skin.backgroundSpec = role => role === 'skin.surface.panel' ? { texture, borders: options.borders, resizePolicy: next.resizePolicy } : fixtureSkin.backgroundSpec(role);
  skin.insets = role => role === 'skin.surface.panel' ? { left: 0, top: 0, right: 0, bottom: 0 } : fixtureSkin.insets(role);
  const runtime = createRuntime({ app, registry: data.registry, usage: data.usage, skin });
  try {
    const content = runtime.create({ id: 'slice-content', recipeRef: 'text@1.0.0', props: { text: '', textStyleRef: 'body' }, size: { width: 24, height: 24 } });
    const panel = runtime.create({ id: 'slice-panel', recipeRef: 'panel@1.0.0', props: { title: '', contentPadding: { left: 0, top: 0, right: 0, bottom: 0 }, pixelsPerUnitMultiplier: next.multiplier }, size: next.target }, { content: [content] });
    runtime.setMode('edit');
    return { runtime, panel, dispose() { runtime.dispose(); } };
  } catch (e) { runtime.dispose(); throw e; }
}
function apply(input, { record = true, nextAsset = asset } = {}) {
  const next = validateSliceDocument(input, nextAsset.source);
  const candidate = buildScene(next, nextAsset);
  try {
    app.renderer.resize(next.target.width, next.target.height);
    candidate.runtime.mount(candidate.panel);
  } catch (e) {
    candidate.dispose();
    if (doc) app.renderer.resize(doc.target.width, doc.target.height);
    scene?.runtime.flush();
    throw e;
  }
  if (record && doc && JSON.stringify(next) !== JSON.stringify(doc)) {
    undo.push(doc); if (undo.length > 50) undo.shift(); redo.length = 0;
  }
  scene?.dispose(); scene = candidate; doc = next; revision++; invalid = false;
  scene.runtime.flush(); sync();
}
function attempt(input, options) {
  try { apply(input, options); status('预览已更新。原图切线与显示倍率分别保存。'); return true; }
  catch (e) { invalid = true; buttons(); status(`${e.message} 本次修改未应用；仍可导出当前显示的有效预览。`, true); return false; }
}
function exportStatus(message) {
  status(message + (invalid ? ' 本次无效修改未应用；导出使用当前显示的有效参数。' : ''), invalid);
}
function readFields() {
  const number = key => inputs[key].value.trim() === '' ? NaN : Number(inputs[key].value);
  return { ...doc, bordersPx: Object.fromEntries(sides.map(k => [k, number(k)])), density: number('density'), multiplier: number('multiplier'), target: { width: number('width'), height: number('height') }, exportResolution: number('exportResolution') };
}
function download(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function openPng(bytes, name, sample = false, token = ++loadToken) {
  const nextAsset = await loadSliceAsset(bytes);
  if (token !== loadToken || disposed) { nextAsset.dispose(); return; }
  const manual = !sample && $('manual-import').checked;
  try {
    const next = manual ? newSliceDocument(nextAsset.source) : automaticSliceDocument(nextAsset);
    apply(next, { record: false, nextAsset });
  }
  catch (e) { nextAsset.dispose(); throw e; }
  installAsset(nextAsset, name);
  status(manual ? '已按手动模式载入，当前为整图拉伸，请在高级设置中调整。' : '已自动配置边角。内部纹理会随尺寸拉伸，可用宽、高、方形预览检查效果。所有分析都在本地完成。');
}
function installAsset(nextAsset, name) {
  asset?.dispose(); asset = nextAsset;
  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  sourceUrl = URL.createObjectURL(asset.blob); $('source-image').src = sourceUrl;
  $('source-name').textContent = name; undo.length = 0; redo.length = 0; buttons();
}
async function openConfig(text) {
  if (text.length > maxPanelJsonBytes) throw Error('背景包最大为 12 MiB。');
  const input = JSON.parse(text);
  if (input.kind === 'ui_panel_background') {
    const pack = validateBackgroundPackage(input), token = ++loadToken, before = revision;
    const nextAsset = await loadSliceAsset(decodePng(pack.asset.pngBase64));
    try {
      if (token !== loadToken || before !== revision || disposed) throw Error('预览已变化，请重新打开背景包。');
      const { borders } = backgroundGeometry(pack.asset);
      const next = { ...newSliceDocument(pack.asset.source), density: pack.asset.density, bordersPx: pack.asset.bordersPx, multiplier: pack.defaultMultiplier,
        target: { width: Math.max(480, Math.ceil((borders.left + borders.right) / pack.defaultMultiplier)), height: Math.max(280, Math.ceil((borders.top + borders.bottom) / pack.defaultMultiplier)) } };
      if (pack.asset.resizePolicy) {
        next.resizePolicy = pack.asset.resizePolicy;
        next.target = { width: Math.max(24, Math.round(pack.asset.source.width / pack.asset.density / pack.defaultMultiplier)), height: Math.max(24, Math.round(pack.asset.source.height / pack.asset.density / pack.defaultMultiplier)) };
      }
      apply(next, { record: false, nextAsset });
    } catch (e) { nextAsset.dispose(); throw e; }
    installAsset(nextAsset, '背景包 · 原始 PNG');
  } else {
    if (text.length > 16384) throw Error('切线配置最大为 16 KiB。');
    apply(input);
  }
  status('配置已恢复，并已核对原始 PNG 摘要。');
}
function history(back) {
  const from = back ? undo : redo, to = back ? redo : undo;
  if (!from.length) return;
  const previous = doc, next = from.at(-1);
  if (attempt(next, { record: false })) { from.pop(); to.push(previous); buttons(); }
}

function bindDrag(element, project) {
  let gesture;
  element.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !doc) return;
    e.preventDefault(); element.setPointerCapture(e.pointerId);
    gesture = { before: structuredClone(doc), x: e.clientX, y: e.clientY, rect: project === resizeProject ? $('preview-frame').getBoundingClientRect() : $('source-stage').getBoundingClientRect() };
  });
  element.addEventListener('pointermove', e => {
    if (!gesture) return;
    attempt(project(e, gesture), { record: false });
  });
  const finish = cancel => {
    if (!gesture) return;
    const before = gesture.before; gesture = undefined;
    if (cancel) attempt(before, { record: false });
    else if (JSON.stringify(before) !== JSON.stringify(doc)) { undo.push(before); if (undo.length > 50) undo.shift(); redo.length = 0; }
    buttons();
  };
  element.addEventListener('pointerup', () => finish(false));
  element.addEventListener('pointercancel', () => finish(true));
  element.addEventListener('lostpointercapture', () => finish(false));
}
function resizeProject(e, g) {
  const scale = g.rect.width / g.before.target.width;
  return { ...g.before, target: { width: Math.round(g.before.target.width + (e.clientX - g.x) / scale), height: Math.round(g.before.target.height + (e.clientY - g.y) / scale) } };
}
async function start() {
  buttons();
  await Promise.all([...document.fonts].map(face => face.load())); await document.fonts.ready;
  app = new Application();
  await app.init({ width: 480, height: 280, backgroundAlpha: 0, resolution: 1, preference: 'webgl', antialias: true, layout: { autoUpdate: false } });
  $('canvas-host').append(app.canvas);
  fixtureSkin = createFixtureSkin(data.template, data.usage, data.profile);
  for (const el of Object.values(inputs)) el.addEventListener('input', () => { if (doc) attempt(readFields()); });
  $('restore').onclick = () => { if (doc) { invalid = false; sync(); status('已恢复当前有效参数。'); } };
  $('undo').onclick = () => history(true); $('redo').onclick = () => history(false);
  for (const button of document.querySelectorAll('[data-size]')) button.onclick = () => {
    const [width, height] = button.dataset.size.split(',').map(Number);
    attempt({ ...doc, target: { width, height } });
  };
  for (const button of document.querySelectorAll('[data-side]')) {
    const side = button.dataset.side;
    bindDrag(button, (e, g) => {
      const horizontal = side === 'left' || side === 'right', total = horizontal ? doc.source.width : doc.source.height;
      const p = horizontal ? (e.clientX - g.rect.left) / g.rect.width : (e.clientY - g.rect.top) / g.rect.height;
      const value = Math.round((side === 'right' || side === 'bottom' ? 1 - p : p) * total);
      return { ...doc, bordersPx: { ...doc.bordersPx, [side]: value } };
    });
    button.addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault(); const direction = ['ArrowRight', 'ArrowDown'].includes(e.key) ? 1 : -1;
      attempt({ ...doc, bordersPx: { ...doc.bordersPx, [side]: doc.bordersPx[side] + direction * (['right', 'bottom'].includes(side) ? -1 : 1) } });
    });
  }
  bindDrag($('resize'), resizeProject);
  $('open-png').onclick = () => $('png-file').click(); $('open-json').onclick = () => $('json-file').click();
  $('png-file').onchange = async () => {
    const file = $('png-file').files[0]; $('png-file').value = '';
    if (!file) return;
    const token = ++loadToken;
    try { if (file.size > maxSourceBytes) throw Error('PNG 最大为 32 MiB。'); await openPng(await file.arrayBuffer(), file.name, false, token); }
    catch (e) { if (token === loadToken) status(e.message, true); }
  };
  $('json-file').onchange = async () => {
    const file = $('json-file').files[0]; $('json-file').value = '';
    if (!file) return;
    const before = revision;
    try { if (file.size > maxPanelJsonBytes) throw Error('背景包最大为 12 MiB。'); const text = await file.text(); if (before !== revision) throw Error('预览已变化，请重新打开配置。'); await openConfig(text); }
    catch (e) { status(e.message, true); }
  };
  $('save-json').onclick = () => {
    download(new Blob([JSON.stringify(doc, null, 2) + '\n'], { type: 'application/json' }), 'panel.slice.json');
    exportStatus('已保存当前有效配置。');
  };
  $('save-package').onclick = async () => {
    const before = revision;
    try {
      const pack = await createBackgroundPackage(doc, asset.blob);
      if (before !== revision || disposed) throw Error('参数已变化，请重新导出背景包。');
      download(new Blob([JSON.stringify(pack, null, 2) + '\n'], { type: 'application/json' }), 'panel.background.json');
      exportStatus('背景包已包含原始 PNG、切线和默认倍率。回到画布，选中 Panel 后导入。');
    } catch (e) { status(e.message, true); }
  };
  $('save-source').onclick = () => download(asset.blob, 'panel.source.png');
  $('export-png').onclick = async () => {
    const capturedRevision = revision; exporting = true; buttons(); exportStatus('正在导出当前有效预览的透明 PNG…');
    try {
      const result = await exportBackgroundPng(app.renderer, scene.panel.adapter.bg, doc.exportResolution);
      if (capturedRevision !== revision || disposed) { status('参数已变化，请按当前预览重新导出。'); return; }
      download(result.blob, `panel-${result.width}x${result.height}.png`); exportStatus(`已导出 ${result.width} × ${result.height} 透明 PNG。`);
    } catch (e) { status(e.message, true); }
    finally { exporting = false; buttons(); }
  };
  const observer = new ResizeObserver(fitPreview); observer.observe($('preview-area'));
  await openPng(await sliceSamplePng(), '程序示例 · 圆角面板', true);
  // Small acceptance surface; read-only snapshots, all mutations use the same
  // validation/transaction path as the UI. No filesystem/network bridge.
  window.sliceEditor = { app, get document() { return structuredClone(doc); }, get panel() { return scene.panel; }, get revision() { return revision; }, apply: input => apply(input), openConfig, openPng, exportPng: () => exportBackgroundPng(app.renderer, scene.panel.adapter.bg, doc.exportResolution) };
  window.addEventListener('pagehide', () => {
    disposed = true; loadToken++; observer.disconnect(); scene?.dispose(); fixtureSkin.dispose(); asset?.dispose();
    if (sourceUrl) URL.revokeObjectURL(sourceUrl); app.destroy(true, { children: true });
  }, { once: true });
  window.sliceEditorReady = true;
}
start().catch(e => { window.sliceEditorError = e.message; status(e.message, true); });
