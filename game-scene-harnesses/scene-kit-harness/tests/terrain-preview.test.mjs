import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Texture } from 'pixi.js';
import { createSceneView } from '../src/pixi/scene-view.mjs';
import { terrainStudyTextureKey } from '../src/pixi/terrain-appearance.mjs';
import { readTerrainStudyPreviewImage, inspectWorkflow } from '../src/generation/index.mjs';
import { startStudio } from '../src/studio/host.mjs';
import { loadTerrainPreviewConfig } from '../src/studio/terrain-config.mjs';
import { compileMap } from '../src/compile.mjs';
import { readMap } from '../src/kit.mjs';
import { hash } from '../src/generation/common.mjs';
import { prepareTerrainPreview } from './helpers/terrain-preview.mjs';
import { fixtureRoot } from './helpers/generation.mjs';

const rejects = (fn, code) => assert.throws(fn, error => error.errors?.some(item => item.code === code));
const node = (x, y, signature = 7) => ({ nodeId: `terrain/${x},${y}`, assetId: 'same.base.asset', kind: 'sprite',
  cell: { x, y }, signature, position: { x: x * 64, y: y * 64 }, size: { width: 64, height: 64 }, sourceToLogical: { numerator: 1, denominator: 1 } });

test('terrain preview selection uses normalized topology and world coordinates, never the base asset or camera', () => {
  assert.equal(terrainStudyTextureKey(node(-1, -2)), 'p11-blob-007');
  assert.equal(terrainStudyTextureKey(node(0, 0, 255)), 'p0-blob-255');
  assert.equal(terrainStudyTextureKey(node(4, 4, 255)), 'p0-blob-255');
  assert.equal(terrainStudyTextureKey({ nodeId: 'visual/a', assetId: 'environment' }), null);
  for (const invalid of [{ ...node(1, 2), signature: 2 }, { ...node(1, 2), cell: { x: 1.5, y: 2 } },
    { ...node(1, 2), size: { width: 128, height: 64 } }, { ...node(1, 2), position: { x: 63, y: 128 } }])
    assert.throws(() => terrainStudyTextureKey(invalid));
});

test('Pixi resolves textures per node and a failed appearance update retains the old scene and shared textures', () => {
  const first = node(0, 0), second = node(1, 0);
  const scene = { format: 'ai_scene_compiled_v1', defaultCamera: { center: { x: 0, y: 0 } }, layers: [{
    layerId: 'terrain', visible: true, parallax: { x: 1, y: 1 }, nodes: [first, second] }] };
  const view = createSceneView({ resolveTexture: () => Texture.EMPTY,
    resolveNodeTexture: item => item.cell.x === 0 ? Texture.WHITE : Texture.EMPTY });
  view.update(scene);
  assert.equal(view.root.children[0].children[0].texture, Texture.WHITE);
  assert.equal(view.root.children[0].children[1].texture, Texture.EMPTY);
  const old = view.root.children[0];
  assert.throws(() => view.update({ ...scene, layers: [{ ...scene.layers[0], nodes: [{ ...first, cell: null }] }] }));
  assert.equal(view.root.children[0], old);
  view.destroy(); assert.ok(Texture.WHITE.source); assert.ok(Texture.EMPTY.source);
});

test('preview creation requires source acceptance; its opaque snapshot rejects forged handles and later file corruption', t => {
  const context = prepareTerrainPreview(t, { accepted: false });
  rejects(context.load, 'MATERIAL_SOURCE_ACCEPTANCE_REQUIRED');
  const preview = context.accept(), before = inspectWorkflow(context.root), key = preview.modules[0].key;
  const bytes = readTerrainStudyPreviewImage(preview, key); bytes.fill(0);
  assert.equal(hash(readTerrainStudyPreviewImage(preview, key)), preview.modules[0].sha256);
  assert.equal(Object.isFrozen(preview.modules[0]), true);
  rejects(() => readTerrainStudyPreviewImage(structuredClone(preview), key), 'TERRAIN_PREVIEW_HANDLE');
  writeFileSync(join(context.study, 'tiles', `${key}.png`), Buffer.from('synthetic changed source file'));
  assert.equal(hash(readTerrainStudyPreviewImage(preview, key)), preview.modules[0].sha256);
  rejects(context.load, 'PROOF_BUNDLE_RECOMPILE_MISMATCH');
  assert.deepEqual(inspectWorkflow(context.root), before);
});

