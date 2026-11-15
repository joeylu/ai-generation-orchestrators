import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as api from '../src/generation/index.mjs';
import { SIGNATURES, cellKey, signatureAt } from '../src/topology.mjs';
import { hash } from '../src/generation/common.mjs';
import { encodeRgbaPng, inspectPng } from '../src/png.mjs';
import { raster } from '../src/terrain-proof/raster.mjs';
import { TERRAIN_MODULE_STUDY_SHA256, STUDY_LAYOUTS, assessStudyLayout, buildStudyTiles,
  deriveTerrainModuleStudy, studyCrops, studyInspectionLayout, studySurface, studyVariantAt } from '../src/terrain-proof/modules.mjs';
import { syntheticTerrainMaterial } from '../scripts/terrain-fixture.mjs';
import { continuityPhaseAt, deriveTerrainContinuityStudy, extractContinuityPhase } from '../src/terrain-proof/continuity.mjs';
import { authorizeAndReserve, bytesFor, capabilitiesDraft, complete, decision, referencePlan, setup,
  specDraft, styleDraft } from './helpers/generation.mjs';

const raw = syntheticTerrainMaterial(), rejects = (fn, code) => assert.throws(fn, error => error.errors?.some(item => item.code === code));
let derived;
const study = () => derived ??= deriveTerrainModuleStudy(raw);
function prepare(t) {
  const context = setup(t), { root } = context;
  api.initWorkflow(root, { projectId: 'module.study.fixture', purpose: 'synthetic-simulation', compiler: 'scene-kit-native-reference-v2' });
  const spec = api.createDesignDraft(root, specDraft()), style = api.createDesignDraft(root, styleDraft());
  api.reviewDesign(root, 'spec', decision('spec', spec.sha256)); api.reviewDesign(root, 'style', decision('style', style.sha256));
  const cap = api.createDesignDraft(root, capabilitiesDraft()), reference = referencePlan(root, cap);
  complete(root, reference, bytesFor('terrain-000'));
  const plan = api.freezeTerrainMaterialPlan(root, { planId: 'study.material', parents: [], referencePlanSha256: reference.sha256,
    capabilitiesSha256: cap.sha256, intent: 'Synthetic material study; no real artwork.' });
  const result = api.receiveResult(root, authorizeAndReserve(root, plan), raw);
  const original = join(context.parent, 'original'), revision = join(context.parent, 'revision');
  api.buildTerrainProofBundle(root, plan.sha256, original); api.reviseTerrainProofBundle(root, plan.sha256, original, revision);
  return { ...context, plan, result, original, revision };
}

test('declared visual inset rounds only exposed outer corners, preserves interiors and has continuous alpha', () => {
  assert.equal(studySurface(0, 0, 0).alpha, 0);
  assert.equal(studySurface(0, 4, 4).alpha, 255);
  assert.equal(studySurface(255, 0, 0).alpha, 255);
  assert.equal(studySurface(255, 0, 0).cap, false);
  assert.equal(studySurface(0, 16, 0).alpha, 0); // frozen top inset is two pixels here
  assert.equal(studySurface(0, 16, 2).alpha, 255);
  assert.equal(studySurface(0, 16, 2).cap, true);
  assert.equal(studySurface(0, 16, 8).cap, false);
  const alphas = new Set(Array.from({ length: 16 }, (_, i) => studySurface(0, i % 4, Math.floor(i / 4)).alpha));
  assert.ok([...alphas].some(alpha => alpha > 0 && alpha < 255));
  assert.ok(Object.isFrozen(studySurface(0, 0, 0)));
});

test('all four missing diagonal corners have local independent shading and 47 distinct full-neighborhood tiles', () => {
  const body = raster(64, 64), cap = raster(64, 8);
  for (const image of [body, cap]) for (let p = 0; p < image.rgba.length; p += 4) image.rgba.set([170, 140, 100, 255], p);
  const tiles = buildStudyTiles(body, cap);
  assert.equal(tiles.size, 47); assert.equal(new Set([...tiles.values()].map(image => hash(image.rgba))).size, 47);
  for (const [bit, x, y, otherX, otherY] of [[128, 0, 0, 63, 63], [2, 63, 0, 0, 63], [8, 63, 63, 0, 0], [32, 0, 63, 63, 0]]) {
    assert.ok(studySurface(255 ^ bit, x, y).shade < 255);
    assert.equal(studySurface(255 ^ bit, otherX, otherY).shade, 255);
    assert.equal(studySurface(255 ^ bit, x, y).alpha, 255);
  }
});

