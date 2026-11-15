import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson } from '../src/document.mjs';
import { hash } from '../src/generation/common.mjs';
import { encodeRgbaPng, inspectPng } from '../src/png.mjs';
import { compileCurveGeometry } from '../src/curves.mjs';
import { compileGridTerrainFields } from '../src/grid-terrain.mjs';
import { renderCoherentFrame } from '../src/coherent-render.mjs';
import { buildTerrainEdgeJunctions, validateTerrainEdgeJunctions, validateTerrainEdges, compileTerrainEdges, compileGridTerrainEdges,
  GRID_TERRAIN_EDGE_PROFILE, NEAR_OPAQUE_JOIN_PROFILE } from '../src/terrain-edges.mjs';
import { terrainEdgesFixture } from './helpers/terrain-edges.mjs';

const world = { x: 0, y: 0, width: 512, height: 512 }, grid = { width: 64, height: 64 };
const rejects = (fn, code) => assert.throws(fn, error => error.errors?.some(issue => issue.code === code));
function fixture({ alpha = 255 } = {}) {
  const f = terrainEdgesFixture(); f.edges.format = 'ai_scene_terrain_edges_v4'; f.edges.gridProfile = GRID_TERRAIN_EDGE_PROFILE; f.edges.joinProfile = NEAR_OPAQUE_JOIN_PROFILE;
  for (const side of ['left', 'right']) for (const part of ['wall', 'corner']) {
    const item = f.edges[side][part]; item.inboardBlend = side === 'left' ? { fromX: 32, toX: 46 } : { fromX: 16, toX: 2 };
    if (alpha !== 255) {
      const image = inspectPng(f.files.get(item.source.path), { includePixels: true });
      for (let n = 3; n < image.rgba.length; n += 4) if (image.rgba[n]) image.rgba[n] = alpha;
      const bytes = encodeRgbaPng(image.width, image.height, image.rgba); f.files.set(item.source.path, bytes); item.source.sha256 = hash(bytes); item.source.byteLength = bytes.length;
    }
  }
  f.readAsset = path => f.files.get(path);
  return f;
}
function upgrade(f, options = {}) {
  const edges = structuredClone(f.edges); edges.format = 'ai_scene_terrain_edges_v5'; edges.junctions = buildTerrainEdgeJunctions(edges, { readAsset: f.readAsset, ...options }); return edges;
}
function curve({ top = 24, bottom = 440, slope = false } = {}) {
  return { ...compileCurveGeometry({ curveId: 'cliff', familyId: 'terrain.primary', baseY: bottom,
    points: [{ x: 64, y: top, slope: slope ? -.025 : 0 }, { x: 320, y: top + (slope ? -3 : 0), slope: slope ? .018 : 0 }] }, 16), layerId: 'terrain' };
}
const cells = list => new Map(list.map(([x, y]) => [`${x},${y}`, 'terrain.primary']));
function gridCompile(map, f, edges) {
  const appearance = { ...f.appearance, surfaceOriginInBodyPixels: { numerator: -40, denominator: 1 }, capDepth: { numerator: 21, denominator: 1 }, capUvEnd: { numerator: 1, denominator: 1 } };
  const patches = compileGridTerrainFields(map, { grid, appearance, layerId: 'terrain' });
  return compileGridTerrainEdges(patches, edges, { world, grid, cells: map });
}

test('rational native scales sample the same recorded placement on initial build and independent replay', () => {
  const f = fixture({ alpha: 252 }), before = new Map([...f.files].map(([path, bytes]) => [path, Buffer.from(bytes)]));
  for (const side of ['left', 'right']) for (const part of ['wall', 'corner']) f.edges[side][part].scale = { numerator: 1, denominator: 6 };
  const edges = upgrade(f);
  assert.equal(validateTerrainEdgeJunctions(edges.junctions, edges, { readAsset: f.readAsset }), edges.junctions);
  const origins = Object.fromEntries(['left', 'right'].map(side => [side, edges.junctions[side].cornerWall.firstWallNativeOriginWorld]));
  const steps = Object.fromEntries(['left', 'right'].map(side => [side, edges.junctions[side].wallRepeat.stepWorld]));
  assert.equal(buildTerrainEdgeJunctions(f.edges, { readAsset: f.readAsset, firstWallNativeOriginWorld: origins, wallStepWorld: steps }).sha256, edges.junctions.sha256);
  for (const side of ['left', 'right']) assert(edges.junctions[side].support.minimumNativeCompositeAlpha >= 250);
  for (const [path, bytes] of before) assert.deepEqual(f.files.get(path), bytes);
});

