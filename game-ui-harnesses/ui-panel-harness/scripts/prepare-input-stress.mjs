#!/usr/bin/env node
/** Prepare a finite immutable compute plan, including zero-model driver simulation. */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { INPUT_STRESS_SUITE, EDIT_STRESS_STEPS } from '../examples/input-stress-v1/suite.mjs';
import { checkStressEdit, findStressRow, stressFixturePatch, stressFixtureProposal } from './input-stress-contract.mjs';
import { createOutputDirectory, readJson, writeNewJson, harnessRoot } from '../src/io.mjs';
import { digestBytes, digestJson } from '../src/canonical.mjs';
import { createPlanningContext } from '../src/planning-context.mjs';
import { buildNativePanelIntentResponseSchema } from '../src/panel-intent.mjs';
import { buildCodexEditResponseSchema } from '../src/codex-edit-schema.mjs';
import { verifyAssetLibrary } from '../src/asset-library.mjs';
import { createAssetRetrieval } from '../src/asset-retrieval.mjs';
import { loadTextureImageAdapter } from '../src/texture-image-adapter.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { createPanelBundle, panelBundleAssetInputs, validatePanelBundle } from '../src/panel-bundle.mjs';
import { evaluationProtocolFingerprint } from '../src/evaluation-protocol.mjs';
import { readPanelEvaluationRun } from '../src/panel-evaluation-io.mjs';
import { evaluateRecipeHits } from '../src/panel-evaluation.mjs';
import { createWorkbenchModel } from '../src/workbench-model.mjs';

const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) {
  assert(['--output', '--assets', '--sharp-module', '--source-run', '--build'].includes(args[i]) && args[i + 1] && !options[args[i]]);
  options[args[i]] = args[i + 1];
}
assert(options['--output'] && options['--assets']);
const assetRoot = options['--assets'], sourceRun = options['--source-run'] ?? 'output/studio-real-standard-run-v1';
const buildDirectory = options['--build'] ?? 'output/panel-studio-stability-fix-v1';
for (const path of [assetRoot, sourceRun, buildDirectory]) assert(/^[a-zA-Z0-9._/-]+$/.test(path) && !path.split('/').includes('..'));
const core = await loadWorkspaceCore(), adapter = await loadTextureImageAdapter(options['--sharp-module']);
const verifiedLibrary = await verifyAssetLibrary(assetRoot, adapter);
const catalog = await readJson('examples/modern-mint-forms.catalog.json');
const prior = await readPanelEvaluationRun(sourceRun, core), priorCase = prior.cases.find(item => item.id === 'eval-audio');
assert.equal(priorCase.status, 'PASS_BEFORE_BROWSER');
const source = await validatePanelBundle(prior.bundles.get('eval-audio'), core);
assert.deepEqual(source.catalog, catalog); assert.equal(source.sha256, priorCase.bundleSha256);
const main = findStressRow(source.spec, '主音量'), mute = findStressRow(source.spec, '静音');
assert.equal(source.spec.state.find(field => field.id === main.bind).initial, 70);
const trial = { ...source.state, [main.bind]: 83, [mute.bind]: true };
const trialSource = await createPanelBundle(source.spec, source.catalog, core, trial, panelBundleAssetInputs(source, core));
const buildFile = `${buildDirectory}/workbench-build.json`, build = await readJson(buildFile);
for (const file of build.files) {
  const bytes = await readFile(join(buildDirectory, file.path));
  assert.equal(bytes.length, file.bytes); assert.equal(await digestBytes(bytes), file.sha256);
}
assert.deepEqual(build.library, { id: verifiedLibrary.index.id, sha256: verifiedLibrary.index.sha256 });