test('nine overlapping crops stay in bounds and coordinate variation survives negative coordinates and map growth', () => {
  const crops = studyCrops(1672, 941);
  assert.equal(crops.bodies.length, 9); assert.equal(crops.caps.length, 9);
  assert.deepEqual(crops.bodies[8], { x: 835, y: 529, width: 412, height: 412 });
  assert.ok([...crops.bodies, ...crops.caps].every(crop => crop.x >= 0 && crop.y >= 58 && crop.x + crop.width <= 1672 && crop.y + crop.height <= 941));
  const before = Array.from({ length: 100 }, (_, x) => studyVariantAt(x - 40, -2));
  assert.equal(new Set(before).size, 9); assert.deepEqual(before, Array.from({ length: 100 }, (_, x) => studyVariantAt(x - 40, -2)));
  rejects(() => studyVariantAt(1.5, 2), 'PROOF_CELL');
});

test('nine body and cap variants retain exact shared edges without changing the accepted source bytes', () => {
  const before = hash(raw), result = study();
  assert.equal(hash(raw), before); assert.equal(result.report.source.sha256, before);
  assert.equal(result.report.profileSha256, TERRAIN_MODULE_STUDY_SHA256);
  for (const kind of ['body', 'cap']) {
    const images = Array.from({ length: 9 }, (_, v) => inspectPng(result.files.get(`materials/${kind}-${v}.png`), { includePixels: true }));
    // Periodic source pixels can produce equal crops; observed diversity is explicit.
    const distinct = new Set(images.map(image => hash(image.rgba))).size;
    assert.ok(distinct > 1 && distinct <= 9);
    assert.equal(result.report[kind === 'body' ? 'distinctBodySamples' : 'distinctCapSamples'], distinct);
    for (const image of images) for (let y = 0; y < image.height; y++) for (let c = 0; c < 4; c++) {
      assert.equal(image.rgba[(y * 64) * 4 + c], images[0].rgba[(y * 64) * 4 + c]);
      assert.equal(image.rgba[(y * 64 + 63) * 4 + c], image.rgba[(y * 64) * 4 + c]);
    }
  }
});

test('inspection reconstructs every normalized neighborhood and seven layouts pass while art acceptance stays pending', () => {
  const layout = studyInspectionLayout(), cells = new Map(layout.cells.map(cell => [cellKey(cell.x, cell.y), 'primary']));
  assert.deepEqual(layout.centers.map(cell => signatureAt(cells, cell.x, cell.y)), SIGNATURES);
  const result = study();
  assert.equal(result.report.derivedTilePNGCount, 423); assert.equal(result.files.size, 451);
  assert.deepEqual(result.report.inspectionCoverage, SIGNATURES);
  assert.ok(result.report.assessments.every(qa => qa.status === 'pass' && qa.geometryFailures === 0));
  assert.equal(result.report.generationCalls, 0); assert.equal(result.report.independentGeneratedModuleCount, 0);
  assert.equal(result.report.productionKit, false); assert.equal(result.report.visualAcceptance, 'not-assessed');
  for (const artifact of result.report.artifacts.filter(item => item.path.startsWith('tiles/'))) {
    const image = inspectPng(result.files.get(artifact.path), { includePixels: true });
    for (let p = 0; p < image.rgba.length; p += 4) if (!image.rgba[p + 3]) assert.deepEqual([...image.rgba.subarray(p, p + 3)], [0, 0, 0]);
  }
});

test('a shared-edge pixel fault and a transparent-space fault fail independently of the packaged digest', () => {
  const layout = STUDY_LAYOUTS[0], bytes = study().files.get('proofs/straight.png');
  const seam = inspectPng(bytes, { includePixels: true }); seam.rgba[(160 * seam.width + 63) * 4] ^= 1;
  const qa = assessStudyLayout(layout, seam);
  assert.equal(qa.geometryFailures, 0); assert.equal(qa.status, 'fail');
  assert.ok(qa.interfaces.some(item => item.maximumChannelDifference === 1));
  const geometry = inspectPng(bytes, { includePixels: true }); geometry.rgba.set([80, 80, 80, 255], 0);
  assert.equal(assessStudyLayout(layout, geometry).geometryFailures, 1);
  const source = inspectPng(raw, { includePixels: true }); source.rgba.set([0, 0, 0, 0], 0);
  rejects(() => deriveTerrainModuleStudy(encodeRgbaPng(source.width, source.height, source.rgba)), 'MATERIAL_SOURCE_OPAQUE_NONBLANK');
});

