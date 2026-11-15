import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { encodeFixturePng } from '../src/png.mjs';
import * as pipeline from '../src/pipeline.mjs';
import * as flow from '../src/generation/index.mjs';
import { SCENE_SOURCE_SLOTS } from '../src/generation/scene-sources.mjs';
import { SCENE_LAYER_PROFILE, makeSceneLayerDesign } from '../src/generation/scene-layers.mjs';
import { hash, jsonBytes, seal } from '../src/generation/common.mjs';
import { openSceneExport } from '../src/persistence.mjs';
import { createSceneCodexAdapter } from '../adapters/codex.mjs';
import { runInteractiveScenePipeline } from '../src/pipeline-interactive.mjs';
import { decision } from './helpers/generation.mjs';

let opaque, transparent;
function fixture(alpha = false) {
  if (alpha ? transparent : opaque) return alpha ? transparent : opaque;
  const width = 1024, height = 576, rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (alpha && (x < 100 || x >= 924 || y < 90 || y >= 540)) continue;
    rgba.set([60 + x % 120, 90 + y % 100, 75, 255], (y * width + x) * 4);
  }
  const result = encodeFixturePng(width, height, rgba); if (alpha) transparent = result; else opaque = result; return result;
}
const brief = (projectId = 'forest.test', description = 'Forest ruins, soft light.') => ({ projectId, description, inputs: [],
  style: { mode: 'preset', preset: 'clean-handpaint', name: '', rules: [], anchorPath: null } });
function setup(t, request = brief()) {
  const parent = mkdtempSync(join(tmpdir(), 'scene-pipeline-')); t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'project'); pipeline.initScenePipeline(root, request, { purpose: 'synthetic-simulation' });
  return { parent, root, workflow: join(root, 'workflow') };
}
function design(root) {
  const status = pipeline.inspectScenePipeline(root);
  return pipeline.reviewPipelineDesign(root, { spec: decision('design.spec', status.design.specSha256), style: decision('design.style', status.design.styleSha256) });
}
function double(calls, failAt = -1) {
  return { async preflight() {}, async generate(input) {
    calls.push(input); if (calls.length === failAt) throw new Error('synthetic lost response');
    return fixture(input.request.output.alpha === 'transparent');
  } };
}
async function reference(root) {
  let status = design(root);
  pipeline.authorizePipelineStage(root, decision('reference.compute', status.reference.planSha256, 'approve-compute'));
  const calls = []; status = await pipeline.runScenePipeline(root, double(calls));
  assert.equal(status.stage, 'awaiting-reference-review');
  status = pipeline.reviewPipelineImage(root, status.reference.planSha256, decision('reference.art', status.reference.rawSha256));
  assert.equal(status.stage, 'awaiting-source-compute'); return status;
}
const rejects = (fn, code) => assert.throws(fn, e => e.errors?.some(issue => issue.code === code));

