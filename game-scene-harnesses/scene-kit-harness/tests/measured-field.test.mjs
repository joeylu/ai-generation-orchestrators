import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeRgbaPng, inspectPng } from '../src/png.mjs';
import { hash, seal, unseal } from '../src/generation/common.mjs';
import { SIGNATURES } from '../src/topology.mjs';
import { raster } from '../src/terrain-proof/raster.mjs';
import { studySurface } from '../src/terrain-proof/modules.mjs';
import { joinedFieldCrops } from '../src/terrain-proof/joined-field.mjs';
import { compileMeasuredSurfaceMapping, validateMeasuredSurfaceMapping, deriveMeasuredField, periodizeMeasuredBody,
  buildMeasuredTiles, MEASURED_FIELD_PROFILE, MEASURED_FIELD_SHA256 } from '../src/terrain-proof/measured-field.mjs';

const ratio = n => n.numerator / n.denominator;
const at = (image, x, y) => [...image.rgba.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];
function material(width = 1536, height = 1024) {
  const image = raster(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const color = y < 12 ? [248, 210, 61, 255] : y < 40 ? [118, 119, 43, 255]
      : [80 + Math.floor(x / 80) % 5 * 7, 72 + y % 9, 58, 255];
    image.rgba.set(color, (y * width + x) * 4);
  }
  return encodeRgbaPng(width, height, image.rgba);
}
function inputs(options = {}) {
  const raw = material(), reference = material(1024, 512);
  const target = seal({ format: 'ai_scene_reference_reconstruction_target_v2', rawSha256: hash(reference),
    mapping: { nativeSize: { width: 1024, height: 512 }, viewport: { width: 1024, height: 512 },
      scale: { numerator: 1, denominator: 1 }, offset: { x: 0, y: 0 } },
    surfaces: [{ surfaceId: 'ground.top' }] });
  const observations = { format: 'ai_scene_measured_surface_observations_v1',
    sourceSurfaceTopY: 0, sourceBodyStartY: 40, sourceWindowCenterX: 768,
    rockFeaturePairs: [{ featureId: 'rock-a', source: { fromX: 200, toX: 402 }, reference: { fromX: 100, toX: 202 } }],
    referenceSurfaceSamples: [{ sampleId: 'surface-a', surfaceId: 'ground.top', x: 300, topY: 200, bodyStartY: 220 }],
    notes: 'Approximate hand-observed material-family spans; not an exact rock correspondence.', ...options };
  return { reference, target, material: raw, observations };
}
const cached = new Map();
function sample() {
  if (!cached.size) {
    const input = inputs(), mapping = compileMeasuredSurfaceMapping(input), derived = deriveMeasuredField(input.material, mapping);
    cached.set('value', { input, mapping, ...derived });
  }
  return cached.get('value');
}

test('explicit measurements retain the bright top and macro-rock scale without an H-based crop', () => {
  const { input, mapping, files, report } = sample();
  assert.equal(mapping.observations.sourceSurfaceTopY, 0);
  assert.equal(ratio(mapping.crops.cap.y), 0);
  assert.equal(ratio(mapping.crops.body.y), 40);
  assert.ok(ratio(mapping.nativePixelsPerFieldPixel) > 2 && ratio(mapping.nativePixelsPerFieldPixel) < 2.01);
  assert.equal(mapping.field.capHeight, 21);
  assert.equal(report.capDepth.numerator / report.capDepth.denominator,
    (40 / ratio(mapping.nativePixelsPerFieldPixel) + 1) * 256 / 253);
  assert.equal(ratio(mapping.capUvEnd), (ratio(mapping.boundaryFieldPixels) + 1) / mapping.field.capHeight);
  const cap = inspectPng(files.get('materials/cap-field.png'), { includePixels: true, pixelStats: true });
  assert.deepEqual(at(cap, 200, 0), [248, 210, 61, 255]);
  assert.deepEqual(at(cap, 200, 4), [248, 210, 61, 255]);
  assert.equal(joinedFieldCrops(1536, 1024).cap.y.numerator, 64);
  assert.equal(report.referenceSha256, hash(input.reference));
  assert.equal(report.source.sha256, hash(input.material));
  assert.equal(mapping.targetSha256, input.target.sha256);
  assert.equal(report.surfaceMappingSha256, mapping.sha256);
});

