import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import * as flow from '../src/generation/index.mjs';
import * as project from '../src/reference-led-pipeline.mjs';
import * as assets from '../src/reference-asset-pipeline.mjs';
import { assessReferenceAssetEdit, REFERENCE_LAYER_EDIT_MODE } from '../src/generation/reference-asset-edit.mjs';
import { assessReferenceAsset } from '../src/generation/reference-asset.mjs';
import { referenceAssetProofFiles } from '../src/reference-asset-proof.mjs';
import { encodeRgbaPng, inspectPng } from '../src/png.mjs';
import { unseal } from '../src/generation/common.mjs';
import { controlFixture, controlMeasurement, syntheticControlImage } from './helpers/reference-controls.mjs';
import { decision } from './helpers/generation.mjs';

const rejects = (fn, code) => assert.throws(fn, e => e.errors?.some(v => v.code === code));
function fixture(t) {
  const f = controlFixture(t, { rejected: false }), raw = syntheticControlImage(), a = controlMeasurement(f.baseline, f.result.rawSha256);
  const packet = flow.buildMeasuredReferenceReview(f.workflow, f.baseline.sha256, a, join(f.parent, 'actual'));
  flow.reviewMeasuredReference(f.workflow, f.baseline.sha256, a, decision('edit.target.accept', packet.packetSha256));
  const target = flow.getReferenceReconstructionTarget(f.workflow, f.baseline.sha256);
  const options = { batchId: 'edit.batch', mode: REFERENCE_LAYER_EDIT_MODE, assets: [{ planId: 'edit.ground', parents: [],
    instanceId: 'ground.actual', subjectBrief: { content: 'Keep the existing ground visible in the edit target.',
      exclusions: ['sky', 'other layers'] }, intent: 'Preserve original placement.', clippedEdges: ['left', 'bottom'] }] };
  return { ...f, raw, target, options, core: { ...options, referencePlanSha256: f.baseline.sha256,
    targetSha256: target.sha256, capabilitiesSha256: f.cap.sha256 } };
}
function generated({ top = false, right = false, width = 1024, height = 576 } = {}) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = Math.floor(height * 0.7); y < height; y++) for (let x = 0; x < Math.floor(width * 0.2); x++)
    rgba.set([30 + x % 8, 55, 95, 255], (y * width + x) * 4);
  if (top) rgba.set([40, 55, 95, 255], (width / 2 | 0) * 4);
  if (right) rgba.set([40, 55, 95, 1], ((height / 2 | 0) * width + width - 1) * 4);
  return encodeRgbaPng(width, height, rgba);
}

test('edit preview uses exact full scene as target and local crop only as locator; no padded guide or outside completion', t => {
  const f = fixture(t), before = project.inspectReferenceLedProject(f.root), out = join(f.parent, 'edit-preview');
  assets.buildReferenceAssetProposal(f.root, f.options, out); assets.verifyReferenceAssetProposal(f.root, f.options, out);
  assert.deepEqual(project.inspectReferenceLedProject(f.root), before);
  const p = flow.previewReferenceAssets(f.workflow, f.core).plans[0];
  assert.equal(p.format, 'ai_scene_generation_plan_v22');
  assert.deepEqual(p.request.images.map(i => i.role), ['accepted-scene-edit-target-original-canvas', 'exact-instance-locator-not-output-frame']);
  assert.deepEqual(p.placement.referenceAperture, { x: 0, y: 0, width: 256, height: 144 });
  assert.deepEqual(p.placement.frame, f.target.mapping.viewport);
  assert.equal(p.placement.outsideReference, 'unknown-not-generated'); assert.equal(p.placement.hardGeometryControl, false);
  assert.equal(p.target.purpose, 'visible-reference-layer-not-completed-module');
  assert.match(p.request.prompt, /EDIT TARGET/); assert.match(p.request.prompt, /do not enlarge, center/);
  const report = JSON.parse(readFileSync(join(out, 'proof-bundle.json')));
  assert(!report.artifacts.some(a => a.path.endsWith('placement-guide.png')));
});

