import test from 'node:test';
import assert from 'node:assert/strict';
import { compileGridTerrainFields } from '../src/grid-terrain.mjs';
import { compileGridTerrainEdges, compileTerrainEdges, validateTerrainEdges, projectTerrainEdgePart, INBOARD_COVERAGE_PROFILE, GRID_TERRAIN_EDGE_PROFILE, NEAR_OPAQUE_JOIN_PROFILE } from '../src/terrain-edges.mjs';
import { compileCurveGeometry } from '../src/curves.mjs';
import { terrainEdgesFixture } from './helpers/terrain-edges.mjs';

const grid = { width: 64, height: 64 }, world = { x: 0, y: 0, width: 512, height: 512 };
const map = list => new Map(list.map(([x, y]) => [`${x},${y}`, 'terrain.primary']));
function fixture() {
  const f = terrainEdgesFixture(), edges = structuredClone(f.edges);
  edges.format = 'ai_scene_terrain_edges_v4'; edges.gridProfile = GRID_TERRAIN_EDGE_PROFILE; edges.joinProfile = NEAR_OPAQUE_JOIN_PROFILE;
  for (const side of ['left', 'right']) for (const part of ['wall', 'corner']) edges[side][part].inboardBlend = side === 'left' ? { fromX: 32, toX: 46 } : { fromX: 16, toX: 2 };
  return { ...f, edges, appearance: { ...f.appearance, format: 'ai_scene_continuous_terrain_appearance_v6',
    surfaceOriginInBodyPixels: { numerator: -40, denominator: 1 }, capDepth: { numerator: 21, denominator: 1 }, capUvEnd: { numerator: 1, denominator: 1 } } };
}
function compile(cells, f = fixture(), { allCells = cells, excludedCells = new Set(), curves = [] } = {}) {
  const patches = compileGridTerrainFields(allCells, { grid, appearance: f.appearance, layerId: 'terrain', excludedCells });
  return compileGridTerrainEdges(patches, f.edges, { world, grid, cells, allCells, curves });
}
const span = row => [row.side, row.x, row.fromY, row.toY, row.cornerApplied];
const rejects = (fn, code) => assert.throws(fn, error => error.errors?.some(issue => issue.code === code));
function covers(mesh, x, y) {
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const [a, b, c] = mesh.indices.slice(i, i + 3).map(n => ({ x: mesh.positions[n * 2], y: mesh.positions[n * 2 + 1] }));
    const d = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y); if (Math.abs(d) < 1e-9) continue;
    const u = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / d, v = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / d;
    if (Math.min(u, v, 1 - u - v) > 1e-7) return true;
  } return false;
}

test('grid sides are opt-in v4 and a tall multi-cell rectangle has only two continuous exterior walls and two top corners', () => {
  const f = fixture(); validateTerrainEdges(f.edges, f.appearance, { readAsset: path => f.files.get(path) });
  const cells = map([[2, 2], [3, 2], [2, 3], [3, 3], [2, 4], [3, 4]]), before = [...cells], result = compile(cells, f);
  assert.deepEqual([...cells], before); assert.equal(result.gridTerrains.length, 1); assert.equal(result.report.placed.length, 2);
  assert.deepEqual(result.report.placed.map(span), [['left', 128, 128, 320, true], ['right', 256, 128, 320, true]]);
  assert.equal(result.gridTerrains[0].edgeMeshes.filter(mesh => mesh.part === 'corner').length, 64);
  assert(result.gridTerrains[0].edgeMeshes.every(mesh => ![192].includes(mesh.unionSide.x)));
  const legacy = structuredClone(f.edges); legacy.format = 'ai_scene_terrain_edges_v3'; delete legacy.gridProfile;
  rejects(() => compileGridTerrainEdges([], legacy, { world, grid, cells }), 'TERRAIN_EDGE_GRID_PROFILE');
  rejects(() => validateTerrainEdges({ ...f.edges, gridProfile: 'implicit-per-cell-edges' }, f.appearance), 'TERRAIN_EDGE_SHAPE');
});

test('horizontal extension, stacking and erasing recompute union boundaries instead of retaining edges between old and new cells', () => {
  const cells = map([[2, 2], [3, 2], [2, 3], [3, 3]]), a = compile(cells);
  assert.deepEqual(a.report.placed.map(span), [['left', 128, 128, 256, true], ['right', 256, 128, 256, true]]);
  for (const [x, y] of [[4, 2], [4, 3], [2, 4], [3, 4], [4, 4]]) cells.set(`${x},${y}`, 'terrain.primary');
  const b = compile(cells); assert.deepEqual(b.report.placed.map(span), [['left', 128, 128, 320, true], ['right', 320, 128, 320, true]]);
  assert(b.report.placed.every(row => row.x !== 256));
  cells.delete('4,2'); const erased = compile(cells);
  assert(erased.report.placed.some(row => row.side === 'right' && row.x === 256 && row.fromY === 128 && row.toY === 192));
  assert(erased.report.placed.some(row => row.side === 'right' && row.x === 320 && row.fromY === 192 && row.toY === 320));
});

