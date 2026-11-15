import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as flow from '../src/generation/index.mjs';
import * as pipeline from '../src/pipeline.mjs';
import { encodeFixturePng, inspectPng } from '../src/png.mjs';
import { hash, seal } from '../src/generation/common.mjs';
import { decision } from './helpers/generation.mjs';

let opaque, transparent;
function fixture(alpha = null) {
  if (alpha === null && opaque) return opaque;
  if (alpha === 0 && transparent) return transparent;
  const width = 1024, height = 576, rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (alpha !== null && (x < 100 || x > 900 || y < 80 || y > 530)) continue;
    rgba.set([70 + x % 100, 90 + y % 100, 150, 255], (y * width + x) * 4);
  }
  if (alpha) { rgba.set([20, 40, 60, alpha], (200 * width) * 4); rgba.set([30, 40, 50, 0], (201 * width + 1) * 4); }
  const bytes = encodeFixturePng(width, height, rgba); if (alpha === null) opaque = bytes; if (alpha === 0) transparent = bytes; return bytes;
}
const rejects = (fn, code) => assert.throws(fn, error => error.errors?.some(issue => issue.code === code));
function setup(t) {
  const parent = mkdtempSync(join(tmpdir(), 'scene-native-border-')); t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'project'), workflow = join(root, 'workflow');
  pipeline.initScenePipeline(root, { projectId: 'border.test', description: 'Synthetic side-view scenery.', inputs: [],
    style: { mode: 'preset', preset: 'clean-handpaint', name: '', rules: [], anchorPath: null } }, { purpose: 'synthetic-simulation' });
  let state = pipeline.inspectScenePipeline(root);
  state = pipeline.reviewPipelineDesign(root, { spec: decision('spec', state.design.specSha256), style: decision('style', state.design.styleSha256) });
  flow.authorizePlan(workflow, state.reference.planSha256, decision('ref.compute', state.reference.planSha256, 'approve-compute'));
  const { request: _ref, ...ticket } = flow.reservePlan(workflow, state.reference.planSha256);
  const result = flow.receiveResult(workflow, ticket, fixture());
  state = pipeline.reviewPipelineImage(root, state.reference.planSha256, decision('ref.art', result.rawSha256));
  pipeline.authorizePipelineStage(root, decision('sources.compute', state.activeSourceBatchSha256, 'approve-compute'));
  const far = state.sources[2].planSha256, { request: _far, ...sourceTicket } = flow.reservePlan(workflow, far);
  assert.deepEqual(flow.receiveResult(workflow, sourceTicket, fixture(1)).technical.issues, ['ENVIRONMENT_ALPHA_MARGIN']);
  const ids = state.sources.slice(2).map(source => source.planSha256);
  const proposal = flow.proposeNativeBorderPolicy(workflow, state.activeSourceBatchSha256, ids);
  return { parent, root, workflow, far, ids, proposal, batchSha256: state.activeSourceBatchSha256 };
}

test('approved batch rule preserves every original RGBA, failed evidence and visual gate, then exports a complete candidate', { timeout: 180000 }, async t => {
  const { parent, root, workflow, far, proposal, batchSha256 } = setup(t);
  rejects(() => flow.prepareNativeBorderSource(workflow, { preparationId: 'no.approval', approvalSha256: 'a'.repeat(64), sourcePlanSha256: far }), 'NATIVE_BORDER_APPROVAL_REQUIRED');
  const approval = flow.approveNativeBorderPolicy(workflow, proposal, decision('border.approve', proposal.sha256));
  const prepared = flow.prepareNativeBorderSource(workflow, { preparationId: 'far.prepared', approvalSha256: approval.sha256, sourcePlanSha256: far });
  const original = inspectPng(fixture(1), { allowHiddenRgb: true, includePixels: true });
  const output = flow.getGenerationResult(workflow, prepared.sha256), padded = inspectPng(output.bytes, { allowHiddenRgb: true, includePixels: true });
  assert.equal(padded.width, original.width + 4); assert.equal(padded.height, original.height + 4);
  for (let y = 0; y < original.height; y++) assert.deepEqual(padded.rgba.subarray(((y + 2) * padded.width + 2) * 4,
    ((y + 2) * padded.width + 2 + original.width) * 4), original.rgba.subarray(y * original.width * 4, (y + 1) * original.width * 4));
  assert.equal(flow.getGenerationResult(workflow, far).status, 'rejected-technical');
  assert.equal(output.status, 'pending-visual-review');
  assert.equal(flow.recheckResult(workflow, prepared.sha256, hash(output.bytes)).status, 'pass');
  const batch = flow.adoptPreparedSource(workflow, batchSha256, prepared.sha256, 'sources.prepared');
  assert.equal(batch.newImageRequests, 0);
  const calls = [];
  const done = await pipeline.runScenePipeline(root, { async preflight() {}, async generate(input) {
    calls.push(input.planSha256); return fixture(input.request.output.alpha === 'transparent' ? 0 : null);
  } });
  assert.equal(calls.length, 10); assert.ok(!calls.includes(far)); assert.equal(done.stage, 'ready-to-assemble');
  const delivery = pipeline.deliverScenePipeline(root, join(parent, 'delivery'));
  assert.equal(pipeline.verifyPipelineDelivery(root, join(parent, 'delivery')).sha256, delivery.sha256);
  assert.equal(delivery.productionKit, false);
});

