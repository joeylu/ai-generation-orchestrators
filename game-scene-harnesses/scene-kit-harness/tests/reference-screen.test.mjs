import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { Texture } from 'pixi.js';
import { deriveReferenceField, referencePhaseAt } from '../src/terrain-proof/reference-field.mjs';
import { syntheticTerrainMaterial } from '../scripts/terrain-fixture.mjs';
import { inspectPng } from '../src/png.mjs';
import { hash, jsonBytes } from '../src/generation/common.mjs';
import { prepareReferenceScreen } from './helpers/reference-screen.mjs';
import * as api from '../src/generation/index.mjs';
import { loadSceneKit, readMap, compileMap, createEditor, exportScene, openSceneExport, validateBundle, validateDocument } from '../src/index.mjs';
import { createSceneView } from '../src/pixi/scene-view.mjs';

test('macro material keeps 47 roles and continuous boundaries across all 32 phases without modifying its source', () => {
  const raw = syntheticTerrainMaterial(), before = hash(raw), result = deriveReferenceField(raw);
  assert.equal(hash(raw), before); assert.equal(result.report.phaseCount, 32);
  assert.equal([...result.files.keys()].filter(path => path.startsWith('tiles/')).length, 1504);
  assert.ok(result.report.assessments.every(item => item.status === 'pass'));
  assert.equal(inspectPng(result.files.get('materials/body-field.png')).width, 505);
  assert.equal(referencePhaseAt(-1, -1), 31); assert.equal(referencePhaseAt(8, 4), 0);
  const field = inspectPng(result.files.get('materials/body-field.png'), { includePixels: true });
  for (let y = 0; y < 253; y++) assert.deepEqual(field.rgba.subarray(y * 505 * 4, y * 505 * 4 + 4), field.rgba.subarray((y * 505 + 504) * 4, (y * 505 + 505) * 4));
});

test('reference screen exports its macro terrain, geometry, styles and foreground as one portable editable kit', t => {
  const c = prepareReferenceScreen(t), before = api.inspectWorkflow(c.root), bundle = c.buildScreen();
  assert.deepEqual(api.inspectWorkflow(c.root), before); assert.equal(bundle.productionKit, false);
  assert.equal(api.verifySceneReferenceStudy(c.root, c.kit, c.screenOptions, c.terrainRoots, c.screenOut).status, 'deterministic-proof-valid');
  const kitRoot = join(c.screenOut, 'kit'), valid = validateBundle(kitRoot); assert.equal(valid.ok, true, JSON.stringify(valid)); assert.equal(valid.moduleCount, 1517);
  const kit = loadSceneKit(kitRoot), map = readMap(kit), scene = compileMap(kit, map);
  assert.equal(scene.format, 'ai_scene_compiled_v5'); assert.equal(scene.worldBounds.width, 1024);
  assert.equal(scene.counts.terrainNodes, 32); assert.equal(scene.mixedTerrains.length, 1); assert.equal(scene.counts.visualNodes, 11);
  assert.equal(scene.terrainMaterial.body.pixelSize.width, 505); assert.equal(scene.terrainMaterial.tint, 0xd4dfdf);
  assert.equal(scene.mixedTerrains[0].materialMapping.bodyPeriod.width, 512);
  const node = scene.layers.find(layer => layer.layerId === 'foreground-tree').nodes[0];
  assert.equal(node.renderStyle.tint, 0x365c68); assert.equal(node.size.width, node.source.pixelSize.width * 0.75);
  assert.equal(node.position.x, node.logicalAnchor.x - Math.round(node.source.pixelSize.width * 0.806) * 0.75);
  const foreground = scene.layers.find(layer => layer.layerId === 'foreground-canopy'); assert.equal(foreground.nodes.length, 2);
  const native = inspectPng(readFileSync(join(c.screenOut, 'source/trees-native.png')), { allowCabx: true, allowHiddenRgb: true, includePixels: true });
  const canonical = inspectPng(readFileSync(join(kitRoot, 'assets/reference-native-trees.png')), { includePixels: true });
  assert.equal(native.width, canonical.width); assert.equal(native.height, canonical.height);
  for (let p = 0; p < native.rgba.length; p += 4) {
    assert.equal(canonical.rgba[p + 3], native.rgba[p + 3]);
    assert.deepEqual(canonical.rgba.subarray(p, p + 3), native.rgba[p + 3] ? native.rgba.subarray(p, p + 3) : Buffer.alloc(3));
  }
  const editor = createEditor(kit, map), initial = editor.serialize(); editor.execute([{ type: 'paint-cells', familyId: 'terrain.primary', cells: [{ x: 14, y: 2 }] }]);
  editor.undo(); assert.equal(editor.serialize(), initial);
  const negative = structuredClone(map); negative.bounds.x = -4; negative.bounds.width = 20;
  negative.terrainRuns.push({ x: -3, y: 7, length: 1, familyId: 'terrain.primary' });
  assert.ok(compileMap(kit, negative).layers.flatMap(layer => layer.nodes).find(item => item.cell?.x === -3).assetId.startsWith('r29-'));
  const out = join(c.parent, 'export-screen'); exportScene(kit, map, out); assert.deepEqual(openSceneExport(out).compiled, scene);
  const view = createSceneView({ resolveTexture: () => Texture.WHITE, resolveCurveMaterial: () => ({ body: Texture.WHITE, cap: Texture.WHITE }) }); view.update(scene);
  const tree = view.root.children.find(layer => layer.label === 'foreground-tree').children[0]; assert.equal(tree.tint, node.renderStyle.tint);
  const terrain = view.root.children.find(layer => layer.label === 'terrain'); assert.ok(terrain.children.every(child => child.tint === 0xd4dfdf)); view.destroy();
  const doc = JSON.parse(readFileSync(join(kitRoot, 'kit.json'))), catalog = JSON.parse(readFileSync(join(kitRoot, doc.files.catalog.path)));
  assert.ok(validateDocument('ai_scene_kit_v2', { ...doc, format: 'ai_scene_kit_v2' }).length);
  assert.ok(validateDocument('ai_scene_module_catalog_v2', { ...catalog, format: 'ai_scene_module_catalog_v2' }).length);
  const broken = join(c.parent, 'broken-style'); cpSync(kitRoot, broken, { recursive: true });
  catalog.modules.find(item => item.renderStyle).renderStyle.scale = { numerator: 1, denominator: 100 };
  const bytes = jsonBytes(catalog); writeFileSync(join(broken, doc.files.catalog.path), bytes); doc.files.catalog.sha256 = hash(bytes); writeFileSync(join(broken, 'kit.json'), jsonBytes(doc));
  assert.ok(validateBundle(broken).errors.some(item => item.code === 'MODULE_RENDER_STYLE'));
});