test('complete native overlap freezes deterministic source identities, explicit placement and replayable original-alpha support', () => {
  const f = fixture(), before = structuredClone(f.edges), bytes = new Map([...f.files].map(([path, b]) => [path, Buffer.from(b)])), edges = upgrade(f);
  assert.equal(edges.junctions.sha256, buildTerrainEdgeJunctions(f.edges, { readAsset: f.readAsset }).sha256);
  assert.equal(validateTerrainEdges(edges, f.appearance, { readAsset: f.readAsset }), edges);
  assert.equal(validateTerrainEdgeJunctions(edges.junctions, edges, { readAsset: f.readAsset }), edges.junctions);
  assert.equal(edges.junctions.profile, 'native-alpha-complete-overlap-v1');
  for (const side of ['left', 'right']) {
    assert.equal(edges.junctions[side].cornerWall.nativeToY, 80);
    assert.equal(edges.junctions[side].cornerWall.firstWallNativeOriginWorld, 20);
    assert.equal(edges.junctions[side].wallRepeat.stepWorld, 32);
    assert.equal(edges.junctions[side].support.minimumNativeCompositeAlpha, 255);
  }
  assert.deepEqual(f.edges, before); for (const [path, b] of bytes) assert.deepEqual(f.files.get(path), b);
});

test('an explicit longer wall step replays and drives complete native placement without scaling the source or moving the corner',()=>{
  const f=fixture(),before=new Map([...f.files].map(([p,b])=>[p,Buffer.from(b)])),baseline=upgrade(f),
    edges=upgrade(f,{wallStepWorld:{left:36,right:36}}),original=curve(),old=compileTerrainEdges([original],baseline,{world}).curves[0],
    current=compileTerrainEdges([original],edges,{world}).curves[0];
  assert.equal(validateTerrainEdgeJunctions(edges.junctions,edges,{readAsset:f.readAsset}),edges.junctions);
  assert.deepEqual(current.body,old.body);assert.deepEqual(current.cap,old.cap);
  for(const side of ['left','right']){
    assert.equal(edges.junctions[side].wallRepeat.stepWorld,36);
    assert.equal((edges[side].wall.repeatY.to-edges[side].wall.repeatY.from)*.5,32,'repeat window and actual complete-source step are distinct');
    const selected=p=>p.edgeMeshes.filter(m=>m.side===side&&m.part==='wall'),
      origins=[...new Set(selected(current).map(m=>m.nativeOriginWorld))].sort((a,b)=>a-b);
    assert(origins.length>3&&selected(current).length<selected(old).length);
    for(let i=1;i<origins.length;i++)assert.equal(origins[i]-origins[i-1],36);
    assert.deepEqual(current.edgeMeshes.filter(m=>m.side===side&&m.part==='corner'),old.edgeMeshes.filter(m=>m.side===side&&m.part==='corner'));
  }
  for(const [p,b]of before)assert.deepEqual(f.files.get(p),b);
});

test('native repeat windows exclude painted ends and retain their physical source rows after replay', () => {
  const f = fixture({ alpha: 252 }), profile = 'native-alpha-repeat-window-v1';
  for (const side of ['left', 'right']) {
    f.edges[side].wall.repeatY = { from: 16, to: 60 };
    for (const part of ['wall', 'corner']) f.edges[side][part].scale = { numerator: 1, denominator: 6 };
  }
  const legacy = upgrade(f), edges = upgrade(f, { wallRepeatProfile: profile });
  validateTerrainEdges(edges, f.appearance, { readAsset: f.readAsset });
  validateTerrainEdgeJunctions(edges.junctions, edges, { readAsset: f.readAsset });
  assert.equal(edges.junctions.profile, profile);
  assert.deepEqual(legacy.junctions.left.wallRepeat.nativeFromY, 0);
  const source = curve(), before = compileTerrainEdges([source], legacy, { world }).curves[0];
  const result = compileTerrainEdges([source], edges, { world }).curves[0];
  assert.deepEqual(result.contour, before.contour);
  for (const side of ['left', 'right']) {
    const wall = f.edges[side].wall, rows = result.edgeMeshes.filter(mesh => mesh.side === side && mesh.part === 'wall');
    const origins = [...new Set(rows.map(row => row.nativeOriginWorld))].sort((a, b) => a-b);
    assert(origins.length > 3);
    for (let index = 1; index < origins.length; index++) assert(Math.abs(origins[index] - origins[index-1] - 44/6) < 2e-6);
    for (const mesh of rows) {
      assert.deepEqual(mesh.nativeVerticalRange, {fromY:16,toY:60});
      assert.equal(mesh.source.sha256, wall.source.sha256);
      assert(mesh.uvs.filter((_, index) => index % 2).every(v => v >= 16/80 - 1e-6 && v <= 60/80 + 1e-6));
    }
    assert(result.edgeMeshes.filter(mesh => mesh.side === side && mesh.part === 'corner').every(mesh => mesh.nativeVerticalRange.toY === 80));
  }
  rejects(() => upgrade(f, { wallRepeatProfile: profile, wallStepWorld: {left:6,right:6} }), 'TERRAIN_JUNCTION_PROFILE');
  rejects(() => upgrade(f, { wallRepeatProfile: profile, firstWallNativeOriginWorld: {left:100,right:100} }), 'TERRAIN_JUNCTION_SUPPORT');
});

