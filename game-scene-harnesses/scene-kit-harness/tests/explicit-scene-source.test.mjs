import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as flow from '../src/generation/index.mjs';
import * as pipeline from '../src/pipeline.mjs';
import { applyRecord, replay } from '../src/generation/model.mjs';
import { transact } from '../src/generation/store.mjs';
import { compileExplicitSceneSource } from '../src/generation/explicit-scene-source.mjs';
import { digest, seal } from '../src/generation/common.mjs';
import { encodeFixturePng } from '../src/png.mjs';
import { decision } from './helpers/generation.mjs';

let opaque, transparent, failed;
function fixture(kind = 'opaque') {
  if (kind === 'opaque' && opaque) return opaque;
  if (kind === 'transparent' && transparent) return transparent;
  if (kind === 'failed' && failed) return failed;
  const width = 1024, height = 576, rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (kind !== 'opaque' && (x < 120 || x > 880 || y < 90 || y > 510)) continue;
    rgba.set([60 + x % 140, 80 + y % 140, 150, 255], (y * width + x) * 4);
  }
  if (kind === 'failed') rgba.set([20, 30, 40, 2], (200 * width) * 4);
  const bytes = encodeFixturePng(width, height, rgba);
  if (kind === 'opaque') opaque = bytes; if (kind === 'transparent') transparent = bytes; if (kind === 'failed') failed = bytes;
  return bytes;
}
const rejects = (fn, code) => assert.throws(fn, error => error.errors?.some(row => row.code === code));
const subjectBrief = { content: 'A compact group of 3 to 5 snowy pine trees and 2 or 3 low snowy boulders, with complete trunks and bases.',
  exclusions: ['mountains', 'castle', 'towers', 'bridge', 'sky', 'distant forest panorama', 'cliffs', 'playable ground', 'floating platforms'] };
function setup(t) {
  const parent = mkdtempSync(join(tmpdir(), 'scene-explicit-')); t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'project'), workflow = join(root, 'workflow');
  pipeline.initScenePipeline(root, { projectId: 'explicit.test', description: 'CASTLE_COMPLETE_LAYOUT_WITH_VALLEY_AND_FLOATING_PLATFORM', inputs: [],
    style: { mode: 'preset', preset: 'clean-handpaint', name: '', rules: [], anchorPath: null } }, { purpose: 'synthetic-simulation' });
  let state = pipeline.inspectScenePipeline(root);
  state = pipeline.reviewPipelineDesign(root, { spec: decision('spec', state.design.specSha256), style: decision('style', state.design.styleSha256) });
  flow.authorizePlan(workflow, state.reference.planSha256, decision('ref.compute', state.reference.planSha256, 'approve-compute'));
  const { request: _ref, ...refTicket } = flow.reservePlan(workflow, state.reference.planSha256);
  const reference = flow.receiveResult(workflow, refTicket, fixture());
  state = pipeline.reviewPipelineImage(root, state.reference.planSha256, decision('ref.art', reference.rawSha256));
  pipeline.authorizePipelineStage(root, decision('sources.compute', state.activeSourceBatchSha256, 'approve-compute'));
  const old = flow.getGenerationPlan(workflow, state.sources[5].planSha256);
  const { request: _source, ...sourceTicket } = flow.reservePlan(workflow, old.sha256);
  assert.equal(flow.receiveResult(workflow, sourceTicket, fixture('failed')).technical.status, 'fail');
  return { parent, root, workflow, old, batchSha256: state.activeSourceBatchSha256 };
}
function replace(workflow, batchSha256, overrides = {}) {
  return flow.reviseSceneSourceBatch(workflow, batchSha256, { batchId: 'sources.explicit.r1', replacements: [{
    slot: 'middle-scenery', planId: 'middle.explicit.r1', intent: 'Only the described tree and boulder group; no camera blur.',
    sourceCompiler: 'explicit-role-v1', subjectBrief, ...overrides }] });
}