test('one policy explicitly covers matching future sources but rejects alpha 2, out-of-scope sources and duplicate preparation', t => {
  const { workflow, far, ids, proposal } = setup(t);
  const approval = flow.approveNativeBorderPolicy(workflow, proposal, decision('policy.approve', proposal.sha256));
  const prepare = (sourcePlanSha256, preparationId) => flow.prepareNativeBorderSource(workflow, { sourcePlanSha256, preparationId, approvalSha256: approval.sha256 });
  prepare(far, 'far.once');
  rejects(() => prepare(far, 'far.again'), 'NATIVE_BORDER_EXISTS');
  const { request: _first, ...first } = flow.reservePlan(workflow, ids[1]); flow.receiveResult(workflow, first, fixture(1));
  assert.equal(prepare(ids[1], 'future.matching').technical.status, 'pass');
  const { request: _second, ...second } = flow.reservePlan(workflow, ids[2]); flow.receiveResult(workflow, second, fixture(2));
  const before = flow.inspectWorkflow(workflow).eventCount;
  rejects(() => prepare(ids[2], 'visible.edge'), 'ENVIRONMENT_PADDING_VISIBLE_EDGE');
  const material = flow.inspectWorkflow(workflow).plans.find(plan => plan.planId.endsWith('.material'));
  rejects(() => prepare(material.planSha256, 'outside.scope'), 'NATIVE_BORDER_APPROVAL_REQUIRED');
  assert.equal(flow.inspectWorkflow(workflow).eventCount, before);
});

test('rebound policy cannot weaken alpha threshold or reuse an approval decision', t => {
  const { workflow, proposal } = setup(t), { sha256: _old, ...body } = proposal;
  const changed = seal({ ...body, rule: { ...body.rule, maximumMarginAlpha: 2 } });
  const before = flow.inspectWorkflow(workflow).eventCount;
  rejects(() => flow.approveNativeBorderPolicy(workflow, changed, decision('forged.policy', changed.sha256)), 'NATIVE_BORDER_POLICY_REPLAY');
  assert.equal(flow.inspectWorkflow(workflow).eventCount, before);
  flow.approveNativeBorderPolicy(workflow, proposal, decision('correct.policy', proposal.sha256));
  rejects(() => flow.approveNativeBorderPolicy(workflow, proposal, decision('other.decision', proposal.sha256)), 'NATIVE_BORDER_APPROVAL_STATE');
});

