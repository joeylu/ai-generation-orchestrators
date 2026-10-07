#!/usr/bin/env node
/** Compose actual accepted generation outputs into independently replayable offline cases. */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../../ui-component-harness/node_modules/vite/dist/node/index.js';
import { composePanelBundles, validatePanelComposition } from '../src/panel-composition.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { validatePanelBundle } from '../src/panel-bundle.mjs';
import { createOutputDirectory, readJson, writeNewJson, harnessRoot } from '../src/io.mjs';
import { canonicalJson, digestJson, digestBytes } from '../src/canonical.mjs';
import { readPanelEvaluationRun } from '../src/panel-evaluation-io.mjs';
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
try {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--run', '--preview', '--output'].includes(args[i]) || !args[i + 1] || options[args[i]]) throw new Error('COMPOSITION_ARGUMENTS');
    options[args[i]] = args[i + 1];
  }
  if (Object.keys(options).length !== 3) throw new Error('COMPOSITION_ARGUMENTS');
  const run = resolve(options['--run']), core = await loadWorkspaceCore(), verified = await readPanelEvaluationRun(run, core), report = verified.report;
  const preview = await readJson(resolve(options['--preview'], 'evaluation-preview-build.json'));
  if (report.status !== 'PASS_BEFORE_BROWSER' || report.cases.length !== 16 || preview.sourceReportSha256 !== await digestJson(report)
    || preview.cases.some(item => item.model !== 'READY_TO_COMPILE' || item.semantic !== 'PASS' || item.compile !== 'PASS')) throw new Error('COMPOSITION_SOURCE_GATE');
  const sources = new Map();
  for (const item of report.cases) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(item.id)) throw new Error('COMPOSITION_SOURCE_ID');
    const bundle = verified.bundles.get(item.id); if (!bundle) throw new Error('COMPOSITION_SOURCE_GATE');
    if (bundle.sha256 !== item.bundleSha256 || preview.cases.find(p => p.id === item.id)?.bundleSha256 !== bundle.sha256) throw new Error('COMPOSITION_SOURCE_GATE');
    sources.set(item.id, bundle);
  }
  const all = [...sources.keys()];
  const definitions = [
    { id: 'compose-all-column', title: '16 面板单列组合', ids: all, layout: 'column', width: 960 },
    { id: 'compose-all-grid', title: '16 面板双列组合', ids: all, layout: 'grid', width: 1600 },
    { id: 'compose-settings-row', title: '声音画质控制横排', ids: ['eval-audio', 'eval-graphics', 'eval-controls'], layout: 'row', width: 2100 },
    { id: 'compose-collision', title: '同一声音面板的两个实例', ids: ['eval-audio', 'eval-audio'], layout: 'grid', width: 1280 },
    { id: 'compose-rich', title: '角色房间商店语言任务组合', ids: ['eval-character', 'eval-room', 'eval-shop', 'eval-language', 'eval-quest'], layout: 'grid', width: 1600 },
  ];
  const output = await createOutputDirectory(options['--output']), files = [], cases = [];
  const save = async (path, content) => { await writeFile(resolve(output, path), content, { flag: 'wx' }); files.push({ path, sha256: await digestBytes(new TextEncoder().encode(content)) }); };
  const json = async (path, value) => save(path, `${canonicalJson(value)}\n`);
  const result = await build({ configFile: false, root: harnessRoot, publicDir: false, logLevel: 'silent', build: {
    write: false, target: 'es2022', minify: true, sourcemap: false,
    lib: { entry: fileURLToPath(new URL('../src/preview.mjs', import.meta.url)), name: 'PanelPreview', formats: ['iife'], fileName: () => 'preview.js' } } });
  const chunks = (Array.isArray(result) ? result : [result]).flatMap(result => result.output);
  if (chunks.length !== 1 || chunks[0].type !== 'chunk') throw new Error('COMPOSITION_BUILD');
  await save('preview.js', chunks[0].code);
  for (const definition of definitions) {
    const bundles = definition.ids.map(id => sources.get(id));
    const request = { panelCompositionRequestVersion: '0.1', id: definition.id, title: definition.title,
      sources: bundles.map((bundle, i) => ({ namespace: `part${i + 1}`, bundleSha256: bundle.sha256 })),
      layout: definition.layout, width: definition.width, canvasWidth: definition.width + 64, canvasHeight: null, maxHeight: 480, surfaceFrom: null };
    const composed = await validatePanelComposition(await composePanelBundles(request, bundles, core), bundles, core);
    await json(`${definition.id}.composition.json`, composed);
    const embedded = JSON.stringify(composed.bundle).replaceAll('<', '\\u003c');
    await save(`${definition.id}.html`, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${escape(definition.title)}</title><style>body{margin:0;background:#10252d;color:#e5f2ef;font:15px system-ui}header{padding:20px;display:flex;gap:20px;align-items:center}button,.import-label{padding:10px;color:inherit;background:#213f43;border:1px solid #58867b;border-radius:6px}.import-label input{width:1px;position:absolute;clip-path:inset(50%)}main{display:flex;gap:20px;padding:20px;flex-wrap:wrap}.viewport{overflow:auto;max-width:100%}pre{white-space:pre-wrap;overflow-wrap:anywhere}aside{width:300px}</style><header><h1 id="panel-title">组合面板</h1><span id="status" role="status">正在加载…</span><label class="import-label">打开面板<input id="import" type="file" accept="application/json,.json"></label><button id="export" disabled>导出当前面板</button></header><main><div class="viewport"><div id="canvas-host"></div></div><aside><h2>当前设置</h2><pre id="state"></pre><h2>最近操作</h2><pre id="event"></pre><p>由 ${bundles.length} 个真实生成面板确定性组合。重置范围按来源隔离；交互尚未接入实际游戏。</p></aside></main><script id="initial-panel" type="application/json">${embedded}</script><script src="./preview.js"></script></html>\n`);
    cases.push({ id: definition.id, title: definition.title, sourceCaseIds: definition.ids, previewFile: `${definition.id}.html`,
      compositionFile: `${definition.id}.composition.json`, model: 'PROGRAM_COMPOSED', semantic: 'PASS', compile: 'PASS',
      bundleSha256: composed.bundle.sha256, receiptSha256: composed.receipt.sha256 });
  }
  await save('index.html', `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>面板组合验收</title><style>body{background:#10252d;color:#e5f2ef;font:16px system-ui;padding:20px}a{color:#6ed4bd}li{margin:12px 0}iframe{width:100%;height:1000px;border:1px solid #345158}</style><h1>面板组合验收</h1><p>来源为同一轮通过业务断言的 16 个真实生成面板。组合不调用模型。完整来源、命名映射和重置范围可按回执重放验证。</p><ul>${cases.map(item => `<li><a target="composition-preview" href="./${item.previewFile}">${escape(item.title)}</a> · ${item.sourceCaseIds.length} 个来源</li>`).join('')}</ul><iframe name="composition-preview" src="./${cases[1].previewFile}" title="组合面板交互"></iframe></html>\n`);
  await writeNewJson(output, 'composition-preview-build.json', { panelCompositionPreviewVersion: '0.1', status: 'COMPLETE',
    planSha256: report.planSha256, sourceReportSha256: await digestJson(report), sourceCases: all, cases, files,
    modelCalls: 0, browser: 'NOT_RUN', nativeEngines: 'NOT_RUN', humanVisualReview: 'NOT_RUN' });
  process.stdout.write(`${JSON.stringify({ status: 'COMPOSITION_COLLECTION_BUILT', cases: cases.length, modelCalls: 0 })}\n`);
} catch (error) { process.stderr.write(`${JSON.stringify({ status: 'FAILED', code: error.code ?? error.message })}\n`); process.exitCode = 1; }
