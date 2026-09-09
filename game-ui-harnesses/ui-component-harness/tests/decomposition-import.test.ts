import assert from 'node:assert/strict';
import test from 'node:test';
import { assertValidImportedDecomposition, DecompositionImportError, importDecompositionZip } from '../src/decomposition-import.ts';
import { forceZip64Stored, fixtureZip } from './helpers/decomposition-fixture.ts';

test('imports the upstream ZIP_STORED force-ZIP64 public draft layout and its optional QA receipt', async () => {
  const fixture = await fixtureZip({ includeQa: true });
  const imported = await importDecompositionZip(fixture.zip);
  assert.equal(imported.canvas.width, 1);
  assert.equal(imported.canvas.height, 1);
  assert.equal(imported.layers.length, 1);
  assert.equal(imported.layers[0]?.id, 'background');
  assert.equal(imported.layers[0]?.path, 'layers/background.png');
  assert.equal(imported.resources[0]?.mime, 'image/png');
  assert.equal(imported.preview.path, 'preview.png');
  assert.equal(imported.review.deliveryPolicy, 'unreviewed_draft');
  assert.equal(imported.review.humanVisualAcceptance, false);
  assert.equal(imported.review.automatedQa?.outcome, 'passed');
  assert.equal(Object.isFrozen(imported.scene), true);
  assert.equal(await assertValidImportedDecomposition(imported), imported);
});

test('rehashes public PNG bytes before an imported delivery crosses another runtime boundary', async () => {
  const imported = await importDecompositionZip((await fixtureZip()).zip);
  imported.resources[0]!.bytes[0] ^= 1;
  await assert.rejects(assertValidImportedDecomposition(imported), (error: unknown) => error instanceof DecompositionImportError && error.code === 'IMPORTED_RESOURCE_TAMPERED');
});

test('keeps the reviewed delivery claim bound to its reviewed scene evidence', async () => {
  const imported = await importDecompositionZip((await fixtureZip({ reviewed: true })).zip);
  assert.equal(imported.review.deliveryPolicy, 'reviewed');
  assert.equal(imported.review.humanVisualAcceptance, true);
});

test('rejects corruption in a stored member before trusting scene metadata', async () => {
  const fixture = await fixtureZip();
  const corrupted = new Uint8Array(fixture.zip);
  const pngStart = corrupted.findIndex((byte, index) => byte === 137 && corrupted[index + 1] === 80 && corrupted[index + 2] === 78 && corrupted[index + 3] === 71);
  assert.ok(pngStart >= 0);
  corrupted[pngStart + 20] ^= 1;
  await assert.rejects(importDecompositionZip(corrupted), (error: unknown) => error instanceof DecompositionImportError && error.code === 'ZIP_CRC_MISMATCH');
});

test('rejects closed-inventory traversal entries and compressed ZIP methods', async () => {
  const fixture = await fixtureZip();
  const traversal = forceZip64Stored([...fixture.members, { name: '../secret.txt', bytes: new Uint8Array([1]) }]);
  await assert.rejects(importDecompositionZip(traversal), (error: unknown) => error instanceof DecompositionImportError && error.code === 'ZIP_PATH_INVALID');

  const compressed = new Uint8Array(fixture.zip); const central = compressed.findIndex((byte, index) => byte === 80 && compressed[index + 1] === 75 && compressed[index + 2] === 1 && compressed[index + 3] === 2);
  assert.ok(central >= 0);
  compressed[8] = 8; compressed[central + 10] = 8;
  await assert.rejects(importDecompositionZip(compressed), (error: unknown) => error instanceof DecompositionImportError && error.code === 'ZIP_FEATURE_UNSUPPORTED');
});

test('requires the Python canonical delivery and QA digests after their receipt bindings are parsed', async () => {
  const fixture = await fixtureZip({ includeQa: true });
  const changedDelivery = fixture.members.map(member => member.name === 'delivery.json'
    ? { ...member, bytes: new TextEncoder().encode(new TextDecoder().decode(member.bytes).replace('"batch_digest": "cccc', '"batch_digest": "dddd')) }
    : member);
  await assert.rejects(importDecompositionZip(forceZip64Stored(changedDelivery)), (error: unknown) => error instanceof DecompositionImportError && error.code === 'DELIVERY_DIGEST');

  const changedQa = fixture.members.map(member => member.name === 'automated-visual-qa.json'
    ? { ...member, bytes: new TextEncoder().encode(new TextDecoder().decode(member.bytes).replace('"overall_score": 90', '"overall_score": 91')) }
    : member);
  await assert.rejects(importDecompositionZip(forceZip64Stored(changedQa)), (error: unknown) => error instanceof DecompositionImportError && error.code === 'QA_DIGEST');
});

test('rejects duplicate JSON keys, hidden fields, extra files and mislabeled review receipts', async () => {
  const fixture = await fixtureZip();
  const changeJson = (name: string, change: (text: string) => string) => forceZip64Stored(fixture.members.map(member => member.name === name
    ? { ...member, bytes: new TextEncoder().encode(change(new TextDecoder().decode(member.bytes))) } : member));
  await assert.rejects(importDecompositionZip(changeJson('scene.json', text => text.replace('{', '{"kind":"duplicate",'))), /DUPLICATE_JSON_KEY/);
  await assert.rejects(importDecompositionZip(changeJson('scene.json', text => text.replace('{', '{"__proto__":{},'))), /SCENE_FIELDS/);
  await assert.rejects(importDecompositionZip(forceZip64Stored([...fixture.members, { name: 'credentials.json', bytes: new Uint8Array([1]) }])));
  await assert.rejects(importDecompositionZip(changeJson('delivery.json', text => text.replace('"human_visual_acceptance": false', '"human_visual_acceptance": true'))), /DELIVERY_BINDING/);
});

test('import snapshots archive bytes and rejects fabricated import objects and mutated previews', async () => {
  const fixture = await fixtureZip(), source = new Uint8Array(fixture.zip);
  const pending = importDecompositionZip(source); source.fill(0);
  const imported = await pending;
  await assertValidImportedDecomposition(imported);
  await assert.rejects(assertValidImportedDecomposition(structuredClone(imported)), /IMPORTED_DECOMPOSITION_NOT_VALIDATED/);
  imported.preview.bytes[0] ^= 1;
  await assert.rejects(assertValidImportedDecomposition(imported), /IMPORTED_PREVIEW_TAMPERED/);
});
