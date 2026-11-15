import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as api from '../src/generation/index.mjs';
import { transact } from '../src/generation/store.mjs';
import { replay, applyRecord } from '../src/generation/model.mjs';
import { inspectPng, encodeRgbaPng } from '../src/png.mjs';
import { hash, unseal, seal } from '../src/generation/common.mjs';
import { prepareFiniteEnvironment } from './helpers/finite-environment.mjs';
import { authorizeAndReserve, decision } from './helpers/generation.mjs';

const roles = { foliage: 'foreground-foliage', 'distant-ruins': 'distant-ruins', platform: 'floating-platform-shell' };
const rejects = (fn, code) => assert.throws(fn, error => error.errors?.some(item => item.code === code));
function source(c, key, alpha = 1, name = key) {
  const freeze = key === 'foliage' ? api.freezeEnvironmentSourcePlanV2 : api.freezeEnvironmentSupplementPlan;
  const plan = freeze(c.root, { planId: `source.${name}`, parents: [], referencePlanSha256: c.reference.sha256,
    capabilitiesSha256: c.capabilities.sha256, assetId: `source.${name}`, role: roles[key],
    sourcePolicy: { mode: 'native-environment', orientation: 'landscape', minimumWidth: 256, minimumHeight: 256, maximumWidth: 1024, maximumHeight: 1024 },
    derivation: { pixelSize: { width: 128, height: 64 }, fit: api.ENVIRONMENT_SOURCE_PROFILE.derivation.block, repeatAxis: 'none' }, intent: '' });
  const rgba = Buffer.alloc(512 * 256 * 4); rgba.set([70, 80, 90, alpha], 0); rgba.set([80, 90, 30, 0], 16);
  for (let y = 32; y < 224; y++) for (let x = 32; x < 480; x++) rgba.set([x % 80, 120, 70, y % 2 ? 127 : 255], (y * 512 + x) * 4);
  const raw = encodeRgbaPng(512, 256, rgba), result = api.receiveResult(c.root, authorizeAndReserve(c.root, plan), raw);
  assert.deepEqual(result.technical.issues, ['ENVIRONMENT_ALPHA_MARGIN']);
  return { plan, raw, result };
}
const options = (key, plan) => ({ batchSha256: hash('synthetic.supplement.batch'), items: [{ key, sourcePlanSha256: plan.sha256 }] });