// Reuse the public finite 16-case runner without changing its gates or policy.
const suite = structuredClone(INPUT_STRESS_SUITE), contexts = [], cases = [];
for (const item of suite.cases) {
  const context = await createPlanningContext(item.request, catalog, createAssetRetrieval(item.request.text, verifiedLibrary.index, { style: null }));
  const retrieval = evaluateRecipeHits(context, item.expected); assert.equal(retrieval.status, 'PASS', item.id);
  contexts.push(context);
  cases.push({ id: item.id, title: item.title, contextFile: `${item.id}.context.json`, contextSha256: context.sha256,
    expectedSha256: await digestJson(item.expected), retrieval });
}
const protocol = await evaluationProtocolFingerprint();
const generationPayload = { panelEvaluationPlanVersion: '0.2', sampleTag: 'input-stress-v1', protocol,
  suiteSha256: await digestJson(suite), catalogSha256: contexts[0].catalogSha256,
  library: { id: verifiedLibrary.index.id, sha256: verifiedLibrary.index.sha256 },
  policy: { model: 'gpt-6-luna', effort: 'xhigh', maxInvocations: 16, attemptsPerCase: 1, automaticRetries: 0,
    concurrency: 2, timeoutMs: 900000, semanticChecks: 'explicit-expectations', browser: 'SEPARATE_OFFLINE_ACCEPTANCE', nativeEngines: 'NOT_RUN' }, cases };
const generationPlan = { ...generationPayload, sha256: await digestJson(generationPayload) };

const model = await createWorkbenchModel({ catalog, pool: null }, core); await model.importPanel(trialSource);
let values = trial, firstContext, firstSchema; const driverSteps = [];
for (const step of EDIT_STRESS_STEPS) {
  const before = model.getSnapshot(), { context } = await model.prepareEdit(step.request);
  const responseSchema = await buildCodexEditResponseSchema({ draft: true, context });
  if (!firstContext) { firstContext = context; firstSchema = responseSchema; }
  const patch = await stressFixturePatch(before.panel.spec, step);
  const after = await model.acceptEditProposal(stressFixtureProposal(context, patch), values);
  const semantic = await checkStressEdit(before.panel.spec, after.panel.spec, step);
  assert.equal(after.panel.state[main.bind], 83);
  const reopened = await validatePanelBundle(await model.exportPanel(after.panel.state), core); assert.deepEqual(reopened, after.panel);
  const undoModel = await createWorkbenchModel({ catalog, pool: null }, core); await undoModel.importPanel(before.panel);
  await undoModel.prepareEdit(step.request); await undoModel.acceptEditProposal(stressFixtureProposal(context, patch), values);
  const undone = await undoModel.undo(); assert.deepEqual(undone.panel.spec, before.panel.spec); assert.deepEqual(undone.panel.state, values); undoModel.dispose();
  driverSteps.push({ id: step.id, status: 'FIXTURE_PASS', semantic, exportReopen: 'PASS', undo: 'PASS', modelCalls: 0 });
  values = after.panel.state;
  if (step.expectation === 'add') values = { ...values, [findStressRow(after.panel.spec, '音效音量').bind]: 91 };
}
for (let i = 0; i < EDIT_STRESS_STEPS.length; i++) await model.undo();
assert.deepEqual(model.getSnapshot().panel, trialSource); model.dispose();

const filePaths = ['scripts/prepare-input-stress.mjs', 'scripts/run-input-stress.mjs', 'scripts/input-stress-contract.mjs',
  'scripts/input-stress-fixtures.mjs', 'examples/input-stress-v1/suite.mjs', 'examples/panel-evaluation/suite.mjs',
  'scripts/run-panel-evaluation.mjs', 'scripts/build-panel-evaluation-preview.mjs', 'scripts/build-panel-composition-evaluation.mjs',
  'scripts/check-panel-evaluation-browser.mjs'];
