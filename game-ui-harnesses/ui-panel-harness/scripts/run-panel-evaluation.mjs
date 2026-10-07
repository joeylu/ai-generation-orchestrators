#!/usr/bin/env node
/** Optional finite real-Codex evaluation, separate from fixture tests. No repair or retry. */
import { resolve, relative, dirname } from 'node:path';
import { writeFile, lstat } from 'node:fs/promises';
import { planWithCodex, findCodexExecutable } from '../src/codex-planner.mjs';
import { validatePlanningContext } from '../src/planning-context.mjs';
import { loadPanelPlanAssets } from '../src/panel-assets-io.mjs';
import { loadTextureImageAdapter } from '../src/texture-image-adapter.mjs';
import { verifyAssetLibrary } from '../src/asset-library.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { createPanelBundle, validatePanelBundle } from '../src/panel-bundle.mjs';
import { evaluatePanelSemantics } from '../src/panel-evaluation.mjs';
import { digestJson, canonicalJson } from '../src/canonical.mjs';
import { evaluationProtocolFingerprint } from '../src/evaluation-protocol.mjs';
import { createOutputDirectory, writeNewJson, readJson, harnessRoot } from '../src/io.mjs';

try {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--prepared', '--plan-sha256', '--assets', '--sharp-module', '--output'].includes(args[i]) || !args[i + 1] || options[args[i]]) throw new Error('EVALUATION_ARGUMENTS');
    options[args[i]] = args[i + 1];
  }
  if (!options['--prepared'] || !options['--plan-sha256'] || !options['--assets'] || !options['--output']) throw new Error('EVALUATION_ARGUMENTS');
  const prepared = resolve(options['--prepared']), plan = await readJson(resolve(prepared, 'evaluation-plan.json'));
  const { sha256, ...payload } = plan, suite = await readJson(resolve(prepared, 'suite.json'));
  if (!['0.1', '0.2'].includes(plan.panelEvaluationPlanVersion)
    || (plan.panelEvaluationPlanVersion === '0.2' && canonicalJson(plan.protocol) !== canonicalJson(await evaluationProtocolFingerprint()))) throw new Error('EVALUATION_PROTOCOL_MISMATCH');
  if (sha256 !== options['--plan-sha256'] || sha256 !== await digestJson(payload) || plan.suiteSha256 !== await digestJson(suite)
    || plan.cases.length < 1 || plan.cases.length > 64 || suite.cases.length !== plan.cases.length || new Set(plan.cases.map(item => item.id)).size !== plan.cases.length
    || ![2, 4].includes(plan.policy.concurrency)
    || canonicalJson(plan.policy) !== canonicalJson({ model: 'gpt-6-luna', effort: 'xhigh', maxInvocations: plan.cases.length,
      attemptsPerCase: 1, automaticRetries: 0, concurrency: plan.policy.concurrency, timeoutMs: 900000, semanticChecks: 'explicit-expectations',
      browser: 'SEPARATE_OFFLINE_ACCEPTANCE', nativeEngines: 'NOT_RUN' })) throw new Error('EVALUATION_PLAN_MISMATCH');
  const rel = relative(resolve(harnessRoot), prepared);
  if (!rel || rel.startsWith('..') || resolve(harnessRoot, rel) !== prepared) throw new Error('EVALUATION_PREPARED_PATH');
  if (rel.split(/[\\/]/).some(part => /^(?:\.git|\.codex|\.agents)$/i.test(part))) throw new Error('EVALUATION_PREPARED_PATH');
  for (let path = prepared; ; path = dirname(path)) {
    if ((await lstat(path)).isSymbolicLink()) throw new Error('EVALUATION_PREPARED_PATH');
    if (dirname(path) === path) break;
  }
  const contexts = [];
  for (let i = 0; i < plan.cases.length; i++) {
    const item = plan.cases[i], input = suite.cases[i];
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(item.id) || item.id !== input.id || item.contextFile !== `${item.id}.context.json`
      || item.expectedSha256 !== await digestJson(input.expected)) throw new Error('EVALUATION_CASE_MISMATCH');
    const context = await validatePlanningContext(await readJson(resolve(prepared, item.contextFile)));
    if (context.sha256 !== item.contextSha256 || context.catalogSha256 !== plan.catalogSha256
      || canonicalJson(context.request) !== canonicalJson(input.request) || canonicalJson(context.assetRetrieval.library) !== canonicalJson(plan.library)) throw new Error('EVALUATION_CONTEXT_MISMATCH');
    contexts.push(context);
  }
  const executable = findCodexExecutable(); if (!executable) throw new Error('CODEX_NOT_CONFIGURED');
  const adapter = await loadTextureImageAdapter(options['--sharp-module']), core = await loadWorkspaceCore();
  const verified = await verifyAssetLibrary(options['--assets'], adapter);
  if (verified.index.id !== plan.library.id || verified.index.sha256 !== plan.library.sha256) throw new Error('EVALUATION_LIBRARY_MISMATCH');
  const directory = await createOutputDirectory(options['--output']);
  // Single-use dispatch claim; a crashed/indeterminate batch must never resubmit the same prepared plan.
  await writeFile(resolve(prepared, 'dispatch-claim.json'), `${canonicalJson({ panelEvaluationDispatchVersion: '0.1', planSha256: sha256,
    output: relative(resolve(harnessRoot), directory).replaceAll('\\', '/'), maxInvocations: plan.cases.length, automaticRetries: 0 })}\n`, { flag: 'wx' });
  await writeNewJson(directory, 'evaluation-plan.json', plan);
  await writeNewJson(directory, 'suite.json', suite);
  const results = [], started = performance.now();
  const run = async i => {
    const item = plan.cases[i], output = await createOutputDirectory(resolve(directory, item.id));
    const result = { panelEvaluationCaseVersion: '0.1', id: item.id, title: item.title, contextSha256: item.contextSha256,
      expectedSha256: item.expectedSha256, retrieval: item.retrieval, model: 'NOT_RUN', semantic: 'NOT_RUN', compile: 'NOT_RUN',
      browser: 'NOT_RUN', nativeEngines: 'NOT_RUN', receipt: null, diagnostic: null, failureCode: null, unresolved: [], bundleSha256: null };
    let stage = 'model';
    process.stdout.write(`${JSON.stringify({ event: 'START', id: item.id })}\n`);
    try {
      if (plan.panelEvaluationPlanVersion === '0.2' && canonicalJson(plan.protocol) !== canonicalJson(await evaluationProtocolFingerprint())) throw new Error('EVALUATION_PROTOCOL_MISMATCH');
      const generated = await planWithCodex(contexts[i], { outputRoot: output, executable, timeoutMs: plan.policy.timeoutMs });
      result.receipt = generated.receipt; result.model = generated.report.status; result.unresolved = generated.report.unresolved;
      if (generated.report.status === 'READY_TO_COMPILE') {
        stage = 'semantic'; const semantic = evaluatePanelSemantics(generated.proposal.spec, suite.cases[i].expected);
        await writeNewJson(output, 'semantic-report.json', semantic); result.semantic = semantic.status;
        stage = 'compile';
        const assets = await loadPanelPlanAssets(contexts[i], generated.proposal.spec, options['--assets'], adapter);
        const bundle = await validatePanelBundle(await createPanelBundle(generated.proposal.spec, contexts[i].catalog, core, undefined, assets.assets), core);
        await writeNewJson(output, 'asset-verification.json', assets.receipt);
        await writeNewJson(output, 'panel.bundle.json', bundle); result.compile = 'PASS'; result.bundleSha256 = bundle.sha256;
      }
    } catch (error) {
      result[stage] = 'FAIL'; result.failureCode = error.code ?? 'EVALUATION_STAGE_FAILED';
      if (error.receipt) result.receipt = error.receipt;
      if (error.diagnostic) result.diagnostic = error.diagnostic;
    }
    result.status = result.model === 'READY_TO_COMPILE' && result.semantic === 'PASS' && result.compile === 'PASS' ? 'PASS_BEFORE_BROWSER' : 'FAIL';
    await writeNewJson(output, 'case-result.json', result);
    process.stdout.write(`${JSON.stringify({ event: 'COMPLETE', id: item.id, status: result.status, model: result.model,
      semantic: result.semantic, compile: result.compile, failureCode: result.failureCode, elapsedMs: result.receipt?.elapsedMs ?? null })}\n`);
    results[i] = result;
  };
  // Finite distinct requests per iteration, never resubmitting a case or starting a persistent queue.
  for (let i = 0; i < plan.cases.length; i += plan.policy.concurrency) {
    const settled = await Promise.allSettled(Array.from({ length: Math.min(plan.policy.concurrency, plan.cases.length - i) }, (_, offset) => run(i + offset)));
    if (settled.some(item => item.status === 'rejected')) throw new Error('EVALUATION_SAVE_FAILED_NO_RETRY');
  }
  const report = { panelEvaluationReportVersion: '0.1', planSha256: sha256, status: results.every(item => item.status === 'PASS_BEFORE_BROWSER') ? 'PASS_BEFORE_BROWSER' : 'FAIL',
    sample: { tag: plan.sampleTag ?? null, distinctRequests: plan.cases.length, attemptsPerRequest: 1, repeatedRunStability: 'SEPARATE_AGGREGATE_REQUIRED' },
    totals: { cases: results.length, recipeHits: results.filter(item => item.retrieval.status === 'PASS').length,
      modelReady: results.filter(item => item.model === 'READY_TO_COMPILE').length, semanticPass: results.filter(item => item.semantic === 'PASS').length,
      compilePass: results.filter(item => item.compile === 'PASS').length, invocationCount: results.reduce((n, item) => n + (item.receipt?.invocationCount ?? 0), 0),
      automaticRetries: 0, elapsedMs: Math.round(performance.now() - started) }, browser: 'NOT_RUN', nativeEngines: 'NOT_RUN', humanVisualReview: 'NOT_RUN', cases: results };
  await writeNewJson(directory, 'evaluation-report.json', report);
  process.stdout.write(`${JSON.stringify({ event: 'FINISHED', status: report.status, totals: report.totals })}\n`);
} catch (error) { process.stderr.write(`${JSON.stringify({ status: 'FAILED', code: error.code ?? (error.message === 'EVALUATION_SAVE_FAILED_NO_RETRY' ? error.message : 'EVALUATION_SETUP_FAILED') })}\n`); process.exitCode = 1; }
