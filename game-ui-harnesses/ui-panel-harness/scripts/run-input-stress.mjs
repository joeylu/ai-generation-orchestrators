#!/usr/bin/env node
/** Optional real computation: one single-use plan, at most 16 generations + 8 ordered edits. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile, appendFile, lstat } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { createOutputDirectory, readJson, writeNewJson, harnessRoot } from '../src/io.mjs';
import { digestBytes, digestJson } from '../src/canonical.mjs';
import { validatePlanningContext } from '../src/planning-context.mjs';
import { buildNativePanelIntentResponseSchema } from '../src/panel-intent.mjs';
import { validatePanelEditContext } from '../src/edit-planning.mjs';
import { buildCodexEditResponseSchema } from '../src/codex-edit-schema.mjs';
import { evaluationProtocolFingerprint } from '../src/evaluation-protocol.mjs';
import { findCodexExecutable, editWithCodex } from '../src/codex-planner.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { loadTextureImageAdapter } from '../src/texture-image-adapter.mjs';
import { verifyAssetLibrary } from '../src/asset-library.mjs';
import { createAssetRetrieval } from '../src/asset-retrieval.mjs';
import { validatePanelBundle } from '../src/panel-bundle.mjs';
import { createWorkbenchModel } from '../src/workbench-model.mjs';
import { applyPanelPatch } from '../src/patch.mjs';
import { checkStressEdit, findStressRow } from './input-stress-contract.mjs';
import { INPUT_STRESS_SUITE, EDIT_STRESS_STEPS } from '../examples/input-stress-v1/suite.mjs';
import { initialPanelState, controlId } from '../src/compiler.mjs';
import { projectPanelEvent } from '../src/state.mjs';

const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--preflight') { assert(!options.preflight); options.preflight = true; }
  else { assert(['--prepared', '--approve-plan', '--output', '--sharp-module'].includes(args[i]) && args[i + 1] && !options[args[i]]); options[args[i]] = args[++i]; }
}
assert(options['--prepared']); assert(options.preflight ? !options['--approve-plan'] && !options['--output'] : options['--approve-plan'] && options['--output']);
const prepared = resolve(options['--prepared']), relPrepared = relative(resolve(harnessRoot), prepared);
assert(relPrepared && !relPrepared.startsWith('..') && !relPrepared.split(/[\\/]/).some(part => /^(\.git|\.codex|\.agents)$/i.test(part)));
const plan = await readJson(join(prepared, 'input-stress-plan.json')), { sha256, ...payload } = plan;
assert.equal(await digestJson(payload), sha256); assert.equal(plan.inputStressPlanVersion, '0.1');
assert.equal(plan.authorization, 'REQUIRED_NOT_GRANTED'); assert.equal(plan.maxInvocations, 24);
assert.equal(plan.model, 'gpt-6-luna'); assert.equal(plan.effort, 'xhigh');
assert.equal(plan.attemptsPerRequest, 1); assert.equal(plan.automaticRetries, 0);
assert.equal(plan.generation.cases, 16); assert.equal(plan.generation.maxInvocations ?? 16, 16); assert.equal(plan.edit.maxInvocations, 8);
assert.deepEqual(plan.edit.steps, EDIT_STRESS_STEPS); assert.equal(plan.assetRoot, 'output/generic-library-migrated-v1');
if (!options.preflight) assert.equal(options['--approve-plan'], sha256);
async function verifyFiles() {
  assert.deepEqual(await evaluationProtocolFingerprint(), plan.protocol);
  for (const file of plan.sourceFiles) assert.equal(await digestBytes(await readFile(file.path)), file.sha256, file.path);
}
await verifyFiles();
const build = await readJson(plan.build.file); assert.equal(await digestJson(build), plan.build.sha256);
for (const file of build.files) {
  const bytes = await readFile(resolve(plan.build.file, '..', file.path));
  assert.equal(bytes.length, file.bytes); assert.equal(await digestBytes(bytes), file.sha256);
}
const generationDirectory = join(prepared, 'generation'); assert.equal(plan.generation.directory, 'generation');
const generation = await readJson(join(generationDirectory, 'evaluation-plan.json'));
const { sha256: generationSha, ...generationPayload } = generation;
assert.equal(generationSha, plan.generation.planSha256); assert.equal(await digestJson(generationPayload), generationSha);
const suite = await readJson(join(generationDirectory, 'suite.json')); assert.deepEqual(suite, INPUT_STRESS_SUITE);
assert.equal(await digestJson(suite), generation.suiteSha256); assert.equal(generation.cases.length, 16);
assert.deepEqual(generation.policy, { model: 'gpt-6-luna', effort: 'xhigh', maxInvocations: 16, attemptsPerCase: 1, automaticRetries: 0,
  concurrency: 2, timeoutMs: 900000, semanticChecks: 'explicit-expectations', browser: 'SEPARATE_OFFLINE_ACCEPTANCE', nativeEngines: 'NOT_RUN' });
const adapter = await loadTextureImageAdapter(options['--sharp-module']), library = await verifyAssetLibrary(plan.assetRoot, adapter);
assert.deepEqual(plan.library, { id: library.index.id, sha256: library.index.sha256 }); assert.deepEqual(generation.library, plan.library);
for (let i = 0; i < generation.cases.length; i++) {
  const item = generation.cases[i], context = await validatePlanningContext(await readJson(join(generationDirectory, item.contextFile)));
  assert.equal(context.sha256, item.contextSha256); assert.deepEqual(context.request, suite.cases[i].request);
  assert.equal(await digestJson(suite.cases[i].expected), item.expectedSha256);
  assert.deepEqual(context.assetRetrieval, createAssetRetrieval(context.request.text, library.index, { style: null }));
  assert.deepEqual(buildNativePanelIntentResponseSchema(context), await readJson(join(generationDirectory, `${item.id}.response-schema.json`)));
}
const core = await loadWorkspaceCore(), executable = findCodexExecutable(); assert(executable);
const source = await validatePanelBundle(await readJson(join(prepared, plan.edit.sourceFile)), core);
const trial = await validatePanelBundle(await readJson(join(prepared, plan.edit.trialFile)), core);
assert.equal(source.sha256, plan.edit.sourceSha256); assert.equal(trial.sha256, plan.edit.trialSha256); assert.deepEqual(source.spec, trial.spec);
const first = await validatePanelEditContext(await readJson(join(prepared, plan.edit.firstContextFile)));
assert.equal(first.sha256, plan.edit.firstContextSha256); assert.deepEqual(first.spec, source.spec); assert.deepEqual(first.request, plan.edit.steps[0].request);
const firstSchema = await buildCodexEditResponseSchema({ draft: true, context: first });
assert.equal(await digestJson(firstSchema), plan.edit.firstResponseSchemaSha256);
assert.deepEqual(firstSchema, await readJson(join(prepared, plan.edit.firstResponseSchemaFile)));
const simulation = await readJson(join(prepared, 'driver-simulation.json'));
assert.equal(simulation.status, 'FIXTURE_PASS'); assert.equal(simulation.modelCalls, 0); assert.equal(simulation.steps.length, 8);
const claim = join(prepared, 'dispatch-claim.json'); await assert.rejects(lstat(claim), { code: 'ENOENT' });
if (options.preflight) {
  console.log(JSON.stringify({ status: 'PREFLIGHT_PASS', planSha256: sha256, generationCases: 16, editSteps: 8, maxInvocations: 24,
    modelCalls: 0, executableAvailable: true, singleUseClaim: 'UNCONSUMED' })); process.exit(0);
}
const output = await createOutputDirectory(options['--output']);
await writeFile(claim, `${JSON.stringify({ inputStressDispatchVersion: '0.1', planSha256: sha256,
  output: relative(resolve(harnessRoot), output).replaceAll('\\', '/'), maxInvocations: 24, automaticRetries: 0 })}\n`, { flag: 'wx' });
await writeNewJson(output, 'approved-plan.json', plan);
async function log(event) { console.log(JSON.stringify(event)); await appendFile(join(output, 'progress.ndjson'), `${JSON.stringify(event)}\n`); }
const report = { inputStressRunVersion: '0.1', status: 'RUNNING', planSha256: sha256, generation: null, edits: [],
  maxInvocations: 24, automaticRetries: 0, browser: 'NOT_RUN', nativeEngines: 'NOT_RUN', humanVisualReview: 'NOT_RUN' };
try {
// The finite child runner owns its own producer receipts and case logs. Never restart this child.
await log({ event: 'GENERATION_START', cases: 16, concurrency: 2 });
const childArgs = ['scripts/run-panel-evaluation.mjs', '--prepared', generationDirectory, '--plan-sha256', generationSha,
  '--assets', plan.assetRoot, '--output', join(output, 'generation')];
if (options['--sharp-module']) childArgs.push('--sharp-module', options['--sharp-module']);
await new Promise((done, reject) => {
  const child = spawn(process.execPath, childArgs, { cwd: harnessRoot, shell: false, stdio: 'inherit', windowsHide: true });
  child.once('error', reject); child.once('exit', code => code === 0 ? done() : reject(new Error('STRESS_GENERATION_CHILD_FAILED_NO_RETRY')));
});
const generated = await readJson(join(output, 'generation/evaluation-report.json'));
assert.equal(generated.planSha256, generationSha); assert(generated.totals.invocationCount <= 16);
report.generation = { file: 'generation/evaluation-report.json', sha256: await digestJson(generated), status: generated.status, totals: generated.totals };
await log({ event: 'GENERATION_COMPLETE', status: generated.status, ready: generated.totals.modelReady });
const model = await createWorkbenchModel({ catalog: trial.catalog, pool: null }, core); await model.importPanel(trial);
let values = trial.state, stopped = false; const beforePanels = [];
for (const step of plan.edit.steps) {
  const result = { id: step.id, status: stopped ? 'NOT_RUN_DEPENDENCY_FAILED' : 'RUNNING', receipt: null, checks: [], failureCode: null };
  report.edits.push(result); if (stopped) continue;
  const directory = await createOutputDirectory(join(output, step.id));
  await log({ event: 'EDIT_START', id: step.id });
  try {
    await verifyFiles();
    const before = await model.exportPanel(values); beforePanels.push(before);
    await writeNewJson(directory, 'before.panel.bundle.json', before);
    const { context } = await model.prepareEdit(step.request), schema = await buildCodexEditResponseSchema({ draft: true, context });
    if (step.id === 'edit01') assert.deepEqual(context, first);
    await writeNewJson(directory, 'dispatch-context.json', context); await writeNewJson(directory, 'dispatch-response-schema.json', schema);
    await writeNewJson(directory, 'dispatch.json', { rootPlanSha256: sha256, id: step.id, request: step.request,
      contextSha256: context.sha256, baseSpecSha256: context.baseSpecSha256, responseSchemaSha256: await digestJson(schema), beforePanelSha256: before.sha256,
      parentResultSpecSha256: result.id === 'edit01' ? await digestJson(source.spec) : report.edits.at(-2).resultSpecSha256, maxInvocations: 1 });
    result.stage = 'model';
    const actual = await editWithCodex(context, { outputRoot: directory, executable, timeoutMs: 900000 });
    result.receipt = actual.receipt; assert.equal(actual.receipt.invocationCount, 1); assert.equal(actual.receipt.automaticRetries, 0);
    assert.equal(actual.report.status, 'READY_TO_APPLY'); result.checks.push('production-proposal-and-receipt');
    result.stage = 'semantic';
    const changed = await applyPanelPatch(before.spec, actual.proposal.patch);
    const semantic = await checkStressEdit(before.spec, changed.spec, step); await writeNewJson(directory, 'semantic-report.json', semantic);
    result.resultSpecSha256 = semantic.afterSpecSha256; result.checks.push('independent-semantics-and-preservation');
    result.stage = 'apply';
    const applied = await model.acceptEditProposal(actual.proposal, values), after = await validatePanelBundle(applied.panel, core);
    assert.deepEqual(after.spec, changed.spec);
    const main = findStressRow(after.spec, step.id === 'edit01' ? '主音量' : '总音量');
    assert.equal(after.state[main.bind], 83); assert.equal(initialPanelState(after.spec)[main.bind], 50);
    result.checks.push('trial83-default50-separate');
    const reset = after.spec.sections.flatMap(section => section.rows).find(row => row.kind === 'button');
    const resetState = projectPanelEvent(after.spec, after.state, { type: 'activate', id: controlId(after.spec.id, reset.id), source: 'keyboard' }).state;
    for (const id of reset.action.fields) assert.equal(resetState[id], initialPanelState(after.spec)[id]);
    result.checks.push('reset-exact-authored-scope');
    const exported = await model.exportPanel(after.state), reopened = await createWorkbenchModel({ catalog: after.catalog, pool: null }, core);
    assert.deepEqual((await reopened.importPanel(exported)).panel, after); reopened.dispose(); result.checks.push('export-reopen');
    const undo = await createWorkbenchModel({ catalog: before.catalog, pool: null }, core); await undo.importPanel(before);
    await undo.prepareEdit(step.request); await undo.acceptEditProposal(actual.proposal, values);
    assert.deepEqual((await undo.undo()).panel, before); undo.dispose(); result.checks.push('one-step-undo');
    await writeNewJson(directory, 'after.panel.bundle.json', after); await writeNewJson(directory, 'accepted-edit-proposal.json', actual.proposal);
    result.bundleSha256 = after.sha256; result.status = 'PASS_BEFORE_BROWSER'; result.stage = 'complete'; values = after.state;
    if (step.expectation === 'add') values = { ...values, [findStressRow(after.spec, '音效音量').bind]: 91 };
  } catch (error) {
    result.status = 'FAIL'; result.failureCode = error.code ?? (error.name === 'AssertionError' ? 'STRESS_ASSERTION_FAILED' : 'STRESS_EDIT_FAILED');
    if (error.receipt) result.receipt = error.receipt; if (error.diagnostic) result.diagnostic = error.diagnostic;
    stopped = true;
  }
  await writeNewJson(directory, 'case-result.json', result); await log({ event: 'EDIT_COMPLETE', id: step.id, status: result.status, stage: result.stage, failureCode: result.failureCode });
}
if (!stopped) {
  for (let i = 7; i >= 0; i--) assert.deepEqual((await model.undo()).panel, beforePanels[i]);
  report.fullUndo = 'PASS';
}
model.dispose();
report.totals = { generationInvocations: generated.totals.invocationCount,
  editInvocations: report.edits.reduce((sum, item) => sum + (item.receipt?.invocationCount ?? 0), 0),
  generationPassed: generated.totals.semanticPass, editPassed: report.edits.filter(item => item.status === 'PASS_BEFORE_BROWSER').length,
  editNotRun: report.edits.filter(item => item.status.startsWith('NOT_RUN')).length, automaticRetries: 0 };
assert(report.totals.generationInvocations + report.totals.editInvocations <= 24);
report.status = generated.status === 'PASS_BEFORE_BROWSER' && report.edits.every(item => item.status === 'PASS_BEFORE_BROWSER') ? 'PASS_BEFORE_BROWSER' : 'FAIL';
await writeNewJson(output, 'input-stress-report.json', report); await log({ event: 'FINISHED', status: report.status, totals: report.totals });
} catch (error) {
  report.status = 'FAILED_NO_RETRY'; report.failureCode = error.code ?? error.message;
  report.unfinishedInvocations = 'INDETERMINATE_UNLESS_PRODUCER_RECEIPTS_PROVE_OTHERWISE';
  await writeNewJson(output, 'input-stress-failure.json', report);
  await log({ event: 'FAILED_NO_RETRY', failureCode: report.failureCode }); process.exitCode = 1;
}