test('explicit subset policy needs its own approval and preserves an already prepared source and all unused authorizations', t => {
  const { workflow, far, ids, proposal, batchSha256 } = setup(t);
  const firstApproval = flow.approveNativeBorderPolicy(workflow, proposal, decision('whole.policy', proposal.sha256));
  const firstPrepared = flow.prepareNativeBorderSource(workflow, { preparationId: 'first.prepared', approvalSha256: firstApproval.sha256, sourcePlanSha256: far });
  const firstBatch = flow.adoptPreparedSource(workflow, batchSha256, firstPrepared.sha256, 'batch.with.preparation');
  const oldNext = ids[1], { request: _oldReq, ...oldTicket } = flow.reservePlan(workflow, oldNext);
  flow.receiveResult(workflow, oldTicket, fixture(1));
  const batch = flow.reviseSceneSourceBatch(workflow, firstBatch.sha256, { batchId: 'batch.with.explicit.source', replacements: [{
    slot: 'distant-scenery', planId: 'subset.new.source', sourceCompiler: 'explicit-role-v1',
    subjectBrief: { content: 'One isolated synthetic tree group.', exclusions: ['castle', 'playable ground'] },
    intent: 'Synthetic revision, not a real image request.' }] });
  flow.authorizeSceneSourceBatch(workflow, batch.sha256, decision('new.source.compute', batch.sha256, 'approve-compute'));
  const next = batch.planSha256s[3], { request: _req, ...ticket } = flow.reservePlan(workflow, next);
  flow.receiveResult(workflow, ticket, fixture(1));
  rejects(() => flow.prepareNativeBorderSource(workflow, { preparationId: 'old.policy.excluded', approvalSha256: firstApproval.sha256, sourcePlanSha256: next }), 'NATIVE_BORDER_APPROVAL_REQUIRED');
  const before = flow.inspectWorkflow(workflow);
  rejects(() => flow.proposeNativeBorderPolicy(workflow, batch.sha256, [next]), 'NATIVE_BORDER_POLICY_SCOPE');
  const subset = flow.proposeNativeBorderSubsetPolicy(workflow, batch.sha256, [next]);
  assert.equal(subset.format, 'ai_scene_native_border_policy_proposal_v2'); assert.equal(subset.scope, 'listed-sources-only');
  assert.deepEqual(subset.sourcePlanSha256s, [next]); assert.equal(subset.maximumNewImageCalls, 0);
  assert.deepEqual(flow.inspectWorkflow(workflow), before);
  rejects(() => flow.prepareNativeBorderSource(workflow, { preparationId: 'without.fresh.approval', approvalSha256: subset.sha256, sourcePlanSha256: next }), 'NATIVE_BORDER_APPROVAL_REQUIRED');
  const approval = flow.approveNativeBorderPolicy(workflow, subset, decision('subset.user', subset.sha256));
  rejects(() => flow.prepareNativeBorderSource(workflow, { preparationId: 'outside.subset', approvalSha256: approval.sha256, sourcePlanSha256: ids[2] }), 'NATIVE_BORDER_APPROVAL_REQUIRED');
  const prepared = flow.prepareNativeBorderSource(workflow, { preparationId: 'subset.prepared', approvalSha256: approval.sha256, sourcePlanSha256: next });
  const adopted = flow.adoptPreparedSource(workflow, batch.sha256, prepared.sha256, 'batch.subset.prepared');
  assert.equal(adopted.planSha256s[2], firstPrepared.sha256); assert.equal(adopted.planSha256s[3], prepared.sha256);
  for (let index = 4; index < 11; index++) assert.equal(adopted.planSha256s[index], batch.planSha256s[index]);
  assert.equal(flow.getGenerationResult(workflow, next).status, 'rejected-technical');
  assert.equal(flow.getGenerationResult(workflow, prepared.sha256).status, 'pending-visual-review');
  assert.equal(flow.inspectWorkflow(workflow).plans.filter(p => p.status === 'authorized' && !p.reserved).length, 9);
});

function futureSetup(t) {
  const context = setup(t), { workflow, proposal, far, batchSha256 } = context;
  const oldApproval = flow.approveNativeBorderPolicy(workflow, proposal, decision('example.policy', proposal.sha256));
  const example = flow.prepareNativeBorderSource(workflow, { preparationId: 'future.example', approvalSha256: oldApproval.sha256, sourcePlanSha256: far });
  const withExample = flow.adoptPreparedSource(workflow, batchSha256, example.sha256, 'batch.future.example');
  const oldForeground = withExample.planSha256s[8], { request: _req, ...ticket } = flow.reservePlan(workflow, oldForeground);
  flow.receiveResult(workflow, ticket, fixture(2));
  const batch = flow.reviseSceneSourceBatch(workflow, withExample.sha256, { batchId: 'batch.future.foreground', replacements: [{
    slot: 'foreground', planId: 'future.foreground', sourceCompiler: 'explicit-role-v1',
    subjectBrief: { content: 'Two complete small snowy rock and shrub groups inside the canvas.', exclusions: ['cropped edges', 'castle'] },
    intent: 'Synthetic complete foreground subject.' }] });
  const next = batch.planSha256s[8], options = { batchSha256: batch.sha256, sourcePlanSha256s: [next], examplePreparationSha256: example.sha256 };
  return { ...context, oldApproval, example, batch, next, options };
}

