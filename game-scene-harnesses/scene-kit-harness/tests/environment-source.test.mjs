import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as api from '../src/generation/index.mjs';
import { digest, hash, jsonBytes, seal } from '../src/generation/common.mjs';
import { ENVIRONMENT_SOURCE_PROFILE as P } from '../src/generation/environment-source.mjs';
import { deriveEnvironmentProof, environmentPlacement, environmentSeamEvidence, resampleEnvironmentAlpha } from '../src/environment-proof.mjs';
import { encodeRgbaPng, inspectPng } from '../src/png.mjs';
import { raster } from '../src/terrain-proof/raster.mjs';
import { setup, specDraft, styleDraft, capabilitiesDraft, referencePlan, complete, bytesFor, decision, authorizeAndReserve } from './helpers/generation.mjs';

const rejects = (fn, code) => assert.throws(fn, error => error.errors?.some(item => item.code === code));
function prepare(t) {
  const c = setup(t); api.initWorkflow(c.root, { projectId: 'environment.fixture', purpose: 'synthetic-simulation', compiler: 'scene-kit-native-reference-v2' });
  const spec = api.createDesignDraft(c.root, specDraft()), style = api.createDesignDraft(c.root, styleDraft());
  api.reviewDesign(c.root, 'spec', decision('spec', spec.sha256)); api.reviewDesign(c.root, 'style', decision('style', style.sha256));
  const exact = api.createDesignDraft(c.root, capabilitiesDraft()), reference = referencePlan(c.root, exact);
  complete(c.root, reference, bytesFor('terrain-000'));
  const capabilities = api.createDesignDraft(c.root, { ...capabilitiesDraft(), capabilityId: 'environment.double', exactSize: false });
  return { ...c, spec, style, reference, capabilities };
}
function options(c, role = 'distant-mountains', planId = 'environment.source.r1') {
  const fit = role === 'sky-background' ? P.derivation.sky : role === 'distant-mountains' ? P.derivation.strip : P.derivation.block;
  return { planId, parents: [], referencePlanSha256: c.reference.sha256, capabilitiesSha256: c.capabilities.sha256,
    assetId: 'environment.test', role,
    sourcePolicy: { mode: 'native-environment', orientation: 'landscape', minimumWidth: 512, minimumHeight: 256, maximumWidth: 1024, maximumHeight: 1024 },
    derivation: { pixelSize: { width: 64, height: 32 }, fit, repeatAxis: role === 'distant-mountains' ? 'x' : 'none' },
    intent: 'Synthetic environment source; no actual generation or human art review.' };
}
function artwork(kind = 'strip', { mismatch = false, margin = false, width = 512, height = 256 } = {}) {
  const image = raster(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const shown = kind === 'sky' || (kind === 'strip' ? y >= height / 2 : x >= 96 && x < 416 && y >= 96 && y < 224 && !(x >= 224 && x < 288 && y >= 128 && y < 192));
    if (!shown) continue;
    const green = 100 + y % 41, red = 60 + Math.min(Math.floor(x / 8), Math.floor((width - 1 - x) / 8));
    image.rgba.set([mismatch && x >= width - 8 ? 220 : red, green, 110, kind !== 'sky' && y === (kind === 'strip' ? height / 2 : 96) ? 128 : 255], (y * width + x) * 4);
  }
  if (margin) image.rgba.set([80, 90, 70, 255], 100 * width * 4);
  return encodeRgbaPng(width, height, image.rgba);
}
function receive(c, plan, bytes) { return api.receiveResult(c.root, authorizeAndReserve(c.root, plan), bytes); }

test('environment plans bind accepted appearance, native alpha policy and immutable derivation without spending compute', t => {
  const c = prepare(t), plan = api.freezeEnvironmentSourcePlan(c.root, options(c));
  assert.equal(plan.format, 'ai_scene_generation_plan_v5'); assert.equal(plan.request.maximumCalls, 1);
  assert.equal(plan.target.alpha, 'transparent'); assert.equal(plan.request.output.pixelSize, undefined);
  assert.equal(plan.recipe.derivation.pixelSize.width, 64); assert.equal(plan.profile.productionKit, false);
  assert.deepEqual(plan.request.images[0].artifact, {
    sha256: hash(bytesFor('terrain-000')), byteLength: bytesFor('terrain-000').length, pixelSize: { width: 64, height: 64 } });
  assert.equal(api.inspectWorkflow(c.root).plans.at(-1).status, 'planned');
  rejects(() => api.reservePlan(c.root, plan.sha256), 'AUTHORIZATION_REQUIRED');
  assert.equal(Object.isFrozen(api.ENVIRONMENT_SOURCE_PROFILE.transparent), true);
});

