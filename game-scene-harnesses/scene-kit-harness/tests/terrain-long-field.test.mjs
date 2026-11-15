import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as api from '../src/generation/index.mjs';
import { digest, hash } from '../src/generation/common.mjs';
import { encodeRgbaPng, inspectPng } from '../src/png.mjs';
import { raster } from '../src/terrain-proof/raster.mjs';
import { TERRAIN_CONTINUITY_STUDY_SHA256, deriveTerrainContinuityStudy } from '../src/terrain-proof/continuity.mjs';
import { TERRAIN_LONG_FIELD_STUDY, TERRAIN_LONG_FIELD_STUDY_SHA256, deriveTerrainLongFieldStudy,
  fieldLagEvidence, longFieldCrops, materialFieldPixel, minimumVerticalSeam, quiltMaterialPool } from '../src/terrain-proof/long-field.mjs';
import { syntheticTerrainMaterial } from '../scripts/terrain-fixture.mjs';
import { prepareTerrainPreview } from './helpers/terrain-preview.mjs';

const raw = syntheticTerrainMaterial(), rejects = (fn, code) => assert.throws(fn, error => error.errors?.some(item => item.code === code));
let derived;
const study = () => derived ??= deriveTerrainLongFieldStudy(raw);
const decoded = path => inspectPng(study().files.get(path), { includePixels: true });
const pixel = (image, x, y) => image.rgba.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4);

test('long-field recipe is separately frozen, crops full width and retains body stone scale for odd native sizes', () => {
  assert.equal(digest(TERRAIN_LONG_FIELD_STUDY), TERRAIN_LONG_FIELD_STUDY_SHA256);
  assert.equal(Object.isFrozen(TERRAIN_LONG_FIELD_STUDY.quilt.originQuarters), true);
  assert.equal(TERRAIN_LONG_FIELD_STUDY.baselineProfileSha256, TERRAIN_CONTINUITY_STUDY_SHA256);
  assert.deepEqual(longFieldCrops(1672, 941), { body: { x: 0, y: 117, width: 1672, height: 824 },
    cap: { x: 0, y: 58, width: 1672, height: 59 } });
  assert.equal(Math.floor(1672 * 253 / 824), 513);
  rejects(() => longFieldCrops(512, 512), 'MATERIAL_SOURCE_SIZE');
  rejects(() => longFieldCrops(1024, 511), 'MATERIAL_SOURCE_SIZE');
});

test('minimum seam follows the global three-neighbor optimum with deterministic leftmost ties', () => {
  assert.deepEqual(minimumVerticalSeam(new Uint16Array([0, 9, 9, 9, 0, 9, 9, 9, 0]), 3, 3),
    { columns: [0, 1, 2], totalRgbL1: 0 });
  assert.deepEqual(minimumVerticalSeam(new Uint16Array(12), 3, 4), { columns: [0, 0, 0, 0], totalRgbL1: 0 });
  // Greedy starts at zero and pays 100 next row. The global optimum starts at 1.
  assert.deepEqual(minimumVerticalSeam(new Uint16Array([0, 1, 9, 100, 100, 0]), 3, 2),
    { columns: [1, 2], totalRgbL1: 1 });
  rejects(() => minimumVerticalSeam(new Uint16Array(3), 65, 1), 'QUILT_COSTS');
  rejects(() => minimumVerticalSeam(new Float64Array([NaN]), 1, 1), 'QUILT_COSTS');
  rejects(() => minimumVerticalSeam(new Uint16Array([766]), 1, 1), 'QUILT_COSTS');
  rejects(() => minimumVerticalSeam(new DataView(new ArrayBuffer(2)), 1, 1), 'QUILT_COSTS');
});

