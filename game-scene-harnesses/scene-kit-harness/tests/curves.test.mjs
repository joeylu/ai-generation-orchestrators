import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Texture } from 'pixi.js';
import { loadSceneKit, readMap } from '../src/kit.mjs';
import { createEditor } from '../src/editor.mjs';
import { compileMap } from '../src/compile.mjs';
import { canonicalJson } from '../src/document.mjs';
import { validateDocument } from '../src/schema.mjs';
import { saveMap, loadMap, exportScene, openSceneExport } from '../src/persistence.mjs';
import { curveBezier, sampleCurve } from '../src/curves.mjs';
import { createSceneView } from '../src/pixi/scene-view.mjs';
import { sha256 } from '../src/validate.mjs';
import { fixtureRoot, setup } from './helpers/generation.mjs';
import { curvePreset } from '../src/studio/curve-tools.mjs';

const kit = loadSceneKit(fixtureRoot), rejects = (fn, code) => assert.throws(fn, error => error.errors?.some(item => item.code === code));
const curve = () => ({ curveId: 'curve.hill', profile: 'sideview-height-curve-v1', familyId: 'terrain.primary', baseY: 576,
  points: [{ x: 64, y: 448, slope: 0 }, { x: 512, y: 256, slope: 0 }, { x: 960, y: 448, slope: 0 }] });
const map = () => ({ ...readMap(kit), format: 'ai_scene_document_v2', terrainRuns: [], assemblyInstances: [], curveTerrains: [curve()] });

test('v2 curve authors are explicit and closed; old documents reject new fields and preserve original bytes', () => {
  const original = readMap(kit), before = canonicalJson(compileMap(kit, original));
  assert.deepEqual(validateDocument('ai_scene_document_v2', map()), []);
  assert.ok(validateDocument('ai_scene_document_v1', { ...original, curveTerrains: [] }).some(e => e.code === 'SCHEMA_PROPERTY'));
  assert.ok(validateDocument('ai_scene_document_v2', { ...original, format: 'ai_scene_document_v2' }).some(e => e.code === 'SCHEMA_REQUIRED'));
  assert.equal(canonicalJson(compileMap(kit, original)), before); assert.equal(compileMap(kit, original).format, 'ai_scene_compiled_v1');
});

test('linear-x Hermite interpolation preserves known endpoints, midpoint and a shared C1 segment join', () => {
  const line = { points: [{ x: 0, y: 200, slope: 0 }, { x: 256, y: 100, slope: 0 }] };
  const samples = sampleCurve(line), middle = samples.find(p => p.x === 128);
  assert.equal(middle.y, 150); assert.deepEqual([samples[0].x, samples[0].y, samples.at(-1).x, samples.at(-1).y], [0, 200, 256, 100]);
  const c = curve(); c.points[1].slope = .25;
  const left = curveBezier(c.points[0], c.points[1]), right = curveBezier(c.points[1], c.points[2]);
  assert.ok(Math.abs((left[3].y - left[2].y) / (left[3].x - left[2].x) - .25) < 1e-12);
  assert.ok(Math.abs((right[1].y - right[0].y) / (right[1].x - right[0].x) - .25) < 1e-12);
  assert.equal(sampleCurve(c).filter(p => p.x === 512).length, 1);
});

