import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, symlinkSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { deflateSync } from 'node:zlib';
import * as api from '../src/generation/index.mjs';
import { digest, hash, jsonBytes, seal } from '../src/generation/common.mjs';
import { inspectPng, encodeRgbaPng } from '../src/png.mjs';
import { TERRAIN_PROOF as P, TERRAIN_PROOF_SHA256 } from '../src/terrain-proof/profile.mjs';
import { areaResample, periodize, raster } from '../src/terrain-proof/raster.mjs';
import { assessProofLayout, deriveTerrainProof, materialCrops } from '../src/terrain-proof/derive.mjs';
import { deriveTerrainProofRevision, materialVariantAt, revisionCrops, shareVariantBorder } from '../src/terrain-proof/revision.mjs';
import { syntheticTerrainMaterial } from '../scripts/terrain-fixture.mjs';
import { authorizeAndReserve, bytesFor, capabilitiesDraft, complete, decision, prepare as legacyPrepare, referencePlan, setup, specDraft, styleDraft } from './helpers/generation.mjs';

const rejects = (operation, code) => assert.throws(operation, error => error.errors?.some(issue => issue.code === code));
const raw = syntheticTerrainMaterial();
function prepare(t) {
  const context = setup(t), { root } = context;
  api.initWorkflow(root, { projectId: 'terrain.proof.fixture', purpose: 'synthetic-simulation', compiler: 'scene-kit-native-reference-v2' });
  const spec = api.createDesignDraft(root, specDraft()), style = api.createDesignDraft(root, styleDraft());
  api.reviewDesign(root, 'spec', decision('spec', spec.sha256)); api.reviewDesign(root, 'style', decision('style', style.sha256));
  const exactCap = api.createDesignDraft(root, capabilitiesDraft()), reference = referencePlan(root, exactCap);
  complete(root, reference, bytesFor('terrain-000'));
  const capabilities = api.createDesignDraft(root, { ...capabilitiesDraft(), capabilityId: 'native.material', exactSize: false });
  return { ...context, spec, style, reference, capabilities };
}
const options = ({ reference, capabilities }, planId = 'material.r1') => ({ planId, parents: [], referencePlanSha256: reference.sha256,
  capabilitiesSha256: capabilities.sha256, intent: 'Synthetic terrain material source; never real artwork.' });
const planFor = context => api.freezeTerrainMaterialPlan(context.root, options(context));
const receive = (context, plan, bytes = raw) => api.receiveResult(context.root, authorizeAndReserve(context.root, plan), bytes);

