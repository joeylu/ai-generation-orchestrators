import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as flow from '../src/generation/index.mjs';
import * as pipeline from '../src/pipeline.mjs';
import { encodeFixturePng } from '../src/png.mjs';
import { hash, digest, jsonBytes, seal } from '../src/generation/common.mjs';
import { inspectSceneCodexRecovery } from '../adapters/codex.mjs';
import { relayCode, argumentsDigest } from '../../../game-ui-harnesses/ui-reference-harness/web/adapters/codex-relay-contract.mjs';
import { decision } from './helpers/generation.mjs';

const rejects = (fn, code) => assert.throws(fn, error => error.errors?.some(issue => issue.code === code));
let opaque, transparent;
function image(alpha = false) {
  if (alpha ? transparent : opaque) return alpha ? transparent : opaque;
  const width = 1024, height = 576, rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (alpha && (x < 100 || x > 900 || y < 70 || y > 530)) continue;
    rgba.set([90 + x % 90, 100 + y % 100, 150, 255], (y * width + x) * 4);
  }
  const bytes = encodeFixturePng(width, height, rgba); if (alpha) transparent = bytes; else opaque = bytes; return bytes;
}
function directory(t) {
  const parent = mkdtempSync(join(tmpdir(), 'scene-recovery-'));
  t.after(() => rmSync(parent, { recursive: true, force: true })); return parent;
}
function interrupted(t) {
  const parent = directory(t), root = join(parent, 'project'), workflow = join(root, 'workflow');
  pipeline.initScenePipeline(root, { projectId: 'recovery.test', description: 'Synthetic snow castle.', inputs: [],
    style: { mode: 'preset', preset: 'clean-handpaint', name: '', rules: [], anchorPath: null } }, { purpose: 'synthetic-simulation' });
  let status = pipeline.inspectScenePipeline(root);
  status = pipeline.reviewPipelineDesign(root, { spec: decision('spec', status.design.specSha256), style: decision('style', status.design.styleSha256) });
  const ref = flow.getGenerationPlan(workflow, status.reference.planSha256);
  flow.authorizePlan(workflow, ref.sha256, decision('ref.compute', ref.sha256, 'approve-compute'));
  const { request: _refRequest, ...refTicket } = flow.reservePlan(workflow, ref.sha256);
  const refResult = flow.receiveResult(workflow, refTicket, image());
  status = pipeline.reviewPipelineImage(root, ref.sha256, decision('ref.art', refResult.rawSha256));
  pipeline.authorizePipelineStage(root, decision('sources.compute', status.activeSourceBatchSha256, 'approve-compute'));
  const { request: _materialRequest, ...materialTicket } = flow.reservePlan(workflow, status.sources[0].planSha256);
  flow.receiveResult(workflow, materialTicket, image());
  const sky = flow.getGenerationPlan(workflow, status.sources[1].planSha256);
  const { request: _skyRequest, ...skyTicket } = flow.reservePlan(workflow, sky.sha256);
  flow.recordSubmission(workflow, skyTicket); flow.stopAttempt(workflow, skyTicket, 'indeterminate');
  // Test-double producer evidence, never a real provider invocation.
  const handoff = seal({ format: 'ai_scene_completed_image_handoff_v1', sourcePlanSha256: sky.sha256,
    requestSha256: digest(sky.request), rawSha256: hash(image()), byteLength: image().length,
    inputSha256s: sky.request.images.map(item => item.artifact.sha256), observedImageCalls: 1,
    exactArgumentsVerified: true, completedImageVerified: true, originalBytesPreserved: true });
  const proposal = flow.proposeSourceRecovery(workflow, sky.sha256, handoff, image());
  return { parent, root, workflow, sky, handoff, proposal, batchSha256: status.activeSourceBatchSha256 };
}

