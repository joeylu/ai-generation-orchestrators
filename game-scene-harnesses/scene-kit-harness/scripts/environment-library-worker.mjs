import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { openEnvironmentLibraryExchange } from '../src/generation/environment-library-exchange.mjs';

try {
  const args = process.argv.slice(2), options = {};
  while (args.length) {
    const key = args.shift(), value = args.shift();
    if (!['--exchange', '--adapter', '--private-workspace', '--codex-executable'].includes(key) || !value || options[key]) throw new Error();
    options[key] = value;
  }
  if (!options['--exchange'] || !options['--adapter'] || !options['--private-workspace']) throw new Error();
  const exchange = openEnvironmentLibraryExchange(options['--exchange']);
  const workspace = resolve(options['--private-workspace']);
  mkdirSync(workspace, { recursive: true });
  const choice = options['--adapter'];
  const { createEnvironmentLibraryAdapter } = await import(choice === 'codex'
    ? '../adapters/environment-library-codex.mjs' : pathToFileURL(resolve(choice)).href);
  const adapter = await createEnvironmentLibraryAdapter({
    workspace, executable: options['--codex-executable'],
  });
  if (typeof adapter.interpretContent !== 'function' || typeof adapter.generate !== 'function') throw new Error();
  await adapter.preflight?.();
  console.log(JSON.stringify({ status: 'environment-library-worker-ready' }));
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stopping = true; });
  while (!stopping) {
    await exchange.dispatch(adapter);
    if (!stopping) await sleep(750);
  }
} catch {
  console.error(JSON.stringify({ status: 'environment-library-worker-stopped',
    usage: 'environment-library-worker.mjs --exchange DIRECTORY --private-workspace DIRECTORY --adapter codex|MODULE [--codex-executable EXECUTABLE]' }));
  process.exitCode = 1;
}
