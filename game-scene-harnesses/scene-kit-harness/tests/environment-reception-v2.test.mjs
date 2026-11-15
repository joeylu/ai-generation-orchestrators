import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as api from '../src/generation/index.mjs';
import { hash, digest, jsonBytes, seal } from '../src/generation/common.mjs';
import { encodeRgbaPng, inspectPng } from '../src/png.mjs';
import { deriveEnvironmentProof } from '../src/environment-proof.mjs';
import { setup, specDraft, styleDraft, capabilitiesDraft, referencePlan, complete, bytesFor, decision, authorizeAndReserve } from './helpers/generation.mjs';

const rejects = (fn, code) => assert.throws(fn, error => error.errors?.some(item => item.code === code));
function prepare(t) {
  const c = setup(t); api.initWorkflow(c.root, { projectId: 'environment.v2.fixture', purpose: 'synthetic-simulation', compiler: 'scene-kit-native-reference-v2' });
  const spec = api.createDesignDraft(c.root, specDraft()), style = api.createDesignDraft(c.root, styleDraft());
  api.reviewDesign(c.root, 'spec', decision('spec', spec.sha256)); api.reviewDesign(c.root, 'style', decision('style', style.sha256));
  const cap = api.createDesignDraft(c.root, capabilitiesDraft()), reference = referencePlan(c.root, cap); complete(c.root, reference, bytesFor('terrain-000'));
  const capabilities = api.createDesignDraft(c.root, { ...capabilitiesDraft(), capabilityId: 'environment.native', exactSize: false });
  const options = { planId: 'environment.v1', parents: [], referencePlanSha256: reference.sha256, capabilitiesSha256: capabilities.sha256,
    assetId: 'far.fixture', role: 'distant-mountains',
    sourcePolicy: { mode: 'native-environment', orientation: 'landscape', minimumWidth: 512, minimumHeight: 256, maximumWidth: 1024, maximumHeight: 1024 },
    derivation: { pixelSize: { width: 64, height: 16 }, fit: api.ENVIRONMENT_SOURCE_PROFILE.derivation.strip, repeatAxis: 'x' }, intent: 'Synthetic environment v2 fixture.' };
  return { ...c, capabilities, options };
}
function artwork({ hidden = true, faint = false, broken = false } = {}) {
  const rgba = Buffer.alloc(512 * 256 * 4);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 512; x++) {
    const p = (y * 512 + x) * 4;
    if (y < 128) { if (hidden) rgba.set([190, 130, 100, 0], p); }
    else rgba.set([broken && x >= 504 ? 220 : 70 + Math.min(Math.floor(x / 8), Math.floor((511 - x) / 8)), 100 + y % 30, 90, 255], p);
  }
  if (faint) rgba.set([80, 100, 90, 1], (8 * 512 + 10) * 4);
  return encodeRgbaPng(512, 256, rgba);
}
function oldRejected(c, raw = artwork()) {
  const plan = api.freezeEnvironmentSourcePlan(c.root, c.options), ticket = authorizeAndReserve(c.root, plan);
  const result = api.receiveResult(c.root, ticket, raw); assert.equal(result.technical.status, 'fail');
  return { plan, result, raw };
}
const reinspect = (c, plan) => api.reinspectEnvironmentSource(c.root, { inspectionId: 'environment.reinspection', sourcePlanSha256: plan.sha256 });

test('hidden-RGB opt-in preserves source pixels and all PNG guards while the default decoder stays strict', () => {
  const raw = artwork(), before = hash(raw);
  assert.throws(() => inspectPng(raw), /Zero-alpha RGB/);
  const decoded = inspectPng(raw, { allowHiddenRgb: true, includePixels: true, pixelStats: true });
  assert.equal(decoded.hiddenRgbPixels, 512 * 128); assert.equal(decoded.rgba[0], 190); assert.equal(decoded.rgba[3], 0);
  assert.equal(hash(raw), before);
  const badCrc = Buffer.from(raw); badCrc[badCrc.length - 1] ^= 1;
  assert.throws(() => inspectPng(badCrc, { allowHiddenRgb: true }));
  const empty = Buffer.alloc(512 * 256 * 4); for (let p = 0; p < empty.length; p += 4) empty[p] = p % 251;
  assert.equal(inspectPng(encodeRgbaPng(512, 256, empty), { allowHiddenRgb: true, pixelStats: true }).varied, false);
});

