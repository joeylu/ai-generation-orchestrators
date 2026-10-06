#!/usr/bin/env node
/** One authorized finite dispatch. No job retry or result repair. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { spawn } from 'node:child_process';
import { harnessRoot, readJson } from '../src/io.mjs';
import { canonicalJson, digestBytes, digestJson } from '../src/canonical.mjs';
import { buildNativePanelIntentResponseSchema } from '../src/panel-intent.mjs';
import { withCodexLoginPreflight, CODEX_RUNTIME_PREFLIGHT_CODES } from '../src/codex-runtime-preflight.mjs';
try {
const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--preflight') { assert(!options['--preflight']); options['--preflight'] = true; continue; }
  assert(['--prepared', '--output', '--approve-plan', '--sharp-module'].includes(args[i]) && args[i + 1] && !options[args[i]]); options[args[i]] = args[++i];
}
assert(options['--prepared']);
const prepared = resolve(harnessRoot, options['--prepared']);
const portablePath = relative(harnessRoot, prepared).replaceAll('\\', '/');
assert(portablePath && /^[A-Za-z0-9._/-]+$/.test(portablePath) && !portablePath.split('/').includes('..'));
const plan = await readJson(resolve(prepared, 'intent-recheck-plan.json')), { sha256, ...payload } = plan;
assert.equal(await digestJson(payload), sha256); assert.equal(plan.intentRecheckPlanVersion, '0.1'); assert.equal(plan.maxInvocations, 3); assert.equal(plan.automaticRetries, 0);
assert(['inherit', 'explicit-process-proxy'].includes(plan.runtimePreflight?.networkRoute));
assert.deepEqual(plan.runtimePreflight, { check: 'codex-login-status', before: 'dispatch-claim', modelCalls: 0, networkRoute: plan.runtimePreflight.networkRoute,
  settingsChanged: false, network: 'NOT_CHECKED', modelAvailability: 'NOT_CHECKED' });
for (const file of plan.sourceFiles) {
  assert(/^(?:src\/|prompts\/|schemas\/|scripts\/|examples\/|\.\.\/ui-component-harness\/src\/)/.test(file.path));
  assert(!file.path.replace(/^\.\.\/ui-component-harness\//, '').split('/').includes('..'));
  assert.equal(await digestBytes(await readFile(resolve(harnessRoot, file.path))), file.sha256, 'Source changed after freeze');
}
const generation = await readJson(resolve(prepared, plan.generation.file)), { sha256: generationSha, ...generationPayload } = generation;
assert.equal(generationSha, plan.generation.sha256); assert.equal(await digestJson(generationPayload), generationSha); assert.equal(generation.cases.length, 3);
for (let i = 0; i < generation.cases.length; i++) {
  const context = await readJson(resolve(prepared, 'generation', generation.cases[i].contextFile));
  const schema = await readJson(resolve(prepared, plan.schemas[i].path));
  assert.equal(await digestJson(schema), plan.schemas[i].sha256); assert.deepEqual(schema, buildNativePanelIntentResponseSchema(context));
}
const build = await readJson(resolve(harnessRoot, plan.build.file)); assert.equal(await digestJson(build), plan.build.sha256);
for (const file of build.files) assert.equal(await digestBytes(await readFile(resolve(harnessRoot, plan.build.file, '..', file.path))), file.sha256);
assert.equal(await digestJson(await readJson(resolve(harnessRoot, plan.browser.file))), plan.browser.sha256);
if (options['--preflight']) assert(!options['--approve-plan']);
else {
  assert.equal(options['--approve-plan'], sha256); assert(options['--output']);
}
await withCodexLoginPreflight(async runtime => {
if (options['--preflight']) { process.stdout.write(`${JSON.stringify({ status: 'PREFLIGHT_PASS', planSha256: sha256, modelCalls: 0, runtime })}\n`); }
else {
  const outputPath = relative(harnessRoot, resolve(harnessRoot, options['--output'])).replaceAll('\\', '/'); assert(outputPath && !outputPath.split('/').includes('..'));
  await writeFile(resolve(prepared, 'dispatch-claim.json'), `${canonicalJson({ intentRecheckDispatchVersion: '0.1', planSha256: sha256, output: outputPath, maxInvocations: 3, automaticRetries: 0 })}\n`, { flag: 'wx' });
  const childArgs = ['scripts/run-panel-evaluation.mjs', '--prepared', `${portablePath}/generation`, '--output', outputPath, '--assets', plan.assetRoot, '--plan-sha256', generationSha];
  if (options['--sharp-module']) childArgs.push('--sharp-module', options['--sharp-module']);
  const child = spawn(process.execPath, childArgs, { cwd: harnessRoot, stdio: 'inherit' });
  process.exitCode = await new Promise(resolveExit => { child.once('error', () => resolveExit(1)); child.once('close', code => resolveExit(code ?? 1)); });
}
}, { cwd: harnessRoot, requireProxyEnvironment: plan.runtimePreflight.networkRoute === 'explicit-process-proxy' });
} catch (error) {
  const code = CODEX_RUNTIME_PREFLIGHT_CODES.includes(error?.code) ? error.code
    : error?.code === 'EEXIST' ? 'INTENT_RECHECK_ALREADY_CONSUMED' : 'INTENT_RECHECK_PREFLIGHT_FAILED';
  process.stderr.write(`${JSON.stringify({ status: 'FAILED', code })}\n`); process.exitCode = 1;
}
