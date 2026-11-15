import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as api from '../src/generation/index.mjs';
import { digest, jsonBytes, seal } from '../src/generation/common.mjs';
import { encodeFixturePng, inspectPng } from '../src/png.mjs';
import { authorizeAndReserve, capabilitiesDraft, complete, decision, prepare, setup, specDraft, styleDraft } from './helpers/generation.mjs';

const rejects = (operation, code) => assert.throws(operation, error => error.errors?.some(issue => issue.code === code));
const policy = () => ({ mode: 'native-reference', orientation: 'landscape', minimumShortEdge: 256, maximumWidth: 1024, maximumHeight: 1024 });
function init(root, reviewed = true) {
  api.initWorkflow(root, { projectId: 'native.fixture', purpose: 'synthetic-simulation', compiler: 'scene-kit-native-reference-v2' });
  const spec = api.createDesignDraft(root, specDraft()), style = api.createDesignDraft(root, styleDraft());
  const capabilities = api.createDesignDraft(root, { ...capabilitiesDraft(), exactSize: false });
  if (reviewed) {
    api.reviewDesign(root, 'spec', decision('spec', spec.sha256)); api.reviewDesign(root, 'style', decision('style', style.sha256));
  }
  return { spec, style, capabilities };
}
const options = capabilities => ({ planId: 'native.r1', parents: [], capabilitiesSha256: capabilities.sha256, pixelPolicy: policy(), intent: 'Synthetic native canvas reference.' });
function png(width = 512, height = 288, alpha = 255) {
  const pixels = Buffer.alloc(width * height * 4, 255);
  for (let i = 0; i < width * height; i++) { pixels[i * 4] = i % 251; pixels[i * 4 + 3] = alpha; }
  return encodeFixturePng(width, height, pixels);
}
test('native proposal has exact draft/request digests but no review, frozen plan or compute side effect', t => {
  const { root } = setup(t), { spec, style, capabilities } = init(root, false), config = options(capabilities);
  const previewOptions = { specSha256: spec.sha256, styleSha256: style.sha256, capabilitiesSha256: capabilities.sha256,
    pixelPolicy: config.pixelPolicy, intent: config.intent };
  const before = api.inspectWorkflow(root), proposal = api.previewNativeReference(root, previewOptions);
  assert.equal(proposal.executable, false); assert.equal(proposal.status, 'proposal-only');
  assert.deepEqual(proposal.designReviewStatus, { spec: 'pending', style: 'pending' });
  assert.deepEqual(api.inspectWorkflow(root), before);
  rejects(() => api.freezeNativeReferencePlan(root, config), 'DESIGN_REVIEW_REQUIRED');
  rejects(() => api.authorizePlan(root, proposal.sha256, decision('not.plan', proposal.sha256, 'approve-compute')), 'AUTHORIZATION_STATE');
  api.reviewDesign(root, 'spec', decision('spec', spec.sha256)); api.reviewDesign(root, 'style', decision('style', style.sha256));
  const plan = api.freezeNativeReferencePlan(root, config);
  assert.equal(digest(plan.request), proposal.requestSha256);
  assert.equal(plan.format, 'ai_scene_generation_plan_v2'); assert.equal(plan.request.output.pixelSize, undefined);
  rejects(() => api.reservePlan(root, plan.sha256), 'AUTHORIZATION_REQUIRED');
});
test('legacy workspaces do not silently gain the native compiler, and invalid policies append nothing', t => {
  const { root } = setup(t), { capabilities } = prepare(root);
  rejects(() => api.freezeNativeReferencePlan(root, options(capabilities)), 'WORKFLOW_COMPILER');
  const { root: nativeRoot } = setup(t), { capabilities: nativeCap } = init(nativeRoot);
  const before = api.inspectWorkflow(nativeRoot), base = options(nativeCap);
  for (const delta of [{ minimumShortEdge: 0 }, { mode: 'exact' }, { orientation: 'portrait' }, { maximumWidth: 8192 }, { pixelSize: { width: 512, height: 288 } }]) {
    assert.throws(() => api.freezeNativeReferencePlan(nativeRoot, { ...base, pixelPolicy: { ...base.pixelPolicy, ...delta } }));
  }
  rejects(() => api.freezeNativeReferencePlan(nativeRoot, { ...base, stage: 'module' }), 'WORKFLOW_SHAPE');
  assert.deepEqual(api.inspectWorkflow(nativeRoot), before);
});
for (const [width, height] of [[512, 288], [768, 256]]) test(`native ${width}x${height} original canvas is retained without an inferred map transform`, t => {
  const { root } = setup(t), { capabilities } = init(root), plan = api.freezeNativeReferencePlan(root, options(capabilities)), raw = png(width, height);
  const result = api.receiveResult(root, authorizeAndReserve(root, plan), raw);
  assert.equal(result.technical.status, 'pass'); assert.equal(result.technical.policy, 'native-reference-png-v1');
  assert.deepEqual(result.technical.image.pixelSize, { width, height });
  assert.equal(result.technical.geometryEvidence, 'visual-reference-only-no-map-transform');
  assert.equal(result.technical.visualAcceptance, 'not-assessed');
  assert.deepEqual(readFileSync(join(root, 'blobs', `${result.rawSha256}.bin`)), raw);
  assert.equal(api.recheckResult(root, plan.sha256, result.rawSha256).sha256, result.technical.sha256);
  assert.equal(api.inspectWorkflow(root).plans[0].status, 'pending-visual-review');
});
for (const [name, raw, issue] of [
  ['portrait', png(288, 512), 'REFERENCE_ORIENTATION'],
  ['too small', png(320, 128), 'OUTPUT_SIZE'],
  ['too large', png(1025, 256), 'OUTPUT_SIZE'],
  ['translucent', png(512, 288, 200), 'OUTPUT_NOT_OPAQUE'],
  ['blank', encodeFixturePng(512, 288, Buffer.alloc(512 * 288 * 4, 255)), 'REFERENCE_BLANK'],
  ['unsupported bytes', Buffer.from('invalid PNG'), 'OUTPUT_PNG_UNSUPPORTED'],
]) test(`native ${name} is a retained technical rejection, never a successful reference`, t => {
  const { root } = setup(t), { capabilities } = init(root), plan = api.freezeNativeReferencePlan(root, options(capabilities));
  const result = api.receiveResult(root, authorizeAndReserve(root, plan), raw);
  assert.ok(result.technical.issues.includes(issue));
  assert.deepEqual(readFileSync(join(root, 'blobs', `${result.rawSha256}.bin`)), raw);
  rejects(() => api.reviewResult(root, plan.sha256, decision('invalid', result.rawSha256)), 'IMAGE_REVIEW_STATE');
  rejects(() => api.reservePlan(root, plan.sha256), 'RESERVATION_STATE');
});
test('an accepted native reference feeds exact module plans but never relaxes module dimensions or grants compute', t => {
  const { root, kit } = setup(t), { capabilities } = init(root), plan = api.freezeNativeReferencePlan(root, options(capabilities));
  const { result } = complete(root, plan, png());
  const base = { batchId: 'native.modules', referencePlanSha256: plan.sha256, capabilitiesSha256: capabilities.sha256, intent: '' };
  const before = api.inspectWorkflow(root);
  rejects(() => api.freezeModuleBatch(root, kit, base), 'CAPABILITY_SIZE_UNSUPPORTED');
  assert.deepEqual(api.inspectWorkflow(root), before);
  const exactCap = api.createDesignDraft(root, { ...capabilitiesDraft(), capabilityId: 'exact.double' });
  const batch = api.freezeModuleBatch(root, kit, { ...base, capabilitiesSha256: exactCap.sha256 });
  const module = api.getGenerationPlan(root, batch.planSha256s[0]);
  assert.equal(module.format, 'ai_scene_generation_plan_v1'); assert.equal(module.request.output.pixelSize.width, module.target.pixelSize.width);
  assert.deepEqual(module.request.images[0].artifact, result.technical.image);
  rejects(() => api.reservePlan(root, module.sha256), 'AUTHORIZATION_REQUIRED');
});
test('native unknown is terminal and a revision retains the original policy with a fresh confirmation gate', t => {
  const { root } = setup(t), { capabilities } = init(root), plan = api.freezeNativeReferencePlan(root, options(capabilities));
  api.stopAttempt(root, authorizeAndReserve(root, plan), 'indeterminate');
  const revised = api.reviseGenerationPlan(root, plan.sha256, { planId: 'native.r2', capabilitiesSha256: capabilities.sha256, intent: 'Explicit synthetic revision.' });
  assert.deepEqual(revised.recipe.pixelPolicy, plan.recipe.pixelPolicy); assert.deepEqual(revised.recipe.parents, [plan.sha256]);
  rejects(() => api.reservePlan(root, revised.sha256), 'AUTHORIZATION_REQUIRED');
  rejects(() => api.reservePlan(root, plan.sha256), 'RESERVATION_STATE');
  assert.deepEqual(api.inspectWorkflow(root).plans.map(entry => entry.status), ['indeterminate', 'planned']);
});
test('native request replay rejects a forged policy even after the whole journal is rehashed', t => {
  const { root } = setup(t), { capabilities } = init(root); api.freezeNativeReferencePlan(root, options(capabilities));
  let previousSha256 = JSON.parse(readFileSync(join(root, 'workflow.json'))).sha256;
  for (const name of readdirSync(join(root, 'events')).sort()) {
    const event = JSON.parse(readFileSync(join(root, 'events', name)));
    if (event.record.format === 'ai_scene_generation_plan_v2') {
      const { sha256: _ignored, ...body } = event.record; body.request.output.pixelPolicy.minimumShortEdge = 1; event.record = seal(body);
    }
    const { sha256: _ignored, ...body } = event; body.previousSha256 = previousSha256;
    const rebound = seal(body); previousSha256 = rebound.sha256; writeFileSync(join(root, 'events', name), jsonBytes(rebound));
  }
  rejects(() => api.inspectWorkflow(root), 'PLAN_RECOMPILE_MISMATCH');
});
test('text pilot CLI prepares real topic drafts without inventing review or submission evidence', async t => {
  const { parent } = setup(t), output = join(parent, 'pilot');
  const script = fileURLToPath(new URL('../scripts/prepare-text-reference.mjs', import.meta.url));
  const inputs = fileURLToPath(new URL('../examples/forest-ruins', import.meta.url));
  const invoke = () => promisify(execFile)(process.execPath, [script, '--inputs', inputs, '--out', output], { timeout: 15000 });
  const report = JSON.parse((await invoke()).stdout);
  assert.equal(report.actualMediaGenerationCalls, 0); assert.equal(report.frozenPlans, 0); assert.equal(report.computeAuthorizations, 0);
  const status = api.inspectWorkflow(join(output, 'workflow'));
  assert.equal(status.eventCount, 3); assert.equal(status.activeSpecSha256, ''); assert.equal(status.activeStyleSha256, ''); assert.deepEqual(status.plans, []);
  const proposal = JSON.parse(readFileSync(join(output, 'proposal.json')));
  assert.equal(proposal.requestSha256, digest(proposal.request)); assert.equal(proposal.executable, false);
  assert.ok(readFileSync(join(output, 'reference-prompt.txt'), 'utf8').includes('森林遗迹'));
  await assert.rejects(invoke(), error => error.code === 1 && error.stderr.includes('OUTPUT_EXISTS') && !error.stderr.includes(parent));
  const cli = fileURLToPath(new URL('../scripts/workflow.mjs', import.meta.url));
  const preview = await promisify(execFile)(process.execPath, [cli, 'preview-native-reference', '--root', join(output, 'workflow'), '--file', join(output, 'proposal-options.json')], { timeout: 15000 });
  assert.equal(JSON.parse(preview.stdout).result.sha256, proposal.sha256);
});

