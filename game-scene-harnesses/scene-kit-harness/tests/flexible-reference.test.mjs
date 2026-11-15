import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { composeReferenceBlueprint, buildCompositionProposal, verifyCompositionProposal } from '../src/composition-planner.mjs';
import { assessFlexibleObservation, validateFlexibleBlueprint } from '../src/reference-layout.mjs';
import { polygonBounds } from '../src/reference-blueprint.mjs';
import { seal, unseal, jsonBytes } from '../src/generation/common.mjs';
import * as api from '../src/generation/index.mjs';
import * as project from '../src/standard-pipeline.mjs';
import { encodeRgbaPng } from '../src/png.mjs';
import { setup, decision } from './helpers/generation.mjs';
import { compositionExample } from '../examples/standard-reference/composition-intents.mjs';

const rejects = (fn, code) => assert.throws(fn, error => error.errors?.some(e => e.code === code));
const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
function intent() {
  return seal({ format: 'ai_scene_composition_intent_v1', designId: 'fixture.flexible', sceneDescription: 'Synthetic continuous forest slope with one tree and one left foreground; no castle or platform.',
    viewport: { width: 256, height: 144 }, seed: 7,
    layers: [{ layerId: 'trees', kind: 'environment', zIndex: 0, parallaxX: 0.5 }, { layerId: 'ground', kind: 'terrain', zIndex: 10, parallaxX: 1 },
      { layerId: 'front', kind: 'foreground', zIndex: 20, parallaxX: 1.1 }],
    hardInstances: [{ instanceId: 'ground', layerId: 'ground', role: 'solid-terrain', content: 'Continuous side-view terrain.', polygon: rect(0, 100, 256, 44), anchor: { x: 0, y: 100 } }],
    artSubjects: [{ instanceId: 'tree', layerId: 'trees', role: 'tree', content: 'A tree with a style-specific silhouette.',
      placement: { side: 'right', vertical: 'free', widthPermille: { min: 200, max: 300 }, heightPermille: { min: 400, max: 500 }, topPermille: { min: 100, max: 160 } },
      occupancyPermille: { min: 100, max: 900 }, maxOutsidePermille: 0, anchorBandPermille: { min: 0, max: 1000 } },
    { instanceId: 'foreground', layerId: 'front', role: 'foliage', content: 'A left-bottom foreground silhouette.',
      placement: { side: 'frame-left', vertical: 'frame-bottom', widthPermille: { min: 200, max: 250 }, heightPermille: { min: 120, max: 200 }, topPermille: { min: 0, max: 0 } },
      occupancyPermille: { min: 100, max: 900 }, maxOutsidePermille: 0, anchorBandPermille: { min: 0, max: 1000 } }],
    protectedRegions: [{ regionId: 'open-ground', purpose: 'Keep central gameplay visible.', polygon: rect(90, 90, 100, 54), forbiddenInstanceIds: ['foreground'], maxOccludedPermille: 0 }],
    tolerances: { maxAnchorErrorPx: 3, minEnvelopeIoUPermille: 850, maxAspectErrorPermille: 5 },
    composition: { mass: 'balanced', minimumSeparationPx: 8, shapeLanguage: 'Use broad organic silhouettes with low texture noise.' } });
}
function observation(plan, rawSha256, variant = 0) {
  return seal({ format: 'ai_scene_reference_observation_v1', planSha256: plan.sha256, rawSha256, coordinates: 'canonical-reference-frame',
    instances: plan.recipe.blueprint.instances.map(i => {
      if (i.constraint.mode === 'hard') return { instanceId: i.instanceId, polygon: i.polygon, anchor: i.anchor };
      const b = polygonBounds(i.constraint.region);
      return { instanceId: i.instanceId,
        polygon: variant ? [{ x: b.x + b.width, y: b.y }, { x: b.x + b.width, y: b.y + b.height }, { x: b.x, y: b.y + b.height }]
          : [{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y + b.height }, { x: b.x, y: b.y + b.height }],
        anchor: { x: b.x + b.width / 2, y: b.y + b.height } };
    }) });
}
const brief = () => ({ projectId: 'flexible.fixture', intent: intent(), inputs: [],
  style: { mode: 'preset', preset: 'clean-handpaint', name: '', rules: [], anchorPath: null } });