test('accepted-source study binds both verified parents, refuses overwrites and does not add any generation event', t => {
  const context = prepare(t), { root, plan, result, original, revision } = context, output = join(context.parent, 'study');
  rejects(() => api.buildTerrainModuleStudy(root, plan.sha256, original, revision, output), 'MATERIAL_SOURCE_ACCEPTANCE_REQUIRED');
  assert.equal(existsSync(output), false);
  api.reviewResult(root, plan.sha256, decision('material.accept', result.rawSha256));
  const before = api.inspectWorkflow(root), parent = JSON.parse(readFileSync(join(revision, 'proof-bundle.json')));
  const bundle = api.buildTerrainModuleStudy(root, plan.sha256, original, revision, output);
  assert.equal(bundle.parentBundleSha256, parent.sha256); assert.equal(bundle.rawSha256, result.rawSha256);
  assert.deepEqual(readFileSync(join(output, 'source/original.png')), raw);
  assert.equal(api.verifyTerrainModuleStudy(root, plan.sha256, original, revision, output).verifiedFiles, 453);
  assert.deepEqual(api.inspectWorkflow(root), before);
  assert.equal(api.verifyTerrainProofBundle(root, plan.sha256, original).verifiedFiles, 28);
  assert.equal(api.verifyTerrainProofRevision(root, plan.sha256, original, revision).verifiedFiles, 79);
  rejects(() => api.buildTerrainModuleStudy(root, plan.sha256, original, revision, output), 'OUTPUT_EXISTS');
  writeFileSync(join(output, 'tiles/v0-blob-255.png'), Buffer.from('synthetic corruption'));
  rejects(() => api.verifyTerrainModuleStudy(root, plan.sha256, original, revision, output), 'PROOF_BUNDLE_RECOMPILE_MISMATCH');
  writeFileSync(join(revision, 'materials/body-0.png'), Buffer.from('synthetic parent corruption'));
  const forbidden = join(context.parent, 'forbidden');
  rejects(() => api.buildTerrainModuleStudy(root, plan.sha256, original, revision, forbidden), 'PROOF_BUNDLE_RECOMPILE_MISMATCH');
  assert.equal(existsSync(forbidden), false);
});

test('module-study CLI builds and replays a 453-file offline study with no provider calls', async t => {
  const { root, parent, plan, result, original, revision } = prepare(t);
  api.reviewResult(root, plan.sha256, decision('cli.material.accept', result.rawSha256));
  const cli = fileURLToPath(new URL('../scripts/workflow.mjs', import.meta.url)), output = join(parent, 'cli.study');
  const invoke = command => promisify(execFile)(process.execPath, [cli, command, '--root', root, '--plan', plan.sha256,
    '--original', original, '--parent', revision, '--out', output], { timeout: 30000 });
  assert.equal(JSON.parse((await invoke('build-terrain-module-study')).stdout).coreProviderCalls, 0);
  const report = JSON.parse((await invoke('verify-terrain-module-study')).stdout).result;
  assert.equal(report.verifiedFiles, 453); assert.equal(report.generationCalls, 0);
});

