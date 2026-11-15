import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as api from '../src/generation/index.mjs';
import { seal, unseal, jsonBytes } from '../src/generation/common.mjs';
import { flexibleBlueprintGuide } from '../src/reference-layout.mjs';
import { encodeRgbaPng } from '../src/png.mjs';
import { setup, decision, specDraft, styleDraft, capabilitiesDraft, authorizeAndReserve } from './helpers/generation.mjs';

const rejects = (fn, code) => assert.throws(fn, error => error.errors?.some(e => e.code === code));
const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
function image(seed = 0, alpha = 255) {
  const rgba = Buffer.alloc(512 * 288 * 4, 255);
  for (let p = 0; p < rgba.length; p += 4) { rgba[p] = (p / 4 + seed) % 192; rgba[p + 3] = alpha; }
  return encodeRgbaPng(512, 288, rgba);
}
function prepare(t, { custom = false, withImage = true, alpha = 255 } = {}) {
  const f = setup(t), { root } = f;
  api.initWorkflow(root, { projectId: 'experiment.fixture', purpose: 'synthetic-simulation', compiler: 'scene-kit-native-reference-v2' });
  const b = seal({ format: 'ai_scene_reference_blueprint_v2', blueprintId: 'fixture.layout', sceneDescription: 'Synthetic terrain and sky.',
    projection: 'pure-sideview', viewport: { width: 256, height: 144 },
    layers: [{ layerId: 'sky', kind: 'background', zIndex: 0, parallaxX: 0 }, { layerId: 'ground', kind: 'terrain', zIndex: 10, parallaxX: 1 }],
    instances: [{ instanceId: 'ground', layerId: 'ground', role: 'terrain', content: 'Synthetic ground.', polygon: rect(0, 100, 256, 44), anchor: { x: 0, y: 100 }, constraint: { mode: 'hard' } },
      { instanceId: 'sky', layerId: 'sky', role: 'sky', content: 'Synthetic sky.', constraint: { mode: 'art-region', region: rect(0, 0, 256, 144),
        anchorRegion: rect(0, 0, 256, 144), minOccupancyPermille: 1000, maxOccupancyPermille: 1000, maxOutsidePermille: 0, shapeIntent: 'Broad shapes.' } }],
    protectedRegions: [], tolerances: { maxAnchorErrorPx: 4, minEnvelopeIoUPermille: 850, maxAspectErrorPermille: 5 } });
  const guide = api.importWorkflowImage(root, flexibleBlueprintGuide(b).bytes), styleImage = api.importStandardWorkflowImage(root, image(7));
  const spec = api.createDesignDraft(root, { ...specDraft(), format: 'ai_scene_spec_v2', description: b.sceneDescription,
    viewport: b.viewport, inputs: withImage ? [{ role: 'style-reference', artifact: styleImage }] : [], referenceLayout: { blueprintSha256: b.sha256, guide } });
  const style = api.createDesignDraft(root, { ...styleDraft(), format: 'ai_scene_style_v2', ...(custom ? { mode: 'custom', anchors: [styleImage] } : {}) });
  const cap = api.createDesignDraft(root, capabilitiesDraft());
  api.reviewSceneDesigns(root, { spec: decision('spec', spec.sha256), style: decision('style', style.sha256) });
  const baseline = api.freezeStandardReferencePlan(root, { planId: 'reference.baseline', parents: [], capabilitiesSha256: cap.sha256,
    blueprint: b, pixelPolicy: { mode: 'native-reference', orientation: 'landscape', minimumShortEdge: 256, maximumWidth: 1024, maximumHeight: 1024 },
    intent: 'Input 1 is layout; input 2 is style only.' });
  const ticket = authorizeAndReserve(root, baseline); api.recordSubmission(root, ticket);
  const result = api.receiveResult(root, ticket, image(0, alpha));
  const options = { planId: 'reference.no-style-image', baselinePlanSha256: baseline.sha256, intent: 'Input 1 is layout only. Use the accepted preset text.' };
  return { ...f, b, baseline, result, options, cap };
}
function observed(plan, rawSha256) {
  return seal({ format: 'ai_scene_reference_observation_v1', planSha256: plan.sha256, rawSha256, coordinates: 'canonical-reference-frame',
    instances: [{ instanceId: 'ground', polygon: plan.recipe.blueprint.instances[0].polygon, anchor: { x: 0, y: 100 } },
      { instanceId: 'sky', polygon: rect(0, 0, 256, 144), anchor: { x: 128, y: 0 } }] });
}
function rewrite(root, mutate) {
  let previousSha256 = JSON.parse(readFileSync(join(root, 'workflow.json'))).sha256;
  for (const name of readdirSync(join(root, 'events')).sort()) {
    const event = JSON.parse(readFileSync(join(root, 'events', name))), body = unseal(event), record = unseal(event.record);
    if (record.format === 'ai_scene_generation_plan_v17') { mutate(record); body.record = seal(record); }
    body.previousSha256 = previousSha256; const rebound = seal(body); previousSha256 = rebound.sha256;
    writeFileSync(join(root, 'events', name), jsonBytes(rebound));
  }
}
test('read-only experiment proposal preserves baseline, layout, text style and tolerances while explicitly omitting style pixels', t => {
  const f = prepare(t), before = api.inspectWorkflow(f.root), p = api.previewReferenceInputExperiment(f.root, f.options);
  assert.equal(p.executable, false); assert.equal(p.generationCalls, 0); assert.deepEqual(api.inspectWorkflow(f.root), before);
  assert.equal(p.plan.format, 'ai_scene_generation_plan_v17'); assert.equal(p.plan.request.images.length, 1);
  assert.deepEqual(p.plan.request.images[0], f.baseline.request.images[0]);
  assert.deepEqual(p.plan.recipe.blueprint, f.baseline.recipe.blueprint); assert.deepEqual(p.plan.target, f.baseline.target);
  assert.equal(p.plan.recipe.specSha256, f.baseline.recipe.specSha256); assert.equal(p.plan.recipe.styleSha256, f.baseline.recipe.styleSha256);
  assert.equal(p.plan.inputPolicy.styleSource, 'accepted-preset-text-only'); assert.equal(p.plan.inputPolicy.omittedStyleImages.length, 1);
  assert.equal(p.plan.experimentEvidence.improvement, 'not-tested'); assert.equal(p.plan.request.maximumCalls, 1);
  assert.equal(p.plan.request.prompt.split('\n\nINTENT=')[0], f.baseline.request.prompt.split('\n\nINTENT=')[0]);
  rejects(() => api.reservePlan(f.root, p.plan.sha256), 'PLAN_MISSING');
});
test('new experiment cannot spend the baseline authorization; it receives one fresh single-use slot', t => {
  const f = prepare(t), plan = api.freezeReferenceInputExperiment(f.root, f.options);
  rejects(() => api.reservePlan(f.root, plan.sha256), 'AUTHORIZATION_REQUIRED');
  rejects(() => api.reservePlan(f.root, f.baseline.sha256), 'RESERVATION_STATE');
  const ticket = authorizeAndReserve(f.root, plan); api.recordSubmission(f.root, ticket);
  const result = api.receiveResult(f.root, ticket, image(3)); assert.equal(result.technical.status, 'pass');
  rejects(() => api.reservePlan(f.root, plan.sha256), 'RESERVATION_STATE');
  rejects(() => api.readGenerationInput(f.root, plan.sha256, 1), 'INPUT_IMAGE_INDEX');
  assert.equal(api.getGenerationResult(f.root, f.baseline.sha256).result.rawSha256, f.result.rawSha256);
  assert.equal(api.inspectWorkflow(f.root).plans[0].status, 'pending-visual-review');
});
test('custom anchors, an absent style image and a technically rejected baseline cannot silently enter the preset-only trial', t => {
  for (const [config, code] of [[{ custom: true }, 'EXPERIMENT_PRESET_STYLE_REQUIRED'], [{ withImage: false }, 'EXPERIMENT_STYLE_IMAGE_REQUIRED'], [{ alpha: 200 }, 'EXPERIMENT_BASELINE_REQUIRED']]) {
    const f = prepare(t, config), before = api.inspectWorkflow(f.root);
    rejects(() => api.freezeReferenceInputExperiment(f.root, f.options), code); assert.deepEqual(api.inspectWorkflow(f.root), before);
  }
});
test('an unknown experiment remains terminal and a revision requires another authorization without altering baseline art', t => {
  const f = prepare(t), plan = api.freezeReferenceInputExperiment(f.root, f.options);
  api.stopAttempt(f.root, authorizeAndReserve(f.root, plan), 'indeterminate');
  const next = api.reviseGenerationPlan(f.root, plan.sha256, { planId: 'reference.trial.r2', capabilitiesSha256: f.cap.sha256, intent: f.options.intent });
  assert.equal(next.format, 'ai_scene_generation_plan_v17'); assert.deepEqual(next.recipe.parents, [plan.sha256]);
  rejects(() => api.reservePlan(f.root, next.sha256), 'AUTHORIZATION_REQUIRED');
  rejects(() => api.reservePlan(f.root, plan.sha256), 'RESERVATION_STATE');
  assert.equal(api.inspectWorkflow(f.root).plans[0].status, 'pending-visual-review');
});
test('journal replay rejects changing held geometry or adding a style image back, even after all event hashes are rebound', t => {
  const a = prepare(t); api.freezeReferenceInputExperiment(a.root, a.options);
  rewrite(a.root, record => { record.recipe.blueprint.instances[0].anchor.y--; });
  rejects(() => api.inspectWorkflow(a.root), 'EXPERIMENT_HELD_INPUT_CHANGED');
  const b = prepare(t); api.freezeReferenceInputExperiment(b.root, b.options);
  rewrite(b.root, record => { record.request.images.push(b.baseline.request.images[1]); });
  rejects(() => api.inspectWorkflow(b.root), 'PLAN_RECOMPILE_MISMATCH');
});
test('accepting baseline art after freezing an experiment invalidates its unspent compute opportunity', t => {
  const f = prepare(t), trial = api.freezeReferenceInputExperiment(f.root, f.options), obs = observed(f.baseline, f.result.rawSha256);
  const proof = api.buildStandardReferenceReview(f.root, f.baseline.sha256, obs, join(f.parent, 'baseline-review'));
  api.reviewStandardReference(f.root, f.baseline.sha256, obs, decision('baseline.art', proof.packetSha256));
  assert.equal(api.inspectWorkflow(f.root).plans.find(p => p.planSha256 === trial.sha256).current, false);
  rejects(() => api.authorizePlan(f.root, trial.sha256, decision('stale.compute', trial.sha256, 'approve-compute')), 'EXPERIMENT_BASELINE_STALE');
});
test('trial art still needs the exact full alignment packet, and cannot feed the legacy fixed assembler', t => {
  const f = prepare(t), plan = api.freezeReferenceInputExperiment(f.root, f.options), result = api.receiveResult(f.root, authorizeAndReserve(f.root, plan), image(3));
  rejects(() => api.reviewResult(f.root, plan.sha256, decision('raw.accept', result.rawSha256)), 'STANDARD_REFERENCE_REVIEW_REQUIRED');
  const obs = observed(plan, result.rawSha256), proof = api.buildStandardReferenceReview(f.root, plan.sha256, obs, join(f.parent, 'trial-review'));
  api.reviewStandardReference(f.root, plan.sha256, obs, decision('trial.art', proof.packetSha256));
  assert.equal(api.getReferenceReconstructionTarget(f.root, plan.sha256).rawSha256, result.rawSha256);
  rejects(() => api.freezeSceneSourceBatch(f.root, { batchId: 'legacy.invalid', referencePlanSha256: plan.sha256, capabilitiesSha256: f.cap.sha256, intent: '' }), 'STANDARD_RECONSTRUCTION_NOT_IMPLEMENTED');
});
