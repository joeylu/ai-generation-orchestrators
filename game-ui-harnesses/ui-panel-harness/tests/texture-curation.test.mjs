import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { curateTextureLibrary } from '../src/texture-curation.mjs';
import { importTextureLibrary, searchTextures, verifyTexturePackage } from '../src/texture-library.mjs';
import { redesignTextures } from '../src/texture-redesign.mjs';
import { digestBytes, digestJson } from '../src/canonical.mjs';
import { jsonFileBytes } from '../src/io.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(join(root, '.tmp'), { recursive: true });
const work = await mkdtemp(join(root, '.tmp', 'curation-'));
// Explicit doubles exercise selection/packaging. Actual raster verification is a separate local acceptance run.
const image = { width: 64, height: 64, channels: 4, alpha: { mode: 'opaque', transparentPixels: 0, opaquePixels: 4096,
  softPixels: 0, hiddenRgbPixels: 0, visibleBounds: { x: 0, y: 0, width: 64, height: 64 } } };
const adapter = {
  evidence: { name: 'fixture-double', version: '1' },
  analyze: async () => structuredClone(image), render: async svg => Buffer.from(svg),
  gallery: async items => Buffer.from(JSON.stringify(await Promise.all(items.map(async item => ({ label: item.label, sha256: await digestBytes(item.bytes) }))))),
};
const paths = [
  'Border/Flat/Square Filled.png', 'Border/Rounded/64px/Rounded Filled 64px.png', 'Border/Rounded/64px/Rounded Outline 64px - 1x.png',
  'Demo/Demo Welcome.png', 'Icon/Communication & Social/Discord.png', 'Icon/Others/Animation Icon Stuff/Lock Top.png',
  'Icon/Others/Panel Seperator.png', 'Icon/System/Lock.png', 'Icon/System/Settings.png', 'Icon/UI Elements/Slider.png', 'Shadow/Flat Shadow.png',
];
const source = join(work, 'source');
for (const path of paths) {
  const file = join(source, path); await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, `explicit-source-fixture:${path}`);
  await writeFile(`${file}.meta`, 'TextureImporter:\n  spriteMode: 1\n  spritePixelsToUnits: 100\n  spritePivot: {x: 0.5, y: 0.5}\n  spriteBorder: {x: 0, y: 0, z: 0, w: 0}\n  alphaIsTransparency: 1\n');
}
const intake = join(work, 'intake'), redraw = join(work, 'redraw');
await importTextureLibrary(source, intake, adapter);
const parent = await redesignTextures(intake, redraw, adapter);
async function fresh(name) {
  const output = join(work, name), index = await curateTextureLibrary(redraw, output, adapter);
  return { output, index };
}
async function rehash(output, index) {
  const { sha256: ignored, ...payload } = index; index.sha256 = await digestJson(payload);
  const bytes = jsonFileBytes(index); await writeFile(join(output, 'texture-catalog.json'), bytes);
  const manifest = JSON.parse(await readFile(join(output, 'delivery.json')));
  manifest.sha256 = index.sha256;
  Object.assign(manifest.files.find(file => file.path === 'texture-catalog.json'), { bytes: bytes.length, sha256: await digestBytes(bytes) });
  await writeFile(join(output, 'delivery.json'), jsonFileBytes(manifest));
}
async function physicalFiles(directory, prefix = '') {
  const files = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = `${prefix}${item.name}`;
    if (item.isDirectory()) files.push(...await physicalFiles(join(directory, item.name), `${path}/`)); else files.push(path);
  }
  return files.sort();
}

test('curated package removes excluded payloads and previews while preserving allowed bytes and archive provenance', async () => {
  const before = await readFile(join(redraw, 'texture-redesign.json'));
  const { output, index } = await fresh('complete');
  assert.equal(index.records.length, 8); assert.equal(index.exclusions.length, 3);
  assert.deepEqual(index.usageSummary, { icon: 2, shape: 2, effect: 1, 'layout-primitive': 2, 'animation-part': 1 });
  assert.equal(index.derivedFrom.sha256, parent.sha256);
  const verified = await verifyTexturePackage(output, adapter);
  assert.equal(verified.manifest.kind, 'curated');
  assert.deepEqual(await physicalFiles(output), ['delivery.json', ...verified.manifest.files.map(file => file.path)].sort());
  for (const original of parent.records) {
    const kept = index.records.find(record => record.id === original.id);
    for (const ref of [original.file, original.vector]) {
      if (kept) assert.deepEqual(await readFile(join(output, ref.path)), await readFile(join(redraw, ref.path)));
      else { assert(!verified.blobs.has(ref.path)); await assert.rejects(stat(join(output, ref.path)), { code: 'ENOENT' }); }
    }
  }
  for (const preview of index.previews) {
    const bytes = (await readFile(join(output, preview))).toString();
    assert(!/Discord|Slider|Demo Welcome/.test(bytes));
  }
  assert.deepEqual(await readFile(join(redraw, 'texture-redesign.json')), before);
  assert.equal(index.verification.nativeEngines, 'NOT_RUN');
});