test('v6 is explicit, binds v2 source policy and retains the unchanged v5 request and its strict QA', t => {
  const c = prepare(t), old = api.freezeEnvironmentSourcePlan(c.root, c.options), oldBytes = jsonBytes(old);
  const current = api.freezeEnvironmentSourcePlanV2(c.root, { ...c.options, planId: 'environment.v2' });
  assert.equal(current.format, 'ai_scene_generation_plan_v6'); assert.equal(current.request.format, 'ai_scene_image_request_v6');
  assert.equal(current.target.profileSha256, api.ENVIRONMENT_SOURCE_PROFILE_V2_SHA256);
  assert.match(current.request.prompt, /ignored-for-native-source/); assert.notEqual(digest(current.request), digest(old.request));
  assert.deepEqual(jsonBytes(api.getGenerationPlan(c.root, old.sha256)), oldBytes);
  const raw = artwork(), result = api.receiveResult(c.root, authorizeAndReserve(c.root, current), raw);
  assert.equal(result.technical.status, 'pass'); assert.equal(result.technical.hiddenRgbPixels, 65536);
  assert.deepEqual(readFileSync(join(c.root, 'blobs', `${result.rawSha256}.bin`)), raw);
  assert.equal(api.recheckResult(c.root, current.sha256, result.rawSha256).sha256, result.technical.sha256);
});

test('zero-compute reinspection preserves the old failure and raw source, and cannot authorize/reserve or revise a generation', t => {
  const c = prepare(t), { plan, result, raw } = oldRejected(c), before = api.inspectWorkflow(c.root), assessment = reinspect(c, plan);
  assert.equal(assessment.technical.status, 'pass'); assert.equal(assessment.request.maximumCalls, 0);
  assert.equal(assessment.technical.hiddenRgbPixels, 65536); assert.equal(assessment.rawSha256, result.rawSha256);
  const after = api.inspectWorkflow(c.root); assert.equal(after.eventCount, before.eventCount + 1);
  assert.equal(after.plans.find(p => p.planSha256 === plan.sha256).status, 'rejected-technical');
  assert.equal(after.plans.at(-1).status, 'pending-visual-review'); assert.equal(after.plans.at(-1).maximumCalls, 0);
  assert.equal(after.plans.at(-1).reserved, false); assert.equal(after.plans.at(-1).kind, 'environment-reinspection');
  assert.deepEqual(readFileSync(join(c.root, 'blobs', `${result.rawSha256}.bin`)), raw);
  assert.equal(api.recheckResult(c.root, assessment.sha256, result.rawSha256).sha256, assessment.technical.sha256);
  assert.equal(api.recheckResult(c.root, plan.sha256, result.rawSha256).sha256, result.technical.sha256);
  rejects(() => api.reservePlan(c.root, assessment.sha256), 'AUTHORIZATION_REQUIRED');
  rejects(() => api.authorizePlan(c.root, assessment.sha256, decision('bad.compute', assessment.sha256, 'approve-compute')), 'AUTHORIZATION_STATE');
  rejects(() => api.reviseGenerationPlan(c.root, assessment.sha256, { planId: 'not.generation', capabilitiesSha256: c.capabilities.sha256, intent: '' }), 'REINSPECTION_NOT_GENERATION');
});