test('native reference -> one batch confirmation -> all sources -> derived kit/export/reopen; no invented art acceptance', { timeout: 180000 }, async t => {
  const { root, parent, workflow } = setup(t), status = await reference(root);
  assert.equal(status.sources.length, 11);
  const batch = flow.getSceneSourceBatch(workflow, status.sourceBatches[0]);
  const refPlan = flow.getGenerationPlan(workflow, status.reference.planSha256);
  assert.equal(refPlan.composition.layers.length, 11);
  assert.ok(status.sources.every(item => flow.getGenerationPlan(workflow, item.planSha256).layerBinding.layerDesignSha256 === refPlan.composition.layerDesignSha256));
  assert.equal(batch.maximumImageRequests, 11);
  const before = flow.inspectWorkflow(workflow).eventCount;
  pipeline.authorizePipelineStage(root, decision('sources.compute', batch.sha256, 'approve-compute'));
  assert.equal(flow.inspectWorkflow(workflow).eventCount, before + 1, 'one exact batch receipt, no invented individual human decisions');
  const calls = [], adapter = double(calls), width = 2304, height = 576, rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rgba.set([60 + x % 120, 90 + y % 100, 75, 255], (y * width + x) * 4);
  const wide = encodeFixturePng(width, height, rgba);
  const done = await pipeline.runScenePipeline(root, { preflight: adapter.preflight, async generate(input) {
    const bytes = await adapter.generate(input); return input.planSha256 === status.sources[0].planSha256 ? wide : bytes;
  } });
  assert.equal(calls.length, 11); assert.equal(done.stage, 'ready-to-assemble');
  assert.ok(done.sources.every(item => item.status === 'pending-visual-review'));
  assert.equal(flow.getGenerationPlan(workflow, status.sources[0].planSha256).target.sourcePolicy.maximumWidth, 4096);
  assert.equal(flow.getGenerationResult(workflow, status.sources[0].planSha256).result.technical.image.pixelSize.width, 2304);
  assert.ok(calls.every(call => call.images.length === 1 && hash(call.images[0].bytes) === call.images[0].artifact.sha256));
  assert.deepEqual(calls.map(call => call.request.output.alpha), ['opaque', 'opaque', ...Array(9).fill('transparent')]);
  const delivery = pipeline.deliverScenePipeline(root, join(parent, 'delivery'));
  assert.equal(delivery.productionKit, false); assert.equal(delivery.fullKitVisualAcceptance, 'not-assessed');
  const reopened = openSceneExport(join(parent, 'delivery/export'));
  assert.equal(reopened.compiled.contentSha256, delivery.compiledSha256);
  const readiness = JSON.parse(readFileSync(join(parent, 'delivery/candidate/readiness.json')));
  assert.equal(readiness.moduleCount, 1514); assert.equal(readiness.terrainRoleCount, 47);
  assert.ok(readiness.sourceEvidence.every(source => source.sourceArtAcceptance === 'not-assessed'));
  assert.equal(reopened.compiled.terrainPresentation.coveredGridCells, 3);
  assert.deepEqual(reopened.document.layers.map(layer => layer.layerId), SCENE_LAYER_PROFILE.layers.map(layer => layer.layerId));
  assert.equal(JSON.parse(readFileSync(join(parent, 'delivery/candidate/evidence/layer-design.json'))).sha256, refPlan.composition.layerDesignSha256);
  assert.equal(pipeline.inspectScenePipeline(root).eventCount, done.eventCount, 'assembly does not append human acceptance or attempts');
  rejects(() => pipeline.deliverScenePipeline(root, join(parent, 'delivery')), 'OUTPUT_EXISTS');
  await assert.rejects(pipeline.runScenePipeline(root, double(calls)), e => e.errors?.some(issue => issue.code === 'PIPELINE_NOT_AUTHORIZED'));
  assert.equal(calls.length, 11);
  const resume = await runInteractiveScenePipeline(root, join(parent, 'delivery'), { adapter: double(calls),
    ask: () => { throw new Error('completed delivery must not ask for new compute'); } });
  assert.equal(resume.delivery.sha256, delivery.sha256); assert.equal(calls.length, 11);
  const zipPath = join(parent, 'delivery/scene-kit.zip'), zip = readFileSync(zipPath), changed = Buffer.from(zip); changed[0] ^= 1;
  writeFileSync(zipPath, changed);
  rejects(() => pipeline.verifyPipelineDelivery(root, join(parent, 'delivery')), 'PIPELINE_DELIVERY_IDENTITY');
  writeFileSync(zipPath, zip);
});

test('text, scene image, sketch and custom style use explicit roles; private paths never enter frozen requests', t => {
  const parent = mkdtempSync(join(tmpdir(), 'scene-inputs-')); t.after(() => rmSync(parent, { recursive: true, force: true }));
  const image = join(parent, 'user.png'); writeFileSync(image, fixture());
  const { root } = setup(t, { ...brief('custom.test', ''), inputs: [{ role: 'layout-sketch', path: image }, { role: 'scene-reference', path: image }],
    style: { mode: 'custom', preset: null, name: 'User palette', rules: ['Simple clear shapes.'], anchorPath: image } });
  design(root); const { plans } = pipeline.pipelinePlans(root), ref = plans[0];
  assert.deepEqual(ref.request.images.map(image => image.role), ['layout-sketch', 'scene-reference', 'style-anchor']);
  assert.equal(JSON.stringify(ref).includes(parent), false); assert.equal(ref.format, 'ai_scene_generation_plan_v10');
});

