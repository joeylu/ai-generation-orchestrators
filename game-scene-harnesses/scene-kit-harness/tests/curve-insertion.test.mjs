import test from 'node:test';
import assert from 'node:assert/strict';
import { findCurveSurface, insertCurvePoint } from '../src/studio/curve-insertion.mjs';
import { loadSceneKit, readMap } from '../src/kit.mjs';
import { createEditor } from '../src/editor.mjs';
import { fixtureRoot } from './helpers/generation.mjs';

const curve = () => ({ curveId: 'hill', profile: 'sideview-height-curve-v1', familyId: 'terrain.primary', baseY: 576,
  points: [{ x: 64, y: 448, slope: 0 }, { x: 512, y: 256, slope: .2 }, { x: 960, y: 448, slope: 0 }] });
const at = (c, x) => {
  const i = c.points.findIndex((p, i) => i && p.x >= x), a = c.points[i - 1], b = c.points[i], dx = b.x - a.x, t = (x - a.x) / dx;
  return (2*t**3-3*t**2+1)*a.y+(t**3-2*t**2+t)*dx*a.slope+(-2*t**3+3*t**2)*b.y+(t**3-t**2)*dx*b.slope;
};

test('curve insertion splits at the requested x, preserves the existing shape and is one undoable edit', () => {
  const source = curve(), original = structuredClone(source), plan = insertCurvePoint(source, 283.2);
  assert.equal(plan.pointIndex, 1); assert.equal(plan.curve.points[1].x, 283);
  assert.deepEqual(source, original);
  for (let x = 65; x <= 960; x += 2) assert.ok(Math.abs(at(plan.curve, x) - at(source, x)) <= .5001);
  const kit = loadSceneKit(fixtureRoot), document = { ...readMap(kit), format: 'ai_scene_document_v2', terrainRuns: [], assemblyInstances: [], curveTerrains: [source] };
  const editor = createEditor(kit, document), before = editor.serialize();
  editor.execute([{ type: 'replace-curve-terrain', curve: plan.curve }]);
  assert.equal(editor.history().undoDepth, 1); assert.deepEqual(editor.getDocument().curveTerrains[0], plan.curve);
  const after = editor.serialize(); editor.undo(); assert.equal(editor.serialize(), before); editor.redo(); assert.equal(editor.serialize(), after);
});

test('surface hit testing follows the curved edge, has a screen-space radius and chooses the nearest curve', () => {
  const a = curve(), b = { ...curve(), curveId: 'lower', points: curve().points.map(p => ({ ...p, y: p.y + 20 })) };
  const p = { x: 283, y: at(a, 283) };
  assert.equal(findCurveSurface([a, b], { ...p, y: p.y + 3 }, 1).curve.curveId, a.curveId);
  assert.equal(findCurveSurface([a, b], { ...p, y: p.y + 19 }, 1).curve.curveId, b.curveId);
  for (const scale of [.25, 1, 4]) {
    assert.ok(findCurveSurface([a], { x: 512, y: 256 - 9 / scale }, scale));
    assert.equal(findCurveSurface([a], { x: 512, y: 256 - 30 / scale }, scale), null);
  }
  assert.equal(findCurveSurface([a], { x: 283, y: 550 }, 1), null);
  assert.equal(findCurveSurface([a, { ...a, curveId: 'selected' }], p, 1, 'selected').curve.curveId, 'selected');
});

test('too-close, outside, point-budget and steep insertions are refused without altering the source', () => {
  const c = curve(), original = structuredClone(c);
  for (const x of [NaN, -100, 64, 65, 95, 500, 512, 960, 1100]) assert.ok(insertCurvePoint(c, x).message, String(x));
  assert.ok(insertCurvePoint(c, 96).curve);
  const full = { ...c, points: Array.from({ length: 32 }, (_, i) => ({ x: 64 + 64*i, y: 448, slope: 0 })) };
  assert.match(insertCurvePoint(full, 96).message, /32 个/);
  const steep = { ...c, points: [{ x: 0, y: 40, slope: 0 }, { x: 100, y: 400, slope: 0 }] };
  assert.match(insertCurvePoint(steep, 50).message, /坡度/);
  assert.deepEqual(c, original);
});
