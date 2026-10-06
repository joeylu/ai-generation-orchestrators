#!/usr/bin/env node
/** Prepare three finite rechecks with current sources/schemas and zero model calls. */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { INPUT_STRESS_RECHECK_SUITE } from '../examples/input-stress-v2/suite.mjs';
import { harnessRoot, createOutputDirectory, readJson, writeNewJson } from '../src/io.mjs';
import { digestBytes, digestJson } from '../src/canonical.mjs';
import { buildNativePanelIntentResponseSchema } from '../src/panel-intent.mjs';
try {
const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) { assert(['--output', '--assets', '--sharp-module', '--build', '--browser', '--network-route'].includes(args[i]) && args[i + 1] && !options[args[i]]); options[args[i]] = args[i + 1]; }
assert(options['--output'] && options['--assets'] && options['--build'] && options['--browser']);
const networkRoute = options['--network-route'] ?? 'inherit';
assert(['inherit', 'explicit-process-proxy'].includes(networkRoute));
const portable = path => { assert(/^[A-Za-z0-9._/-]+$/.test(path) && !path.split('/').includes('..')); return path; };
for (const name of ['--output', '--assets', '--build', '--browser']) portable(options[name]);
const output = await createOutputDirectory(options['--output']);
await writeNewJson(output, 'suite.json', INPUT_STRESS_RECHECK_SUITE);
const childArgs = ['scripts/prepare-panel-evaluation.mjs', '--catalog', 'examples/modern-mint-forms.catalog.json', '--assets', options['--assets'],
  '--suite', `${options['--output']}/suite.json`, '--output', `${options['--output']}/generation`, '--sample', 'ordinal-recheck'];
if (options['--sharp-module']) childArgs.push('--sharp-module', options['--sharp-module']);
const child = spawnSync(process.execPath, childArgs, { cwd: harnessRoot, encoding: 'utf8' });
assert.equal(child.status, 0, 'Preparation only child failed');
const generation = await readJson(join(output, 'generation/evaluation-plan.json'));
const schemas = [];
for (const item of generation.cases) {
  const context = await readJson(join(output, 'generation', item.contextFile)), schema = buildNativePanelIntentResponseSchema(context);
  assert.deepEqual(schema.properties.panelIntentVersion.enum, ['0.8']);
  const path = `generation/${item.id}.schema.json`; await writeNewJson(join(output, 'generation'), `${item.id}.schema.json`, schema);
  schemas.push({ path, sha256: await digestJson(schema) });
}
const sourceFiles = [];
async function scan(path) {
  for (const entry of await readdir(resolve(harnessRoot, path), { withFileTypes: true })) {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) await scan(child);
    else if (entry.isFile() && /\.(?:mjs|json|md|ts)$/.test(entry.name)) sourceFiles.push({ path: child, sha256: await digestBytes(await readFile(resolve(harnessRoot, child))) });
  }
}
for (const path of ['src', 'prompts', 'schemas', '../ui-component-harness/src']) await scan(path);
for (const path of ['scripts/prepare-intent-recheck.mjs', 'scripts/run-intent-recheck.mjs', 'scripts/check-codex-runtime.mjs', 'scripts/prepare-panel-evaluation.mjs', 'scripts/run-panel-evaluation.mjs', 'examples/input-stress-v1/suite.mjs', 'examples/input-stress-v2/suite.mjs'])
  sourceFiles.push({ path, sha256: await digestBytes(await readFile(join(harnessRoot, path))) });
sourceFiles.sort((a, b) => a.path.localeCompare(b.path));
const buildFile = `${options['--build']}/workbench-build.json`, build = await readJson(buildFile);
for (const file of build.files) { const bytes = await readFile(join(harnessRoot, options['--build'], file.path)); assert.equal(bytes.length, file.bytes); assert.equal(await digestBytes(bytes), file.sha256); }
const browserFile = `${options['--browser']}/browser-report.json`, browser = await readJson(browserFile);
assert.equal(browser.status, 'PASS'); assert.equal(browser.modelCalls, 0); assert.equal(browser.fixtureCalls, 3);
const payload = { intentRecheckPlanVersion: '0.1', status: 'PREPARED', modelCalls: 0, authorization: 'REQUIRED_NOT_GRANTED',
  model: 'gpt-6-luna', effort: 'xhigh', maxInvocations: 3, attemptsPerCase: 1, automaticRetries: 0,
  runtimePreflight: { check: 'codex-login-status', before: 'dispatch-claim', modelCalls: 0, networkRoute,
    settingsChanged: false, network: 'NOT_CHECKED', modelAvailability: 'NOT_CHECKED' },
  sourceFiles, schemas, assetRoot: options['--assets'], library: generation.library,
  generation: { file: 'generation/evaluation-plan.json', sha256: generation.sha256 },
  build: { file: buildFile, sha256: await digestJson(build) }, browser: { file: browserFile, sha256: await digestJson(browser), checks: browser.checks.length },
  scope: 'Three independent fresh rechecks only. Original v1 cohort stays FAIL; no all16 composition certification. Browser replay and export use saved results without new models.',
  nativeEngines: 'NOT_RUN', humanVisualReview: 'NOT_RUN' };
const plan = { ...payload, sha256: await digestJson(payload) }; await writeNewJson(output, 'intent-recheck-plan.json', plan);
process.stdout.write(`${JSON.stringify({ status: 'PREPARED', cases: 3, modelCalls: 0, planSha256: plan.sha256, sourceFiles: sourceFiles.length, schemaFiles: schemas.length, output: relative(harnessRoot, output).replaceAll('\\', '/') })}\n`);
} catch (error) {
  const code = /^(?:OUTPUT_|EVALUATION_)[A-Z0-9_]+$/.test(error?.code ?? error?.message ?? '') ? (error.code ?? error.message) : 'INTENT_RECHECK_PREPARE_FAILED';
  process.stderr.write(`${JSON.stringify({ status: 'FAILED', code, modelCalls: 0 })}\n`); process.exitCode = 1;
}