test('integer-area resampling has known exact fractional weights, bounded crops and opaque-only input', () => {
  const source = raster(3, 1); [0, 90, 240].forEach((value, x) => source.rgba.set([value, value, value, 255], x * 4));
  assert.deepEqual([...areaResample(source, { x: 0, y: 0, width: 3, height: 1 }, 2, 1).rgba], [30, 30, 30, 255, 190, 190, 190, 255]);
  const square = raster(2, 2); [0, 0, 1, 1].forEach((value, i) => square.rgba.set([value, value, value, 255], i * 4));
  assert.deepEqual([...areaResample(square, { x: 0, y: 0, width: 2, height: 2 }, 1, 1).rgba], [1, 1, 1, 255]);
  rejects(() => areaResample(source, { x: 1, y: 0, width: 3, height: 1 }, 2, 1), 'PROOF_CROP');
  rejects(() => areaResample(source, { x: 0, y: 0, width: 3, height: 1 }, 4, 1), 'PROOF_CROP');
  source.rgba[3] = 254;
  rejects(() => areaResample(source, { x: 0, y: 0, width: 3, height: 1 }, 2, 1), 'PROOF_SOURCE_ALPHA');
});
test('crop coordinates are explicit for odd native dimensions without stretching a scene image', () => {
  assert.deepEqual(materialCrops(1672, 941), { cap: { x: 365, y: 0, width: 941, height: 117 }, body: { x: 423, y: 117, width: 824, height: 824 } });
  rejects(() => materialCrops(512, 512), 'MATERIAL_SOURCE_SIZE');
  rejects(() => materialCrops(1024, 511), 'MATERIAL_SOURCE_SIZE');
});
test('opposite-border processing preserves the source and interior while enforcing shared x/y edge pixels', () => {
  const source = raster(12, 12);
  for (let i = 0; i < 144; i++) source.rgba.set([i, i, i, 255], i * 4);
  const snapshot = Buffer.from(source.rgba), result = periodize(source, 2, true);
  assert.deepEqual(source.rgba, snapshot);
  assert.deepEqual(result.rgba.subarray((5 * 12 + 5) * 4, (5 * 12 + 5) * 4 + 4), source.rgba.subarray((5 * 12 + 5) * 4, (5 * 12 + 5) * 4 + 4));
  for (let t = 0; t < 12; t++) for (let c = 0; c < 4; c++) {
    assert.equal(result.rgba[(t * 12) * 4 + c], result.rgba[(t * 12 + 11) * 4 + c]);
    assert.equal(result.rgba[t * 4 + c], result.rgba[(11 * 12 + t) * 4 + c]);
  }
  rejects(() => periodize(source, 7, true), 'PROOF_BLEND');
});
test('RGB decoding adds opaque alpha and reconstructs nonzero PNG filters without changing old inspection output', () => {
  const chunk = (name, data) => {
    const output = Buffer.alloc(data.length + 12); output.writeUInt32BE(data.length); output.write(name, 4, 'ascii'); data.copy(output, 8);
    let crc = 0xffffffff;
    for (const byte of output.subarray(4, -4)) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    output.writeUInt32BE((crc ^ 0xffffffff) >>> 0, output.length - 4); return output;
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
  const bytes = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from([1, 10, 20, 30, 5, 10, 15]))), chunk('IEND', Buffer.alloc(0))]);
  assert.equal(inspectPng(bytes).rgba, undefined);
  assert.deepEqual([...inspectPng(bytes, { includePixels: true }).rgba], [10, 20, 30, 255, 15, 30, 45, 255]);
});
test('one immutable synthetic source deterministically yields 16 cardinal tiles and three measured proof layouts', () => {
  const before = hash(raw), first = deriveTerrainProof(raw), second = deriveTerrainProof(raw);
  assert.equal(hash(raw), before); assert.equal(first.report.sha256, second.report.sha256);
  assert.equal(first.report.source.sha256, before); assert.equal(first.report.profileSha256, TERRAIN_PROOF_SHA256);
  assert.equal(first.report.derivedCardinalTileCount, 16); assert.equal(first.report.independentGeneratedModuleCount, 0);
  assert.equal(first.report.productionKit, false); assert.equal(first.report.visualAcceptance, 'not-assessed');
  assert.ok(first.report.assessments.every(qa => qa.status === 'pass' && qa.geometryFailures === 0));
  assert.ok(first.report.assessments.flatMap(qa => qa.interfaces).some(edge => edge.transitionPixels > 0));
  for (const [path, bytes] of first.files) assert.deepEqual(bytes, second.files.get(path));
});
test('continuation seams and occupancy corruption fail while named corner transitions remain explicitly unreviewed', () => {
  const { files } = deriveTerrainProof(raw), straight = P.layouts[0];
  const image = inspectPng(files.get('proofs/straight.png'), { includePixels: true });
  const p = ((2 * 64 + 32) * image.width + 63) * 4; image.rgba[p] ^= 1;
  const qa = assessProofLayout(straight, image);
  assert.equal(qa.status, 'fail'); assert.ok(qa.interfaces.some(edge => edge.maximumChannelDifference > 0));
  const mask = inspectPng(files.get('proofs/straight.png'), { includePixels: true }); mask.rgba[3] = 255;
  assert.equal(assessProofLayout(straight, mask).geometryFailures, 1);
  const steps = P.layouts[1], stepImage = inspectPng(files.get('proofs/steps.png'), { includePixels: true });
  const initial = assessProofLayout(steps, stepImage), transition = initial.interfaces.find(edge => edge.transitionPixels > 0);
  const t = transition.transitionOffsets[0], x = transition.cell.x * 64 + (transition.axis === 'x' ? 63 : t), y = transition.cell.y * 64 + (transition.axis === 'x' ? t : 63);
  stepImage.rgba[(y * stepImage.width + x) * 4] ^= 31;
  const after = assessProofLayout(steps, stepImage);
  assert.equal(after.status, 'pass'); assert.equal(after.boundaryTransitions, 'requires-human-review'); assert.equal(after.visualAcceptance, 'not-assessed');
});
test('material planning accepts a native-only capability and binds the accepted scene plus full derivation rules', t => {
  const context = prepare(t), plan = planFor(context), before = api.inspectWorkflow(context.root);
  assert.equal(plan.format, 'ai_scene_generation_plan_v4'); assert.equal(plan.request.maximumCalls, 1);
  assert.equal(plan.request.output.pixelSize, undefined); assert.equal(plan.derivationProfile.profile, P.profile);
  assert.equal(plan.request.images[0].role, 'accepted-scene-style-reference');
  assert.deepEqual(api.readGenerationInput(context.root, plan.sha256, 0), bytesFor('terrain-000'));
  rejects(() => api.readGenerationInput(context.root, plan.sha256, 1), 'INPUT_IMAGE_INDEX');
  rejects(() => api.reservePlan(context.root, plan.sha256), 'AUTHORIZATION_REQUIRED');
  rejects(() => api.buildTerrainProofBundle(context.root, plan.sha256, join(context.parent, 'premature')), 'MATERIAL_SOURCE_NOT_READY');
  assert.deepEqual(api.inspectWorkflow(context.root), before);
});
test('unreviewed references and missing image capability fail before any material plan is appended', t => {
  const context = prepare(t), exactCap = api.createDesignDraft(context.root, { ...capabilitiesDraft(), capabilityId: 'pending.reference.cap' });
  const pending = referencePlan(context.root, exactCap, 'reference.pending');
  const noImages = api.createDesignDraft(context.root, { ...capabilitiesDraft(), capabilityId: 'no.material.images', imageToImage: false });
  const small = api.createDesignDraft(context.root, { ...capabilitiesDraft(), capabilityId: 'small.material.canvas', maxWidth: 2048 });
  const before = api.inspectWorkflow(context.root);
  rejects(() => api.freezeTerrainMaterialPlan(context.root, { ...options(context), referencePlanSha256: pending.sha256 }), 'ACCEPTED_REFERENCE_REQUIRED');
  rejects(() => api.freezeTerrainMaterialPlan(context.root, { ...options(context), capabilitiesSha256: noImages.sha256 }), 'CAPABILITY_INPUT_UNSUPPORTED');
  rejects(() => api.freezeTerrainMaterialPlan(context.root, { ...options(context), capabilitiesSha256: small.sha256 }), 'CAPABILITY_SIZE_UNSUPPORTED');
  rejects(() => api.freezeTerrainMaterialPlan(context.root, { ...options(context), pixelSize: { width: 64, height: 64 } }), 'WORKFLOW_SHAPE');
  assert.deepEqual(api.inspectWorkflow(context.root), before);
});
test('legacy workspaces and incompatible grids do not silently migrate to the material proof protocol', t => {
  const legacy = setup(t), { capabilities } = legacyPrepare(legacy.root), reference = referencePlan(legacy.root, capabilities);
  complete(legacy.root, reference, bytesFor('terrain-000'));
  const before = api.inspectWorkflow(legacy.root);
  rejects(() => api.freezeTerrainMaterialPlan(legacy.root, options({ reference, capabilities })), 'WORKFLOW_COMPILER');
  assert.deepEqual(api.inspectWorkflow(legacy.root), before);
  const context = prepare(t), spec = api.createDesignDraft(context.root, { ...specDraft(), specId: 'different.grid', grid: { width: 32, height: 32 } });
  api.reviewDesign(context.root, 'spec', decision('different.grid.review', spec.sha256));
  rejects(() => planFor(context), 'PROOF_GRID_UNSUPPORTED');
});
for (const [name, bytes, issue] of [
  ['portrait', syntheticTerrainMaterial(512, 768), 'MATERIAL_ORIENTATION'],
  ['small', syntheticTerrainMaterial(800, 256), 'OUTPUT_SIZE'],
  ['uniform', encodeRgbaPng(1024, 512, Buffer.alloc(1024 * 512 * 4, 255)), 'MATERIAL_BLANK'],
  ['invalid PNG', Buffer.from('synthetic invalid bytes'), 'OUTPUT_PNG_UNSUPPORTED'],
]) test(`material ${name} is a retained rejection and cannot enter derivation`, t => {
  const context = prepare(t), plan = planFor(context), result = receive(context, plan, bytes);
  assert.ok(result.technical.issues.includes(issue));
  assert.deepEqual(readFileSync(join(context.root, 'blobs', `${result.rawSha256}.bin`)), bytes);
  rejects(() => api.buildTerrainProofBundle(context.root, plan.sha256, join(context.parent, 'bad.proof')), 'MATERIAL_SOURCE_NOT_READY');
  assert.equal(api.recheckResult(context.root, plan.sha256, result.rawSha256).sha256, result.technical.sha256);
  rejects(() => api.reservePlan(context.root, plan.sha256), 'RESERVATION_STATE');
});
test('a transparent pixel outside the declared crops still rejects the entire opaque material source', t => {
  const image = inspectPng(raw, { includePixels: true }); image.rgba.set([0, 0, 0, 0], 0);
  const bytes = encodeRgbaPng(image.width, image.height, image.rgba), context = prepare(t), plan = planFor(context);
  const result = receive(context, plan, bytes);
  assert.ok(result.technical.issues.includes('OUTPUT_NOT_OPAQUE'));
  rejects(() => deriveTerrainProof(bytes), 'MATERIAL_SOURCE_OPAQUE_NONBLANK');
});
test('proof building and source review remain separate; all 28 files recompile identically after source acceptance', t => {
  const context = prepare(t), plan = planFor(context), result = receive(context, plan), output = join(context.parent, 'proof');
  const before = api.inspectWorkflow(context.root), bundle = api.buildTerrainProofBundle(context.root, plan.sha256, output);
  assert.equal(bundle.purpose, 'synthetic-simulation'); assert.equal(bundle.sourceRequiresSeparateVisualReview, true);
  assert.equal(bundle.visualAcceptance, 'not-assessed'); assert.equal(bundle.productionKit, false);
  assert.deepEqual(api.inspectWorkflow(context.root), before);
  assert.deepEqual(readFileSync(join(output, 'source/original.png')), raw);
  assert.equal(api.verifyTerrainProofBundle(context.root, plan.sha256, output).verifiedFiles, 28);
  rejects(() => api.buildTerrainProofBundle(context.root, plan.sha256, output), 'OUTPUT_EXISTS');
  api.reviewResult(context.root, plan.sha256, decision('material.source.review', result.rawSha256));
  assert.equal(api.verifyTerrainProofBundle(context.root, plan.sha256, output).status, 'deterministic-proof-valid');
  const status = api.inspectWorkflow(context.root);
  assert.equal(status.plans.filter(entry => entry.stage === 'terrain-material' && entry.reserved).length, 1);
});
test('proof verification rejects forged but internally rehashed image/manifest evidence', t => {
  const context = prepare(t), plan = planFor(context); receive(context, plan);
  const output = join(context.parent, 'forged.proof'); api.buildTerrainProofBundle(context.root, plan.sha256, output);
  const path = 'proofs/straight.png', image = inspectPng(readFileSync(join(output, path)), { includePixels: true });
  image.rgba[((2 * 64 + 32) * image.width + 63) * 4] ^= 1;
  const changed = encodeRgbaPng(image.width, image.height, image.rgba); writeFileSync(join(output, path), changed);
  const { sha256: _oldDerivation, ...derivation } = JSON.parse(readFileSync(join(output, 'derivation.json')));
  Object.assign(derivation.artifacts.find(item => item.path === path), { sha256: hash(changed), pixelSha256: hash(image.rgba), byteLength: changed.length });
  const forgedDerivation = seal(derivation), derivationBytes = jsonBytes(forgedDerivation); writeFileSync(join(output, 'derivation.json'), derivationBytes);
  const { sha256: _oldBundle, ...bundle } = JSON.parse(readFileSync(join(output, 'proof-bundle.json')));
  for (const [name, bytes] of [[path, changed], ['derivation.json', derivationBytes]]) Object.assign(bundle.artifacts.find(item => item.path === name), { sha256: hash(bytes), byteLength: bytes.length });
  bundle.derivationSha256 = forgedDerivation.sha256;
  bundle.inventorySha256 = digest(bundle.artifacts.toSorted((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  writeFileSync(join(output, 'proof-bundle.json'), jsonBytes(seal(bundle)));
  rejects(() => api.verifyTerrainProofBundle(context.root, plan.sha256, output), 'PROOF_BUNDLE_RECOMPILE_MISMATCH');
});
test('fresh-only proof output refuses workflow overlap and verification rejects unlisted content', t => {
  const context = prepare(t), plan = planFor(context); receive(context, plan);
  const before = api.inspectWorkflow(context.root);
  rejects(() => api.buildTerrainProofBundle(context.root, plan.sha256, join(context.root, 'proof')), 'OUTPUT_OVERLAP');
  assert.equal(existsSync(join(context.root, 'proof')), false); assert.deepEqual(api.inspectWorkflow(context.root), before);
  const output = join(context.parent, 'extra.proof'); api.buildTerrainProofBundle(context.root, plan.sha256, output);
  writeFileSync(join(output, 'unlisted.txt'), 'synthetic extra');
  rejects(() => api.verifyTerrainProofBundle(context.root, plan.sha256, output), 'PROOF_BUNDLE_INVENTORY');
});
test('proof directory links are rejected without modifying their targets', t => {
  const context = prepare(t), plan = planFor(context); receive(context, plan);
  const output = join(context.parent, 'linked.proof'); api.buildTerrainProofBundle(context.root, plan.sha256, output);
  const preserved = join(context.parent, 'preserved.tiles'); renameSync(join(output, 'tiles'), preserved);
  try { symlinkSync(preserved, join(output, 'tiles'), 'junction'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) return t.skip('OS does not permit creating the junction fixture'); throw error; }
  const original = readFileSync(join(preserved, 'cardinal-000.png'));
  rejects(() => api.verifyTerrainProofBundle(context.root, plan.sha256, output), 'PROOF_BUNDLE_PATH');
  assert.deepEqual(readFileSync(join(preserved, 'cardinal-000.png')), original);
});
test('a changed accepted style invalidates a frozen material authorization', t => {
  const context = prepare(t), plan = planFor(context);
  api.authorizePlan(context.root, plan.sha256, decision('old.material.compute', plan.sha256, 'approve-compute'));
  const style = api.createDesignDraft(context.root, { ...styleDraft(), styleId: 'new.material.style' });
  api.reviewDesign(context.root, 'style', decision('new.material.style.review', style.sha256));
  rejects(() => api.reservePlan(context.root, plan.sha256), 'PLAN_STALE');
});
test('unknown material generation is terminal; explicit revisions retain the profile and need a fresh authorization', t => {
  const context = prepare(t), plan = planFor(context);
  api.stopAttempt(context.root, authorizeAndReserve(context.root, plan), 'indeterminate');
  const next = api.reviseGenerationPlan(context.root, plan.sha256, { planId: 'material.r2', capabilitiesSha256: context.capabilities.sha256, intent: 'Explicit synthetic revision.' });
  assert.equal(next.recipe.profileSha256, TERRAIN_PROOF_SHA256); assert.deepEqual(next.recipe.parents, [plan.sha256]);
  rejects(() => api.reservePlan(context.root, next.sha256), 'AUTHORIZATION_REQUIRED');
  rejects(() => api.reservePlan(context.root, plan.sha256), 'RESERVATION_STATE');
});
test('rebound plan hashes cannot change a pilot into a complete 47-role asset kit', t => {
  const context = prepare(t); planFor(context);
  let previousSha256 = JSON.parse(readFileSync(join(context.root, 'workflow.json'))).sha256;
  for (const name of readdirSync(join(context.root, 'events')).sort()) {
    const event = JSON.parse(readFileSync(join(context.root, 'events', name)));
    if (event.record.format === 'ai_scene_generation_plan_v4') {
      const { sha256: _oldPlan, ...body } = event.record; body.derivationProfile.complete47RoleKit = true; event.record = seal(body);
    }
    const { sha256: _oldEvent, ...body } = event; body.previousSha256 = previousSha256;
    const next = seal(body); previousSha256 = next.sha256; writeFileSync(join(context.root, 'events', name), jsonBytes(next));
  }
  rejects(() => api.inspectWorkflow(context.root), 'PLAN_RECOMPILE_MISMATCH');
});
test('preparation and proof CLI paths stay offline, preserve caller output and reject extra options', async t => {
  const context = prepare(t), output = join(context.parent, 'prepared');
  const script = fileURLToPath(new URL('../scripts/prepare-terrain-proof.mjs', import.meta.url));
  const args = ['--root', context.root, '--reference', context.reference.sha256, '--capabilities', context.capabilities.sha256, '--id', 'prepared.material', '--out', output];
  const invoke = values => promisify(execFile)(process.execPath, [script, ...values], { timeout: 15000 });
  const prepared = JSON.parse((await invoke(args)).stdout);
  assert.equal(prepared.actualNewMediaGenerationCalls, 0); assert.equal(prepared.newComputeAuthorizations, 0);
  assert.deepEqual(readFileSync(join(output, 'accepted-style-reference.png')), bytesFor('terrain-000'));
  await assert.rejects(invoke(args), error => error.code === 1 && error.stderr.includes('OUTPUT_EXISTS') && !error.stderr.includes(context.parent));
  const badArgs = [...args]; badArgs[badArgs.indexOf('--out') + 1] = join(context.root, 'bad.output');
  await assert.rejects(invoke(badArgs), error => error.code === 1 && error.stderr.includes('OUTPUT_OVERLAP'));
  assert.equal(existsSync(join(context.root, 'bad.output')), false);
  const plan = api.getGenerationPlan(context.root, prepared.planSha256); receive(context, plan);
  const workflowCli = fileURLToPath(new URL('../scripts/workflow.mjs', import.meta.url)), proofOutput = join(context.parent, 'cli.proof');
  const cli = command => promisify(execFile)(process.execPath, [workflowCli, command, '--root', context.root, '--plan', plan.sha256, '--out', proofOutput], { timeout: 15000 });
  assert.equal(JSON.parse((await cli('build-terrain-proof')).stdout).coreProviderCalls, 0);
  assert.equal(JSON.parse((await cli('verify-terrain-proof')).stdout).result.verifiedFiles, 28);
  await assert.rejects(invoke([...args, '--unknown', 'x']), error => error.code === 1 && !error.stderr.includes(context.parent));
});
test('zero-compute crop revision has explicit top trim and four bounded larger material crops', () => {
  assert.deepEqual(revisionCrops(1672, 941), { cap: { x: 365, y: 58, width: 941, height: 59 },
    bodies: [{ x: 423, y: 117, width: 412, height: 412 }, { x: 835, y: 117, width: 412, height: 412 },
      { x: 423, y: 529, width: 412, height: 412 }, { x: 835, y: 529, width: 412, height: 412 }] });
  const fixture = inspectPng(raw, { includePixels: true });
  // Put a blue strip in the part deliberately excluded by the new cap crop.
  for (let y = 0; y < 32; y++) for (let x = 0; x < fixture.width; x++) fixture.rgba.set([0, 0, 255, 255], (y * fixture.width + x) * 4);
  const revision = deriveTerrainProofRevision(encodeRgbaPng(fixture.width, fixture.height, fixture.rgba));
  const cap = inspectPng(revision.files.get('materials/cap.png'), { includePixels: true });
  for (let p = 0; p < cap.rgba.length; p += 4) assert.ok(cap.rgba[p + 2] < cap.rgba[p + 1]);
});
test('all material variants share exact edge donors, retain interior detail and remain coordinate-stable', () => {
  const donorSource = raster(64, 64); donorSource.rgba.fill(255);
  const donor = periodize(donorSource, 4, true), alternate = raster(64, 64);
  for (let p = 0; p < alternate.rgba.length; p += 4) alternate.rgba.set([10, 30, 60, 255], p);
  const processed = shareVariantBorder(alternate, donor);
  assert.deepEqual([...processed.rgba.subarray((32 * 64 + 32) * 4, (32 * 64 + 32) * 4 + 4)], [10, 30, 60, 255]);
  assert.deepEqual([...processed.rgba.subarray(0, 4)], [255, 255, 255, 255]);
  const before = Array.from({ length: 30 }, (_, x) => materialVariantAt(x - 10, 2));
  assert.equal(new Set(before).size, 4); assert.deepEqual(before, Array.from({ length: 30 }, (_, x) => materialVariantAt(x - 10, 2)));
  rejects(() => materialVariantAt(0.5, 0), 'PROOF_CELL');
});
test('four-variant revision preserves the original producer and passes geometry/continuous-edge checks', () => {
  const original = deriveTerrainProof(raw), before = original.report.sha256, revised = deriveTerrainProofRevision(raw);
  assert.equal(revised.report.materialVariantCount, 4); assert.equal(revised.report.derivedTilePNGCount, 64);
  assert.equal(revised.report.independentGeneratedModuleCount, 0); assert.equal(revised.report.generationCalls, 0);
  assert.ok(revised.report.assessments.every(item => item.status === 'pass'));
  assert.equal(revised.report.source.sha256, hash(raw)); assert.equal(deriveTerrainProof(raw).report.sha256, before);
  assert.equal(new Set(revised.report.artifacts.filter(item => /^materials\/body-/.test(item.path)).map(item => item.sha256)).size, 4);
  assert.equal(deriveTerrainProofRevision(raw).report.sha256, revised.report.sha256);
});
test('revision bundle binds the unchanged source and verified parent without creating a generation attempt', t => {
  const context = prepare(t), plan = planFor(context); receive(context, plan);
  const parent = join(context.parent, 'original.proof'), revised = join(context.parent, 'revised.proof');
  const original = api.buildTerrainProofBundle(context.root, plan.sha256, parent), before = api.inspectWorkflow(context.root);
  const revision = api.reviseTerrainProofBundle(context.root, plan.sha256, parent, revised);
  assert.equal(revision.parentBundleSha256, original.sha256); assert.equal(revision.rawSha256, original.rawSha256);
  assert.equal(api.verifyTerrainProofRevision(context.root, plan.sha256, parent, revised).verifiedFiles, 79);
  assert.deepEqual(api.inspectWorkflow(context.root), before); assert.deepEqual(readFileSync(join(revised, 'source/original.png')), raw);
  assert.equal(api.verifyTerrainProofBundle(context.root, plan.sha256, parent).status, 'deterministic-proof-valid');
  rejects(() => api.reviseTerrainProofBundle(context.root, plan.sha256, parent, revised), 'OUTPUT_EXISTS');
});
test('revision refuses a corrupted parent and cannot hide changed revised artwork behind its manifest', t => {
  const context = prepare(t), plan = planFor(context); receive(context, plan);
  const parent = join(context.parent, 'parent.proof'), revised = join(context.parent, 'revision.proof');
  api.buildTerrainProofBundle(context.root, plan.sha256, parent);
  api.reviseTerrainProofBundle(context.root, plan.sha256, parent, revised);
  writeFileSync(join(revised, 'materials/body-2.png'), Buffer.from('synthetic corrupt artifact'));
  rejects(() => api.verifyTerrainProofRevision(context.root, plan.sha256, parent, revised), 'PROOF_BUNDLE_RECOMPILE_MISMATCH');
  writeFileSync(join(parent, 'materials/body.png'), Buffer.from('synthetic corrupt parent'));
  const next = join(context.parent, 'must.not.exist');
  rejects(() => api.reviseTerrainProofBundle(context.root, plan.sha256, parent, next), 'PROOF_BUNDLE_RECOMPILE_MISMATCH');
  assert.equal(existsSync(next), false);
});
test('revision CLI explicitly reports zero-generation verification', async t => {
  const context = prepare(t), plan = planFor(context); receive(context, plan);
  const parent = join(context.parent, 'cli.parent'), revised = join(context.parent, 'cli.revision');
  api.buildTerrainProofBundle(context.root, plan.sha256, parent);
  const cli = fileURLToPath(new URL('../scripts/workflow.mjs', import.meta.url));
  const invoke = command => promisify(execFile)(process.execPath, [cli, command, '--root', context.root, '--plan', plan.sha256,
    '--parent', parent, '--out', revised], { timeout: 15000 });
  assert.equal(JSON.parse((await invoke('revise-terrain-proof')).stdout).coreProviderCalls, 0);
  const report = JSON.parse((await invoke('verify-terrain-proof-revision')).stdout).result;
  assert.equal(report.generationCalls, 0); assert.equal(report.verifiedFiles, 79);
});
