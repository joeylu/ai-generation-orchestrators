import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as api from '../src/generation/index.mjs';
import * as project from '../src/reference-led-pipeline.mjs';
import { segmentationSeedFiles, seededSegmentationReviewFiles } from '../src/reference-segmentation.mjs';
import { inspectPng, encodeRgbaPng } from '../src/png.mjs';
import { hash, jsonBytes, seal, unseal } from '../src/generation/common.mjs';
import { decision } from './helpers/generation.mjs';
import { controlFixture, controlMeasurement, syntheticControlImage } from './helpers/reference-controls.mjs';

const rejects = (fn, code) => assert.throws(fn, e => e.errors?.some(v => v.code === code));
const point = (x, y) => ({ points: [{ x, y }], radius: 2 });
function fixture(t) {
  const f = controlFixture(t, { rejected: false }), raw = syntheticControlImage(), a = controlMeasurement(f.baseline, f.result.rawSha256);
  const proof = api.buildMeasuredReferenceReview(f.workflow, f.baseline.sha256, a, join(f.parent, 'review'));
  api.reviewMeasuredReference(f.workflow, f.baseline.sha256, a, decision('actual.accept', proof.packetSha256));
  const target = api.getReferenceReconstructionTarget(f.workflow, f.baseline.sha256);
  const spec = seal({ format: 'ai_scene_segmentation_seed_spec_v1', seedId: 'test.seeds', targetSha256: target.sha256, rawSha256: target.rawSha256,
    coordinates: 'native-reference-pixels', iterations: 3, rngSeed: 0, componentPolicy: 'retain-components-touching-definite-foreground',
    regions: [{ instanceId: 'sky.actual', roi: { x: 0, y: 0, width: 512, height: 188 }, foreground: [point(20, 20)], background: [point(50, 240)] },
      { instanceId: 'ground.actual', roi: { x: 0, y: 188, width: 512, height: 100 }, foreground: [point(20, 220)], background: [point(50, 50)] }],
    notes: 'Synthetic operator seeds only; no actual CPU or model calls.' });
  return { ...f, raw, target, spec };
}
function cpu(f, choose = (_x, y) => [y < 188, y >= 188]) {
  const prepared = segmentationSeedFiles(f.target, f.raw, f.spec), files = new Map(), masks = [];
  for (let index = 0; index < 2; index++) {
    const rgba = Buffer.alloc(512 * 288 * 4); let selectedPixels = 0;
    for (let y = 0; y < 288; y++) for (let x = 0; x < 512; x++) {
      const v = choose(x, y)[index] ? 255 : 0; if (v) selectedPixels++;
      rgba.set([v, v, v, 255], (y * 512 + x) * 4);
    }
    const instanceId = f.spec.regions[index].instanceId, path = `masks/${instanceId}.png`, bytes = encodeRgbaPng(512, 288, rgba);
    files.set(path, bytes); masks.push({ instanceId, path, sha256: hash(bytes), byteLength: bytes.length, selectedPixels });
  }
  const report = seal({ format: 'ai_scene_cpu_segmentation_result_v1', planSha256: prepared.report.sha256, rawSha256: f.target.rawSha256,
    status: 'cpu-candidates-unreviewed', runtime: { backend: 'opencv-grabcut-cpu', opencv: '0.0.0', distribution: '0.0.0', numpy: '0.0.0',
      threads: 1, openCL: false, installedFiles: 1, installedInventorySha256: hash(Buffer.from('synthetic-runtime')) },
    implementationSha256: hash(Buffer.from('synthetic-adapter-double')), calls: 2, masks, generationCalls: 0 });
  return { prepared, files, report };
}

test('seed plan preserves raw identity, labels other foreground as background and never hard-clips ROI', t => {
  const f = fixture(t), p = segmentationSeedFiles(f.target, f.raw, f.spec);
  assert.deepEqual(p.files.get('reference-native.png'), f.raw); assert.equal(p.report.maximumCalls, 2);
  const sky = inspectPng(p.files.get('seeds/sky.actual.png'), { includePixels: true });
  const label = (x, y) => sky.rgba[(y * 512 + x) * 4];
  assert.equal(label(20, 20), 85); assert.equal(label(20, 220), 0);
  assert.equal(label(400, 280), 170); assert.equal(label(400, 100), 255);
  assert.equal(p.report.algorithm.outsideRoi, 'probable-background-not-hard-mask');
  assert.equal(p.report.semanticSeedReview, 'unreviewed-operator-candidate');
});