test('continuous phases use shared original samples across every join, including periodic wrap and negative coordinates', () => {
  const body = raster(253, 253), cap = raster(253, 8);
  for (const image of [body, cap]) for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++)
    image.rgba.set([x === 252 ? 0 : x, y === 252 ? 0 : y, 90, 255], (y * image.width + x) * 4);
  const phases = Array.from({ length: 16 }, (_, phase) => extractContinuityPhase(body, cap, phase));
  assert.equal(continuityPhaseAt(-1, -1), 15); assert.equal(continuityPhaseAt(0, 0), 0);
  assert.equal(continuityPhaseAt(-4, -4), 0); assert.equal(continuityPhaseAt(101, 202), continuityPhaseAt(1, 2));
  for (let cy = 0; cy < 4; cy++) for (let cx = 0; cx < 4; cx++) {
    const a = phases[continuityPhaseAt(cx, cy)], east = phases[continuityPhaseAt(cx + 1, cy)], south = phases[continuityPhaseAt(cx, cy + 1)];
    for (let t = 0; t < 64; t++) for (let c = 0; c < 4; c++) {
      assert.equal(a.body.rgba[(t * 64 + 63) * 4 + c], east.body.rgba[t * 64 * 4 + c]);
      assert.equal(a.body.rgba[(63 * 64 + t) * 4 + c], south.body.rgba[t * 4 + c]);
    }
    assert.deepEqual([...a.body.rgba.subarray((20 * 64 + 20) * 4, (20 * 64 + 20) * 4 + 4)], [cx * 63 + 20, cy * 63 + 20, 90, 255]);
  }
});

test('continuous field produces 47 roles in 16 mandatory phases, retaining topology and honest repetition limits', () => {
  const result = deriveTerrainContinuityStudy(raw);
  assert.equal(result.files.size, 764); assert.equal(result.report.derivedTilePNGCount, 752);
  assert.equal(result.report.texturePhaseCount, 16); assert.deepEqual(result.report.inspectionCoverage, SIGNATURES);
  assert.equal(result.report.profile.phaseInterchangeable, false);
  assert.ok(result.report.assessments.every(qa => qa.status === 'pass'));
  assert.equal(result.report.productionKit, false); assert.equal(result.report.visualAcceptance, 'not-assessed');
  const topology = JSON.parse(result.files.get('topology.json'));
  assert.equal(topology.entries.length, 47); assert.ok(topology.entries.every(entry => entry.files.length === 16));
  assert.deepEqual(topology.phaseRule, { columns: 4, rows: 4, stridePx: 63, windowPx: 64, sharedSamplePixels: 1 });
});

test('continuous study requires accepted material and replays every output without changing the previous study or workflow', t => {
  const { root, parent, plan, result, original, revision } = prepare(t), output = join(parent, 'continuous');
  rejects(() => api.buildTerrainContinuityStudy(root, plan.sha256, original, revision, output), 'MATERIAL_SOURCE_ACCEPTANCE_REQUIRED');
  assert.equal(existsSync(output), false);
  api.reviewResult(root, plan.sha256, decision('continuous.material.accept', result.rawSha256));
  const before = api.inspectWorkflow(root), bundle = api.buildTerrainContinuityStudy(root, plan.sha256, original, revision, output);
  assert.equal(bundle.rawSha256, result.rawSha256);
  assert.equal(api.verifyTerrainContinuityStudy(root, plan.sha256, original, revision, output).verifiedFiles, 766);
  assert.deepEqual(api.inspectWorkflow(root), before);
  assert.equal(api.verifyTerrainProofRevision(root, plan.sha256, original, revision).verifiedFiles, 79);
  rejects(() => api.buildTerrainContinuityStudy(root, plan.sha256, original, revision, output), 'OUTPUT_EXISTS');
  writeFileSync(join(output, 'proofs/long-map.png'), Buffer.from('synthetic corruption'));
  rejects(() => api.verifyTerrainContinuityStudy(root, plan.sha256, original, revision, output), 'PROOF_BUNDLE_RECOMPILE_MISMATCH');
});

test('continuous-study CLI builds and verifies with zero image calls and reports 766 files', async t => {
  const { root, parent, plan, result, original, revision } = prepare(t);
  api.reviewResult(root, plan.sha256, decision('cli.continuous.accept', result.rawSha256));
  const cli = fileURLToPath(new URL('../scripts/workflow.mjs', import.meta.url)), output = join(parent, 'cli.continuous');
  const invoke = command => promisify(execFile)(process.execPath, [cli, command, '--root', root, '--plan', plan.sha256,
    '--original', original, '--parent', revision, '--out', output], { timeout: 30000 });
  assert.equal(JSON.parse((await invoke('build-terrain-continuity-study')).stdout).coreProviderCalls, 0);
  const resultReport = JSON.parse((await invoke('verify-terrain-continuity-study')).stdout).result;
  assert.equal(resultReport.verifiedFiles, 766); assert.equal(resultReport.generationCalls, 0);
});