test('dense analytic samples stay within the declared geometric error of the compiled surface', () => {
  const c = curve(), mesh = compileMap(kit, map()).curveTerrains[0];
  let maximum = 0;
  for (let s = 0; s < c.points.length - 1; s++) {
    const p = curveBezier(c.points[s], c.points[s + 1]);
    for (let i = 0; i <= 1000; i++) {
      const t = i / 1000, u = 1 - t, x = u ** 3 * p[0].x + 3 * u * u * t * p[1].x + 3 * u * t * t * p[2].x + t ** 3 * p[3].x;
      const y = u ** 3 * p[0].y + 3 * u * u * t * p[1].y + 3 * u * t * t * p[2].y + t ** 3 * p[3].y;
      const index = Math.min(mesh.surface.length - 2, mesh.surface.findIndex((point, j) => j < mesh.surface.length - 1 && point.x <= x && mesh.surface[j + 1].x >= x));
      assert.ok(index >= 0); const a = mesh.surface[index], b = mesh.surface[index + 1];
      maximum = Math.max(maximum, Math.abs((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y));
    }
  }
  assert.ok(maximum <= .500002, maximum);
});

test('fill, edge strip and collision derive from one surface; UV scale is world anchored and edge distance is cumulative', () => {
  const doc = map(), scene = compileMap(kit, doc), mesh = scene.curveTerrains[0];
  assert.equal(scene.format, 'ai_scene_compiled_v2');
  assert.deepEqual(scene.collisionSuggestions.curveContours[0].surface, mesh.surface);
  assert.deepEqual(scene.collisionSuggestions.curveContours[0].contour[0], scene.collisionSuggestions.curveContours[0].contour.at(-1));
  for (const [i, p] of mesh.surface.entries()) {
    assert.deepEqual(mesh.body.positions.slice(i * 4, i * 4 + 2), [p.x, p.y]);
    assert.deepEqual(mesh.cap.positions.slice(i * 4, i * 4 + 2), [p.x, p.y]);
    assert.ok(mesh.body.indices.every(index => index >= 0 && index < mesh.body.positions.length / 2));
    if (i) assert.ok(mesh.samples[i].distance > mesh.samples[i - 1].distance);
  }
  const moved = structuredClone(doc); moved.curveTerrains[0].points.forEach(p => p.x += 256);
  const changed = compileMap(kit, moved).curveTerrains[0];
  assert.equal(changed.body.uvs[0] - mesh.body.uvs[0], 1);
  assert.deepEqual(changed.cap.uvs, mesh.cap.uvs);
  const expanded = structuredClone(doc); expanded.bounds.width += 16;
  assert.deepEqual(compileMap(kit, expanded).curveTerrains, scene.curveTerrains);
});

for (const [name, change, code] of [
  ['reversed points', d => { d.curveTerrains[0].points[1].x = 60; }, 'CURVE_POINT_ORDER'],
  ['nonhorizontal endpoint', d => { d.curveTerrains[0].points[0].slope = 1; }, 'CURVE_ENDPOINT_TANGENT'],
  ['shallow solid', d => { d.curveTerrains[0].baseY = 450; }, 'CURVE_DEPTH'],
  ['map overflow', d => { d.curveTerrains[0].baseY = 640; }, 'CURVE_OUT_OF_BOUNDS'],
  ['overlapping curve domains', d => { d.curveTerrains.push({ ...curve(), curveId: 'other' }); }, 'CURVE_DOMAIN'],
  ['curve/grid shared domain', d => { d.terrainRuns.push({ x: 2, y: 8, length: 1, familyId: 'terrain.primary' }); }, 'CURVE_GRID_OVERLAP'],
  ['foreign material family', d => { d.curveTerrains[0].familyId = 'other'; }, 'FAMILY_UNSUPPORTED'],
  ['overlong curve', d => { d.bounds.width = 128; d.curveTerrains[0].points.at(-1).x = 5000; }, 'CURVE_DOMAIN'],
  ['folded edge strip', d => { d.curveTerrains[0].points = [{ x: 64, y: 448, slope: 0 }, { x: 96, y: 128, slope: 0 }, { x: 128, y: 448, slope: 0 }]; }, 'CURVE_CAP_FOLD'],
  ['unknown curve field', d => { d.curveTerrains[0].image = 'invented.png'; }, 'SCHEMA_PROPERTY'],
]) test(`curve author rejects ${name}`, () => { const doc = map(); change(doc); rejects(() => compileMap(kit, doc), code); });

test('enable, extend and add form one atomic gesture; a failed replacement preserves document and redo', () => {
  const editor = createEditor(kit), original = editor.serialize(), sample = curvePreset(editor.getDocument(), { width: 64, height: 64 }, 'new.curve', 'terrain.primary');
  rejects(() => editor.execute([{ type: 'add-curve-terrain', curve: sample.curve }]), 'CURVE_UPGRADE_REQUIRED');
  editor.execute([{ type: 'enable-curve-terrain' }, { type: 'resize-bounds', bounds: sample.bounds }, { type: 'add-curve-terrain', curve: sample.curve }]);
  const ready = editor.serialize(); assert.equal(editor.history().undoDepth, 1);
  editor.undo(); assert.equal(editor.serialize(), original); editor.redo(); assert.equal(editor.serialize(), ready);
  const bad = structuredClone(sample.curve); bad.points[1].x = bad.points[0].x;
  rejects(() => editor.execute([{ type: 'replace-curve-terrain', curve: bad }]), 'CURVE_POINT_ORDER');
  assert.equal(editor.serialize(), ready); assert.equal(editor.history().undoDepth, 1);
  editor.execute([{ type: 'remove-curve-terrain', curveId: sample.curve.curveId }]);
  assert.equal(editor.getDocument().format, 'ai_scene_document_v2'); assert.equal(editor.getDocument().curveTerrains.length, 0);
  editor.undo(); assert.equal(editor.serialize(), ready);
});

test('curve author and compiled geometry survive save/open/export; rebound forged meshes still fail source replay', t => {
  const { parent } = setup(t), doc = map(), author = join(parent, 'curve.json');
  saveMap(kit, doc, author); assert.deepEqual(compileMap(kit, loadMap(kit, author)), compileMap(kit, doc));
  const output = join(parent, 'export'); exportScene(kit, doc, output);
  assert.equal(openSceneExport(output).document.format, 'ai_scene_document_v2');
  const compiledFile = join(output, 'scene.compiled.json'), compiled = JSON.parse(readFileSync(compiledFile));
  compiled.curveTerrains[0].body.positions[1] += 3;
  const bytes = Buffer.from(canonicalJson(compiled, true) + '\n'); writeFileSync(compiledFile, bytes);
  const manifestFile = join(output, 'manifest.json'), manifest = JSON.parse(readFileSync(manifestFile));
  manifest.compiledSha256 = sha256(bytes);
  Object.assign(manifest.files.find(file => file.path === 'scene.compiled.json'), { sha256: sha256(bytes), byteLength: bytes.length });
  writeFileSync(manifestFile, canonicalJson(manifest, true) + '\n');
  rejects(() => openSceneExport(output), 'COMPILED_REPLAY');
});

test('Pixi curve meshes share geometry-defined boundaries, own their geometry and preserve host textures', () => {
  const scene = compileMap(kit, map()), view = createSceneView({ resolveTexture: () => Texture.EMPTY,
    resolveCurveMaterial: () => ({ body: Texture.WHITE, cap: Texture.EMPTY }) });
  view.update(scene); const layer = view.root.children.find(layer => layer.label === 'terrain');
  assert.equal(layer.children.length, 2); assert.match(layer.children[0].label, /curve.hill\/body/);
  assert.equal(layer.children[0].geometry.positions.length, scene.curveTerrains[0].body.positions.length);
  view.destroy(); assert.ok(Texture.WHITE.source); assert.ok(Texture.EMPTY.source);
});