function planned(t) {
  const { root, parent } = setup(t); let state = project.initComposedReference(root, brief(), { purpose: 'synthetic-simulation' });
  project.reviewStandardDesign(root, { spec: decision('spec', state.design.specSha256), style: decision('style', state.design.styleSha256) });
  state = project.planStandardReference(root, {}); const workflow = join(root, 'workflow'), plan = api.getGenerationPlan(workflow, state.reference.planSha256);
  return { root, parent, workflow, plan, state };
}
function native() {
  const rgba = Buffer.alloc(512 * 288 * 4, 255);
  for (let p = 0; p < rgba.length; p += 4) rgba[p] = (p / 4) % 192;
  return encodeRgbaPng(512, 288, rgba);
}
async function received(t) {
  const f = planned(t); project.authorizeStandardReference(f.root, decision('compute', f.plan.sha256, 'approve-compute'));
  let calls = 0;
  await project.runStandardReference(f.root, { preflight: async () => {}, generate: async input => {
    calls++; assert.equal(api.inspectWorkflow(f.workflow).plans[0].status, 'submitted');
    assert.equal(input.request.format, 'ai_scene_image_request_v16'); return native();
  } });
  assert.equal(calls, 1); return { ...f, result: api.getGenerationResult(f.workflow, f.plan.sha256).result };
}

