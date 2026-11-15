import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as flow from '../src/generation/index.mjs';
import * as project from '../src/reference-led-pipeline.mjs';
import * as assets from '../src/reference-asset-pipeline.mjs';
import { assessReferenceAsset } from '../src/generation/reference-asset.mjs';
import { referenceAssetProofFiles } from '../src/reference-asset-proof.mjs';
import { encodeRgbaPng, inspectPng } from '../src/png.mjs';
import { digest, jsonBytes, unseal } from '../src/generation/common.mjs';
import { controlFixture, controlMeasurement, syntheticControlImage } from './helpers/reference-controls.mjs';
import { decision } from './helpers/generation.mjs';

const rejects = (fn, code) => assert.throws(fn, e => e.errors?.some(v => v.code === code));
function fixture(t) {
  const f = controlFixture(t, { rejected: false }), raw = syntheticControlImage(), a = controlMeasurement(f.baseline, f.result.rawSha256);
  const packet = flow.buildMeasuredReferenceReview(f.workflow, f.baseline.sha256, a, join(f.parent, 'actual'));
  flow.reviewMeasuredReference(f.workflow, f.baseline.sha256, a, decision('asset.target.accept', packet.packetSha256));
  const target = flow.getReferenceReconstructionTarget(f.workflow, f.baseline.sha256);
  const options = { batchId: 'asset.batch.r1', assets: target.instances.map((i, n) => ({ planId: `asset.subject.${n}`, parents: [], instanceId: i.instanceId,
    subjectBrief: { content: `Reconstruct only ${i.instanceId} from the accepted synthetic reference.`, exclusions: ['other subjects', 'UI', 'new objects'] }, intent: 'Preserve observed proportions.' })) };
  const core = { ...options, referencePlanSha256: f.baseline.sha256, targetSha256: target.sha256, capabilitiesSha256: f.cap.sha256 };
  return { ...f, raw, target, options, core };
}
function generated(alpha, width = 1024, height = 576) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (alpha === 'transparent' && (x < 8 || y < 8 || x >= width - 8 || y >= height - 8)) continue;
    pixels.set([40 + x % 9, 80, 120, 255], (y * width + x) * 4);
  }
  return encodeRgbaPng(width, height, pixels);
}

test('readonly proposal binds accepted actual instances, exact context pixels and a padded frame instead of centered sprites', t => {
  const f = fixture(t), before = project.inspectReferenceLedProject(f.root), out = join(f.parent, 'proposal');
  assets.buildReferenceAssetProposal(f.root, f.options, out); assets.verifyReferenceAssetProposal(f.root, f.options, out);
  assert.deepEqual(project.inspectReferenceLedProject(f.root), before);
  const p = flow.previewReferenceAssets(f.workflow, f.core).plans[1];
  assert.equal(p.format, 'ai_scene_generation_plan_v21'); assert.equal(p.recipe.stage, 'reference-asset');
  assert.deepEqual(p.request.images.map(i => i.role), ['accepted-scene-art-and-composition', 'exact-instance-context-not-cutout', 'coarse-placement-guide-not-art-style']);
  assert.deepEqual(p.placement.referenceAperture, { x: 32, y: 18, width: 256, height: 144 });
  assert.equal(p.placement.hardGeometryControl, false); assert.equal(p.placement.automaticAlphaBoundsPlacement, false);
  assert.match(p.request.prompt, /DO NOT center/); assert.equal(p.visualReviewChecklist.pixelIdentityRequired, false);
  const { nativeCrop } = { nativeCrop: p.instanceBinding.contextCrop };
  assert(nativeCrop.y > 0); assert(nativeCrop.y < f.target.mapping.nativeSize.height);
});

test('unaccepted reference and nonexistent instances cannot be turned into asset generation', t => {
  const f = fixture(t), invalid = structuredClone(f.options); invalid.assets[0].instanceId = 'not.observed';
  const before = flow.inspectWorkflow(f.workflow);
  rejects(() => assets.freezeReferenceAssetProject(f.root, invalid), 'DECOMPOSITION_INSTANCE_REQUIRED');
  assert.deepEqual(flow.inspectWorkflow(f.workflow), before);
  const unaccepted = controlFixture(t);
  rejects(() => assets.freezeReferenceAssetProject(unaccepted.root, f.options), 'REFERENCE_ASSET_ACCEPTED_TARGET');
});

