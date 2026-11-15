import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import * as flow from '../src/generation/index.mjs';
import { regionGuideNativePoint, regionGuideProposalFiles } from '../src/reference-region-guide.mjs';
import { writeProofBundle, verifyProofBundle } from '../src/terrain-proof/bundle.mjs';
import { inspectPng } from '../src/png.mjs';
import { hash, seal, unseal } from '../src/generation/common.mjs';
import { controlFixture, controlMeasurement, syntheticControlImage } from './helpers/reference-controls.mjs';
import { decision } from './helpers/generation.mjs';
const rejects = (fn, code) => assert.throws(fn, e => e.errors?.some(v => v.code === code));
function fixture(t) {
  const f = controlFixture(t, { rejected: false }), a = controlMeasurement(f.baseline, f.result.rawSha256);
  const packet = flow.buildMeasuredReferenceReview(f.workflow, f.baseline.sha256, a, join(f.parent, 'actual'));
  flow.reviewMeasuredReference(f.workflow, f.baseline.sha256, a, decision('region.target.accept', packet.packetSha256));
  const target = flow.getReferenceReconstructionTarget(f.workflow, f.baseline.sha256), raw = syntheticControlImage();
  const plan = flow.previewReferenceAssets(f.workflow, { batchId: 'region.baseline', mode: 'original-canvas-single-input-edit-v1',
    referencePlanSha256: f.baseline.sha256, targetSha256: target.sha256, capabilitiesSha256: f.cap.sha256,
    assets: [{ planId: 'region.ground', parents: [], instanceId: 'ground.actual', clippedEdges: ['left', 'bottom'],
      subjectBrief: { content: 'Keep only the synthetic ground.', exclusions: ['sky'] }, intent: 'Preserve the canvas.' }] }).plans[0];
  const recipe = seal({ format: 'ai_scene_region_guide_recipe_v1', guideId: 'region.r1', targetSha256: target.sha256,
    baselinePlanSha256: plan.sha256, instanceId: 'ground.actual', coordinates: 'canonical-reference-frame',
    keepSearchEnvelope: [{ x: 0, y: 94 }, { x: 256, y: 94 }, { x: 256, y: 144 }, { x: 0, y: 144 }],
    keepExamples: [{ id: 'k1', point: { x: 30, y: 120 }, part: 'visible ground material' }],
    removeExamples: [{ id: 'r1', instanceId: 'sky.actual', polygon: [{ x: 120, y: 20 }, { x: 140, y: 20 }, { x: 140, y: 40 }, { x: 120, y: 40 }] }],
    removeSurfaceIds: [] });
  return { ...f, target, raw, plan, recipe };
}
test('proposal preserves original pixels and native full-frame guides without generation or workflow edits', t => {
  const f = fixture(t), before = flow.inspectWorkflow(f.workflow), original = Buffer.from(f.raw);
  const p = regionGuideProposalFiles(f.target, f.raw, f.plan, f.recipe);
  assert.deepEqual(f.raw, original); assert.deepEqual(p.files.get('reference-native.png'), original);
  assert.equal(p.report.executable, false); assert.equal(p.report.generationRuntimeSupport, 'not-implemented-for-region-guides');
  assert.equal(p.report.generationCalls, 0); assert.equal(p.report.assetPixelsProduced, 0);
  assert.deepEqual(p.report.proposedInputs.map(i => i.path), ['reference-native.png', 'region-guide.png']);
  assert.deepEqual(p.report.reviewOnlyImages, ['review-comparison.png']);
  const guide = inspectPng(p.files.get('region-guide.png'), { includePixels: true }), source = inspectPng(original, { includePixels: true });
  assert.equal(guide.width, source.width); assert.equal(guide.height, source.height); assert.equal(guide.transparentPixels, 0);
  const offset = (100 * guide.width + 500) * 4;
  assert.deepEqual(guide.rgba.subarray(offset, offset + 4), source.rgba.subarray(offset, offset + 4));
  const center = (240 * guide.width + 60) * 4;
  assert.deepEqual(guide.rgba.subarray(center, center + 4), source.rgba.subarray(center, center + 4));
  let changed = 0; for (let p = 0; p < guide.rgba.length; p += 4) if (!guide.rgba.subarray(p, p + 4).equals(source.rgba.subarray(p, p + 4))) changed++;
  assert(changed > 0 && changed < guide.width * guide.height / 4);
  assert.deepEqual(flow.inspectWorkflow(f.workflow), before);
});
test('canonical marks invert actual floor-resized axes and reject synthetic contain margins', () => {
  const mapping = { nativeSize: { width: 1672, height: 941 }, resized: { width: 1023, height: 576 }, offset: { x: 0, y: 0 } };
  assert.deepEqual(regionGuideNativePoint({ x: 360, y: 323 }, mapping), { x: Math.round(360 * 1672 / 1023), y: Math.round(323 * 941 / 576) });
  assert.deepEqual(regionGuideNativePoint({ x: 1023, y: 576 }, mapping), { x: 1671, y: 940 });
  rejects(() => regionGuideNativePoint({ x: 1023.5, y: 320 }, mapping), 'REGION_GUIDE_CONTENT_POINT');
});
test('foreign target, conflicting labels and unsupported recipe fields cannot produce a guide', t => {
  const f = fixture(t), base = unseal(f.recipe), make = recipe => regionGuideProposalFiles(f.target, f.raw, f.plan, seal(recipe));
  rejects(() => make({ ...base, targetSha256: '0'.repeat(64) }), 'REGION_GUIDE_BINDING');
  rejects(() => make({ ...base, automaticSegmentation: true }), 'WORKFLOW_SHAPE');
  rejects(() => make({ ...base, removeExamples: [{ ...base.removeExamples[0], instanceId: 'ground.actual' }] }), 'REGION_GUIDE_REMOVE_INSTANCE');
  rejects(() => make({ ...base, keepExamples: [{ ...base.keepExamples[0], point: { x: 130, y: 30 } }] }), 'REGION_GUIDE_KEEP_OUTSIDE');
  const wide = [{ x: 0, y: 0 }, { x: 256, y: 0 }, { x: 256, y: 144 }, { x: 0, y: 144 }];
  rejects(() => make({ ...base, keepSearchEnvelope: wide, keepExamples: [{ ...base.keepExamples[0], point: { x: 130, y: 30 } }] }), 'REGION_GUIDE_CONFLICT');
  rejects(() => make({ ...base, removeSurfaceIds: ['missing.surface'] }), 'REGION_GUIDE_SURFACE');
  rejects(() => regionGuideProposalFiles(f.target, Buffer.from('wrong original'), f.plan, f.recipe), 'DECOMPOSITION_RAW_BINDING');
});
test('packet replays exactly and verifies every artifact while remaining a design-only proposal', t => {
  const f = fixture(t), first = regionGuideProposalFiles(f.target, f.raw, f.plan, f.recipe), again = regionGuideProposalFiles(f.target, f.raw, f.plan, f.recipe);
  assert.deepEqual([...first.files], [...again.files]);
  assert.equal(first.packet.scope, 'region-guide-design-only-no-compute-no-art-decision');
  assert.equal(first.packet.visualAcceptance, 'pending'); assert.equal(first.packet.generationCalls, 0);
  assert.equal(first.report.proposedInputs[1].sha256, hash(first.files.get('region-guide.png')));
  assert.match(first.files.get('prompt-draft.txt').toString(), /COARSE SEARCH AREA/);
  assert.match(first.files.get('prompt-draft.txt').toString(), /not a silhouette, alpha mask/);
  const out = join(f.parent, 'region-proof'); writeProofBundle(out, f.workflow, first); verifyProofBundle(out, again);
  writeFileSync(join(out, 'region-guide.png'), f.raw);
  rejects(() => verifyProofBundle(out, again), 'PROOF_BUNDLE_RECOMPILE_MISMATCH');
});