test('stairs receive exposed ledge corners while holes and lower notches keep wall-only vertical faces without filling the void', () => {
  const stairs = compile(map([[2, 2], [2, 3], [3, 3], [2, 4], [3, 4], [4, 4]]));
  assert.equal(stairs.report.placed.length, 4); assert(stairs.report.placed.every(row => row.cornerApplied));
  const ring = []; for (let y = 2; y <= 4; y++) for (let x = 2; x <= 4; x++) if (x !== 3 || y !== 3) ring.push([x, y]);
  const hole = compile(map(ring)), inner = hole.report.placed.filter(row => row.fromY === 192 && row.toY === 256);
  assert.equal(inner.length, 2); assert(inner.every(row => !row.cornerApplied));
  assert(!covers(hole.gridTerrains[0].body, 224.5, 224.5)); assert(!covers(hole.gridTerrains[0].cap, 224.5, 224.5));
  assert(hole.gridTerrains[0].edgeMeshes.every(mesh => !covers(mesh, 224.5, 224.5)));
  const notch = compile(map([[2, 2], [3, 2], [4, 2], [2, 3], [4, 3]]));
  assert(notch.report.placed.filter(row => row.fromY === 192).every(row => !row.cornerApplied));
});

test('narrow one-cell columns fit the inward render mesh without crossing the opposite side or changing native PNGs', () => {
  const f = fixture(), saved = new Map([...f.files].map(([path, bytes]) => [path, Buffer.from(bytes)]));
  for (const side of ['left', 'right']) for (const part of ['wall', 'corner']) {
    const item = f.edges[side][part]; item.scale = { numerator: 1, denominator: 1 };
    item.boundaryX = side === 'left' ? 0 : 47;
    item.innerX = side === 'left' ? 32 : 15;
    item.inboardBlend = side === 'left' ? { fromX: 32, toX: 46 } : { fromX: 15, toX: 1 };
  }
  const result = compile(map([[2, 2], [2, 3], [2, 4]]), f), patch = result.gridTerrains[0];
  assert(result.report.placed.every(row => row.inwardFitFactor < 1 && row.inwardFitFactor > 0));
  assert(covers(patch.body, 160.25, 224));
  for (const piece of patch.edgeMeshes) for (let i = 0; i < piece.positions.length; i += 2) {
    const x = piece.positions[i], boundary = piece.unionSide.x;
    if (piece.side === 'left' && x >= boundary) assert(x <= 160 + 1e-6);
    if (piece.side === 'right' && x <= boundary) assert(x >= 160 - 1e-6);
  }
  for (const [path, bytes] of saved) assert.deepEqual(f.files.get(path), bytes);
});

test('excluded rigid platform cells remain obstruction data but receive no grid wall, corner or replacement geometry', () => {
  const all = map([[2, 2], [3, 2], [5, 2], [5, 3]]), excludedCells = new Set(['2,2', '3,2']), ordinary = new Map([...all].filter(([key]) => !excludedCells.has(key)));
  const result = compile(ordinary, fixture(), { allCells: all, excludedCells });
  assert.equal(result.gridTerrains.length, 1); assert.deepEqual(result.gridTerrains[0].source.gridCells, [{ x: 5, y: 2 }, { x: 5, y: 3 }]);
  assert(result.report.placed.every(row => row.x >= 320));
  assert.equal(compile(new Map(), fixture(), { allCells: map([[2, 2], [3, 2]]), excludedCells }).gridTerrains.length, 0);
  const border = compile(map([[0, 1], [7, 1]])); assert(border.report.skipped.some(row => row.x === 0 && row.reason === 'world-boundary'));
  assert(border.report.skipped.some(row => row.x === 512 && row.reason === 'world-boundary'));
});

test('curve and grid contacts subtract shared intervals on both sides and retain exposed lower wall fragments', () => {
  const f = fixture(), cells = map([[2, 2], [3, 2], [2, 3], [3, 3]]), original = { ...compileCurveGeometry({ curveId: 'touching.curve', familyId: 'terrain.primary', baseY: 384,
    points: [{ x: 256, y: 192, slope: 0 }, { x: 384, y: 192, slope: 0 }] }, 16), layerId: 'terrain' };
  const before = structuredClone(original), result = compile(cells, f, { curves: [original] });
  assert(result.report.placed.some(row => row.side === 'right' && row.x === 256 && row.fromY === 128 && row.toY === 192));
  assert(result.report.placed.every(row => row.x !== 256 || row.toY <= 192));
  const curves = compileTerrainEdges([original], f.edges, { world, grid, cells, gridUnion: true });
  assert(curves.report.placed.some(row => row.side === 'left' && row.fromY === 256 && row.toY === 384 && !row.cornerApplied));
  assert(curves.curves[0].edgeMeshes.filter(mesh => mesh.side === 'left').every(mesh => mesh.part === 'wall' && mesh.positions.filter((_, i) => i % 2).every(y => y >= 256)));
  assert.deepEqual(original, before); assert.deepEqual(curves.curves[0].contour, original.contour);
  const legacy = structuredClone(f.edges); legacy.format = 'ai_scene_terrain_edges_v3'; delete legacy.gridProfile;
  const old = JSON.stringify(compileTerrainEdges([original], legacy, { world, grid, cells }));
  compile(cells, f, { curves: [original] });
  assert.equal(JSON.stringify(compileTerrainEdges([original], legacy, { world, grid, cells })), old);
});