test('quilt keeps source pixels at the seam and copies new pixels after it without stretching or mutating the pool', () => {
  const pool = raster(513, 8);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 513; x++) pool.rgba.set([Math.floor(x / 3), y, 90, 255], (y * 513 + x) * 4);
  const before = Buffer.from(pool.rgba), { field, origins, seams } = quiltMaterialPool(pool);
  assert.deepEqual(pool.rgba, before); assert.deepEqual(origins, [0, 195, 65, 260, 130]);
  assert.equal(field.width, 1009); assert.equal(field.height, 8); assert.equal(seams.length, 4);
  for (const seam of seams) for (let y = 0; y < 8; y++) {
    const x = seam.columns[y]; assert.ok(x >= 0 && x < 64);
    if (y) assert.ok(Math.abs(x - seam.columns[y - 1]) <= 1);
  }
  assert.deepEqual(pixel(field, 0, 3), pixel(pool, 0, 3));
  assert.deepEqual(pixel(field, 1008, 3), pixel(pool, 130 + 252, 3));
  const first = seams[0];
  assert.deepEqual(pixel(field, first.startX + first.columns[3], 3), pixel(pool, first.startX + first.columns[3], 3));
  assert.deepEqual(pixel(field, first.startX + first.columns[3] + 1, 3), pixel(pool, first.sourceX + first.columns[3] + 1, 3));
  pool.rgba[3] = 254; rejects(() => quiltMaterialPool(pool), 'PROOF_SOURCE_ALPHA');
  rejects(() => quiltMaterialPool(raster(252, 8)), 'QUILT_POOL_SIZE');
});

test('periodic fields preserve exact outer edges and every internal cell join including wrap and negative coordinates', () => {
  const body = decoded('materials/body-field.png'), cap = decoded('materials/cap-field.png');
  for (const field of [body, cap]) {
    for (let y = 0; y < field.height; y++) assert.deepEqual(pixel(field, 0, y), pixel(field, field.width - 1, y));
    for (let cell = -18; cell < 18; cell++) for (const y of [0, 4, 7])
      assert.deepEqual(materialFieldPixel(field, cell * 64 + 63, y), materialFieldPixel(field, (cell + 1) * 64, y));
  }
  for (let x = 0; x < body.width; x++) assert.deepEqual(pixel(body, x, 0), pixel(body, x, 252));
  for (let cell = -6; cell < 6; cell++) for (const x of [0, 63, 64, 767, 1023])
    assert.deepEqual(materialFieldPixel(body, x, cell * 64 + 63), materialFieldPixel(body, x, (cell + 1) * 64));
  assert.deepEqual(materialFieldPixel(body, -1, -1), materialFieldPixel(body, 1023, 255));
  assert.deepEqual(materialFieldPixel(body, 510, 90), materialFieldPixel(body, 1534, 346));
  rejects(() => materialFieldPixel(body, 0.5, 1), 'MATERIAL_FIELD_SAMPLE');
});

test('lag evidence detects the old four-cell repeat and declares the new sixteen-cell repeat without an art-quality pass', () => {
  const report = study().report;
  assert.equal(report.repetition.baseline[0].totalRgbL1, 0);
  assert.ok(report.repetition.quilt[0].totalRgbL1 > 0); assert.ok(report.repetition.quilt[1].totalRgbL1 > 0);
  assert.equal(report.repetition.quilt[2].totalRgbL1, 0);
  assert.equal(report.repetition.quilt[2].equalPixels, report.repetition.quilt[2].comparedPixels);
  assert.deepEqual(report.repetition.declaredPeriodCells, { x: 16, y: 4 });
  assert.equal(report.productionKit, false); assert.equal(report.visualAcceptance, 'not-assessed');
  assert.equal(report.studioIntegration, 'not-implemented'); assert.equal(report.derivedTilePNGCount, 0);
  assert.equal(report.generationCalls, 0); assert.equal(report.independentGeneratedModuleCount, 0);
  rejects(() => fieldLagEvidence(decoded('materials/body-field.png'), 0), 'MATERIAL_FIELD_LAG');
});

test('comparison is reproducible, retains original input and embeds the old field byte for byte', () => {
  const before = hash(raw), a = study(), b = deriveTerrainLongFieldStudy(raw), old = deriveTerrainContinuityStudy(raw);
  assert.equal(hash(raw), before); assert.equal(a.report.source.sha256, before); assert.equal(a.files.size, 10);
  assert.deepEqual([...a.files], [...b.files]);
  assert.deepEqual(a.files.get('baseline/body-field.png'), old.files.get('materials/body-field.png'));
  assert.deepEqual(a.files.get('baseline/cap-field.png'), old.files.get('materials/cap-field.png'));
  const comparison = decoded('proofs/comparison.png'); assert.equal(comparison.width, 2048); assert.equal(comparison.height, 528);
  assert.deepEqual(pixel(comparison, 800, 100), pixel(decoded('proofs/four-cell-baseline.png'), 800, 100));
  assert.deepEqual(pixel(comparison, 800, 372), pixel(decoded('proofs/sixteen-cell-quilt.png'), 800, 100));
  assert.deepEqual([...pixel(comparison, 800, 260)], [0, 0, 0, 0]);
  for (const item of a.report.artifacts) assert.equal(hash(a.files.get(item.path)), item.sha256);
});

