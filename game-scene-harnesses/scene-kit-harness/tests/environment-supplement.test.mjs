import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as api from '../src/generation/index.mjs';
import { ENVIRONMENT_SOURCE_PROFILE as P } from '../src/generation/environment-source.mjs';
import { encodeRgbaPng, inspectPng } from '../src/png.mjs';
import { raster } from '../src/terrain-proof/raster.mjs';
import { jsonBytes } from '../src/generation/common.mjs';
import { setup, specDraft, styleDraft, capabilitiesDraft, referencePlan, complete, bytesFor, decision, authorizeAndReserve } from './helpers/generation.mjs';

const rejects = (fn, code) => assert.throws(fn, error => error.errors?.some(item => item.code === code));
function prepare(t) {
  const c = setup(t);
  api.initWorkflow(c.root, { projectId: 'supplement.fixture', purpose: 'synthetic-simulation', compiler: 'scene-kit-native-reference-v2' });
  const spec = api.createDesignDraft(c.root, specDraft()), style = api.createDesignDraft(c.root, styleDraft());
  api.reviewDesign(c.root, 'spec', decision('spec', spec.sha256)); api.reviewDesign(c.root, 'style', decision('style', style.sha256));
  const capabilities = api.createDesignDraft(c.root, capabilitiesDraft()), reference = referencePlan(c.root, capabilities);
  complete(c.root, reference, bytesFor('terrain-000'));
  return { ...c, capabilities, reference };
}
function options(c, role = 'distant-ruins', planId = 'supplement.r1') {
  return { planId, parents: [], referencePlanSha256: c.reference.sha256, capabilitiesSha256: c.capabilities.sha256,
    assetId: 'supplement.source', role, intent: 'Synthetic source only; no generation or human art acceptance.',
    sourcePolicy: { mode: 'native-environment', orientation: 'landscape', minimumWidth: 512, minimumHeight: 256, maximumWidth: 1024, maximumHeight: 1024 },
    derivation: { pixelSize: { width: 128, height: 64 }, fit: P.derivation.block, repeatAxis: 'none' } };
}
function artwork(cutoff = false) {
  const p = raster(512, 256);
  for (let y = 48; y < 224; y++) for (let x = 48; x < 464; x++) {
    if (x > 208 && x < 288 && y > 80 && y < 192) continue;
    p.rgba.set([60 + x % 90, 80 + y % 70, 110, y === 48 ? 128 : 255], (y * p.width + x) * 4);
  }
  // Hidden RGB is diagnostic; visible edge pixels still fail reception.
  p.rgba.set(cutoff ? [90, 70, 50, 253] : [90, 70, 50, 0], 0);
  return encodeRgbaPng(p.width, p.height, p.rgba);
}

for (const role of ['distant-ruins', 'floating-platform-shell', 'valley-water']) {
  test(`v7 ${role} binds reviewed source, requires authorization and derives complete transparent finite art`, t => {
    const c = prepare(t), plan = api.freezeEnvironmentSupplementPlan(c.root, options(c, role));
    assert.equal(plan.format, 'ai_scene_generation_plan_v7'); assert.equal(plan.request.format, 'ai_scene_image_request_v7');
    assert.equal(plan.target.role, role); assert.equal(plan.target.repeatAxis, 'none'); assert.equal(plan.request.maximumCalls, 1);
    assert.match(plan.request.prompt, /not a complete scene/); assert.equal(plan.profile.productionKit, false);
    assert.deepEqual(api.readGenerationInput(c.root, plan.sha256, 0), bytesFor('terrain-000'));
    rejects(() => api.reservePlan(c.root, plan.sha256), 'AUTHORIZATION_REQUIRED');
    const raw = artwork(), result = api.receiveResult(c.root, authorizeAndReserve(c.root, plan), raw);
    assert.equal(result.technical.status, 'pass'); assert.equal(result.technical.hiddenRgbPixels, 1);
    assert.deepEqual(readFileSync(join(c.root, 'blobs', `${result.rawSha256}.bin`)), raw);
    assert.equal(api.recheckResult(c.root, plan.sha256, result.rawSha256).sha256, result.technical.sha256);
    const out = join(c.parent, 'proof'); api.buildEnvironmentProofBundle(c.root, plan.sha256, out);
    const report = JSON.parse(readFileSync(join(out, 'derivation.json'), 'utf8'));
    assert.equal(report.seam.status, 'not-required'); assert.equal(report.generationCalls, 0);
    assert.equal(report.visualAcceptance, 'not-assessed'); assert.equal(report.productionKit, false);
    api.verifyEnvironmentProofBundle(c.root, plan.sha256, out);
    const image = inspectPng(readFileSync(join(out, 'assets/environment.png')), { includePixels: true });
    assert.ok(image.rgba.some((v, i) => i % 4 === 3 && v > 0 && v < 255));
    for (let p = 0; p < image.rgba.length; p += 4) if (!image.rgba[p + 3]) assert.equal(image.rgba[p] + image.rgba[p + 1] + image.rgba[p + 2], 0);
    assert.equal(api.inspectWorkflow(c.root).plans.at(-1).status, 'pending-visual-review');
    rejects(() => api.reservePlan(c.root, plan.sha256), 'RESERVATION_STATE');
  });
}