test('ignoring hidden colors never accepts an opaque backing or a malformed PNG as transparent art', t => {
  const c = prepare(t), image = inspectPng(artwork({ hidden: false }), { includePixels: true });
  for (let p = 3; p < image.rgba.length; p += 4) image.rgba[p] = 255;
  image.rgba.set([190, 130, 100, 0], 0);
  const old = oldRejected(c, encodeRgbaPng(image.width, image.height, image.rgba)), assessment = reinspect(c, old.plan);
  assert.equal(assessment.technical.status, 'fail'); assert.ok(assessment.technical.issues.includes('ENVIRONMENT_ALPHA_AREA'));
  const c2 = prepare(t), bad = Buffer.from(artwork()); bad[bad.length - 1] ^= 1; const corrupted = oldRejected(c2, bad);
  const before = api.inspectWorkflow(c2.root);
  rejects(() => reinspect(c2, corrupted.plan), 'ENVIRONMENT_REINSPECTION_SOURCE');
  assert.deepEqual(api.inspectWorkflow(c2.root), before);
});

test('height study preserves the complete alpha bounds, labels the changed canvas and cannot make the old target pass', t => {
  const c = prepare(t), old = oldRejected(c, artwork({ faint: true })), assessment = reinspect(c, old.plan), out = join(c.parent, 'height-study');
  rejects(() => api.buildEnvironmentProofBundle(c.root, assessment.sha256, join(c.parent, 'original')), 'ENVIRONMENT_STRIP_TOO_TALL');
  assert.equal(existsSync(join(c.parent, 'original')), false);
  const options = { studyId: 'height.r1', pixelSize: { width: 64, height: 32 } }, before = api.inspectWorkflow(c.root);
  const bundle = api.buildEnvironmentLayoutStudy(c.root, assessment.sha256, options, out);
  const report = JSON.parse(readFileSync(join(out, 'derivation.json')));
  assert.equal(report.originalTarget.derivation.pixelSize.height, 16); assert.equal(report.target.derivation.pixelSize.height, 32);
  assert.equal(report.layoutStudy.scope, 'separate-height-study-not-original-delivery');
  assert.deepEqual(report.placement.crop, { x: 0, y: 6, width: 512, height: 250 });
  assert.equal(report.placement.resized.height, 31); assert.equal(report.placement.offset.y, 1);
  assert.equal(bundle.productionKit, false); assert.equal(report.visualAcceptance, 'not-assessed');
  assert.equal(api.verifyEnvironmentLayoutStudy(c.root, assessment.sha256, options, out).verifiedFiles, 7);
  assert.deepEqual(api.inspectWorkflow(c.root), before); assert.deepEqual(readFileSync(join(out, 'source/original.png')), old.raw);
  const image = inspectPng(readFileSync(join(out, 'assets/environment.png')), { includePixels: true });
  assert.equal(image.width, 64); assert.equal(image.height, 32);
  for (let p = 0; p < image.rgba.length; p += 4) if (!image.rgba[p + 3]) assert.deepEqual([...image.rgba.subarray(p, p + 3)], [0, 0, 0]);
  writeFileSync(join(out, 'assets/environment.png'), Buffer.from('synthetic tampering'));
  rejects(() => api.verifyEnvironmentLayoutStudy(c.root, assessment.sha256, options, out), 'PROOF_BUNDLE_RECOMPILE_MISMATCH');
});

test('derived visible pixels and alpha are identical whether the source hidden RGB is colored or zero', t => {
  const c = prepare(t), plan = api.freezeEnvironmentSourcePlanV2(c.root, { ...c.options, planId: 'environment.v2' });
  const a = deriveEnvironmentProof(artwork(), plan), b = deriveEnvironmentProof(artwork({ hidden: false }), plan);
  assert.notEqual(a.report.source.sha256, b.report.source.sha256);
  assert.deepEqual(a.files.get('assets/environment.png'), b.files.get('assets/environment.png'));
  assert.deepEqual(a.files.get('proofs/three-periods.png'), b.files.get('proofs/three-periods.png'));
});