test('a new theme changes every source plan without inheriting forest-specific instructions', async t => {
  const first = setup(t), second = setup(t, brief('snow.test', 'Snowy stone fortress, cold blue palette, no vegetation.'));
  await reference(first.root); await reference(second.root);
  const a = pipeline.pipelinePlans(first.root), b = pipeline.pipelinePlans(second.root);
  assert.equal(b.plans.length, 12);
  for (const slot of SCENE_SOURCE_SLOTS) {
    const x = a.plans.find(plan => plan.recipe.slot === slot.key), y = b.plans.find(plan => plan.recipe.slot === slot.key);
    assert.notEqual(x.sha256, y.sha256);
    if (slot.key !== 'material') assert.match(y.request.prompt, /Snowy stone fortress/);
    else assert.match(y.request.prompt, /material-appearance-only-ignore-scene-layout/);
    assert.doesNotMatch(y.request.prompt, /pale green|mossy stone|hand-painted style ONLY/);
  }
});

test('no design acceptance, no reference compute, no source compute; wrong digest and replay fail before dispatch', async t => {
  const { root, workflow } = setup(t), calls = [];
  await assert.rejects(pipeline.runScenePipeline(root, double(calls)));
  let status = design(root);
  rejects(() => pipeline.authorizePipelineStage(root, decision('wrong.compute', 'f'.repeat(64), 'approve-compute')), 'PIPELINE_COMPUTE_TARGET');
  await assert.rejects(pipeline.runScenePipeline(root, double(calls)));
  pipeline.authorizePipelineStage(root, decision('ref.compute', status.reference.planSha256, 'approve-compute'));
  rejects(() => pipeline.authorizePipelineStage(root, decision('ref.again', status.reference.planSha256, 'approve-compute')), 'PIPELINE_COMPUTE_TARGET');
  status = await pipeline.runScenePipeline(root, double(calls)); assert.equal(calls.length, 1);
  assert.equal(status.sourceBatches.length, 0);
  assert.equal(flow.inspectWorkflow(workflow).plans.length, 1);
});

test('unknown source outcome is terminal, retains remaining authorization, and never resubmits', async t => {
  const { root } = setup(t), status = await reference(root), calls = [];
  pipeline.authorizePipelineStage(root, decision('sources.compute', status.sourceBatches[0], 'approve-compute'));
  const stopped = await pipeline.runScenePipeline(root, double(calls, 2));
  assert.equal(stopped.stage, 'attention-required'); assert.equal(calls.length, 2);
  assert.equal(stopped.sources[0].status, 'pending-visual-review'); assert.equal(stopped.sources[1].status, 'indeterminate');
  assert.ok(stopped.sources.slice(2).every(item => item.status === 'authorized'));
  await assert.rejects(pipeline.runScenePipeline(root, double(calls)));
  assert.equal(calls.length, 2);
  const next = pipeline.revisePipelineSources(root, { batchId: 'sources.explicit.r2', replacements: [{ slot: 'sky', planId: 'sky.explicit.r2', intent: 'Operator explicitly requested a new attempt after the lost response.' }] });
  assert.equal(next.stage, 'awaiting-source-compute'); assert.notEqual(next.activeSourceBatchSha256, stopped.activeSourceBatchSha256);
  assert.equal(flow.inspectWorkflow(join(root, 'workflow')).plans.find(plan => plan.planSha256 === stopped.sources[1].planSha256).status, 'indeterminate');
  pipeline.authorizePipelineStage(root, decision('sources.r2.compute', next.activeSourceBatchSha256, 'approve-compute'));
  const completed = await pipeline.runScenePipeline(root, double(calls)); assert.equal(completed.stage, 'ready-to-assemble');
  assert.equal(calls.length, 12, 'only the revised sky and nine undispatched original requests, never the completed material');
  assert.equal(calls.filter(call => call.planSha256 === stopped.sources[1].planSha256).length, 1, 'unknown parent never resubmits');
});

