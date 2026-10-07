#!/usr/bin/env node
/** Preparation only: immutable requests/expectations/context fingerprints; zero model calls. */
import { resolve } from 'node:path';
import { PANEL_EVALUATION_SUITE } from '../examples/panel-evaluation/suite.mjs';
import { createPlanningContext } from '../src/planning-context.mjs';
import { verifyAssetLibrary } from '../src/asset-library.mjs';
import { createAssetRetrieval } from '../src/asset-retrieval.mjs';
import { loadTextureImageAdapter } from '../src/texture-image-adapter.mjs';
import { evaluateRecipeHits } from '../src/panel-evaluation.mjs';
import { digestJson } from '../src/canonical.mjs';
import { evaluationProtocolFingerprint } from '../src/evaluation-protocol.mjs';
import { createOutputDirectory, writeNewJson, readJson } from '../src/io.mjs';

try {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--catalog', '--assets', '--sharp-module', '--output', '--suite', '--sample'].includes(args[i]) || !args[i + 1] || options[args[i]]) throw new Error('EVALUATION_ARGUMENTS');
    options[args[i]] = args[i + 1];
  }
  if (!options['--catalog'] || !options['--assets'] || !options['--output']) throw new Error('EVALUATION_ARGUMENTS');
  const suite = options['--suite'] ? await readJson(options['--suite']) : PANEL_EVALUATION_SUITE, catalog = await readJson(options['--catalog']);
  if (!Array.isArray(suite.cases) || suite.cases.length < 1 || suite.cases.length > 64
    || new Set(suite.cases.map(item => item.id)).size !== suite.cases.length) throw new Error('EVALUATION_SUITE');
  const verified = await verifyAssetLibrary(options['--assets'], await loadTextureImageAdapter(options['--sharp-module']));
  const contexts = await Promise.all(suite.cases.map(item => createPlanningContext(item.request, catalog,
    createAssetRetrieval(item.request.text, verified.index, { style: null }))));
  const cases = await Promise.all(suite.cases.map(async (item, i) => ({ id: item.id, title: item.title,
    contextFile: `${item.id}.context.json`, contextSha256: contexts[i].sha256, expectedSha256: await digestJson(item.expected),
    retrieval: evaluateRecipeHits(contexts[i], item.expected) })));
  const sampleTag = options['--sample'] ?? 'single';
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(sampleTag)) throw new Error('EVALUATION_SAMPLE');
  const payload = { panelEvaluationPlanVersion: '0.2', sampleTag, protocol: await evaluationProtocolFingerprint(), suiteSha256: await digestJson(suite), catalogSha256: contexts[0].catalogSha256,
    library: { id: verified.index.id, sha256: verified.index.sha256 },
    policy: { model: 'gpt-6-luna', effort: 'xhigh', maxInvocations: cases.length, attemptsPerCase: 1, automaticRetries: 0,
      concurrency: 4, timeoutMs: 900000, semanticChecks: 'explicit-expectations', browser: 'SEPARATE_OFFLINE_ACCEPTANCE', nativeEngines: 'NOT_RUN' }, cases };
  const plan = { ...payload, sha256: await digestJson(payload) }, directory = await createOutputDirectory(options['--output']);
  await writeNewJson(directory, 'suite.json', suite);
  for (let i = 0; i < cases.length; i++) await writeNewJson(directory, cases[i].contextFile, contexts[i]);
  await writeNewJson(directory, 'evaluation-plan.json', plan);
  process.stdout.write(`${JSON.stringify({ status: 'PREPARED', cases: cases.length, recipeHits: cases.filter(item => item.retrieval.status === 'PASS').length,
    planSha256: plan.sha256, modelCalls: 0 })}\n`);
} catch (error) { process.stderr.write(`${JSON.stringify({ status: 'FAILED', code: error.code ?? error.message })}\n`); process.exitCode = 1; }