test('the lower median width ratio fixes one rational native scale for both axes and both fields', () => {
  const input = inputs({ rockFeaturePairs: [
    { featureId: 'wide', source: { fromX: 0, toX: 303 }, reference: { fromX: 0, toX: 102 } },
    { featureId: 'middle', source: { fromX: 0, toX: 202 }, reference: { fromX: 0, toX: 102 } },
    { featureId: 'small', source: { fromX: 0, toX: 101 }, reference: { fromX: 0, toX: 102 } },
  ] });
  const mapping = compileMeasuredSurfaceMapping(input), s = ratio(mapping.nativePixelsPerFieldPixel);
  assert.equal(mapping.selectedFeatureId, 'middle');
  assert.equal(ratio(mapping.crops.body.width) / 505, s);
  assert.equal(ratio(mapping.crops.body.height) / 253, s);
  assert.equal(ratio(mapping.crops.cap.height) / mapping.field.capHeight, s);
  assert.deepEqual(mapping.crops.body.x, mapping.crops.cap.x);
  assert.equal(mapping.compatibility.rockFeatures.find(pair => pair.featureId === 'middle').widthRatioToReference, 1);
  assert.equal(mapping.compatibility.exactFeatureCorrespondence, false);
  assert.equal(mapping.compatibility.thresholdsApplied, false);
  assert.equal(mapping.compatibility.visualAcceptance, 'not-assessed');
});

test('reference thickness disagreements remain explicit review evidence and never trigger a hidden rescale', () => {
  const first = compileMeasuredSurfaceMapping(inputs());
  const other = compileMeasuredSurfaceMapping(inputs({ referenceSurfaceSamples: [
    { sampleId: 'surface-a', surfaceId: 'ground.top', x: 300, topY: 200, bodyStartY: 202 },
  ] }));
  assert.deepEqual(other.nativePixelsPerFieldPixel, first.nativePixelsPerFieldPixel);
  assert.deepEqual(other.crops, first.crops);
  assert.deepEqual(other.capDepth, first.capDepth);
  assert.ok(other.compatibility.depthRatioToObservedRange.minimum > 9);
  assert.equal(other.compatibility.status, 'requires-human-review');
  assert.notEqual(other.sha256, first.sha256);
});

test('a short body repeats the available native rows without fitting or reducing the observed rock scale', () => {
  const input = inputs({ rockFeaturePairs: [
    { featureId: 'macro', source: { fromX: 200, toX: 503 }, reference: { fromX: 100, toX: 202 } },
  ] });
  const tall = compileMeasuredSurfaceMapping(input);
  const materialShort = material(1536, 512);
  const short = compileMeasuredSurfaceMapping({ ...input, material: materialShort });
  assert.deepEqual(short.nativePixelsPerFieldPixel, tall.nativePixelsPerFieldPixel);
  assert.equal(ratio(short.nativePixelsPerFieldPixel), 3.011764705882353);
  assert.equal(short.bodySampleHeight, 156);
  assert.equal(short.bodyFill, 'periodic-source-rows-no-rescale');
  assert.deepEqual(short.bodyRepeatRanges, [{ targetStartRow: 156, targetEndRowExclusive: 253,
    sourceStartRow: 0, sourceEndRowExclusive: 97 }]);
  assert.equal(ratio(short.crops.body.height) / short.bodySampleHeight, ratio(short.nativePixelsPerFieldPixel));
  const { files, report } = deriveMeasuredField(materialShort, short);
  const body = inspectPng(files.get('materials/body-field.png'), { includePixels: true });
  assert.deepEqual([body.width, body.height], [505, 253]);
  for (let y = 0; y < 90; y++) assert.deepEqual(at(body, 200, y + 156), at(body, 200, y));
  assert.deepEqual(at(body, 200, 252), at(body, 200, 0));
  assert.deepEqual(report.bodyRepeatRanges, short.bodyRepeatRanges);
  assert.equal(report.bodySampleHeight, 156);
  assert.equal(report.bodyFill, 'periodic-source-rows-no-rescale');
  assert.equal(report.visualAcceptance, 'not-assessed');
});

test('one field-pixel overlap enters real unchanged body paint without a fixed alpha fade', () => {
  const { mapping, report, files } = sample();
  assert.equal(ratio(mapping.surfaceOriginInBodyPixels), -ratio(mapping.boundaryFieldPixels));
  assert.equal(ratio(mapping.capDepth) / 256 * 253 + ratio(mapping.surfaceOriginInBodyPixels), 1);
  const cap = inspectPng(files.get('materials/cap-field.png'), { includePixels: true });
  for (let p = 3; p < cap.rgba.length; p += 4) assert.equal(cap.rgba[p], 255);
  assert.equal(report.sourceTransition.overlapFieldPixels, 1);
  assert.equal(report.sourceTransition.alphaFadeRows, 0);
  assert.equal(report.sourceTransition.referencePixelsCopied, 0);
  const source = raster(64, 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) source.rgba.set([y * 3, x, 80, 255], (y * 64 + x) * 4);
  const closed = periodizeMeasuredBody(source);
  for (let y = 0; y < 4; y++) assert.deepEqual(at(closed, 20, y), at(source, 20, y));
  assert.deepEqual(at(closed, 20, 63), at(closed, 20, 0));
});