test('legacy workspaces, unknown roles, open fields, invalid dimensions and mismatched fits append no plan', t => {
  const c = prepare(t), base = options(c), before = api.inspectWorkflow(c.root);
  const invalid = [{ ...base, role: 'characters' }, { ...base, endpoint: 'unexpected' },
    { ...base, sourcePolicy: { ...base.sourcePolicy, minimumWidth: 0 } },
    { ...base, sourcePolicy: { ...base.sourcePolicy, maximumWidth: 4097 } },
    { ...base, derivation: { ...base.derivation, fit: 'stretch' } }, { ...base, derivation: { ...base.derivation, repeatAxis: 'none' } },
    { ...base, derivation: { ...base.derivation, pixelSize: { width: 4096, height: 32 } } }];
  for (const value of invalid) assert.throws(() => api.freezeEnvironmentSourcePlan(c.root, value));
  assert.deepEqual(api.inspectWorkflow(c.root), before);
  const legacy = setup(t); api.initWorkflow(legacy.root, { projectId: 'legacy.environment', purpose: 'synthetic-simulation' });
  rejects(() => api.freezeEnvironmentSourcePlan(legacy.root, base), 'WORKFLOW_COMPILER');
});

test('capability and accepted-reference requirements remain separate from exactSize and compute confirmation', t => {
  const c = prepare(t), base = options(c);
  for (const [name, delta, code] of [['no-alpha', { transparentBackground: false }, 'CAPABILITY_ALPHA_UNSUPPORTED'],
    ['no-input', { imageToImage: false }, 'CAPABILITY_INPUT_UNSUPPORTED'], ['no-slot', { maxInputImages: 0 }, 'CAPABILITY_INPUT_UNSUPPORTED'],
    ['small', { maxWidth: 512 }, 'CAPABILITY_SIZE_UNSUPPORTED']]) {
    const cap = api.createDesignDraft(c.root, { ...capabilitiesDraft(), capabilityId: name, ...delta });
    rejects(() => api.freezeEnvironmentSourcePlan(c.root, { ...base, capabilitiesSha256: cap.sha256 }), code);
  }
  const unreviewed = referencePlan(c.root, api.createDesignDraft(c.root, { ...capabilitiesDraft(), capabilityId: 'unreviewed.reference' }), 'unreviewed');
  rejects(() => api.freezeEnvironmentSourcePlan(c.root, { ...base, referencePlanSha256: unreviewed.sha256 }), 'ACCEPTED_REFERENCE_REQUIRED');
  assert.equal(api.freezeEnvironmentSourcePlan(c.root, base).request.output.alpha, 'transparent');
});

test('native transparent source retains exact bytes, soft alpha and bounds; reception is not an image review or seam pass', t => {
  const c = prepare(t), plan = api.freezeEnvironmentSourcePlan(c.root, options(c)), raw = artwork(), result = receive(c, plan, raw);
  assert.equal(result.technical.status, 'pass'); assert.ok(result.technical.alphaEvidence.partialAlphaPixels > 0);
  assert.equal(result.technical.seamQuality, 'not-assessed'); assert.equal(result.technical.visualAcceptance, 'not-assessed');
  assert.deepEqual(result.technical.image.pixelSize, { width: 512, height: 256 });
  assert.deepEqual(readFileSync(join(c.root, 'blobs', `${result.rawSha256}.bin`)), raw);
  assert.equal(api.recheckResult(c.root, plan.sha256, result.rawSha256).sha256, result.technical.sha256);
  rejects(() => api.reservePlan(c.root, plan.sha256), 'RESERVATION_STATE');
  assert.equal(api.inspectWorkflow(c.root).plans.at(-1).status, 'pending-visual-review');
});