test('different source bytes, changed controls and resealed fake support cannot reuse a frozen natural overlap record', () => {
  const f = fixture(), edges = upgrade(f), changed = structuredClone(edges); changed.left.corner.innerX++;
  rejects(() => validateTerrainEdgeJunctions(edges.junctions, changed), 'TERRAIN_JUNCTION_SOURCE');
  const original = f.files.get(edges.left.wall.source.path), damaged = Buffer.from(original); damaged[20] ^= 1; f.files.set(edges.left.wall.source.path, damaged);
  rejects(() => validateTerrainEdgeJunctions(edges.junctions, edges, { readAsset: f.readAsset }), 'TERRAIN_JUNCTION_SOURCE'); f.files.set(edges.left.wall.source.path, original);
  const tampered = structuredClone(edges.junctions); tampered.left.support.minimumNativeCompositeAlpha = 251;
  const { sha256, ...body } = tampered; tampered.sha256 = hash(canonicalJson(body));
  rejects(() => validateTerrainEdgeJunctions(tampered, edges, { readAsset: f.readAsset }), 'TERRAIN_JUNCTION_REPLAY');
});

test('complete PNG heads and tails must really overlap: unsupported first origin and loop holes are rejected without repairing alpha', () => {
  const f = fixture();
  rejects(() => buildTerrainEdgeJunctions(f.edges, { readAsset: f.readAsset, firstWallNativeOriginWorld: { left: 50, right: 50 } }), 'TERRAIN_JUNCTION_SUPPORT');
  rejects(() => buildTerrainEdgeJunctions(f.edges, { readAsset: f.readAsset, wallStepWorld: { left: 40, right: 40 } }), 'TERRAIN_JUNCTION_SUPPORT');
  rejects(() => buildTerrainEdgeJunctions(f.edges, { readAsset: f.readAsset, wallStepWorld: { left: 1, right: 1 } }), 'TERRAIN_JUNCTION_CONTEXT');
  rejects(() => buildTerrainEdgeJunctions(f.edges, { readAsset: f.readAsset, firstWallNativeOriginWorld: { left: 20 } }), 'TERRAIN_JUNCTION_PROFILE');
  const over = structuredClone(f.edges); over.left.corner.scale = { numerator: 6, denominator: 1 };
  rejects(() => buildTerrainEdgeJunctions(over, { readAsset: f.readAsset }), 'TERRAIN_JUNCTION_CONTEXT');
});

test('native soft alpha stays unchanged while original source-over supplies the explicit minimum support', () => {
  const f = fixture({ alpha: 252 }), before = new Map([...f.files].map(([path, b]) => [path, Buffer.from(b)])), edges = upgrade(f);
  for (const side of ['left', 'right']) assert(edges.junctions[side].support.minimumNativeCompositeAlpha >= 252);
  validateTerrainEdges(edges, f.appearance, { readAsset: f.readAsset });
  for (const [path, b] of before) assert.deepEqual(f.files.get(path), b);
  const weak = fixture({ alpha: 249 }); rejects(() => buildTerrainEdgeJunctions(weak.edges, { readAsset: weak.readAsset }), 'TERRAIN_JUNCTION_SUPPORT');
});

