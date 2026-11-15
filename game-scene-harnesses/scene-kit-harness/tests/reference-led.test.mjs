import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as api from '../src/generation/index.mjs';
import * as project from '../src/reference-led-pipeline.mjs';
import { REFERENCE_STANDARDS, validateReferenceRequirements, assessMeasuredReference } from '../src/reference-measurement.mjs';
import { seal, unseal, jsonBytes, hash } from '../src/generation/common.mjs';
import { encodeRgbaPng } from '../src/png.mjs';
import { setup, decision, authorizeAndReserve } from './helpers/generation.mjs';

const rejects = (fn, code) => assert.throws(fn, error => error.errors?.some(e => e.code === code));
const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
function brief() {
  const layers = [{ layerId: 'sky', kind: 'background', zIndex: 0, parallaxX: 0 }, { layerId: 'ground', kind: 'terrain', zIndex: 10, parallaxX: 1 },
    { layerId: 'foreground', kind: 'foreground', zIndex: 20, parallaxX: 1.1 }];
  return { projectId: 'reference.fixture', description: 'Synthetic side-view ground and sky, optional foreground.', viewport: { width: 256, height: 144 }, maxAspectErrorPermille: 5,
    inputs: [], style: { mode: 'preset', preset: 'clean-handpaint', name: '', rules: [], anchorPath: null },
    requirements: seal({ format: 'ai_scene_reference_requirements_v1', requirementsId: 'fixture.requirements', layers,
      subjects: [{ subjectId: 'sky', layerId: 'sky', role: 'sky', content: 'Synthetic sky.', count: { min: 1, max: 1 }, placementHint: 'wide' },
        { subjectId: 'ground', layerId: 'ground', role: 'solid-terrain', content: 'Readable solid side-view ground.', count: { min: 1, max: 1 }, placementHint: 'wide' },
        { subjectId: 'ferns', layerId: 'foreground', role: 'ferns', content: 'Optional small foreground.', count: { min: 0, max: 1 }, placementHint: 'frame-edges' }],
      compositionNotes: ['Compose a complete scene; measure actual geometry after review.'], standards: REFERENCE_STANDARDS.map(key => ({ key, requirement: `Synthetic ${key} requirement.` })) }) };
}
function png(y = 97, alpha = 255) {
  const rgba = Buffer.alloc(512 * 288 * 4);
  for (let yy = 0; yy < 288; yy++) for (let x = 0; x < 512; x++) {
    const p = (yy * 512 + x) * 4; rgba.set(yy < y * 2 ? [160, 200, 235, alpha] : [60 + x % 12, 100, 130, alpha], p);
  }
  return encodeRgbaPng(512, 288, rgba);
}
function reviewed(t) {
  const f = setup(t), b = brief(), state = project.initReferenceLedProject(f.root, b, { purpose: 'synthetic-simulation' });
  project.reviewReferenceLedDesign(f.root, { spec: decision('spec', state.design.specSha256), style: decision('style', state.design.styleSha256) });
  return { ...f, b, workflow: join(f.root, 'workflow') };
}
function analysis(plan, rawSha256, y = 97) {
  return seal({ format: 'ai_scene_measured_reference_layout_v1', planSha256: plan.sha256, rawSha256, coordinates: 'canonical-reference-frame',
    layers: plan.referenceRequirements.layers.slice(0, 2),
    instances: [{ instanceId: 'sky.actual', subjectId: 'sky', layerId: 'sky', visibleEnvelope: rect(0, 0, 256, y), anchor: { x: 0, y: 0 },
      visibility: 'visible', anchorEvidence: 'observed', notes: 'Synthetic visible sky envelope; no hidden pixels claimed.' },
    { instanceId: 'ground.actual', subjectId: 'ground', layerId: 'ground', visibleEnvelope: rect(0, y, 256, 144 - y), anchor: { x: 0, y },
      visibility: 'frame-clipped', anchorEvidence: 'observed', notes: 'Synthetic ground reaches frame bottom; extension below is unknown.' }],
    surfaces: [{ surfaceId: 'ground.top', instanceId: 'ground.actual', points: [{ x: 0, y }, { x: 256, y }], evidence: 'observed', notes: 'Synthetic visible top edge.' }],
    quality: REFERENCE_STANDARDS.map(key => ({ key, verdict: 'pass', notes: `Synthetic ${key} test-double observation; not real art acceptance.` })) });
}
function candidate(t, y = 97) {
  const f = reviewed(t), input = join(f.parent, 'existing.png'), bytes = png(y); writeFileSync(input, bytes);
  const state = project.intakeReferenceLedImage(f.root, input, { planId: 'existing.r1' }), plan = api.getGenerationPlan(f.workflow, state.reference.planSha256), result = api.getGenerationResult(f.workflow, plan.sha256).result;
  return { ...f, input, bytes, plan, result, state };
}
test('reference-led draft and preview contain standards/counts but no pre-image coordinates or layout image', t => {
  const { root, parent } = setup(t), state = project.initReferenceLedProject(root, brief(), { purpose: 'synthetic-simulation' });
  assert.equal(state.stage, 'awaiting-design-review'); assert.equal(state.eventCount, 3); assert.equal(state.pregenerationPixelGeometry, 'not-prescribed');
  assert.equal(existsSync(join(root, 'layout-guide.png')), false);
  const out = join(parent, 'proposal'); project.previewReferenceLedProject(root, out); project.verifyReferenceLedPreview(root, out);
  const p = JSON.parse(readFileSync(join(out, 'proposal.json'))); assert.equal(p.executable, false); assert.equal(p.request.images.length, 0);
  assert.equal(p.request.prompt.includes('BLUEPRINT='), false); assert.ok(p.request.prompt.includes('actual image requires separate human'));
  assert.deepEqual(project.inspectReferenceLedProject(root), state);
  rejects(() => project.planReferenceLedProject(root, {}), 'DESIGN_REVIEW_REQUIRED');
});
test('closed requirements reject precomputed geometry, missing standards, invalid counts and role confusion', () => {
  for (const mutate of [r => { r.instances = [{ polygon: rect(0, 0, 100, 100) }]; }, r => r.standards.pop(),
    r => { r.subjects[0].count.min = 2; }, r => { r.subjects[0].layerId = 'unknown'; }]) {
    const r = unseal(brief().requirements); mutate(r); assert.throws(() => validateReferenceRequirements(seal(r)));
  }
});
test('v18 generation binds accepted requirements and keeps fresh single-use compute and unknown semantics', async t => {
  const f = reviewed(t); let state = project.planReferenceLedProject(f.root, {}), calls = 0;
  const plan = api.getGenerationPlan(f.workflow, state.reference.planSha256); assert.equal(plan.format, 'ai_scene_generation_plan_v18');
  assert.equal(Object.hasOwn(plan.recipe, 'blueprint'), false); assert.equal(plan.request.images.some(i => i.role === 'layout-reference'), false);
  const adapter = { preflight: async () => {}, generate: async () => { calls++; throw Error('Synthetic lost result'); } };
  await assert.rejects(project.runReferenceLedProject(f.root, adapter)); assert.equal(calls, 0);
  project.authorizeReferenceLedProject(f.root, decision('compute', plan.sha256, 'approve-compute'));
  state = await project.runReferenceLedProject(f.root, adapter); assert.equal(calls, 1); assert.equal(state.reference.status, 'indeterminate');
  await assert.rejects(project.runReferenceLedProject(f.root, adapter)); assert.equal(calls, 1);
  const next = api.reviseGenerationPlan(f.workflow, plan.sha256, { planId: 'reference.r2', capabilitiesSha256: plan.recipe.capabilitiesSha256, intent: '' });
  assert.equal(next.format, 'ai_scene_generation_plan_v18'); rejects(() => api.reservePlan(f.workflow, next.sha256), 'AUTHORIZATION_REQUIRED');
});
test('custom style retains its exact anchor and uploads only style images, never a layout guide', t => {
  const { root, parent } = setup(t), file = join(parent, 'anchor.png'), bytes = png(); writeFileSync(file, bytes);
  const b = brief(); b.inputs = [{ role: 'style-reference', path: file }];
  b.style = { mode: 'custom', preset: null, name: 'Synthetic custom style', rules: ['Clear synthetic brushwork.'], anchorPath: file };
  const state = project.initReferenceLedProject(root, b, { purpose: 'synthetic-simulation' });
  project.reviewReferenceLedDesign(root, { spec: decision('spec', state.design.specSha256), style: decision('style', state.design.styleSha256) });
  const planned = project.planReferenceLedProject(root, {}), workflow = join(root, 'workflow'), plan = api.getGenerationPlan(workflow, planned.reference.planSha256);
  assert.deepEqual(plan.request.images.map(i => i.role), ['style-reference', 'style-anchor']);
  assert.deepEqual(api.readGenerationInput(workflow, plan.sha256, 1), bytes);
  const missing = brief(); missing.style = { ...b.style, anchorPath: null };
  rejects(() => project.initReferenceLedProject(join(parent, 'missing'), missing), 'REFERENCE_STYLE');
  assert.equal(existsSync(join(parent, 'missing')), false);
});
test('existing PNG intake spends no authorization and does not accept the image or attest its old outcome', t => {
  const f = candidate(t);
  assert.equal(f.plan.format, 'ai_scene_reference_candidate_v1'); assert.equal(f.plan.request.maximumCalls, 0);
  assert.equal(f.plan.oldPlanOutcome, 'not-reinterpreted'); assert.equal(f.state.reference.status, 'pending-visual-review');
  assert.equal(f.state.eventCount, 7); assert.equal(f.state.reference.reserved, false); assert.equal(f.state.reconstructionTargetSha256, null);
  assert.equal(hash(readFileSync(f.input)), hash(f.bytes)); assert.deepEqual(api.getGenerationResult(f.workflow, f.plan.sha256).bytes, f.bytes);
  rejects(() => api.authorizePlan(f.workflow, f.plan.sha256, decision('invalid.compute', f.plan.sha256, 'approve-compute')), 'AUTHORIZATION_STATE');
  rejects(() => api.reviseGenerationPlan(f.workflow, f.plan.sha256, { planId: 'wrong.r2', capabilitiesSha256: f.plan.recipe.capabilitiesSha256, intent: '' }), 'CANDIDATE_NOT_GENERATION');
  rejects(() => api.reviewResult(f.workflow, f.plan.sha256, decision('raw.accept', f.result.rawSha256)), 'STANDARD_REFERENCE_REVIEW_REQUIRED');
});
test('actual terrain measurements freeze without comparison to an invented earlier height', t => {
  const f = candidate(t, 91), a = analysis(f.plan, f.result.rawSha256, 91), out = join(f.parent, 'review');
  const proof = project.assessReferenceLedImage(f.root, a, out); project.verifyReferenceLedImageReview(f.root, a, out);
  const packet = JSON.parse(readFileSync(join(out, 'review-packet.json'))); assert.equal(packet.assessment.readyForHumanAcceptance, true);
  assert.equal(packet.assessment.comparisonToPregenerationGeometry, 'not-applicable');
  assert.equal(JSON.parse(readFileSync(join(out, 'reconstruction-candidate.json'))).status, 'unaccepted');
  rejects(() => api.getReferenceReconstructionTarget(f.workflow, f.plan.sha256), 'RECONSTRUCTION_TARGET_NOT_ACCEPTED');
  rejects(() => project.reviewReferenceLedImage(f.root, a, decision('wrong.packet', f.result.rawSha256)), 'REFERENCE_LED_REVIEW_TARGET');
  const state = project.reviewReferenceLedImage(f.root, a, decision('measured.accept', proof.packetSha256));
  const target = api.getReferenceReconstructionTarget(f.workflow, f.plan.sha256);
  assert.equal(state.stage, 'reference-accepted-reconstruction-pending'); assert.equal(target.format, 'ai_scene_reference_reconstruction_target_v2');
  assert.equal(target.instances.find(i => i.subjectId === 'ground').anchor.y, 91); assert.equal(target.surfaces[0].points[0].y, 91);
  assert.equal(target.hiddenGeometry, 'not-recovered'); assert.equal(target.rawSha256, f.result.rawSha256);
  project.exportReferenceLedTarget(f.root, join(f.parent, 'target'));
  rejects(() => api.freezeSceneSourceBatch(f.workflow, { batchId: 'old.invalid', referencePlanSha256: f.plan.sha256, capabilitiesSha256: f.plan.recipe.capabilitiesSha256, intent: '' }), 'STANDARD_RECONSTRUCTION_NOT_IMPLEMENTED');
});
for (const verdict of ['fail', 'uncertain']) test(`side-view ${verdict} cannot be accepted by relaxing pixel-layout requirements`, t => {
  const f = candidate(t), body = unseal(analysis(f.plan, f.result.rawSha256)); body.quality[0].verdict = verdict;
  const a = seal(body), out = join(f.parent, 'bad-review'), proof = project.assessReferenceLedImage(f.root, a, out);
  assert.equal(JSON.parse(readFileSync(join(out, 'review-packet.json'))).assessment.readyForHumanAcceptance, false);
  rejects(() => project.reviewReferenceLedImage(f.root, a, decision('bad.accept', proof.packetSha256)), 'REFERENCE_REQUIREMENTS_NOT_SATISFIED');
  assert.equal(project.inspectReferenceLedProject(f.root).reconstructionTargetSha256, null);
});
test('missing subject/surface or a quality assertion does not silently pass; optional foreground may be absent', t => {
  const f = candidate(t), good = analysis(f.plan, f.result.rawSha256), req = f.plan.referenceRequirements, frame = f.b.viewport;
  assert.equal(assessMeasuredReference(req, frame, good).counts.find(c => c.subjectId === 'ferns').actual, 0);
  const noSurface = unseal(good); noSurface.surfaces = [];
  assert.equal(assessMeasuredReference(req, frame, seal(noSurface)).readyForHumanAcceptance, false);
  const missing = unseal(analysis(f.plan, f.result.rawSha256)); missing.instances.pop(); missing.layers.pop(); missing.surfaces = [];
  assert.equal(assessMeasuredReference(req, frame, seal(missing)).readyForHumanAcceptance, false);
  const noQuality = unseal(analysis(f.plan, f.result.rawSha256)); noQuality.quality.pop();
  rejects(() => assessMeasuredReference(req, frame, seal(noQuality)), 'REFERENCE_QUALITY_COVERAGE');
});
test('analysis rejects swapped raw identity, extra subjects, out-of-frame surfaces and unlabelled inferred geometry', t => {
  const f = candidate(t);
  const wrong = analysis(f.plan, '0'.repeat(64));
  rejects(() => project.assessReferenceLedImage(f.root, wrong, join(f.parent, 'wrong-raw')), 'REFERENCE_MEASURED_BINDING');
  for (const mutate of [a => { a.instances[0].subjectId = 'unrequested'; }, a => { a.surfaces[0].points[0].x = -1; },
    a => { a.instances[0].anchorEvidence = 'inferred'; }, a => { a.instances[0].anchor.y = 140; },
    a => { a.surfaces[0].points[0].y = 20; }]) {
    const a = unseal(analysis(f.plan, f.result.rawSha256)); mutate(a); assert.throws(() => assessMeasuredReference(f.plan.referenceRequirements, f.b.viewport, seal(a)));
  }
});
test('new raw v18 generations also use the measured-layout review gate', t => {
  const f = reviewed(t), state = project.planReferenceLedProject(f.root, {}), plan = api.getGenerationPlan(f.workflow, state.reference.planSha256);
  const result = api.receiveResult(f.workflow, authorizeAndReserve(f.workflow, plan), png(105));
  assert.equal(result.technical.status, 'pass'); assert.equal(result.technical.geometryEvidence, 'frame-only-actual-layout-measurement-required');
  rejects(() => api.reviewResult(f.workflow, plan.sha256, decision('raw.invalid', result.rawSha256)), 'STANDARD_REFERENCE_REVIEW_REQUIRED');
  const a = analysis(plan, result.rawSha256, 105), proof = project.assessReferenceLedImage(f.root, a, join(f.parent, 'review'));
  project.reviewReferenceLedImage(f.root, a, decision('actual.accept', proof.packetSha256));
  assert.equal(api.getReferenceReconstructionTarget(f.workflow, plan.sha256).surfaces[0].points[0].y, 105);
});
test('intake preserves a technical rejection and cannot certify a transparent candidate as the opaque reference', t => {
  const f = reviewed(t), file = join(f.parent, 'transparent.png'); writeFileSync(file, png(97, 200));
  const state = project.intakeReferenceLedImage(f.root, file, { planId: 'transparent.candidate' });
  assert.equal(state.reference.status, 'rejected-technical'); assert.equal(state.reference.reserved, false);
  const result = api.getGenerationResult(f.workflow, state.reference.planSha256); assert.equal(result.result.rawSha256, hash(readFileSync(file)));
  rejects(() => project.assessReferenceLedImage(f.root, analysis(api.getGenerationPlan(f.workflow, state.reference.planSha256), result.result.rawSha256), join(f.parent, 'bad')), 'REFERENCE_LED_RESULT');
});
test('replay rejects hand-edited measured targets even if the surrounding event chain is rehashed', t => {
  const f = candidate(t), a = analysis(f.plan, f.result.rawSha256), proof = project.assessReferenceLedImage(f.root, a, join(f.parent, 'proof'));
  project.reviewReferenceLedImage(f.root, a, decision('art', proof.packetSha256));
  let previousSha256 = JSON.parse(readFileSync(join(f.workflow, 'workflow.json'))).sha256;
  for (const name of readdirSync(join(f.workflow, 'events')).sort()) {
    const event = JSON.parse(readFileSync(join(f.workflow, 'events', name))), body = unseal(event), record = unseal(event.record);
    if (record.format === 'ai_scene_measured_reference_review_v1') {
      const target = unseal(record.reconstructionTarget); target.instances[1].anchor.y = 10; record.reconstructionTarget = seal(target); body.record = seal(record);
    }
    body.previousSha256 = previousSha256; const rebound = seal(body); previousSha256 = rebound.sha256; writeFileSync(join(f.workflow, 'events', name), jsonBytes(rebound));
  }
  rejects(() => api.inspectWorkflow(f.workflow), 'RECONSTRUCTION_TARGET_REPLAY');
});
test('reference-led CLI init/preview stay offline and candidate import requires prior design acceptance', async t => {
  const { root, parent } = setup(t), file = join(parent, 'brief.json'), candidateFile = join(parent, 'candidate.png'), options = join(parent, 'options.json');
  writeFileSync(file, jsonBytes(brief())); writeFileSync(candidateFile, png()); writeFileSync(options, jsonBytes({ planId: 'existing.r1' }));
  const script = fileURLToPath(new URL('../scripts/reference.mjs', import.meta.url));
  const invoke = async args => JSON.parse((await promisify(execFile)(process.execPath, [script, ...args], { timeout: 15000 })).stdout);
  const state = await invoke(['init', '--brief', file, '--out', root]); assert.equal(state.eventCount, 3);
  const preview = await invoke(['preview', '--root', root, '--out', join(parent, 'preview')]); assert.equal(preview.generationCalls, 0);
  await assert.rejects(invoke(['candidate', '--root', root, '--file', candidateFile, '--options', options]), error => error.stderr.includes('DESIGN_REVIEW_REQUIRED'));
  assert.deepEqual(await invoke(['inspect', '--root', root]), state);
  await assert.rejects(invoke(['inspect', '--root', root, '--yes', 'true']));
});
