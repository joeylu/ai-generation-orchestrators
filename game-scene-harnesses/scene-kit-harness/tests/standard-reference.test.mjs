import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as api from '../src/generation/index.mjs';
import * as project from '../src/standard-pipeline.mjs';
import { seal, unseal, jsonBytes, digest, hash } from '../src/generation/common.mjs';
import { referenceBlueprintGuide, validateReferenceBlueprint, assessReferenceObservation } from '../src/reference-blueprint.mjs';
import { assessStandardReference } from '../src/generation/standard-reference.mjs';
import { encodeRgbaPng, inspectPng } from '../src/png.mjs';
import { setup, decision, specDraft, styleDraft, capabilitiesDraft, authorizeAndReserve } from './helpers/generation.mjs';

const rejects = (op, code) => assert.throws(op, error => error.errors?.some(issue => issue.code === code));
const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
function blueprint() {
  return seal({ format: 'ai_scene_reference_blueprint_v1', blueprintId: 'fixture.layout', sceneDescription: 'Synthetic side-view snow terrain with independent foreground sides.',
    projection: 'pure-sideview', viewport: { width: 256, height: 144 },
    layers: [{ layerId: 'sky', kind: 'background', zIndex: 0, parallaxX: 0 }, { layerId: 'ground', kind: 'terrain', zIndex: 10, parallaxX: 1 },
      { layerId: 'front', kind: 'foreground', zIndex: 20, parallaxX: 1.2 }],
    instances: [{ instanceId: 'sky', layerId: 'sky', role: 'sky', content: 'Complete sky.', polygon: rect(0, 0, 256, 144), anchor: { x: 128, y: 0 } },
      { instanceId: 'ground', layerId: 'ground', role: 'solid-terrain', content: 'Side-view solid ground.', polygon: rect(0, 100, 256, 44), anchor: { x: 0, y: 100 } },
      { instanceId: 'front-left', layerId: 'front', role: 'foreground-snow-rock', content: 'Left corner snow rocks.', polygon: rect(0, 120, 32, 24), anchor: { x: 0, y: 144 } },
      { instanceId: 'front-right', layerId: 'front', role: 'foreground-snow-rock', content: 'Right corner snow rocks.', polygon: rect(224, 120, 32, 24), anchor: { x: 256, y: 144 } }],
    protectedRegions: [{ regionId: 'valley', purpose: 'Preserve the central lower opening.', polygon: rect(90, 110, 76, 34),
      forbiddenInstanceIds: ['front-left', 'front-right'], maxOccludedPermille: 0 }],
    tolerances: { maxAnchorErrorPx: 4, minEnvelopeIoUPermille: 850, maxAspectErrorPermille: 5 } });
}
function observation(plan, rawSha256, mutate = () => {}) {
  const body = { format: 'ai_scene_reference_observation_v1', planSha256: plan.sha256, rawSha256, coordinates: 'canonical-reference-frame',
    instances: plan.recipe.blueprint.instances.map(({ instanceId, polygon, anchor }) => ({ instanceId, polygon: structuredClone(polygon), anchor: { ...anchor } })) };
  mutate(body); return seal(body);
}
const policy = { mode: 'native-reference', orientation: 'landscape', minimumShortEdge: 256, maximumWidth: 1024, maximumHeight: 1024 };
function init(root, reviewed = true) {
  api.initWorkflow(root, { projectId: 'standard.fixture', purpose: 'synthetic-simulation', compiler: 'scene-kit-native-reference-v2' });
  const layout = blueprint(), guide = referenceBlueprintGuide(layout), artifact = api.importWorkflowImage(root, guide.bytes);
  const specBody = { ...specDraft(), format: 'ai_scene_spec_v2', description: layout.sceneDescription, viewport: layout.viewport,
    referenceLayout: { blueprintSha256: layout.sha256, guide: artifact } };
  const spec = api.createDesignDraft(root, specBody), style = api.createDesignDraft(root, { ...styleDraft(), format: 'ai_scene_style_v2' }), cap = api.createDesignDraft(root, capabilitiesDraft());
  if (reviewed) api.reviewSceneDesigns(root, { spec: decision('spec', spec.sha256), style: decision('style', style.sha256) });
  const options = { planId: 'standard.r1', parents: [], capabilitiesSha256: cap.sha256, pixelPolicy: policy, blueprint: layout, intent: '' };
  return { layout, guide, specBody, spec, style, cap, options };
}
function native(width = 512, height = 288, alpha = 255) {
  const rgba = Buffer.alloc(width * height * 4, 255);
  for (let i = 0; i < rgba.length; i += 4) { rgba[i] = (i / 4) % 192; rgba[i + 3] = alpha; }
  return encodeRgbaPng(width, height, rgba);
}
function received(t) {
  const { root, parent } = setup(t), f = init(root), plan = api.freezeStandardReferencePlan(root, f.options), bytes = native();
  const result = api.receiveResult(root, authorizeAndReserve(root, plan), bytes);
  assert.equal(result.technical.status, 'pass'); return { root, parent, ...f, plan, result, bytes };
}

