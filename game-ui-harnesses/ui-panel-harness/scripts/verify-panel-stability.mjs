#!/usr/bin/env node
/** Final evidence gate: complete repeated suites and both meanings of composition. Never invokes models. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { createOutputDirectory, writeNewJson, readJson, harnessRoot } from '../src/io.mjs';
import { readPanelEvaluationRun } from '../src/panel-evaluation-io.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { canonicalJson, digestJson, digestBytes } from '../src/canonical.mjs';
import { validatePanelBundle } from '../src/panel-bundle.mjs';
import { validatePanelComposition } from '../src/panel-composition.mjs';
const allowed = ['--first-run', '--first-browser', '--second-run', '--second-browser', '--mixed-run', '--mixed-browser', '--compositions', '--composition-browser', '--output', '--history'];
const portable = path => {
  const rel = relative(harnessRoot, resolve(path)).replaceAll('\\', '/');
  assert(rel && !rel.startsWith('../') && !/^[A-Za-z]:/.test(rel)); return rel;
};
try {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i += 2) { assert(allowed.includes(args[i]) && args[i + 1] && !options[args[i]]); options[args[i]] = args[i + 1]; }
  for (const key of allowed.filter(key => key !== '--history')) assert(options[key]);
  const core = await loadWorkspaceCore(), evidence = [];
  const json = async path => { const value = await readJson(path); evidence.push({ path: portable(path), sha256: await digestBytes(await readFile(path)) }); return value; };
  const browserGate = async (run, directory) => {
    const report = await json(resolve(directory, 'panel-evaluation-browser-report.json'));
    assert.equal(report.status, 'PASS'); assert.equal(report.providerCalls, 0); assert.equal(report.automaticRetries, 0);
    assert.equal(report.planSha256, run.plan.sha256); assert.equal(report.cases.length, run.cases.length);
    for (const [i, item] of report.cases.entries()) {
      const source = run.cases[i]; assert.equal(item.id, source.id); assert.equal(item.status, 'PASS');
      assert.equal(item.generation, 'READY_TO_COMPILE'); assert.equal(item.semantic, 'PASS'); assert.equal(item.bundleSha256, source.bundleSha256);
      assert(item.checks.length >= 6 && item.checks.every(check => check.status === 'PASS'));
      assert.equal(item.screenshot, `${item.id}.png`); assert.equal(item.exportSha256.length, 64);
      const exported = await validatePanelBundle(await json(resolve(directory, `${item.id}.exported.panel.bundle.json`)), core);
      assert.equal(exported.sha256, item.exportSha256); assert.equal(canonicalJson(exported.spec), canonicalJson(run.bundles.get(item.id).spec));
      assert.deepEqual(await validatePanelBundle(await json(resolve(directory, `${item.id}.downloaded.panel.bundle.json`)), core), exported);
      const bytes = await readFile(resolve(directory, item.screenshot)); assert(bytes.length > 1000);
      evidence.push({ path: portable(resolve(directory, item.screenshot)), sha256: await digestBytes(bytes) });
    }
    assert.equal(report.totals.endToEndPass, run.cases.length); assert.equal(report.totals.browserFail, 0); return report;
  };
  const first = await readPanelEvaluationRun(options['--first-run'], core), second = await readPanelEvaluationRun(options['--second-run'], core), mixed = await readPanelEvaluationRun(options['--mixed-run'], core);
  for (const run of [first, second, mixed]) assert.equal(run.report.status, 'PASS_BEFORE_BROWSER');
  assert.equal(first.cases.length, 16); assert.equal(second.cases.length, 16); assert.equal(mixed.cases.length, 6);
  assert.equal(first.plan.suiteSha256, second.plan.suiteSha256); assert.notEqual(first.plan.sampleTag, second.plan.sampleTag);
  assert.equal(canonicalJson(first.plan.protocol), canonicalJson(second.plan.protocol)); assert.equal(canonicalJson(first.plan.protocol), canonicalJson(mixed.plan.protocol));
  assert.equal(first.plan.catalogSha256, second.plan.catalogSha256); assert.equal(first.plan.catalogSha256, mixed.plan.catalogSha256);
  const repeated = first.cases.map((item, i) => {
    const other = second.cases[i]; assert.equal(item.id, other.id); assert.equal(item.contextSha256, other.contextSha256); assert.equal(item.expectedSha256, other.expectedSha256);
    return { id: item.id, title: item.title, independentInvocations: 2, successes: 2, contextSha256: item.contextSha256,
      bundles: [item.bundleSha256, other.bundleSha256] };
  });
  for (const run of [first, second]) assert.equal(new Set([...run.bundles.values()].map(bundle => bundle.spec.id)).size, 16, 'Distinct requested panels have distinct generated panel names');
  const firstBrowser = await browserGate(first, options['--first-browser']), secondBrowser = await browserGate(second, options['--second-browser']), mixedBrowser = await browserGate(mixed, options['--mixed-browser']);
  const compositions = await json(resolve(options['--compositions'], 'composition-preview-build.json'));
  const compositionBrowser = await json(resolve(options['--composition-browser'], 'panel-evaluation-browser-report.json'));
  assert.equal(compositions.status, 'COMPLETE'); assert.equal(compositions.modelCalls, 0); assert.equal(compositions.sourceReportSha256, await digestJson(first.report));
  assert.equal(compositions.cases.length, 5); assert.equal(compositionBrowser.status, 'PASS'); assert.equal(compositionBrowser.mode, 'composition'); assert.equal(compositionBrowser.providerCalls, 0);
  assert.equal(compositionBrowser.totals.endToEndPass, 5); assert.equal(compositionBrowser.cases.length, 5);
  for (const [i, item] of compositions.cases.entries()) {
    assert(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(item.id));
    const result = await validatePanelComposition(await json(resolve(options['--compositions'], item.compositionFile)), item.sourceCaseIds.map(id => first.bundles.get(id)), core);
    assert.equal(result.bundle.sha256, item.bundleSha256); const browser = compositionBrowser.cases[i];
    assert.equal(browser.id, item.id); assert.equal(browser.status, 'PASS'); assert.equal(browser.bundleSha256, item.bundleSha256);
    assert(browser.checks.length >= 9 && browser.checks.every(check => check.status === 'PASS'));
    const exported = await validatePanelBundle(await json(resolve(options['--composition-browser'], `${item.id}.exported.panel.bundle.json`)), core);
    assert.equal(exported.sha256, browser.exportSha256); assert.deepEqual(exported.spec, result.bundle.spec);
    if (item.id.startsWith('compose-all-')) { assert.equal(item.sourceCaseIds.length, 16); assert.equal(new Set(item.sourceCaseIds).size, 16); }
  }
  const history = [];
  for (const directory of (options['--history'] ?? '').split(',').filter(Boolean)) {
    const run = await readPanelEvaluationRun(directory, core);
    history.push({ directory: portable(directory), planSha256: run.plan.sha256, status: run.report.status, totals: run.report.totals,
      failures: run.cases.filter(item => item.status === 'FAIL').map(item => ({ id: item.id, model: item.model, semantic: item.semantic,
        failureCode: item.failureCode, diagnostic: item.diagnostic, unresolved: item.unresolved, semanticFailures: item.semanticFailures })) });
  }
  const counts = [first, second, mixed].map(run => run.report.totals.invocationCount);
  const payload = { panelStabilityReportVersion: '0.1', status: 'PASS', protocol: first.plan.protocol,
    scope: 'Two complete independent same-protocol/same-request samples of 16 supported panel types; six mixed natural-language panels; five deterministic compositions. This does not prove arbitrary-language or infinite-run stability.',
    repeated, samples: [first, second].map(run => ({ tag: run.plan.sampleTag, planSha256: run.plan.sha256, reportSha256: null })),
    mixed: { planSha256: mixed.plan.sha256, cases: mixed.cases.length, successes: mixed.cases.length },
    compositions: { sources: 16, cases: 5, successes: 5, modelCalls: 0 }, history,
    totals: { distinctPanelTypes: 16, repeatRounds: 2, repeatedGenerationPass: 32, repeatedBrowserPass: 32, mixedPass: 6,
      compositionPass: 5, finalProtocolCliInvocations: counts.reduce((a, b) => a + b, 0),
      historicalCliInvocations: history.reduce((n, run) => n + run.totals.invocationCount, 0), automaticRetries: 0,
      browserChecks: [firstBrowser, secondBrowser, mixedBrowser, compositionBrowser].reduce((n, report) => n + report.totals.checks, 0) },
    evidence, nativeEngines: 'NOT_RUN', humanVisualReview: 'NOT_RUN' };
  for (const [i, run] of [first, second].entries()) payload.samples[i].reportSha256 = await digestJson(run.report);
  const output = await createOutputDirectory(options['--output']); await writeNewJson(output, 'panel-stability-report.json', { ...payload, sha256: await digestJson(payload) });
  process.stdout.write(`${JSON.stringify({ status: 'PASS', totals: payload.totals, modelCalls: 0 })}\n`);
} catch (error) { process.stderr.write(`${JSON.stringify({ status: 'FAIL', code: error.code ?? 'STABILITY_EVIDENCE_FAILED' })}\n`); process.exitCode = 1; }