test('grid corner overhang is removed from a nearby curve solid even when the two author boundaries do not share X', () => {
  const f = fixture(); for (const part of ['wall', 'corner']) f.edges.left[part].boundaryX = 24;
  const cells = map([[2, 2]]), neighbor = { ...compileCurveGeometry({ curveId: 'nearby.curve', familyId: 'terrain.primary', baseY: 140,
    points: [{ x: 80, y: 110, slope: 0 }, { x: 124, y: 110, slope: 0 }] }, 16), layerId: 'terrain' };
  const native = projectTerrainEdgePart({ surface: [{ x: 128, y: 128 }, { x: 192, y: 128 }] }, f.edges.left.corner,
    { side: 'left', endpoint: { x: 128, y: 128 }, top: 120, bottom: 152, v0: 0, v1: .8, baseY: 192, coverageProfile: INBOARD_COVERAGE_PROFILE });
  assert(native.some(piece => covers(piece, 123.25, 127.25)), 'the unmasked corner geometrically reaches the neighbor');
  const result = compile(cells, f, { curves: [neighbor] });
  assert(result.gridTerrains[0].edgeMeshes.every(piece => !covers(piece, 123.25, 127.25)));
  assert.equal(result.report.effectiveRenderAlpha, 'native-alpha-times-coverageOpacity');
});

test('v4 curve/grid mode removes rising cap paint up to the interpolated inner join and preserves original contours', () => {
  const f = fixture(), curve = { ...compileCurveGeometry({ curveId: 'rising.curve', familyId: 'terrain.primary', baseY: 384,
    points: [{ x: 128, y: 192, slope: 0 }, { x: 192, y: 160, slope: 0 }, { x: 256, y: 192, slope: 0 }] }, 16), layerId: 'terrain' };
  const result = compileTerrainEdges([curve], f.edges, { world, grid, cells: map([[6, 6]]), gridUnion: true });
  assert(covers(curve.body, 132, 191.75)); assert(!covers(result.curves[0].body, 132, 191.75)); assert(!covers(result.curves[0].cap, 132, 191.75));
  assert.deepEqual(result.curves[0].contour, curve.contour); assert.equal(result.report.coverageProfile, INBOARD_COVERAGE_PROFILE);
  assert.equal(result.report.effectiveRenderAlpha, 'native-alpha-times-coverageOpacity');
});

test('small adversarial occupancy masks preserve every exposed vertical face and keep inward triangles over their own solid', () => {
  for (let seed = 1; seed <= 8; seed++) {
    let state = seed * 17, points = [];
    for (let y = 1; y <= 5; y++) for (let x = 1; x <= 5; x++) { state = (state * 1664525 + 1013904223) >>> 0; if (state % 5 < 3) points.push([x, y]); }
    const cells = map(points), result = compile(cells);
    for (const [x, y] of points) for (const side of ['left', 'right']) {
      const neighbor = `${x + (side === 'left' ? -1 : 1)},${y}`, boundary = (x + (side === 'right' ? 1 : 0)) * 64, center = y * 64 + 32;
      assert.equal(result.report.placed.some(row => row.side === side && row.x === boundary && row.fromY < center && row.toY > center), !cells.has(neighbor));
    }
    for (const patch of result.gridTerrains) {
      const owned = new Set(patch.source.gridCells.map(cell => `${cell.x},${cell.y}`));
      for (const piece of patch.edgeMeshes ?? []) for (let i = 0; i < piece.indices.length; i += 3) {
        const ids = piece.indices.slice(i, i + 3), x = ids.reduce((n, id) => n + piece.positions[id * 2], 0) / 3, y = ids.reduce((n, id) => n + piece.positions[id * 2 + 1], 0) / 3;
        if (y < piece.unionSide.fromY + 1e-6 || y > piece.unionSide.toY - 1e-6) continue;
        if (piece.side === 'left' ? x <= piece.unionSide.x + 1e-6 : x >= piece.unionSide.x - 1e-6) continue;
        assert(owned.has(`${Math.floor(x / 64)},${Math.floor(y / 64)}`), `floating inward triangle for seed ${seed}`);
      }
    }
  }
});
