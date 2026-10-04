import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, readdir, rename, stat, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digestBytes, digestJson } from '../src/canonical.mjs';
import { jsonFileBytes } from '../src/io.mjs';
import { collectTextureSources, importTextureLibrary, makeTextureLibrary, publishTexturePackage, searchTextures, textureId, textureSummary, verifyTexturePackage } from '../src/texture-library.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(join(root, '.tmp'), { recursive: true });
const work = await mkdtemp(join(root, '.tmp', 'texture-library-tests-'));

// Synthetic signature-bearing bytes belong only to this deterministic test double.
// These tests do not claim that the bytes are complete, decodable PNG images.
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const pixels = (marker) => Buffer.concat([signature, Buffer.from([marker])]);
const adapter = {
  evidence: { kind: 'test-double', name: 'tiny-alpha-fixture', version: '1' },
  async analyze(bytes) {
    if (bytes.length !== 9 || !Buffer.from(bytes.subarray(0, 8)).equals(signature)) throw new Error('FIXTURE_DECODE_FAILED');
    const empty = bytes[8] === 2;
    return { width: 2, height: 2, channels: 4, alpha: {
      mode: empty ? 'empty' : 'mixed', transparentPixels: empty ? 4 : 1,
      opaquePixels: empty ? 0 : 2, softPixels: empty ? 0 : 1, hiddenRgbPixels: 0,
      visibleBounds: empty ? null : { x: 0, y: 0, width: 2, height: 2 },
    } };
  },
};
const meta = `fileFormatVersion: 2
guid: 3296a71782ce9ce42a9fe71d6f86a3ef
TextureImporter:
  spriteMode: 1
  spritePivot: {x: 0.5, y: 0.5}
  spritePixelsToUnits: 100
  spriteBorder: {x: 0, y: 0, z: 0, w: 0}
  alphaIsTransparency: 1
`;
const fixtureFiles = [
  ['Icon/System/Settings.png', pixels(0)],
  ['Icon/System/Settings Filled.png', pixels(1)],
  ['Icon/Device/Speaker.png', pixels(0)],
  ['Demo/Settings Demo.png', pixels(2)],
];

async function sourceFixture(name, files = fixtureFiles, withMeta = true) {
  const source = join(work, name);
  await mkdir(source, { recursive: true });
  for (const [relativePath, bytes] of files) {
    const target = join(source, ...relativePath.split('/'));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
    if (withMeta) await writeFile(`${target}.meta`, meta);
  }
  return source;
}

async function imported(name) {
  const source = await sourceFixture(`${name}-source`);
  const output = join(work, `${name}-output`);
  const library = await importTextureLibrary(source, output, adapter, { id: 'fixture-library' });
  return { source, output, library };
}

