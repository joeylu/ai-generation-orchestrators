#!/usr/bin/env node
import { isAbsolute } from 'node:path';
import { createWorkbenchServer } from '../src/workbench-server.mjs';

const fail = code => { const error = new Error(code); error.code = code; throw error; };
function parse(args) {
  const allowed = ['--workbench', '--output-root', '--port', '--codex'], values = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || Object.hasOwn(values, args[i])) fail('WORKBENCH_SERVER_ARGUMENTS');
    values[args[i]] = args[i + 1];
  }
  if (!values['--workbench'] || !values['--output-root']) fail('WORKBENCH_SERVER_ARGUMENTS');
  if (values['--codex'] && !isAbsolute(values['--codex'])) fail('WORKBENCH_SERVER_CODEX_PATH');
  const portText = values['--port'] ?? '4184';
  if (!/^(0|[1-9]\d{0,4})$/.test(portText) || Number(portText) > 65535) fail('WORKBENCH_SERVER_PORT');
  return { workbench: values['--workbench'], outputRoot: values['--output-root'], port: Number(portText), executable: values['--codex'] };
}
try {
  const server = await createWorkbenchServer(parse(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify({ status: 'LOCAL_WORKBENCH_LISTENING', url: server.url, model: server.model, effort: server.effort })}\n`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void server.close(); });
} catch (error) {
  const code = /^(?:WORKBENCH_SERVER_|CODEX_|OUTPUT_)[A-Z0-9_]{1,72}$/.test(error?.code ?? '') ? error.code : 'WORKBENCH_SERVER_FAILED';
  process.stderr.write(`${JSON.stringify({ status: 'FAILED', code })}\n`);
  process.exitCode = 1;
}
