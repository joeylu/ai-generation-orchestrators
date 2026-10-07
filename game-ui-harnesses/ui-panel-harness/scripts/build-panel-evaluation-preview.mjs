#!/usr/bin/env node
/** Revalidate real attempt evidence and build an offline collection with one shared Pixi runtime. */
import { readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorkspaceTool } from './lib/workspace-tools.mjs';
const { build } = await loadWorkspaceTool('vite');
import { validatePanelBundle } from '../src/panel-bundle.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { validateCodexReceipt } from '../src/codex-planner.mjs';
import { checkPanelProposal } from '../src/proposal.mjs';
import { validatePlanningContext } from '../src/planning-context.mjs';
import { validateCodexDiagnostic } from '../src/codex-diagnostics.mjs';
import { evaluatePanelSemantics, evaluateRecipeHits } from '../src/panel-evaluation.mjs';
import { canonicalJson, digestJson, digestBytes } from '../src/canonical.mjs';
import { createOutputDirectory, readJson, writeNewJson, harnessRoot } from '../src/io.mjs';

const equal = (actual, expected) => { if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error('EVALUATION_EVIDENCE_MISMATCH'); };
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const css = '*{box-sizing:border-box}body{margin:0;background:#10252d;color:#e5f2ef;font:15px/1.6 system-ui,sans-serif}header{padding:20px 28px;border-bottom:1px solid #345158;display:flex;gap:20px;align-items:center}h1{font-size:24px;margin:0}h2{font-size:16px}main{padding:24px;display:flex;gap:24px;flex-wrap:wrap}button,a,.import-label{color:inherit}button,.import-label{padding:8px 12px;border-radius:6px;border:1px solid #58867b;background:#213f43;cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.5 ui-monospace,monospace}aside{width:260px}#status[data-state=error],.fail{color:#ffa397}.pass{color:#6ed4bd}table{border-collapse:collapse;width:100%}td,th{padding:9px 12px;text-align:left;border-bottom:1px solid #345158}.viewport{max-width:100%;overflow:auto}canvas{display:block}.import-label input{width:1px;position:absolute;clip-path:inset(50%)}iframe{border:1px solid #345158;border-radius:8px;width:100%;height:900px}.note{color:#abc6c0}';

