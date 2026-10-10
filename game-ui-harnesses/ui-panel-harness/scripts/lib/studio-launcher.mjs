/** One foreground local Studio; never installs, selects another port, or invokes a model. */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { isAbsolute, resolve } from 'node:path';
import { checkWorkspaceDependencies } from './workspace-tools.mjs';
import { harnessRoot } from '../../src/io.mjs';
import { createWorkbenchServer } from '../../src/workbench-server.mjs';
import { listenLoopback } from '../../src/loopback-listener.mjs';

export const STUDIO_PORT = 4951;
const fail = code => { throw Object.assign(new Error(code), { code }); };
export function parseStudioArguments(args) {
  const values = {}, allowed = ['--port', '--catalog', '--assets', '--sharp-module', '--codex'];
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || Object.hasOwn(values, args[i])) fail('STUDIO_ARGUMENTS');
    values[args[i]] = args[i + 1];
  }
  const port = values['--port'] ?? String(STUDIO_PORT);
  if (!/^[1-9]\d{0,4}$/.test(port) || Number(port) > 65535) fail('STUDIO_PORT');
  if (values['--codex'] && !isAbsolute(values['--codex'])) fail('WORKBENCH_SERVER_CODEX_PATH');
  if (values['--sharp-module'] && !values['--assets']) fail('WORKBENCH_ASSETS_REQUIRED');
  const assets = values['--assets'] ?? 'builtin';
  if (values['--sharp-module'] && ['builtin', 'none'].includes(assets)) fail('WORKBENCH_EXTERNAL_ASSETS_REQUIRED');
  return { port: Number(port), catalog: resolve(harnessRoot, values['--catalog'] ?? 'examples/modern-menu-headings-v2.catalog.json'),
    assets: ['builtin', 'none'].includes(assets) ? assets : resolve(harnessRoot, assets), sharp: values['--sharp-module'], executable: values['--codex'] };
}

export async function checkStudioPort(port) {
  const probe = createServer();
  try {
    await listenLoopback(probe, port);
  } catch (error) { if (error.code === 'EADDRINUSE') fail('STUDIO_PORT_IN_USE'); throw error; }
  finally { if (probe.listening) await new Promise(done => probe.close(done)); }
}

async function buildStudio(args) {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [resolve(harnessRoot, 'scripts/build-workbench.mjs'), ...args],
      { cwd: harnessRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', size = 0;
    const timer = setTimeout(() => { child.kill(); }, 120000);
    const collect = chunk => { size += chunk.length; if (size <= 1024 * 1024) output += chunk.toString('utf8'); else child.kill(); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.once('error', () => { clearTimeout(timer); reject(Object.assign(new Error('STUDIO_BUILD_FAILED'), { code: 'STUDIO_BUILD_FAILED' })); });
    child.once('close', code => {
      clearTimeout(timer);
      if (code === 0) return done();
      let diagnostic;
      try { diagnostic = JSON.parse(output.trim()).code; } catch {}
      const failureCode = diagnostic === 'ENOENT' ? 'STUDIO_INPUT_NOT_FOUND'
        : /^(?:WORKSPACE_|WORKBENCH_|OUTPUT_|PANEL_)[A-Z0-9_]*$/.test(diagnostic ?? '') ? diagnostic : 'STUDIO_BUILD_FAILED';
      reject(Object.assign(new Error('STUDIO_BUILD_FAILED'), { code: failureCode }));
    });
  });
}

export async function launchStudio(options, { preflight = checkWorkspaceDependencies, checkPort = checkStudioPort,
  build = buildStudio, serve = createWorkbenchServer, onPhase = () => {} } = {}) {
  // Occupied fixed ports fail before any build/write. The final bind also catches a competing startup.
  await checkPort(options.port);
  onPhase('CHECKING'); await preflight();
  const workbench = resolve(harnessRoot, 'output/studio-builds', `build-${randomUUID()}`);
  const args = ['--catalog', options.catalog, '--output', workbench];
  if (options.assets) args.push('--assets', options.assets);
  if (options.sharp) args.push('--sharp-module', options.sharp);
  onPhase('BUILDING'); await build(args);
  onPhase('STARTING');
  try {
    return await serve({ workbench, outputRoot: resolve(harnessRoot, 'output/studio-runs'),
      port: options.port, executable: options.executable });
  } catch (error) { if (error.code === 'EADDRINUSE') fail('STUDIO_PORT_IN_USE'); throw error; }
}

export function studioFailure(error) {
  const raw = error?.code ?? error?.message ?? '';
  const code = /^(?:STUDIO_|WORKSPACE_|WORKBENCH_|COMPONENT_|OUTPUT_|CODEX_)[A-Z0-9_]{1,72}$/.test(raw) ? raw : 'STUDIO_START_FAILED';
  const message = code === 'STUDIO_PORT_IN_USE' ? '固定端口已占用。如果 Studio 已打开，请使用现有窗口；更新版本时先停止旧启动进程，再运行同一命令。不会自动换端口或结束其他进程。'
    : code.startsWith('WORKSPACE_') || code.startsWith('COMPONENT_') ? '依赖检查失败。请运行 npm run doctor，并按使用说明准备相邻 ui-component-harness 的锁定依赖。'
    : code === 'STUDIO_PORT' || code === 'WORKBENCH_SERVER_PORT_BLOCKED' ? '端口不可用，请指定 1–65535 范围内浏览器允许的固定端口。更换端口会使用独立本机存档。'
    : code === 'STUDIO_ARGUMENTS' || code === 'WORKBENCH_ASSETS_REQUIRED' || code === 'WORKBENCH_EXTERNAL_ASSETS_REQUIRED' || code === 'WORKBENCH_SERVER_CODEX_PATH' ? '启动参数不正确，请运行 npm run studio -- --help 查看用法。'
    : code === 'STUDIO_INPUT_NOT_FOUND' ? '启动输入文件不存在，请检查 --catalog、--assets 与 --sharp-module 指定的位置。'
    : 'Studio 未启动，原面板和本机存档保留。请核对下方错误代码与启动输入。';
  return { status: 'FAILED', code, message, modelCalls: 0 };
}