test('edge exemptions require explicit frame-clipped envelope evidence; capability and mode validation remain closed', t => {
  const f = fixture(t), bad = structuredClone(f.core); bad.assets[0].clippedEdges = ['top'];
  rejects(() => flow.previewReferenceAssets(f.workflow, bad), 'REFERENCE_LAYER_CLIPPED_EDGES');
  bad.assets[0].clippedEdges = ['left', 'left']; rejects(() => flow.previewReferenceAssets(f.workflow, bad), 'REFERENCE_LAYER_CLIPPED_EDGES');
  const cap = flow.createDesignDraft(f.workflow, { ...unseal(f.cap), capabilityId: 'edit.two.inputs', maxInputImages: 2 });
  assert.equal(flow.previewReferenceAssets(f.workflow, { ...f.core, capabilitiesSha256: cap.sha256 }).plans[0].request.images.length, 2);
  const small = flow.createDesignDraft(f.workflow, { ...unseal(f.cap), capabilityId: 'edit.one.input', maxInputImages: 1 });
  rejects(() => flow.previewReferenceAssets(f.workflow, { ...f.core, capabilitiesSha256: small.sha256 }), 'REFERENCE_ASSET_CAPABILITY');
  rejects(() => flow.previewReferenceAssets(f.workflow, { ...f.core, mode: 'unknown' }), 'REFERENCE_ASSET_MODE');
  const privateData = structuredClone(f.core); privateData.assets[0].intent = 'read C:/private/model';
  rejects(() => flow.previewReferenceAssets(f.workflow, privateData), 'PRIVATE_OPERATIONAL_TEXT');
});

test('new QA admits declared original cuts only; v21 still rejects the same edge-touching PNG', t => {
  const f = fixture(t), p = flow.previewReferenceAssets(f.workflow, f.core).plans[0], bytes = generated();
  const qa = assessReferenceAssetEdit(p, bytes); assert.equal(qa.status, 'pass');
  assert.deepEqual(qa.edgeEvidence.originalClippedEdges, ['left', 'bottom']); assert.deepEqual(qa.edgeEvidence.violatedEdges, []);
  assert.equal(qa.completedReusableModule, false); assert.equal(qa.referencePlacement, 'not-assessed');
  assert.equal(qa.visualAcceptance, 'not-assessed'); assert.equal(qa.sourceModified, false);
  for (const [options, edge] of [[{ top: true }, 'top'], [{ right: true }, 'right']]) {
    const bad = assessReferenceAssetEdit(p, generated(options));
    assert(bad.issues.includes('REFERENCE_LAYER_UNDECLARED_EDGE')); assert(bad.edgeEvidence.violatedEdges.includes(edge));
  }
  assert(assessReferenceAssetEdit(p, generated({ height: 700 })).issues.includes('REFERENCE_ASSET_FRAME_ASPECT'));
  assert.equal(assessReferenceAssetEdit(p, Buffer.from('invalid')).status, 'fail');
  const oldOptions = structuredClone(f.core); delete oldOptions.mode; delete oldOptions.assets[0].clippedEdges;
  const oldPlan = flow.previewReferenceAssets(f.workflow, oldOptions).plans[0];
  assert(assessReferenceAsset(oldPlan, bytes).issues.includes('ENVIRONMENT_ALPHA_MARGIN'));
});

test('edit batch authorizes once, reserves before dispatch, preserves raw bytes and stays pending art review', async t => {
  const f = fixture(t), batch = assets.freezeReferenceAssetProject(f.root, f.options); let calls = 0;
  assert.equal(batch.format, 'ai_scene_reference_asset_batch_v2');
  rejects(() => flow.reservePlan(f.workflow, batch.planSha256s[0]), 'AUTHORIZATION_REQUIRED');
  assets.authorizeReferenceAssetProject(f.root, batch.sha256, decision('edit.compute', batch.sha256, 'approve-compute'));
  const bytes = generated(), status = await assets.runReferenceAssetProject(f.root, batch.sha256, { preflight: async () => {}, generate: async input => {
    calls++; const s = flow.inspectWorkflow(f.workflow).plans.find(p => p.planSha256 === input.planSha256);
    assert.equal(s.status, 'submitted'); assert.equal(s.reserved, true); assert.equal(input.images.length, 2);
    assert.deepEqual(input.images[0].bytes, f.raw); assert.equal(input.images[0].role, 'accepted-scene-edit-target-original-canvas'); return bytes;
  } });
  assert.equal(calls, 1); assert.equal(status.assets[0].status, 'pending-visual-review');
  assert.deepEqual(flow.getGenerationResult(f.workflow, batch.planSha256s[0]).bytes, bytes);
  rejects(() => assets.authorizeReferenceAssetProject(f.root, batch.sha256, decision('edit.again', batch.sha256, 'approve-compute')), 'AUTHORIZATION_STATE');
  await assert.rejects(assets.runReferenceAssetProject(f.root, batch.sha256, { preflight: async () => {}, generate: async () => { calls++; } }));
  assert.equal(calls, 1); assert.equal(project.inspectReferenceLedProject(f.root).reference.status, 'accepted');
  const out = join(f.parent, 'proof'); assets.buildReferenceAssetProof(f.root, batch.sha256, out); assets.verifyReferenceAssetProof(f.root, batch.sha256, out);
});