test('standard preview binds style-only input, dynamic instances and deterministic structure without events or approval', t => {
  const { root } = setup(t), f = init(root, false), before = api.inspectWorkflow(root);
  const options = { specSha256: f.spec.sha256, styleSha256: f.style.sha256, capabilitiesSha256: f.cap.sha256,
    pixelPolicy: policy, blueprint: f.layout, intent: '' };
  const proposal = api.previewStandardReference(root, options);
  assert.equal(proposal.executable, false); assert.equal(proposal.generationCalls, 0);
  assert.equal(proposal.inputPolicy.uploads, 'style-only'); assert.equal(proposal.request.images[0].role, 'layout-reference');
  assert.equal(proposal.sources.blueprint.instances.filter(i => i.role === 'foreground-snow-rock').length, 2);
  assert.ok(proposal.request.prompt.includes('Do not copy or infer their scene content'));
  assert.deepEqual(api.inspectWorkflow(root), before);
  rejects(() => api.freezeStandardReferencePlan(root, f.options), 'DESIGN_REVIEW_REQUIRED');
  const next = unseal(f.layout); next.instances[2].anchor.x = 2;
  rejects(() => api.previewStandardReference(root, { ...options, blueprint: seal(next) }), 'STANDARD_BLUEPRINT_BINDING');
});
test('standard spec rejects scene/layout input roles; geometry is independent of uploaded style pixels', t => {
  const { root } = setup(t), f = init(root), artifact = api.importWorkflowImage(root, native());
  const before = api.inspectWorkflow(root);
  for (const role of ['scene-reference', 'layout-sketch']) rejects(() => api.createDesignDraft(root,
    { ...f.specBody, specId: `bad.${role}`, inputs: [{ role, artifact }] }), 'WORKFLOW_CONTRACT');
  assert.deepEqual(api.inspectWorkflow(root), before);
  const spec = api.createDesignDraft(root, { ...f.specBody, specId: 'style.input', inputs: [{ role: 'style-reference', artifact }] });
  const p = api.previewStandardReference(root, { specSha256: spec.sha256, styleSha256: f.style.sha256, capabilitiesSha256: f.cap.sha256,
    pixelPolicy: policy, blueprint: f.layout, intent: '' });
  assert.equal(p.request.images[1].role, 'style-reference');
  assert.deepEqual(p.request.images[0].artifact, f.guide.artifact);
  rejects(() => api.createDesignDraft(root, { ...f.specBody, specId: 'dup.style', inputs: [{ role: 'style-reference', artifact }, { role: 'style-reference', artifact }] }), 'INPUT_ROLE_DUPLICATE');
});
test('blueprint rejects crossings, out of frame shapes, duplicate identity and planned foreground covering the protected valley', () => {
  const cases = [
    [b => { b.instances[2].polygon = [{ x: 0, y: 120 }, { x: 32, y: 144 }, { x: 0, y: 144 }, { x: 32, y: 120 }]; }, 'BLUEPRINT_SELF_INTERSECTION'],
    [b => { b.instances[2].polygon[0].x = -1; }, 'BLUEPRINT_NUMBER'],
    [b => { b.instances[2].instanceId = 'ground'; }, 'BLUEPRINT_DUPLICATE'],
    [b => { b.instances[2].polygon = rect(0, 120, 200, 24); }, 'BLUEPRINT_PROTECTED_OVERLAP'],
  ];
  for (const [mutate, code] of cases) { const b = unseal(blueprint()); mutate(b); rejects(() => validateReferenceBlueprint(seal(b)), code); }
});
test('blueprint permits a recipe without foreground, terrain or architectural roles', () => {
  const b = unseal(blueprint()); b.layers = b.layers.slice(0, 1); b.instances = b.instances.slice(0, 1); b.protectedRegions = [];
  const value = seal(b); validateReferenceBlueprint(value);
  assert.equal(inspectPng(referenceBlueprintGuide(value).bytes).nonzeroAlphaPixels, 256 * 144);
});
function withCabx(bytes) {
  const payload = Buffer.from('synthetic untrusted provenance'), chunk = Buffer.alloc(payload.length + 12);
  chunk.writeUInt32BE(payload.length); chunk.write('caBX', 4, 'ascii'); payload.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, -4)) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  return Buffer.concat([bytes.subarray(0, 33), chunk, bytes.subarray(33)]);
}
test('standard style input/anchor retain native metadata bytes while v1 import remains strict', t => {
  const { root, parent } = setup(t), input = join(parent, 'style.png'), bytes = withCabx(native()); writeFileSync(input, bytes);
  const b = brief(); b.inputs = [{ role: 'style-reference', path: input }];
  b.style = { mode: 'custom', preset: null, name: 'Synthetic native style', rules: ['Clear low-noise brushwork.'], anchorPath: input };
  const state = project.initStandardReference(root, b, { purpose: 'synthetic-simulation' });
  const spec = JSON.parse(readFileSync(join(root, 'spec-draft.json'))), style = JSON.parse(readFileSync(join(root, 'style-draft.json')));
  assert.equal(style.format, 'ai_scene_style_v2'); assert.equal(state.stage, 'awaiting-design-review');
  assert.deepEqual(api.readStandardWorkflowImage(join(root, 'workflow'), spec.inputs[0].artifact), bytes);
  assert.deepEqual(api.readStandardWorkflowImage(join(root, 'workflow'), style.anchors[0]), bytes);
  rejects(() => api.importWorkflowImage(join(root, 'workflow'), bytes), 'IMAGE_PNG_UNSUPPORTED');
});
test('reference technical gate checks aspect, resolution and alpha without claiming layout detection', t => {
  const { root } = setup(t), f = init(root), plan = api.freezeStandardReferencePlan(root, f.options);
  for (const [bytes, issue] of [[native(512, 256), 'REFERENCE_ASPECT'], [native(256, 144), 'REFERENCE_SIZE'], [native(512, 288, 200), 'REFERENCE_NOT_OPAQUE']]) {
    assert.ok(assessStandardReference(plan, bytes).issues.includes(issue));
  }
  const qa = assessStandardReference(plan, native()); assert.equal(qa.status, 'pass');
  assert.equal(qa.geometryEvidence, 'frame-only-operator-alignment-review-required');
  assert.deepEqual(qa.mapping.resized, { width: 256, height: 144 });
});
test('deviating anchors, envelopes and valley occlusion fail operator annotation metrics; missing/extra instances reject', t => {
  const f = received(t);
  const cases = [b => { b.instances[2].anchor.x = 10; }, b => { b.instances[2].polygon = rect(0, 120, 70, 24); },
    b => { b.instances[2].polygon = rect(0, 110, 220, 34); }];
  for (const mutate of cases) {
    const obs = observation(f.plan, f.result.rawSha256, mutate);
    assert.equal(assessReferenceObservation(f.layout, obs).status, 'layout-deviation');
  }
  for (const mutate of [b => b.instances.pop(), b => { b.instances[2].instanceId = 'unknown'; }])
    rejects(() => assessReferenceObservation(f.layout, observation(f.plan, f.result.rawSha256, mutate)), 'REFERENCE_OBSERVATION_COVERAGE');
});
test('raw image approval cannot bypass exact-image alignment packet and human acceptance gate', t => {
  const f = received(t), before = api.inspectWorkflow(f.root);
  rejects(() => api.reviewResult(f.root, f.plan.sha256, decision('raw.accept', f.result.rawSha256)), 'STANDARD_REFERENCE_REVIEW_REQUIRED');
  assert.deepEqual(api.inspectWorkflow(f.root), before);
  const obs = observation(f.plan, f.result.rawSha256), output = join(f.parent, 'review');
  const bundle = api.buildStandardReferenceReview(f.root, f.plan.sha256, obs, output);
  api.verifyStandardReferenceReview(f.root, f.plan.sha256, obs, output);
  assert.deepEqual(readFileSync(join(output, 'reference-native.png')), f.bytes);
  const packet = JSON.parse(readFileSync(join(output, 'review-packet.json')));
  assert.equal(bundle.packetSha256, packet.sha256); assert.equal(packet.automaticSemanticDetection, false);
  assert.equal(packet.metrics.status, 'pass'); assert.equal(packet.rawSha256, hash(f.bytes));
  rejects(() => api.reviewStandardReference(f.root, f.plan.sha256, obs, decision('wrong.packet', f.result.rawSha256)), 'STANDARD_REVIEW_TARGET');
  api.reviewStandardReference(f.root, f.plan.sha256, obs, decision('packet.accept', packet.sha256));
  assert.equal(api.inspectWorkflow(f.root).plans[0].status, 'accepted');
  rejects(() => api.freezeSceneSourceBatch(f.root, { batchId: 'legacy.not.allowed', referencePlanSha256: f.plan.sha256,
    capabilitiesSha256: f.cap.sha256, intent: '' }), 'STANDARD_RECONSTRUCTION_NOT_IMPLEMENTED');
  writeFileSync(join(output, 'reference-native.png'), native(512, 288, 254));
  assert.throws(() => api.verifyStandardReferenceReview(f.root, f.plan.sha256, obs, output));
});
test('failed alignment cannot be accepted; changed raw identity cannot reuse an observation', t => {
  const f = received(t), bad = observation(f.plan, f.result.rawSha256, b => { b.instances[2].anchor.x = 20; });
  const out = join(f.parent, 'bad-review'); api.buildStandardReferenceReview(f.root, f.plan.sha256, bad, out);
  const packet = JSON.parse(readFileSync(join(out, 'review-packet.json')));
  rejects(() => api.reviewStandardReference(f.root, f.plan.sha256, bad, decision('bad.accept', packet.sha256)), 'STANDARD_LAYOUT_REJECTED');
  rejects(() => api.buildStandardReferenceReview(f.root, f.plan.sha256, observation(f.plan, '0'.repeat(64)), join(f.parent, 'wrong')), 'REFERENCE_OBSERVATION_BINDING');
  api.reviewStandardReference(f.root, f.plan.sha256, bad, decision('bad.reject', packet.sha256, 'reject'));
  assert.equal(api.inspectWorkflow(f.root).plans[0].status, 'rejected-visual');
});
test('unknown remains terminal; v15 revision keeps the blueprint and needs a fresh authorization', t => {
  const { root } = setup(t), f = init(root), plan = api.freezeStandardReferencePlan(root, f.options);
  api.stopAttempt(root, authorizeAndReserve(root, plan), 'indeterminate');
  rejects(() => api.reservePlan(root, plan.sha256), 'RESERVATION_STATE');
  const next = api.reviseGenerationPlan(root, plan.sha256, { planId: 'standard.r2', capabilitiesSha256: f.cap.sha256, intent: 'Synthetic explicit retry decision.' });
  assert.equal(next.format, 'ai_scene_generation_plan_v15'); assert.deepEqual(next.recipe.blueprint, plan.recipe.blueprint);
  rejects(() => api.reservePlan(root, next.sha256), 'AUTHORIZATION_REQUIRED');
});
const brief = () => ({ projectId: 'standard.project', blueprint: blueprint(), inputs: [],
  style: { mode: 'preset', preset: 'clean-handpaint', name: '', rules: [], anchorPath: null } });
