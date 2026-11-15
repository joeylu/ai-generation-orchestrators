import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as api from '../src/generation/index.mjs';
import { applyRecord, replay } from '../src/generation/model.mjs';
import { transact } from '../src/generation/store.mjs';
import { encodeRgbaPng, inspectPng } from '../src/png.mjs';
import { hash, seal, unseal } from '../src/generation/common.mjs';
import { prepareFiniteEnvironment } from './helpers/finite-environment.mjs';
import { authorizeAndReserve, decision, styleDraft } from './helpers/generation.mjs';

const rejects = (fn, code) => assert.throws(fn, error => error.errors?.some(item => item.code === code));
function failedBlock(c, { alpha = 1, planId = 'padding.source', width = 512, maximumWidth = 1024 } = {}) {
  const plan = api.freezeEnvironmentSourcePlanV2(c.root, { planId, parents: [], referencePlanSha256: c.reference.sha256,
    capabilitiesSha256: c.capabilities.sha256, assetId: planId, role: 'tree-group',
    sourcePolicy: { mode: 'native-environment', orientation: 'landscape', minimumWidth: 256, minimumHeight: 256, maximumWidth, maximumHeight: 1024 },
    derivation: { pixelSize: { width: 128, height: 128 }, fit: api.ENVIRONMENT_SOURCE_PROFILE.derivation.block, repeatAxis: 'none' }, intent: '' });
  const rgba = Buffer.alloc(width * 256 * 4);
  rgba.set([60, 90, 30, alpha], 0); rgba.set([99, 88, 77, 0], 16);
  for (let y = 64; y < 220; y++) for (let x = 64; x < width - 64; x++) rgba.set([x % 100, 120, 50, y % 2 ? 127 : 255], (y * width + x) * 4);
  const raw = encodeRgbaPng(width, 256, rgba), result = api.receiveResult(c.root, authorizeAndReserve(c.root, plan), raw);
  assert.deepEqual(result.technical.issues, ['ENVIRONMENT_ALPHA_MARGIN']); return { plan, raw, result };
}
const items = plan => [{ role: 'trees', sourcePlanSha256: plan.sha256 }];
const options = (plan, approval) => ({ preparationId: 'padding.prepared', sourcePlanSha256: plan.sha256, approvalSha256: approval.sha256 });

test('approved padding copies every RGBA byte, preserves rejected evidence, and remains pending art review with zero compute', t => {
  const c = prepareFiniteEnvironment(t), { plan, raw, result } = failedBlock(c), before = api.inspectWorkflow(c.root);
  const proposal = api.proposeEnvironmentPadding(c.root, items(plan));
  assert.deepEqual(api.inspectWorkflow(c.root), before);
  rejects(() => api.prepareEnvironmentPadding(c.root, options(plan, { sha256: hash('missing') })), 'ENVIRONMENT_PADDING_APPROVAL_REQUIRED');
  rejects(() => api.approveEnvironmentPadding(c.root, proposal, decision('wrong.target', hash('wrong'))), 'ENVIRONMENT_PADDING_APPROVAL_STATE');
  const approval = api.approveEnvironmentPadding(c.root, proposal, decision('prep.approved', proposal.sha256));
  const prepared = api.prepareEnvironmentPadding(c.root, options(plan, approval));
  assert.equal(prepared.rawSha256, proposal.plans[0].paddedRawSha256); assert.equal(prepared.technical.status, 'pass');
  assert.equal(prepared.sourceArtAcceptance, 'not-granted'); assert.equal(prepared.request.maximumCalls, 0);
  const original = inspectPng(raw, { allowHiddenRgb: true, includePixels: true });
  const padded = inspectPng(readFileSync(join(c.root, 'blobs', `${prepared.rawSha256}.bin`)), { allowHiddenRgb: true, includePixels: true });
  assert.equal(padded.width, original.width + 4); assert.equal(padded.height, original.height + 4);
  for (let y = 0; y < padded.height; y++) for (let x = 0; x < padded.width; x++) {
    const pixel = padded.rgba.subarray((y * padded.width + x) * 4, (y * padded.width + x + 1) * 4);
    assert.deepEqual(pixel, x >= 2 && y >= 2 && x < padded.width - 2 && y < padded.height - 2
      ? original.rgba.subarray(((y - 2) * original.width + x - 2) * 4, ((y - 2) * original.width + x - 1) * 4) : Buffer.alloc(4));
  }
  assert.deepEqual(readFileSync(join(c.root, 'blobs', `${result.rawSha256}.bin`)), raw);
  const after = api.inspectWorkflow(c.root); assert.equal(after.eventCount, before.eventCount + 2);
  assert.equal(after.plans.find(p => p.planSha256 === plan.sha256).status, 'rejected-technical');
  assert.equal(after.plans.at(-1).status, 'pending-visual-review'); assert.equal(after.plans.at(-1).maximumCalls, 0);
  assert.equal(api.recheckResult(c.root, prepared.sha256, prepared.rawSha256).sha256, prepared.technical.sha256);
  assert.equal(api.recheckResult(c.root, plan.sha256, result.rawSha256).sha256, result.technical.sha256);
  rejects(() => api.prepareEnvironmentPadding(c.root, { ...options(plan, approval), preparationId: 'duplicate.prep' }), 'ENVIRONMENT_PREPARATION_EXISTS');
  rejects(() => api.authorizePlan(c.root, prepared.sha256, decision('no.compute', prepared.sha256, 'approve-compute')), 'AUTHORIZATION_STATE');
  rejects(() => api.reservePlan(c.root, prepared.sha256), 'AUTHORIZATION_REQUIRED');
  rejects(() => api.reviseGenerationPlan(c.root, prepared.sha256, { planId: 'no.revision', capabilitiesSha256: c.capabilities.sha256, intent: '' }), 'REINSPECTION_NOT_GENERATION');
  const output = join(c.parent, 'prepared-proof'); api.buildEnvironmentProofBundle(c.root, prepared.sha256, output);
  assert.equal(api.verifyEnvironmentProofBundle(c.root, prepared.sha256, output).status, 'deterministic-proof-valid');
  const derived = inspectPng(readFileSync(join(output, 'assets/environment.png')), { includePixels: true });
  for (let p = 0; p < derived.rgba.length; p += 4) if (!derived.rgba[p + 3]) assert.deepEqual(derived.rgba.subarray(p, p + 4), Buffer.alloc(4));
});