test('terminal v21 failures can parent new edit plans; old right or old batch authorization cannot authorize new requests', async t => {
  const f = fixture(t), old = structuredClone(f.options); delete old.mode; delete old.assets[0].clippedEdges;
  old.batchId = 'old.batch'; old.assets[0].planId = 'old.plan';
  const batch = assets.freezeReferenceAssetProject(f.root, old);
  assets.authorizeReferenceAssetProject(f.root, batch.sha256, decision('old.compute', batch.sha256, 'approve-compute'));
  await assets.runReferenceAssetProject(f.root, batch.sha256, { preflight: async () => {}, generate: async () => generated() });
  assert.equal(assets.inspectReferenceAssetProject(f.root, batch.sha256).assets[0].status, 'rejected-technical');
  f.options.assets[0].parents = [batch.planSha256s[0]];
  const next = assets.freezeReferenceAssetProject(f.root, f.options);
  rejects(() => flow.reservePlan(f.workflow, next.planSha256s[0]), 'AUTHORIZATION_REQUIRED');
  rejects(() => assets.authorizeReferenceAssetProject(f.root, next.sha256, decision('wrong.target', batch.sha256, 'approve-compute')), 'AUTHORIZATION_STATE');
  assert.equal(assets.inspectReferenceAssetProject(f.root, batch.sha256).assets[0].status, 'rejected-technical');
});

test('unknown edit outcome is terminal; fresh revisions remain unapproved', async t => {
  const f = fixture(t), batch = assets.freezeReferenceAssetProject(f.root, f.options); let calls = 0;
  assets.authorizeReferenceAssetProject(f.root, batch.sha256, decision('unknown.compute', batch.sha256, 'approve-compute'));
  const adapter = { preflight: async () => {}, generate: async () => { calls++; throw Error('unknown double'); } };
  const result = await assets.runReferenceAssetProject(f.root, batch.sha256, adapter);
  assert.equal(result.assets[0].status, 'indeterminate');
  await assert.rejects(assets.runReferenceAssetProject(f.root, batch.sha256, adapter)); assert.equal(calls, 1);
  const revision = flow.reviseGenerationPlan(f.workflow, batch.planSha256s[0], { planId: 'edit.revision', capabilitiesSha256: f.cap.sha256, intent: 'Explicit new attempt.' });
  assert.equal(revision.format, 'ai_scene_generation_plan_v22');
  rejects(() => flow.reservePlan(f.workflow, revision.sha256), 'AUTHORIZATION_REQUIRED');
});

test('proof maps full output canvas without recentering the visible layer or backfilling reference pixels', t => {
  const f = fixture(t), plan = flow.previewReferenceAssets(f.workflow, f.core).plans[0], bytes = generated();
  const proof = referenceAssetProofFiles(f.target, f.raw, [{ plan, bytes }]);
  const image = inspectPng(proof.files.get('selected-assets-only.png'), { includePixels: true });
  const at = (x, y) => [...image.rgba.subarray((y * image.width + x) * 4, (y * image.width + x + 1) * 4)];
  assert.equal(at(0, 130)[3], 255); assert.deepEqual(at(200, 130), [0, 0, 0, 0]); assert.equal(at(0, 0)[3], 0);
  assert(proof.files.has('assets/ground.actual/original-canvas-frame.png'));
  assert.deepEqual(proof.files.get('assets/ground.actual/source-native.png'), bytes);
  assert.equal(proof.report.sourceFallbackPixels, 0); assert.equal(proof.report.sources[0].alphaBoundsRepositioned, false);
  assert.equal(proof.report.artAcceptance, 'not-assessed'); assert.equal(proof.report.assetPackage, false);
});