test('standard project reaches reviewed reference via adapter double, then stops before unsupported reconstruction', async t => {
  const { root, parent } = setup(t); let state = project.initStandardReference(root, brief(), { purpose: 'synthetic-simulation' });
  assert.equal(state.stage, 'awaiting-design-review'); assert.equal(state.eventCount, 3);
  const out = join(parent, 'proposal'); project.previewStandardReference(root, out); project.verifyStandardPreview(root, out);
  assert.deepEqual(project.inspectStandardReference(root), state);
  state = project.reviewStandardDesign(root, { spec: decision('spec', state.design.specSha256), style: decision('style', state.design.styleSha256) });
  assert.equal(state.stage, 'reference-plan-needed');
  rejects(() => project.planStandardReference(root, { hidden: true }), 'STANDARD_PLAN_OPTIONS');
  state = project.planStandardReference(root, {});
  let calls = 0;
  const adapter = { preflight: async () => {}, generate: async input => {
    calls++; assert.equal(api.inspectWorkflow(join(root, 'workflow')).plans[0].status, 'submitted');
    assert.equal(input.images[0].role, 'layout-reference'); assert.equal(hash(input.images[0].bytes), input.images[0].artifact.sha256); return native();
  } };
  await assert.rejects(project.runStandardReference(root, adapter)); assert.equal(calls, 0);
  project.authorizeStandardReference(root, decision('compute', state.reference.planSha256, 'approve-compute'));
  state = await project.runStandardReference(root, adapter); assert.equal(calls, 1);
  assert.equal(state.stage, 'awaiting-reference-alignment-and-art-review');
  const sha = state.reference.planSha256, plan = api.getGenerationPlan(join(root, 'workflow'), sha), result = api.getGenerationResult(join(root, 'workflow'), sha);
  const obs = observation(plan, result.result.rawSha256), review = join(parent, 'review');
  const bundle = project.assessStandardReference(root, obs, review); project.verifyStandardAssessment(root, obs, review);
  state = project.reviewStandardImage(root, obs, decision('art', bundle.packetSha256));
  assert.equal(state.stage, 'reference-accepted-reconstruction-pending'); assert.equal(state.productionKit, false);
  assert.equal(state.faithfulAssetReconstruction, 'not-implemented');
  await assert.rejects(project.runStandardReference(root, adapter)); assert.equal(calls, 1);
});
test('project adapter unknown is terminal, and preflight failure does not reserve', async t => {
  const { root } = setup(t); let state = project.initStandardReference(root, brief(), { purpose: 'synthetic-simulation' });
  project.reviewStandardDesign(root, { spec: decision('spec', state.design.specSha256), style: decision('style', state.design.styleSha256) });
  state = project.planStandardReference(root, {}); project.authorizeStandardReference(root, decision('compute', state.reference.planSha256, 'approve-compute'));
  let calls = 0;
  await assert.rejects(project.runStandardReference(root, { preflight: async () => { throw Error('synthetic unavailable'); }, generate: async () => { calls++; } }));
  assert.equal(project.inspectStandardReference(root).reference.reserved, false);
  const adapter = { preflight: async () => {}, generate: async () => { calls++; throw Error('synthetic lost reply'); } };
  state = await project.runStandardReference(root, adapter); assert.equal(state.reference.status, 'indeterminate'); assert.equal(calls, 1);
  await assert.rejects(project.runStandardReference(root, adapter)); assert.equal(calls, 1);
});
test('CLI init/preview/inspect are zero compute and output only closed style-only projects', async t => {
  const { root, parent } = setup(t), input = join(parent, 'brief.json'), output = join(parent, 'proposal'); writeFileSync(input, jsonBytes(brief()));
  const script = fileURLToPath(new URL('../scripts/standard-reference.mjs', import.meta.url));
  const invoke = async args => JSON.parse((await promisify(execFile)(process.execPath, [script, ...args], { timeout: 15000 })).stdout);
  const state = await invoke(['init', '--brief', input, '--out', root]);
  assert.equal(state.eventCount, 3); assert.equal(state.reference, null);
  const proof = await invoke(['preview', '--root', root, '--out', output]); assert.equal(proof.generationCalls, 0);
  assert.deepEqual(await invoke(['inspect', '--root', root]), state);
  assert.equal(JSON.parse(readFileSync(join(output, 'proposal.json'))).executable, false);
  await assert.rejects(invoke(['init', '--brief', input, '--out', root]));
  await assert.rejects(invoke(['inspect', '--root', root, '--yes', 'true']));
});
