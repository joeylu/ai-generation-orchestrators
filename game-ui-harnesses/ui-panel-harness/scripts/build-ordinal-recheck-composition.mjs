#!/usr/bin/env node
/** Three fresh accepted sources only. Never substitutes them into the failed original 16-case cohort. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../../ui-component-harness/node_modules/vite/dist/node/index.js';
import { composePanelBundles, validatePanelComposition } from '../src/panel-composition.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { readPanelEvaluationRun } from '../src/panel-evaluation-io.mjs';
import { createOutputDirectory, readJson, writeNewJson, harnessRoot } from '../src/io.mjs';
import { canonicalJson, digestJson, digestBytes } from '../src/canonical.mjs';
try {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i += 2) {
    assert(['--run', '--preview', '--output'].includes(args[i]) && args[i + 1] && !options[args[i]]); options[args[i]] = args[i + 1];
  }
  assert.equal(Object.keys(options).length, 3);
  const core = await loadWorkspaceCore(), run = await readPanelEvaluationRun(options['--run'], core);
  const preview = await readJson(resolve(options['--preview'], 'evaluation-preview-build.json'));
  assert.equal(run.report.status, 'PASS_BEFORE_BROWSER'); assert.equal(run.cases.length, 3);
  assert.deepEqual(run.cases.map(item => item.id), ['eval-graphics', 'eval-character', 'eval-inventory']);
  assert.equal(preview.sourceReportSha256, await digestJson(run.report));
  for (const file of preview.files) assert.equal(await digestBytes(await readFile(resolve(options['--preview'], file.path))), file.sha256);
  for (const item of run.cases) assert.equal(preview.cases.find(p => p.id === item.id)?.bundleSha256, run.bundles.get(item.id).sha256);
  const definitions = [
    { id: 'ordinal-three-row', title: '画质、角色、背包横排组合', ids: run.cases.map(item => item.id), layout: 'row', width: 2100 },
    { id: 'ordinal-three-grid', title: '三个新面板双列组合', ids: run.cases.map(item => item.id), layout: 'grid', width: 1600 },
    { id: 'ordinal-inventory-twins', title: '背包两个独立实例', ids: ['eval-inventory', 'eval-inventory'], layout: 'grid', width: 1280 },
  ];
  const output = await createOutputDirectory(options['--output']), files = [], cases = [];
  const save = async (path, text) => { await writeFile(resolve(output, path), text, { flag: 'wx' }); files.push({ path, sha256: await digestBytes(new TextEncoder().encode(text)) }); };
  const result = await build({ configFile: false, root: harnessRoot, publicDir: false, logLevel: 'silent', build: {
    write: false, target: 'es2022', minify: true, sourcemap: false,
    lib: { entry: fileURLToPath(new URL('../src/preview.mjs', import.meta.url)), name: 'PanelPreview', formats: ['iife'], fileName: () => 'preview.js' } } });
  const chunks = (Array.isArray(result) ? result : [result]).flatMap(item => item.output); assert.equal(chunks.length, 1); assert.equal(chunks[0].type, 'chunk');
  await save('preview.js', chunks[0].code);
  for (const definition of definitions) {
    const sources = definition.ids.map(id => run.bundles.get(id));
    const request = { panelCompositionRequestVersion: '0.1', id: definition.id, title: definition.title,
      sources: sources.map((bundle, i) => ({ namespace: `part${i + 1}`, bundleSha256: bundle.sha256 })),
      layout: definition.layout, width: definition.width, canvasWidth: definition.width + 64, canvasHeight: null, maxHeight: 480, surfaceFrom: null };
    const composed = await validatePanelComposition(await composePanelBundles(request, sources, core), sources, core);
    await save(`${definition.id}.composition.json`, `${canonicalJson(composed)}\n`);
    const seed = JSON.stringify(composed.bundle).replaceAll('<', '\\u003c');
    await save(`${definition.id}.html`, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${definition.title}</title><style>body{margin:0;background:#10252d;color:#e5f2ef;font:15px system-ui}header{padding:20px;display:flex;gap:20px;align-items:center}button,.import-label{padding:10px;color:inherit;background:#213f43;border:1px solid #58867b;border-radius:6px}.import-label input{width:1px;position:absolute;clip-path:inset(50%)}main{display:flex;gap:20px;padding:20px;flex-wrap:wrap}.viewport{overflow:auto;max-width:100%}pre{white-space:pre-wrap;overflow-wrap:anywhere}aside{width:300px}</style><header><h1 id="panel-title">组合面板</h1><span id="status" role="status">正在加载…</span><label class="import-label">打开面板<input id="import" type="file" accept="application/json,.json"></label><button id="export" disabled>导出当前面板</button></header><main><div class="viewport"><div id="canvas-host"></div></div><aside><h2>当前设置</h2><pre id="state"></pre><h2>最近操作</h2><pre id="event"></pre><p>由本次 ${sources.length} 个真实生成来源确定性组合，未接实际游戏。</p></aside></main><script id="initial-panel" type="application/json">${seed}</script><script src="./preview.js"></script></html>\n`);
    cases.push({ id: definition.id, title: definition.title, sourceCaseIds: definition.ids, previewFile: `${definition.id}.html`,
      compositionFile: `${definition.id}.composition.json`, model: 'PROGRAM_COMPOSED', semantic: 'PASS', compile: 'PASS',
      bundleSha256: composed.bundle.sha256, receiptSha256: composed.receipt.sha256 });
  }
  await save('index.html', `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>三项真实复验组合</title><style>body{background:#10252d;color:#e5f2ef;font:16px system-ui;padding:20px}a{color:#6ed4bd}li{margin:12px 0}iframe{width:100%;height:1000px;border:1px solid #345158}</style><h1>三项真实复验组合</h1><p>仅包含本次画质、角色、背包真实成功来源。原16条同轮验收仍为13/16，不能将本页视为全16组合验收。</p><ul>${cases.map(item => `<li><a target="composition-preview" href="./${item.previewFile}">${item.title}</a></li>`).join('')}</ul><iframe name="composition-preview" src="./${cases[1].previewFile}" title="组合面板交互"></iframe></html>\n`);
  await writeNewJson(output, 'composition-preview-build.json', { panelCompositionPreviewVersion: '0.1', status: 'COMPLETE',
    planSha256: run.plan.sha256, sourceReportSha256: await digestJson(run.report), sourceCases: run.cases.map(item => item.id), cases, files,
    modelCalls: 0, browser: 'NOT_RUN', nativeEngines: 'NOT_RUN', humanVisualReview: 'NOT_RUN',
    scope: 'Three fresh sources in row/grid/twin compositions only; original all16 source gate remains unchanged.' });
  console.log(JSON.stringify({ status: 'COMPOSITION_COLLECTION_BUILT', cases: cases.length, modelCalls: 0 }));
} catch { console.error(JSON.stringify({ status: 'FAIL', code: 'ORDINAL_COMPOSITION_FAILED', modelCalls: 0 })); process.exitCode = 1; }