test('different explicit scene intents produce different topology, role counts and art placements; no universal snow template', () => {
  const proposals = ['snow-valley', 'forest-slope', 'desert-canyon'].map(name => composeReferenceBlueprint(compositionExample(name)));
  assert.deepEqual(proposals.map(p => p.blueprint.layers.length), [7, 5, 4]);
  assert.deepEqual(proposals.map(p => p.blueprint.instances.filter(i => i.constraint.mode === 'hard').length), [3, 1, 2]);
  assert.equal(proposals[1].blueprint.instances.some(i => i.role === 'castle' || i.role === 'solid-platform'), false);
  assert.equal(proposals[2].blueprint.layers.some(l => l.kind === 'foreground'), false);
  for (const p of proposals) { assert.equal(p.styleImageGeometryUsed, false); assert.equal(p.artSilhouettesSelected, false); assert.equal(p.generationCalls, 0); }
});
test('composition is reproducible and seed-specific; mass changes art budgets while gameplay stays fixed', () => {
  const source = intent(), original = structuredClone(source), p = composeReferenceBlueprint(source);
  assert.deepEqual(composeReferenceBlueprint(source), p); assert.deepEqual(source, original);
  const different = unseal(source); different.seed = 99;
  assert.notDeepEqual(composeReferenceBlueprint(seal(different)).placements, p.placements);
  const airy = structuredClone(unseal(source)); airy.composition.mass = 'airy'; const a = composeReferenceBlueprint(seal(airy));
  const dense = structuredClone(unseal(source)); dense.composition.mass = 'dense'; const d = composeReferenceBlueprint(seal(dense));
  assert.deepEqual(a.blueprint.instances[0], d.blueprint.instances[0]);
  assert.deepEqual(a.placements, d.placements);
  assert.ok(a.blueprint.instances[1].constraint.maxOccupancyPermille < d.blueprint.instances[1].constraint.maxOccupancyPermille);
});
test('unsatisfiable placement stops rather than moving gameplay or weakening protection', () => {
  const i = unseal(intent()), before = structuredClone(i);
  i.artSubjects[0].placement.side = 'left'; i.artSubjects[0].placement.widthPermille = { min: 800, max: 900 };
  const impossible = seal(i); rejects(() => composeReferenceBlueprint(impossible), 'COMPOSITION_UNSATISFIABLE');
  assert.deepEqual(unseal(impossible), i); assert.deepEqual(before.hardInstances, i.hardInstances);
});
test('art regions permit different silhouettes; hard geometry, occupancy, anchors and openings remain enforceable', () => {
  const b = composeReferenceBlueprint(intent()).blueprint, plan = { sha256: 'a'.repeat(64), recipe: { blueprint: b } }, raw = 'b'.repeat(64);
  for (const variant of [0, 1]) {
    const result = assessFlexibleObservation(b, observation(plan, raw, variant)); assert.equal(result.status, 'pass');
    assert.equal(result.instances.find(i => i.instanceId === 'tree').silhouetteComparedToPlaceholder, false);
  }
  const cases = [o => { o.instances[0].anchor.y -= 10; }, o => { o.instances[1].polygon = rect(0, 0, 256, 144); },
    o => { o.instances[1].polygon = rect(150, 30, 2, 2); }, o => { o.instances[1].anchor = { x: 0, y: 0 }; },
    o => { o.instances[2].polygon = rect(0, 90, 220, 54); }];
  for (const change of cases) { const o = unseal(observation(plan, raw)); change(o); assert.equal(assessFlexibleObservation(b, seal(o)).status, 'layout-deviation'); }
});
test('a soft region may span a protected opening but the actual artwork must preserve it', () => {
  const b = unseal(composeReferenceBlueprint(intent()).blueprint), fg = b.instances.find(i => i.instanceId === 'foreground');
  fg.constraint.region = rect(0, 90, 220, 54); fg.constraint.anchorRegion = fg.constraint.region;
  fg.constraint.minOccupancyPermille = 50; const value = seal(b); validateFlexibleBlueprint(value);
  const plan = { sha256: 'a'.repeat(64), recipe: { blueprint: value } }, o = unseal(observation(plan, 'b'.repeat(64)));
  const actual = o.instances.find(i => i.instanceId === 'foreground'); actual.polygon = rect(0, 100, 70, 44); actual.anchor = { x: 20, y: 144 };
  assert.equal(assessFlexibleObservation(value, seal(o)).status, 'pass');
  actual.polygon = rect(50, 100, 100, 44);
  const result = assessFlexibleObservation(value, seal(o)); assert.equal(result.status, 'layout-deviation'); assert.equal(result.protectedRegions[0].pass, false);
});
test('v16 frozen requests clearly separate hard guides, soft art regions and style-only images', t => {
  const f = planned(t); assert.equal(f.plan.format, 'ai_scene_generation_plan_v16');
  assert.ok(f.plan.request.prompt.includes('not object contours')); assert.ok(f.plan.request.prompt.includes('Do not imitate the outline of an art placement rectangle'));
  assert.equal(f.plan.inputPolicy.uploads, 'style-only'); assert.equal(f.plan.request.images[0].role, 'layout-reference');
  assert.equal(f.state.reconstructionTargetSha256, null);
  rejects(() => api.getReferenceReconstructionTarget(f.workflow, f.plan.sha256), 'RECONSTRUCTION_TARGET_NOT_ACCEPTED');
  rejects(() => api.reservePlan(f.workflow, f.plan.sha256), 'AUTHORIZATION_REQUIRED');
});
test('actual silhouettes freeze only after packet acceptance and remain different from pre-generation regions', async t => {
  const f = await received(t), obs = observation(f.plan, f.result.rawSha256, 1), output = join(f.parent, 'review');
  rejects(() => api.reviewResult(f.workflow, f.plan.sha256, decision('raw.accept', f.result.rawSha256)), 'STANDARD_REFERENCE_REVIEW_REQUIRED');
  const proof = project.assessStandardReference(f.root, obs, output); project.verifyStandardAssessment(f.root, obs, output);
  const candidate = JSON.parse(readFileSync(join(output, 'reconstruction-candidate.json'))); assert.equal(candidate.status, 'unaccepted');
  rejects(() => api.getReferenceReconstructionTarget(f.workflow, f.plan.sha256), 'RECONSTRUCTION_TARGET_NOT_ACCEPTED');
  const state = project.reviewStandardImage(f.root, obs, decision('art.accept', proof.packetSha256));
  const target = api.getReferenceReconstructionTarget(f.workflow, f.plan.sha256);
  assert.equal(state.stage, 'reference-accepted-reconstruction-pending'); assert.equal(state.reconstructionTargetSha256, target.sha256);
  const actual = target.instances.find(i => i.instanceId === 'tree');
  assert.deepEqual(actual.polygon, obs.instances.find(i => i.instanceId === 'tree').polygon);
  assert.notDeepEqual(actual.polygon, f.plan.recipe.blueprint.instances.find(i => i.instanceId === 'tree').constraint.region);
  assert.equal(target.hiddenGeometry, 'not-recovered'); assert.equal(target.rawSha256, f.result.rawSha256);
  project.exportReconstructionTarget(f.root, join(f.parent, 'accepted-target'));
  rejects(() => api.freezeSceneSourceBatch(f.workflow, { batchId: 'legacy.invalid', referencePlanSha256: f.plan.sha256,
    capabilitiesSha256: f.plan.recipe.capabilitiesSha256, intent: '' }), 'STANDARD_RECONSTRUCTION_NOT_IMPLEMENTED');
});
test('bad art placement cannot create an accepted target; unknown remains terminal for v16', async t => {
  const f = await received(t), o = unseal(observation(f.plan, f.result.rawSha256)); o.instances[0].anchor.y -= 10;
  const obs = seal(o), out = join(f.parent, 'bad-review'), proof = project.assessStandardReference(f.root, obs, out);
  rejects(() => project.reviewStandardImage(f.root, obs, decision('bad.accept', proof.packetSha256)), 'STANDARD_LAYOUT_REJECTED');
  rejects(() => api.getReferenceReconstructionTarget(f.workflow, f.plan.sha256), 'RECONSTRUCTION_TARGET_NOT_ACCEPTED');
  project.reviewStandardImage(f.root, obs, decision('bad.reject', proof.packetSha256, 'reject'));
  const revised = api.reviseGenerationPlan(f.workflow, f.plan.sha256, { planId: 'fixture.r2', capabilitiesSha256: f.plan.recipe.capabilitiesSha256, intent: '' });
  assert.equal(revised.format, 'ai_scene_generation_plan_v16'); rejects(() => api.reservePlan(f.workflow, revised.sha256), 'AUTHORIZATION_REQUIRED');
  api.authorizePlan(f.workflow, revised.sha256, decision('compute.r2', revised.sha256, 'approve-compute'));
  const { request: _request, ...ticket } = api.reservePlan(f.workflow, revised.sha256); api.stopAttempt(f.workflow, ticket, 'indeterminate');
  rejects(() => api.reservePlan(f.workflow, revised.sha256), 'RESERVATION_STATE');
});
test('replay rejects a hand-authored replacement of the accepted geometry even after the journal is rehashed', async t => {
  const f = await received(t), obs = observation(f.plan, f.result.rawSha256), out = join(f.parent, 'proof');
  const bundle = project.assessStandardReference(f.root, obs, out);
  project.reviewStandardImage(f.root, obs, decision('art.accept', bundle.packetSha256));
  let previousSha256 = JSON.parse(readFileSync(join(f.workflow, 'workflow.json'))).sha256;
  for (const name of readdirSync(join(f.workflow, 'events')).sort()) {
    const event = JSON.parse(readFileSync(join(f.workflow, 'events', name))), body = unseal(event), record = unseal(event.record);
    if (record.format === 'ai_scene_standard_reference_review_v2') {
      const target = unseal(record.reconstructionTarget); target.instances[1].polygon = rect(0, 0, 20, 20);
      record.reconstructionTarget = seal(target); event.record = seal(record);
    }
    body.previousSha256 = previousSha256;
    // Rehashing here is an adversarial fixture, not a production repair API.
    const rebound = seal({ ...body, record: event.record }); previousSha256 = rebound.sha256;
    writeFileSync(join(f.workflow, 'events', name), jsonBytes(rebound));
  }
  rejects(() => api.inspectWorkflow(f.workflow), 'RECONSTRUCTION_TARGET_REPLAY');
});
test('composition provenance and design bundles replay instead of trusting an edited layout', t => {
  const { root, parent } = setup(t), source = intent(), out = join(parent, 'design');
  const proof = buildCompositionProposal(source, out); assert.equal(proof.generationCalls, 0); verifyCompositionProposal(source, out);
  writeFileSync(join(out, 'layout-guide.png'), Buffer.from('tampered'));
  assert.throws(() => verifyCompositionProposal(source, out));
  project.initComposedReference(root, brief(), { purpose: 'synthetic-simulation' });
  const edited = unseal(source); edited.seed++;
  writeFileSync(join(root, 'composition-intent.json'), jsonBytes(seal(edited)));
  rejects(() => project.inspectStandardReference(root), 'COMPOSITION_BLUEPRINT_BINDING');
});
test('CLI requires an explicit brief/example instead of defaulting to snow; compose/init are zero compute', async t => {
  const { root, parent } = setup(t), source = join(parent, 'intent.json'), doc = join(parent, 'brief.json'), out = join(parent, 'composition');
  writeFileSync(source, jsonBytes(intent())); writeFileSync(doc, jsonBytes(brief()));
  const script = fileURLToPath(new URL('../scripts/standard-reference.mjs', import.meta.url));
  const invoke = async args => JSON.parse((await promisify(execFile)(process.execPath, [script, ...args], { timeout: 15000 })).stdout);
  assert.equal((await invoke(['compose', '--intent', source, '--out', out])).generationCalls, 0);
  await invoke(['verify-composition', '--intent', source, '--out', out]);
  const state = await invoke(['init-composed', '--brief', doc, '--out', root]); assert.equal(state.reference, null); assert.equal(state.eventCount, 3);
  const prepare = fileURLToPath(new URL('../scripts/prepare-standard-reference.mjs', import.meta.url)), empty = join(parent, 'no-default');
  await assert.rejects(promisify(execFile)(process.execPath, [prepare, '--out', empty], { timeout: 15000 }), error => error.stderr.includes('STANDARD_EXPLICIT_DESIGN_REQUIRED'));
  assert.equal(existsSync(empty), false);
});
