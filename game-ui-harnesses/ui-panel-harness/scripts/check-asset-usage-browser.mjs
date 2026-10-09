#!/usr/bin/env node
/** Six authored panel purposes in two modes, genuine Pixi input and offline delivery. No inference. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadWorkspaceTool } from './lib/workspace-tools.mjs';
import { createOutputDirectory, readJson, writeNewJson, harnessRoot } from '../src/io.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { loadBundledCoreAssets } from '../src/bundled-core-assets.mjs';
import { workbenchAssetInputs } from '../src/workbench-assets.mjs';
import { assetUsageFixtures } from '../examples/asset-usage-v1/fixture.mjs';
import { createPanelBundle, validatePanelBundle } from '../src/panel-bundle.mjs';
import { createPanelDelivery } from '../src/panel-delivery.mjs';
import { createUnityKitFiles } from '../src/unity-kit.mjs';
import { readUnityAdapterSources } from '../src/unity-export-io.mjs';
import { buildDeliveryRuntime } from './build-delivery-runtime.mjs';
import { createStoredZip } from '../src/zip-store.mjs';
import { readStoredZip } from '../tests/unity-kit-helpers.mjs';
import { createWorkbenchModel } from '../src/workbench-model.mjs';
import { canonicalJson, digestBytes } from '../src/canonical.mjs';
import { arrangeIntentSpec } from '../src/panel-intent.mjs';
import { layoutSettings } from '../examples/focused-layout-v1/fixture.mjs';

const args = process.argv.slice(2), options = {};
assert(args.length % 2 === 0, 'Required: --output <fresh directory> [--catalog <file>] [--baseline-catalog <file>]');
for (let i = 0; i < args.length; i += 2) {
  assert(['--output', '--catalog', '--baseline-catalog', '--layout'].includes(args[i]) && !options[args[i]], 'Unknown or duplicate argument');
  options[args[i]] = args[i + 1];
}
assert(options['--output'], 'Required: --output <fresh directory>');
const output = await createOutputDirectory(options['--output']);
const surfaceComparison = Boolean(options['--baseline-catalog']);
assert(!options['--layout'] || options['--layout'] === 'theme-defaults');
const report = { status: 'RUNNING', policy: 'restrained-v1', sourceKind: 'PROGRAMMATIC_FIXTURE', modelCalls: 0,
  checks: [], browserErrors: [], networkRequests: 0, nativeUnity: 'NOT_RUN' };
const pass = name => report.checks.push({ name, status: 'PASS' });
let browser, page;
try {
  const [pool, catalog, base, core, runtime, sources] = await Promise.all([loadBundledCoreAssets(),
    readJson(resolve(harnessRoot, options['--catalog'] ?? 'examples/modern-navigation.catalog.json')),
    readJson(resolve(harnessRoot, 'examples/settings-controls.panel.json')), loadWorkspaceCore(),
    buildDeliveryRuntime(), readUnityAdapterSources()]);
  const baselineCatalog = surfaceComparison ? await readJson(resolve(harnessRoot, options['--baseline-catalog'])) : catalog;
  if (surfaceComparison) Object.assign(report, { comparison: catalog.themes[0].surfaceStyle ?? 'theme', catalog: { id: catalog.id, version: catalog.version }, baselineCatalog: { id: baselineCatalog.id, version: baselineCatalog.version } });
  const fixtures = await assetUsageFixtures(baselineCatalog, base, pool), seed = {};
  for (const mode of ['light', 'dark']) for (const [name, fixture] of Object.entries(fixtures)) {
    report.phase = `${name}-${mode}`;
    const theme = catalog.themes.find(t => t.id === (mode === 'light' ? 'modern-mint-light' : options['--layout'] ? 'modern-mint-dark' : 'modern-blue-dark'));
    const beforeSpec = structuredClone(surfaceComparison ? fixture.chosen : fixture.spec);
    let afterSpec = structuredClone(fixture.chosen);
    const baselineTheme = baselineCatalog.themes.find(t => t.id === theme.id);
    beforeSpec.theme = { id: baselineTheme.id, version: baselineTheme.version };
    afterSpec.theme = { id: theme.id, version: theme.version };
    if(options['--layout'])afterSpec=arrangeIntentSpec(afterSpec,layoutSettings(),theme);
    const before = await createPanelBundle(beforeSpec, baselineCatalog, core, undefined, beforeSpec.assets ? await workbenchAssetInputs(beforeSpec, pool) : undefined);
    const after = await createPanelBundle(afterSpec, catalog, core, before.state, afterSpec.assets ? await workbenchAssetInputs(afterSpec, pool) : undefined);
    for (const property of ['state', 'bindings', 'actions']) assert.deepEqual(after[property], before[property]);
    assert.deepEqual(after.spec.sections, before.spec.sections);
    if(!options['--layout'])assert.deepEqual(after.spec.layout, before.spec.layout);
    else report.layout='theme-defaults';
    pass(`${report.phase}-business-preserved-${options['--layout']?'theme-default-layout':'same-authored-layout'}`);
    const rows = after.spec.sections.flatMap(section => section.rows), assetLabels = Object.fromEntries(pool.index.records.map(r => [r.key, r.metadata.name]));
    seed[report.phase] = { title: `${after.spec.title} · ${mode === 'light' ? '浅色' : '深色'}`, before, after, usage: fixture.usage,
      labels: Object.fromEntries(rows.map(row => [row.id, row.kind === 'button' ? row.buttonLabel : row.label])), assetLabels,
      assetNames: [...new Set((after.spec.assets?.rowIcons ?? []).map(icon => assetLabels[icon.asset]))] };
    for (const [side, bundle] of Object.entries({ before, after })) {
      await validatePanelBundle(bundle, core); const file = resolve(output, 'sources', `${report.phase}.${side}.panel.bundle.json`);
      await mkdir(dirname(file), { recursive: true }); await writeFile(file, canonicalJson(bundle) + '\n', { flag: 'wx' });
    }
    await writeNewJson(output, `${report.phase}.usage.json`, fixture.usage);
    const kit = await createUnityKitFiles(after, core, sources), delivery = await createPanelDelivery(after, core, { runtime, unityKit: kit });
    await mkdir(resolve(output, 'delivery'), { recursive: true });
    await writeFile(resolve(output, 'delivery', `${report.phase}.panel-delivery.zip`), createStoredZip(delivery.contents), { flag: 'wx' });
  }
  const { build } = await loadWorkspaceTool('vite');
  const built = await build({ configFile: false, root: harnessRoot, publicDir: false, logLevel: 'silent', build: {
    write: false, target: 'es2022', minify: true, lib: { entry: resolve(harnessRoot, 'examples/asset-usage-v1/review.mjs'),
      name: 'AssetUsageReview', formats: ['iife'], fileName: () => 'review.js' } } });
  const chunks = (Array.isArray(built) ? built : [built]).flatMap(result => result.output);
  assert.equal(chunks.length, 1); await writeFile(resolve(output, 'review.js'), chunks[0].code, { flag: 'wx' });
  const copy = surfaceComparison ? { title: '面板视觉对比', description: `六类面板的浅深色对比：统一排版、控件美术与按钮主次。两侧素材与业务行为相同，均可试玩。${options['--layout']?'右侧使用新主题的生成默认尺寸与留白。':''}`, before: `现有主题 · ${baselineCatalog.version}`, after: `新主题 · ${catalog.version}`, note: '新主题为独立版本，已有面板保持原主题。' } : { title: '按用途选择图标', description: '六类面板的浅深色对比：只在含义明确且有助于识别时使用图标，其余保留文字。两侧均可试玩。', before: '程序控件基线', after: '按用途选图', note: '选材报告为建议，用户明确选择可覆盖默认值' };
  const navigation = Object.entries(seed).map(([key, entry]) => `<a href="?panel=${key}">${entry.title}</a>`).join('');
  await writeFile(resolve(output, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>${copy.title}</title><style>*{box-sizing:border-box}body{margin:0;background:#101c24;color:#e7f1f4;font:15px/1.65 system-ui,sans-serif}main{max-width:1760px;margin:auto;padding:28px}h1{font-size:26px;margin:0}p{color:#c5d6dd}nav{display:flex;gap:10px;flex-wrap:wrap;margin:20px 0}a{color:#84d5c7;text-decoration:none;border:1px solid #38515e;padding:8px 12px;border-radius:8px}a:focus-visible{outline:2px solid #84d5c7;outline-offset:3px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}article{min-width:0;background:#182b35;border:1px solid #38515e;border-radius:14px;overflow:hidden}h2{font-size:15px;padding:14px 20px;margin:0;border-bottom:1px solid #38515e}.canvas{width:100%;min-width:0}.panel-instance-surface{margin-inline:auto}.notes{padding:18px 0}#decisions{padding-left:22px}footer{display:flex;gap:16px;align-items:center;flex-wrap:wrap}small{color:#b5cad3}@media(max-width:760px){main{padding:16px}.grid{grid-template-columns:1fr}}</style><main><h1 id="name">${copy.title}</h1><p>${copy.description}</p><nav>${navigation}</nav><div class="grid"><article><h2>${copy.before}</h2><div class="canvas" id="before"></div></article><article><h2>${copy.after}</h2><div class="canvas" id="after"></div></article></div><div class="notes"><strong>本页素材</strong><p id="assets"></p><details open><summary>每个控件为什么这样选</summary><ul id="decisions"></ul></details></div><footer><a id="download">下载当前面板 ZIP</a><span id="feedback" role="status">可操作右侧面板</span></footer><p><small>程序化样例 · 模型调用 0 次 · ${copy.note} · Unity 适配包已导出，原生编辑器未验收</small></p></main><script id="review-seed" type="application/json">${canonicalJson(seed).replaceAll('<', '\\u003c')}</script><script src="review.js"></script></html>`, { flag: 'wx' });
  const { chromium } = await loadWorkspaceTool('@playwright/test');
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, acceptDownloads: true });
  page.on('pageerror', error => report.browserErrors.push(error.name));
  page.on('request', request => { if (/^https?:/.test(request.url())) report.networkRequests++; });
  async function click(rowId, fraction = .5) {
    const position = await page.evaluate(({ rowId, fraction }) => {
      const instance = window.assetUsageReview.get('after'), bundle = window.assetUsageReview.source('after');
      const node = instance.inspect().nodes.find(n => n.id === `${bundle.spec.id}.row.${rowId}.control`);
      const canvas = document.querySelector('#after canvas').getBoundingClientRect();
      return { x: canvas.x + (node.bounds.x + node.bounds.width * fraction) * canvas.width / bundle.spec.canvas.width,
        y: canvas.y + (node.bounds.y + node.bounds.height / 2) * canvas.height / bundle.spec.canvas.height };
    }, { rowId, fraction });
    await page.mouse.click(position.x, position.y);
  }
  for (const [key, entry] of Object.entries(seed)) {
    report.phase = key;
    await page.goto(pathToFileURL(resolve(output, 'index.html')).href + '?panel=' + key);
    await page.waitForFunction(() => Boolean(document.documentElement.dataset.ready));
    assert.equal(await page.evaluate(() => document.documentElement.dataset.ready), 'true');
    const inspection = await page.evaluate(() => window.assetUsageReview.get('after').inspect().nodes);
    const icons = inspection.filter(n => n.type === 'Image' && n.id.endsWith('.icon'));
    assert.equal(icons.length, entry.after.spec.assets?.rowIcons.length ?? 0); assert(icons.every(n => n.visible));
    for (const icon of icons) {
      const prefix = icon.id.slice(0, -5), label = inspection.find(n => n.id === prefix + '.label'), control = inspection.find(n => n.id === prefix + '.control');
      const next = label ?? control;
      assert(icon.bounds.x + icon.bounds.width + 8 <= next.bounds.x + .01);
      assert(Math.abs(icon.bounds.y + icon.bounds.height / 2 - (next.bounds.y + next.bounds.height / 2)) <= 4);
      assert([24, 28].includes(icon.bounds.width)); assert.equal(icon.bounds.width, icon.bounds.height);
    }
    pass(key + '-icons-mounted-sized-and-aligned'); await page.screenshot({ path: resolve(output, key + '.png') });
    const rows = entry.after.spec.sections.flatMap(section => section.rows);
    if (key.startsWith('menu') || key.startsWith('pause')) {
      const buttons = rows.map(row => inspection.find(node => node.id === `${entry.after.spec.id}.row.${row.id}.control`));
      assert(buttons.every(node => node.bounds.x === buttons[0].bounds.x && node.bounds.width === buttons[0].bounds.width));
    }
    if (key.startsWith('settings')) {
      await click('volume-row', .65); assert.notEqual(await page.evaluate(() => window.assetUsageReview.get('after').getState().volume), 70);
      await click('mute-row'); assert.equal(await page.evaluate(() => window.assetUsageReview.get('after').getState().muted), true);
      await click('reset-row'); assert.deepEqual(await page.evaluate(() => window.assetUsageReview.get('after').getState()), entry.after.state);
      await click('save'); assert.equal(await page.evaluate(() => window.assetUsageReview.events().at(-1).event.name), 'settings.save');
    } else if (key.startsWith('role')) {
      const input = rows.find(row => row.kind === 'input');
      if(entry.after.compilerVersion==='0.19.0') {
        assert(inspection.filter(n=>n.id.includes('.error.')).every(n=>!n.visible));
        assert.equal(inspection.find(n=>n.id.endsWith('.row.row1.control')).enabled,false);
        await click(input.id);await page.keyboard.insertText('青');
        assert.equal(await page.evaluate(()=>window.assetUsageReview.get('after').inspect().nodes.find(n=>n.id.endsWith('.error.min-length')).visible),true);
        await page.keyboard.press('Backspace');
        assert.equal(await page.evaluate(()=>window.assetUsageReview.get('after').inspect().nodes.find(n=>n.id.endsWith('.error.required')).visible),true);
        pass(key+'-pristine-and-edited-validation');
      }
      await click(input.id); await page.keyboard.insertText('青莓');
      assert.equal(await page.evaluate(field => window.assetUsageReview.get('after').getState()[field], input.bind), '青莓');
      await click(rows.find(row => row.action?.kind === 'submit').id);
      assert.equal(await page.evaluate(() => window.assetUsageReview.events().at(-1).event.action), 'submit');
    } else if (key.startsWith('loading')) {
      await page.evaluate(() => window.assetUsageReview.get('after').setProgress('progress', 72));
      assert.equal(await page.evaluate(() => window.assetUsageReview.get('after').getState().progress), 72);
      assert.equal(await page.evaluate(() => window.assetUsageReview.events().length), 0);
    } else for (const row of rows.filter(row => row.kind === 'button')) {
      await click(row.id); assert.equal(await page.evaluate(() => window.assetUsageReview.events().at(-1).event.name), row.event);
    }
    assert.deepEqual(await page.evaluate(() => window.assetUsageReview.errors()), []); pass(key + '-actual-interactions');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); pass(key + '-narrow-no-overflow');
    await page.setViewportSize({ width: 1920, height: 1080 });
    const pending = page.waitForEvent('download'); await page.locator('#download').click();
    const download = await pending, path = resolve(output, key + '.actual-download.zip'); await download.saveAs(path);
    const files = readStoredZip(await readFile(path)), manifest = JSON.parse(new TextDecoder().decode(files.get('delivery-manifest.json')));
    for (const file of manifest.files) { assert.equal(files.get(file.path).length, file.bytes); assert.equal(await digestBytes(files.get(file.path)), file.sha256); }
    const restored = await validatePanelBundle(JSON.parse(new TextDecoder().decode(files.get('pixi/panel.bundle.json'))), core);
    assert.deepEqual(restored, entry.after); pass(key + '-actual-download-checksums');
    const model = await createWorkbenchModel({ catalog, pool: null }, core);
    try { await model.importPanel(restored); assert.deepEqual(await model.exportPanel(), restored); } finally { model.dispose(); }
    pass(key + '-portable-reimport-without-library');
    const offline = resolve(output, 'offline', key);
    for (const [name, bytes] of files) { const file = resolve(offline, name); assert(file.startsWith(offline + '/') || file.startsWith(offline + '\\'));
      await mkdir(dirname(file), { recursive: true }); await writeFile(file, bytes, { flag: 'wx' }); }
    await page.goto(pathToFileURL(resolve(offline, 'pixi/index.html')).href);
    await page.waitForFunction(() => ['ready', 'error'].includes(document.getElementById('status').dataset.state));
    assert.equal(await page.locator('#status').getAttribute('data-state'), 'ready');
    assert.deepEqual(await page.evaluate(() => window.panelDelivery.getState()), entry.after.state); pass(key + '-actual-download-offline-open');
  }
  assert.deepEqual(report.browserErrors, []); assert.equal(report.networkRequests, 0); report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.failure = { code: /^[A-Z][A-Z0-9_]{0,79}$/.test(error?.code ?? '') ? error.code : 'ASSET_USAGE_BROWSER_FAILED' };
  if (error?.code === 'ERR_ASSERTION') report.assertion = { actual: error.actual, expected: error.expected, operator: error.operator };
  await page?.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {}); process.exitCode = 1;
} finally {
  await browser?.close(); await writeNewJson(output, 'asset-usage-browser-report.json', report);
  process.stdout.write(`${JSON.stringify({ status: report.status, phase: report.phase, checks: report.checks.length, modelCalls: 0, failure: report.failure, assertion: report.assertion })}\n`);
}
