import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, lstatSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildFixtureFiles } from '../scripts/fixture-source.mjs';
import { encodeFixturePng, inspectPng } from '../src/png.mjs';
import { validateBundle, validateDocument, normalizeSignature, signatureAt, SIGNATURES } from '../src/index.mjs';
import { sha256 } from '../src/validate.mjs';

const harnessRoot = fileURLToPath(new URL('..', import.meta.url));
const temporaryRoot = mkdtempSync(join(tmpdir(), 'scene-kit-contracts-'));
const tempBase = resolve(tmpdir());
after(() => {
  const resolved = resolve(temporaryRoot);
  assert.ok(resolved.startsWith(`${tempBase}${sep}scene-kit-contracts-`));
  rmSync(resolved, { recursive: true });
});
let sequence = 0;
const original = buildFixtureFiles();
const text = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

function fixture(mutate = () => {}) {
  const files = new Map([...original].map(([name, bytes]) => [name, Buffer.from(bytes)]));
  const documents = new Map([...files].filter(([name]) => name.endsWith('.json')).map(([name, bytes]) => [name, JSON.parse(bytes)]));
  mutate(documents, files);
  // A test producer rebinds the mutated document hashes. It does not fabricate acceptance.
  const kit = documents.get('kit.json');
  for (const [name, document] of documents) if (name !== 'kit.json') files.set(name, text(document));
  for (const ref of [kit.files.catalog, kit.files.rules, kit.files.presets, kit.files.maps.default, kit.files.maps.inspection]) {
    if (files.has(ref.path)) ref.sha256 = sha256(files.get(ref.path));
  }
  files.set('kit.json', text(kit));
  const root = join(temporaryRoot, `fixture-${sequence++}`);
  mkdirSync(root);
  for (const [name, bytes] of files) {
    const target = join(root, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes, { flag: 'wx' });
  }
  return root;
}
function rejected(mutate, code, path) {
  const result = validateBundle(fixture(mutate));
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.errors[0].code, code, JSON.stringify(result));
  if (path) assert.equal(result.errors[0].path, path);
  assert.equal(result.generationCalls, 0);
  return result;
}

test('all neighbor configurations retain cardinal bits and normalize to 47 idempotent roles', () => {
  const independentRoles = [0, 1, 4, 5, 7, 16, 17, 20, 21, 23, 28, 29, 31, 64, 65, 68, 69, 71, 80, 81, 84, 85, 87, 92, 93, 95, 112, 113, 116, 117, 119, 124, 125, 127, 193, 197, 199, 209, 213, 215, 221, 223, 241, 245, 247, 253, 255];
  assert.deepEqual(SIGNATURES, independentRoles);
  for (let mask = 0; mask < 256; mask++) {
    const signature = normalizeSignature(mask);
    assert.equal(signature & 85, mask & 85);
    assert.equal(normalizeSignature(signature), signature);
  }
  for (const invalid of [-1, 256, 0.5, NaN, '7']) assert.throws(() => normalizeSignature(invalid), RangeError);
});

test('isolated, horizontal, vertical and diagonal-only cells have distinct intended geometry', () => {
  const cells = new Map([['0,0', 'a'], ['-1,0', 'a'], ['1,0', 'a'], ['1,-1', 'a']]);
  assert.equal(signatureAt(cells, 0, 0), 68);
  cells.set('0,-1', 'a');
  assert.equal(signatureAt(cells, 0, 0), 71);
  assert.equal(signatureAt(cells, 20, 20), null);
  assert.equal(signatureAt(new Map([['0,0', 'a'], ['1,1', 'a']]), 0, 0), 0);
  assert.equal(signatureAt(new Map([['0,0', 'a'], ['0,-1', 'a'], ['0,1', 'a']]), 0, 0), 17);
});

test('generated fixture is valid and inspection demonstrates all 47 roles', () => {
  const result = validateBundle(fixture());
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.moduleCount, 49);
  assert.equal(result.terrainRoleCount, 47);
  assert.equal(result.presetCount, 2);
  assert.equal(result.maps[0].occupiedCells, 99);
  assert.equal(result.maps[0].visualInstances, 4);
  assert.equal(result.maps[1].occupiedCells, 235);
  assert.equal(result.maps[1].inspectionCases, 47);
  assert.deepEqual(result.maps[1].signatures, SIGNATURES);
  assert.equal(result.visualAcceptance, 'not-assessed');
});

