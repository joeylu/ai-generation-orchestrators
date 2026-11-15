import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import * as flow from '../src/generation/index.mjs';
import * as assets from '../src/reference-asset-pipeline.mjs';
import { regionGuideProposalFiles } from '../src/reference-region-guide.mjs';
import { REFERENCE_LAYER_REGION_MODE } from '../src/generation/reference-region.mjs';
import { encodeRgbaPng } from '../src/png.mjs';
import { hash, seal, unseal } from '../src/generation/common.mjs';
import { controlFixture, controlMeasurement, syntheticControlImage } from './helpers/reference-controls.mjs';
import { decision } from './helpers/generation.mjs';
const rejects = (fn, code) => assert.throws(fn, e => e.errors?.some(v => v.code === code));
function generated() {
  const rgba = Buffer.alloc(1024 * 576 * 4);
  for (let y = 400; y < 576; y++) for (let x = 0; x < 200; x++) rgba.set([40 + x % 9, 80, 120, 255], (y * 1024 + x) * 4);
  return encodeRgbaPng(1024, 576, rgba);
}
async function fixture(t, { reject = true } = {}) {
  const f = controlFixture(t, { rejected: false }), a = controlMeasurement(f.baseline, f.result.rawSha256);
  const measured = flow.buildMeasuredReferenceReview(f.workflow, f.baseline.sha256, a, join(f.parent, 'actual'));
  flow.reviewMeasuredReference(f.workflow, f.baseline.sha256, a, decision('region.actual.accept', measured.packetSha256));
  const target = flow.getReferenceReconstructionTarget(f.workflow, f.baseline.sha256), raw = syntheticControlImage();
  const baselineOptions = { batchId: 'region.baseline', mode: 'original-canvas-single-input-edit-v1',
    assets: [{ planId: 'region.baseline.ground', parents: [], instanceId: 'ground.actual', clippedEdges: ['left', 'bottom'],
      subjectBrief: { content: 'Keep the existing synthetic ground.', exclusions: ['sky', 'other layers'] }, intent: 'Preserve the original canvas.' }] };
  const batch = assets.freezeReferenceAssetProject(f.root, baselineOptions);
  assets.authorizeReferenceAssetProject(f.root, batch.sha256, decision('region.baseline.compute', batch.sha256, 'approve-compute'));
  await assets.runReferenceAssetProject(f.root, batch.sha256, { preflight: async () => {}, generate: async () => generated() });
  const baseline = flow.getGenerationPlan(f.workflow, batch.planSha256s[0]);
  const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  const recipe = seal({ format: 'ai_scene_region_guide_recipe_v1', guideId: 'region.design', targetSha256: target.sha256,
    baselinePlanSha256: baseline.sha256, instanceId: 'ground.actual', coordinates: 'canonical-reference-frame',
    keepSearchEnvelope: rect(0, 94, 256, 50), keepExamples: [{ id: 'k1', point: { x: 30, y: 120 }, part: 'ground material' }],
    removeExamples: [{ id: 'r1', instanceId: 'sky.actual', polygon: rect(120, 20, 20, 20) }], removeSurfaceIds: [] });
  const proposal = regionGuideProposalFiles(target, raw, baseline, recipe);
  if (reject) flow.reviewResult(f.workflow, baseline.sha256, decision('region.baseline.reject', hash(generated()), 'reject'));
  const importOptions = { controlId: 'region.controls', baselinePlanSha256: baseline.sha256, reviewPacket: proposal.packet };
  const artifacts = new Map(proposal.packet.artifacts.map(a => [a.path, proposal.files.get(a.path)]));
  return { ...f, raw, target, baseline, baselineOptions, proposal, importOptions, artifacts };
}
function importAndAccept(f) {
  const c = flow.importRegionGuideControls(f.workflow, f.importOptions, f.artifacts);
  flow.reviewRegionGuideControls(f.workflow, c.sha256, decision('region.design.accept', f.proposal.packet.sha256));
  const options = { batchId: 'region.new.batch', mode: REFERENCE_LAYER_REGION_MODE, assets: [{ ...f.baselineOptions.assets[0],
    planId: 'region.guided.ground', parents: [f.baseline.sha256], regionControlsSha256: c.sha256 }] };
  return { c, options };
}
test('exact guide import and design acceptance remain separate from image compute', async t => {
  const f = await fixture(t), c = flow.importRegionGuideControls(f.workflow, f.importOptions, f.artifacts);
  const options = { batchId: 'region.new.batch', mode: REFERENCE_LAYER_REGION_MODE, assets: [{ ...f.baselineOptions.assets[0],
    planId: 'region.guided.ground', parents: [f.baseline.sha256], regionControlsSha256: c.sha256 }] };
  rejects(() => assets.freezeReferenceAssetProject(f.root, options), 'REGION_CONTROL_REVIEW_REQUIRED');
  flow.reviewRegionGuideControls(f.workflow, c.sha256, decision('region.design.accept', f.proposal.packet.sha256));
  const out = join(f.parent, 'guided-preview'); assets.buildReferenceAssetProposal(f.root, options, out); assets.verifyReferenceAssetProposal(f.root, options, out);
  const batch = assets.freezeReferenceAssetProject(f.root, options), p = flow.getGenerationPlan(f.workflow, batch.planSha256s[0]);
  assert.equal(batch.format, 'ai_scene_reference_asset_batch_v4'); assert.equal(p.format, 'ai_scene_generation_plan_v24');
  assert.equal(p.request.prompt, f.proposal.files.get('prompt-draft.txt').toString()); assert.deepEqual(p.target, f.baseline.target);
  assert.deepEqual(p.request.images.map(i => i.role), ['accepted-scene-edit-target-original-canvas', 'same-frame-region-selection-guide-not-edit-target']);
  assert.deepEqual(flow.readGenerationInput(f.workflow, p.sha256, 1), f.proposal.files.get('region-guide.png'));
  assert.deepEqual(readFileSync(join(out, 'assets/ground.actual/region-guide.png')), f.proposal.files.get('region-guide.png'));
  rejects(() => flow.reservePlan(f.workflow, p.sha256), 'AUTHORIZATION_REQUIRED');
  assert.equal(flow.getRegionGuideControls(f.workflow, c.sha256).review.receipt.decision, 'accept');
});
test('pending baseline, unexpected paths and modified/resealed guide payloads are refused without events', async t => {
  const pending = await fixture(t, { reject: false });
  rejects(() => flow.importRegionGuideControls(pending.workflow, pending.importOptions, pending.artifacts), 'REGION_CONTROL_REJECTED_BASELINE');
  const f = await fixture(t), before = flow.inspectWorkflow(f.workflow), bad = new Map(f.artifacts);
  const changed = Buffer.from(bad.get('region-guide.png')); changed[changed.length - 1] ^= 1; bad.set('region-guide.png', changed);
  rejects(() => flow.importRegionGuideControls(f.workflow, f.importOptions, bad), 'REGION_CONTROL_ARTIFACTS');
  const packet = unseal(f.proposal.packet); packet.artifacts = packet.artifacts.map(a => a.path === 'region-guide.png'
    ? { ...a, sha256: hash(changed) } : a);
  rejects(() => flow.importRegionGuideControls(f.workflow, { ...f.importOptions, reviewPacket: seal(packet) }, bad), 'REGION_CONTROL_PACKAGE_REPLAY');
  const foreign = unseal(f.proposal.packet); foreign.artifacts[0].path = '../foreign.png';
  rejects(() => flow.importRegionGuideControls(f.workflow, { ...f.importOptions, reviewPacket: seal(foreign) }, f.artifacts), 'REGION_CONTROL_ARTIFACTS');
  assert.deepEqual(flow.inspectWorkflow(f.workflow), before);
});
test('region plans preserve accepted scope and output policy and enforce two-image capabilities', async t => {
  const f = await fixture(t), { options } = importAndAccept(f);
  const bad = structuredClone(options); bad.assets[0].subjectBrief.content = 'Different asset design';
  rejects(() => assets.freezeReferenceAssetProject(f.root, bad), 'REGION_PLAN_BASELINE');
  const noParent = structuredClone(options); noParent.assets[0].parents = [];
  rejects(() => assets.freezeReferenceAssetProject(f.root, noParent), 'PLAN_PARENT');
  const cap = flow.createDesignDraft(f.workflow, { ...unseal(f.cap), capabilityId: 'region.one.input', maxInputImages: 1 });
  rejects(() => flow.previewReferenceAssets(f.workflow, { ...options, referencePlanSha256: f.baseline.recipe.referencePlans[0],
    targetSha256: f.target.sha256, capabilitiesSha256: cap.sha256 }), 'REFERENCE_ASSET_CAPABILITY');
});
test('new compute dispatches only original plus exact guide after reservation, once; art stays pending', async t => {
  const f = await fixture(t), { options } = importAndAccept(f), batch = assets.freezeReferenceAssetProject(f.root, options); let calls = 0;
  assets.authorizeReferenceAssetProject(f.root, batch.sha256, decision('region.new.compute', batch.sha256, 'approve-compute'));
  const result = await assets.runReferenceAssetProject(f.root, batch.sha256, { preflight: async () => {}, generate: async input => {
    calls++; assert.equal(input.images.length, 2); assert.deepEqual(input.images[0].bytes, f.raw);
    assert.deepEqual(input.images[1].bytes, f.proposal.files.get('region-guide.png'));
    assert.equal(flow.inspectWorkflow(f.workflow).plans.find(p => p.planSha256 === input.planSha256).status, 'submitted'); return generated();
  } });
  assert.equal(calls, 1); assert.equal(result.assets[0].status, 'pending-visual-review');
  await assert.rejects(assets.runReferenceAssetProject(f.root, batch.sha256, { preflight: async () => {}, generate: async () => { calls++; } }));
  assert.equal(calls, 1);
  const out = join(f.parent, 'proof'); assets.buildReferenceAssetProof(f.root, batch.sha256, out); assets.verifyReferenceAssetProof(f.root, batch.sha256, out);
  const report = JSON.parse(readFileSync(join(out, 'report.json'))); assert.equal(report.sourceFallbackPixels, 0);
  assert.equal(report.artAcceptance, 'not-assessed'); assert.deepEqual(readFileSync(join(out, 'assets/ground.actual/source-native.png')), generated());
});
test('unknown guided attempt cannot retry; terminal revision keeps guide and requires fresh compute', async t => {
  const f = await fixture(t), { options } = importAndAccept(f), batch = assets.freezeReferenceAssetProject(f.root, options); let calls = 0;
  assets.authorizeReferenceAssetProject(f.root, batch.sha256, decision('region.unknown', batch.sha256, 'approve-compute'));
  const adapter = { preflight: async () => {}, generate: async () => { calls++; throw Error('unknown double'); } };
  const result = await assets.runReferenceAssetProject(f.root, batch.sha256, adapter); assert.equal(result.assets[0].status, 'indeterminate');
  await assert.rejects(assets.runReferenceAssetProject(f.root, batch.sha256, adapter)); assert.equal(calls, 1);
  const next = flow.reviseGenerationPlan(f.workflow, batch.planSha256s[0], { planId: 'region.explicit.revision',
    capabilitiesSha256: f.cap.sha256, intent: f.baseline.recipe.intent });
  assert.equal(next.format, 'ai_scene_generation_plan_v24');
  assert.equal(next.request.prompt, f.proposal.files.get('prompt-draft.txt').toString());
  rejects(() => flow.reservePlan(f.workflow, next.sha256), 'AUTHORIZATION_REQUIRED');
});
