import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadSceneKit, readMap, compileMap, createEditor, saveMap, loadMap, exportScene, openSceneExport, validateBundle } from '../src/index.mjs';
import { canonicalJson } from '../src/document.mjs';
import { sha256 } from '../src/validate.mjs';
import { buildFixtureFiles } from '../scripts/fixture-source.mjs';

const harness = fileURLToPath(new URL('..', import.meta.url));
const sourceRoot = join(harness, 'tests/fixtures/synthetic');
const kit = loadSceneKit(sourceRoot);
const temporaryRoot = mkdtempSync(join(tmpdir(), 'scene-kit-editor-'));
let counter = 0;
const target = suffix => join(temporaryRoot, `${counter++}-${suffix}`);
after(() => {
  assert.ok(resolve(temporaryRoot).startsWith(`${resolve(tmpdir())}${sep}scene-kit-editor-`));
  rmSync(temporaryRoot, { recursive: true });
});
const encoded = data => Buffer.from(`${canonicalJson(data, true)}\n`);
function fails(operation, code) {
  assert.throws(operation, error => error.errors?.[0]?.code === code, `Expected ${code}`);
}
function smallMap(runs = [{ x: 0, y: 0, length: 2, familyId: 'terrain.primary' }]) {
  return { ...readMap(kit), bounds: { x: -2, y: -2, width: 8, height: 8 }, terrainRuns: runs,
    instances: [], assemblyInstances: [], defaultCamera: { center: { x: 64, y: 64 }, viewport: { width: 128, height: 128 }, scale: 1 } };
}
function customKit(mutate) {
  const files = buildFixtureFiles();
  const documents = new Map([...files].filter(([name]) => name.endsWith('.json')).map(([name, bytes]) => [name, JSON.parse(bytes)]));
  mutate(documents, files);
  for (const [name, data] of documents) if (name !== 'kit.json') files.set(name, encoded(data));
  const entry = documents.get('kit.json');
  for (const file of [entry.files.catalog, entry.files.rules, entry.files.presets, entry.files.maps.default, entry.files.maps.inspection]) file.sha256 = sha256(files.get(file.path));
  files.set('kit.json', encoded(entry));
  const root = target('kit'); mkdirSync(root);
  for (const [name, bytes] of files) { const path = join(root, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); }
  return { root, handle: loadSceneKit(root), files };
}
const allNodes = scene => scene.layers.flatMap(layer => layer.nodes);
const terrain = scene => allNodes(scene).filter(node => node.cell);
const appearance = scene => allNodes(scene).map(({ assetId, layerId, position, size }) => ({ assetId, layerId, position, size }))
  .sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));

test('opaque handles and returned maps/scenes cannot mutate the verified source snapshot', () => {
  assert.throws(() => { kit.revision = 'changed'; }, TypeError);
  const map = readMap(kit); map.terrainRuns = [];
  assert.ok(readMap(kit).terrainRuns.length > 0);
  fails(() => compileMap({ ...kit }, readMap(kit)), 'KIT_HANDLE');
  const scene = compileMap(kit, readMap(kit));
  assert.throws(() => { scene.layers[1].nodes.length = 0; }, TypeError);
  assert.ok(!canonicalJson(scene).includes(sourceRoot));
  assert.equal(scene.visualAcceptance, 'not-assessed');
});

test('both delivered maps compile deterministically with source identity and topology coverage', () => {
  for (const [role, count] of [['default', 99], ['inspection', 235]]) {
    const map = readMap(kit, role), first = compileMap(kit, map), second = compileMap(kit, map);
    assert.deepEqual(first, second);
    assert.equal(first.counts.terrainNodes, count);
    assert.equal(first.source.kitSha256, kit.bundleSha256);
    assert.equal(sha256(canonicalJson(Object.fromEntries(Object.entries(first).filter(([key]) => key !== 'contentSha256')))), first.contentSha256);
  }
  const nodes = terrain(compileMap(kit, readMap(kit, 'inspection')));
  assert.equal(new Set(nodes.map(node => node.signature)).size, 47);
  assert.equal(compileMap(kit, readMap(kit)).counts.visualNodes, 4);
});