// Synthetic metadata only; no generated artwork is a test input. Bit-at-a-time
// CRC is intentionally independent of the production lookup-table implementation.
function metadataChunk(name, data = Buffer.from('synthetic untrusted metadata')) {
  const chunk = Buffer.alloc(data.length + 12); chunk.writeUInt32BE(data.length); chunk.write(name, 4, 'ascii'); data.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, -4)) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4); return chunk;
}
const withMetadata = (raw, chunks = [metadataChunk('caBX')]) => Buffer.concat([raw.subarray(0, 33), ...chunks, raw.subarray(33)]);
test('caBX profile reads unchanged pixels and rejects CRC, duplicate, late, oversized and unknown critical chunks', () => {
  const original = png(), metadata = metadataChunk('caBX'), extended = withMetadata(original);
  assert.throws(() => inspectPng(extended));
  assert.deepEqual(inspectPng(extended, { pixelStats: true, allowCabx: true }), inspectPng(original, { pixelStats: true }));
  const corrupt = Buffer.from(metadata); corrupt[8] ^= 1;
  const bad = [withMetadata(original, [corrupt]), withMetadata(original, [metadata, metadata]),
    withMetadata(original, [metadataChunk('caBX', Buffer.alloc(262145))]), withMetadata(original, [metadataChunk('ABCD')]),
    withMetadata(original, [metadataChunk('tRNS')]), Buffer.concat([original.subarray(0, -12), metadata, original.subarray(-12)])];
  for (const raw of bad) assert.throws(() => inspectPng(raw, { allowCabx: true }));
});
test('source reinspection has zero compute, preserves the rejected original and still requires exact-image review', t => {
  const { root, kit } = setup(t), { capabilities } = init(root), plan = api.freezeNativeReferencePlan(root, options(capabilities));
  const raw = withMetadata(png()), result = api.receiveResult(root, authorizeAndReserve(root, plan), raw);
  const rejectedQa = result.technical.sha256;
  const inspection = api.reinspectNativeReference(root, { inspectionId: 'source.inspection.r1', sourcePlanSha256: plan.sha256 });
  assert.equal(inspection.technical.status, 'pass'); assert.equal(inspection.technical.metadataTrust, 'not-verified');
  assert.equal(inspection.request.maximumCalls, 0); assert.equal(inspection.rawSha256, result.rawSha256);
  assert.equal(api.recheckResult(root, plan.sha256, result.rawSha256).sha256, rejectedQa);
  assert.equal(api.recheckResult(root, inspection.sha256, result.rawSha256).sha256, inspection.technical.sha256);
  rejects(() => api.authorizePlan(root, inspection.sha256, decision('no.compute', inspection.sha256, 'approve-compute')), 'AUTHORIZATION_STATE');
  rejects(() => api.reservePlan(root, inspection.sha256), 'AUTHORIZATION_REQUIRED');
  const exactCap = api.createDesignDraft(root, { ...capabilitiesDraft(), capabilityId: 'reinspection.exact' });
  const batchOptions = { batchId: 'inspected.modules', referencePlanSha256: inspection.sha256, capabilitiesSha256: exactCap.sha256, intent: '' };
  rejects(() => api.freezeModuleBatch(root, kit, batchOptions), 'ACCEPTED_REFERENCE_REQUIRED');
  rejects(() => api.reviewResult(root, inspection.sha256, decision('wrong.raw', 'f'.repeat(64))), 'IMAGE_REVIEW_STATE');
  api.reviewResult(root, inspection.sha256, decision('inspected.image', result.rawSha256));
  const batch = api.freezeModuleBatch(root, kit, batchOptions), module = api.getGenerationPlan(root, batch.planSha256s[0]);
  assert.equal(module.request.images[0].artifact.sha256, result.rawSha256);
  const status = api.inspectWorkflow(root);
  assert.equal(status.plans.filter(entry => entry.reserved).length, 1);
  assert.equal(status.plans.find(entry => entry.planSha256 === plan.sha256).status, 'rejected-technical');
  assert.equal(status.plans.find(entry => entry.planSha256 === inspection.sha256).maximumCalls, 0);
  assert.deepEqual(readFileSync(join(root, 'blobs', `${result.rawSha256}.bin`)), raw);
});
test('source reinspection does not hide alpha/size failure or enable a replacement generation', t => {
  const { root } = setup(t), { capabilities } = init(root), plan = api.freezeNativeReferencePlan(root, options(capabilities));
  const result = api.receiveResult(root, authorizeAndReserve(root, plan), withMetadata(png(320, 128, 200)));
  const inspection = api.reinspectNativeReference(root, { inspectionId: 'invalid.source', sourcePlanSha256: plan.sha256 });
  assert.deepEqual(inspection.technical.issues, ['OUTPUT_SIZE', 'OUTPUT_NOT_OPAQUE']);
  rejects(() => api.reviewResult(root, inspection.sha256, decision('invalid.source.review', result.rawSha256)), 'IMAGE_REVIEW_STATE');
  rejects(() => api.reviseGenerationPlan(root, inspection.sha256, { planId: 'bad.retry', capabilitiesSha256: capabilities.sha256, intent: '' }), 'REINSPECTION_NOT_GENERATION');
});
test('source reinspection cannot switch design revisions or assess a plan with no received raw source', t => {
  const { root } = setup(t), { capabilities } = init(root), plan = api.freezeNativeReferencePlan(root, options(capabilities));
  rejects(() => api.reinspectNativeReference(root, { inspectionId: 'no.raw', sourcePlanSha256: plan.sha256 }), 'REINSPECTION_SOURCE');
  api.receiveResult(root, authorizeAndReserve(root, plan), withMetadata(png()));
  const style = api.createDesignDraft(root, { ...styleDraft(), styleId: 'changed.style' });
  api.reviewDesign(root, 'style', decision('changed.style.review', style.sha256));
  rejects(() => api.reinspectNativeReference(root, { inspectionId: 'stale.source', sourcePlanSha256: plan.sha256 }), 'PLAN_STALE');
});
test('source reinspection rejects invented technical evidence even if all hashes are rebound', t => {
  const { root } = setup(t), { capabilities } = init(root), plan = api.freezeNativeReferencePlan(root, options(capabilities));
  api.receiveResult(root, authorizeAndReserve(root, plan), withMetadata(png()));
  api.reinspectNativeReference(root, { inspectionId: 'tamper.source', sourcePlanSha256: plan.sha256 });
  let previousSha256 = JSON.parse(readFileSync(join(root, 'workflow.json'))).sha256;
  for (const name of readdirSync(join(root, 'events')).sort()) {
    const event = JSON.parse(readFileSync(join(root, 'events', name)));
    if (event.record.format === 'ai_scene_reference_reinspection_v1') {
      const { sha256: _ignored, ...body } = event.record; body.technical.metadataTrust = 'verified'; event.record = seal(body);
    }
    const { sha256: _ignored, ...body } = event; body.previousSha256 = previousSha256;
    const rebound = seal(body); previousSha256 = rebound.sha256; writeFileSync(join(root, 'events', name), jsonBytes(rebound));
  }
  rejects(() => api.inspectWorkflow(root), 'REINSPECTION_RECOMPILE_MISMATCH');
});