test('variable-cap tiles preserve all 47 topology alpha roles and apply no procedural shade', () => {
  const body = raster(64, 64), cap = raster(64, 13);
  for (let p = 0; p < body.rgba.length; p += 4) body.rgba.set([120, 80, 40, 255], p);
  for (let p = 0; p < cap.rgba.length; p += 4) cap.rgba.set([240, 210, 60, 255], p);
  const tiles = buildMeasuredTiles(body, cap);
  assert.equal(tiles.size, 47);
  for (const mask of SIGNATURES) for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const pixel = at(tiles.get(mask), x, y), expected = studySurface(mask, x, y).alpha;
    assert.equal(pixel[3], expected);
    if (!expected) assert.deepEqual(pixel, [0, 0, 0, 0]);
    else assert.ok(pixel[0] === 120 || pixel[0] === 240);
  }
});

test('complete deterministic derivation preserves source bytes, bindings, phases and package fingerprints', () => {
  const { input, mapping, report, files } = sample(), before = Buffer.from(input.material), again = deriveMeasuredField(input.material, mapping);
  assert.deepEqual(input.material, before);
  assert.equal(report.profileSha256, MEASURED_FIELD_SHA256);
  assert.equal(report.phaseCount, 32);
  assert.equal(report.topologyRoles, 47);
  assert.equal([...files.keys()].filter(path => path.startsWith('tiles/')).length, 32 * 47);
  assert.ok(report.assessments.every(qa => qa.status === 'pass' && qa.geometryFailures === 0
    && qa.interfaces.every(edge => edge.maximumChannelDifference === 0)));
  assert.equal(report.generationCalls, 0);
  assert.equal(report.visualAcceptance, 'not-assessed');
  assert.equal(report.sourceTransition.naturalTransitionAssessed, false);
  assert.equal(again.report.sha256, report.sha256);
  for (const [path, bytes] of files) assert.deepEqual(again.files.get(path), bytes);
  for (const artifact of report.artifacts) assert.equal(hash(files.get(artifact.path)), artifact.sha256);
  assert.equal(MEASURED_FIELD_PROFILE.transition.alphaFadeRows, 0);
  assert.ok(Object.isFrozen(MEASURED_FIELD_PROFILE));
});

test('reference appearance changes fingerprints without supplying any output asset pixels', () => {
  const { input, files } = sample();
  const changedReference = inspectPng(input.reference, { includePixels: true });
  for (let p = 0; p < changedReference.rgba.length; p += 4) {
    changedReference.rgba[p] = 255 - changedReference.rgba[p];
    changedReference.rgba[p + 2] = 255 - changedReference.rgba[p + 2];
  }
  const reference = encodeRgbaPng(changedReference.width, changedReference.height, changedReference.rgba);
  const target = seal({ ...unseal(input.target), rawSha256: hash(reference) });
  const mapping = compileMeasuredSurfaceMapping({ ...input, reference, target });
  const changed = deriveMeasuredField(input.material, mapping);
  for (const [path, bytes] of files) if (path.endsWith('.png')) assert.deepEqual(changed.files.get(path), bytes);
  assert.equal(changed.report.referenceSha256, hash(reference));
  assert.equal(changed.report.sourceTransition.referencePixelsCopied, 0);
});

test('changed identities, invalid observations, unsupported windows and resealed parameter tampering are rejected', () => {
  const { input, mapping } = sample();
  assert.throws(() => compileMeasuredSurfaceMapping({ ...input, target: seal({ ...unseal(input.target), rawSha256: 'a'.repeat(64) }) }));
  assert.throws(() => compileMeasuredSurfaceMapping(inputs({ sourceBodyStartY: 0 })));
  assert.throws(() => compileMeasuredSurfaceMapping(inputs({ sourceWindowCenterX: 20 })));
  assert.throws(() => compileMeasuredSurfaceMapping(inputs({ rockFeaturePairs: [] })));
  assert.throws(() => compileMeasuredSurfaceMapping(inputs({ sourceBodyStartY: 200 })));
  assert.throws(() => compileMeasuredSurfaceMapping(inputs({ referenceSurfaceSamples: [
    { sampleId: 'a', surfaceId: 'unknown', x: 100, topY: 200, bodyStartY: 210 },
  ] })));
  const changed = Buffer.from(input.material); changed[changed.length - 1] ^= 1;
  assert.throws(() => deriveMeasuredField(changed, mapping));
  assert.throws(() => validateMeasuredSurfaceMapping(seal({ ...unseal(mapping), capDepth: { numerator: 32, denominator: 1 } })));
  assert.throws(() => validateMeasuredSurfaceMapping({ ...mapping, capDepth: { numerator: 32, denominator: 1 } }));
});