test('zero-generation recovery preserves unknown parent, uses exact approval, resumes nine old authorizations and exports', { timeout: 180000 }, async t => {
  const { root, parent, workflow, sky, proposal, batchSha256 } = interrupted(t);
  const before = flow.inspectWorkflow(workflow);
  const recovered = flow.registerRecoveredSource(workflow, { recoveryId: 'sky.recovered', proposal,
    receipt: decision('recover.approve', proposal.sha256) }, image());
  const batch = flow.adoptRecoveredSource(workflow, batchSha256, recovered.sha256, 'sources.recovered');
  assert.equal(batch.newImageRequests, 0);
  const status = pipeline.inspectScenePipeline(root);
  assert.equal(status.stage, 'ready-to-generate-sources');
  assert.equal(status.sources.filter(plan => plan.status === 'authorized').length, 9);
  assert.equal(flow.inspectWorkflow(workflow).eventCount, before.eventCount + 2);
  assert.equal(flow.inspectWorkflow(workflow).plans.find(plan => plan.planSha256 === sky.sha256).status, 'indeterminate');
  assert.equal(flow.getGenerationResult(workflow, recovered.sha256).status, 'pending-visual-review');
  assert.equal(flow.recheckResult(workflow, recovered.sha256, hash(image())).status, 'pass');
  rejects(() => flow.authorizePlan(workflow, recovered.sha256, decision('recover.compute', recovered.sha256, 'approve-compute')), 'AUTHORIZATION_STATE');
  rejects(() => flow.reviseGenerationPlan(workflow, recovered.sha256, { planId: 'bad.retry', capabilitiesSha256: sky.recipe.capabilitiesSha256, intent: '' }), 'REINSPECTION_NOT_GENERATION');
  const calls = [];
  const done = await pipeline.runScenePipeline(root, { async preflight() {}, async generate(input) {
    calls.push(input.planSha256); return image(input.request.output.alpha === 'transparent');
  } });
  assert.equal(done.stage, 'ready-to-assemble'); assert.equal(calls.length, 9);
  assert.ok(!calls.includes(sky.sha256) && !calls.includes(recovered.sha256));
  const delivery = pipeline.deliverScenePipeline(root, join(parent, 'delivery'));
  assert.equal(delivery.productionKit, false);
  assert.equal(pipeline.verifyPipelineDelivery(root, join(parent, 'delivery')).sha256, delivery.sha256);
  assert.equal(JSON.parse(readFileSync(join(parent, 'delivery/candidate/readiness.json'))).moduleCount, 1514);
});

test('wrong raw, incomplete producer evidence, stale design, wrong decision and duplicate recovery append no success', t => {
  const { workflow, sky, handoff, proposal } = interrupted(t), before = flow.inspectWorkflow(workflow);
  const { sha256: _old, ...body } = handoff;
  rejects(() => flow.proposeSourceRecovery(workflow, sky.sha256, seal({ ...body, observedImageCalls: 2 }), image()), 'SOURCE_RECOVERY_HANDOFF');
  rejects(() => flow.proposeSourceRecovery(workflow, sky.sha256, seal({ ...body, completedImageVerified: false }), image()), 'SOURCE_RECOVERY_HANDOFF');
  rejects(() => flow.proposeSourceRecovery(workflow, sky.sha256, handoff, image(true)), 'SOURCE_RECOVERY_HANDOFF');
  rejects(() => flow.registerRecoveredSource(workflow, { recoveryId: 'bad.approval', proposal,
    receipt: decision('wrong.target', 'f'.repeat(64)) }, image()), 'SOURCE_RECOVERY_APPROVAL');
  assert.deepEqual(flow.inspectWorkflow(workflow), before);
  flow.registerRecoveredSource(workflow, { recoveryId: 'first.recovery', proposal, receipt: decision('first.approve', proposal.sha256) }, image());
  rejects(() => flow.registerRecoveredSource(workflow, { recoveryId: 'second.recovery', proposal,
    receipt: decision('second.approve', proposal.sha256) }, image()), 'SOURCE_RECOVERY_EXISTS');
  const style = flow.createDesignDraft(workflow, { format: 'ai_scene_style_v1', styleId: 'new.style', mode: 'preset',
    name: 'Changed style', rules: ['Different synthetic light direction.'], anchors: [] });
  flow.reviewDesign(workflow, 'style', decision('changed.style', style.sha256));
  rejects(() => flow.proposeSourceRecovery(workflow, sky.sha256, handoff, image()), 'PLAN_STALE');
});