test('layout study rejects width changes, shrinking the target, excess budgets and seam concealment', t => {
  const c = prepare(t), old = oldRejected(c, artwork({ broken: true })), assessment = reinspect(c, old.plan);
  for (const size of [{ width: 65, height: 32 }, { width: 64, height: 15 }, { width: 64, height: 2049 }])
    rejects(() => deriveEnvironmentProof(old.raw, assessment, { studyId: 'bad', pixelSize: size }), 'ENVIRONMENT_LAYOUT_STUDY');
  const result = deriveEnvironmentProof(old.raw, assessment, { studyId: 'valid', pixelSize: { width: 64, height: 32 } });
  assert.equal(result.report.status, 'blocked-seam'); assert.equal(result.report.seam.repair, 'not-performed');
  const out = join(c.parent, 'wrong-width');
  rejects(() => api.buildEnvironmentLayoutStudy(c.root, assessment.sha256, { studyId: 'bad', pixelSize: { width: 65, height: 32 } }, out), 'ENVIRONMENT_LAYOUT_STUDY');
  assert.equal(existsSync(out), false);
});

test('reinspection remains bound to the current style and rejects invented QA after journal hashes are rebound', t => {
  const c = prepare(t), old = oldRejected(c); reinspect(c, old.plan);
  let previous = JSON.parse(readFileSync(join(c.root, 'workflow.json'))).sha256;
  for (const name of readdirSync(join(c.root, 'events')).sort()) {
    const event = JSON.parse(readFileSync(join(c.root, 'events', name)));
    if (event.record.format === 'ai_scene_environment_reinspection_v1') {
      const { sha256: _old, ...body } = event.record; body.technical = seal({ ...body.technical, hiddenRgbPixels: 0 }); event.record = seal(body);
    }
    const { sha256: _old, ...body } = event; body.previousSha256 = previous;
    const rebound = seal(body); previous = rebound.sha256; writeFileSync(join(c.root, 'events', name), jsonBytes(rebound));
  }
  rejects(() => api.inspectWorkflow(c.root), 'REINSPECTION_RECOMPILE_MISMATCH');
  const c2 = prepare(t), old2 = oldRejected(c2);
  const style = api.createDesignDraft(c2.root, { ...styleDraft(), styleId: 'new.style' }); api.reviewDesign(c2.root, 'style', decision('new.style', style.sha256));
  rejects(() => reinspect(c2, old2.plan), 'PLAN_STALE');
});

test('v6 unknown attempts still need a fresh revision/confirmation and CLI reinspection/study has no compute', async t => {
  const c = prepare(t), current = api.freezeEnvironmentSourcePlanV2(c.root, { ...c.options, planId: 'v2.unknown' });
  api.stopAttempt(c.root, authorizeAndReserve(c.root, current), 'indeterminate');
  const revised = api.reviseGenerationPlan(c.root, current.sha256, { planId: 'v2.revised', capabilitiesSha256: c.capabilities.sha256, intent: 'Explicit synthetic revision.' });
  assert.equal(revised.format, 'ai_scene_generation_plan_v6'); assert.deepEqual(revised.recipe.parents, [current.sha256]);
  rejects(() => api.reservePlan(c.root, revised.sha256), 'AUTHORIZATION_REQUIRED');
  const old = oldRejected(c, artwork({ faint: true })), file = join(c.parent, 'reinspect.json');
  writeFileSync(file, jsonBytes({ inspectionId: 'cli.inspection', sourcePlanSha256: old.plan.sha256 }));
  const cli = fileURLToPath(new URL('../scripts/workflow.mjs', import.meta.url)), exec = args => promisify(execFile)(process.execPath, [cli, ...args], { timeout: 30000 });
  const inspected = JSON.parse((await exec(['reinspect-environment', '--root', c.root, '--file', file])).stdout);
  assert.equal(inspected.coreProviderCalls, 0); assert.equal(inspected.result.request.maximumCalls, 0);
  const study = join(c.parent, 'study.json'), output = join(c.parent, 'cli-study');
  writeFileSync(study, jsonBytes({ studyId: 'cli.height', pixelSize: { width: 64, height: 32 } }));
  for (const command of ['build-environment-layout-study', 'verify-environment-layout-study']) {
    const result = JSON.parse((await exec([command, '--root', c.root, '--plan', inspected.result.sha256, '--file', study, '--out', output])).stdout);
    assert.equal(result.coreProviderCalls, 0);
  }
});