test('new roles remain closed in v5/v6; v7 refuses old roles, repetition, open fields and unsupported alpha', t => {
  const c = prepare(t), base = options(c), before = api.inspectWorkflow(c.root);
  rejects(() => api.freezeEnvironmentSourcePlan(c.root, base), 'ENVIRONMENT_ROLE');
  rejects(() => api.freezeEnvironmentSourcePlanV2(c.root, base), 'ENVIRONMENT_ROLE');
  for (const value of [{ ...base, role: 'foreground-foliage' }, { ...base, role: 'character' }, { ...base, endpoint: 'forbidden' },
    { ...base, derivation: { ...base.derivation, repeatAxis: 'x' } }]) assert.throws(() => api.freezeEnvironmentSupplementPlan(c.root, value));
  assert.deepEqual(api.inspectWorkflow(c.root), before);
  const caps = api.createDesignDraft(c.root, { ...capabilitiesDraft(), capabilityId: 'opaque.only', transparentBackground: false });
  rejects(() => api.freezeEnvironmentSupplementPlan(c.root, { ...base, capabilitiesSha256: caps.sha256 }), 'CAPABILITY_ALPHA_UNSUPPORTED');
});

test('visible cutoff fails; an unknown v7 attempt stays terminal and its revision needs a new exact authorization', t => {
  const c = prepare(t), base = options(c), bad = api.freezeEnvironmentSupplementPlan(c.root, base);
  const result = api.receiveResult(c.root, authorizeAndReserve(c.root, bad), artwork(true));
  assert.deepEqual(result.technical.issues, ['ENVIRONMENT_ALPHA_MARGIN']);
  rejects(() => api.buildEnvironmentProofBundle(c.root, bad.sha256, join(c.parent, 'bad-proof')), 'ENVIRONMENT_SOURCE_NOT_READY');
  const revision = api.reviseGenerationPlan(c.root, bad.sha256, { planId: 'supplement.r2', capabilitiesSha256: c.capabilities.sha256, intent: 'Keep visible edges inside canvas.' });
  assert.equal(revision.format, 'ai_scene_generation_plan_v7'); assert.deepEqual(revision.recipe.parents, [bad.sha256]);
  rejects(() => api.reservePlan(c.root, revision.sha256), 'AUTHORIZATION_REQUIRED');
  const ticket = authorizeAndReserve(c.root, revision); api.recordSubmission(c.root, ticket); api.stopAttempt(c.root, ticket, 'indeterminate');
  rejects(() => api.reservePlan(c.root, revision.sha256), 'RESERVATION_STATE');
  rejects(() => api.receiveResult(c.root, ticket, artwork()), 'ATTEMPT_NOT_PENDING');
  const states = api.inspectWorkflow(c.root).plans.slice(-2).map(p => p.status);
  assert.deepEqual(states, ['rejected-technical', 'indeterminate']);
});

test('offline supplement CLI freezes the same immutable plan and submits no job', t => {
  const c = prepare(t), file = join(c.parent, 'options.json'); writeFileSync(file, jsonBytes(options(c)));
  const cli = fileURLToPath(new URL('../scripts/workflow.mjs', import.meta.url));
  const response = JSON.parse(execFileSync(process.execPath, [cli, 'plan-environment-supplement', '--root', c.root, '--file', file], { encoding: 'utf8' }));
  assert.equal(response.ok, true); assert.equal(response.coreProviderCalls, 0); const plan = response.result;
  assert.equal(api.getGenerationPlan(c.root, plan.sha256).sha256, plan.sha256);
  assert.deepEqual(api.inspectWorkflow(c.root).plans.at(-1), { planId: 'supplement.r1', planSha256: plan.sha256,
    stage: 'environment-source', status: 'planned', current: true, maximumCalls: 1, reserved: false, received: false });
});