for (const [name, make, issue] of [
  ['opaque backing', () => artwork('sky'), 'ENVIRONMENT_ALPHA_AREA'],
  ['single transparent pixel', () => { const p = inspectPng(artwork('sky'), { includePixels: true }); p.rgba.fill(0, 0, 4); return encodeRgbaPng(p.width, p.height, p.rgba); }, 'ENVIRONMENT_ALPHA_AREA'],
  ['translucent backing', () => { const p = inspectPng(artwork('sky'), { includePixels: true }); for (let i = 3; i < p.rgba.length; i += 4) p.rgba[i] = 200; return encodeRgbaPng(p.width, p.height, p.rgba); }, 'ENVIRONMENT_ALPHA_AREA'],
  ['empty', () => encodeRgbaPng(512, 256, Buffer.alloc(512 * 256 * 4)), 'OUTPUT_EMPTY'],
  ['top content cutoff', () => { const p = inspectPng(artwork(), { includePixels: true }); p.rgba.set([90, 90, 90, 255], 0); return encodeRgbaPng(p.width, p.height, p.rgba); }, 'ENVIRONMENT_ALPHA_MARGIN'],
  ['strip does not span width', () => artwork('block'), 'ENVIRONMENT_STRIP_WIDTH'],
  ['small', () => artwork('strip', { width: 384 }), 'OUTPUT_SIZE'],
  ['portrait', () => artwork('strip', { width: 256, height: 512 }), 'ENVIRONMENT_ORIENTATION'],
  ['hidden RGB', () => { const p = inspectPng(artwork(), { includePixels: true }); p.rgba[0] = 255; return encodeRgbaPng(p.width, p.height, p.rgba); }, 'OUTPUT_PNG_UNSUPPORTED'],
  ['invalid PNG', () => Buffer.from('invalid png'), 'OUTPUT_PNG_UNSUPPORTED'],
]) test(`environment ${name} remains a retained technical rejection`, t => {
  const c = prepare(t), plan = api.freezeEnvironmentSourcePlan(c.root, options(c)), raw = make(), result = receive(c, plan, raw);
  assert.ok(result.technical.issues.includes(issue));
  assert.deepEqual(readFileSync(join(c.root, 'blobs', `${result.rawSha256}.bin`)), raw);
  rejects(() => api.reviewResult(c.root, plan.sha256, decision('bad.source', result.rawSha256)), 'IMAGE_REVIEW_STATE');
  rejects(() => api.buildEnvironmentProofBundle(c.root, plan.sha256, join(c.parent, 'forbidden')), 'ENVIRONMENT_SOURCE_NOT_READY');
  assert.equal(existsSync(join(c.parent, 'forbidden')), false);
});

test('opaque sky source remains opaque and uses an explicit center-cover crop; reference rules are unchanged', t => {
  const c = prepare(t), plan = api.freezeEnvironmentSourcePlan(c.root, options(c, 'sky-background')), raw = artwork('sky');
  const result = receive(c, plan, raw); assert.equal(result.technical.status, 'pass');
  const proof = deriveEnvironmentProof(raw, plan), image = inspectPng(proof.files.get('assets/environment.png'));
  assert.equal(image.transparentPixels, 0); assert.deepEqual(proof.report.placement.crop, { x: 0, y: 0, width: 512, height: 256 });
  const crop = environmentPlacement({ width: 600, height: 256 }, plan.target, null);
  assert.deepEqual(crop.crop, { x: 44, y: 0, width: 512, height: 256 });
  rejects(() => environmentPlacement({ width: 32, height: 16 }, plan.target, null), 'ENVIRONMENT_UPSCALE_REQUIRED');
});

test('alpha area sampling has known weights, preserves soft color and leaves transparent RGB zero without matte bleed', () => {
  const source = raster(2, 1); source.rgba.set([255, 0, 0, 255, 0, 0, 0, 0]); const before = Buffer.from(source.rgba);
  assert.deepEqual([...resampleEnvironmentAlpha(source, { x: 0, y: 0, width: 2, height: 1 }, 1, 1).rgba], [255, 0, 0, 128]);
  assert.deepEqual(source.rgba, before);
  source.rgba.set([200, 0, 0, 1, 0, 0, 0, 0]);
  assert.deepEqual([...resampleEnvironmentAlpha(source, { x: 0, y: 0, width: 2, height: 1 }, 1, 1).rgba], [200, 0, 0, 1]);
  source.rgba.fill(0); assert.deepEqual([...resampleEnvironmentAlpha(source, { x: 0, y: 0, width: 2, height: 1 }, 1, 1).rgba], [0, 0, 0, 0]);
  rejects(() => resampleEnvironmentAlpha(source, { x: 0, y: 0, width: 2, height: 1 }, 3, 1), 'ENVIRONMENT_CROP');
});