test('read-only validation leaves bundle bytes and timestamps unchanged', () => {
  const root = fixture();
  const before = [...original.keys()].map(name => [name, readFileSync(join(root, name)), lstatSync(join(root, name)).mtimeMs]);
  assert.equal(validateBundle(root).ok, true);
  assert.equal(validateBundle(root).ok, true);
  for (const [name, bytes, time] of before) {
    assert.ok(readFileSync(join(root, name)).equals(bytes));
    assert.equal(lstatSync(join(root, name)).mtimeMs, time);
  }
});

const invalidCases = [
  ['unknown version', docs => { docs.get('kit.json').format = 'ai_scene_kit_v999'; }, 'SCHEMA_CONST', '/format'],
  ['private provider field', docs => { docs.get('kit.json').provider = {}; }, 'SCHEMA_PROPERTY', '/provider'],
  ['duplicate asset ID', docs => { docs.get('catalog.json').modules[1].assetId = docs.get('catalog.json').modules[0].assetId; }, 'DUPLICATE_ID', '/modules/1/assetId'],
  ['wrong kit revision', docs => { docs.get('presets.json').kitRef.revision = 'wrong'; }, 'KIT_REVISION_MISMATCH', '/kitRef'],
  ['missing role', docs => { docs.get('rules.json').entries.pop(); }, 'SCHEMA_ITEMS', '/entries'],
  ['duplicate role', docs => { docs.get('rules.json').entries[1].signature = 0; }, 'SIGNATURE_DUPLICATE', '/entries/1/signature'],
  ['noncanonical role', docs => { docs.get('rules.json').entries[0].signature = 2; }, 'SIGNATURE_NONCANONICAL', '/entries/0/signature'],
  ['missing terrain asset', docs => { docs.get('rules.json').entries[0].variantAssetIds = ['not-present']; }, 'TERRAIN_ASSET_REFERENCE', '/entries/0/variantAssetIds/0'],
  ['same artwork in different roles', docs => { docs.get('rules.json').entries[1].variantAssetIds = ['terrain-000']; }, 'TERRAIN_ROLE_REUSED', '/entries/1/variantAssetIds/0'],
  ['PNG declared size mismatch', docs => { docs.get('catalog.json').modules[0].pixelSize.width = 63; }, 'PNG_DIMENSIONS', '/modules/0/pixelSize'],
  ['PNG digest mismatch', docs => { docs.get('catalog.json').modules[0].source.sha256 = '0'.repeat(64); }, 'CHECKSUM_MISMATCH', '/modules/0/source/sha256'],
  ['PNG byte count mismatch', docs => { docs.get('catalog.json').modules[0].source.byteLength++; }, 'BYTE_LENGTH_MISMATCH', '/modules/0/source/byteLength'],
  ['oversized terrain footprint', docs => { docs.get('catalog.json').modules[0].footprint.columns = 2; }, 'TERRAIN_GEOMETRY', '/modules/0'],
  ['terrain anchor clips its core', docs => { docs.get('catalog.json').modules[0].anchorPx.x = 1; }, 'TERRAIN_CORE_BOUNDS', '/modules/0'],
  ['repeat on ordinary module', docs => { docs.get('catalog.json').modules[0].repeatAxis = 'x'; }, 'REPEAT_AXIS', '/modules/0/repeatAxis'],
  ['preset direct cycle', docs => { docs.get('presets.json').presets[0].assemblies.push({ instanceId: 'cycle', presetId: 'platform.small', column: 0, row: 0 }); }, 'PRESET_CYCLE', '/presets'],
  ['preset indirect cycle', docs => { docs.get('presets.json').presets[0].assemblies.push({ instanceId: 'cycle', presetId: 'platform.pair', column: 0, row: 0 }); }, 'PRESET_CYCLE', '/presets'],
  ['preset overlap', docs => { docs.get('presets.json').presets[1].assemblies[1].column = 0; docs.get('presets.json').presets[1].assemblies[1].row = 0; }, 'TERRAIN_OVERLAP', '/presets/1'],
  ['overlapping map run', docs => { const map = docs.get('maps/default.scene.json'); map.terrainRuns.push({ ...map.terrainRuns[0] }); }, 'TERRAIN_OVERLAP', '/terrainRuns/6'],
  ['out of map bounds', docs => { docs.get('maps/default.scene.json').terrainRuns[0].x = -1; }, 'TERRAIN_OUT_OF_BOUNDS', '/terrainRuns/0'],
  ['unsupported family', docs => { docs.get('maps/default.scene.json').terrainRuns[0].familyId = 'terrain.other'; }, 'FAMILY_UNSUPPORTED', '/terrainRuns/0'],
  ['unbound rules revision', docs => { docs.get('maps/default.scene.json').rulesRef.revision = 'wrong'; }, 'RULE_REVISION_MISMATCH', '/rulesRef'],
  ['bad assembly reference', docs => { docs.get('maps/default.scene.json').assemblyInstances[0].presetId = 'absent'; }, 'PRESET_MISSING', '/assemblyInstances/0/presetId'],
  ['out of map assembly', docs => { docs.get('maps/default.scene.json').assemblyInstances[0].column = 63; }, 'ASSEMBLY_OUT_OF_BOUNDS', '/assemblyInstances/0'],
  ['assembly duplicates a direct instance ID', docs => { docs.get('maps/default.scene.json').assemblyInstances[0].instanceId = 'marker.main'; }, 'DUPLICATE_ID', '/assemblyInstances/0/instanceId'],
  ['nonexistent layer', docs => { docs.get('maps/default.scene.json').instances[0].layerId = 'missing'; }, 'INSTANCE_LAYER_REFERENCE', '/instances/0/layerId'],
  ['terrain parallax drift', docs => { docs.get('maps/default.scene.json').layers[1].parallax.x = 0.5; }, 'TERRAIN_LAYER', '/layers'],
  ['inspection forged label', docs => { docs.get('maps/inspection.scene.json').inspectionCases[0].expectedSignature = 1; }, 'INSPECTION_SIGNATURE', '/inspectionCases/0'],
  ['inspection coverage missing', docs => { docs.get('maps/inspection.scene.json').inspectionCases.pop(); }, 'INSPECTION_COVERAGE', '/inspectionCases'],
  ['inspection reused center', docs => { docs.get('maps/inspection.scene.json').inspectionCases[1].cell = { ...docs.get('maps/inspection.scene.json').inspectionCases[0].cell }; }, 'INSPECTION_DUPLICATE', '/inspectionCases/1/cell'],
  ['authoring cannot embed compiled terrain', docs => { docs.get('maps/default.scene.json').compiledTiles = []; }, 'SCHEMA_PROPERTY', '/compiledTiles'],
  ['path traversal', docs => { docs.get('kit.json').files.catalog.path = '../catalog.json'; }, 'SCHEMA_PATTERN', '/files/catalog/path'],
  ['absolute host path', docs => { docs.get('kit.json').files.catalog.path = 'C:/private/catalog.json'; }, 'SCHEMA_PATTERN', '/files/catalog/path'],
  ['identifier with trailing newline', docs => { docs.get('kit.json').kitId += '\n'; }, 'SCHEMA_PATTERN', '/kitId'],
  ['file path with trailing newline', docs => { docs.get('kit.json').files.catalog.path += '\n'; }, 'SCHEMA_PATTERN', '/files/catalog/path'],
];
for (const [name, mutate, code, path] of invalidCases) test(`rejects ${name}`, () => rejected(mutate, code, path));