async function rewriteIndex(output, change) {
  const target = join(output, 'texture-library.json');
  const index = JSON.parse(await readFile(target, 'utf8'));
  change(index);
  const { sha256: ignored, ...payload } = index;
  index.sha256 = await digestJson(payload);
  const bytes = jsonFileBytes(index);
  await writeFile(target, bytes);
  const manifestPath = join(output, 'delivery.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.sha256 = index.sha256;
  const entry = manifest.files.find((file) => file.path === 'texture-library.json');
  entry.bytes = bytes.length;
  entry.sha256 = await digestBytes(bytes);
  await writeFile(manifestPath, jsonFileBytes(manifest));
}

test('texture intake is deterministic across directory creation order and preserves all source identities', async () => {
  const sourceA = await sourceFixture('deterministic-a');
  const sourceB = await sourceFixture('deterministic-b', [...fixtureFiles].reverse());
  const inputsA = await collectTextureSources(sourceA, adapter);
  const inputsB = await collectTextureSources(sourceB, adapter);
  assert.deepEqual(inputsA, inputsB);
  const first = await makeTextureLibrary(inputsA, 'deterministic-library', adapter.evidence);
  const second = await makeTextureLibrary(inputsB, 'deterministic-library', adapter.evidence);
  assert.deepEqual(first, second);
  assert.equal(first.summary.assets, 4);
  assert.equal(first.summary.uniquePngFiles, 3);
  assert.equal(first.summary.families, 3);
  assert.deepEqual(first.summary.categories, { demo: 1, icon: 3 });
  assert.equal(first.summary.emptyImages, 1);
  assert.deepEqual(first.records.map((record) => record.source.relativePath), fixtureFiles.map(([path]) => path).sort());
  for (const record of first.records) assert.equal(record.id, await textureId(record.source.relativePath));
});

test('import stores one PNG per byte hash while preserving duplicate source paths and portable evidence', async () => {
  const { output, library, source } = await imported('deduplication');
  assert.equal((await readdir(join(output, 'textures'))).length, 3);
  assert.equal(library.records.length, 4);
  const settings = library.records.find((record) => record.source.relativePath === 'Icon/System/Settings.png');
  const speaker = library.records.find((record) => record.source.relativePath === 'Icon/Device/Speaker.png');
  assert.equal(settings.file.path, speaker.file.path);
  assert.notEqual(settings.id, speaker.id);
  const serialized = await readFile(join(output, 'texture-library.json'), 'utf8');
  assert.equal(serialized.includes(source), false);
  assert.equal(serialized.includes(root), false);
  assert.equal(serialized.includes('sourcePath'), false);
  for (const record of library.records) {
    assert.ok(!record.source.relativePath.includes('\\'));
    assert.ok(!record.source.relativePath.includes(':'));
    assert.ok(!record.source.relativePath.startsWith('/'));
    assert.ok(record.unity.issues.every((issue) => !issue.includes('/') && !issue.includes('\\')));
    assert.deepEqual(await readFile(join(output, record.file.path)), fixtureFiles.find(([path]) => path === record.source.relativePath)[1]);
  }
  const checked = await verifyTexturePackage(output, adapter);
  assert.deepEqual(checked.index, library);
  assert.equal(checked.manifest.status, 'COMPLETE');
  assert.equal(checked.manifest.visualReview, 'NOT_RUN');
  assert.equal(checked.manifest.nativeEngines, 'NOT_RUN');
});

test('verification rejects modified PNG bytes and modified index bytes', async () => {
  const first = await imported('tamper-pixels');
  await writeFile(join(first.output, first.library.records[0].file.path), pixels(9));
  await assert.rejects(verifyTexturePackage(first.output, adapter), /TEXTURE_FILE_MISMATCH/);
  const second = await imported('tamper-index');
  await writeFile(join(second.output, 'texture-library.json'), '{}');
  await assert.rejects(verifyTexturePackage(second.output, adapter), /TEXTURE_FILE_MISMATCH/);
});

test('forged package paths are rejected even before an outside file is read or output is created', async () => {
  for (const path of ['../outside.png', '/outside.png', 'C:/outside.png', 'textures\\outside.png', 'textures/a.png', 'textures/' + 'a'.repeat(64) + '.png\n']) {
    const { output } = await imported(`path-${await digestBytes(new TextEncoder().encode(path))}`);
    const manifestPath = join(output, 'delivery.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.files[0].path = path;
    await writeFile(manifestPath, jsonFileBytes(manifest));
    await assert.rejects(verifyTexturePackage(output, adapter), /TEXTURE_PACKAGE_PATH/);
  }
  const rejectedOutput = join(work, 'rejected-publish-path');
  await assert.rejects(publishTexturePackage(rejectedOutput, [{ path: '../outside.png', bytes: pixels(0) }], { kind: 'source-library', id: 'fixture-library', sha256: 'a'.repeat(64) }), /TEXTURE_PACKAGE_PATH/);
  await assert.rejects(stat(rejectedOutput), { code: 'ENOENT' });
});

test('rehashed unsafe source paths and changed classifications are still invalid', async () => {
  const forged = await imported('forged-source');
  await rewriteIndex(forged.output, (index) => { index.records[0].source.relativePath = '../outside.png'; });
  await assert.rejects(verifyTexturePackage(forged.output, adapter), /TEXTURE_SOURCE_PATH/);
  const classification = await imported('forged-classification');
  await rewriteIndex(classification.output, (index) => { index.records[0].classification.tags.push('privileged'); });
  await assert.rejects(verifyTexturePackage(classification.output, adapter), /TEXTURE_CLASSIFICATION_MISMATCH/);
});

test('all source library summary fields are checked against records after hashes are recomputed', async () => {
  for (const [field, replacement] of [['assets', 999], ['uniquePngFiles', 999], ['families', 999], ['categories', { icon: 999 }], ['nineSlice', { valid: 999 }], ['emptyImages', 999]]) {
    const { output } = await imported(`forged-summary-${field}`);
    await rewriteIndex(output, (index) => { index.summary[field] = replacement; });
    await assert.rejects(verifyTexturePackage(output, adapter), /TEXTURE_SUMMARY_MISMATCH/, field);
  }
});

test('rehashed indexes cannot claim unsupported versions or unperformed engine verification', async () => {
  const mutations = [
    (index) => { index.textureLibraryVersion = 'garbage'; },
    (index) => { index.verification.nativeEngines = 'PASS'; },
  ];
  for (let number = 0; number < mutations.length; number += 1) {
    const { output } = await imported(`forged-contract-${number}`);
    await rewriteIndex(output, mutations[number]);
    await assert.rejects(verifyTexturePackage(output, adapter), /TEXTURE_INDEX_CONTRACT/);
  }
});

test('negative source borders cannot claim valid nine slice even with matching summary and hashes', async () => {
  const { output } = await imported('forged-slice-geometry');
  await rewriteIndex(output, (index) => {
    index.records[0].unity.border = { left: -1, bottom: 0, right: 0, top: 0 };
    index.records[0].unity.nineSlice = 'valid';
    index.summary = textureSummary(index.records);
  });
  await assert.rejects(verifyTexturePackage(output, adapter), /TEXTURE_SLICE_EVIDENCE/);
});

test('invalid PNG data and invalid dimensions fail intake before publishing a directory', async () => {
  const brokenSource = await sourceFixture('broken-png', [['Icon/Bad.png', Buffer.from('not a png')]]);
  const brokenOutput = join(work, 'broken-png-output');
  await assert.rejects(importTextureLibrary(brokenSource, brokenOutput, adapter), /FIXTURE_DECODE_FAILED/);
  await assert.rejects(stat(brokenOutput), { code: 'ENOENT' });
  const source = await sourceFixture('invalid-image-evidence');
  const invalidAdapter = { ...adapter, async analyze() { return { width: 0, height: 2, channels: 4, alpha: { mode: 'mixed' } }; } };
  const invalidOutput = join(work, 'invalid-image-evidence-output');
  await assert.rejects(importTextureLibrary(source, invalidOutput, invalidAdapter), /TEXTURE_IMAGE_EVIDENCE/);
  await assert.rejects(stat(invalidOutput), { code: 'ENOENT' });
});

test('verification rejects invalid decoded dimensions even when index evidence was rehashed to match', async () => {
  const { output } = await imported('invalid-verify-evidence');
  const invalidEvidence = { width: 0, height: 2, channels: 4, alpha: { mode: 'mixed' } };
  await rewriteIndex(output, (index) => { for (const record of index.records) record.image = invalidEvidence; });
  const invalidAdapter = { ...adapter, async analyze() { return invalidEvidence; } };
  await assert.rejects(verifyTexturePackage(output, invalidAdapter), /TEXTURE_IMAGE_EVIDENCE/);
});

test('missing and nonfinite alpha evidence is rejected before publication', async () => {
  const source = await sourceFixture('invalid-alpha-source', [['Icon/Settings.png', pixels(0)]]);
  const mutations = [
    (image) => { delete image.alpha; },
    (image) => { delete image.alpha.softPixels; },
    (image) => { image.alpha.transparentPixels = NaN; },
    (image) => { image.alpha.opaquePixels = Infinity; },
    (image) => { image.alpha.hiddenRgbPixels = -Infinity; },
  ];
  for (let index = 0; index < mutations.length; index += 1) {
    const invalidAdapter = { ...adapter, async analyze(bytes) { const image = await adapter.analyze(bytes); mutations[index](image); return image; } };
    const output = join(work, `invalid-alpha-output-${index}`);
    await assert.rejects(importTextureLibrary(source, output, invalidAdapter), /TEXTURE_(?:IMAGE|ALPHA)_EVIDENCE/);
    await assert.rejects(stat(output), { code: 'ENOENT' });
  }
});

test('visible bounds require exactly all four integer fields', async () => {
  const source = await sourceFixture('invalid-bounds-source', [['Icon/Settings.png', pixels(0)]]);
  const bounds = [{}, { x: 0, y: 0, width: 2 }, { x: 0, y: 0, width: 2, height: 2, extra: 1 }];
  for (let index = 0; index < bounds.length; index += 1) {
    const invalidAdapter = { ...adapter, async analyze(bytes) { const image = await adapter.analyze(bytes); image.alpha.visibleBounds = bounds[index]; return image; } };
    const output = join(work, `invalid-bounds-output-${index}`);
    await assert.rejects(importTextureLibrary(source, output, invalidAdapter), /TEXTURE_BOUNDS_EVIDENCE/);
    await assert.rejects(stat(output), { code: 'ENOENT' });
  }
});

test('file size limits are enforced before decoding or publishing', async () => {
  const oversized = Buffer.alloc(16 * 1024 * 1024 + 1);
  const source = await sourceFixture('oversized-png', [['Icon/Large.png', oversized]]);
  let calls = 0;
  const countingAdapter = { ...adapter, async analyze(bytes) { calls += 1; return adapter.analyze(bytes); } };
  const output = join(work, 'oversized-output');
  await assert.rejects(importTextureLibrary(source, output, countingAdapter), /TEXTURE_FILE_LIMIT/);
  assert.equal(calls, 0);
  await assert.rejects(stat(output), { code: 'ENOENT' });
});

test('source and package directory links cannot redirect reads', async () => {
  const type = process.platform === 'win32' ? 'junction' : 'dir';
  const source = await sourceFixture('link-source-target');
  const alias = join(work, 'source-alias');
  await symlink(source, alias, type);
  await assert.rejects(collectTextureSources(alias, adapter), /TEXTURE_LINK_FORBIDDEN/);
  const ordinarySource = await sourceFixture('source-with-linked-child');
  await symlink(source, join(ordinarySource, 'redirected'), type);
  const output = join(work, 'linked-source-output');
  await assert.rejects(importTextureLibrary(ordinarySource, output, adapter), /TEXTURE_LINK_FORBIDDEN/);
  await assert.rejects(stat(output), { code: 'ENOENT' });
  const ready = await imported('linked-package');
  const movedTextures = join(work, 'package-textures-target');
  await rename(join(ready.output, 'textures'), movedTextures);
  await symlink(movedTextures, join(ready.output, 'textures'), type);
  await assert.rejects(verifyTexturePackage(ready.output, adapter), /TEXTURE_LINK_FORBIDDEN/);
});

test('search groups visual variants, resolves Chinese aliases, excludes demo by default, and has no arbitrary fallback', async () => {
  const { library } = await imported('retrieval');
  const result = searchTextures(library, '设置');
  assert.equal(result.length, 1);
  assert.equal(result[0].family, 'icon.settings');
  assert.equal(result[0].variants.length, 2);
  assert.deepEqual(result[0].variants.map((variant) => variant.style).sort(), ['default', 'filled']);
  assert.equal(searchTextures(library, '音量')[0].family, 'icon.speaker');
  assert.deepEqual(searchTextures(library, 'dragon inventory'), []);
  assert.deepEqual(searchTextures(library, 'presentation-only'), []);
  assert.equal(searchTextures(library, 'presentation-only', { category: 'demo' })[0].category, 'demo');
  assert.deepEqual(searchTextures(library, '设置', { category: 'border' }), []);
  assert.throws(() => searchTextures(library, ''), /TEXTURE_QUERY/);
  assert.throws(() => searchTextures(library, 'x'.repeat(513)), /TEXTURE_QUERY/);
  assert.throws(() => searchTextures(library, '设置\n'), /TEXTURE_QUERY/);
  assert.throws(() => searchTextures(library, '设置', { category: 'invalid' }), /TEXTURE_CATEGORY/);
});

test('output publication uses a new directory and refuses to overwrite an existing package', async () => {
  const { source, output } = await imported('no-overwrite');
  const before = await readFile(join(output, 'texture-library.json'));
  await assert.rejects(importTextureLibrary(source, output, adapter), /OUTPUT_EXISTS/);
  assert.deepEqual(await readFile(join(output, 'texture-library.json')), before);
  await verifyTexturePackage(output, adapter);
});

test('missing metadata remains explicit and unsupported source formats fail before publication', async () => {
  const source = await sourceFixture('no-meta', [['Icon/Settings.png', pixels(0)]], false);
  const [input] = await collectTextureSources(source, adapter);
  assert.equal(input.record.source.metaSha256, null);
  assert.equal(input.record.unity.guid, null);
  assert.equal(input.record.unity.nineSlice, 'unknown');
  assert.ok(input.record.unity.issues.includes('missing:TextureImporter'));
  await writeFile(join(source, 'unsupported.svg'), '<svg/>');
  const output = join(work, 'unsupported-output');
  await assert.rejects(importTextureLibrary(source, output, adapter), /TEXTURE_SOURCE_FORMAT_UNSUPPORTED/);
  await assert.rejects(stat(output), { code: 'ENOENT' });
});