test('explicit replacement removes whole-scene context, preserves old requests and authorizations, then assembles a verified candidate', { timeout: 240000 }, async t => {
  const { parent, root, workflow, old, batchSha256 } = setup(t), oldHash = digest(old);
  const before = flow.getSceneSourceBatch(workflow, batchSha256), batch = replace(workflow, batchSha256);
  assert.equal(batch.newImageRequests, 1);
  for (let index = 0; index < 11; index++) if (index !== 5) assert.equal(batch.planSha256s[index], before.planSha256s[index]);
  const plan = flow.getGenerationPlan(workflow, batch.planSha256s[5]);
  assert.equal(plan.format, 'ai_scene_generation_plan_v13');
  assert.deepEqual(plan.recipe.parents, [old.sha256]); assert.deepEqual(plan.recipe.subjectBrief, subjectBrief);
  assert.ok(plan.request.prompt.indexOf(subjectBrief.content) < plan.request.prompt.indexOf('Use the attached accepted reference'));
  assert.match(plan.request.prompt, /Exclude these contents entirely: mountains; castle/);
  assert.match(plan.request.prompt, /at least 10 percent/);
  assert.doesNotMatch(plan.request.prompt, /CASTLE_COMPLETE_LAYOUT|APPEARANCE_THEME_CONTEXT|SCENE_SPEC=|REFERENCE_LAYER_CONTEXT|SOURCE_SCOPE=/);
  assert.deepEqual(plan.request.images, old.request.images); assert.deepEqual(plan.layerBinding, old.layerBinding);
  assert.equal(plan.sourceScope.fullSceneThemeIncluded, false); assert.equal(plan.visualReviewChecklist.automatedSemanticDetection, false);
  assert.equal(digest(flow.getGenerationPlan(workflow, old.sha256)), oldHash);
  const states = flow.inspectWorkflow(workflow);
  assert.equal(states.plans.find(row => row.planSha256 === old.sha256).status, 'rejected-technical');
  assert.equal(states.plans.filter(row => row.status === 'authorized' && !row.reserved).length, 10);
  rejects(() => flow.reservePlan(workflow, plan.sha256), 'AUTHORIZATION_REQUIRED');
  flow.authorizeSceneSourceBatch(workflow, batch.sha256, decision('explicit.compute', batch.sha256, 'approve-compute'));
  const calls = [], done = await pipeline.runScenePipeline(root, { async preflight() {}, async generate(input) {
    calls.push(input.planSha256); return fixture(input.request.output.alpha === 'transparent' ? 'transparent' : 'opaque');
  } });
  assert.equal(calls.length, 11); assert.ok(calls.includes(plan.sha256)); assert.ok(!calls.includes(old.sha256));
  assert.equal(done.stage, 'ready-to-assemble');
  const delivery = pipeline.deliverScenePipeline(root, join(parent, 'delivery'));
  assert.equal(pipeline.verifyPipelineDelivery(root, join(parent, 'delivery')).sha256, delivery.sha256);
  assert.equal(delivery.productionKit, false);
});

test('invalid subject/compiler, nonterminal parent, opaque role and forged prompt append no replacement', t => {
  const { workflow, batchSha256, old } = setup(t), before = flow.inspectWorkflow(workflow);
  rejects(() => replace(workflow, batchSha256, { sourceCompiler: 'guess' }), 'SOURCE_COMPILER');
  rejects(() => replace(workflow, batchSha256, { subjectBrief: { ...subjectBrief, content: 'E:/private/source.png' } }), 'PRIVATE_OPERATIONAL_TEXT');
  rejects(() => replace(workflow, batchSha256, { subjectBrief: { ...subjectBrief, exclusions: [] } }), 'SOURCE_SUBJECT_BRIEF');
  rejects(() => replace(workflow, batchSha256, { subjectBrief: { ...subjectBrief, exclusions: ['castle', 'castle'] } }), 'SOURCE_SUBJECT_BRIEF');
  rejects(() => replace(workflow, batchSha256, { slot: 'foreground' }), 'PLAN_PARENT');
  assert.deepEqual(flow.inspectWorkflow(workflow), before);
  const batch = flow.getSceneSourceBatch(workflow, batchSha256), material = flow.getGenerationPlan(workflow, batch.planSha256s[0]);
  const { request: _req, ...ticket } = flow.reservePlan(workflow, material.sha256); flow.stopAttempt(workflow, ticket, 'indeterminate');
  const terminal = flow.inspectWorkflow(workflow);
  rejects(() => replace(workflow, batchSha256, { slot: 'material' }), 'EXPLICIT_TRANSPARENT_SOURCE_ONLY');
  assert.deepEqual(flow.inspectWorkflow(workflow), terminal);
  const current = flow.inspectWorkflow(workflow);
  transact(workflow, store => {
    const state = replay(store);
    const plan = compileExplicitSceneSource(state, { ...old.recipe, planId: 'forged.explicit', parents: [old.sha256], subjectBrief });
    const { sha256: _sha, ...body } = plan;
    rejects(() => applyRecord(store, state, seal({ ...body, request: { ...body.request, prompt: 'Forged uncompiled prompt.' } })), 'PLAN_RECOMPILE_MISMATCH');
  });
  assert.deepEqual(flow.inspectWorkflow(workflow), current);
});

test('v13 unknown remains terminal and its next revision retains the explicit brief without old authorization', t => {
  const { workflow, batchSha256 } = setup(t), batch = replace(workflow, batchSha256), sha = batch.planSha256s[5];
  flow.authorizeSceneSourceBatch(workflow, batch.sha256, decision('explicit.once', batch.sha256, 'approve-compute'));
  const { request: _req, ...ticket } = flow.reservePlan(workflow, sha); flow.recordSubmission(workflow, ticket); flow.stopAttempt(workflow, ticket, 'indeterminate');
  const source = flow.getGenerationPlan(workflow, sha);
  const next = flow.reviseGenerationPlan(workflow, sha, { planId: 'middle.explicit.r2',
    capabilitiesSha256: source.recipe.capabilitiesSha256, intent: 'Explicit new attempt after the terminal unknown; preserve the same subject.' });
  assert.equal(next.format, 'ai_scene_generation_plan_v13'); assert.deepEqual(next.recipe.subjectBrief, subjectBrief);
  assert.deepEqual(next.recipe.parents, [sha]);
  assert.equal(flow.inspectWorkflow(workflow).plans.find(row => row.planSha256 === sha).status, 'indeterminate');
  rejects(() => flow.reservePlan(workflow, next.sha256), 'AUTHORIZATION_REQUIRED');
});