test('fractional source-pixel grid is rejected rather than silently rounded', () => rejected(docs => {
  docs.get('kit.json').grid.width = 63;
  docs.get('kit.json').pixelsPerUnit.denominator = 2;
}, 'GRID_PIXEL_ALIGNMENT', '/pixelsPerUnit'));

test('grid size is data, not a hard-coded 64-unit assumption', () => {
  const root = fixture(docs => {
    const kit = docs.get('kit.json'); kit.grid.width = 32; kit.grid.height = 32; kit.pixelsPerUnit.numerator = 2;
    for (const map of [docs.get('maps/default.scene.json'), docs.get('maps/inspection.scene.json')]) {
      for (const instance of map.instances) { instance.x /= 2; instance.y /= 2; }
      map.defaultCamera.center.x /= 2; map.defaultCamera.center.y /= 2;
    }
    for (const preset of docs.get('presets.json').presets) for (const instance of preset.instances) { instance.x /= 2; instance.y /= 2; }
  });
  const result = validateBundle(root);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.maps[0].occupiedCells, 99);
});

test('PNG decompression, CRC and zero-alpha RGB are checked', () => {
  const data = Buffer.from([0, 0, 0, 0, 20, 30, 40, 255]);
  const png = encodeFixturePng(2, 1, data);
  assert.deepEqual(inspectPng(png), { width: 2, height: 1, transparentPixels: 1, nonzeroAlphaPixels: 1, channels: 4 });
  const corrupt = Buffer.from(png); corrupt[45] ^= 1;
  assert.throws(() => inspectPng(corrupt));
  assert.throws(() => inspectPng(png.subarray(0, png.length - 1)));
  assert.throws(() => inspectPng(encodeFixturePng(1, 1, Buffer.from([1, 0, 0, 0]))), /Zero-alpha/);
});