test('capabilities, operational text and target identity are checked before generation', t => {
  const f = fixture(t), cap = flow.createDesignDraft(f.workflow, { ...unseal(f.cap), capabilityId: 'asset.too.few', maxInputImages: 2 });
  rejects(() => flow.previewReferenceAssets(f.workflow, { ...f.core, capabilitiesSha256: cap.sha256 }), 'REFERENCE_ASSET_CAPABILITY');
  rejects(() => flow.previewReferenceAssets(f.workflow, { ...f.core, targetSha256: '0'.repeat(64) }), 'REFERENCE_ASSET_ACCEPTED_TARGET');
  const bad = structuredClone(f.core); bad.assets[0].subjectBrief.content = 'Host http://private.invalid/reference';
  rejects(() => flow.freezeReferenceAssets(f.workflow, bad), 'PRIVATE_OPERATIONAL_TEXT');
});

test('batch freeze is all-or-nothing on duplicate plan IDs or a reused batch ID', t => {
  const f = fixture(t), before = flow.inspectWorkflow(f.workflow), bad = structuredClone(f.options);
  bad.assets[1].planId = bad.assets[0].planId;
  rejects(() => assets.freezeReferenceAssetProject(f.root, bad), 'REVISION_ID_EXISTS');
  assert.deepEqual(flow.inspectWorkflow(f.workflow), before);
  assets.freezeReferenceAssetProject(f.root, f.options); const frozen = flow.inspectWorkflow(f.workflow);
  const next = structuredClone(f.options); next.assets.forEach(a => { a.planId += '.new'; });
  rejects(() => assets.freezeReferenceAssetProject(f.root, next), 'REVISION_ID_EXISTS');
  assert.deepEqual(flow.inspectWorkflow(f.workflow), frozen);
});

test('one exact batch authorization binds each plan once and reservation precedes dispatch', async t => {
  const f = fixture(t), batch = assets.freezeReferenceAssetProject(f.root, f.options), seen = [];
  await assert.rejects(assets.runReferenceAssetProject(f.root, batch.sha256, { preflight: async () => assert.fail('unapproved preflight'), generate: async () => assert.fail('unapproved generation') }));
  assets.authorizeReferenceAssetProject(f.root, batch.sha256, decision('asset.compute', batch.sha256, 'approve-compute'));
  const status = await assets.runReferenceAssetProject(f.root, batch.sha256, { preflight: async () => {}, generate: async input => {
    const state = flow.inspectWorkflow(f.workflow).plans.find(p => p.planSha256 === input.planSha256);
    assert.equal(state.status, 'submitted'); assert.equal(state.reserved, true);
    assert.deepEqual(input.images[0].bytes, f.raw);
    const p = flow.getGenerationPlan(f.workflow, input.planSha256), crop = inspectPng(input.images[1].bytes, { includePixels: true });
    const original = inspectPng(f.raw, { includePixels: true }), b = p.instanceBinding.contextCrop;
    for (const [x, y] of [[0, 0], [crop.width - 1, crop.height - 1]])
      assert.deepEqual(crop.rgba.subarray((y * crop.width + x) * 4, (y * crop.width + x + 1) * 4),
        original.rgba.subarray(((b.y + y) * original.width + b.x + x) * 4, ((b.y + y) * original.width + b.x + x + 1) * 4));
    seen.push(input.planSha256); return generated(input.request.output.alpha);
  } });
  assert.equal(seen.length, 2); assert(status.assets.every(p => p.status === 'pending-visual-review'));
  assert.equal(status.assetPackage, false); assert.equal(project.inspectReferenceLedProject(f.root).reference.status, 'accepted');
  rejects(() => flow.reservePlan(f.workflow, batch.planSha256s[0]), 'RESERVATION_STATE');
  rejects(() => assets.authorizeReferenceAssetProject(f.root, batch.sha256, decision('asset.compute.again', batch.sha256, 'approve-compute')), 'AUTHORIZATION_STATE');
});

test('unknown stops the batch without fallback and an explicit revision needs new authorization', async t => {
  const f = fixture(t), batch = assets.freezeReferenceAssetProject(f.root, f.options); let calls = 0;
  assets.authorizeReferenceAssetProject(f.root, batch.sha256, decision('asset.unknown.compute', batch.sha256, 'approve-compute'));
  const adapter = { preflight: async () => {}, generate: async () => { calls++; throw Error('Unknown double'); } };
  const status = await assets.runReferenceAssetProject(f.root, batch.sha256, adapter);
  assert.equal(calls, 1); assert.equal(status.assets[0].status, 'indeterminate'); assert.equal(status.assets[1].status, 'authorized');
  await assets.runReferenceAssetProject(f.root, batch.sha256, adapter); assert.equal(calls, 1);
  const next = flow.reviseGenerationPlan(f.workflow, batch.planSha256s[0], { planId: 'asset.new.attempt', capabilitiesSha256: f.cap.sha256, intent: 'Explicit revision.' });
  assert.equal(next.format, 'ai_scene_generation_plan_v21'); assert.deepEqual(next.recipe.parents, [batch.planSha256s[0]]);
  rejects(() => flow.reservePlan(f.workflow, next.sha256), 'AUTHORIZATION_REQUIRED');
});