test('a future rule can be reviewed with a proven pixel example but cannot authorize compute or inherit old source approval', t => {
  const { workflow, oldApproval, example, batch, next, options } = futureSetup(t), before = flow.inspectWorkflow(workflow);
  const proposal = flow.proposeNativeBorderFuturePolicy(workflow, options);
  assert.equal(proposal.format, 'ai_scene_native_border_policy_proposal_v3');
  assert.deepEqual(proposal.sourcePlanSha256s, [next]); assert.equal(proposal.examplePreparationSha256, example.sha256);
  assert.equal(proposal.maximumNewImageCalls, 0); assert.deepEqual(flow.inspectWorkflow(workflow), before);
  rejects(() => flow.prepareNativeBorderSource(workflow, { preparationId: 'unapproved.future', approvalSha256: proposal.sha256, sourcePlanSha256: next }), 'NATIVE_BORDER_APPROVAL_REQUIRED');
  const approval = flow.approveNativeBorderPolicy(workflow, proposal, decision('future.rule.user', proposal.sha256));
  rejects(() => flow.reservePlan(workflow, next), 'AUTHORIZATION_REQUIRED');
  flow.authorizeSceneSourceBatch(workflow, batch.sha256, decision('future.compute.user', batch.sha256, 'approve-compute'));
  const { request: _req, ...ticket } = flow.reservePlan(workflow, next); flow.receiveResult(workflow, ticket, fixture(1));
  rejects(() => flow.prepareNativeBorderSource(workflow, { preparationId: 'old.policy.invalid', approvalSha256: oldApproval.sha256, sourcePlanSha256: next }), 'NATIVE_BORDER_APPROVAL_REQUIRED');
  const prepared = flow.prepareNativeBorderSource(workflow, { preparationId: 'future.actual', approvalSha256: approval.sha256, sourcePlanSha256: next });
  assert.equal(prepared.technical.status, 'pass');
  const adopted = flow.adoptPreparedSource(workflow, batch.sha256, prepared.sha256, 'batch.future.actual');
  assert.equal(adopted.newImageRequests, 0); assert.equal(adopted.planSha256s[2], example.sha256);
  for (let index = 0; index < 11; index++) if (index !== 8) assert.equal(adopted.planSha256s[index], batch.planSha256s[index]);
  assert.equal(flow.getGenerationResult(workflow, next).status, 'rejected-technical');
  assert.equal(flow.getGenerationResult(workflow, prepared.sha256).status, 'pending-visual-review');
});

test('future policy rejects unprepared examples, foreign/opaque scope, forged thresholds, dispatched targets and alpha above one', t => {
  const { workflow, far, batch, next, options } = futureSetup(t), before = flow.inspectWorkflow(workflow);
  rejects(() => flow.proposeNativeBorderFuturePolicy(workflow, { ...options, examplePreparationSha256: far }), 'NATIVE_BORDER_FUTURE_EXAMPLE');
  rejects(() => flow.proposeNativeBorderFuturePolicy(workflow, { ...options, sourcePlanSha256s: ['a'.repeat(64)] }), 'NATIVE_BORDER_FUTURE_SCOPE');
  rejects(() => flow.proposeNativeBorderFuturePolicy(workflow, { ...options, sourcePlanSha256s: [batch.planSha256s[0]] }), 'NATIVE_BORDER_FUTURE_SOURCE');
  assert.deepEqual(flow.inspectWorkflow(workflow), before);
  const proposal = flow.proposeNativeBorderFuturePolicy(workflow, options), { sha256: _sha, ...body } = proposal;
  const forged = seal({ ...body, rule: { ...body.rule, maximumMarginAlpha: 255 } });
  rejects(() => flow.approveNativeBorderPolicy(workflow, forged, decision('future.forged', forged.sha256)), 'NATIVE_BORDER_POLICY_REPLAY');
  const approval = flow.approveNativeBorderPolicy(workflow, proposal, decision('future.safe.user', proposal.sha256));
  flow.authorizeSceneSourceBatch(workflow, batch.sha256, decision('future.safe.compute', batch.sha256, 'approve-compute'));
  const { request: _req, ...ticket } = flow.reservePlan(workflow, next);
  rejects(() => flow.proposeNativeBorderFuturePolicy(workflow, options), 'NATIVE_BORDER_FUTURE_SOURCE');
  flow.receiveResult(workflow, ticket, fixture(2));
  const count = flow.inspectWorkflow(workflow).eventCount;
  rejects(() => flow.prepareNativeBorderSource(workflow, { preparationId: 'future.too.strong', approvalSha256: approval.sha256, sourcePlanSha256: next }), 'ENVIRONMENT_PADDING_VISIBLE_EDGE');
  assert.equal(flow.inspectWorkflow(workflow).eventCount, count);
});
