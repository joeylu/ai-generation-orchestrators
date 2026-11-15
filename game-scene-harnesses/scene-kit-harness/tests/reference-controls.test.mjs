import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as api from '../src/generation/index.mjs';
import * as project from '../src/reference-led-pipeline.mjs';
import { controlGuideRecipe, renderControlGuides } from '../src/reference-controls.mjs';
import { inspectPng, encodeRgbaPng } from '../src/png.mjs';
import { hash, seal, unseal, jsonBytes, imageRef } from '../src/generation/common.mjs';
import { decision } from './helpers/generation.mjs';
import { controlFixture, importedControls, reboundPacket, controlMeasurement, syntheticControlImage } from './helpers/reference-controls.mjs';

const rejects = (fn, code) => assert.throws(fn, error => error.errors?.some(e => e.code === code));
test('versioned guide producer preserves the two approved raster fingerprints and separates overview', () => {
  assert.throws(() => { controlGuideRecipe.projection.points[0][0] = 50000; }, TypeError);
  const altered = unseal(structuredClone(controlGuideRecipe)); altered.projection.points[0][0] = 50000;
  rejects(() => renderControlGuides(seal(altered)), 'CONTROL_GUIDE_RECIPE');
  const images = renderControlGuides();
  assert.equal(hash(images.get('projection-guide.png')), '2619d46aa41b10867799487cb0547579081a5ba45d95e817d2b2a760ac396e43');
  assert.equal(hash(images.get('focus-guide.png')), '883199d7f74d3fa84b8322e90d1ad6434723fbb1ddc61d7dee39cf79adbd871b');
  assert.equal(inspectPng(images.get('review-overview.png')).width, 1040);
});
test('control import and exact-packet acceptance do not authorize compute or accept source artwork', t => {
  const f = controlFixture(t), before = api.inspectWorkflow(f.workflow), { c, options } = importedControls(f, false);
  assert.equal(api.inspectWorkflow(f.workflow).eventCount, before.eventCount + 1);
  rejects(() => api.previewReferenceControlledPlan(f.workflow, options), 'CONTROL_REVIEW_REQUIRED');
  rejects(() => api.reviewReferenceControls(f.workflow, c.sha256, decision('wrong.target', c.sha256)), 'CONTROL_REVIEW_STATE');
  api.reviewReferenceControls(f.workflow, c.sha256, decision('controls.accept', f.packet.sha256));
  assert.equal(api.inspectWorkflow(f.workflow).plans.length, 1);
  assert.equal(api.inspectWorkflow(f.workflow).plans[0].status, 'rejected-visual');
  assert.deepEqual(api.getReferenceControls(f.workflow, c.sha256), c);
});
test('controlled preview is read-only and v20 freezes exactly the two reviewed roles with unchanged content', t => {
  const f = controlFixture(t), { options } = importedControls(f), before = api.inspectWorkflow(f.workflow);
  const preview = project.previewReferenceControlledProject(f.root, options); assert.equal(preview.executable, false);
  assert.equal(preview.generationCalls, 0); assert.deepEqual(api.inspectWorkflow(f.workflow), before);
  const state = project.planReferenceControlledProject(f.root, options), plan = api.getGenerationPlan(f.workflow, state.reference.planSha256);
  assert.equal(plan.sha256, preview.plan.sha256); assert.equal(plan.format, 'ai_scene_generation_plan_v20');
  assert.deepEqual(plan.request.images.map(i => i.role), ['internal-projection-example', 'internal-focus-example']);
  assert.deepEqual(plan.referenceRequirements, f.baseline.referenceRequirements); assert.deepEqual(plan.target, f.baseline.target);
  assert.equal(plan.request.prompt, f.artifacts.get('prompt-draft.txt').toString('utf8'));
  assert.equal(plan.request.prompt.includes('parallaxX'), false); assert.equal(plan.controlEvidence.pixelLocking, false);
  for (let i = 0; i < 2; i++) assert.deepEqual(api.readGenerationInput(f.workflow, plan.sha256, i), f.artifacts.get(i ? 'focus-guide.png' : 'projection-guide.png'));
  assert(!plan.request.images.some(i => i.artifact.sha256 === hash(f.artifacts.get('review-overview.png'))));
  assert(!plan.request.images.some(i => i.artifact.sha256 === f.baseline.request.images[0].artifact.sha256));
  assert.deepEqual(plan.inputPolicy.omittedStyleImages, f.spec.inputs.map(i => i.artifact));
  assert.equal(state.stage, 'awaiting-reference-compute'); assert.equal(state.reconstructionTargetSha256, null);
});
for (const [name, options, code] of [
  ['unreviewed source', { rejected: false }, 'CONTROL_REJECTED_SOURCE_REQUIRED'],
  ['custom anchor removal', { custom: true }, 'CONTROL_STYLE_PROFILE'],
]) test(`control import refuses ${name} without adding a record`, t => {
  const f = controlFixture(t, options), before = api.inspectWorkflow(f.workflow);
  rejects(() => api.importReferenceControls(f.workflow, { controlId: 'invalid', sourcePlanSha256: f.baseline.sha256, reviewPacket: f.packet }, f.artifacts), code);
  assert.deepEqual(api.inspectWorkflow(f.workflow), before);
});
test('packet paths are allowlisted before artifact lookup', t => {
  const f = controlFixture(t), p = unseal(structuredClone(f.packet)); p.artifacts[0].path = '../outside.png';
  rejects(() => api.importReferenceControls(f.workflow, { controlId: 'bad.paths', sourcePlanSha256: f.baseline.sha256, reviewPacket: seal(p) }, f.artifacts), 'CONTROL_REVIEW_ARTIFACTS');
});
test('rehashed changed guide, prompt or role evidence still fails deterministic control validation', t => {
  for (const [change, code] of [
    [f => { const image = inspectPng(f.artifacts.get('projection-guide.png'), { includePixels: true }); image.rgba[0] ^= 1;
      f.artifacts.set('projection-guide.png', encodeRgbaPng(image.width, image.height, image.rgba)); }, 'CONTROL_GUIDE_REPLAY'],
    [f => f.artifacts.set('prompt-draft.txt', Buffer.from('Altered prompt.')), 'CONTROL_PROMPT_MISMATCH'],
    [f => { const p = unseal(JSON.parse(f.artifacts.get('proposal.json'))); p.proposedModelInputs.reverse(); f.artifacts.set('proposal.json', jsonBytes(seal(p))); }, 'CONTROL_GUIDE_BINDING'],
  ]) {
    const f = controlFixture(t); change(f);
    rejects(() => api.importReferenceControls(f.workflow, { controlId: 'tampered', sourcePlanSha256: f.baseline.sha256, reviewPacket: reboundPacket(f) }, f.artifacts), code);
  }
});
test('two-image capability and active-design checks are enforced after control acceptance', t => {
  const f = controlFixture(t, { maxImages: 1 }), { options } = importedControls(f);
  rejects(() => api.previewReferenceControlledPlan(f.workflow, options), 'CAPABILITY_INPUT_UNSUPPORTED');
  const g = controlFixture(t), controls = importedControls(g), old = unseal(g.spec);
  const next = api.createDesignDraft(g.workflow, { ...old, specId: 'changed.spec', description: 'A different synthetic scene.' });
  api.reviewDesign(g.workflow, 'spec', decision('changed.accept', next.sha256));
  rejects(() => api.previewReferenceControlledPlan(g.workflow, controls.options), 'CONTROL_SOURCE_STALE');
});
test('new controlled compute is single-use, delivers exact guide bytes, and unknown cannot be retried', async t => {
  const f = controlFixture(t), { options } = importedControls(f); project.planReferenceControlledProject(f.root, options);
  const state = project.inspectReferenceLedProject(f.root), plan = api.getGenerationPlan(f.workflow, state.reference.planSha256); let calls = 0;
  const adapter = { preflight: async () => {}, generate: async input => { calls++; assert.equal(input.images.length, 2);
    assert.deepEqual(input.images[0].bytes, f.artifacts.get('projection-guide.png')); assert.deepEqual(input.images[1].bytes, f.artifacts.get('focus-guide.png'));
    throw Error('Synthetic unknown output'); } };
  await assert.rejects(project.runReferenceLedProject(f.root, adapter)); assert.equal(calls, 0);
  project.authorizeReferenceLedProject(f.root, decision('controlled.compute', plan.sha256, 'approve-compute'));
  const after = await project.runReferenceLedProject(f.root, adapter); assert.equal(after.reference.status, 'indeterminate'); assert.equal(calls, 1);
  await assert.rejects(project.runReferenceLedProject(f.root, adapter)); assert.equal(calls, 1);
  rejects(() => api.reviseGenerationPlan(f.workflow, plan.sha256, { planId: 'changed.prompt', capabilitiesSha256: f.cap.sha256, intent: 'Unreviewed request.' }), 'CONTROL_PROMPT_FIXED');
  const next = api.reviseGenerationPlan(f.workflow, plan.sha256, { planId: 'controlled.r2', capabilitiesSha256: f.cap.sha256, intent: '' });
  assert.equal(next.format, 'ai_scene_generation_plan_v20'); assert.notEqual(next.sha256, plan.sha256);
  rejects(() => api.reservePlan(f.workflow, next.sha256), 'AUTHORIZATION_REQUIRED');
});
test('v20 keeps the seven-standard measured gate and blocks legacy assembly even after target acceptance', async t => {
  const f = controlFixture(t), { options } = importedControls(f); project.planReferenceControlledProject(f.root, options);
  const state = project.inspectReferenceLedProject(f.root), plan = api.getGenerationPlan(f.workflow, state.reference.planSha256);
  project.authorizeReferenceLedProject(f.root, decision('controlled.compute', plan.sha256, 'approve-compute'));
  await project.runReferenceLedProject(f.root, { preflight: async () => {}, generate: async () => syntheticControlImage(9) });
  const result = api.getGenerationResult(f.workflow, plan.sha256).result;
  rejects(() => api.reviewResult(f.workflow, plan.sha256, decision('raw.accept', result.rawSha256)), 'STANDARD_REFERENCE_REVIEW_REQUIRED');
  const good = controlMeasurement(plan, result.rawSha256), bad = unseal(structuredClone(good)); bad.quality[4].verdict = 'fail';
  const failed = api.buildMeasuredReferenceReview(f.workflow, plan.sha256, seal(bad), join(f.parent, 'failed-review'));
  rejects(() => api.reviewMeasuredReference(f.workflow, plan.sha256, seal(bad), decision('bad.accept', failed.packetSha256)), 'REFERENCE_REQUIREMENTS_NOT_SATISFIED');
  const ready = api.buildMeasuredReferenceReview(f.workflow, plan.sha256, good, join(f.parent, 'good-review'));
  api.reviewMeasuredReference(f.workflow, plan.sha256, good, decision('good.accept', ready.packetSha256));
  assert.equal(api.getReferenceReconstructionTarget(f.workflow, plan.sha256).format, 'ai_scene_reference_reconstruction_target_v2');
  rejects(() => api.freezeSceneSourceBatch(f.workflow, { batchId: 'invalid', referencePlanSha256: plan.sha256, capabilitiesSha256: f.cap.sha256, intent: '' }), 'STANDARD_RECONSTRUCTION_NOT_IMPLEMENTED');
});
test('rehashed journal cannot replace a model control image with the review overview', t => {
  const f = controlFixture(t), { options } = importedControls(f); api.freezeReferenceControlledPlan(f.workflow, options);
  let previousSha256 = JSON.parse(readFileSync(join(f.workflow, 'workflow.json'))).sha256;
  for (const name of readdirSync(join(f.workflow, 'events')).sort()) {
    const event = JSON.parse(readFileSync(join(f.workflow, 'events', name))), body = unseal(event), record = unseal(event.record);
    if (record.format === 'ai_scene_generation_plan_v20') {
      record.request.images[0].artifact = imageRef(f.artifacts.get('review-overview.png')); body.record = seal(record);
    }
    body.previousSha256 = previousSha256; const rebound = seal(body); previousSha256 = rebound.sha256;
    writeFileSync(join(f.workflow, 'events', name), jsonBytes(rebound));
  }
  rejects(() => api.inspectWorkflow(f.workflow), 'PLAN_RECOMPILE_MISMATCH');
});
test('CLI imports reviewed control payloads and previews without a compute or yes shortcut', async t => {
  const f = controlFixture(t), directory = join(f.parent, 'review'); mkdirSync(directory);
  for (const [name, data] of f.artifacts) writeFileSync(join(directory, name), data);
  writeFileSync(join(directory, 'review-packet.json'), jsonBytes(f.packet));
  const cli = fileURLToPath(new URL('../scripts/reference.mjs', import.meta.url)), run = promisify(execFile);
  const importOptions = join(f.parent, 'import.json'); writeFileSync(importOptions, jsonBytes({ controlId: 'cli.control', sourcePlanSha256: f.baseline.sha256 }));
  const { stdout } = await run(process.execPath, [cli, 'controls-import', '--root', f.root, '--review', directory, '--options', importOptions]);
  const controls = JSON.parse(stdout), receipt = join(f.parent, 'review.json'); writeFileSync(receipt, jsonBytes(decision('cli.controls.accept', f.packet.sha256)));
  await run(process.execPath, [cli, 'controls-review', '--root', f.root, '--control', controls.sha256, '--decision', receipt]);
  const options = join(f.parent, 'options.json'); writeFileSync(options, jsonBytes({ planId: 'cli.plan', controlsSha256: controls.sha256 }));
  const before = api.inspectWorkflow(f.workflow), preview = await run(process.execPath, [cli, 'preview-controlled', '--root', f.root, '--options', options]);
  assert.equal(JSON.parse(preview.stdout).plan.request.images.length, 2); assert.deepEqual(api.inspectWorkflow(f.workflow), before);
  await assert.rejects(run(process.execPath, [cli, 'controlled', '--root', f.root, '--options', options, '--yes', 'true']));
  assert.deepEqual(api.inspectWorkflow(f.workflow), before);
});