test('curve joins draw complete lower wall sources before upper walls and retain the full native corner last', () => {
  const f = fixture(), edges = upgrade(f), original = curve({ slope: true }), before = structuredClone(original), result = compileTerrainEdges([original], edges, { world });
  assert.deepEqual(original, before); assert.deepEqual(result.curves[0].contour, original.contour); assert.deepEqual(result.curves[0].surface, original.surface);
  assert.equal(result.report.junctionProfile, 'native-alpha-complete-overlap-v1'); assert.equal(result.report.transitionBlend, 'original-alpha-contours-no-added-feather');
  for (const side of ['left', 'right']) {
    const rows = result.curves[0].edgeMeshes.filter(m => m.side === side), firstCorner = rows.findIndex(m => m.part === 'corner');
    assert(firstCorner > 0); assert(rows.slice(firstCorner).every(m => m.part === 'corner'));
    const wallOrigins = [...new Set(rows.filter(m => m.part === 'wall').map(m => m.nativeOriginWorld))];
    assert(wallOrigins.length > 3); assert(wallOrigins.every((value, n) => !n || value < wallOrigins[n - 1]));
    assert(rows.every(m => m.nativeVerticalRange.fromY === 0 && m.nativeVerticalRange.toY === 80));
    assert(rows.every(m => m.positions.every(Number.isFinite) && m.uvs.every(v => v >= -1e-6 && v <= 1 + 1e-6)));
    assert(rows.every(m => m.positions.filter((_, n) => n % 2).every(y => y <= 440 + 1e-6)));
  }
});

test('complete corner pixels below the former hard cut visibly replace the truncated wall in the shared CPU renderer', () => {
  const f = fixture(), edges = upgrade(f), original = curve({ bottom: 220 }), current = compileTerrainEdges([original], edges, { world }).curves[0], old = compileTerrainEdges([original], f.edges, { world, gridUnion: true }).curves[0];
  const bytes = encodeRgbaPng(1, 1, Buffer.from([200, 0, 0, 255])); f.files.set('body.png', bytes);
  const scene = { defaultCamera: { center: { x: 128, y: 128 }, viewport: { width: 256, height: 256 } }, layers: [{ layerId: 'terrain', visible: true, nodes: [] }],
    terrainMaterial: { body: { source: { path: 'body.png', sha256: hash(bytes) } }, cap: { source: { path: 'body.png', sha256: hash(bytes) } } } };
  const oldImage = inspectPng(renderCoherentFrame({ ...scene, curveTerrains: [old] }, f.readAsset), { includePixels: true }), newImage = inspectPng(renderCoherentFrame({ ...scene, curveTerrains: [current] }, f.readAsset), { includePixels: true });
  const pixel = (image, x, y) => [...image.rgba.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];
  assert.deepEqual(pixel(oldImage, 71, 53), [140, 75, 35, 255]);
  assert.deepEqual(pixel(newImage, 71, 53), [140, 90, 35, 255], 'the complete corner boulder tail owns this pixel below the old y48 cut');
});

test('actual grid boundary segments use the same complete overlap, preserve holes and never add per-cell junction corners', () => {
  const f = fixture(), edges = upgrade(f), map = cells([[2, 1], [3, 1], [2, 2], [3, 2], [2, 3], [3, 3], [2, 4], [3, 4], [2, 5], [3, 5]]), before = [...map];
  const result = gridCompile(map, f, edges); assert.deepEqual([...map], before); assert.equal(result.report.placed.length, 2);
  assert(result.report.placed.every(row => row.completeCornerDrawnLast && row.completeCornerNativeToY === 80 && row.nativeWallSegmentCount > 3));
  for (const side of ['left', 'right']) {
    const meshes = result.gridTerrains[0].edgeMeshes.filter(m => m.side === side), first = meshes.findIndex(m => m.part === 'corner');
    assert(meshes.slice(first).every(m => m.part === 'corner')); assert(meshes.every(m => m.unionSide.fromY === 64 && m.unionSide.toY === 384));
  }
  map.delete('3,3'); const notch = gridCompile(map, f, edges);
  assert(notch.report.placed.some(row => !row.cornerApplied && row.fromY === 192 && row.toY === 256));
  assert(notch.report.placed.filter(row => !row.cornerApplied).every(row => row.firstWallNativeOriginWorld === -4 && !row.completeCornerDrawnLast));
});

test('new complete overlap is opt-in and does not mutate v1 through v4 compile bytes or source data', () => {
  const base = terrainEdgesFixture(), f = fixture(), original = curve();
  for (const version of [1, 2, 3, 4]) {
    const e = structuredClone(version === 1 ? base.edges : f.edges); e.format = `ai_scene_terrain_edges_v${version}`;
    if (version < 4) delete e.gridProfile;
    if (version < 3) for (const side of ['left', 'right']) for (const part of ['wall', 'corner']) delete e[side][part].inboardBlend;
    const options = { world, ...(version === 4 ? { gridUnion: true } : {}) }, before = JSON.stringify(compileTerrainEdges([original], e, options));
    compileTerrainEdges([original], upgrade(f), { world });
    assert.equal(JSON.stringify(compileTerrainEdges([original], e, options)), before);
  }
});
