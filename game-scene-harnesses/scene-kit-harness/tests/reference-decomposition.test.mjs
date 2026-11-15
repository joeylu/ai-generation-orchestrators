import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as api from '../src/generation/index.mjs';
import * as project from '../src/reference-led-pipeline.mjs';
import { decompositionReviewFiles, visibleOwnershipFiles, visibleOwnershipPalette } from '../src/reference-decomposition.mjs';
import { encodeRgbaPng, inspectPng } from '../src/png.mjs';
import { hash, seal, unseal } from '../src/generation/common.mjs';
import { decision } from './helpers/generation.mjs';
import { controlFixture, controlMeasurement, syntheticControlImage } from './helpers/reference-controls.mjs';

const rejects = (fn, code) => assert.throws(fn, e => e.errors?.some(v => v.code === code));
function accepted(t) {
  const f = controlFixture(t, { rejected: false }), raw = syntheticControlImage();
  const analysis = controlMeasurement(f.baseline, f.result.rawSha256);
  const proof = api.buildMeasuredReferenceReview(f.workflow, f.baseline.sha256, analysis, join(f.parent, 'image-review'));
  api.reviewMeasuredReference(f.workflow, f.baseline.sha256, analysis, decision('measured.accept', proof.packetSha256));
  return { ...f, raw, target: api.getReferenceReconstructionTarget(f.workflow, f.baseline.sha256) };
}
function ownerMap(target, choose) {
  const { width, height } = target.mapping.nativeSize, palette = visibleOwnershipPalette(target), rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const owner = choose(x, y); rgba.set([...(owner === null ? [0, 0, 0] : palette[owner].rgb), 255], (y * width + x) * 4);
  }
  return encodeRgbaPng(width, height, rgba);
}

test('decomposition keeps native PNG bytes, exact context pixels and no envelope-derived segmentation', t => {
  const f = accepted(t), before = project.inspectReferenceLedProject(f.root), p = decompositionReviewFiles(f.target, f.raw);
  assert.deepEqual(p.files.get('reference-native.png'), f.raw);
  assert.equal(p.report.instances.length, 2); assert.equal(p.report.assignedPixels, 0);
  assert.equal(p.report.unassignedPixels, 512 * 288); assert.equal(p.report.materialAlpha, 'not-recovered');
  assert.equal(p.report.status, 'awaiting-visible-ownership');
  const unknown = inspectPng(p.files.get('ownership-unassigned.png'), { includePixels: true });
  assert.equal(unknown.transparentPixels, 0);
  for (let n = 0; n < unknown.rgba.length; n += 4) assert.deepEqual([...unknown.rgba.subarray(n, n + 4)], [0, 0, 0, 255]);
  const source = inspectPng(f.raw, { includePixels: true });
  for (const entry of p.report.instances) {
    assert.equal(entry.cropMeaning, 'context-only-not-a-cutout');
    const img = inspectPng(p.files.get(entry.path), { includePixels: true }), box = entry.nativeCrop;
    assert.equal(img.width, box.width); assert.equal(img.height, box.height);
    for (let y = 0; y < box.height; y++) assert.deepEqual(img.rgba.subarray(y * box.width * 4, (y + 1) * box.width * 4),
      source.rgba.subarray(((box.y + y) * source.width + box.x) * 4, ((box.y + y) * source.width + box.x + box.width) * 4));
  }
  assert.deepEqual(project.inspectReferenceLedProject(f.root), before);
});

test('native ROIs invert actual floor-resized axes and exclude synthetic contain margins', t => {
  const f = accepted(t), rgba = Buffer.alloc(514 * 289 * 4, 255), raw = encodeRgbaPng(514, 289, rgba), b = unseal(f.target);
  b.rawSha256 = hash(raw); b.mapping = { profile: 'uniform-contain-no-crop-floor-v1', nativeSize: { width: 514, height: 289 },
    viewport: { width: 256, height: 144 }, scale: { numerator: 256, denominator: 514 }, resized: { width: 256, height: 143 }, offset: { x: 0, y: 0 } };
  // Envelope y=144 includes canonical padding. Native context clamps to source height.
  const p = decompositionReviewFiles(seal(b), raw), ground = p.report.instances.find(i => i.instanceId === 'ground.actual');
  assert.equal(ground.nativeCrop.y, Math.floor(94 * 289 / 143) - 8);
  assert.equal(ground.nativeCrop.y + ground.nativeCrop.height, 289);
  assert.equal(ground.nativeCrop.x + ground.nativeCrop.width, 514);
  const bad = structuredClone(b); bad.mapping.resized.height = 144;
  rejects(() => decompositionReviewFiles(seal(bad), raw), 'DECOMPOSITION_MAPPING');
});