test('empty, malformed, single-color and translucent material are refused rather than repaired', () => {
  rejects(() => deriveTerrainLongFieldStudy(Buffer.alloc(0)), 'IMAGE_BYTES');
  rejects(() => deriveTerrainLongFieldStudy(Buffer.from('bad png')), 'MATERIAL_SOURCE_PNG');
  const source = inspectPng(raw, { includePixels: true }); source.rgba[3] = 254;
  rejects(() => deriveTerrainLongFieldStudy(encodeRgbaPng(source.width, source.height, source.rgba)), 'MATERIAL_SOURCE_OPAQUE_NONBLANK');
  source.rgba.fill(255);
  rejects(() => deriveTerrainLongFieldStudy(encodeRgbaPng(source.width, source.height, source.rgba)), 'MATERIAL_SOURCE_OPAQUE_NONBLANK');
});

test('workflow requires material acceptance, replays all three parents and never appends a generation or review event', t => {
  const c = prepareTerrainPreview(t, { accepted: false }), out = join(c.parent, 'long-field');
  const build = target => api.buildTerrainLongFieldStudy(c.root, c.plan.sha256, c.original, c.revision, c.study, target);
  const verify = () => api.verifyTerrainLongFieldStudy(c.root, c.plan.sha256, c.original, c.revision, c.study, out);
  rejects(() => build(out), 'MATERIAL_SOURCE_ACCEPTANCE_REQUIRED'); assert.equal(existsSync(out), false);
  c.accept(); const before = api.inspectWorkflow(c.root), oldManifest = readFileSync(join(c.study, 'proof-bundle.json'));
  const bundle = build(out);
  assert.equal(bundle.parentBundleSha256, JSON.parse(oldManifest).sha256); assert.equal(bundle.rawSha256, c.result.rawSha256);
  assert.deepEqual(readFileSync(join(out, 'source/original.png')), raw);
  assert.equal(verify().verifiedFiles, 12); assert.deepEqual(api.inspectWorkflow(c.root), before);
  assert.deepEqual(readFileSync(join(c.study, 'proof-bundle.json')), oldManifest);
  rejects(() => build(out), 'OUTPUT_EXISTS'); rejects(() => build(join(c.root, 'overlap')), 'OUTPUT_OVERLAP');
  const proof = join(out, 'proofs/comparison.png'), bytes = readFileSync(proof);
  writeFileSync(proof, Buffer.from('synthetic corruption')); rejects(verify, 'PROOF_BUNDLE_RECOMPILE_MISMATCH'); writeFileSync(proof, bytes);
  writeFileSync(join(c.study, 'materials/body-field.png'), Buffer.from('synthetic baseline corruption'));
  rejects(() => build(join(c.parent, 'forbidden')), 'PROOF_BUNDLE_RECOMPILE_MISMATCH');
  assert.equal(existsSync(join(c.parent, 'forbidden')), false);
});

test('long-field CLI builds and replays twelve files offline while rejecting unknown output inventory', async t => {
  const c = prepareTerrainPreview(t), out = join(c.parent, 'cli-long-field');
  const cli = fileURLToPath(new URL('../scripts/workflow.mjs', import.meta.url));
  const invoke = command => promisify(execFile)(process.execPath, [cli, command, '--root', c.root, '--plan', c.plan.sha256,
    '--original', c.original, '--parent', c.revision, '--baseline', c.study, '--out', out], { timeout: 60000 });
  assert.equal(JSON.parse((await invoke('build-terrain-long-field-study')).stdout).coreProviderCalls, 0);
  const result = JSON.parse((await invoke('verify-terrain-long-field-study')).stdout).result;
  assert.equal(result.verifiedFiles, 12); assert.equal(result.generationCalls, 0);
  writeFileSync(join(out, 'unlisted.txt'), 'synthetic unexpected artifact');
  await assert.rejects(invoke('verify-terrain-long-field-study'), error => {
    assert.ok(JSON.parse(error.stderr).errors.some(item => item.code === 'PROOF_BUNDLE_INVENTORY')); return true;
  });
});
