#!/usr/bin/env node
/** One authorized two-round batch. No repair/retry; round2 requires all round1 gates. */
import assert from 'node:assert/strict';
import { readFile, access, writeFile, readdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { spawn } from 'node:child_process';
import { canonicalJson, digestBytes, digestJson } from '../src/canonical.mjs';
import { createOutputDirectory, harnessRoot, readJson, writeNewJson } from '../src/io.mjs';
import { validatePlanningContext } from '../src/planning-context.mjs';
import { buildNativePanelIntentResponseSchema, validateNativePanelIntentEvidence } from '../src/panel-intent.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { readPanelEvaluationRun } from '../src/panel-evaluation-io.mjs';
import { withCodexLoginPreflight, CODEX_RUNTIME_PREFLIGHT_CODES } from '../src/codex-runtime-preflight.mjs';
import { readStoredZip } from '../tests/unity-kit-helpers.mjs';
const portable = path => { assert(typeof path === 'string' && path && /^[A-Za-z0-9._/-]+$/.test(path) && !path.split('/').includes('..')); return path; };
try {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--preflight') { assert(!options.preflight); options.preflight = true; }
    else { assert(['--prepared', '--output', '--approve-plan', '--sharp-module'].includes(args[i]) && args[i + 1] && !options[args[i]]); options[args[i]] = args[++i]; }
  }
  const preparedPath = portable(options['--prepared']), prepared = resolve(harnessRoot, preparedPath);
  const plan = await readJson(resolve(prepared, 'ordinal-stability-plan.json')), { sha256, ...payload } = plan;
  assert.equal(await digestJson(payload), sha256); assert.equal(plan.ordinalStabilityPlanVersion, '0.1');
  assert.equal(plan.policy.rounds, 2); assert.equal(plan.policy.casesPerRound, 16); assert.equal(plan.policy.maxInvocations, 32);
  assert.equal(plan.policy.model, 'gpt-6-luna'); assert.equal(plan.policy.effort, 'xhigh'); assert.equal(plan.policy.attemptsPerCasePerRound, 1); assert.equal(plan.policy.automaticRetries, 0);
  assert.deepEqual(plan.runtimePreflight, { loginVisibility: 'REQUIRED', networkRoute: 'explicit-process-proxy', before: 'dispatch-claim', networkHealth: 'NOT_VERIFIED' });
  const verifySources = async () => { for (const file of plan.sourceFiles) {
    assert(/^(?:src\/|prompts\/|schemas\/|scripts\/|examples\/|tests\/|adapters\/|\.\.\/ui-component-harness\/src\/)/.test(file.path));
    assert(!file.path.replace(/^\.\.\/ui-component-harness\//, '').split('/').includes('..'));
    assert.equal(await digestBytes(await readFile(resolve(harnessRoot, file.path))), file.sha256);
  } };
  await verifySources();
  const suite = await readJson(resolve(prepared, 'suite.json')); assert.equal(await digestJson(suite), plan.suiteSha256); assert.equal(suite.cases.length, 16);
  const fixture = await readJson(resolve(prepared, plan.fixture.file)); assert.equal(await digestJson(fixture), plan.fixture.sha256);
  assert.equal(fixture.status, 'FIXTURE_PASS'); assert.equal(fixture.modelCalls, 0); assert.equal(fixture.cases.length, 16); assert.equal(fixture.compositions.length, 5);
  assert(fixture.cases.every(item => item.status === 'PASS')); assert(fixture.compositions.every(item => item.status === 'PASS'));
  const fixtureBrowser = await readJson(resolve(prepared, portable(plan.browser.file))); assert.equal(await digestJson(fixtureBrowser), plan.browser.sha256);
  assert.equal(fixtureBrowser.status, 'PASS'); assert.equal(fixtureBrowser.mode, 'fixture'); assert.equal(fixtureBrowser.modelCalls, 0); assert.equal(fixtureBrowser.blockedComputeRequests, 0);
  assert.equal(fixtureBrowser.individuals, 16); assert.equal(fixtureBrowser.fixtureCompositions, 5); assert.equal(fixtureBrowser.imports, 21); assert.equal(fixtureBrowser.deliveries.length, 21);
  assert.equal(plan.rounds.length, 2); assert.equal(plan.schemas.length, 32); assert.notEqual(plan.rounds[0].sha256, plan.rounds[1].sha256);
  for (let n = 0; n < 2; n++) {
    const round = plan.rounds[n]; assert.equal(round.id, `round0${n + 1}`); assert.equal(round.file, `${round.id}/evaluation-plan.json`);
    const child = await readJson(resolve(prepared, round.file)), { sha256: childSha, ...childPayload } = child;
    assert.equal(await digestJson(childPayload), round.sha256); assert.equal(childSha, round.sha256); assert.equal(child.cases.length, 16);
    assert.equal(child.policy.maxInvocations, 16); assert.equal(child.policy.attemptsPerCase, 1); assert.equal(child.policy.automaticRetries, 0);
    assert.equal(child.sampleTag, `ordinal-stability-round-${n + 1}`); assert.equal(child.suiteSha256, plan.suiteSha256);
    for (let i = 0; i < 16; i++) {
      const item = child.cases[i]; assert.equal(item.id, suite.cases[i].id); assert.equal(item.contextFile, `${item.id}.context.json`);
      const context = await validatePlanningContext(await readJson(resolve(prepared, round.id, item.contextFile)));
      assert.equal(context.sha256, item.contextSha256); assert.deepEqual(context.request, suite.cases[i].request);
      assert.equal(item.expectedSha256, await digestJson(suite.cases[i].expected));
      const schemaRef = plan.schemas[n * 16 + i]; assert.equal(schemaRef.path, `${round.id}/${item.id}.response-schema.json`);
      assert.equal(schemaRef.contextSha256, context.sha256); const schema = await readJson(resolve(prepared, schemaRef.path));
      assert.equal(await digestJson(schema), schemaRef.sha256); assert.deepEqual(schema, buildNativePanelIntentResponseSchema(context));
      assert.deepEqual(schema.properties.panelIntentVersion.enum, ['0.8']); assert.deepEqual(schema.$defs.requestSourceRef.enum, ['request']);
    }
    await assert.rejects(access(resolve(prepared, round.id, 'dispatch-claim.json')), { code: 'ENOENT' });
  }
  const build = await readJson(resolve(harnessRoot, plan.build.file)); assert.equal(await digestJson(build), plan.build.sha256);
  for (const file of build.files) { const bytes = await readFile(resolve(harnessRoot, plan.build.file, '..', file.path)); assert.equal(await digestBytes(bytes), file.sha256); assert.equal(bytes.length, file.bytes); }
  await assert.rejects(access(resolve(prepared, 'dispatch-claim.json')), { code: 'ENOENT' });
  if (options.preflight) assert(!options['--approve-plan'] && !options['--output']);
  else { assert.equal(options['--approve-plan'], sha256); portable(options['--output']); }
  await withCodexLoginPreflight(async runtime => {
    if (options.preflight) { console.log(JSON.stringify({ status: 'PREFLIGHT_PASS', planSha256: sha256, maxInvocations: 32, nativeSchemas: 32, sourceFilesVerified: plan.sourceFiles.length, modelCalls: 0, runtime })); return; }
    await verifySources(); await assert.rejects(access(resolve(harnessRoot, options['--output'])), { code: 'ENOENT' });
    await writeFile(resolve(prepared, 'dispatch-claim.json'), `${canonicalJson({ ordinalStabilityDispatchVersion: '0.1', planSha256: sha256, output: options['--output'], maxInvocations: 32, automaticRetries: 0 })}\n`, { flag: 'wx' });
    const output = await createOutputDirectory(resolve(harnessRoot, options['--output'])), core = await loadWorkspaceCore();
    const report = { ordinalStabilityReportVersion: '0.1', status: 'RUNNING', planSha256: sha256, rounds: [], actualInvocations: 0, automaticRetries: 0,
      unusedBudgetReassigned: false, nativeEngines: 'NOT_RUN', humanVisualReview: 'NOT_RUN', runtimePreflight: runtime };
    const execute = async (script, args) => {
      const child = spawn(process.execPath, [script, ...args], { cwd: harnessRoot, stdio: 'inherit', shell: false });
      const code = await new Promise(resolveExit => { child.once('error', () => resolveExit(1)); child.once('close', code => resolveExit(code ?? 1)); });
      assert.equal(code, 0);
    };
    for (const round of plan.rounds) {
      const result = { id: round.id, status: 'RUNNING', phase: 'source-check', actualInvocations: 0, failureCode: null }, roundOutput = resolve(output, round.id);
      report.rounds.push(result); let dispatched = false, source;
      try {
        await verifySources(); await createOutputDirectory(roundOutput);
        result.phase = 'model'; dispatched = true;
        console.log(JSON.stringify({ event: 'ROUND_START', round: round.id }));
        const modelArgs = ['--prepared', `${preparedPath}/${round.id}`, '--plan-sha256', round.sha256, '--assets', plan.assetRoot, '--output', `${options['--output']}/${round.id}/generation`];
        if (options['--sharp-module']) modelArgs.push('--sharp-module', options['--sharp-module']);
        await execute('scripts/run-panel-evaluation.mjs', modelArgs);
        source = await readPanelEvaluationRun(resolve(roundOutput, 'generation'), core); result.actualInvocations = source.report.totals.invocationCount;
        assert.equal(source.plan.sha256, round.sha256); assert.deepEqual(source.suite, suite); assert.equal(result.actualInvocations, 16);
        assert.equal(source.report.status, 'PASS_BEFORE_BROWSER'); assert.equal(source.bundles.size, 16);
        result.phase = 'native-request-binding'; const nativeChecks = [];
        for (const item of source.cases) {
          const context = await validatePlanningContext(await readJson(resolve(prepared, round.id, `${item.id}.context.json`)));
          const directory = resolve(roundOutput, 'generation', item.id), attempts = (await readdir(directory)).filter(name => /^codex-[a-f0-9-]{36}$/.test(name)); assert.equal(attempts.length, 1);
          const intent = await readJson(resolve(directory, attempts[0], 'panel-intent.json'));
          assert.equal(intent.panelIntentVersion, '0.8'); validateNativePanelIntentEvidence(context, intent);
          nativeChecks.push({ id: item.id, status: 'PASS', contextSha256: context.sha256, intentSha256: await digestJson(intent), panelIntentVersion: '0.8' });
        }
        assert.equal(nativeChecks.length, 16); await writeNewJson(roundOutput, 'native-source-report.json', { status: 'PASS', modelCalls: 0, checks: nativeChecks });
        result.nativeSourceGuard = 'PASS'; await verifySources();
        result.phase = 'individual-browser';
        await execute('scripts/build-panel-evaluation-preview.mjs', ['--run', `${options['--output']}/${round.id}/generation`, '--output', `${options['--output']}/${round.id}/preview`]);
        await execute('scripts/check-panel-evaluation-browser.mjs', ['--run', `${options['--output']}/${round.id}/generation`, '--preview', `${options['--output']}/${round.id}/preview`, '--output', `${options['--output']}/${round.id}/browser`]);
        result.phase = 'same-cohort-composition';
        await execute('scripts/build-panel-composition-evaluation.mjs', ['--run', `${options['--output']}/${round.id}/generation`, '--preview', `${options['--output']}/${round.id}/preview`, '--output', `${options['--output']}/${round.id}/composition`]);
        await execute('scripts/check-panel-evaluation-browser.mjs', ['--run', `${options['--output']}/${round.id}/generation`, '--preview', `${options['--output']}/${round.id}/composition`, '--output', `${options['--output']}/${round.id}/composition-browser`, '--mode', 'composition']);
        result.phase = 'delivery-integrity'; await createOutputDirectory(resolve(roundOutput, 'delivery'));
        const deliveries = [];
        for (const item of source.cases) {
          await execute('scripts/export-panel-delivery.mjs', ['--bundle', `${options['--output']}/${round.id}/generation/${item.id}/panel.bundle.json`, '--output', `${options['--output']}/${round.id}/delivery/${item.id}`]);
          const dir = resolve(roundOutput, 'delivery', item.id), manifest = await readJson(resolve(dir, 'delivery-manifest.json'));
          assert.equal(manifest.status, 'COMPLETE'); assert.equal(manifest.panelSha256, source.bundles.get(item.id).sha256);
          const zip = await readFile(resolve(dir, `${manifest.panelId}.panel-delivery.zip`)), entries = readStoredZip(zip);
          assert.equal(entries.size, manifest.files.length + 1);
          assert.deepEqual(JSON.parse(entries.get('delivery-manifest.json')), manifest);
          for (const file of manifest.files) { portable(file.path); const bytes = await readFile(resolve(dir, file.path)); assert.equal(await digestBytes(bytes), file.sha256); assert.equal(bytes.length, file.bytes); assert.deepEqual(entries.get(file.path), bytes); }
          assert.deepEqual(JSON.parse(entries.get('pixi/panel.bundle.json')), source.bundles.get(item.id));
          assert.deepEqual(JSON.parse(entries.get('unity/panel.bundle.json')), source.bundles.get(item.id));
          deliveries.push({ id: item.id, panelSha256: manifest.panelSha256, zipSha256: await digestBytes(zip), unityImport: 'NOT_RUN' });
        }
        await writeNewJson(roundOutput, 'delivery-report.json', { status: 'PASS', modelCalls: 0, deliveries, nativeEngines: 'NOT_RUN' });
        result.phase = 'actual-delivery-offline-reimport';
        await execute('scripts/check-stability-delivery-browser.mjs', ['--prepared', preparedPath, '--workbench', relative(harnessRoot, resolve(harnessRoot, plan.build.file, '..')).replaceAll('\\', '/'),
          '--mode', 'real', '--run', `${options['--output']}/${round.id}/generation`, '--output', `${options['--output']}/${round.id}/delivery-browser`]);
        const deliveryBrowser = await readJson(resolve(roundOutput, 'delivery-browser/browser-report.json'));
        assert.equal(deliveryBrowser.status, 'PASS'); assert.equal(deliveryBrowser.mode, 'real'); assert.equal(deliveryBrowser.planSha256, round.sha256);
        assert.equal(deliveryBrowser.modelCalls, 0); assert.equal(deliveryBrowser.blockedComputeRequests, 0); assert.equal(deliveryBrowser.imports, 16); assert.equal(deliveryBrowser.deliveries.length, 16);
        result.deliveryBrowser = 'PASS'; result.deliveryBrowserChecks = deliveryBrowser.checks.length; await verifySources();
        result.status = 'PASS'; result.phase = 'complete';
      } catch {
        if (dispatched && !source) {
          try { result.actualInvocations = (await readJson(resolve(roundOutput, 'generation/evaluation-report.json'))).totals.invocationCount; }
          catch { result.actualInvocations = null; }
        }
        result.status = 'FAIL'; result.failureCode = 'ORDINAL_STABILITY_GATE_FAILED_NO_RETRY';
      }
      await writeNewJson(roundOutput, 'round-result.json', result);
      console.log(JSON.stringify({ event: 'ROUND_COMPLETE', ...result }));
      if (result.status !== 'PASS') break;
    }
    report.actualInvocations = report.rounds.some(item => item.actualInvocations === null) ? null : report.rounds.reduce((n, item) => n + item.actualInvocations, 0);
    assert(report.actualInvocations === null || report.actualInvocations <= 32);
    report.status = report.rounds.length === 2 && report.rounds.every(item => item.status === 'PASS') ? 'OBSERVED_TWO_ROUND_PASS' : 'FAIL';
    report.roundsNotRun = 2 - report.rounds.length;
    await writeNewJson(output, 'ordinal-stability-report.json', report);
    console.log(JSON.stringify({ event: 'FINISHED', status: report.status, actualInvocations: report.actualInvocations, roundsNotRun: report.roundsNotRun, automaticRetries: 0 }));
    if (report.status !== 'OBSERVED_TWO_ROUND_PASS') process.exitCode = 1;
  }, { cwd: harnessRoot, requireProxyEnvironment: true });
} catch (error) {
  const code = CODEX_RUNTIME_PREFLIGHT_CODES.includes(error?.code) ? error.code : 'ORDINAL_STABILITY_PREFLIGHT_FAILED';
  console.error(JSON.stringify({ status: 'FAIL', code })); process.exitCode = 1;
}