test('source identity, target status and duplicate instance guards cannot be bypassed by resealing', t => {
  const f = accepted(t);
  rejects(() => decompositionReviewFiles(f.target, syntheticControlImage(1)), 'DECOMPOSITION_RAW_BINDING');
  for (const mutate of [b => { b.status = 'unaccepted'; }, b => { b.assessmentReady = false; }]) {
    const b = unseal(f.target); mutate(b); rejects(() => decompositionReviewFiles(seal(b), f.raw), 'DECOMPOSITION_ACCEPTED_TARGET');
  }
  const bad = structuredClone(unseal(f.target)); bad.instances.push(bad.instances[0]);
  rejects(() => decompositionReviewFiles(seal(bad), f.raw), 'DECOMPOSITION_INSTANCES');
  const tampered = structuredClone(f.target); tampered.hiddenGeometry = 'recovered';
  rejects(() => decompositionReviewFiles(tampered, f.raw), 'RECORD_INTEGRITY');
});

test('all unknown ownership stays incomplete with full-frame holes and no source-image fallback', t => {
  const f = accepted(t), map = ownerMap(f.target, () => null), p = visibleOwnershipFiles(f.target, f.raw, map);
  assert.deepEqual(p.files.get('ownership-native.png'), map);
  assert.equal(p.report.status, 'incomplete-visible-ownership'); assert.equal(p.report.assignedPixels, 0);
  assert.equal(p.report.unassignedPixels, 512 * 288); assert.equal(p.report.missingInstanceIds.length, 2);
  assert.deepEqual(p.report.coordinateRoundtrip, { rgbaMismatchPixels: 512 * 288, assignedRgbaMismatchPixels: 0, sourceFallbackPixels: 0 });
  assert.equal(inspectPng(p.files.get('reassembled-visible.png')).nonzeroAlphaPixels, 0);
});

test('partial ownership exports tight fragment origins and preserves every selected RGBA byte', t => {
  const f = accepted(t), map = ownerMap(f.target, (x, y) => x >= 3 && x < 8 && y >= 9 && y < 12 && x !== 5 ? 1 : null);
  const p = visibleOwnershipFiles(f.target, f.raw, map), fragment = p.report.fragments[1];
  assert.equal(p.report.assignedPixels, 12); assert.equal(p.report.unassignedPixels, 512 * 288 - 12);
  assert.deepEqual(fragment.nativeCrop, { x: 3, y: 9, width: 5, height: 3 });
  const img = inspectPng(p.files.get(fragment.path), { includePixels: true }), raw = inspectPng(f.raw, { includePixels: true });
  for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++) assert.deepEqual(img.rgba.subarray((y * 5 + x) * 4, (y * 5 + x + 1) * 4),
    x === 2 ? Buffer.alloc(4) : raw.rgba.subarray(((y + 9) * 512 + x + 3) * 4, ((y + 9) * 512 + x + 4) * 4));
  assert.equal(p.report.coordinateRoundtrip.rgbaMismatchPixels, p.report.unassignedPixels);
});

test('complete visible copy roundtrip stays pending semantic review and never certifies reusable alpha assets', t => {
  const f = accepted(t), map = ownerMap(f.target, (_x, y) => y < 188 ? 0 : 1), p = visibleOwnershipFiles(f.target, f.raw, map);
  assert.equal(p.report.status, 'complete-visible-ownership-pending-semantic-review');
  assert.equal(p.report.unassignedPixels, 0); assert.deepEqual(p.report.missingInstanceIds, []);
  assert.equal(p.report.coordinateRoundtrip.rgbaMismatchPixels, 0); assert.equal(p.report.semanticSegmentation, 'not-assessed');
  assert.equal(p.report.visualAcceptance, 'not-assessed'); assert.equal(p.report.reusableAssets, false);
  assert.equal(p.bundle.assetPackage, false); assert.equal(p.report.hiddenGeometry, 'unknown');
  assert.deepEqual(inspectPng(p.files.get('reassembled-visible.png'), { includePixels: true }).rgba, inspectPng(f.raw, { includePixels: true }).rgba);
});