test('opaque foreground and empty art are not accepted', () => {
  for (const [rgbaValue, code] of [[255, 'ALPHA_REQUIRED'], [0, 'PNG_EMPTY']]) rejected((docs, files) => {
    const module = docs.get('catalog.json').modules.find(item => item.kind === 'environment');
    const bytes = encodeFixturePng(64, 64, Buffer.alloc(64 * 64 * 4, rgbaValue));
    files.set(module.source.path, bytes);
    module.source.byteLength = bytes.length; module.source.sha256 = sha256(bytes);
  }, code);
});

test('tampered document bytes fail their outer reference without a rewrite', () => {
  const root = fixture();
  writeFileSync(join(root, 'rules.json'), Buffer.from(' '), { flag: 'a' });
  assert.equal(validateBundle(root).errors[0].code, 'CHECKSUM_MISMATCH');
});

test('symlink/junction artifact is rejected without following its target', context => {
  const root = fixture();
  const external = join(temporaryRoot, 'external-assets'); mkdirSync(external);
  try { symlinkSync(external, join(root, 'linked-assets'), 'junction'); }
  catch (error) {
    if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
    context.skip('The current OS/sandbox does not permit creating a link fixture');
    return;
  }
  const catalogPath = join(root, 'catalog.json');
  const catalog = JSON.parse(readFileSync(catalogPath)); catalog.modules[0].source.path = 'linked-assets/private.png';
  const catalogBytes = text(catalog); writeFileSync(catalogPath, catalogBytes);
  const kit = JSON.parse(readFileSync(join(root, 'kit.json'))); kit.files.catalog.sha256 = sha256(catalogBytes);
  writeFileSync(join(root, 'kit.json'), text(kit));
  assert.equal(validateBundle(root).errors[0].code, 'PATH_UNSAFE');
});

test('diagnostics omit the selected absolute root and command line exits truthfully', () => {
  const root = fixture(docs => { docs.get('kit.json').provider = {}; });
  const result = spawnSync(process.execPath, [join(harnessRoot, 'scripts/validate.mjs'), '--root', root], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).errors[0].code, 'SCHEMA_PROPERTY');
  assert.ok(!result.stdout.includes(temporaryRoot));
  assert.equal(validateDocument('missing', {}).at(0).code, 'FORMAT_UNSUPPORTED');
  assert.equal(validateDocument('__proto__', {}).at(0).code, 'FORMAT_UNSUPPORTED');
});

test('corrupt PNG cannot pass by updating its SHA-256 declaration', () => rejected((docs, files) => {
  const module = docs.get('catalog.json').modules[0];
  const bytes = Buffer.from(files.get(module.source.path)); bytes[45] ^= 1;
  files.set(module.source.path, bytes); module.source.sha256 = sha256(bytes);
}, 'PNG_INVALID'));

test('missing source, missing document and malformed JSON produce bounded diagnostics', () => {
  rejected(docs => { docs.get('catalog.json').modules[0].source.path = 'assets/missing.png'; }, 'FILE_UNAVAILABLE');
  rejected(docs => { docs.get('kit.json').files.rules.path = 'missing.json'; }, 'FILE_UNAVAILABLE');
  const root = fixture();
  const bytes = Buffer.from('{broken'); writeFileSync(join(root, 'rules.json'), bytes);
  const kit = JSON.parse(readFileSync(join(root, 'kit.json'))); kit.files.rules.sha256 = sha256(bytes);
  writeFileSync(join(root, 'kit.json'), text(kit));
  assert.equal(validateBundle(root).errors[0].code, 'JSON_INVALID');
});