test('configured preview serves only its snapshot and keeps author, compiler, undo and export source identity separate', async t => {
  const context = prepareTerrainPreview(t), staticRoot = join(context.parent, 'static'); mkdirSync(staticRoot);
  for (const name of ['index.html', 'app.js', 'style.css']) writeFileSync(join(staticRoot, name), 'synthetic static fixture');
  await assert.rejects(startStudio({ root: fixtureRoot, staticRoot, terrainPreview: structuredClone(context.preview) }), error => error.errors?.some(item => item.code === 'TERRAIN_PREVIEW_HANDLE'));
  const host = await startStudio({ root: fixtureRoot, staticRoot, terrainPreview: context.preview });
  t.after(() => host.close());
  const request = (path, body) => fetch(host.url + path, body ? { method: 'POST', headers: { Origin: host.url, 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const initial = await (await request('/api/state')).json();
  assert.equal(initial.terrainPreview.modules.length, 752); assert.equal(initial.terrainPreview.visualAcceptance, 'not-assessed');
  assert.equal(initial.terrainPreview.productionKit, false);
  assert.equal(initial.modules.filter(item => item.terrainSignature !== undefined).length, 47);
  const compiled = compileMap(context.kit, readMap(context.kit, 'default'));
  assert.deepEqual(initial.scene, compiled);
  const image = initial.terrainPreview.modules[0], response = await request(image.url);
  assert.equal(hash(Buffer.from(await response.arrayBuffer())), image.sha256);
  assert.equal((await request('/terrain-assets/../source/original.png')).status, 404);
  assert.equal((await request(image.url + '?file=source/original.png')).status, 404);
  assert.equal((await request('/api/edit', { revision: 0, action: 'appearance' })).status, 400);
  const edited = await (await request('/api/edit', { revision: 0, action: 'commands', commands: [{ type: 'paint-cells', familyId: initial.familyId, cells: [{ x: 10, y: 3 }] }] })).json();
  assert.equal(edited.scene.counts.terrainNodes, initial.scene.counts.terrainNodes + 1);
  assert.equal(edited.scene.source.kitSha256, initial.scene.source.kitSha256);
  assert.equal(edited.history.undoDepth, 1);
  const undone = await (await request('/api/edit', { revision: 1, action: 'undo' })).json();
  assert.equal(undone.scene.contentSha256, initial.scene.contentSha256);
  const json = await (await request('/api/state')).text();
  assert.ok(!json.includes(context.parent)); assert.ok(!json.includes('authorization')); assert.ok(!json.includes('nonce'));
});

test('startup-only preview config resolves relative paths and rejects extra operational fields', t => {
  const context = prepareTerrainPreview(t), file = join(context.parent, 'preview.json');
  const config = { format: 'ai_scene_terrain_preview_config_v1', workflowRoot: 'workspace', materialPlanSha256: context.plan.sha256,
    originalRoot: 'proof', revisionRoot: 'proof-v2', studyRoot: 'proof-continuous' };
  writeFileSync(file, JSON.stringify(config));
  assert.equal(loadTerrainPreviewConfig(file).bundleSha256, context.preview.bundleSha256);
  writeFileSync(file, JSON.stringify({ ...config, endpoint: 'https://invalid.example' }));
  rejects(() => loadTerrainPreviewConfig(file), 'WORKFLOW_SHAPE');
  assert.equal(readFileSync(join(context.study, 'source/original.png')).length > 0, true);
});
