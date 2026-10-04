import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importTextureLibrary, verifyTexturePackage } from '../src/texture-library.mjs';
import { redesignTextures } from '../src/texture-redesign.mjs';
import { digestBytes, digestJson } from '../src/canonical.mjs';
import { jsonFileBytes } from '../src/io.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(join(root, '.tmp'), { recursive: true });
const work = await mkdtemp(join(root, '.tmp', 'redesign-'));
// This explicit test double verifies orchestration and evidence, not real PNG rendering.
const evidence = { width: 64, height: 64, channels: 4, alpha: { mode: 'opaque', transparentPixels: 0, opaquePixels: 4096, softPixels: 0, hiddenRgbPixels: 0,
  visibleBounds: { x: 0, y: 0, width: 64, height: 64 } } };
const adapter = {
  evidence: { name: 'fixture-double', version: '1' },
  analyze: async () => structuredClone(evidence),
  render: async svg => Buffer.from(svg),
  gallery: async () => Buffer.from('explicit-fixture-preview'),
};
async function source(name, paths = ['Border/Rounded/64px/Rounded Filled 64px.png', 'Icon/System/Settings.png']) {
  const directory = join(work, name);
  for (const path of paths) {
    const file = join(directory, path); await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, 'explicit-fixture-source');
    await writeFile(`${file}.meta`, 'guid: 0123456789abcdef0123456789abcdef\nTextureImporter:\n  spriteMode: 1\n  spritePixelsToUnits: 100\n  spritePivot: {x: 0.5, y: 0.5}\n  spriteBorder: {x: 8, y: 8, z: 8, w: 8}\n  alphaIsTransparency: 1\n');
  }
  const output = join(work, `${name}-intake`);
  await importTextureLibrary(directory, output, adapter);
  return output;
}

test('redesign preserves source mappings and dimensions with separate SVG/PNG artifacts and truthful gates', async () => {
  const input = await source('complete'), output = join(work, 'complete-redraw');
  const originalBytes = await readFile(join(input, 'texture-library.json'));
  const result = await redesignTextures(input, output, adapter);
  assert.equal(result.records.length, 2);
  for (const record of result.records) {
    assert.equal(record.image.width, record.sourceImage.width); assert.equal(record.image.height, record.sourceImage.height);
    assert.equal(record.sourceUnity.border.left, 8);
    assert(['valid', 'none'].includes(record.unity.nineSlice));
    assert.match(record.vector.path, /^vectors\/[a-f0-9]{64}\.svg$/);
    assert.equal(record.file.sha256, await digestBytes(await readFile(join(output, record.file.path))));
  }
  assert.equal(result.verification.visualReview, 'NOT_RUN'); assert.equal(result.verification.nativeEngines, 'NOT_RUN');
  assert.deepEqual(await readFile(join(input, 'texture-library.json')), originalBytes);
  assert.equal((await verifyTexturePackage(output, adapter)).index.sha256, result.sha256);
});

test('unsupported semantics and empty redraw fail before creating an output directory', async () => {
  const unknown = await source('unknown', ['Icon/System/Unknown.png']);
  const output = join(work, 'unknown-redraw');
  await assert.rejects(redesignTextures(unknown, output, adapter));
  await assert.rejects(stat(output), { code: 'ENOENT' });
  const input = await source('empty');
  const empty = { ...adapter, analyze: async bytes => {
    if (!bytes.toString().startsWith('<svg')) return structuredClone(evidence);
    return { ...structuredClone(evidence), alpha: { mode: 'empty', transparentPixels: 4096, opaquePixels: 0, softPixels: 0, hiddenRgbPixels: 0, visibleBounds: null } };
  } };
  const emptyOutput = join(work, 'empty-redraw');
  await assert.rejects(redesignTextures(input, emptyOutput, empty), /REDESIGN_PIXEL_GATE/);
  await assert.rejects(stat(emptyOutput), { code: 'ENOENT' });
});

test('rehashed inconsistent source mapping is rejected; output cannot be overwritten or redrawn as a source library', async () => {
  const input = await source('tamper'), output = join(work, 'tamper-redraw');
  const result = await redesignTextures(input, output, adapter);
  await assert.rejects(redesignTextures(input, output, adapter), /OUTPUT_EXISTS/);
  await assert.rejects(redesignTextures(output, join(work, 'nested-redraw'), adapter), /REDESIGN_SOURCE_LIBRARY_REQUIRED/);
  result.records[0].source.sha256 = '0'.repeat(64);
  const { sha256: ignored, ...payload } = result; result.sha256 = await digestJson(payload);
  const bytes = jsonFileBytes(result); await writeFile(join(output, 'texture-redesign.json'), bytes);
  const delivery = JSON.parse(await readFile(join(output, 'delivery.json')));
  delivery.sha256 = result.sha256;
  const indexFile = delivery.files.find(file => file.path === 'texture-redesign.json');
  indexFile.sha256 = await digestBytes(bytes); indexFile.bytes = bytes.length;
  await writeFile(join(output, 'delivery.json'), jsonFileBytes(delivery));
  await assert.rejects(verifyTexturePackage(output, adapter), /REDESIGN_SOURCE_MAPPING/);
});

test('rehashed valid border or pixel scale changes must still match the redesign recipe', async () => {
  const input = await source('import-metadata');
  for (const field of ['border', 'pixelsPerUnit']) {
    const output = join(work, `import-metadata-${field}-redraw`);
    const result = await redesignTextures(input, output, adapter);
    const record = result.records.find(item => item.classification.category === 'border');
    if (field === 'border') {
      const inset = record.unity.border.left === 1 ? 2 : 1;
      const replacement = { left: inset, bottom: inset, right: inset, top: inset };
      assert.notDeepEqual(replacement, record.unity.border);
      assert.ok(inset * 2 < record.image.width && inset * 2 < record.image.height);
      record.unity.border = replacement;
      record.unity.nineSlice = 'valid';
    } else {
      const replacement = record.unity.pixelsPerUnit === 100 ? 200 : 100;
      assert.notEqual(replacement, record.unity.pixelsPerUnit);
      record.unity.pixelsPerUnit = replacement;
    }
    const { sha256: ignored, ...payload } = result;
    result.sha256 = await digestJson(payload);
    const bytes = jsonFileBytes(result);
    await writeFile(join(output, 'texture-redesign.json'), bytes);
    const delivery = JSON.parse(await readFile(join(output, 'delivery.json')));
    delivery.sha256 = result.sha256;
    const indexFile = delivery.files.find(file => file.path === 'texture-redesign.json');
    indexFile.sha256 = await digestBytes(bytes);
    indexFile.bytes = bytes.length;
    await writeFile(join(output, 'delivery.json'), jsonFileBytes(delivery));
    await assert.rejects(verifyTexturePackage(output, adapter), /REDESIGN_IMPORT_METADATA_MISMATCH/, field);
  }
});