for (const key of Object.keys(roles)) test(`approved ${key} preparation preserves all original pixels and old rejection, derives v2 proof without compute`, t => {
  const c = prepareFiniteEnvironment(t), s = source(c, key), before = api.inspectWorkflow(c.root);
  const proposal = api.proposeSupplementPadding(c.root, options(key, s.plan));
  assert.deepEqual(api.inspectWorkflow(c.root), before); assert.equal(proposal.items[0].edgeMaximumAlpha, 1);
  assert.equal(proposal.items[0].edgePixels, 1); assert.equal(proposal.actualPreparations, 0);
  const input = { preparationId: `prepared.${key}`, sourcePlanSha256: s.plan.sha256, approvalSha256: hash('missing') };
  rejects(() => api.prepareSupplementPadding(c.root, input), 'ENVIRONMENT_PADDING_APPROVAL_REQUIRED');
  const approval = api.approveSupplementPadding(c.root, proposal, decision(`approval.${key}`, proposal.sha256));
  const prepared = api.prepareSupplementPadding(c.root, { ...input, approvalSha256: approval.sha256 });
  assert.equal(prepared.format, 'ai_scene_environment_preparation_v2'); assert.equal(prepared.request.maximumCalls, 0);
  assert.equal(prepared.sourcePlanFormat, s.plan.format); assert.equal(prepared.technical.status, 'pass');
  const original = inspectPng(s.raw, { allowHiddenRgb: true, includePixels: true });
  const bytes = readFileSync(join(c.root, 'blobs', `${prepared.rawSha256}.bin`));
  assert.equal(hash(bytes), proposal.items[0].paddedRawSha256);
  const padded = inspectPng(bytes, { allowHiddenRgb: true, includePixels: true });
  for (let y = 0; y < padded.height; y++) for (let x = 0; x < padded.width; x++) {
    const pixel = padded.rgba.subarray((y * padded.width + x) * 4, (y * padded.width + x + 1) * 4);
    assert.deepEqual(pixel, x >= 2 && y >= 2 && x < padded.width - 2 && y < padded.height - 2
      ? original.rgba.subarray(((y - 2) * original.width + x - 2) * 4, ((y - 2) * original.width + x - 1) * 4) : Buffer.alloc(4));
  }
  assert.deepEqual(readFileSync(join(c.root, 'blobs', `${s.result.rawSha256}.bin`)), s.raw);
  assert.equal(api.recheckResult(c.root, prepared.sha256, prepared.rawSha256).sha256, prepared.technical.sha256);
  const states = api.inspectWorkflow(c.root).plans;
  assert.equal(states.find(p => p.planSha256 === s.plan.sha256).status, 'rejected-technical');
  assert.equal(states.at(-1).status, 'pending-visual-review');
  const proof = join(c.parent, `proof-${key}`); api.buildEnvironmentProofBundle(c.root, prepared.sha256, proof);
  assert.equal(api.verifyEnvironmentProofBundle(c.root, prepared.sha256, proof).status, 'deterministic-proof-valid');
  rejects(() => api.prepareSupplementPadding(c.root, { ...input, approvalSha256: approval.sha256, preparationId: 'duplicate' }), 'ENVIRONMENT_PREPARATION_EXISTS');
  rejects(() => api.prepareEnvironmentPadding(c.root, { ...input, approvalSha256: approval.sha256 }), 'ENVIRONMENT_PADDING_APPROVAL_REQUIRED');
  rejects(() => api.authorizePlan(c.root, prepared.sha256, decision('no.compute', prepared.sha256, 'approve-compute')), 'AUTHORIZATION_STATE');
});

test('supplement padding refuses real cutoffs, water and role substitutions without changing workflow', t => {
  const c = prepareFiniteEnvironment(t);
  for (const alpha of [2, 253]) {
    const s = source(c, 'foliage', alpha, `edge.${alpha}`);
    rejects(() => api.proposeSupplementPadding(c.root, options('foliage', s.plan)), 'ENVIRONMENT_PADDING_VISIBLE_EDGE');
  }
  const s = source(c, 'platform'), before = api.inspectWorkflow(c.root);
  for (const key of ['water', 'foliage', 'trees']) assert.throws(() => api.proposeSupplementPadding(c.root, options(key, s.plan)));
  assert.deepEqual(api.inspectWorkflow(c.root), before);
});

test('forged pixels, wrong approval target and source-format or QA substitutions cannot pass replay', t => {
  const c = prepareFiniteEnvironment(t), s = source(c, 'platform'), proposal = api.proposeSupplementPadding(c.root, options('platform', s.plan));
  const fake = structuredClone(unseal(proposal)); fake.items[0].paddedRawSha256 = hash('forged'); const forged = seal(fake);
  rejects(() => api.approveSupplementPadding(c.root, forged, decision('forged', forged.sha256)), 'ENVIRONMENT_PADDING_PROPOSAL_MISMATCH');
  rejects(() => api.approveSupplementPadding(c.root, proposal, decision('wrong', hash('wrong'))), 'ENVIRONMENT_PADDING_APPROVAL_STATE');
  const approval = api.approveSupplementPadding(c.root, proposal, decision('approved', proposal.sha256));
  const prepared = api.prepareSupplementPadding(c.root, { preparationId: 'prepared.valid', sourcePlanSha256: s.plan.sha256, approvalSha256: approval.sha256 });
  for (const change of [body => { body.sourcePlanFormat = 'ai_scene_generation_plan_v6'; },
    body => { body.technical = seal({ ...unseal(body.technical), planSha256: prepared.sha256 }); }]) {
    const body = unseal(prepared); change(body);
    rejects(() => transact(c.root, store => applyRecord(store, replay(store), seal(body))), 'ENVIRONMENT_PREPARATION_REPLAY_MISMATCH');
  }
});