test('canonical ordering and split adjacent author runs do not change compiled output', () => {
  const map = readMap(kit), changed = structuredClone(map);
  const first = changed.terrainRuns.shift();
  changed.terrainRuns.push({ ...first, length: 1 }, { ...first, x: first.x + 1, length: first.length - 1 });
  changed.layers.reverse(); changed.terrainRuns.reverse(); changed.instances.reverse();
  assert.deepEqual(compileMap(kit, changed), compileMap(kit, map));
});

test('collision edges merge collinear sides and omit internal edges without reading artwork alpha', () => {
  const rectangle = compileMap(kit, smallMap());
  assert.equal(rectangle.collisionSuggestions.boundarySegments.length, 4);
  assert.deepEqual(rectangle.collisionSuggestions.standingSurfaces[0], {
    direction: 'n', normal: { x: 0, y: -1 }, from: { x: 0, y: 0 }, to: { x: 128, y: 0 },
  });
  const lShape = compileMap(kit, smallMap([
    { x: 0, y: 0, length: 2, familyId: 'terrain.primary' }, { x: 0, y: 1, length: 1, familyId: 'terrain.primary' },
  ]));
  assert.equal(lShape.collisionSuggestions.boundarySegments.length, 6);
  const diagonal = compileMap(kit, smallMap([
    { x: 0, y: 0, length: 1, familyId: 'terrain.primary' }, { x: 1, y: 1, length: 1, familyId: 'terrain.primary' },
  ]));
  assert.equal(diagonal.collisionSuggestions.boundarySegments.length, 8);
  assert.equal(diagonal.collisionSuggestions.standingSurfaces.length, 2);
});

test('holes retain inner collision boundaries and negative cells keep their world coordinates', () => {
  const map = smallMap([
    { x: -1, y: -1, length: 3, familyId: 'terrain.primary' },
    { x: -1, y: 0, length: 1, familyId: 'terrain.primary' }, { x: 1, y: 0, length: 1, familyId: 'terrain.primary' },
    { x: -1, y: 1, length: 3, familyId: 'terrain.primary' },
  ]);
  const scene = compileMap(kit, map);
  assert.equal(scene.collisionSuggestions.boundarySegments.length, 8);
  assert.equal(scene.collisionSuggestions.standingSurfaces.length, 2);
  assert.deepEqual(terrain(scene).find(node => node.cell.x === -1 && node.cell.y === -1).logicalAnchor, { x: -64, y: -64 });
});

test('variant selection is repeatable and unrelated edits do not reshuffle distant cells', () => {
  const { handle } = customKit(docs => {
    const module = structuredClone(docs.get('catalog.json').modules.find(item => item.assetId === 'terrain-000'));
    module.assetId = 'terrain-000-alt'; docs.get('catalog.json').modules.push(module);
    docs.get('rules.json').entries.find(entry => entry.signature === 0).variantAssetIds.push(module.assetId);
  });
  const map = smallMap([{ x: 0, y: 0, length: 1, familyId: 'terrain.primary' }]);
  const seen = new Set();
  for (let index = 0; index < 20; index++) { map.seed = `seed-${index}`; seen.add(terrain(compileMap(handle, map))[0].assetId); }
  assert.equal(seen.size, 2);
  const editor = createEditor(handle, map), before = terrain(editor.getScene());
  editor.execute([{ type: 'paint-cells', familyId: 'terrain.primary', cells: [{ x: 4, y: 4 }] }]);
  assert.deepEqual(terrain(editor.getScene()).find(node => node.cell.x === 0), before[0]);
});

test('a brush gesture updates terrain, supports erase and is exactly one undo/redo operation', () => {
  const editor = createEditor(kit), before = editor.getScene();
  editor.execute([
    { type: 'paint-cells', familyId: 'terrain.primary', cells: [{ x: 30, y: 6 }, { x: 31, y: 6 }] },
    { type: 'erase-cells', cells: [{ x: 31, y: 6 }] },
  ]);
  const after = editor.getScene();
  assert.equal(after.counts.terrainNodes, 100);
  assert.equal(terrain(after).find(node => node.cell.x === 30 && node.cell.y === 6).signature, 0);
  assert.equal(editor.history().undoDepth, 1);
  editor.undo(); assert.deepEqual(editor.getScene(), before);
  editor.redo(); assert.deepEqual(editor.getScene(), after);
});

