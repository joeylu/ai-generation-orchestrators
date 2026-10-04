#!/usr/bin/env node
/** Build static files only; no dependency installation, network or sibling writes. */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { build } from '../../ui-component-harness/node_modules/vite/dist/node/index.js';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { validatePanelBundle } from '../src/panel-bundle.mjs';
import { readJson, createOutputDirectory, writeNewJson, harnessRoot } from '../src/io.mjs';
import { digestBytes } from '../src/canonical.mjs';

try {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--bundle', '--output'].includes(args[i]) || !args[i + 1] || options[args[i]]) throw new Error('PREVIEW_ARGUMENTS');
    options[args[i]] = args[i + 1];
  }
  if (Object.keys(options).length !== 2) throw new Error('PREVIEW_ARGUMENTS');
  const bundle = await validatePanelBundle(await readJson(options['--bundle']), await loadWorkspaceCore());
  const result = await build({ configFile: false, root: harnessRoot, publicDir: false, logLevel: 'silent',
    build: { write: false, target: 'es2022', minify: true, sourcemap: false,
      lib: { entry: fileURLToPath(new URL('../src/preview.mjs', import.meta.url)), name: 'PanelPreview', formats: ['iife'], fileName: () => 'preview.js' },
    },
  });
  const files = (Array.isArray(result) ? result : [result]).flatMap(r => r.output);
  if (files.length !== 1 || files[0].type !== 'chunk' || files[0].fileName !== 'preview.js') throw new Error('PREVIEW_BUILD_SHAPE');
  const embedded = JSON.stringify(bundle).replace(/</g, '\\u003c');
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>面板预览</title><style>
*{box-sizing:border-box}body{margin:0;background:#10252d;color:#e5f2ef;font:15px system-ui,sans-serif}header{padding:24px 32px;display:flex;align-items:center;gap:20px;border-bottom:1px solid #345158}h1{margin:0;font-size:22px}#status{color:#abc6c0;margin-right:auto}#status[data-state=error]{color:#ffa397}button,.import-label{border:1px solid #58867b;border-radius:8px;padding:10px 14px;color:inherit;background:#213f43;font:inherit;cursor:pointer}button:focus-visible,.import-label:focus-within{outline:3px solid #65c9b1;outline-offset:3px}button:disabled{opacity:.4;cursor:default}.import-label input{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}main{padding:24px;display:flex;align-items:flex-start;gap:24px;flex-wrap:wrap}.viewport{max-width:100%;overflow:auto;border-radius:12px}canvas{display:block}aside{width:260px;padding:4px 12px}h2{font-size:15px;color:#abc6c0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.6 ui-monospace,monospace}p{font-size:13px;line-height:1.7;color:#abc6c0}
</style><header><h1 id="panel-title">面板预览</h1><span id="status" role="status">正在加载…</span><label class="import-label">打开面板<input id="import" type="file" accept="application/json,.json"></label><button id="export" disabled>导出当前面板</button></header>
<main><div class="viewport"><div id="canvas-host"></div></div><aside><h2>当前设置</h2><pre id="state"></pre><h2>最近操作</h2><pre id="event">尚未操作</pre><p>这里展示面板交互。音量、画质等设置尚未连接实际游戏；导出的文件会保存当前选择。</p></aside></main>
<script id="initial-panel" type="application/json">${embedded}</script><script src="./preview.js"></script></html>\n`;
  const output = await createOutputDirectory(options['--output']);
  const contents = [{ path: 'index.html', content: html }, { path: 'preview.js', content: files[0].code }];
  for (const file of contents) await writeFile(resolve(output, file.path), file.content, { flag: 'wx' });
  await writeNewJson(output, 'preview-build.json', { previewBuildVersion: '0.1', status: 'COMPLETE', panelSha256: bundle.sha256,
    files: await Promise.all(contents.map(async f => ({ path: f.path, sha256: await digestBytes(new TextEncoder().encode(f.content)) }))),
    runtime: 'Workspace component source bundled read-only with panel session', browser: 'NOT_RUN', nativeEngines: 'NOT_RUN' });
  process.stdout.write(`${JSON.stringify({ status: 'STATIC_PREVIEW_BUILT', files: ['index.html', 'preview.js', 'preview-build.json'], panelSha256: bundle.sha256 })}\n`);
} catch (error) { process.stderr.write(`${JSON.stringify({ status: 'FAILED', code: error.code ?? String(error.message).split(':')[0] })}\n`); process.exitCode = 1; }
