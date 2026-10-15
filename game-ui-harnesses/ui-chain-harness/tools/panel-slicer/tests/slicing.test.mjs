import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { measureSlices, multiplierRange } from '../src/geometry.mjs';
import { newSliceDocument, validateSliceDocument, sliceViewOptions } from '../src/document.mjs';

const source = { sha256: 'a'.repeat(64), width: 256, height: 192 };
test('texture size policy checks center stretch and ignores export resolution', () => {
  const doc = { ...newSliceDocument({ ...source, width: 500, height: 150 }), bordersPx: { left: 40, right: 40, top: 30, bottom: 30 }, target: { width: 500, height: 150 }, resizePolicy: 'texture-balanced-v1' };
  assert.doesNotThrow(() => validateSliceDocument({ ...doc, target: { width: 640, height: 180 }, exportResolution: 4 }));
  assert.throws(() => validateSliceDocument({ ...doc, target: { width: 240, height: 480 } }), /不适合当前尺寸/);
  assert.throws(() => validateSliceDocument({ ...doc, target: { width: 500, height: 60 } }), /不适合当前尺寸/);
  assert.doesNotThrow(() => validateSliceDocument({ ...doc, resizePolicy: undefined, target: { width: 240, height: 480 } }));
});
test('slice source pixels, display density and output resolution are independent', () => {
  const doc = { ...newSliceDocument(source), density: 2, bordersPx: { left: 33, top: 24, right: 40, bottom: 28 }, multiplier: 2 };
  const measured = measureSlices(sliceViewOptions(validateSliceDocument(doc, source)));
  assert.deepEqual(measured.displayedBorders, { left: 8.25, top: 6, right: 10, bottom: 7 });
  assert.equal(measured.innerWidth * measured.scale, 480);
  assert.equal(measured.innerHeight * measured.scale, 280);
  assert.deepEqual(sliceViewOptions({ ...doc, exportResolution: 4 }), sliceViewOptions(doc));
  assert.equal(doc.bordersPx.left, 33);
});
test('slice input rejects missing centers, undersized targets and invalid multipliers', () => {
  const doc = newSliceDocument(source);
  for (const multiplier of [0, -1, NaN, Infinity, 0.1, 17]) assert.throws(() => validateSliceDocument({ ...doc, multiplier }));
  assert.throws(() => validateSliceDocument({ ...doc, bordersPx: { left: 128, right: 128, top: 0, bottom: 0 } }), { code: 'slice.center' });
  assert.throws(() => validateSliceDocument({ ...doc, bordersPx: { left: 60, right: 60, top: 0, bottom: 0 }, multiplier: 0.25, target: { width: 479, height: 280 } }), { code: 'slice.minimum' });
  assert.doesNotThrow(() => validateSliceDocument({ ...doc, bordersPx: { left: 60, right: 60, top: 0, bottom: 0 }, multiplier: 0.25 }));
});
test('slice config is closed, versioned and bound to the exact source', () => {
  const doc = newSliceDocument(source);
  for (const bad of [{ ...doc, unknown: true }, { ...doc, version: '2.0' }, { ...doc, bordersPx: { ...doc.bordersPx, left: 0.5 } }])
    assert.throws(() => validateSliceDocument(bad), { code: 'slice.schema' });
  assert.throws(() => validateSliceDocument(doc, { ...source, sha256: 'b'.repeat(64) }), { code: 'slice.source' });
  assert.throws(() => validateSliceDocument(doc, { ...source, width: 512 }), { code: 'slice.source' });
  const clone = validateSliceDocument(doc); clone.bordersPx.left = 2; assert.equal(doc.bordersPx.left, 0);
  assert.deepEqual(validateSliceDocument(JSON.parse(JSON.stringify(doc))), doc);
});
test('slice export limits are checked before allocating a render target', () => {
  const doc = { ...newSliceDocument(source), target: { width: 2048, height: 24 }, exportResolution: 2 };
  assert.doesNotThrow(() => validateSliceDocument(doc));
  assert.throws(() => validateSliceDocument({ ...doc, exportResolution: 4 }), { code: 'slice.export-size' });
});
test('Panel property range stays aligned with shared slicing contract', async () => {
  const registry = JSON.parse(await readFile(new URL('../../../configs/component-registry.draft.json', import.meta.url)));
  const property = registry.recipes.find(r => r.type === 'Panel').propsSchema.properties.pixelsPerUnitMultiplier;
  assert.equal(property.minimum, multiplierRange.min); assert.equal(property.maximum, multiplierRange.max); assert.equal(property.default, 1);
});