test('a failed multi-command gesture leaves author data, history and redo unchanged', () => {
  const editor = createEditor(kit);
  editor.execute([{ type: 'paint-cells', familyId: 'terrain.primary', cells: [{ x: 30, y: 6 }] }]); editor.undo();
  const data = editor.serialize(), history = editor.history();
  fails(() => editor.execute([
    { type: 'paint-cells', familyId: 'terrain.primary', cells: [{ x: 30, y: 6 }] },
    { type: 'paint-cells', familyId: 'terrain.primary', cells: [{ x: 64, y: 0 }] },
  ]), 'TERRAIN_OUT_OF_BOUNDS');
  assert.equal(editor.serialize(), data); assert.deepEqual(editor.history(), history);
  editor.execute([{ type: 'erase-cells', cells: [{ x: 30, y: 0 }] }]);
  assert.equal(editor.history().redoDepth, 1);
  editor.redo(); assert.equal(editor.getScene().counts.terrainNodes, 100);
});

test('new successful edit after undo clears redo and history capacity is explicit', () => {
  const editor = createEditor(kit, readMap(kit), { historyLimit: 2 });
  for (const x of [28, 29, 30]) editor.execute([{ type: 'paint-cells', familyId: 'terrain.primary', cells: [{ x, y: 0 }] }]);
  assert.equal(editor.history().undoDepth, 2); assert.equal(editor.history().historyTruncated, 1);
  editor.undo(); editor.execute([{ type: 'paint-cells', familyId: 'terrain.primary', cells: [{ x: 31, y: 0 }] }]);
  assert.equal(editor.history().redoDepth, 0);
});

test('assembly cells require explicit expansion; expansion preserves complete appearance and collision', () => {
  const editor = createEditor(kit), before = editor.getScene();
  fails(() => editor.execute([{ type: 'erase-cells', cells: [{ x: 50, y: 3 }] }]), 'ASSEMBLY_CELL_LOCKED');
  editor.execute([{ type: 'expand-assembly', instanceId: 'pair.main' }]);
  const expanded = editor.getScene(), expandedDoc = editor.getDocument();
  assert.equal(expandedDoc.assemblyInstances.length, 0);
  assert.equal(expandedDoc.instances.length, 4);
  assert.deepEqual(appearance(expanded), appearance(before));
  assert.deepEqual(expanded.collisionSuggestions, before.collisionSuggestions);
  editor.undo(); assert.deepEqual(editor.getScene(), before);
  editor.redo(); assert.deepEqual(editor.getDocument(), expandedDoc);
  editor.execute([{ type: 'erase-cells', cells: [{ x: 50, y: 3 }] }]);
  assert.equal(editor.getScene().counts.terrainNodes, 98);
});

test('assembly placement rejects overlap/out-of-bounds atomically and can be removed', () => {
  const editor = createEditor(kit);
  const at = { instanceId: 'added', presetId: 'platform.small', layerId: 'environment', column: 20, row: 0 };
  editor.execute([{ type: 'place-assembly', instance: at }]); assert.equal(editor.getScene().counts.terrainNodes, 103);
  const before = editor.serialize();
  fails(() => editor.execute([{ type: 'place-assembly', instance: { ...at, instanceId: 'overlap' } }]), 'TERRAIN_OVERLAP');
  fails(() => editor.execute([{ type: 'place-assembly', instance: { ...at, instanceId: 'outside', column: 63 } }]), 'ASSEMBLY_OUT_OF_BOUNDS');
  assert.equal(editor.serialize(), before);
  editor.execute([{ type: 'remove-assembly', instanceId: 'added' }]); assert.equal(editor.getScene().counts.terrainNodes, 99);
});

test('environment add/move/remove retains IDs and rejects terrain sprites or invalid layers', () => {
  const editor = createEditor(kit);
  const instance = { instanceId: 'copy', assetId: 'environment-marker', layerId: 'environment', x: 64, y: 64 };
  editor.execute([{ type: 'add-instance', instance }, { type: 'move-instance', instanceId: 'copy', x: 128, y: 128 }]);
  assert.equal(editor.getDocument().instances.find(item => item.instanceId === 'copy').x, 128);
  fails(() => editor.execute([{ type: 'add-instance', instance: { ...instance, instanceId: 'bad', assetId: 'terrain-000' } }]), 'INSTANCE_ASSET_REFERENCE');
  fails(() => editor.execute([{ type: 'add-instance', instance: { ...instance, instanceId: 'bad', layerId: 'terrain' } }]), 'INSTANCE_LAYER_REFERENCE');
  editor.execute([{ type: 'remove-instance', instanceId: 'copy' }]);
  assert.ok(!editor.getDocument().instances.some(item => item.instanceId === 'copy'));
});