test('padding cannot conceal a real clipped edge, exceed source dimensions, or use a passing/strip source', t => {
  const c = prepareFiniteEnvironment(t);
  for (const alpha of [2, 253]) {
    const { plan } = failedBlock(c, { alpha, planId: `edge.${alpha}` });
    rejects(() => api.proposeEnvironmentPadding(c.root, items(plan)), 'ENVIRONMENT_PADDING_VISIBLE_EDGE');
  }
  const { plan } = failedBlock(c, { planId: 'size.limit', maximumWidth: 512 });
  rejects(() => api.proposeEnvironmentPadding(c.root, items(plan)), 'ENVIRONMENT_PADDING_SIZE');
  rejects(() => api.proposeEnvironmentPadding(c.root, items(c.plan)), 'ENVIRONMENT_PADDING_SOURCE');
});

test('replay rejects forged proposal, rebound preparation QA, and stale design before any new preparation', t => {
  const c = prepareFiniteEnvironment(t), { plan } = failedBlock(c), proposal = api.proposeEnvironmentPadding(c.root, items(plan));
  const forged = structuredClone(unseal(proposal)); forged.plans[0].paddedRawSha256 = hash('fake');
  rejects(() => api.approveEnvironmentPadding(c.root, seal(forged), decision('forged', seal(forged).sha256)), 'ENVIRONMENT_PADDING_PROPOSAL_MISMATCH');
  const approval = api.approveEnvironmentPadding(c.root, proposal, decision('approved', proposal.sha256));
  const prepared = api.prepareEnvironmentPadding(c.root, options(plan, approval));
  const bad = unseal(prepared); bad.technical = seal({ ...unseal(bad.technical), planSha256: prepared.sha256 });
  rejects(() => transact(c.root, store => applyRecord(store, replay(store), seal(bad))), 'ENVIRONMENT_PREPARATION_REPLAY_MISMATCH');
  const another = failedBlock(c, { planId: 'another.source' }), pending = api.proposeEnvironmentPadding(c.root, items(another.plan));
  const approved = api.approveEnvironmentPadding(c.root, pending, decision('approved.another', pending.sha256));
  const style = api.createDesignDraft(c.root, { ...styleDraft(), styleId: 'changed.style' });
  api.reviewDesign(c.root, 'style', decision('changed.style.accept', style.sha256));
  rejects(() => api.prepareEnvironmentPadding(c.root, { ...options(another.plan, approved), preparationId: 'stale.prep' }), 'PLAN_STALE');
});
