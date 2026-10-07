#!/usr/bin/env node
/** A local entry page for SHA-bound accepted results. Never generates panels or calls models. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { harnessRoot, createOutputDirectory, readJson, writeNewJson } from '../src/io.mjs';
import { digestJson, digestBytes } from '../src/canonical.mjs';
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
function localPath(input) {
  const path = resolve(input), rel = relative(harnessRoot, path);
  assert(rel && rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\') && !isAbsolute(rel)); return path;
}
try {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i += 2) { assert(['--report', '--panels', '--mixed', '--compositions', '--output'].includes(args[i]) && args[i + 1] && !options[args[i]]); options[args[i]] = args[i + 1]; }
  assert.equal(Object.keys(options).length, 5);
  const reportPath = localPath(options['--report']), report = await readJson(reportPath), { sha256, ...payload } = report;
  assert.equal(sha256, await digestJson(payload)); assert.equal(report.status, 'PASS');
  assert.equal(report.totals.repeatedGenerationPass, 32); assert.equal(report.totals.repeatedBrowserPass, 32);
  assert.equal(report.totals.mixedPass, 6); assert.equal(report.totals.compositionPass, 5);
  const entries = [
    { directory: localPath(options['--panels']), label: '16 个面板', count: 16, file: 'evaluation-preview-build.json' },
    { directory: localPath(options['--mixed']), label: '6 份混合需求', count: 6, file: 'evaluation-preview-build.json' },
    { directory: localPath(options['--compositions']), label: '5 种面板组合', count: 5, file: 'composition-preview-build.json' },
  ];
  for (const [i, entry] of entries.entries()) {
    const manifest = await readJson(resolve(entry.directory, entry.file)); assert.equal(manifest.status, 'COMPLETE'); assert.equal(manifest.cases.length, entry.count);
    assert(manifest.cases.every(item => item.semantic === 'PASS' && item.compile === 'PASS' && item.previewFile));
    if (i === 0) { assert.equal(manifest.planSha256, report.samples[0].planSha256); assert.equal(manifest.sourceReportSha256, report.samples[0].reportSha256); }
    if (i === 1) assert.equal(manifest.planSha256, report.mixed.planSha256);
    if (i === 2) {
      const path = relative(harnessRoot, resolve(entry.directory, entry.file)).replaceAll('\\', '/');
      const evidence = report.evidence.find(item => item.path === path); assert(evidence);
      assert.equal(await digestBytes(await readFile(resolve(entry.directory, entry.file))), evidence.sha256);
    }
    for (const file of manifest.files) { assert(/^[A-Za-z0-9._-]+$/.test(file.path)); assert.equal(await digestBytes(await readFile(resolve(entry.directory, file.path))), file.sha256); }
  }
  const output = await createOutputDirectory(options['--output']);
  const href = path => relative(output, path).replaceAll('\\', '/').split('/').map(encodeURIComponent).join('/');
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>面板生成验收</title><style>body{margin:0;background:#10252d;color:#e5f2ef;font:16px system-ui}header{padding:24px}h1{margin:0 0 12px}.stats{display:flex;gap:12px;flex-wrap:wrap}.stats span,a{padding:12px 16px;border:1px solid #3e6468;border-radius:8px}.stats span{background:#18363d}nav{display:flex;gap:12px;flex-wrap:wrap;margin:24px 0}a{color:#74d7bd;text-decoration:none}p{line-height:1.7}iframe{width:100%;height:1200px;border:0;border-top:1px solid #3e6468}</style><header><h1>面板生成验收已通过</h1><div class="stats"><span>16 类面板 · 两轮 32/32</span><span>混合需求 · 6/6</span><span>面板组合 · 5/5</span><span>Pixi 交互 · ${report.totals.browserChecks} 项通过</span></div><p>独立面板与混合需求经过真实 Codex 生成、业务断言、编译和交互验收。组合通过来源复验与交互检查，保留初值和当前值，隔离控件、事件与恢复默认范围。</p><nav>${entries.map(entry => `<a href="${escape(href(resolve(entry.directory, 'index.html')))}" target="accepted-preview">${entry.label}</a>`).join('')}<a href="http://127.0.0.1:4185/" target="_blank" rel="noopener">测试新需求</a><a href="${escape(href(reportPath))}" target="_blank">完整验收报告</a></nav><p>覆盖这 16 类受支持面板和已测组合。历史失败保留在报告中；组合过程不调用模型。Unity 原生编辑器、人工视觉与实际游戏接线另行验收。</p></header><iframe name="accepted-preview" src="${escape(href(resolve(entries[0].directory, 'index.html')))}" title="已验收的面板预览"></iframe></html>\n`;
  await writeFile(resolve(output, 'index.html'), html, { flag: 'wx' });
  await writeNewJson(output, 'stability-preview-build.json', { status: 'COMPLETE', reportSha256: sha256,
    files: [{ path: 'index.html', sha256: await digestBytes(new TextEncoder().encode(html)) }], modelCalls: 0 });
  process.stdout.write(`${JSON.stringify({ status: 'STABILITY_PREVIEW_BUILT', modelCalls: 0 })}\n`);
} catch (error) { process.stderr.write(`${JSON.stringify({ status: 'FAIL', code: error.code ?? 'STABILITY_PREVIEW_FAILED' })}\n`); process.exitCode = 1; }
