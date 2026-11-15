import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Texture } from 'pixi.js';
import { measurePlatformSurface } from '../src/terrain-skins.mjs';
import { prepareSupplementScreen } from './helpers/supplement-screen.mjs';
import { loadSceneKit, readMap, compileMap, validateBundle, validateDocument, createEditor, exportScene, openSceneExport } from '../src/index.mjs';
import { createSceneView } from '../src/pixi/scene-view.mjs';
import * as api from '../src/generation/index.mjs';

test('surface measurement ignores faint alpha noise without editing the source and chooses the first long support span', () => {
  const image = { width: 40, height: 20, rgba: Buffer.alloc(40 * 20 * 4) };
  for (let x = 0; x < 40; x++) image.rgba[x * 4 + 3] = 1;
  for (let y = 8; y < 18; y++) for (let x = 5; x < 35; x++) image.rgba[(y * 40 + x) * 4 + 3] = 255;
  const before = Buffer.from(image.rgba); assert.deepEqual(measurePlatformSurface(image), { left: 5, right: 35, y: 8 });
  assert.deepEqual(image.rgba, before);
});

test('accepted supplements produce editable rigid platform appearances, retain collision cells, reject invalid edits and export exactly', t => {
  const c = prepareSupplementScreen(t), before = api.inspectWorkflow(c.root); c.buildSupplement();
  assert.deepEqual(api.inspectWorkflow(c.root), before);
  assert.equal(api.verifySceneSupplementStudy(c.root, c.kit, c.supplementOptions, c.terrainRoots, c.supplementOut).status, 'deterministic-proof-valid');
  const root = join(c.supplementOut, 'kit'), result = validateBundle(root); assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.moduleCount, 1522); assert.equal(result.presetCount, 6);
  const kit = loadSceneKit(root), map = readMap(kit), scene = compileMap(kit, map);
  assert.equal(scene.format, 'ai_scene_compiled_v6'); assert.equal(scene.counts.terrainNodes, 32); assert.equal(scene.counts.visualNodes, 12);
  assert.equal(scene.terrainPresentation.renderedGridNodes, 29); assert.equal(scene.terrainPresentation.coveredGridCells, 3);
  assert.equal(scene.terrainSkins.length, 1); assert.deepEqual(scene.terrainSkins[0].surface, { from: { x: 576, y: 256 }, to: { x: 768, y: 256 } });
  const grid = scene.layers.find(l => l.layerId === 'terrain'); assert.equal(grid.nodes.some(n => n.cell.y === 4), false);
  assert.ok(scene.collisionSuggestions.standingSurfaces.some(s => s.from.x === 576 && s.to.x === 768 && s.from.y === 256));
  const platform = scene.layers.find(l => l.layerId === 'platform-skins').nodes[0]; assert.equal(platform.assetId, 'accepted.platform');
  const descriptor = JSON.parse(readFileSync(join(root, 'kit.json'), 'utf8'));
  const catalog = JSON.parse(readFileSync(join(root, descriptor.files.catalog.path), 'utf8'));
  const module = catalog.modules.find(m => m.assetId === 'accepted.platform'), surface = module.terrainSkin.surfacePx;
  const scale = module.renderStyle.scale.numerator / module.renderStyle.scale.denominator;
  assert.equal(platform.position.x + surface.left * scale, 576); assert.equal(platform.position.y + surface.y * scale, 256);
  assert.ok(Math.abs(platform.position.x + surface.right * scale - 768) < 1e-8);
  assert.ok(validateDocument('ai_scene_module_catalog_v3', { ...catalog, format: 'ai_scene_module_catalog_v3' }).length);
  const editor = createEditor(kit, map), original = editor.serialize();
  editor.execute([{type:'enable-layered-terrain'},{type:'move-terrain',target:{assemblyId:'floating.platform'},dx:-128,dy:-192}]);
  assert.equal(editor.getScene().format,'ai_scene_compiled_v7');
  assert.deepEqual(editor.getScene().terrainSkins[0].surface.from,{x:448,y:64});
  assert.deepEqual(editor.getDocument().curveTerrains,map.curveTerrains);
  editor.undo();assert.equal(editor.serialize(),original);
  editor.execute([{type:'move-terrain',target:{assemblyId:'floating.platform'},dx:0,dy:-64}]);
  assert.equal(editor.getScene().terrainSkins[0].surface.from.y,192);
  assert.equal(editor.getScene().counts.terrainNodes,scene.counts.terrainNodes);
  editor.undo();assert.equal(editor.serialize(),original);
  editor.execute([{ type: 'remove-assembly', instanceId: 'floating.platform' }]);
  assert.equal(editor.getScene().terrainSkins.length, 0); assert.equal(editor.getScene().counts.terrainNodes, 29);
  editor.undo(); assert.equal(editor.serialize(), original);
  editor.execute([{ type: 'expand-assembly', instanceId: 'floating.platform' }]);
  const expanded = editor.serialize(), appearance = editor.getDocument().instances.find(i => i.assetId === 'accepted.platform');
  editor.execute([{type:'move-terrain',target:{cell:{x:9,y:4}},dx:0,dy:-64}]);
  assert.equal(editor.getDocument().instances.find(i=>i.instanceId===appearance.instanceId).y,appearance.y-64);
  assert.equal(editor.getScene().terrainSkins[0].surface.from.y,192);
  editor.undo();assert.equal(editor.serialize(),expanded);
  for (const command of [{ type: 'erase-cells', cells: [{ x: 9, y: 4 }] },
    { type: 'paint-cells', familyId: 'terrain.primary', cells: [{ x: 12, y: 4 }] },
    { type: 'move-instance', instanceId: appearance.instanceId, x: 576.5, y: 256 }]) {
    assert.throws(() => editor.execute([command])); assert.equal(editor.serialize(), expanded);
  }
  editor.execute([{ type: 'remove-instance', instanceId: appearance.instanceId }]);
  assert.equal(editor.getScene().terrainPresentation.coveredGridCells, 0); assert.equal(editor.getScene().terrainPresentation.renderedGridNodes, 32);
  editor.undo(); editor.undo(); assert.equal(editor.serialize(), original);
  const path = join(c.parent, 'export-supplement'); exportScene(kit, map, path); assert.deepEqual(openSceneExport(path).compiled, scene);
  const view = createSceneView({ resolveTexture: () => Texture.WHITE, resolveCurveMaterial: () => ({ body: Texture.WHITE, cap: Texture.WHITE }) });
  view.update(scene); assert.equal(view.root.children.find(l => l.label === 'platform-skins').children.length, 1); view.destroy();
});