test('bounds extend without translating existing content and cannot silently crop it', () => {
  const editor = createEditor(kit), before = allNodes(editor.getScene());
  fails(() => editor.execute([{ type: 'resize-bounds', bounds: { x: 0, y: 0, width: 10, height: 9 } }]), 'TERRAIN_OUT_OF_BOUNDS');
  editor.execute([{ type: 'resize-bounds', bounds: { x: -16, y: 0, width: 96, height: 9 } }]);
  assert.deepEqual(allNodes(editor.getScene()), before);
  editor.execute([{ type: 'paint-cells', familyId: 'terrain.primary', cells: [{ x: -10, y: 8 }, { x: 79, y: 8 }] }]);
  assert.equal(editor.getScene().counts.terrainNodes, 101);
});

test('empty draft maps can be edited, compiled, saved and reopened without becoming delivery maps', () => {
  const editor = createEditor(kit, smallMap([{ x: 0, y: 0, length: 1, familyId: 'terrain.primary' }]));
  editor.execute([{ type: 'erase-cells', cells: [{ x: 0, y: 0 }] }]);
  assert.equal(editor.getScene().counts.terrainNodes, 0);
  assert.deepEqual(editor.getScene().collisionSuggestions.boundarySegments, []);
  const file = target('empty.json'); saveMap(kit, editor.getDocument(), file);
  assert.deepEqual(compileMap(kit, loadMap(kit, file)), editor.getScene());
  editor.undo(); assert.equal(editor.getScene().counts.terrainNodes, 1);
});

test('inspection assertions remain enforced while editing instead of being silently discarded', () => {
  const editor = createEditor(kit, readMap(kit, 'inspection'));
  const data = editor.serialize();
  fails(() => editor.execute([{ type: 'erase-cells', cells: [{ x: 2, y: 2 }] }]), 'INSPECTION_SIGNATURE');
  assert.equal(editor.serialize(), data);
});

test('unknown command fields, unknown commands and non-integer cells fail without changes', () => {
  const editor = createEditor(kit), data = editor.serialize();
  fails(() => editor.execute([{ type: 'paint-cells', familyId: 'terrain.primary', cells: [], endpoint: 'unused' }]), 'COMMAND_SHAPE');
  fails(() => editor.execute([{ type: 'generate-art' }]), 'COMMAND_UNSUPPORTED');
  fails(() => editor.execute([{ type: 'erase-cells', cells: [{ x: 0.5, y: 0 }] }]), 'COMMAND_CELL');
  fails(() => editor.execute([{ type: 'move-instance', instanceId: 'absent', x: 0, y: 0 }]), 'INSTANCE_MISSING');
  assert.equal(editor.serialize(), data);
});

test('map save/open is canonical and fresh-only, and immutable kit files are not written', () => {
  const editor = createEditor(kit), file = target('map.json');
  editor.execute([{ type: 'expand-assembly', instanceId: 'pair.main' }, { type: 'paint-cells', familyId: 'terrain.primary', cells: [{ x: 30, y: 6 }] }]);
  saveMap(kit, editor.getDocument(), file);
  assert.deepEqual(compileMap(kit, loadMap(kit, file)), editor.getScene());
  const bytes = readFileSync(file);
  fails(() => saveMap(kit, readMap(kit), file), 'OUTPUT_EXISTS'); assert.ok(readFileSync(file).equals(bytes));
  const forbidden = join(sourceRoot, 'must-not-exist.json');
  fails(() => saveMap(kit, readMap(kit), forbidden), 'OUTPUT_OVERLAP'); assert.equal(existsSync(forbidden), false);
});

test('portable export keeps the original kit byte-for-byte and replays the edited author map', () => {
  const editor = createEditor(kit); editor.execute([{ type: 'paint-cells', familyId: 'terrain.primary', cells: [{ x: 30, y: 6 }] }]);
  const out = target('export'), report = exportScene(kit, editor.getDocument(), out);
  assert.equal(report.fileCount, 58); assert.equal(report.visualAcceptance, 'not-assessed');
  for (const [name, bytes] of buildFixtureFiles()) assert.ok(readFileSync(join(out, 'kit', name)).equals(bytes));
  const reopened = openSceneExport(out);
  assert.deepEqual(reopened.document, editor.getDocument()); assert.deepEqual(reopened.compiled, editor.getScene());
  assert.equal(reopened.compiled.counts.terrainNodes, 100);
  fails(() => exportScene(kit, editor.getDocument(), out), 'OUTPUT_EXISTS');
  assert.ok(!readFileSync(join(out, 'manifest.json'), 'utf8').includes(temporaryRoot));
});

