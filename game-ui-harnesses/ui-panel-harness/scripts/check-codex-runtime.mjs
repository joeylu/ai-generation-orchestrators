#!/usr/bin/env node
/** Read-only CLI status, optionally materialized as sanitized local evidence. Never calls a model. */
import { checkCodexLoginVisibility } from '../src/codex-runtime-preflight.mjs';
import { createOutputDirectory, harnessRoot, writeNewJson } from '../src/io.mjs';
try {
  const args = process.argv.slice(2);
  if (args.length && !(args.length === 2 && args[0] === '--output' && args[1])) throw new Error('ARGUMENTS');
  const result = checkCodexLoginVisibility({ cwd: harnessRoot });
  if (args.length) await writeNewJson(await createOutputDirectory(args[1]), 'runtime-preflight.json', result);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== 'PASS') process.exitCode = 1;
} catch {
  process.stderr.write(`${JSON.stringify({ status: 'FAIL', code: 'CODEX_RUNTIME_CHECK_FAILED', modelCalls: 0 })}\n`);
  process.exitCode = 1;
}
