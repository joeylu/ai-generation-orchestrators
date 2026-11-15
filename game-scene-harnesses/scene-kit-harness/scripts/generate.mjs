import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { check } from '../src/generation/common.mjs';
import { parseJson, readSelectedFile, writeFreshFile } from '../src/files.mjs';
import { initScenePipeline } from '../src/pipeline.mjs';
import { runInteractiveScenePipeline } from '../src/pipeline-interactive.mjs';
import { createSceneCodexAdapter } from '../adapters/codex.mjs';

let reader;
try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') console.log('npm run generate -- --brief FILE --out NEW_PROJECT_DIRECTORY\nResume: npm run generate -- --root PROJECT_DIRECTORY\nUses explicit local Codex image adapter, with exact reference/source compute confirmation. No automatic retry.');
  else {
    const options = {};
    for (let i = 0; i < args.length; i += 2) { check(['--brief', '--out', '--root', '--codex-bin'].includes(args[i]) && args[i + 1] && !Object.hasOwn(options, args[i]), 'PIPELINE_ARGUMENTS'); options[args[i]] = args[i + 1]; }
    check(options['--root'] ? !options['--brief'] && !options['--out'] : options['--brief'] && options['--out'], 'PIPELINE_ARGUMENTS');
    check(process.stdin.isTTY, 'PIPELINE_INTERACTIVE_TERMINAL_REQUIRED');
    const root = resolve(options['--root'] ?? options['--out']);
    if (!options['--root']) initScenePipeline(root, parseJson(readSelectedFile(options['--brief'])));
    const adapter = await createSceneCodexAdapter({ workspace: join(root, 'private-transport'),
      ...(options['--codex-bin'] ? { executable: options['--codex-bin'] } : {}) });
    reader = createInterface({ input: process.stdin, output: process.stdout });
    const show = event => {
      if (event.type === 'status') {
        const names = { 'awaiting-design-review': '等待结构与画风审阅', 'awaiting-reference-compute': '等待参考图计算确认',
          'ready-to-generate-reference': '生成参考图', 'awaiting-reference-review': '等待参考图审阅',
          'awaiting-source-compute': '等待完整来源批次确认', 'ready-to-generate-sources': '生成场景来源',
          'ready-to-assemble': '校验并组装场景包', 'attention-required': '需要处理失败或未知结果' };
        console.log(`流程：${names[event.status.stage] ?? event.status.stage}`);
      } else if (event.type === 'reference') {
        if (existsSync(event.path)) check(readSelectedFile(event.path, 16777216).equals(event.bytes), 'PIPELINE_PREVIEW_CHANGED');
        else writeFreshFile(event.path, event.bytes, join(root, 'workflow'));
        console.log(`参考原图：${event.path}\nSHA-256：${event.rawSha256}`);
      } else if (event.type === 'design') console.log(`结构草案：${join(root, event.files[0])}\n画风草案：${join(root, event.files[1])}${event.files[2] ? `\n分层要求：${join(root, event.files[2])}` : ''}`);
      else if (event.type === 'reference-layers') console.log(`逐层审图清单：${event.path}\n确认所有层可辨认，前景与地形分开，底部没有无设计用途的纯色带。`);
      else if (event.type === 'compute') console.log(`冻结清单：${join(root, event.snapshot)}\n最多生图次数：${event.maximumCalls}\n准确摘要：${event.targetSha256}`);
      else if (event.type === 'progress') console.log(event.stage === 'dispatch' ? `正在生成：${event.assetId}`
        : event.stage === 'received' ? `原图技术接收通过：${event.rawSha256}` : `计算已停止：${event.stage}，计划 ${event.planSha256}`);
      else if (event.type === 'delivery') console.log(`资产包完整性校验通过，运行目录 ${event.result.exportFiles} 个文件。`);
      else if (event.type === 'attention') {
        console.log('流程已停止，请先核对失败或未知结果，保留原图与记录。');
        for (const item of [event.status.reference, ...event.status.sources].filter(Boolean))
          if (['failed', 'indeterminate', 'rejected-technical', 'rejected-visual', 'reserved', 'submitted'].includes(item.status)) console.log(`${item.status}：${item.planSha256}`);
      }
    };
    const result = await runInteractiveScenePipeline(root, join(root, 'delivery'), { adapter, ask: prompt => reader.question(prompt), show });
    if (result.delivery) {
      console.log(`完成候选包：${join(root, 'delivery/scene-kit.zip')}\n来源/派生/整包美术仍须实际审阅。`);
      const [{ buildStudio }, { startStudio }] = await Promise.all([import('./studio-build.mjs'), import('../src/studio/host.mjs')]);
      const staticRoot = await buildStudio();
      const host = await startStudio({ root: join(root, 'delivery/export/kit'), staticRoot, port: 0,
        initialDocument: parseJson(readSelectedFile(join(root, 'delivery/export/scene.document.json'))) });
      console.log(`新场景编辑器：${host.url}\n本终端保持运行。关闭前保存地图；Ctrl+C 停止此预览。`);
      let closing = false;
      const close = async () => { if (closing) return; closing = true; await host.close(); process.exit(0); };
      process.once('SIGINT', close); process.once('SIGTERM', close);
    }
    else console.log(`已停止于 ${result.stage}，证据保留；未自动重试。`);
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: error.errors?.[0]?.code ?? (/^CODEX_[A-Z_]+$/.test(error.message) ? error.message : 'PIPELINE_OPERATION_FAILED'),
    message: 'Stopped. Preserve evidence, inspect setup/attempt state; never automatically retry.' })); process.exitCode = 1;
} finally { reader?.close(); }
