import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { Texture } from 'pixi.js';
import { prepareCandidate } from './helpers/candidate.mjs';
import * as api from '../src/generation/index.mjs';
import { loadSceneKit, readMap, compileMap, createEditor, exportScene, openSceneExport, validateBundle, validateDocument } from '../src/index.mjs';
import { createSceneView, loadTerrainMaterial } from '../src/pixi/scene-view.mjs';
import { hash } from '../src/generation/common.mjs';
import { mountSceneKit } from '../examples/consume-scene.mjs';
import { Container } from 'pixi.js';

test('candidate packages all coordinate phases and curve materials with an editable mixed default and exact export replay', async t => {
  const c = prepareCandidate(t), before = api.inspectWorkflow(c.root), bundle = c.build();
  assert.deepEqual(api.inspectWorkflow(c.root), before); assert.equal(bundle.productionKit, false); assert.equal(bundle.visualAcceptance, 'not-assessed');
  assert.equal(api.verifySceneCandidate(c.root, c.kit, c.candidateOptions, c.terrainRoots, c.out).status, 'deterministic-proof-valid');
  const kitRoot = join(c.out, 'kit'), report = validateBundle(kitRoot); assert.equal(report.ok, true, JSON.stringify(report));
  assert.equal(report.moduleCount, 754); assert.equal(report.presetCount, 5);
  const kit = loadSceneKit(kitRoot), map = readMap(kit), scene = compileMap(kit, map);
  assert.equal(map.format, 'ai_scene_document_v3'); assert.equal(scene.format, 'ai_scene_compiled_v4');
  assert.equal(scene.counts.terrainNodes, 107); assert.equal(scene.mixedTerrains.length, 1); assert.equal(map.terrainConnections.length, 2);
  assert.equal(scene.terrainMaterial.selection, 'world-cell-4x4-phase-order-v1');
  for (const node of scene.layers.flatMap(layer => layer.nodes).filter(node => node.cell)) {
    const phase = ((node.cell.y % 4 + 4) % 4) * 4 + ((node.cell.x % 4 + 4) % 4);
    assert.equal(node.assetId, `p${phase}-blob-${String(node.signature).padStart(3, '0')}`);
    assert.equal(hash(readFileSync(join(kitRoot, node.source.path))), node.source.sha256);
  }
  const changed = structuredClone(map); changed.seed = 'different.seed'; changed.bounds.width = 80;
  assert.deepEqual(compileMap(kit, changed).layers.flatMap(layer => layer.nodes).map(node => node.assetId), scene.layers.flatMap(layer => layer.nodes).map(node => node.assetId));
  const negative = structuredClone(map); negative.bounds.x = -4; negative.bounds.width = 68;
  negative.terrainRuns.push({ x: -4, y: 7, length: 2, familyId: 'terrain.primary' });
  const negativeNodes = compileMap(kit, negative).layers.flatMap(layer => layer.nodes).filter(node => node.cell?.x < 0);
  assert.ok(negativeNodes.find(node => node.cell.x === -4).assetId.startsWith('p12-'));
  assert.ok(negativeNodes.find(node => node.cell.x === -3).assetId.startsWith('p13-'));
  const editor = createEditor(kit, map), initial = editor.serialize();
  editor.execute([{ type: 'paint-cells', familyId: 'terrain.primary', cells: [{ x: 60, y: 1 }] }]);
  assert.equal(editor.history().undoDepth, 1); editor.undo(); assert.equal(editor.serialize(), initial);
  const exported = join(c.parent, 'export'); assert.equal(exportScene(kit, map, exported).status, 'export-integrity-verified');
  const restored = openSceneExport(exported); assert.deepEqual(restored.compiled, scene); assert.deepEqual(restored.document, editor.getDocument());
  for (const kind of ['body', 'cap']) assert.deepEqual(readFileSync(join(exported, 'kit', scene.terrainMaterial[kind].source.path)),
    readFileSync(join(kitRoot, scene.terrainMaterial[kind].source.path)));
  const view = createSceneView({ resolveTexture: () => Texture.WHITE }); assert.throws(() => view.update(scene), /material is unavailable/); view.destroy();
  const textured = createSceneView({ resolveTexture: () => Texture.WHITE, resolveCurveMaterial: () => ({ body: Texture.WHITE, cap: Texture.WHITE }) });
  textured.update(scene); assert.ok(textured.root.children.flatMap(layer => layer.children).some(node => node.label.endsWith('/body'))); textured.destroy();
  const events = new Map(), world = new Container(), viewport = { center: scene.defaultCamera.center, getVisibleBounds: () => ({ x: 0, y: 0, width: 1024, height: 576 }),
    on(name, callback) { events.set(name, callback); }, off(name, callback) { assert.equal(events.get(name), callback); events.delete(name); } };
  const mounted = await mountSceneKit({ scene, world, viewport, loadSourceTexture: async () => Texture.WHITE });
  assert.equal(world.children.length, 1); assert.equal(events.size, 2); mounted.dispose(); assert.equal(events.size, 0); assert.equal(world.children.length, 0); world.destroy();
  // v1 is still closed; a caller cannot sneak new sampler/phase behavior into it.
  const manifest = JSON.parse(readFileSync(join(kitRoot, 'kit.json')));
  assert.ok(validateDocument('ai_scene_kit_v1', { ...manifest, format: 'ai_scene_kit_v1' }).length);
  const broken = join(c.parent, 'corrupt'); cpSync(kitRoot, broken, { recursive: true });
  writeFileSync(join(broken, manifest.terrainAppearance.body.source.path), Buffer.alloc(10)); assert.equal(validateBundle(broken).ok, false);
  const badRulesRoot = join(c.parent, 'bad-rules'); cpSync(kitRoot, badRulesRoot, { recursive: true });
  const rules = JSON.parse(readFileSync(join(badRulesRoot, manifest.files.rules.path))); rules.entries[0].variantAssetIds.pop();
  const rulesBytes = Buffer.from(JSON.stringify(rules)); writeFileSync(join(badRulesRoot, manifest.files.rules.path), rulesBytes);
  manifest.files.rules.sha256 = hash(rulesBytes); writeFileSync(join(badRulesRoot, 'kit.json'), JSON.stringify(manifest));
  assert.ok(validateBundle(badRulesRoot).errors.some(e => e.code === 'APPEARANCE_PHASES'));
  assert.throws(() => api.buildSceneCandidate(c.root, c.kit, { ...c.candidateOptions, candidateId: 'a'.repeat(90) }, c.terrainRoots, join(c.parent, 'invalid')));
  assert.equal(existsSync(join(c.parent, 'invalid')), false);
});

test('material loader uses the same body/cap samplers for Studio and external consumers and rejects missing sources', async () => {
  const fields = { body: { source: { path: 'body.png' } }, cap: { source: { path: 'cap.png' } } }, calls = [];
  const material = await loadTerrainMaterial(fields, async (field, kind) => { calls.push([field.source.path, kind]); return { source: { style: {} } }; });
  assert.deepEqual(calls, [['body.png', 'body'], ['cap.png', 'cap']]);
  assert.equal(material.body.source.style.addressModeV, 'repeat'); assert.equal(material.cap.source.style.addressModeV, 'clamp-to-edge');
  assert.equal(material.body.source.scaleMode, 'linear'); assert.equal(material.cap.source.style.addressModeU, 'repeat');
  assert.equal(await loadTerrainMaterial(null, () => { throw new Error(); }), null);
  await assert.rejects(loadTerrainMaterial({ body: {} }, async () => null));
});