function transport(t) {
  const root = directory(t), workspace = join(root, 'jobs'), home = join(root, 'home'); mkdirSync(workspace); mkdirSync(home);
  const attempt = 'b'.repeat(64), job = join(workspace, attempt); mkdirSync(job);
  const sessionId = '00000000-0000-0000-0000-000000000001';
  mkdirSync(join(home, 'sessions')); mkdirSync(join(home, 'generated_images')); mkdirSync(join(home, 'generated_images', sessionId));
  const request = { prompt: 'Synthetic sky only.', output: { alpha: 'opaque' }, images: [{ role: 'accepted-scene-reference', artifact: { sha256: hash(image()) } }] };
  const frozen = { kind: 'ui_reference_codex_relay_request_v1', requestSha256: digest(request), attemptSha256: attempt,
    arguments: { prompt: request.prompt, num_last_images_to_include: 1, transparent_background: false },
    images: [{ path: join(job, 'reference-1.png'), sha256: hash(image()), role: 'accepted-scene-reference' }] };
  const write = (name, doc) => writeFileSync(join(job, name), jsonBytes(doc));
  writeFileSync(join(job, 'reference-1.png'), image()); write('relay-request.json', frozen);
  const payloadSha256 = hash(readFileSync(join(job, 'relay-request.json')));
  write('dispatch.json', { attemptSha256: attempt, payloadSha256, requestSha256: digest(request), model: 'test-model', effort: 'high' });
  write('session-result.json', { sessionId, completed: false, exitCode: 1, automaticResubmissions: 0 });
  const identity = { requestSha256: digest(request), attemptSha256: attempt, sessionId, toolUseId: 'arguments' };
  write('arguments-call.json', identity);
  write('arguments-read.json', { requestSha256: digest(request), payloadSha256, argumentsSha256: argumentsDigest(frozen.arguments) });
  write('image-call.json', { ...identity, toolUseId: 'image', argumentsSha256: argumentsDigest(frozen.arguments), transparentBackground: false });
  write('image-post.json', { ...identity, toolUseId: 'image' });
  writeFileSync(join(job, 'original-output-1.png'), image()); writeFileSync(join(home, 'generated_images', sessionId, 'result.png'), image());
  const log = [{ type: 'turn_context', payload: { model: 'test-model', effort: 'high', approval_policy: 'never', sandbox_policy: { type: 'read-only' } } },
    { type: 'response_item', payload: { type: 'custom_tool_call', name: 'functions.exec', input: relayCode } }];
  writeFileSync(join(home, 'sessions', `rollout-${sessionId}.jsonl`), log.map(row => JSON.stringify(row)).join('\n'));
  return { job, options: { workspace, codexHome: home, attemptSha256: attempt, planSha256: 'a'.repeat(64), request } };
}

test('adapter can inspect a completed exact PNG after outer failure without launching or accepting art', async t => {
  const { options } = transport(t), result = await inspectSceneCodexRecovery(options);
  assert.equal(result.handoff.rawSha256, hash(image())); assert.deepEqual(result.bytes, image());
  assert.equal(result.handoff.observedImageCalls, 1); assert.equal(result.handoff.completedImageVerified, true);
  assert.equal(JSON.stringify(result.handoff).includes(options.workspace), false);
  assert.equal(JSON.stringify(result.handoff).includes(options.attemptSha256), false);
});

test('adapter never picks an image from multiple outputs or missing completion evidence', async t => {
  const first = transport(t); writeFileSync(join(first.job, 'original-output-2.png'), image());
  await assert.rejects(inspectSceneCodexRecovery(first.options));
  const second = transport(t); unlinkSync(join(second.job, 'image-post.json'));
  await assert.rejects(inspectSceneCodexRecovery(second.options));
});