test('bad technical output stops remaining calls; technical success does not attest placement or art', async t => {
  const f = fixture(t), batch = assets.freezeReferenceAssetProject(f.root, f.options); let calls = 0;
  assets.authorizeReferenceAssetProject(f.root, batch.sha256, decision('asset.bad.compute', batch.sha256, 'approve-compute'));
  const status = await assets.runReferenceAssetProject(f.root, batch.sha256, { preflight: async () => {}, generate: async () => { calls++; return Buffer.from('invalid png'); } });
  assert.equal(calls, 1); assert.equal(status.assets[0].status, 'rejected-technical');
  const plan = flow.getGenerationPlan(f.workflow, batch.planSha256s[1]), qa = assessReferenceAsset(plan, generated('transparent'));
  assert.equal(qa.status, 'pass'); assert.equal(qa.referencePlacement, 'not-assessed'); assert.equal(qa.visualAcceptance, 'not-assessed');
  assert(assessReferenceAsset(plan, generated('transparent', 1024, 600)).issues.includes('REFERENCE_ASSET_FRAME_ASPECT'));
});

test('CLI previews/freezes without generation and refuses an implicit yes option', async t => {
  const f = fixture(t), path = join(f.parent, 'options.json'); writeFileSync(path, jsonBytes(f.options));
  const cli = fileURLToPath(new URL('../scripts/reference.mjs', import.meta.url)), run = promisify(execFile), out = join(f.parent, 'cli-preview');
  const before = project.inspectReferenceLedProject(f.root);
  await run(process.execPath, [cli, 'asset-preview', '--root', f.root, '--options', path, '--out', out]);
  await run(process.execPath, [cli, 'verify-asset-preview', '--root', f.root, '--options', path, '--out', out]);
  assert.deepEqual(project.inspectReferenceLedProject(f.root), before);
  const { stdout } = await run(process.execPath, [cli, 'asset-plan', '--root', f.root, '--options', path]);
  const batch = JSON.parse(stdout); assert.equal(batch.maximumCalls, 2);
  const inspected = await run(process.execPath, [cli, 'asset-inspect', '--root', f.root, '--batch', batch.sha256]);
  assert(JSON.parse(inspected.stdout).assets.every(p => p.status === 'planned' && !p.reserved));
  await assert.rejects(run(process.execPath, [cli, 'asset-authorize', '--root', f.root, '--batch', batch.sha256, '--decision', path, '--yes', 'true']));
  assert.equal(digest(flow.getReferenceAssetBatch(f.workflow, batch.sha256)), digest(batch));
});

test('proof preserves generated frame position without alpha-bounds centering, tint or original-image fallback', t => {
  const f = fixture(t), plan = flow.previewReferenceAssets(f.workflow, f.core).plans[1], pixels = Buffer.alloc(1024 * 576 * 4);
  for (let y = 64; y < 192; y++) for (let x = 64; x < 192; x++) pixels.set([15, 37, 59, 255], (y * 1024 + x) * 4);
  const bytes = encodeRgbaPng(1024, 576, pixels), p = referenceAssetProofFiles(f.target, f.raw, [{ plan, bytes }]);
  const image = inspectPng(p.files.get('selected-assets-only.png'), { includePixels: true });
  const at = (x, y) => [...image.rgba.subarray((y * image.width + x) * 4, (y * image.width + x + 1) * 4)];
  assert.deepEqual(at(1, 5), [15, 37, 59, 255]); assert.deepEqual(at(128, 72), [0, 0, 0, 0]);
  assert.deepEqual(p.files.get('assets/ground.actual/source-native.png'), bytes);
  assert.equal(p.report.sourceFallbackPixels, 0); assert.equal(p.report.sources[0].alphaBoundsRepositioned, false);
  assert.equal(p.report.sources[0].tintApplied, false); assert.equal(p.report.artAcceptance, 'not-assessed');
  assert.deepEqual(p.report.notGeneratedInstances, ['sky.actual']); assert.equal(p.report.assetPackage, false);
});
