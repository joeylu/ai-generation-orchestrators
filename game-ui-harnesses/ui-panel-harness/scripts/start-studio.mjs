#!/usr/bin/env node
import { launchStudio, parseStudioArguments, studioFailure } from './lib/studio-launcher.mjs';

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  process.stdout.write('用法：npm run studio -- [--port 4951] [--catalog <catalog.json>] [--assets builtin|none|<library>] [--sharp-module <module>] [--codex <absolute executable>]\n默认加载内置12个核心图标；none 使用程序化界面；外部库才需要本地 Sharp。\n固定地址：http://127.0.0.1:4951/；Ctrl+C 停止。检查、构建和启动不调用模型，不安装依赖。\n');
} else {
  try {
    const server = await launchStudio(parseStudioArguments(args), { onPhase: phase => {
      process.stdout.write(`${({ CHECKING: '正在检查依赖…', BUILDING: '正在构建当前版本…', STARTING: '正在启动 Studio…' })[phase]}\n`);
    } });
    process.stdout.write(`${JSON.stringify({ status: 'LOCAL_STUDIO_READY', url: server.url, build: server.studio,
      model: server.model, effort: server.effort, available: server.available, modelCalls: 0 })}\n`);
    process.stdout.write(`打开 ${server.url} 开始使用。保持本窗口运行；Ctrl+C 停止后，使用同一命令重启即可读取本机存档。\n`);
    if (!server.available) process.stdout.write('未找到 Codex CLI：可先打开面板、试玩和导出；生成与修改需要安装并登录 CLI 后重启。\n');
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void server.close(); });
  } catch (error) { process.stderr.write(`${JSON.stringify(studioFailure(error))}\n`); process.exitCode = 1; }
}
