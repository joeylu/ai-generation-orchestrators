#!/usr/bin/env node
/** Prepare two independent all16 cohorts and fixture-only offline QA; no inference. */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ORDINAL_STABILITY_SUITE } from '../examples/ordinal-stability-v2/suite.mjs';
import { compactIntentFixture } from '../examples/panel-evaluation/intent-fixture.mjs';
import { ordinalFixture } from '../tests/ordinal-intent-fixture.mjs';
import { materializePanelIntent, buildNativePanelIntentResponseSchema } from '../src/panel-intent.mjs';
import { requestReferenceFixture } from '../examples/request-reference-v1/fixture.mjs';
import { evaluatePanelSemantics } from '../src/panel-evaluation.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { createPanelBundle, validatePanelBundle } from '../src/panel-bundle.mjs';
import { composePanelBundles, validatePanelComposition } from '../src/panel-composition.mjs';
import { loadTextureImageAdapter } from '../src/texture-image-adapter.mjs';
import { loadPanelPlanAssets } from '../src/panel-assets-io.mjs';
import { digestBytes, digestJson } from '../src/canonical.mjs';
import { createOutputDirectory, harnessRoot, readJson, writeNewJson } from '../src/io.mjs';
try {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i += 2) {
    assert(['--output', '--assets', '--build', '--sharp-module'].includes(args[i]) && args[i + 1] && !options[args[i]]); options[args[i]] = args[i + 1];
  }
  for (const key of ['--output', '--assets', '--build']) assert(options[key] && /^[A-Za-z0-9._/-]+$/.test(options[key]) && !options[key].split('/').includes('..'));
  const output = await createOutputDirectory(resolve(harnessRoot, options['--output']));
  await createOutputDirectory(join(output, 'fixture-bundles')); await createOutputDirectory(join(output, 'fixture-compositions'));
  await writeNewJson(output, 'suite.json', ORDINAL_STABILITY_SUITE);
  const rounds = [], schemas = [], fixtureChecks = [], fixtureBundles = new Map();
  const core = await loadWorkspaceCore(), imageAdapter = await loadTextureImageAdapter(options['--sharp-module']);
  for (let n = 1; n <= 2; n++) {
    const directory = `round0${n}`;
    const childArgs = ['scripts/prepare-panel-evaluation.mjs', '--catalog', 'examples/modern-mint-forms.catalog.json', '--assets', options['--assets'],
      '--suite', `${options['--output']}/suite.json`, '--output', `${options['--output']}/${directory}`, '--sample', `ordinal-stability-round-${n}`];
    if (options['--sharp-module']) childArgs.push('--sharp-module', options['--sharp-module']);
    const child = spawnSync(process.execPath, childArgs, { cwd: harnessRoot, encoding: 'utf8' }); assert.equal(child.status, 0);
    const generation = await readJson(join(output, directory, 'evaluation-plan.json'));
    assert.equal(generation.cases.length, 16); assert(generation.cases.every(item => item.retrieval.status === 'PASS'));
    for (let i = 0; i < generation.cases.length; i++) {
      const item = generation.cases[i], context = await readJson(join(output, directory, item.contextFile));
      const schema = buildNativePanelIntentResponseSchema(context); assert.deepEqual(schema.properties.panelIntentVersion.enum, ['0.8']);
      await writeNewJson(join(output, directory), `${item.id}.response-schema.json`, schema);
      schemas.push({ path: `${directory}/${item.id}.response-schema.json`, sha256: await digestJson(schema), contextSha256: context.sha256 });
      if (n === 1) {
        const expected = ORDINAL_STABILITY_SUITE.cases[i];
        const proposal = await materializePanelIntent(context, requestReferenceFixture(ordinalFixture(compactIntentFixture(context, expected))));
        assert.equal(evaluatePanelSemantics(proposal.spec, expected.expected).status, 'PASS');
        const assets = await loadPanelPlanAssets(context, proposal.spec, options['--assets'], imageAdapter);
        const bundle = await validatePanelBundle(await createPanelBundle(proposal.spec, context.catalog, core, undefined, assets.assets), core);
        await writeNewJson(join(output, 'fixture-bundles'), `${item.id}.panel.bundle.json`, bundle);
        fixtureChecks.push({ id: item.id, status: 'PASS', contextSha256: context.sha256, fixtureBundleSha256: bundle.sha256 }); fixtureBundles.set(item.id, bundle);
      } else assert.equal(context.sha256, fixtureChecks[i].contextSha256);
    }
    rounds.push({ id: directory, file: `${directory}/evaluation-plan.json`, sha256: generation.sha256, sampleTag: generation.sampleTag, cases: 16 });
  }
  assert.notEqual(rounds[0].sha256, rounds[1].sha256);
  const all = [...fixtureBundles.keys()], compositions = [
    { id: 'fixture-all-column', ids: all, layout: 'column', width: 960 }, { id: 'fixture-all-grid', ids: all, layout: 'grid', width: 1600 },
    { id: 'fixture-settings-row', ids: ['eval-audio', 'eval-graphics', 'eval-controls'], layout: 'row', width: 2100 },
    { id: 'fixture-collision', ids: ['eval-audio', 'eval-audio'], layout: 'grid', width: 1280 },
    { id: 'fixture-rich', ids: ['eval-character', 'eval-room', 'eval-shop', 'eval-language', 'eval-quest'], layout: 'grid', width: 1600 },
  ];
  const compositionChecks = [];
  for (const item of compositions) {
    const sources = item.ids.map(id => fixtureBundles.get(id));
    const request = { panelCompositionRequestVersion: '0.1', id: item.id, title: '程序组合预检', sources: sources.map((bundle, i) => ({ namespace: `part${i + 1}`, bundleSha256: bundle.sha256 })),
      layout: item.layout, width: item.width, canvasWidth: item.width + 64, canvasHeight: null, maxHeight: 480, surfaceFrom: null };
    const value = await validatePanelComposition(await composePanelBundles(request, sources, core), sources, core);
    await writeNewJson(join(output, 'fixture-compositions'), `${item.id}.panel.bundle.json`, value.bundle);
    await writeNewJson(join(output, 'fixture-compositions'), `${item.id}.composition.json`, value);
    compositionChecks.push({ id: item.id, status: 'PASS', sourceCount: sources.length, fixtureBundleSha256: value.bundle.sha256 });
  }
  const fixture = { status: 'FIXTURE_PASS', modelCalls: 0, scope: 'Program-owned expected fixtures only; not real generation evidence.', cases: fixtureChecks, compositions: compositionChecks };
  await writeNewJson(output, 'fixture-validation.json', fixture);
  const buildFile = `${options['--build']}/workbench-build.json`, build = await readJson(buildFile);
  for (const file of build.files) { const bytes = await readFile(resolve(harnessRoot, options['--build'], file.path)); assert.equal(bytes.length, file.bytes); assert.equal(await digestBytes(bytes), file.sha256); }
  const browserChild = spawnSync(process.execPath, ['scripts/check-stability-delivery-browser.mjs', '--prepared', options['--output'], '--workbench', options['--build'],
    '--mode', 'fixture', '--output', `${options['--output']}/fixture-browser`], { cwd: harnessRoot, encoding: 'utf8' });
  assert.equal(browserChild.status, 0);
  const browser = await readJson(join(output, 'fixture-browser/browser-report.json'));
  assert.equal(browser.status, 'PASS'); assert.equal(browser.mode, 'fixture'); assert.equal(browser.individuals, 16); assert.equal(browser.fixtureCompositions, 5);
  assert.equal(browser.imports, 21); assert.equal(browser.deliveries.length, 21); assert.equal(browser.modelCalls, 0); assert.equal(browser.blockedComputeRequests, 0);
  const sourceFiles = [];
  async function scan(path) { for (const entry of await readdir(resolve(harnessRoot, path), { withFileTypes: true })) {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) await scan(child);
    else if (entry.isFile() && /\.(?:mjs|json|md|ts|cs|meta)$/.test(entry.name)) sourceFiles.push({ path: child, sha256: await digestBytes(await readFile(resolve(harnessRoot, child))) });
  } }
  for (const path of ['src', 'prompts', 'schemas', 'adapters/unity', '../ui-component-harness/src']) await scan(path);
  for (const path of ['scripts/prepare-ordinal-stability.mjs', 'scripts/run-ordinal-stability.mjs', 'scripts/prepare-panel-evaluation.mjs', 'scripts/run-panel-evaluation.mjs',
    'scripts/build-panel-evaluation-preview.mjs', 'scripts/check-panel-evaluation-browser.mjs', 'scripts/build-panel-composition-evaluation.mjs', 'scripts/check-stability-delivery-browser.mjs',
    'scripts/export-panel-delivery.mjs', 'scripts/build-delivery-runtime.mjs', 'tests/ordinal-intent-fixture.mjs', 'tests/unity-kit-helpers.mjs',
    'examples/panel-evaluation/intent-fixture.mjs', 'examples/request-reference-v1/fixture.mjs', 'examples/panel-evaluation/suite.mjs', 'examples/input-stress-v1/suite.mjs', 'examples/input-stress-v2/suite.mjs', 'examples/ordinal-stability-v1/suite.mjs', 'examples/ordinal-stability-v2/suite.mjs'])
    sourceFiles.push({ path, sha256: await digestBytes(await readFile(join(harnessRoot, path))) });
  sourceFiles.sort((a, b) => a.path.localeCompare(b.path));
  const payload = { ordinalStabilityPlanVersion: '0.1', status: 'PREPARED', authorization: 'REQUIRED_NOT_GRANTED', modelCalls: 0,
    policy: { model: 'gpt-6-luna', effort: 'xhigh', rounds: 2, casesPerRound: 16, maxInvocations: 32, attemptsPerCasePerRound: 1, automaticRetries: 0,
      failure: 'Finish independent requests in round1; stop before round2 if any generation, semantic, compile, browser, composition or delivery gate fails. Never spend unused calls on retries.' },
    runtimePreflight: { loginVisibility: 'REQUIRED', networkRoute: 'explicit-process-proxy', before: 'dispatch-claim', networkHealth: 'NOT_VERIFIED' },
    rounds, schemas, sourceFiles, assetRoot: options['--assets'], suiteSha256: await digestJson(ORDINAL_STABILITY_SUITE),
    fixture: { file: 'fixture-validation.json', sha256: await digestJson(fixture), cases: 16, compositions: 5 },
    browser: { file: 'fixture-browser/browser-report.json', sha256: await digestJson(browser), individuals: 16, compositions: 5, deliveries: 21, modelCalls: 0 },
    build: { file: buildFile, sha256: await digestJson(build) },
    acceptance: { nativeIntent: 'All16 raw version0.8 intents must bind their frozen context and every authored row/navigation through sourceRef=request.',
      perRound: 'All16 genuine sources pass explicit business assertions, real Pixi interaction, five same-cohort compositions, ZIP integrity and actual download/offline-open/reimport with played state.',
      repeatedInputs: 'Same16 exact requests independently generated in two preplanned rounds; no cross-round source replacement.',
      nativeEngines: 'NOT_RUN', humanVisualReview: 'NOT_RUN', arbitraryInputReliability: 'NOT_CERTIFIED' } };
  const plan = { ...payload, sha256: await digestJson(payload) }; await writeNewJson(output, 'ordinal-stability-plan.json', plan);
  console.log(JSON.stringify({ status: 'PREPARED', planSha256: plan.sha256, rounds: 2, nativeSchemas: schemas.length, fixtureCases: 16, fixtureCompositions: 5, maxInvocations: 32, sourceFiles: sourceFiles.length, modelCalls: 0 }));
} catch { console.error(JSON.stringify({ status: 'FAIL', code: 'ORDINAL_STABILITY_PREPARE_FAILED', modelCalls: 0 })); process.exitCode = 1; }