for (const directory of ['src', 'schemas', 'prompts', '../ui-component-harness/src']) {
  for (const file of await readdir(directory, { recursive: true, withFileTypes: true })) {
    if (file.isFile() && /\.(mjs|js|ts|json|md)$/.test(file.name)) {
      const path = join(file.parentPath ?? file.path, file.name);
      // Node's Dirent parentPath is relative for the supplied relative directory.
      filePaths.push(path.replaceAll('\\', '/'));
    }
  }
}
const sourceFiles = await Promise.all([...new Set(filePaths)].sort().map(async path => ({ path, sha256: await digestBytes(await readFile(path)) })));
const steps = EDIT_STRESS_STEPS.map(step => structuredClone(step));
const payload = { inputStressPlanVersion: '0.1', status: 'PREPARED', authorization: 'REQUIRED_NOT_GRANTED',
  model: 'gpt-6-luna', effort: 'xhigh', maxInvocations: 24, attemptsPerRequest: 1, automaticRetries: 0,
  protocol, sourceFiles, build: { file: buildFile, sha256: await digestJson(build) },
  generation: { directory: 'generation', planSha256: generationPlan.sha256, cases: 16, concurrency: 2 },
  edit: { steps, sourceFile: 'edit-source.panel.bundle.json', sourceSha256: source.sha256,
    trialFile: 'edit-trial.panel.bundle.json', trialSha256: trialSource.sha256,
    origin: { run: sourceRun, caseId: 'eval-audio', reportSha256: await digestJson(prior.report), sourceSha256: source.sha256,
      receiptSha256: await digestJson(priorCase.receipt) },
    firstContextFile: 'edit01.context.json', firstContextSha256: firstContext.sha256,
    firstResponseSchemaFile: 'edit01.response-schema.json', firstResponseSchemaSha256: await digestJson(firstSchema),
    subsequentContextPolicy: 'Bind each request in fixed order to the preceding accepted real result; save exact context/schema digests before its only invocation.',
    failurePolicy: 'Stop the remaining edit steps after any failed, indeterminate, clarification or semantic-invalid result; never resume or spend unused calls on retries.',
    maxInvocations: 8, trial: { main: 83, mute: true, newEffectsAfterAddition: 91 },
    offlineChecks: ['only-requested-edit', 'trial-versus-default', 'reset-scope', 'export-reopen', 'undo-each-step', 'undo-entire-chain'] },
  library: generationPayload.library, assetRoot,
  acceptance: { generation: '16/16 model-ready + explicit business assertions + compile + real Pixi interaction',
    edit: '8/8 ordered real edits + preserved properties/values + browser reset/export/undo',
    composition: 'All 16 same-cohort sources must pass before column/grid/settings/duplicate/rich combinations; no replacement with an old successful sample.',
    delivery: 'Pixi offline package + shared Unity source/GUID/path checks; native Unity NOT_RUN in this round.',
    mobile: '390x844 viewport: bounds/overflow and control behavior; readability/touch/reflow NOT_CERTIFIED.',
    repeatedRunStability: 'One new variant cohort; a pass does not prove an arbitrary input or repeated identical request always succeeds.' },
  driverSimulation: { cases: 8, status: 'FIXTURE_PASS', modelCalls: 0 }, modelCalls: 0, nativeEngines: 'NOT_RUN', humanVisualReview: 'NOT_RUN' };
const plan = { ...payload, sha256: await digestJson(payload) };
const output = await createOutputDirectory(options['--output']), generation = await createOutputDirectory(join(output, 'generation'));
await writeNewJson(generation, 'suite.json', suite); await writeNewJson(generation, 'evaluation-plan.json', generationPlan);
for (let i = 0; i < cases.length; i++) {
  await writeNewJson(generation, cases[i].contextFile, contexts[i]);
  await writeNewJson(generation, `${cases[i].id}.response-schema.json`, buildNativePanelIntentResponseSchema(contexts[i]));
}
await writeNewJson(output, 'edit-source.panel.bundle.json', source); await writeNewJson(output, 'edit-trial.panel.bundle.json', trialSource);
await writeNewJson(output, 'edit01.context.json', firstContext); await writeNewJson(output, 'edit01.response-schema.json', firstSchema);
await writeNewJson(output, 'driver-simulation.json', { status: 'FIXTURE_PASS', modelCalls: 0, scope: 'Driver simulation, not generated model evidence.', steps: driverSteps, fullUndo: 'PASS' });
await writeNewJson(output, 'input-stress-plan.json', plan);
console.log(JSON.stringify({ status: 'PREPARED', planSha256: plan.sha256, generationCases: 16, editSteps: 8,
  recipeHits: 16, driverFixturePass: 8, maxInvocations: 24, modelCalls: 0 }));
