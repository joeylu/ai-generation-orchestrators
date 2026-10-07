#!/usr/bin/env node
/** Finite single-use real quote regression dispatch, with saved-result-only post gates. */
import assert from 'node:assert/strict';
import { readFile, writeFile, lstat, readdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { spawn } from 'node:child_process';
import { harnessRoot, readJson, writeNewJson, createOutputDirectory } from '../src/io.mjs';
import { canonicalJson, digestBytes, digestJson } from '../src/canonical.mjs';
import { buildNativePanelIntentResponseSchema, validateNativePanelIntentEvidence } from '../src/panel-intent.mjs';
import { validatePlanningContext } from '../src/planning-context.mjs';
import { evaluationProtocolFingerprint } from '../src/evaluation-protocol.mjs';
import { withCodexLoginPreflight, CODEX_RUNTIME_PREFLIGHT_CODES } from '../src/codex-runtime-preflight.mjs';
import { readPanelEvaluationRun } from '../src/panel-evaluation-io.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';

const child = args => new Promise(resolveExit => { const processChild = spawn(process.execPath, args, { cwd: harnessRoot, stdio: 'inherit' });
  processChild.once('error', () => resolveExit(1)); processChild.once('close', code => resolveExit(code ?? 1)); });
const absent = async path => { try { await lstat(path); throw new Error('QUOTE_RECHECK_ALREADY_CONSUMED'); } catch (error) { if (error.code !== 'ENOENT') throw error; } };
const portable = input => { assert(typeof input === 'string' && /^[A-Za-z0-9._/-]+$/.test(input) && !input.split('/').some(part => ['', '.', '..', '.git', '.codex', '.agents'].includes(part))); return input; };
let receipt, output;
try {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--preflight') { assert(!options['--preflight']); options['--preflight'] = true; continue; }
    assert(['--prepared', '--output', '--approve-plan', '--sharp-module'].includes(args[i]) && args[i + 1] && !options[args[i]]); options[args[i]] = args[++i];
  }
  const preparedPath = portable(options['--prepared']), prepared = resolve(harnessRoot, preparedPath);
  const plan = await readJson(resolve(prepared, 'quote-recheck-plan.json')), { sha256, ...payload } = plan;
  assert.equal(await digestJson(payload), sha256); assert.equal(plan.quoteRecheckPlanVersion, '0.1'); assert.equal(plan.status, 'PREPARED');
  assert.equal(plan.model, 'gpt-6-luna'); assert.equal(plan.effort, 'xhigh'); const caseCount = plan.maxInvocations; assert([1, 2, 3].includes(caseCount)); assert.equal(plan.attemptsPerCase, 1); assert.equal(plan.automaticRetries, 0);
  assert.deepEqual(plan.runtimePreflight, { check: 'codex-login-status', before: 'dispatch-claim', modelCalls: 0, networkRoute: 'explicit-process-proxy', settingsChanged: false, network: 'NOT_CHECKED', modelAvailability: 'NOT_CHECKED' });
  assert.deepEqual(plan.requiredGates, ['all-planned-real-ready', 'explicit-business-semantics', 'compile', 'native-0.8-bound-request-references', 'pixi-interaction', 'actual-delivery-offline-reimport']);
  assert(plan.sourceFiles.length && new Set(plan.sourceFiles.map(file => file.path)).size === plan.sourceFiles.length);
  const sources = async () => { for (const file of plan.sourceFiles) {
    assert(/^(?:src\/|prompts\/|schemas\/|adapters\/|scripts\/|examples\/|tests\/|\.\.\/ui-component-harness\/src\/)/.test(file.path));
    portable(file.path.replace(/^\.\.\/ui-component-harness\//, 'component/'));
    assert.equal(await digestBytes(await readFile(resolve(harnessRoot, file.path))), file.sha256, 'Source changed after freeze');
  } }; await sources();
  await absent(resolve(prepared, 'dispatch-claim.json')); await absent(resolve(prepared, 'generation/dispatch-claim.json'));
  const generation = await readJson(resolve(prepared, portable(plan.generation.file))), { sha256: generationSha, ...generationPayload } = generation;
  assert.equal(generationSha, plan.generation.sha256); assert.equal(await digestJson(generationPayload), generationSha); assert.equal(generation.cases.length, caseCount);
  assert.deepEqual(generation.protocol, await evaluationProtocolFingerprint()); assert.deepEqual(generation.library, plan.library);
  assert.deepEqual(generation.policy, { model: plan.model, effort: plan.effort, maxInvocations: caseCount, attemptsPerCase: 1, automaticRetries: 0, concurrency: 4, timeoutMs: 900000, semanticChecks: 'explicit-expectations', browser: 'SEPARATE_OFFLINE_ACCEPTANCE', nativeEngines: 'NOT_RUN' });
  const suite = await readJson(resolve(prepared, 'suite.json')); assert.equal(suite.cases.length, caseCount); assert.equal(await digestJson(suite), plan.suiteSha256);
  assert.equal(generation.suiteSha256, plan.suiteSha256); assert.deepEqual(await readJson(resolve(prepared, 'generation/suite.json')), suite); assert.equal(plan.schemas.length, caseCount);
  const contexts = [];
  for (let i = 0; i < generation.cases.length; i++) {
    const item = generation.cases[i]; assert.equal(item.id, suite.cases[i].id); assert.equal(await digestJson(suite.cases[i].expected), item.expectedSha256);
    const context = await validatePlanningContext(await readJson(resolve(prepared, 'generation', portable(item.contextFile))));
    assert.equal(context.sha256, item.contextSha256); assert.deepEqual(context.request, suite.cases[i].request); contexts.push(context);
    const schema = await readJson(resolve(prepared, portable(plan.schemas[i].path)));
    assert.equal(await digestJson(schema), plan.schemas[i].sha256); assert.deepEqual(schema, buildNativePanelIntentResponseSchema(context));
    assert.deepEqual(schema.properties.panelIntentVersion.enum, ['0.8']); assert.deepEqual(schema.$defs.requestSourceRef.enum, ['request']);
  }
  const fixtureProof = await readJson(resolve(prepared, portable(plan.fixtures.file))); assert.equal(await digestJson(fixtureProof), plan.fixtures.sha256);
  assert.equal(fixtureProof.status, 'FIXTURE_PASS'); assert.equal(fixtureProof.modelCalls, 0); assert.equal(fixtureProof.cases.length, caseCount);
  for (let i = 0; i < fixtureProof.cases.length; i++) { const file = fixtureProof.cases[i]; assert.equal(file.id, generation.cases[i].id); assert.equal(await digestJson(await readJson(resolve(prepared, portable(file.file)))), file.sha256); }
  const build = await readJson(resolve(harnessRoot, portable(plan.build.file))); assert.equal(await digestJson(build), plan.build.sha256);
  for (const file of build.files) { const bytes = await readFile(resolve(harnessRoot, plan.build.file, '..', portable(file.path))); assert.equal(bytes.length, file.bytes); assert.equal(await digestBytes(bytes), file.sha256); }
  const browser = await readJson(resolve(prepared, portable(plan.browser.file))); assert.equal(await digestJson(browser), plan.browser.sha256);
  assert.equal(browser.status, 'PASS'); assert.equal(browser.mode, 'fixture'); assert.equal(browser.modelCalls, 0); assert.equal(browser.imports, caseCount); assert.equal(browser.deliveries.length, caseCount); assert.equal(browser.blockedComputeRequests, 0);
  if (options['--preflight']) assert(!options['--approve-plan'] && !options['--output']);
  else { assert.equal(options['--approve-plan'], sha256); portable(options['--output']); await absent(resolve(harnessRoot, options['--output'])); }
  await withCodexLoginPreflight(async runtime => {
    if (options['--preflight']) { console.log(JSON.stringify({ status: 'PREFLIGHT_PASS', planSha256: sha256, modelCalls: 0, runtime })); return; }
    await sources();
    await writeFile(resolve(prepared, 'dispatch-claim.json'), `${canonicalJson({ quoteRecheckDispatchVersion: '0.1', planSha256: sha256, output: options['--output'], maxInvocations: caseCount, automaticRetries: 0 })}\n`, { flag: 'wx' });
    output = await createOutputDirectory(options['--output']);
    receipt = { quoteRecheckReportVersion: '0.1', planSha256: sha256, status: 'RUNNING', maxInvocations: caseCount, invocationCount: 0, automaticRetries: 0,
      generation: 'NOT_RUN', nativeSourceGuard: 'NOT_RUN', browser: 'NOT_RUN', deliveries: 'NOT_RUN', nativeEngines: 'NOT_RUN', humanVisualReview: 'NOT_RUN', scope: plan.scope };
    await writeNewJson(output, 'quote-recheck-plan.json', plan);
    const childArgs = ['scripts/run-panel-evaluation.mjs', '--prepared', `${preparedPath}/generation`, '--output', `${options['--output']}/generation`, '--assets', plan.assetRoot, '--plan-sha256', generationSha];
    if (options['--sharp-module']) childArgs.push('--sharp-module', options['--sharp-module']);
    receipt.invocationCount = null; // Until authoritative child receipts exist, a terminated child is indeterminate.
    assert.equal(await child(childArgs), 0, 'Generation child did not complete');
    const real = await readPanelEvaluationRun(resolve(output, 'generation'), await loadWorkspaceCore()); receipt.invocationCount = real.report.totals.invocationCount; receipt.generation = real.report.status;
    assert.equal(real.plan.sha256, generationSha); assert.deepEqual(real.suite, suite); assert.equal(receipt.invocationCount, caseCount); assert.equal(real.report.status, 'PASS_BEFORE_BROWSER');
    for (let i = 0; i < generation.cases.length; i++) {
      const directory = resolve(output, 'generation', generation.cases[i].id), attempts = (await readdir(directory)).filter(name => /^codex-[a-f0-9-]{36}$/.test(name)); assert.equal(attempts.length, 1);
      const intent = await readJson(resolve(directory, attempts[0], 'panel-intent.json'));
      assert.equal(intent.panelIntentVersion, '0.8'); validateNativePanelIntentEvidence(contexts[i], intent);
    }
    receipt.nativeSourceGuard = 'PASS'; await sources();
    const qaArgs = ['scripts/check-quote-recheck-browser.mjs', '--prepared', preparedPath, '--workbench', relative(harnessRoot, resolve(harnessRoot, plan.build.file, '..')).replaceAll('\\', '/'),
      '--mode', 'real', '--run', `${options['--output']}/generation`, '--output', `${options['--output']}/browser`];
    assert.equal(await child(qaArgs), 0, 'Real bundle browser child failed');
    const qa = await readJson(resolve(output, 'browser/browser-report.json')); assert.equal(qa.status, 'PASS'); assert.equal(qa.mode, 'real'); assert.equal(qa.planSha256, generationSha);
    assert.equal(qa.modelCalls, 0); assert.equal(qa.blockedComputeRequests, 0); assert.equal(qa.imports, caseCount); assert.equal(qa.deliveries.length, caseCount);
    receipt.browser = 'PASS'; receipt.deliveries = 'PASS'; receipt.browserChecks = qa.checks.length; receipt.browserReportSha256 = await digestJson(qa); receipt.status = 'PASS';
  }, { cwd: harnessRoot, requireProxyEnvironment: true });
  if (receipt) { await writeNewJson(output, 'quote-recheck-report.json', receipt); console.log(JSON.stringify(receipt)); }
} catch (error) {
  const code = CODEX_RUNTIME_PREFLIGHT_CODES.includes(error?.code) ? error.code : error?.code === 'EEXIST' || error.message === 'QUOTE_RECHECK_ALREADY_CONSUMED' ? 'QUOTE_RECHECK_ALREADY_CONSUMED' : 'QUOTE_RECHECK_GATE_FAILED';
  if (receipt) { receipt.status = 'FAIL'; receipt.failureCode = code; await writeNewJson(output, 'quote-recheck-report.json', receipt); }
  console.error(JSON.stringify({ status: 'FAILED', code, ...(receipt ? { invocationCount: receipt.invocationCount } : { modelCalls: 0 }) })); process.exitCode = 1;
}
