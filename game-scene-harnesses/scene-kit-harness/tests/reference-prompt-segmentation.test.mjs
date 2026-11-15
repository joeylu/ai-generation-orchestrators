import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as api from '../src/generation/index.mjs';
import * as project from '../src/reference-led-pipeline.mjs';
import { promptSegmentationFiles, promptSegmentationReviewFiles } from '../src/reference-prompt-segmentation.mjs';
import { encodeRgbaPng, inspectPng } from '../src/png.mjs';
import { hash, seal, unseal, jsonBytes } from '../src/generation/common.mjs';
import { decision } from './helpers/generation.mjs';
import { controlFixture, controlMeasurement, syntheticControlImage } from './helpers/reference-controls.mjs';
const rejects = (fn, code) => assert.throws(fn, e => e.errors?.some(v => v.code === code));
function fixture(t) {
  const f = controlFixture(t, { rejected: false }), raw = syntheticControlImage(), a = controlMeasurement(f.baseline, f.result.rawSha256);
  const review = api.buildMeasuredReferenceReview(f.workflow, f.baseline.sha256, a, join(f.parent, 'review'));
  api.reviewMeasuredReference(f.workflow, f.baseline.sha256, a, decision('accept', review.packetSha256));
  const target = api.getReferenceReconstructionTarget(f.workflow, f.baseline.sha256);
  const spec = seal({ format: 'ai_scene_prompt_segmentation_spec_v1', specId: 'test.points', targetSha256: target.sha256, rawSha256: target.rawSha256,
    coordinates: 'native-reference-pixels', modelFiles: [{ path: 'weights.bin', byteLength: 3, sha256: hash(Buffer.from('abc')) }],
    runtimeSha256: hash(Buffer.from('runtime-double')), producerSha256: hash(Buffer.from('producer-double')),
    regions: [{ instanceId: 'sky.actual', box: { x: 0, y: 0, width: 512, height: 188 }, points: [{ x: 20, y: 20, label: 1 }, { x: 20, y: 220, label: 0 }] },
      { instanceId: 'ground.actual', box: null, points: [{ x: 20, y: 220, label: 1 }, { x: 20, y: 20, label: 0 }] }], notes: 'Synthetic prompts, no inference.' });
  return { ...f, target, raw, spec };
}
function candidate(f, choose = (_x, y) => [y < 188, y >= 188]) {
  const p = promptSegmentationFiles(f.target, f.raw, f.spec), files = new Map(), masks = f.spec.regions.map((r, index) => {
    const pixels = Buffer.alloc(512 * 288 * 4); let selectedPixels = 0;
    for (let y = 0; y < 288; y++) for (let x = 0; x < 512; x++) {
      const v = choose(x, y)[index] ? 255 : 0; if (v) selectedPixels++; pixels.set([v, v, v, 255], (y * 512 + x) * 4);
    }
    const path = `masks/${r.instanceId}.png`, bytes = encodeRgbaPng(512, 288, pixels); files.set(path, bytes);
    return { instanceId: r.instanceId, path, byteLength: bytes.length, sha256: hash(bytes), selectedPixels };
  });
  return { files, report: seal({ format: 'ai_scene_prompt_segmentation_result_v1', planSha256: p.report.sha256, rawSha256: f.target.rawSha256,
    status: 'unreviewed-prompt-candidates', runtimeSha256: f.spec.runtimeSha256, producerSha256: f.spec.producerSha256,
    modelFilesSha256: p.report.modelFilesSha256, modelLoads: 1, calls: 2, masks, networkRequests: 0, generationCalls: 0 }) };
}
test('native prompts bind producer/runtime/model identity and leave boxes and mismatches as prompts', t => {
  const f = fixture(t), p = promptSegmentationFiles(f.target, f.raw, f.spec);
  assert.equal(p.report.maximumCalls, 2); assert.equal(p.report.maximumModelLoads, 1);
  assert.equal(p.report.algorithm.boxPolicy, 'prompt-only-not-hard-crop'); assert.deepEqual(p.files.get('reference-native.png'), f.raw);
  assert.equal(p.report.automaticRetry, false); assert.equal(p.bundle.assetPackage, false);
});
test('crossed positives, duplicate points, unsafe paths, wrong binding and incomplete subjects stop before inference', t => {
  const f = fixture(t);
  for (const [change, code] of [
    [s => { s.regions[1].points[0] = { x: 20, y: 20, label: 1 }; }, 'PROMPT_POSITIVE_CONFLICT'],
    [s => { s.regions[0].points.push(s.regions[0].points[0]); }, 'PROMPT_POINT'],
    [s => { s.regions[0].points[0].x = 512; }, 'PROMPT_POINT'],
    [s => { s.regions[0].box.width = 513; }, 'PROMPT_BOX'],
    [s => { s.modelFiles[0].path = '../model'; }, 'PROMPT_MODEL_FILES'],
    [s => { s.rawSha256 = '0'.repeat(64); }, 'PROMPT_SEGMENTATION_BINDING'],
    [s => { s.regions.pop(); }, 'PROMPT_REGION_COVERAGE'],
  ]) { const s = structuredClone(unseal(f.spec)); change(s); rejects(() => promptSegmentationFiles(f.target, f.raw, seal(s)), code); }
});
test('overlaps and gaps remain unknown with no layer ordering or original-image fill', t => {
  const f = fixture(t), c = candidate(f, (x, y) => x === 300 && y === 100 ? [true, true] : x === 300 && y === 101 ? [false, false] : [y < 188, y >= 188]);
  const p = promptSegmentationReviewFiles(f.target, f.raw, f.spec, c.report, path => c.files.get(path));
  assert.equal(p.report.conflictPixels, 1); assert.equal(p.report.noCandidatePixels, 1); assert.equal(p.report.sourceFallbackPixels, 0);
  const im = inspectPng(p.files.get('ownership-native.png'), { includePixels: true });
  for (const y of [100, 101]) assert.deepEqual([...im.rgba.subarray((y * 512 + 300) * 4, (y * 512 + 301) * 4)], [0, 0, 0, 255]);
});
test('missed positive and hit negative prompts are reported without repairing the model masks', t => {
  const f = fixture(t), c = candidate(f, (x, y) => [x === 20 && y === 20 ? false : x === 20 && y === 220 ? true : y < 188, y >= 188]);
  const p = promptSegmentationReviewFiles(f.target, f.raw, f.spec, c.report, path => c.files.get(path));
  assert.equal(p.report.promptChecks[0].positiveMisses, 1); assert.equal(p.report.promptChecks[0].negativeHits, 1);
  assert.deepEqual(p.files.get('candidate-masks/sky.actual.png'), c.files.get('masks/sky.actual.png'));
  assert.equal(p.report.status, 'unreviewed-prompt-segmentation-candidate'); assert.equal(p.report.materialAlpha, 'not-recovered');
  assert.equal(p.report.assetPackage, false); assert.equal(p.report.semanticSegmentation, 'not-assessed');
});
test('bad runtime/model/raw identity, extra calls and unsafe masks are rejected before any mask read', t => {
  const f = fixture(t), c = candidate(f);
  for (const [change, code] of [
    [r => { r.runtimeSha256 = '0'.repeat(64); }, 'PROMPT_RESULT_BINDING'],
    [r => { r.modelFilesSha256 = '0'.repeat(64); }, 'PROMPT_RESULT_BINDING'],
    [r => { r.calls++; }, 'PROMPT_RESULT_BINDING'], [r => { r.networkRequests = 1; }, 'PROMPT_RESULT_BINDING'],
    [r => { r.masks[0].path = '../../private.png'; }, 'PROMPT_MASK_COVERAGE'],
  ]) { const r = structuredClone(unseal(c.report)); change(r); rejects(() => promptSegmentationReviewFiles(f.target, f.raw, f.spec, seal(r), () => assert.fail('file read')), code); }
});
test('binary mask values, exact counts and native dimensions are enforced', t => {
  const f = fixture(t), c = candidate(f), r = structuredClone(unseal(c.report)); r.masks[0].selectedPixels--;
  rejects(() => promptSegmentationReviewFiles(f.target, f.raw, f.spec, seal(r), path => c.files.get(path)), 'PROMPT_MASK_COUNT');
  const body = structuredClone(unseal(c.report)), m = body.masks[0], bytes = encodeRgbaPng(1, 1, Buffer.from([127, 127, 127, 255]));
  m.sha256 = hash(bytes); m.byteLength = bytes.length; c.files.set(m.path, bytes);
  rejects(() => promptSegmentationReviewFiles(f.target, f.raw, f.spec, seal(body), path => c.files.get(path)), 'PROMPT_MASK_FRAME');
});
test('CLI input/reception bundles replay with no workflow events or model execution', async t => {
  const f = fixture(t), c = candidate(f), before = project.inspectReferenceLedProject(f.root), cpu = join(f.parent, 'cpu'); mkdirSync(cpu); mkdirSync(join(cpu, 'masks'));
  writeFileSync(join(cpu, 'prompt-result.json'), jsonBytes(c.report)); for (const [path, bytes] of c.files) writeFileSync(join(cpu, path), bytes);
  const spec = join(f.parent, 'points.json'); writeFileSync(spec, jsonBytes(f.spec));
  const cli = fileURLToPath(new URL('../scripts/reference.mjs', import.meta.url)), run = promisify(execFile);
  const common = ['--root', f.root, '--prompts', spec], input = join(f.parent, 'input'), output = join(f.parent, 'output');
  await run(process.execPath, [cli, 'prompt-input', ...common, '--out', input]);
  await run(process.execPath, [cli, 'verify-prompt-input', ...common, '--out', input]);
  await run(process.execPath, [cli, 'prompt-import', ...common, '--cpu', cpu, '--out', output]);
  await run(process.execPath, [cli, 'verify-prompt', ...common, '--cpu', cpu, '--out', output]);
  await assert.rejects(run(process.execPath, [cli, 'prompt-input', ...common, '--out', join(f.parent, 'bad'), '--yes', 'true']));
  assert.deepEqual(project.inspectReferenceLedProject(f.root), before);
});