test('export copies the verified snapshot, not source files changed after loading', () => {
  const { root, handle, files } = customKit(() => {});
  const path = 'assets/terrain-000.png'; writeFileSync(join(root, path), Buffer.from('corrupt'));
  assert.equal(validateBundle(root).ok, false);
  const out = target('snapshot-export'); exportScene(handle, readMap(handle), out);
  assert.ok(readFileSync(join(out, 'kit', path)).equals(files.get(path)));
  assert.equal(openSceneExport(out).handle.bundleSha256, handle.bundleSha256);
});

test('export import rejects unlisted content and hash-rebound forged compiled coordinates', () => {
  const extra = target('extra'); exportScene(kit, readMap(kit), extra); writeFileSync(join(extra, 'private.txt'), 'extra');
  fails(() => openSceneExport(extra), 'EXPORT_INVENTORY');
  const out = target('tampered'); exportScene(kit, readMap(kit), out);
  const compiled = JSON.parse(readFileSync(join(out, 'scene.compiled.json')));
  compiled.layers.find(layer => layer.kind === 'terrain').nodes[0].position.x++;
  const bytes = encoded(compiled); writeFileSync(join(out, 'scene.compiled.json'), bytes);
  const manifest = JSON.parse(readFileSync(join(out, 'manifest.json')));
  manifest.compiledSha256 = sha256(bytes);
  const entry = manifest.files.find(item => item.path === 'scene.compiled.json'); entry.sha256 = sha256(bytes); entry.byteLength = bytes.length;
  writeFileSync(join(out, 'manifest.json'), encoded(manifest));
  fails(() => openSceneExport(out), 'COMPILED_REPLAY');
});

test('truncated and corrupt exports are rejected rather than treated as complete', () => {
  const out = target('incomplete'); mkdirSync(out);
  fails(() => openSceneExport(out), 'INPUT_UNAVAILABLE');
  const corrupt = target('corrupt-export'); exportScene(kit, readMap(kit), corrupt);
  writeFileSync(join(corrupt, 'scene.document.json'), '{}');
  fails(() => openSceneExport(corrupt), 'EXPORT_CHECKSUM');
});

test('CLI compile, edit and export verification work without leaking output paths', () => {
  const cli = join(harness, 'scripts/scene.mjs');
  const compileOut = target('compiled.json');
  const compiled = spawnSync(process.execPath, [cli, 'compile', '--root', sourceRoot, '--map', 'default', '--out', compileOut], { encoding: 'utf8' });
  assert.equal(compiled.status, 0, compiled.stderr); assert.equal(JSON.parse(compiled.stdout).counts.terrainNodes, 99);
  const commands = target('commands.json'); writeFileSync(commands, encoded([{ type: 'paint-cells', familyId: 'terrain.primary', cells: [{ x: 30, y: 6 }] }]));
  const mapOut = target('author.json');
  const edited = spawnSync(process.execPath, [cli, 'edit', '--root', sourceRoot, '--map', 'default', '--commands', commands, '--out', mapOut], { encoding: 'utf8' });
  assert.equal(edited.status, 0, edited.stderr); assert.equal(JSON.parse(edited.stdout).counts.terrainNodes, 100);
  assert.ok(!edited.stdout.includes(temporaryRoot));
  const out = target('cli-export');
  const exported = spawnSync(process.execPath, [cli, 'export', '--root', sourceRoot, '--document', mapOut, '--out', out], { encoding: 'utf8' });
  assert.equal(exported.status, 0, exported.stderr);
  const verified = spawnSync(process.execPath, [cli, 'verify-export', '--root', out], { encoding: 'utf8' });
  assert.equal(verified.status, 0, verified.stderr); assert.equal(JSON.parse(verified.stdout).counts.terrainNodes, 100);
  const invalid = spawnSync(process.execPath, [cli, 'compile', '--root', sourceRoot], { encoding: 'utf8' });
  assert.equal(invalid.status, 2);
});
