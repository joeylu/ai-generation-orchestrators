import { setTimeout as sleep } from 'node:timers/promises';
import { createSceneCodexAdapter } from '../adapters/codex.mjs';
import { check } from '../src/generation/common.mjs';
import { openEnvironmentAnimationExchange } from '../src/generation/environment-animation-exchange.mjs';

try {
  const args = process.argv.slice(2), options = {};
  while (args.length) {
    const flag = args.shift(), value = args.shift();
    check(['--exchange', '--codex-executable'].includes(flag) && value && !options[flag], 'ANIMATION_WORKER_USAGE');
    options[flag] = value;
  }
  const directory = options['--exchange'];
  check(directory, 'ANIMATION_WORKER_USAGE');
  check(!process.env.OPENAI_API_KEY, 'CODEX_CHATGPT_LOGIN_ONLY');
  const exchange = openEnvironmentAnimationExchange(directory);
  const id = exchange.registerWorker();
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stopping = true; });
  console.log(JSON.stringify({ status: 'environment-animation-worker-ready' }));
  while (!stopping) {
    await exchange.dispatch(id, workspace => createSceneCodexAdapter({ workspace, executable: options['--codex-executable'] ?? 'codex' }));
    if (!stopping) await sleep(750);
  }
} catch (error) {
  console.error(JSON.stringify({ code: error.errors?.[0]?.code ?? 'ANIMATION_WORKER_FAILURE',
    usage: 'node scripts/environment-animation-worker.mjs --exchange DIRECTORY [--codex-executable EXECUTABLE]' }));
  process.exitCode = 1;
}
