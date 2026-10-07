#!/usr/bin/env node
/** Read-only dependency preflight. Never invokes a model, installs or starts a service. */
import { checkWorkspaceDependencies } from './lib/workspace-tools.mjs';

try {
  if (process.argv.length !== 2) throw new Error('WORKSPACE_ARGUMENTS');
  process.stdout.write(`${JSON.stringify(await checkWorkspaceDependencies())}\n`);
} catch (error) {
  const code = /^(?:WORKSPACE|COMPONENT)_[A-Z_]+$/.test(error.message ?? '') ? error.message : 'WORKSPACE_CHECK_FAILED';
  process.stderr.write(`${JSON.stringify({ status: 'FAILED', code, modelCalls: 0 })}\n`);
  process.exitCode = 1;
}
