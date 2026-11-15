import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as api from '../src/generation/index.mjs';
import * as project from '../src/reference-led-pipeline.mjs';
import { REFERENCE_STANDARDS } from '../src/reference-measurement.mjs';
import { seal, unseal, jsonBytes, hash } from '../src/generation/common.mjs';
import { encodeRgbaPng } from '../src/png.mjs';
import { setup, decision, authorizeAndReserve } from './helpers/generation.mjs';

const rejects = (fn, code) => assert.throws(fn, error => error.errors?.some(e => e.code === code));
const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
function image(seed = 0) {
  const rgba = Buffer.alloc(512 * 288 * 4, 255);
  for (let p = 0; p < rgba.length; p += 4) rgba[p] = (p / 4 + seed) % 192;
  return encodeRgbaPng(512, 288, rgba);
}
function prepare(t, { custom = false, withImage = true, rejected = true, textToImage = true } = {}) {
  const f = setup(t), input = join(f.parent, 'style.png'); writeFileSync(input, image(4));
  const brief = { projectId: 'isolation.fixture', description: 'Synthetic side-view ground and sky.', viewport: { width: 256, height: 144 }, maxAspectErrorPermille: 5,
    inputs: withImage ? [{ role: 'style-reference', path: input }] : [],
    style: { mode: custom ? 'custom' : 'preset', preset: custom ? null : 'clean-handpaint', name: 'Synthetic style', rules: [], anchorPath: custom ? input : null },
    requirements: seal({ format: 'ai_scene_reference_requirements_v1', requirementsId: 'fixture.requirements',
      layers: [{ layerId: 'sky', kind: 'background', zIndex: 0, parallaxX: 0 }, { layerId: 'ground', kind: 'terrain', zIndex: 10, parallaxX: 1 }],
      subjects: [{ subjectId: 'sky', layerId: 'sky', role: 'sky', content: 'Synthetic sky.', count: { min: 1, max: 1 }, placementHint: 'wide' },
        { subjectId: 'ground', layerId: 'ground', role: 'solid-terrain', content: 'Synthetic ground.', count: { min: 1, max: 1 }, placementHint: 'wide' }],
      compositionNotes: ['Measure the actual image after review.'], standards: REFERENCE_STANDARDS.map(key => ({ key, requirement: `Synthetic ${key} rule.` })) }) };
  if (custom) brief.style.rules = ['Synthetic custom brushwork.'];
  let state = project.initReferenceLedProject(f.root, brief, { purpose: 'synthetic-simulation' });
  project.reviewReferenceLedDesign(f.root, { spec: decision('spec', state.design.specSha256), style: decision('style', state.design.styleSha256) });
  const workflow = join(f.root, 'workflow');
  const cap = api.createDesignDraft(workflow, { ...unseal(JSON.parse(readFileSync(join(f.root, 'capabilities.json')))), capabilityId: 'isolation.host', textToImage });
  const baseline = api.freezeReferenceLedPlan(workflow, { planId: 'reference.baseline', parents: [], capabilitiesSha256: cap.sha256,
    pixelPolicy: { mode: 'native-reference', orientation: 'landscape', minimumShortEdge: 256, maximumWidth: 1024, maximumHeight: 1024 },
    intent: 'Use the supplied style image only for style; no predefined geometry.' });
  const ticket = authorizeAndReserve(workflow, baseline); api.recordSubmission(workflow, ticket);
  const result = api.receiveResult(workflow, ticket, image());
  if (rejected) api.reviewResult(workflow, baseline.sha256, decision('baseline.reject', result.rawSha256, 'reject'));
  return { ...f, brief, workflow, baseline, result, cap,
    options: { planId: 'reference.text-only', baselinePlanSha256: baseline.sha256, intent: 'Diagnostic: no image inputs. Retain accepted content, standards and preset text; measure actual layout after review.' } };
}
function measured(plan, rawSha256) {
  return seal({ format: 'ai_scene_measured_reference_layout_v1', planSha256: plan.sha256, rawSha256, coordinates: 'canonical-reference-frame',
    layers: plan.referenceRequirements.layers,
    instances: [{ instanceId: 'sky.actual', subjectId: 'sky', layerId: 'sky', visibleEnvelope: rect(0, 0, 256, 94), anchor: { x: 0, y: 0 },
      visibility: 'frame-clipped', anchorEvidence: 'observed', notes: 'Synthetic observed sky.' },
    { instanceId: 'ground.actual', subjectId: 'ground', layerId: 'ground', visibleEnvelope: rect(0, 94, 256, 50), anchor: { x: 0, y: 94 },
      visibility: 'frame-clipped', anchorEvidence: 'observed', notes: 'Synthetic observed ground; hidden content unknown.' }],
    surfaces: [{ surfaceId: 'top', instanceId: 'ground.actual', points: [{ x: 0, y: 94 }, { x: 256, y: 94 }], evidence: 'observed', notes: 'Synthetic surface.' }],
    quality: REFERENCE_STANDARDS.map(key => ({ key, verdict: 'pass', notes: `Synthetic ${key} observation; test double only.` })) });
}
test('explicit isolation proposal removes all image pixels while holding accepted content, style text, standards and original rejection', t => {
  const f = prepare(t), before = api.inspectWorkflow(f.workflow), p = project.previewReferenceLedIsolationProject(f.root, f.options);
  assert.equal(p.executable, false); assert.equal(p.generationCalls, 0); assert.deepEqual(api.inspectWorkflow(f.workflow), before);
  const plan = p.plan; assert.equal(plan.format, 'ai_scene_generation_plan_v19'); assert.deepEqual(plan.request.images, []);
  assert.deepEqual(plan.referenceRequirements, f.baseline.referenceRequirements); assert.deepEqual(plan.target, f.baseline.target);
  assert.deepEqual(plan.designReviews, f.baseline.designReviews); assert.equal(plan.recipe.specSha256, f.baseline.recipe.specSha256);
  assert.equal(plan.recipe.styleSha256, f.baseline.recipe.styleSha256);
  const prefix = text => text.slice(0, text.lastIndexOf('\n\nINTENT='));
  assert.equal(prefix(plan.request.prompt), prefix(f.baseline.request.prompt));
  assert.deepEqual(plan.inputPolicy.omittedStyleImages, f.baseline.request.images.map(i => i.artifact));
  assert.equal(plan.experimentEvidence.baselineRawSha256, f.result.rawSha256);
  assert.equal(plan.experimentEvidence.improvement, 'not-tested'); assert.equal(plan.experimentEvidence.automaticStyleExtraction, false);
  assert.equal(hash(api.readGenerationInput(f.workflow, f.baseline.sha256, 0)), f.baseline.request.images[0].artifact.sha256);
  const identicalPrompt = api.previewReferenceLedIsolation(f.workflow, { ...f.options, intent: f.baseline.recipe.intent }).plan;
  assert.equal(identicalPrompt.request.prompt, f.baseline.request.prompt);
  assert.deepEqual(identicalPrompt.experimentEvidence.changes, ['all-uploaded-style-images-omitted']);
});
for (const [name, changes, code] of [
  ['unreviewed image', { rejected: false }, 'ISOLATION_REJECTED_BASELINE_REQUIRED'],
  ['custom anchor', { custom: true }, 'ISOLATION_PRESET_STYLE_REQUIRED'],
  ['already text-only baseline', { withImage: false }, 'ISOLATION_STYLE_IMAGE_REQUIRED'],
  ['image-only host', { textToImage: false }, 'CAPABILITY_INPUT_UNSUPPORTED'],
]) test(`isolation refuses ${name} without changing the workflow`, t => {
  const f = prepare(t, changes), before = api.inspectWorkflow(f.workflow);
  rejects(() => api.previewReferenceLedIsolation(f.workflow, f.options), code); assert.deepEqual(api.inspectWorkflow(f.workflow), before);
});
test('isolation rejects a stale accepted design instead of silently changing content', t => {
  const f = prepare(t), old = unseal(JSON.parse(readFileSync(join(f.root, 'spec-draft.json'))));
  const spec = api.createDesignDraft(f.workflow, { ...old, specId: 'changed.spec', description: 'Changed synthetic scene.' });
  api.reviewDesign(f.workflow, 'spec', decision('changed.spec.accept', spec.sha256));
  rejects(() => api.previewReferenceLedIsolation(f.workflow, f.options), 'ISOLATION_BASELINE_STALE');
});
test('new isolation compute is single use and unknown requires another exact plan and decision', async t => {
  const f = prepare(t), proposal = api.previewReferenceLedIsolation(f.workflow, f.options);
  let state = project.planReferenceLedIsolationProject(f.root, f.options), calls = 0;
  assert.equal(state.reference.planSha256, proposal.plan.sha256); assert.equal(state.stage, 'awaiting-reference-compute');
  const adapter = { preflight: async () => {}, generate: async request => { calls++; assert.deepEqual(request.images, []); throw Error('Synthetic lost result'); } };
  await assert.rejects(project.runReferenceLedProject(f.root, adapter)); assert.equal(calls, 0);
  rejects(() => api.reservePlan(f.workflow, proposal.plan.sha256), 'AUTHORIZATION_REQUIRED');
  project.authorizeReferenceLedProject(f.root, decision('isolation.compute', proposal.plan.sha256, 'approve-compute'));
  state = await project.runReferenceLedProject(f.root, adapter); assert.equal(calls, 1); assert.equal(state.reference.status, 'indeterminate');
  await assert.rejects(project.runReferenceLedProject(f.root, adapter)); assert.equal(calls, 1);
  const next = api.reviseGenerationPlan(f.workflow, proposal.plan.sha256, { planId: 'text-only.r2', capabilitiesSha256: f.cap.sha256, intent: f.options.intent });
  assert.equal(next.format, 'ai_scene_generation_plan_v19'); assert.notEqual(next.sha256, proposal.plan.sha256);
  rejects(() => api.reservePlan(f.workflow, next.sha256), 'AUTHORIZATION_REQUIRED');
  assert.equal(api.inspectWorkflow(f.workflow).plans[0].status, 'rejected-visual');
});
test('v19 output uses the same seven-standard measured target gate and cannot feed legacy source assembly', async t => {
  const f = prepare(t); project.planReferenceLedIsolationProject(f.root, f.options);
  const state = project.inspectReferenceLedProject(f.root), plan = api.getGenerationPlan(f.workflow, state.reference.planSha256);
  project.authorizeReferenceLedProject(f.root, decision('isolation.compute', plan.sha256, 'approve-compute'));
  await project.runReferenceLedProject(f.root, { preflight: async () => {}, generate: async request => { assert.equal(request.images.length, 0); return image(9); } });
  const result = api.getGenerationResult(f.workflow, plan.sha256).result; assert.equal(result.technical.status, 'pass');
  rejects(() => api.reviewResult(f.workflow, plan.sha256, decision('raw.accept', result.rawSha256)), 'STANDARD_REFERENCE_REVIEW_REQUIRED');
  const good = measured(plan, result.rawSha256), bad = unseal(structuredClone(good)); bad.quality[0].verdict = 'fail';
  const failed = api.buildMeasuredReferenceReview(f.workflow, plan.sha256, seal(bad), join(f.parent, 'failed-review'));
  rejects(() => api.reviewMeasuredReference(f.workflow, plan.sha256, seal(bad), decision('bad.accept', failed.packetSha256)), 'REFERENCE_REQUIREMENTS_NOT_SATISFIED');
  const review = api.buildMeasuredReferenceReview(f.workflow, plan.sha256, good, join(f.parent, 'good-review'));
  api.verifyMeasuredReferenceReview(f.workflow, plan.sha256, good, join(f.parent, 'good-review'));
  api.reviewMeasuredReference(f.workflow, plan.sha256, good, decision('good.accept', review.packetSha256));
  const target = api.getReferenceReconstructionTarget(f.workflow, plan.sha256);
  assert.equal(target.format, 'ai_scene_reference_reconstruction_target_v2'); assert.equal(target.planSha256, plan.sha256);
  rejects(() => api.freezeSceneSourceBatch(f.workflow, { batchId: 'invalid', referencePlanSha256: plan.sha256, capabilitiesSha256: f.cap.sha256, intent: '' }), 'STANDARD_RECONSTRUCTION_NOT_IMPLEMENTED');
});
test('rehashed journal changes to isolation inputs or held geometry are rejected on replay', t => {
  for (const mutate of [r => { r.request.images = [{ role: 'style-reference', artifact: r.inputPolicy.omittedStyleImages[0] }]; },
    r => { r.recipe.pixelPolicy.minimumShortEdge++; }]) {
    const f = prepare(t); api.freezeReferenceLedIsolation(f.workflow, f.options);
    let previousSha256 = JSON.parse(readFileSync(join(f.workflow, 'workflow.json'))).sha256;
    for (const name of readdirSync(join(f.workflow, 'events')).sort()) {
      const event = JSON.parse(readFileSync(join(f.workflow, 'events', name))), body = unseal(event), record = unseal(event.record);
      if (record.format === 'ai_scene_generation_plan_v19') { mutate(record); body.record = seal(record); }
      body.previousSha256 = previousSha256; const rebound = seal(body); previousSha256 = rebound.sha256;
      writeFileSync(join(f.workflow, 'events', name), jsonBytes(rebound));
    }
    assert.throws(() => api.inspectWorkflow(f.workflow));
  }
});
test('CLI isolation preview is read-only and does not accept a yes shortcut', async t => {
  const f = prepare(t), options = join(f.parent, 'isolation-options.json'); writeFileSync(options, jsonBytes(f.options));
  const cli = fileURLToPath(new URL('../scripts/reference.mjs', import.meta.url)), before = api.inspectWorkflow(f.workflow);
  const { stdout } = await promisify(execFile)(process.execPath, [cli, 'preview-isolation', '--root', f.root, '--options', options]);
  assert.equal(JSON.parse(stdout).plan.request.images.length, 0); assert.deepEqual(api.inspectWorkflow(f.workflow), before);
  await assert.rejects(promisify(execFile)(process.execPath, [cli, 'isolation', '--root', f.root, '--options', options, '--yes', 'true']));
  assert.deepEqual(api.inspectWorkflow(f.workflow), before);
});