test('isolated block preserves its transparent inner hole and soft silhouette, rejects cutoff and never upscales content', t => {
  const c = prepare(t), plan = api.freezeEnvironmentSourcePlan(c.root, options(c, 'ruins-arch-group')), raw = artwork('block');
  assert.equal(receive(c, plan, raw).technical.status, 'pass');
  const result = deriveEnvironmentProof(raw, plan), image = inspectPng(result.files.get('assets/environment.png'), { includePixels: true });
  assert.equal(image.rgba[(17 * image.width + 32) * 4 + 3], 0);
  assert.ok(image.transparentPixels > 0); assert.equal(result.report.placement.resized.width, 64);
  assert.equal(result.report.placement.offset.y, 6); assert.equal(result.report.placement.anchorPx.y, 31);
  assert.deepEqual(result.files, deriveEnvironmentProof(raw, plan).files);
  for (let p = 0; p < image.rgba.length; p += 4) if (!image.rgba[p + 3]) assert.deepEqual([...image.rgba.subarray(p, p + 3)], [0, 0, 0]);
  const bad = api.freezeEnvironmentSourcePlan(c.root, { ...options(c, 'ruins-arch-group', 'cutoff'), assetId: 'cutoff' });
  assert.ok(receive(c, bad, artwork('block', { margin: true })).technical.issues.includes('ENVIRONMENT_ALPHA_MARGIN'));
});

test('strip proof checks its exact seam, shows three periods and preserves failure instead of repairing it', t => {
  const c = prepare(t), plan = api.freezeEnvironmentSourcePlan(c.root, options(c));
  const good = deriveEnvironmentProof(artwork(), plan), bad = deriveEnvironmentProof(artwork('strip', { mismatch: true }), plan);
  assert.equal(good.report.seam.status, 'pass'); assert.equal(bad.report.seam.status, 'fail');
  assert.equal(bad.report.status, 'blocked-seam'); assert.equal(bad.report.seam.repair, 'not-performed');
  assert.equal(bad.report.visualAcceptance, 'not-assessed'); assert.equal(bad.report.productionKit, false);
  assert.equal(inspectPng(good.files.get('proofs/three-periods.png')).width, 192);
  const narrow = { ...plan.target, derivation: { ...plan.target.derivation, pixelSize: { width: 513, height: 128 } } };
  rejects(() => environmentPlacement({ width: 512, height: 256 }, narrow, { contentBounds: { x: 0, y: 128, width: 512, height: 128 } }), 'ENVIRONMENT_UPSCALE_REQUIRED');
  rejects(() => environmentPlacement({ width: 512, height: 256 }, { ...plan.target, derivation: { ...plan.target.derivation, pixelSize: { width: 64, height: 8 } } },
    { contentBounds: { x: 0, y: 50, width: 512, height: 200 } }), 'ENVIRONMENT_STRIP_TOO_TALL');
  assert.equal(environmentSeamEvidence(inspectPng(good.files.get('assets/environment.png'), { includePixels: true }), 'x').status, 'pass');
});

test('a technically visible faint source cannot turn into a successful empty derived asset after alpha rounding', t => {
  const c = prepare(t), plan = api.freezeEnvironmentSourcePlan(c.root, options(c, 'tree-group'));
  const image = raster(512, 256);
  for (let y = 96; y < 224; y += 4) for (let x = 96; x < 416; x += 4) image.rgba.set([80, 100, 90, 1], (y * image.width + x) * 4);
  const raw = encodeRgbaPng(image.width, image.height, image.rgba), result = receive(c, plan, raw);
  assert.equal(result.technical.status, 'pass');
  rejects(() => api.buildEnvironmentProofBundle(c.root, plan.sha256, join(c.parent, 'empty-derived')), 'ENVIRONMENT_DERIVED_EMPTY');
  assert.equal(existsSync(join(c.parent, 'empty-derived')), false);
  assert.deepEqual(readFileSync(join(c.root, 'blobs', `${result.rawSha256}.bin`)), raw);
});

test('environment bundle replay retains raw bytes and separate review, rejects tampering and reports a blocked seam truthfully', t => {
  const c = prepare(t), plan = api.freezeEnvironmentSourcePlan(c.root, options(c)), raw = artwork('strip', { mismatch: true });
  const result = receive(c, plan, raw), out = join(c.parent, 'proof'), before = api.inspectWorkflow(c.root);
  const bundle = api.buildEnvironmentProofBundle(c.root, plan.sha256, out);
  assert.equal(bundle.status, 'blocked-seam'); assert.deepEqual(api.inspectWorkflow(c.root), before);
  assert.deepEqual(readFileSync(join(out, 'source/original.png')), raw);
  const report = api.verifyEnvironmentProofBundle(c.root, plan.sha256, out);
  assert.equal(report.verifiedFiles, 7); assert.equal(report.environmentStatus, 'blocked-seam'); assert.equal(report.seam.status, 'fail');
  api.reviewResult(c.root, plan.sha256, decision('source.only', result.rawSha256));
  assert.equal(api.verifyEnvironmentProofBundle(c.root, plan.sha256, out).bundleSha256, bundle.sha256);
  rejects(() => api.buildEnvironmentProofBundle(c.root, plan.sha256, out), 'OUTPUT_EXISTS');
  rejects(() => api.buildEnvironmentProofBundle(c.root, plan.sha256, join(c.root, 'overlap')), 'OUTPUT_OVERLAP');
  writeFileSync(join(out, 'assets/environment.png'), Buffer.from('synthetic corruption'));
  rejects(() => api.verifyEnvironmentProofBundle(c.root, plan.sha256, out), 'PROOF_BUNDLE_RECOMPILE_MISMATCH');
});

