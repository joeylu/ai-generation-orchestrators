import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import * as flow from '../src/generation/index.mjs';
import * as project from '../src/reference-led-pipeline.mjs';
import * as assets from '../src/reference-asset-pipeline.mjs';
import { REFERENCE_LAYER_EDIT_MODE, REFERENCE_LAYER_SINGLE_INPUT_MODE, assessReferenceAssetEdit } from '../src/generation/reference-asset-edit.mjs';
import { encodeRgbaPng } from '../src/png.mjs';
import { hash, unseal } from '../src/generation/common.mjs';
import { controlFixture, controlMeasurement, syntheticControlImage } from './helpers/reference-controls.mjs';
import { decision } from './helpers/generation.mjs';
const rejects = (fn, code) => assert.throws(fn, e => e.errors?.some(v => v.code === code));
function fixture(t) {
  const f = controlFixture(t, { rejected: false }), a = controlMeasurement(f.baseline, f.result.rawSha256);
  const packet = flow.buildMeasuredReferenceReview(f.workflow, f.baseline.sha256, a, join(f.parent, 'actual'));
  flow.reviewMeasuredReference(f.workflow, f.baseline.sha256, a, decision('single.target.accept', packet.packetSha256));
  const target = flow.getReferenceReconstructionTarget(f.workflow, f.baseline.sha256);
  const options = { batchId: 'single.batch', mode: REFERENCE_LAYER_SINGLE_INPUT_MODE, assets: [{ planId: 'single.ground', parents: [],
    instanceId: 'ground.actual', clippedEdges: ['left', 'bottom'], subjectBrief: { content: 'Keep the observed ground in its original position.',
      exclusions: ['sky', 'other layers'] }, intent: 'Preserve the accepted full-scene framing.' }] };
  return { ...f, target, options, core: { ...options, referencePlanSha256: f.baseline.sha256,
    targetSha256: target.sha256, capabilitiesSha256: f.cap.sha256 } };
}
function generated() {
  const pixels = Buffer.alloc(1024 * 576 * 4);
  for (let y = 400; y < 576; y++) for (let x = 0; x < 200; x++) pixels.set([50 + x % 8, 80, 110, 255], (y * 1024 + x) * 4);
  return encodeRgbaPng(1024, 576, pixels);
}
test('v23 removes only locator input and its paragraph while keeping v22 geometry/QA requirements', t => {
  const f = fixture(t), before = project.inspectReferenceLedProject(f.root);
  const p = flow.previewReferenceAssets(f.workflow, f.core).plans[0];
  const old = flow.previewReferenceAssets(f.workflow, { ...f.core, mode: REFERENCE_LAYER_EDIT_MODE }).plans[0];
  assert.equal(p.format, 'ai_scene_generation_plan_v23'); assert.equal(old.format, 'ai_scene_generation_plan_v22');
  assert.equal(p.request.images.length, 1); assert.deepEqual(p.request.images[0], old.request.images[0]);
  const oldParagraphs = old.request.prompt.split('\n\n'); assert(oldParagraphs[2].startsWith('INPUT 2 is'));
  assert.equal(p.request.prompt, oldParagraphs.filter((_, i) => i !== 2).join('\n\n'));
  assert.deepEqual(p.target, old.target); assert.deepEqual(p.request.output, old.request.output);
  assert.equal(p.instanceBinding.cropMeaning, 'review-only-context-not-transmitted');
  assert.equal(assessReferenceAssetEdit(p, generated()).status, 'pass');
  assert.deepEqual(project.inspectReferenceLedProject(f.root), before);
  const out = join(f.parent, 'single-preview'); assets.buildReferenceAssetProposal(f.root, f.options, out); assets.verifyReferenceAssetProposal(f.root, f.options, out);
  const bundle = JSON.parse(readFileSync(join(out, 'proof-bundle.json')));
  assert(bundle.artifacts.some(a => a.path.endsWith('context-review-only.png')));
  assert(!bundle.artifacts.some(a => a.path.endsWith('context-native.png') || a.path.endsWith('placement-guide.png')));
});
test('single-input capability is sufficient, but style, clipping and target guards remain enforced', t => {
  const f = fixture(t), cap = flow.createDesignDraft(f.workflow, { ...unseal(f.cap), capabilityId: 'single.one.image', maxInputImages: 1 });
  const options = { ...f.core, capabilitiesSha256: cap.sha256 };
  assert.equal(flow.previewReferenceAssets(f.workflow, options).plans[0].request.images.length, 1);
  rejects(() => flow.previewReferenceAssets(f.workflow, { ...options, mode: REFERENCE_LAYER_EDIT_MODE }), 'REFERENCE_ASSET_CAPABILITY');
  const bad = structuredClone(options); bad.assets[0].clippedEdges.push('top');
  rejects(() => flow.previewReferenceAssets(f.workflow, bad), 'REFERENCE_LAYER_CLIPPED_EDGES');
  rejects(() => flow.previewReferenceAssets(f.workflow, { ...options, targetSha256: '0'.repeat(64) }), 'REFERENCE_ASSET_ACCEPTED_TARGET');
});
test('single batch dispatches only accepted original PNG once and proof stays pending human review', async t => {
  const f = fixture(t), batch = assets.freezeReferenceAssetProject(f.root, f.options); let calls = 0;
  assert.equal(batch.format, 'ai_scene_reference_asset_batch_v3');
  rejects(() => flow.reservePlan(f.workflow, batch.planSha256s[0]), 'AUTHORIZATION_REQUIRED');
  assets.authorizeReferenceAssetProject(f.root, batch.sha256, decision('single.compute', batch.sha256, 'approve-compute'));
  const result = await assets.runReferenceAssetProject(f.root, batch.sha256, { preflight: async () => {}, generate: async input => {
    calls++; assert.equal(input.images.length, 1); assert.deepEqual(input.images[0].bytes, syntheticControlImage());
    assert.equal(flow.inspectWorkflow(f.workflow).plans.find(p => p.planSha256 === input.planSha256).status, 'submitted'); return generated();
  } });
  assert.equal(calls, 1); assert.equal(result.assets[0].status, 'pending-visual-review'); assert.equal(result.assetPackage, false);
  rejects(() => flow.reservePlan(f.workflow, batch.planSha256s[0]), 'RESERVATION_STATE');
  const out = join(f.parent, 'proof'); assets.buildReferenceAssetProof(f.root, batch.sha256, out); assets.verifyReferenceAssetProof(f.root, batch.sha256, out);
  assert.deepEqual(readFileSync(join(out, 'assets/ground.actual/source-native.png')), generated());
  const report = JSON.parse(readFileSync(join(out, 'report.json'))); assert.equal(report.sourceFallbackPixels, 0);
  assert.equal(report.sources[0].alphaBoundsRepositioned, false); assert.equal(report.artAcceptance, 'not-assessed');
});
test('visually rejected v22 can parent a v23 comparison without reusing its compute decision', async t => {
  const f = fixture(t), oldOptions = { ...f.options, mode: REFERENCE_LAYER_EDIT_MODE, batchId: 'old.batch' };
  oldOptions.assets = f.options.assets.map(a => ({ ...a, planId: 'old.plan' }));
  const old = assets.freezeReferenceAssetProject(f.root, oldOptions);
  assets.authorizeReferenceAssetProject(f.root, old.sha256, decision('old.compute', old.sha256, 'approve-compute'));
  await assets.runReferenceAssetProject(f.root, old.sha256, { preflight: async () => {}, generate: async () => generated() });
  const raw = flow.getGenerationResult(f.workflow, old.planSha256s[0]);
  flow.reviewResult(f.workflow, old.planSha256s[0], decision('old.art.reject', hash(raw.bytes), 'reject'));
  f.options.assets[0].parents = [old.planSha256s[0]];
  const next = assets.freezeReferenceAssetProject(f.root, f.options);
  rejects(() => flow.reservePlan(f.workflow, next.planSha256s[0]), 'AUTHORIZATION_REQUIRED');
  assert.equal(assets.inspectReferenceAssetProject(f.root, old.sha256).assets[0].status, 'rejected-visual');
});
test('unknown single-input result remains terminal and explicit revision needs fresh authorization', async t => {
  const f = fixture(t), batch = assets.freezeReferenceAssetProject(f.root, f.options); let calls = 0;
  assets.authorizeReferenceAssetProject(f.root, batch.sha256, decision('single.unknown', batch.sha256, 'approve-compute'));
  const adapter = { preflight: async () => {}, generate: async () => { calls++; throw Error('unknown double'); } };
  const result = await assets.runReferenceAssetProject(f.root, batch.sha256, adapter);
  assert.equal(result.assets[0].status, 'indeterminate');
  await assert.rejects(assets.runReferenceAssetProject(f.root, batch.sha256, adapter)); assert.equal(calls, 1);
  const next = flow.reviseGenerationPlan(f.workflow, batch.planSha256s[0], { planId: 'single.revision', capabilitiesSha256: f.cap.sha256, intent: 'Explicit revision.' });
  assert.equal(next.format, 'ai_scene_generation_plan_v23');
  rejects(() => flow.reservePlan(f.workflow, next.sha256), 'AUTHORIZATION_REQUIRED');
});