try {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--run', '--output'].includes(args[i]) || !args[i + 1] || options[args[i]]) throw new Error('EVALUATION_ARGUMENTS');
    options[args[i]] = args[i + 1];
  }
  if (Object.keys(options).length !== 2) throw new Error('EVALUATION_ARGUMENTS');
  const input = resolve(options['--run']), report = await readJson(resolve(input, 'evaluation-report.json'));
  const plan = await readJson(resolve(input, 'evaluation-plan.json')), suite = await readJson(resolve(input, 'suite.json'));
  const { sha256, ...payload } = plan;
  if (sha256 !== await digestJson(payload) || report.planSha256 !== sha256 || plan.cases.length < 1 || plan.cases.length > 64 || suite.cases.length !== plan.cases.length
    || report.cases.length !== plan.cases.length || plan.suiteSha256 !== await digestJson(suite)) throw new Error('EVALUATION_PLAN_MISMATCH');
  const core = await loadWorkspaceCore(), cases = [], bundles = new Map();
  for (let i = 0; i < plan.cases.length; i++) {
    const item = plan.cases[i], expected = suite.cases[i];
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(item.id) || item.id !== expected.id || item.expectedSha256 !== await digestJson(expected.expected)) throw new Error('EVALUATION_CASE_MISMATCH');
    const directory = resolve(input, item.id), result = await readJson(resolve(directory, 'case-result.json'));
    equal(result, report.cases[i]); equal(result.contextSha256, item.contextSha256);
    const names = (await readdir(directory)).filter(name => /^codex-[a-f0-9-]{36}$/.test(name));
    if (names.length !== 1) throw new Error('EVALUATION_ATTEMPT_COUNT');
    const attempt = resolve(directory, names[0]), context = await validatePlanningContext(await readJson(resolve(attempt, 'planning-context.json')));
    if (context.sha256 !== item.contextSha256) throw new Error('EVALUATION_CONTEXT_MISMATCH');
    equal(context.catalogSha256, plan.catalogSha256); equal(context.assetRetrieval.library, plan.library);
    equal(context.request, expected.request); equal(evaluateRecipeHits(context, expected.expected), item.retrieval);
    const receipt = validateCodexReceipt(await readJson(resolve(attempt, 'codex-receipt.json')), { contextSha256: item.contextSha256 }); equal(receipt, result.receipt);
    let semanticFailures = [];
    if (receipt.status !== 'FAILED') {
      const proposal = await readJson(resolve(attempt, 'proposal.json'));
      const checked = await checkPanelProposal(context, proposal); equal(checked, await readJson(resolve(attempt, 'planning-report.json')));
      equal(receipt.proposalSha256, checked.proposalSha256); equal(receipt.status, result.model);
      equal(result.unresolved, checked.unresolved);
      if (checked.status === 'READY_TO_COMPILE') {
        const semantic = evaluatePanelSemantics(proposal.spec, expected.expected);
        equal(semantic, await readJson(resolve(directory, 'semantic-report.json'))); equal(semantic.status, result.semantic);
        semanticFailures = semantic.checks.filter(check => check.status === 'FAIL');
        if (result.compile === 'PASS') {
          const bundle = await validatePanelBundle(await readJson(resolve(directory, 'panel.bundle.json')), core);
          equal(bundle.spec, proposal.spec); equal(bundle.sha256, result.bundleSha256); bundles.set(item.id, bundle);
        }
      }
    } else {
      equal(receipt.failureCode, result.failureCode);
      if (result.diagnostic) equal(result.diagnostic, validateCodexDiagnostic(await readJson(resolve(attempt, 'codex-diagnostic.json')),
        { operation: 'plan', contextSha256: item.contextSha256, failureCode: receipt.failureCode }));
    }
    cases.push({ ...result, requestText: expected.request.text, semanticFailures, previewFile: bundles.has(item.id) ? `${item.id}.html` : null });
  }
  equal(report.totals.invocationCount, cases.reduce((n, item) => n + item.receipt.invocationCount, 0));
  const result = await build({ configFile: false, root: harnessRoot, publicDir: false, logLevel: 'silent',
    build: { write: false, target: 'es2022', minify: true, sourcemap: false,
      lib: { entry: fileURLToPath(new URL('../src/preview.mjs', import.meta.url)), name: 'PanelPreview', formats: ['iife'], fileName: () => 'preview.js' } } });
  const chunks = (Array.isArray(result) ? result : [result]).flatMap(result => result.output);
  if (chunks.length !== 1 || chunks[0].type !== 'chunk') throw new Error('EVALUATION_PREVIEW_BUILD');
  const output = await createOutputDirectory(options['--output']), files = [];
  const save = async (path, content) => { await writeFile(resolve(output, path), content, { flag: 'wx' }); files.push({ path, sha256: await digestBytes(new TextEncoder().encode(content)) }); };
  await save('preview.js', chunks[0].code);
  for (const [id, bundle] of bundles) {
    const embedded = JSON.stringify(bundle).replaceAll('<', '\\u003c');
    await save(`${id}.html`, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(bundle.spec.title)}</title><style>${css}</style><header><h1 id="panel-title">面板预览</h1><span id="status" role="status">正在加载…</span><label class="import-label">打开面板<input id="import" type="file" accept="application/json,.json"></label><button id="export" disabled>导出当前面板</button></header><main><div class="viewport"><div id="canvas-host"></div></div><aside><h2>当前设置</h2><pre id="state"></pre><h2>最近操作</h2><pre id="event">尚未操作</pre><p class="note">真实模型首轮产物。这里只执行面板交互，尚未连接实际游戏。</p></aside></main><script id="initial-panel" type="application/json">${embedded}</script><script src="./preview.js"></script></html>\n`);
  }
  const totals = report.totals, first = cases.find(item => item.previewFile);
  const rows = cases.map((item, i) => `<tr><td>${i + 1}</td><td>${escape(item.title)}</td><td>${escape(item.retrieval.status)}</td><td>${escape(item.model)}</td><td class="${item.semantic === 'PASS' ? 'pass' : 'fail'}">${escape(item.semantic)}</td><td>${escape(item.compile)}</td><td>${item.previewFile ? `<a href="./${item.previewFile}" target="panel-preview">交互预览</a> · <a href="./${item.previewFile}" target="_blank">单独打开</a>` : escape(item.failureCode ?? 'NEEDS_INPUT')}<details><summary>需求与诊断</summary><p>${escape(item.requestText)}</p>${item.diagnostic ? `<p>${escape(item.diagnostic.validatorCode)} · ${escape(item.diagnostic.path ?? '')}</p>` : ''}${item.unresolved.map(question => `<p>澄清：${escape(question.question)}</p>`).join('')}${item.semanticFailures.length ? `<pre>${escape(JSON.stringify(item.semanticFailures, null, 2))}</pre>` : ''}</details></td></tr>`).join('');
  await save('index.html', `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${cases.length} 面板生成验收</title><style>${css}</style><header><h1>${cases.length} 面板生成验收</h1><span>${escape(report.sample?.tag ?? '首轮')}</span></header><main><div style="width:100%"><p>配方命中 ${totals.recipeHits}/${cases.length} · 模型方案合法 ${totals.modelReady}/${cases.length} · 业务断言通过 ${totals.semanticPass}/${cases.length} · 编译通过 ${totals.compilePass}/${cases.length}</p><p class="note">本批每种需求仅调用一次 gpt-6-luna / xhigh，失败不重试，成功与失败全部保留。重复生成稳定性见独立汇总；浏览器交互、人工视觉和原生引擎验收分别记录。</p><table><thead><tr><th>#</th><th>需求</th><th>配方</th><th>模型</th><th>业务</th><th>编译</th><th>结果</th></tr></thead><tbody>${rows}</tbody></table><h2>交互预览</h2>${first ? `<iframe name="panel-preview" title="面板交互预览" src="./${first.previewFile}"></iframe>` : '<p>本批没有可编译的面板，请查看错误报告。</p>'}</div></main></html>\n`);
  await writeNewJson(output, 'evaluation-preview-build.json', { panelEvaluationPreviewVersion: '0.1', status: 'COMPLETE', planSha256: sha256,
    sourceReportSha256: await digestJson(report), totals, cases, files, browser: 'NOT_RUN', nativeEngines: 'NOT_RUN', humanVisualReview: 'NOT_RUN' });
  process.stdout.write(`${JSON.stringify({ status: 'PREVIEW_COLLECTION_BUILT', cases: cases.length, previews: bundles.size, totals })}\n`);
} catch (error) { process.stderr.write(`${JSON.stringify({ status: 'FAILED', code: error.code ?? error.message })}\n`); process.exitCode = 1; }