test('technical failure keeps exact raw bytes; does not repair margins, generate again, or assemble an incomplete pack', async t => {
  const { root, workflow, parent } = setup(t), status = await reference(root), calls = [];
  pipeline.authorizePipelineStage(root, decision('sources.compute', status.sourceBatches[0], 'approve-compute'));
  const bad = Buffer.from('synthetic malformed PNG');
  const stopped = await pipeline.runScenePipeline(root, { async preflight() {}, async generate(input) { calls.push(input); return bad; } });
  assert.equal(calls.length, 1); assert.equal(stopped.sources[0].status, 'rejected-technical');
  assert.deepEqual(flow.getGenerationResult(workflow, stopped.sources[0].planSha256).bytes, bad);
  rejects(() => pipeline.deliverScenePipeline(root, join(parent, 'invalid')), 'PIPELINE_SOURCES_INCOMPLETE');
});

test('Codex adapter routes opaque text, opaque reference and transparency before dispatch, preserves prompt/bytes, has no fallback', async () => {
  const calls = [], factory = label => options => ({ async preflight() {}, async generate(input) {
    calls.push({ label, options, input }); if (input.prompt === 'fail') throw new Error('synthetic'); return fixture();
  } });
  const adapter = await createSceneCodexAdapter({ workspace: 'local-test', nativeFactory: factory('native'), relayFactory: factory('relay') });
  const image = { role: 'accepted-scene-reference', artifact: { sha256: hash(fixture()) }, bytes: fixture() };
  for (const [alpha, images] of [['opaque', []], ['opaque', [image]], ['transparent', [image]]])
    await adapter.generate({ request: { prompt: 'frozen', output: { alpha } }, images, requestSha256: 'a'.repeat(64), attemptSha256: 'b'.repeat(64) });
  assert.deepEqual(calls.map(call => [call.label, call.options.transparentBackground]), [['native', undefined], ['relay', false], ['relay', true]]);
  assert.ok(calls.every(call => call.input.prompt === 'frozen'));
  await assert.rejects(adapter.generate({ request: { prompt: 'fail', output: { alpha: 'transparent' } }, images: [image] }));
  assert.equal(calls.length, 4);
});

test('CLI init/inspect are offline; invalid arguments fail without spawning a provider', t => {
  const parent = mkdtempSync(join(tmpdir(), 'scene-cli-')); t.after(() => rmSync(parent, { recursive: true, force: true }));
  const input = join(parent, 'brief.json'), root = join(parent, 'project'); writeFileSync(input, jsonBytes(brief()));
  const script = new URL('../scripts/pipeline.mjs', import.meta.url);
  const invoke = args => JSON.parse(execFileSync(process.execPath, [fileURLToPath(script), ...args], { encoding: 'utf8', windowsHide: true }));
  assert.equal(invoke(['init', '--brief', input, '--out', root]).stage, 'awaiting-design-review');
  assert.equal(invoke(['inspect', '--root', root]).eventCount, 3);
  assert.equal(readdirSync(join(root, 'workflow/events')).length, 3);
  const status = design(root), workflow = join(root, 'workflow');
  pipeline.authorizePipelineStage(root, decision('cli.compute', status.reference.planSha256, 'approve-compute'));
  const { request: _request, ...ticket } = flow.reservePlan(workflow, status.reference.planSha256);
  flow.recordSubmission(workflow, ticket);
  assert.deepEqual(flow.getPendingGenerationTicket(workflow, status.reference.planSha256), ticket);
  const stopped = invoke(['stop-unknown', '--root', root, '--plan', status.reference.planSha256]);
  assert.equal(stopped.reference.status, 'indeterminate'); assert.equal(stopped.stage, 'attention-required');
  rejects(() => flow.getPendingGenerationTicket(workflow, status.reference.planSha256), 'ATTEMPT_NOT_PENDING');
});