test('generation search separates actionable icon semantics from internal assets and groups shape variants', async () => {
  const { index } = await fresh('search');
  assert.deepEqual(searchTextures(index, '锁定').map(result => result.family), ['icon.lock']);
  for (const query of ['滑条', 'Discord', '阴影', '圆角', '面板']) assert.deepEqual(searchTextures(index, query), []);
  assert.equal(searchTextures(index, '锁定', { role: 'animation-part' })[0].family, 'icon.part.lock-top');
  assert.equal(searchTextures(index, '面板', { role: 'layout-primitive' })[0].family, 'icon.panel-seperator');
  assert.equal(searchTextures(index, '阴影', { role: 'effect' })[0].category, 'shadow');
  const shapes = searchTextures(index, '圆角', { role: 'shape' });
  assert.equal(shapes.length, 1); assert.equal(shapes[0].variants.length, 2);
  assert.deepEqual(searchTextures(index, '滑条', { category: 'icon', role: 'icon' }), []);
  assert.throws(() => searchTextures(index, '锁定', { role: 'excluded' }), /TEXTURE_ROLE/);
  assert.throws(() => searchTextures(index, '锁定', { role: '' }), /TEXTURE_ROLE/);
});

test('rehashed role promotion, policy changes and incomplete exclusions fail verification', async () => {
  const mutations = [
    index => { index.records.find(record => record.usage.role === 'animation-part').usage.role = 'icon'; },
    index => { index.policy = { ...index.policy, version: 'future' }; },
    index => { index.exclusions.pop(); },
    index => { index.usageSummary.icon += 1; },
  ];
  for (const [i, mutate] of mutations.entries()) {
    const { output, index } = await fresh(`tamper-${i}`);
    mutate(index); await rehash(output, index);
    await assert.rejects(verifyTexturePackage(output, adapter), /TEXTURE_CURATION_(?:USAGE|POLICY|SELECTION|SUMMARY)/);
  }
});

test('excluded orphan attachments and copied archive preview pixels cannot enter a valid curated package', async () => {
  const { output, index } = await fresh('orphan');
  const rejected = parent.records.find(record => record.source.relativePath.endsWith('/Discord.png'));
  const bytes = await readFile(join(redraw, rejected.file.path));
  await writeFile(join(output, rejected.file.path), bytes);
  const manifest = JSON.parse(await readFile(join(output, 'delivery.json')));
  manifest.files.push(rejected.file); await writeFile(join(output, 'delivery.json'), jsonFileBytes(manifest));
  await assert.rejects(verifyTexturePackage(output, adapter), /TEXTURE_CURATION_FILES/);
  const second = await fresh('wrong-preview');
  const path = second.index.previews[0], wrong = Buffer.from('Discord demo preview');
  await writeFile(join(second.output, path), wrong);
  const delivery = JSON.parse(await readFile(join(second.output, 'delivery.json')));
  Object.assign(delivery.files.find(file => file.path === path), { bytes: wrong.length, sha256: await digestBytes(wrong) });
  await writeFile(join(second.output, 'delivery.json'), jsonFileBytes(delivery));
  await assert.rejects(verifyTexturePackage(second.output, adapter), /TEXTURE_CURATION_PREVIEW_MISMATCH/);
});

test('curation accepts only a full redesign, never overwrites, and confines output to this Harness', async () => {
  const { output } = await fresh('boundaries');
  await assert.rejects(curateTextureLibrary(redraw, output, adapter), /OUTPUT_EXISTS/);
  const rejected = join(work, 'not-created');
  await assert.rejects(curateTextureLibrary(intake, rejected, adapter), /TEXTURE_CURATION_REDRAW_REQUIRED/);
  await assert.rejects(curateTextureLibrary(output, rejected, adapter), /TEXTURE_CURATION_REDRAW_REQUIRED/);
  await assert.rejects(curateTextureLibrary(redraw, rejected, adapter, { id: '../outside' }), /TEXTURE_LIBRARY_ID/);
  await assert.rejects(curateTextureLibrary(redraw, join(root, '..', 'outside-curation'), adapter), /OUTPUT_OUTSIDE_HARNESS/);
  await assert.rejects(stat(rejected), { code: 'ENOENT' });
});