test('out-of-range, crossed foreground, wrong frame and incomplete seed specifications stop before CPU', t => {
  const f = fixture(t);
  for (const [mutate, code] of [
    [s => { s.regions[0].foreground[0].points[0].x = 512; }, 'SEGMENTATION_POINT'],
    [s => { s.regions[0].foreground[0].radius = 100; }, 'SEGMENTATION_STROKE'],
    [s => { s.regions[1].foreground = structuredClone(s.regions[0].foreground); }, 'SEGMENTATION_FOREGROUND_CONFLICT'],
    [s => { s.regions[0].background = structuredClone(s.regions[0].foreground); }, 'SEGMENTATION_SEED_CONFLICT'],
    [s => { s.targetSha256 = '0'.repeat(64); }, 'SEGMENTATION_SEED_BINDING'],
    [s => { s.regions.pop(); }, 'SEGMENTATION_REGION_COVERAGE'],
    [s => { s.regions[0].roi.width = 513; }, 'SEGMENTATION_ROI'],
  ]) {
    const body = structuredClone(unseal(f.spec)); mutate(body);
    rejects(() => segmentationSeedFiles(f.target, f.raw, seal(body)), code);
  }
});

test('conflicting CPU candidates become unknown instead of layer-order overwrite or sky fallback', t => {
  const f = fixture(t), c = cpu(f, (x, y) => x === 300 && y === 100 ? [true, true] : x === 300 && y === 101 ? [false, false] : [y < 188, y >= 188]);
  const p = seededSegmentationReviewFiles(f.target, f.raw, f.spec, c.report, path => c.files.get(path));
  assert.equal(p.report.conflictPixels, 1); assert.equal(p.report.noCandidatePixels, 1); assert.equal(p.report.unassignedPixels, 2);
  const image = inspectPng(p.files.get('ownership-native.png'), { includePixels: true });
  for (const y of [100, 101]) assert.deepEqual([...image.rgba.subarray((y * 512 + 300) * 4, (y * 512 + 301) * 4)], [0, 0, 0, 255]);
  assert.equal(JSON.parse(p.files.get('report.json')).coordinateRoundtrip.rgbaMismatchPixels, 2);
});

test('technically complete CPU candidates remain unreviewed and cannot certify material alpha or complete assets', t => {
  const f = fixture(t), c = cpu(f), p = seededSegmentationReviewFiles(f.target, f.raw, f.spec, c.report, path => c.files.get(path));
  assert.equal(p.report.unassignedPixels, 0); assert.equal(p.report.status, 'unreviewed-cpu-segmentation-candidate');
  assert.equal(p.report.semanticSegmentation, 'not-assessed'); assert.equal(p.report.assetPackage, false);
  assert.equal(p.report.materialAlpha, 'not-recovered'); assert.equal(p.report.hiddenGeometry, 'unknown');
  assert.equal(JSON.parse(p.files.get('report.json')).visualAcceptance, 'not-assessed');
  assert.deepEqual(inspectPng(p.files.get('reassembled-visible.png'), { includePixels: true }).rgba, inspectPng(f.raw, { includePixels: true }).rgba);
});

test('wrong CPU result bindings, thread profile, paths and mask counts are rejected before reading arbitrary paths', t => {
  const f = fixture(t), c = cpu(f);
  for (const [mutate, code] of [
    [r => { r.planSha256 = '0'.repeat(64); }, 'SEGMENTATION_CPU_RESULT'],
    [r => { r.runtime.openCL = true; }, 'SEGMENTATION_CPU_RUNTIME'],
    [r => { r.runtime.threads = 2; }, 'SEGMENTATION_CPU_RUNTIME'],
    [r => { r.masks[0].path = '../../secret.png'; }, 'SEGMENTATION_MASK_COVERAGE'],
    [r => { r.masks.pop(); }, 'SEGMENTATION_MASK_COVERAGE'],
  ]) {
    const body = structuredClone(unseal(c.report)); mutate(body);
    rejects(() => seededSegmentationReviewFiles(f.target, f.raw, f.spec, seal(body), () => { throw Error('Unexpected file read'); }), code);
  }
});