test('assigning every pixel to sky cannot hide missing required instances', t => {
  const f = accepted(t), p = visibleOwnershipFiles(f.target, f.raw, ownerMap(f.target, () => 0));
  assert.equal(p.report.unassignedPixels, 0); assert.equal(p.report.status, 'incomplete-visible-ownership');
  assert.deepEqual(p.report.missingInstanceIds, ['ground.actual']);
});

test('label maps reject rescaling, non-opaque pixels and antialiased or foreign label colors', t => {
  const f = accepted(t), good = inspectPng(ownerMap(f.target, () => 0), { includePixels: true });
  rejects(() => visibleOwnershipFiles(f.target, f.raw, encodeRgbaPng(1, 1, Buffer.from([0, 0, 0, 255]))), 'OWNERSHIP_MAP_FRAME');
  const soft = Buffer.from(good.rgba); soft[3] = 128;
  rejects(() => visibleOwnershipFiles(f.target, f.raw, encodeRgbaPng(512, 288, soft)), 'OWNERSHIP_MAP_FRAME');
  const foreign = Buffer.from(good.rgba); foreign.set([1, 2, 3, 255], 0);
  rejects(() => visibleOwnershipFiles(f.target, f.raw, encodeRgbaPng(512, 288, foreign)), 'OWNERSHIP_UNKNOWN_COLOR');
});

test('project exports replay exactly, retain state, reject overwrite and detect a modified proof', t => {
  const f = accepted(t), before = project.inspectReferenceLedProject(f.root), out = join(f.parent, 'decompose');
  project.buildReferenceDecomposition(f.root, out);
  assert.equal(project.verifyReferenceDecomposition(f.root, out).verifiedFiles, 8);
  assert.throws(() => project.buildReferenceDecomposition(f.root, out));
  const map = join(out, 'ownership-unassigned.png'), review = join(f.parent, 'ownership');
  project.buildVisibleOwnershipReview(f.root, map, review);
  assert.equal(project.verifyVisibleOwnershipReview(f.root, map, review).verifiedFiles, 9);
  writeFileSync(join(out, 'crops/sky.actual.png'), Buffer.from('modified'));
  rejects(() => project.verifyReferenceDecomposition(f.root, out), 'PROOF_BUNDLE_RECOMPILE_MISMATCH');
  assert.deepEqual(project.inspectReferenceLedProject(f.root), before);
});

test('unaccepted live workflow cannot produce a decomposition package', t => {
  const f = controlFixture(t, { rejected: false }), out = join(f.parent, 'no-output'), before = project.inspectReferenceLedProject(f.root);
  rejects(() => project.buildReferenceDecomposition(f.root, out), 'DECOMPOSITION_ACCEPTED_TARGET');
  assert.equal(existsSync(out), false); assert.deepEqual(project.inspectReferenceLedProject(f.root), before);
});

test('offline CLI decompose and ownership commands verify with no generation or implicit flags', async t => {
  const f = accepted(t), out = join(f.parent, 'cli-decompose'), review = join(f.parent, 'cli-review');
  const cli = fileURLToPath(new URL('../scripts/reference.mjs', import.meta.url)), run = promisify(execFile), before = project.inspectReferenceLedProject(f.root);
  await run(process.execPath, [cli, 'decompose', '--root', f.root, '--out', out]);
  const verified = await run(process.execPath, [cli, 'verify-decomposition', '--root', f.root, '--out', out]);
  assert.equal(JSON.parse(verified.stdout).generationCalls, 0);
  const map = join(out, 'ownership-unassigned.png');
  await run(process.execPath, [cli, 'ownership', '--root', f.root, '--map', map, '--out', review]);
  await run(process.execPath, [cli, 'verify-ownership', '--root', f.root, '--map', map, '--out', review]);
  await assert.rejects(run(process.execPath, [cli, 'decompose', '--root', f.root, '--out', join(f.parent, 'extra'), '--yes', 'true']));
  assert.equal(JSON.parse(readFileSync(join(review, 'report.json'))).unassignedPixels, 512 * 288);
  assert.deepEqual(project.inspectReferenceLedProject(f.root), before);
});