function rejectedEditSource(root, capabilities) {
  const original = api.freezeNativeReferencePlan(root, options(capabilities));
  const result = api.receiveResult(root, authorizeAndReserve(root, original), withMetadata(png()));
  const inspection = api.reinspectNativeReference(root, { inspectionId: 'edit.source', sourcePlanSha256: original.sha256 });
  return { original, result, inspection };
}
test('native edits require the exact reviewed source and image capability, bind its rejection, and spend no old authorization', t => {
  const { root } = setup(t), { capabilities } = init(root), { original, result, inspection } = rejectedEditSource(root, capabilities);
  const editOptions = { ...options(capabilities), planId: 'edit.r1', parents: [original.sha256], editSourceSha256: inspection.sha256, intent: 'Simplify texture and flatten the terrain tops.' };
  rejects(() => api.freezeNativeReferenceEdit(root, editOptions), 'EDIT_SOURCE_REVIEW_REQUIRED');
  api.reviewResult(root, inspection.sha256, decision('source.reject', result.rawSha256, 'reject'));
  const noImages = api.createDesignDraft(root, { ...capabilitiesDraft(), capabilityId: 'no.edit.images', maxInputImages: 0 });
  rejects(() => api.freezeNativeReferenceEdit(root, { ...editOptions, capabilitiesSha256: noImages.sha256 }), 'CAPABILITY_INPUT_UNSUPPORTED');
  const amended = api.createDesignDraft(root, { ...styleDraft(), styleId: 'amended.style', rules: ['Simplify texture and flatten the terrain tops.'] });
  api.reviewDesign(root, 'style', decision('amended.style.review', amended.sha256));
  const edit = api.freezeNativeReferenceEdit(root, editOptions);
  assert.equal(edit.format, 'ai_scene_generation_plan_v3'); assert.equal(edit.request.task, 'reference-edit');
  assert.equal(edit.request.images[0].role, 'edit-target'); assert.equal(edit.request.images[0].artifact.sha256, result.rawSha256);
  assert.equal(edit.referenceEvidence[0].assessmentSha256, inspection.sha256); assert.equal(edit.recipe.styleSha256, amended.sha256);
  rejects(() => api.reservePlan(root, edit.sha256), 'AUTHORIZATION_REQUIRED');
  const editedResult = api.receiveResult(root, authorizeAndReserve(root, edit), withMetadata(png(768, 256)));
  assert.equal(editedResult.technical.status, 'pass'); assert.equal(editedResult.technical.policy, 'native-reference-png-cabx-v1');
  assert.equal(api.inspectWorkflow(root).plans.find(entry => entry.planSha256 === inspection.sha256).status, 'rejected-visual');
});
test('native edit unknown remains terminal and the next explicit plan binds the same source with a fresh confirmation', t => {
  const { root } = setup(t), { capabilities } = init(root), { original, result, inspection } = rejectedEditSource(root, capabilities);
  api.reviewResult(root, inspection.sha256, decision('source.reject', result.rawSha256, 'reject'));
  const edit = api.freezeNativeReferenceEdit(root, { ...options(capabilities), planId: 'edit.r1', parents: [original.sha256], editSourceSha256: inspection.sha256 });
  api.stopAttempt(root, authorizeAndReserve(root, edit), 'indeterminate');
  const revised = api.reviseGenerationPlan(root, edit.sha256, { planId: 'edit.r2', capabilitiesSha256: capabilities.sha256, intent: 'Explicit new test decision.' });
  assert.equal(revised.recipe.editSourceSha256, inspection.sha256); assert.deepEqual(revised.recipe.parents, [edit.sha256]);
  rejects(() => api.reservePlan(root, revised.sha256), 'AUTHORIZATION_REQUIRED');
  rejects(() => api.reservePlan(root, edit.sha256), 'RESERVATION_STATE');
});
test('native edit cannot bypass output alpha checks through its metadata-compatible profile', t => {
  const { root } = setup(t), { capabilities } = init(root), { original, result, inspection } = rejectedEditSource(root, capabilities);
  api.reviewResult(root, inspection.sha256, decision('source.reject', result.rawSha256, 'reject'));
  const edit = api.freezeNativeReferenceEdit(root, { ...options(capabilities), planId: 'edit.alpha', parents: [original.sha256], editSourceSha256: inspection.sha256 });
  const output = api.receiveResult(root, authorizeAndReserve(root, edit), withMetadata(png(512, 288, 200)));
  assert.deepEqual(output.technical.issues, ['OUTPUT_NOT_OPAQUE']);
  assert.equal(api.recheckResult(root, edit.sha256, output.rawSha256).sha256, output.technical.sha256);
});