test('mask identity, native size, binary values, seed preservation and actual counts are checked', t => {
  const f = fixture(t);
  for (const [mutate, code] of [
    [p => { p[0] = 127; }, 'SEGMENTATION_MASK_BINARY'],
    [p => { p[(20 * 512 + 20) * 4] = 0; p[(20 * 512 + 20) * 4 + 1] = 0; p[(20 * 512 + 20) * 4 + 2] = 0; }, 'SEGMENTATION_SEEDS_CHANGED'],
  ]) {
    const c = cpu(f), r = structuredClone(unseal(c.report)), m = r.masks[0], pixels = inspectPng(c.files.get(m.path), { includePixels: true }).rgba;
    mutate(pixels); const bytes = encodeRgbaPng(512, 288, pixels); c.files.set(m.path, bytes); m.sha256 = hash(bytes); m.byteLength = bytes.length;
    rejects(() => seededSegmentationReviewFiles(f.target, f.raw, f.spec, seal(r), path => c.files.get(path)), code);
  }
  const c = cpu(f), r = structuredClone(unseal(c.report)); r.masks[0].selectedPixels--;
  rejects(() => seededSegmentationReviewFiles(f.target, f.raw, f.spec, seal(r), path => c.files.get(path)), 'SEGMENTATION_MASK_COUNT');
  c.files.set(r.masks[0].path, Buffer.from('changed'));
  rejects(() => seededSegmentationReviewFiles(f.target, f.raw, f.spec, c.report, path => c.files.get(path)), 'SEGMENTATION_MASK_IDENTITY');
  const tiny = cpu(f), body = structuredClone(unseal(tiny.report));
  const bytes = encodeRgbaPng(1, 1, Buffer.from([255, 255, 255, 255])), m = body.masks[0];
  tiny.files.set(m.path, bytes); m.sha256 = hash(bytes); m.byteLength = bytes.length;
  rejects(() => seededSegmentationReviewFiles(f.target, f.raw, f.spec, seal(body), path => tiny.files.get(path)), 'SEGMENTATION_MASK_FRAME');
});

test('project seed and candidate bundles replay without new events or generation', t => {
  const f = fixture(t), c = cpu(f), before = project.inspectReferenceLedProject(f.root), seeds = join(f.parent, 'seeds'), out = join(f.parent, 'candidate');
  project.buildReferenceSegmentationSeeds(f.root, f.spec, seeds);
  project.verifyReferenceSegmentationSeeds(f.root, f.spec, seeds);
  const masks = join(f.parent, 'cpu'); mkdirSync(masks); mkdirSync(join(masks, 'masks'));
  writeFileSync(join(masks, 'cpu-result.json'), jsonBytes(c.report));
  for (const [path, bytes] of c.files) writeFileSync(join(masks, path), bytes);
  project.buildReferenceSegmentationReview(f.root, f.spec, masks, out);
  const v = project.verifyReferenceSegmentationReview(f.root, f.spec, masks, out);
  assert.equal(v.generationCalls, 0); assert.equal(readFileSync(join(out, 'reference-native.png')).equals(f.raw), true);
  assert.deepEqual(project.inspectReferenceLedProject(f.root), before);
});

test('segmentation CLI prepares, imports and verifies offline without a compute or yes shortcut', async t => {
  const f = fixture(t), c = cpu(f), before = project.inspectReferenceLedProject(f.root);
  const spec = join(f.parent, 'spec.json'), seedOut = join(f.parent, 'cli-seeds'), cpuDir = join(f.parent, 'cli-cpu'), out = join(f.parent, 'cli-review');
  writeFileSync(spec, jsonBytes(f.spec)); mkdirSync(cpuDir); mkdirSync(join(cpuDir, 'masks'));
  writeFileSync(join(cpuDir, 'cpu-result.json'), jsonBytes(c.report));
  for (const [path, bytes] of c.files) writeFileSync(join(cpuDir, path), bytes);
  const cli = fileURLToPath(new URL('../scripts/reference.mjs', import.meta.url)), run = promisify(execFile);
  const args = ['--root', f.root, '--seeds', spec];
  await run(process.execPath, [cli, 'segmentation-seeds', ...args, '--out', seedOut]);
  await run(process.execPath, [cli, 'verify-segmentation-seeds', ...args, '--out', seedOut]);
  await run(process.execPath, [cli, 'segmentation-import', ...args, '--cpu', cpuDir, '--out', out]);
  const verify = await run(process.execPath, [cli, 'verify-segmentation', ...args, '--cpu', cpuDir, '--out', out]);
  assert.equal(JSON.parse(verify.stdout).generationCalls, 0);
  await assert.rejects(run(process.execPath, [cli, 'segmentation-seeds', ...args, '--out', join(f.parent, 'invalid'), '--yes', 'true']));
  assert.deepEqual(project.inspectReferenceLedProject(f.root), before);
});