test('unknown environment attempt is terminal; explicit revision preserves role and derivation and needs new confirmation', t => {
  const c = prepare(t), plan = api.freezeEnvironmentSourcePlan(c.root, options(c));
  api.stopAttempt(c.root, authorizeAndReserve(c.root, plan), 'indeterminate');
  rejects(() => api.reservePlan(c.root, plan.sha256), 'RESERVATION_STATE');
  const revised = api.reviseGenerationPlan(c.root, plan.sha256, { planId: 'environment.source.r2', capabilitiesSha256: c.capabilities.sha256, intent: 'Explicit fixture revision.' });
  assert.equal(revised.format, plan.format); assert.deepEqual(revised.recipe.derivation, plan.recipe.derivation);
  assert.equal(revised.recipe.role, plan.recipe.role); assert.deepEqual(revised.recipe.parents, [plan.sha256]);
  rejects(() => api.reservePlan(c.root, revised.sha256), 'AUTHORIZATION_REQUIRED');
});

test('new style makes environment plans stale and forged requests fail complete deterministic journal replay', t => {
  const c = prepare(t), plan = api.freezeEnvironmentSourcePlan(c.root, options(c));
  const style = api.createDesignDraft(c.root, { ...styleDraft(), styleId: 'style.r2' }); api.reviewDesign(c.root, 'style', decision('style.r2', style.sha256));
  rejects(() => api.authorizePlan(c.root, plan.sha256, decision('stale', plan.sha256, 'approve-compute')), 'PLAN_STALE');
  let previous = JSON.parse(readFileSync(join(c.root, 'workflow.json'))).sha256;
  for (const name of readdirSync(join(c.root, 'events')).sort()) {
    const event = JSON.parse(readFileSync(join(c.root, 'events', name)));
    if (event.record.format === 'ai_scene_generation_plan_v5') {
      const { sha256: _old, ...body } = event.record; body.request.output.alpha = 'opaque'; event.record = seal(body);
    }
    const { sha256: _old, ...body } = event; body.previousSha256 = previous;
    const rebound = seal(body); previous = rebound.sha256; writeFileSync(join(c.root, 'events', name), jsonBytes(rebound));
  }
  rejects(() => api.inspectWorkflow(c.root), 'PLAN_RECOMPILE_MISMATCH');
});

test('preparation and workflow CLI freeze reviewable plans and replay proofs with zero generation', async t => {
  const c = prepare(t), definition = options(c), out = join(c.parent, 'prepared');
  const { parents: _p, referencePlanSha256: _r, capabilitiesSha256: _c, ...input } = definition;
  const inputPath = join(c.parent, 'definition.json'); writeFileSync(inputPath, jsonBytes(input));
  const script = fileURLToPath(new URL('../scripts/prepare-environment-source.mjs', import.meta.url));
  const args = ['--root', c.root, '--reference', c.reference.sha256, '--capabilities', c.capabilities.sha256, '--file', inputPath, '--out', out];
  const exec = (path, values) => promisify(execFile)(process.execPath, [path, ...values], { timeout: 30000 });
  const report = JSON.parse((await exec(script, args)).stdout);
  assert.equal(report.actualNewMediaGenerationCalls, 0); assert.equal(report.newComputeAuthorizations, 0); assert.equal(report.newReservedAttempts, 0);
  assert.deepEqual(readFileSync(join(out, 'accepted-style-reference.png')), bytesFor('terrain-000'));
  const plan = api.getGenerationPlan(c.root, report.planSha256); receive(c, plan, artwork());
  const cli = fileURLToPath(new URL('../scripts/workflow.mjs', import.meta.url)), proof = join(c.parent, 'cli-proof');
  for (const command of ['build-environment-proof', 'verify-environment-proof']) {
    const result = JSON.parse((await exec(cli, [command, '--root', c.root, '--plan', plan.sha256, '--out', proof])).stdout);
    assert.equal(result.coreProviderCalls, 0);
  }
  const before = api.inspectWorkflow(c.root); await assert.rejects(exec(script, args)); assert.deepEqual(api.inspectWorkflow(c.root), before);
});