test('interactive entry pauses at design, reference compute, exact-image review and source-batch compute; declined confirmation can resume', { timeout: 30000 }, async t => {
  const { root, parent } = setup(t), calls = [], shown = [], answers = ['accept', 'approve', 'accept', 'stop'];
  let questions = 0;
  const status = await runInteractiveScenePipeline(root, join(parent, 'delivery'), { adapter: double(calls),
    ask: async () => { questions++; return answers.shift(); }, show: event => shown.push(event.type) });
  assert.equal(questions, 4); assert.equal(calls.length, 1); assert.equal(status.stage, 'awaiting-source-compute');
  assert.ok(shown.includes('reference')); assert.ok(shown.includes('compute')); assert.ok(shown.includes('reference-layers'));
  const next = await runInteractiveScenePipeline(root, join(parent, 'delivery'), { adapter: double(calls), ask: async () => 'stop' });
  assert.equal(next.eventCount, status.eventCount); assert.equal(calls.length, 1);
});

test('setup failure spends no attempt, concurrent runs dispatch a single reference, explicit rejected-reference revision requires new compute', async t => {
  const { root, workflow } = setup(t); let status = design(root);
  pipeline.authorizePipelineStage(root, decision('ref.compute', status.reference.planSha256, 'approve-compute'));
  const count = flow.inspectWorkflow(workflow).eventCount;
  await assert.rejects(pipeline.runScenePipeline(root, { async preflight() { throw new Error('synthetic setup missing'); }, async generate() { assert.fail('not called'); } }));
  assert.equal(flow.inspectWorkflow(workflow).eventCount, count);
  let release, started; const gate = new Promise(resolve => { release = resolve; }), entered = new Promise(resolve => { started = resolve; });
  let calls = 0;
  const pending = pipeline.runScenePipeline(root, { async preflight() {}, async generate() { calls++; started(); await gate; return fixture(); } });
  await entered; await assert.rejects(pipeline.runScenePipeline(root, double([])));
  release(); status = await pending; assert.equal(calls, 1);
  pipeline.reviewPipelineImage(root, status.reference.planSha256, decision('ref.reject', status.reference.rawSha256, 'reject'));
  const next = pipeline.revisePipelineReference(root, { planId: 'reference.explicit.r2', intent: 'Operator requests flatter ground and simpler texture.' });
  assert.equal(next.stage, 'awaiting-reference-compute');
  assert.notEqual(next.reference.planSha256, status.reference.planSha256);
  assert.equal(flow.inspectWorkflow(workflow).plans[0].status, 'rejected-visual');
});

test('design review is atomic when the second receipt is invalid; empty/custom-without-anchor briefs are rejected', t => {
  const { root, parent } = setup(t), status = pipeline.inspectScenePipeline(root);
  rejects(() => pipeline.reviewPipelineDesign(root, { spec: decision('design.spec', status.design.specSha256),
    style: { ...decision('design.style', status.design.styleSha256), decision: 'invented' } }), 'DECISION_INVALID');
  assert.equal(pipeline.inspectScenePipeline(root).eventCount, status.eventCount);
  rejects(() => pipeline.initScenePipeline(join(parent, 'empty'), brief('empty', '')), 'SCENE_INPUT_REQUIRED');
  rejects(() => pipeline.initScenePipeline(join(parent, 'custom'), { ...brief(), style: { mode: 'custom', preset: null, name: 'Custom', rules: [], anchorPath: null } }), 'PIPELINE_STYLE');
});

test('changing the layered draft and rebinding its project cannot silently replace an already frozen composition', t => {
  const { root } = setup(t); design(root);
  const layerFile = join(root, 'layers-draft.json'), projectFile = join(root, 'project.json');
  const layerBytes = readFileSync(layerFile), projectBytes = readFileSync(projectFile), original = JSON.parse(layerBytes);
  const contents = Object.fromEntries(original.layers.map(layer => [layer.layerId, layer.content]));
  const changed = makeSceneLayerDesign({ ...contents, foreground: 'A different closest-camera silhouette.' });
  const { sha256: _old, ...project } = JSON.parse(projectBytes);
  writeFileSync(layerFile, jsonBytes(changed)); writeFileSync(projectFile, jsonBytes(seal({ ...project, layerDesignSha256: changed.sha256 })));
  rejects(() => pipeline.inspectScenePipeline(root), 'PIPELINE_LAYER_DESIGN_CHANGED');
  writeFileSync(layerFile, layerBytes); writeFileSync(projectFile, projectBytes);
  assert.equal(pipeline.inspectScenePipeline(root).reference.status, 'planned');
});
