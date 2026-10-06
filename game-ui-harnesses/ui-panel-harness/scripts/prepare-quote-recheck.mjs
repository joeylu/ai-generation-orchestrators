#!/usr/bin/env node
/** One to three original regression cases. Owned fixtures only, zero model calls. */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { quoteRecheckFixture, nativeQuotes } from '../examples/quote-recheck-v1/suite.mjs';
import { selectQuoteRecheckSuite } from '../examples/quote-recheck-v1/selection.mjs';
import { harnessRoot, createOutputDirectory, readJson, writeNewJson } from '../src/io.mjs';
import { digestBytes, digestJson } from '../src/canonical.mjs';
import { buildNativePanelIntentResponseSchema, materializePanelIntent, validateNativePanelIntentEvidence } from '../src/panel-intent.mjs';
import { requestReferenceFixture } from '../examples/request-reference-v1/fixture.mjs';
import { checkPanelProposal } from '../src/proposal.mjs';
import { evaluatePanelSemantics } from '../src/panel-evaluation.mjs';
import { loadPanelPlanAssets } from '../src/panel-assets-io.mjs';
import { loadTextureImageAdapter } from '../src/texture-image-adapter.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { createPanelBundle, validatePanelBundle } from '../src/panel-bundle.mjs';

try {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i += 2) { assert(['--output', '--assets', '--build', '--sharp-module', '--case', '--cases'].includes(args[i]) && args[i + 1] && !options[args[i]]); options[args[i]] = args[i + 1]; }
  for (const key of ['--output', '--assets', '--build']) assert(options[key] && /^[A-Za-z0-9._/-]+$/.test(options[key]) && !options[key].split('/').includes('..'));
  const suite = selectQuoteRecheckSuite({ caseId: options['--case'], caseIds: options['--cases'] });
  const output = await createOutputDirectory(options['--output']);
  const caseCount = suite.cases.length;
  await writeNewJson(output, 'suite.json', suite);
  const childArgs = ['scripts/prepare-panel-evaluation.mjs', '--catalog', 'examples/modern-mint-forms.catalog.json', '--assets', options['--assets'],
    '--suite', `${options['--output']}/suite.json`, '--output', `${options['--output']}/generation`, '--sample', 'quote-guard-recheck'];
  if (options['--sharp-module']) childArgs.push('--sharp-module', options['--sharp-module']);
  const child = spawnSync(process.execPath, childArgs, { cwd: harnessRoot, encoding: 'utf8' });
  assert.equal(child.status, 0, 'Preparation child failed');
  const generation = await readJson(join(output, 'generation/evaluation-plan.json'));
  assert.equal(generation.cases.length, caseCount); assert(generation.cases.every(item => item.retrieval.status === 'PASS'));
  const schemas = [], fixtures = [], core = await loadWorkspaceCore(), adapter = await loadTextureImageAdapter(options['--sharp-module']);
  const fixtureDirectory = await createOutputDirectory(join(output, 'fixture-bundles'));
  for (let i = 0; i < generation.cases.length; i++) {
    const item = generation.cases[i], context = await readJson(join(output, 'generation', item.contextFile)), schema = buildNativePanelIntentResponseSchema(context);
    assert.deepEqual(schema.properties.panelIntentVersion.enum, ['0.8']); assert.deepEqual(schema.$defs.requestSourceRef.enum, ['request']);
    const path = `generation/${item.id}.schema.json`; await writeNewJson(join(output, 'generation'), `${item.id}.schema.json`, schema);
    schemas.push({ path, sha256: await digestJson(schema) });
    const legacyFixture = quoteRecheckFixture(context, suite.cases[i]);
    assert.equal(legacyFixture.panelIntentVersion, '0.7'); assert(nativeQuotes(legacyFixture).length && nativeQuotes(legacyFixture).every(quote => quote === context.request.text));
    const fixture = requestReferenceFixture(legacyFixture);
    const proposal = await materializePanelIntent(context, fixture), checked = await checkPanelProposal(context, proposal);
    validateNativePanelIntentEvidence(context, fixture);
    assert.equal(checked.status, 'READY_TO_COMPILE'); assert.equal(evaluatePanelSemantics(proposal.spec, suite.cases[i].expected).status, 'PASS');
    const assets = await loadPanelPlanAssets(context, proposal.spec, options['--assets'], adapter);
    const bundle = await validatePanelBundle(await createPanelBundle(proposal.spec, context.catalog, core, undefined, assets.assets), core);
    const file = `fixture-bundles/${item.id}.panel.bundle.json`; await writeNewJson(fixtureDirectory, `${item.id}.panel.bundle.json`, bundle);
    fixtures.push({ id: item.id, file, sha256: await digestJson(bundle), boundRequestReferences: nativeQuotes(legacyFixture).length, semantic: 'PASS', compile: 'PASS' });
  }
  const fixtureProof = { status: 'FIXTURE_PASS', modelCalls: 0, cases: fixtures }; await writeNewJson(output, 'fixture-validation.json', fixtureProof);
  const qa = spawnSync(process.execPath, ['scripts/check-quote-recheck-browser.mjs', '--prepared', options['--output'], '--workbench', options['--build'],
    '--mode', 'fixture', '--output', `${options['--output']}/fixture-browser`], { cwd: harnessRoot, encoding: 'utf8' });
  if (qa.status !== 0) { process.stdout.write(qa.stdout ?? ''); throw new Error('QUOTE_FIXTURE_BROWSER_FAILED'); }
  const browser = await readJson(join(output, 'fixture-browser/browser-report.json'));
  assert.equal(browser.status, 'PASS'); assert.equal(browser.mode, 'fixture'); assert.equal(browser.modelCalls, 0);
  assert.equal(browser.imports, caseCount); assert.equal(browser.deliveries.length, caseCount); assert.equal(browser.blockedComputeRequests, 0);
  const sourceFiles = [];
  async function scan(path) { for (const entry of await readdir(resolve(harnessRoot, path), { withFileTypes: true })) {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) await scan(child);
    else if (entry.isFile() && /\.(?:mjs|json|md|ts|cs)$/.test(entry.name)) sourceFiles.push({ path: child, sha256: await digestBytes(await readFile(resolve(harnessRoot, child))) });
  } }
  for (const path of ['src', 'prompts', 'schemas', 'adapters', '../ui-component-harness/src']) await scan(path);
  for (const path of ['scripts/prepare-quote-recheck.mjs', 'scripts/run-quote-recheck.mjs', 'scripts/check-quote-recheck-browser.mjs',
    'scripts/prepare-panel-evaluation.mjs', 'scripts/run-panel-evaluation.mjs', 'examples/quote-recheck-v1/suite.mjs', 'examples/quote-recheck-v1/selection.mjs', 'examples/ordinal-stability-v1/suite.mjs',
    'examples/input-stress-v1/suite.mjs', 'examples/input-stress-v2/suite.mjs', 'examples/panel-evaluation/suite.mjs', 'examples/panel-evaluation/intent-fixture.mjs',
    'examples/tabs-v1/fixture.mjs', 'examples/request-reference-v1/fixture.mjs', 'tests/ordinal-intent-fixture.mjs', 'tests/unity-kit-helpers.mjs'])
    sourceFiles.push({ path, sha256: await digestBytes(await readFile(join(harnessRoot, path))) });
  sourceFiles.sort((a, b) => a.path.localeCompare(b.path)); assert.equal(new Set(sourceFiles.map(file => file.path)).size, sourceFiles.length);
  const buildFile = `${options['--build']}/workbench-build.json`, build = await readJson(buildFile);
  for (const file of build.files) { const bytes = await readFile(join(harnessRoot, options['--build'], file.path)); assert.equal(bytes.length, file.bytes); assert.equal(await digestBytes(bytes), file.sha256); }
  const payload = { quoteRecheckPlanVersion: '0.1', status: 'PREPARED', modelCalls: 0, authorization: 'REQUIRED_NOT_GRANTED',
    model: 'gpt-6-luna', effort: 'xhigh', maxInvocations: caseCount, attemptsPerCase: 1, automaticRetries: 0,
    runtimePreflight: { check: 'codex-login-status', before: 'dispatch-claim', modelCalls: 0, networkRoute: 'explicit-process-proxy',
      settingsChanged: false, network: 'NOT_CHECKED', modelAvailability: 'NOT_CHECKED' },
    sourceFiles, schemas, assetRoot: options['--assets'], library: generation.library,
    suiteSha256: await digestJson(suite), generation: { file: 'generation/evaluation-plan.json', sha256: generation.sha256 },
    fixtures: { file: 'fixture-validation.json', sha256: await digestJson(fixtureProof) },
    build: { file: buildFile, sha256: await digestJson(build) },
    browser: { file: 'fixture-browser/browser-report.json', sha256: await digestJson(browser), checks: browser.checks.length },
    requiredGates: ['all-planned-real-ready', 'explicit-business-semantics', 'compile', 'native-0.8-bound-request-references', 'pixi-interaction', 'actual-delivery-offline-reimport'],
    scope: `${caseCount} independent fresh attempt(s) only. Original 31/32 and previous three-case quote gate FAIL remain. No new repeated all16 or composition certification.`,
    nativeEngines: 'NOT_RUN', humanVisualReview: 'NOT_RUN' };
  const plan = { ...payload, sha256: await digestJson(payload) }; await writeNewJson(output, 'quote-recheck-plan.json', plan);
  console.log(JSON.stringify({ status: 'PREPARED', cases: caseCount, modelCalls: 0, planSha256: plan.sha256, sourceFiles: sourceFiles.length, fixtureBrowserChecks: browser.checks.length }));
} catch (error) { console.error(JSON.stringify({ status: 'FAILED', code: /^(?:QUOTE_|OUTPUT_)[A-Z0-9_]+$/.test(error.message) ? error.message : 'QUOTE_RECHECK_PREPARE_FAILED', modelCalls: 0 })); process.exitCode = 1; }
