import test from 'node:test';
import assert from 'node:assert/strict';
import { Texture } from 'pixi.js';
import { validateTerrainEdges, compileTerrainEdges, terrainEdgeSources, validateTerrainEdgeJoin, NEAR_OPAQUE_JOIN_PROFILE } from '../src/terrain-edges.mjs';
import { compileCurveGeometry } from '../src/curves.mjs';
import { createSceneView } from '../src/pixi/scene-view.mjs';
import { loadTerrainMaterial } from '../src/pixi/materials.mjs';
import { renderCoherentFrame } from '../src/coherent-render.mjs';
import { paintCoherentMesh } from '../src/coherent-mesh-render.mjs';
import { encodeRgbaPng, inspectPng } from '../src/png.mjs';
import { hash } from '../src/generation/common.mjs';
import { terrainEdgesFixture } from './helpers/terrain-edges.mjs';

const world = { x: 0, y: 0, width: 256, height: 160 };
const curve = (curveId = 'cliff', left = 32, right = 160, top = 24, bottom = 153) => ({ ...compileCurveGeometry({ curveId, familyId: 'terrain.primary',
  points: [{ x: left, y: top, slope: 0 }, { x: right, y: top, slope: 0 }], baseY: bottom }, 16), layerId: 'terrain' });
const rejects = (fn, code) => assert.throws(fn, error => error.errors?.some(issue => issue.code === code));
const pixel = (png, x, y) => [...png.rgba.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4)];
const bounds = mesh => { const xs = mesh.positions.filter((_, i) => i % 2 === 0), ys = mesh.positions.filter((_, i) => i % 2 === 1);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }; };
const covers = (mesh, x, y) => {
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const [a, b, c] = mesh.indices.slice(i, i + 3).map(n => ({ x: mesh.positions[n * 2], y: mesh.positions[n * 2 + 1] }));
    const den = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y); if (Math.abs(den) < 1e-9) continue;
    const u = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / den, v = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / den;
    if (Math.min(u, v, 1 - u - v) > 1e-7) return true;
  } return false;
};

test('explicit left and right artwork binds the current material, native scale, rows and opaque joining collars', () => {
  const { edges, files, appearance } = terrainEdgesFixture(), before = structuredClone(edges);
  assert.equal(validateTerrainEdges(edges, appearance, { readAsset: path => files.get(path) }), edges);
  assert.equal(terrainEdgeSources(edges).length, 4); assert.deepEqual(edges, before);
  const invalid = change => { const value = structuredClone(edges); change(value); return () => validateTerrainEdges(value, appearance, { readAsset: path => files.get(path) }); };
  rejects(invalid(e => e.sourceBinding.surfaceMappingSha256 = 'c'.repeat(64)), 'TERRAIN_EDGE_BINDING');
  rejects(invalid(e => e.left.wall.scale.numerator = 3), 'TERRAIN_EDGE_SCALE');
  rejects(invalid(e => e.left.wall.innerX = 15), 'TERRAIN_EDGE_JOIN');
  rejects(invalid(e => e.right.corner.innerX--), 'TERRAIN_EDGE_JOIN');
  rejects(invalid(e => e.left.wall.repeatY.to = 81), 'TERRAIN_EDGE_ROWS');
  rejects(invalid(e => e.right.wall.source = e.left.wall.source), 'TERRAIN_EDGE_SOURCE');
  rejects(invalid(e => e.left.wall.source.path = 'edges/../bad.png'), 'TERRAIN_EDGE_SOURCE');
  rejects(() => validateTerrainEdges(edges, { ...appearance, format: 'ai_scene_continuous_terrain_appearance_v4' }), 'TERRAIN_EDGE_BINDING');
  const item = edges.left.wall, png = inspectPng(files.get(item.source.path), { includePixels: true });
  png.rgba[(10 * png.width + item.innerX) * 4 + 3] = 254;
  const damaged = encodeRgbaPng(png.width, png.height, png.rgba); item.source.sha256 = hash(damaged); item.source.byteLength = damaged.length; files.set(item.source.path, damaged);
  rejects(() => validateTerrainEdges(edges, appearance, { readAsset: path => files.get(path) }), 'TERRAIN_EDGE_OPAQUE_JOIN');
});

test('native side strips repeat along height and crop the final segment without changing axes, contours or collision geometry', () => {
  const { edges } = terrainEdgesFixture(), original = curve(), before = structuredClone(original), result = compileTerrainEdges([original], edges, { world });
  const rendered = result.curves[0]; assert.deepEqual(original, before); assert.deepEqual(rendered.contour, before.contour); assert.deepEqual(rendered.surface, before.surface);
  assert.equal(result.report.placed.length, 2); assert.equal(result.report.collision, 'original-contours-unchanged');
  for (const side of ['left', 'right']) {
    const meshes = rendered.edgeMeshes.filter(m => m.side === side), corner = meshes.find(m => m.part === 'corner'), walls = meshes.filter(m => m.part === 'wall');
    assert.equal(bounds(corner).width, 24); assert.equal(bounds(corner).height, 32);
    assert.equal(walls.length, 4); assert.equal(bounds(walls[0]).y, 48); assert.equal(bounds(walls.at(-1)).y + bounds(walls.at(-1)).height, 153);
    assert.equal(bounds(walls[0]).width, 24); assert.equal(bounds(walls[0]).height, 32);
    assert.equal(bounds(walls.at(-1)).height, 9);
    for (const mesh of walls) {
      const columns = mesh.positions.filter((_, i) => i % 2 === 0).map((x, i) => ({ x, u: mesh.uvs[i * 2] })).sort((a, b) => a.x - b.x);
      assert(columns.every((col, i) => !i || col.u >= columns[i - 1].u - 1e-6), 'the right side is not mirrored');
    }
    assert(Math.max(...walls.at(-1).uvs.filter((_, i) => i % 2)) < Math.max(...walls[0].uvs.filter((_, i) => i % 2)), 'the last partial row range is cropped');
  }
  assert(result.curves[0].body.positions.every(Number.isFinite)); assert.equal(result.report.visualAcceptance, 'not-assessed');
});

test('fractional corner joins require opaque bilinear collar rows on both sides of the native boundary', () => {
  const { edges, files, appearance } = terrainEdgesFixture(); edges.left.corner.wallStartY = 65;
  const original = curve(), placed = compileTerrainEdges([original], edges, { world });
  assert.equal(placed.report.placed.find(row => row.side === 'left').cornerEndY, 48.5);
  assert.equal(validateTerrainEdges(edges, appearance, { readAsset: path => files.get(path) }), edges);
  const damage = (part, y) => {
    const item = edges.left[part], png = inspectPng(files.get(item.source.path), { includePixels: true });
    for (let x = item.innerX - 1; x <= item.innerX + 1; x++) png.rgba.fill(0, (y * png.width + x) * 4, (y * png.width + x) * 4 + 4);
    const bytes = encodeRgbaPng(png.width, png.height, png.rgba); files.set(item.source.path, bytes); item.source.sha256 = hash(bytes); item.source.byteLength = bytes.length;
  };
  const cornerPath = edges.left.corner.source.path, savedCorner = files.get(cornerPath), savedSource = structuredClone(edges.left.corner.source);
  damage('corner', 65); rejects(() => validateTerrainEdges(edges, appearance, { readAsset: path => files.get(path) }), 'TERRAIN_EDGE_OPAQUE_JOIN');
  files.set(cornerPath, savedCorner); edges.left.corner.source = savedSource;
  damage('wall', 7); rejects(() => validateTerrainEdges(edges, appearance, { readAsset: path => files.get(path) }), 'TERRAIN_EDGE_OPAQUE_JOIN');
});

test('actual transparent side recesses expose the background after body and top-cap cutback in two material palettes', () => {
  for (const palette of ['autumn', 'snow']) {
    const { edges, files } = terrainEdgesFixture({ palette }), original = curve(), changed = compileTerrainEdges([original], edges, { world }).curves[0];
    const png = (name, color) => { const bytes = encodeRgbaPng(1, 1, Buffer.from(color)); files.set(name, bytes); return { source: { path: name, sha256: hash(bytes) } }; };
    const body = png('body.png', [200, 0, 0, 255]), cap = png('cap.png', [200, 0, 0, 255]);
    const scene = { defaultCamera: { center: { x: 128, y: 80 }, viewport: { width: 256, height: 160 } },
      layers: [{ layerId: 'terrain', visible: true, nodes: [] }], terrainMaterial: { body, cap }, curveTerrains: [changed] };
    const output = inspectPng(renderCoherentFrame(scene, path => files.get(path)), { includePixels: true });
    const baseline = inspectPng(renderCoherentFrame({ ...scene, curveTerrains: [original] }, path => files.get(path)), { includePixels: true });
    assert.deepEqual(pixel(baseline, 32, 28), [200, 0, 0, 255]);
    assert.deepEqual(pixel(output, 32, 28), [29, 43, 59, 255], 'the old top cap must also be cut back behind corner recesses');
    assert.deepEqual(pixel(baseline, 32, 58), [200, 0, 0, 255]);
    assert.deepEqual(pixel(output, 32, 58), [29, 43, 59, 255], 'the old straight body edge must not show behind transparent rock recesses');
    assert.deepEqual(pixel(output, 39, 58), palette === 'autumn' ? [140, 75, 35, 255] : [145, 170, 220, 255]);
    assert.deepEqual(pixel(output, 51, 58), [200, 0, 0, 255], 'paint beyond the side artwork overlap is retained');
  }
});

test('world borders, touching or partially covered sides and grid contacts are skipped explicitly without false cutback', () => {
  const { edges } = terrainEdgesFixture();
  const border = compileTerrainEdges([curve('border', 0, 128)], edges, { world });
  assert(border.report.skipped.some(row => row.side === 'left' && row.reason === 'world-boundary'));
  const a = curve('a', 32, 128), b = curve('b', 128, 224, 56), shared = compileTerrainEdges([a, b], edges, { world });
  assert(shared.report.skipped.some(row => row.curveId === 'a' && row.side === 'right' && row.reason === 'shared-or-partially-occluded-side-not-supported'));
  assert(shared.report.skipped.some(row => row.curveId === 'b' && row.side === 'left'));
  assert(shared.curves[0].edgeMeshes.every(edge => edge.side === 'left')); assert(shared.curves[1].edgeMeshes.every(edge => edge.side === 'right'));
  const touched = compileTerrainEdges([curve('grid', 64, 192)], edges, { world, cells: new Map([['0,1', 'terrain.primary']]) });
  assert(touched.report.skipped.some(row => row.side === 'left' && row.reason === 'shared-or-partially-occluded-side-not-supported'));
  const narrowEdges = structuredClone(edges); for (const side of ['left', 'right']) for (const part of ['wall', 'corner']) narrowEdges[side][part].scale = { numerator: 1, denominator: 1 };
  const narrow = curve('narrow', 32, 64); rejects(() => compileTerrainEdges([narrow], narrowEdges, { world }), 'TERRAIN_EDGE_NARROW_SOLID');
});

test('column projection follows rising tops while removing original paint above endpoint Y and preserving native vertical scale', () => {
  const { edges } = terrainEdgesFixture(), original = { ...compileCurveGeometry({ curveId: 'hill', familyId: 'terrain.primary', baseY: 160,
    points: [{ x: 32, y: 64, slope: 0 }, { x: 96, y: 32, slope: 0 }, { x: 160, y: 64, slope: 0 }] }, 16), layerId: 'terrain' };
  const result = compileTerrainEdges([original], edges, { world }), rendered = result.curves[0];
  assert.equal(result.report.placed.length, 2); assert.equal(result.report.cornerProjection, 'sampled-surface-column-offset-v1');
  assert.deepEqual(rendered.contour, original.contour); assert.deepEqual(rendered.surface, original.surface);
  assert(covers(original.body, 156, 63.75)); assert(!covers(rendered.body, 156, 63.75)); assert(!covers(rendered.cap, 156, 63.75));
  for (const side of ['left', 'right']) {
    const corner = rendered.edgeMeshes.find(mesh => mesh.side === side && mesh.part === 'corner'), wall = rendered.edgeMeshes.find(mesh => mesh.side === side && mesh.part === 'wall');
    assert(corner.positions.filter((_, i) => i % 4 === 1).some(y => y < 56), 'interior native columns must move up with the rising surface');
    for (let i = 0; i < corner.positions.length; i += 4) assert.equal(corner.positions[i + 3] - corner.positions[i + 1], 32);
    for (let i = 0; i < corner.positions.length; i += 4) {
      const x = corner.positions[i], index = wall.positions.findIndex((value, j) => j % 4 === 0 && Math.abs(value - x) < 1e-6);
      assert(index >= 0); assert.equal(corner.positions[i + 3], wall.positions[index + 1]);
    }
  }
});

test('current watermill slopes receive their two inward side covers without flattening the reviewed author geometry', () => {
  const { edges } = terrainEdgesFixture(), input = [
    { curveId: 'left.ground', points: [{ x: 0, y: 314, slope: 0 }, { x: 110, y: 312, slope: 0 }, { x: 230, y: 315, slope: .025 }, { x: 327, y: 320, slope: 0 }] },
    { curveId: 'right.ground', points: [{ x: 844, y: 324, slope: 0 }, { x: 920, y: 314, slope: -.058 }, { x: 1023, y: 308, slope: 0 }] },
  ].map(value => ({ ...compileCurveGeometry({ ...value, familyId: 'terrain.primary', baseY: 576 }, 37.25, { profile: 'measured-source-depth-v1' }), layerId: 'terrain' }));
  const before = structuredClone(input), result = compileTerrainEdges(input, edges, { world: { x: 0, y: 0, width: 1024, height: 576 } });
  assert(result.report.placed.some(row => row.curveId === 'left.ground' && row.side === 'right'));
  assert(result.report.placed.some(row => row.curveId === 'right.ground' && row.side === 'left'));
  assert.equal(result.report.placed.length, 2); assert.equal(result.report.worldBorderTolerance, 1);
  assert(result.report.skipped.some(row => row.curveId === 'right.ground' && row.side === 'right' && row.reason === 'world-boundary'));
  assert.deepEqual(input, before); assert.deepEqual(result.curves.map(c => c.contour), before.map(c => c.contour));
  assert(result.curves.flatMap(c => c.edgeMeshes ?? []).every(mesh => mesh.positions.every(Number.isFinite)
    && mesh.positions.filter((_, i) => i % 2 === 1).every(y => y <= 576)));
});

test('Pixi resolves all side resources before replacing the current scene and terrain moves include side meshes', () => {
  const { edges } = terrainEdgesFixture(), c = compileTerrainEdges([curve()], edges, { world }).curves[0];
  const scene = { format: 'ai_scene_compiled_v7', layers: [{ layerId: 'terrain', visible: true, nodes: [], parallax: { x: 1, y: 1 } }],
    defaultCamera: { center: { x: 128, y: 80 } }, terrainMaterial: {}, curveTerrains: [c] };
  let material = { body: Texture.WHITE, cap: Texture.WHITE, edges: Object.fromEntries(terrainEdgeSources(edges).map(item => [item.key, Texture.WHITE])) };
  const view = createSceneView({ resolveTexture: () => Texture.WHITE, resolveCurveMaterial: () => material });
  view.update(scene); const old = view.root.children[0], children = old.children;
  assert.equal(children.length, 2 + c.edgeMeshes.length);
  view.previewTerrain({ cellKeys: new Set(), instanceIds: [], assemblyIds: [], curveIds: ['cliff'] }, { dx: 7, dy: 9 });
  assert(children.every(mesh => mesh.position.x === 7 && mesh.position.y === 9)); view.resetPreview();
  material = { ...material, edges: {} }; assert.throws(() => view.update(scene), /side material/); assert.equal(view.root.children[0], old);
  view.destroy();
});

test('side artwork clamps both UV axes while legacy body and top-cap sampler policies remain unchanged', async () => {
  const { edges } = terrainEdgesFixture(), calls = [], material = await loadTerrainMaterial({ body: { source: {} }, cap: { source: {} }, edges }, async (item, key) => {
    const texture = { source: { style: {} } }; calls.push({ item, key, texture }); return texture;
  });
  assert.equal(calls.length, 6); assert.equal(material.body.source.style.addressModeU, 'repeat'); assert.equal(material.body.source.style.addressModeV, 'repeat');
  assert.equal(material.cap.source.style.addressModeU, 'repeat'); assert.equal(material.cap.source.style.addressModeV, 'clamp-to-edge');
  for (const texture of Object.values(material.edges)) {
    assert.equal(texture.source.style.addressModeU, 'clamp-to-edge'); assert.equal(texture.source.style.addressModeV, 'clamp-to-edge'); assert.equal(texture.source.scaleMode, 'linear');
  }
});

const softFixture = (alpha = 252) => {
  const fixture = terrainEdgesFixture();
  for (const side of ['left', 'right']) for (const part of ['wall', 'corner']) {
    const item = fixture.edges[side][part], png = inspectPng(fixture.files.get(item.source.path), { includePixels: true });
    for (let p = 3; p < png.rgba.length; p += 4) if (png.rgba[p]) png.rgba[p] = alpha;
    const bytes = encodeRgbaPng(png.width, png.height, png.rgba); fixture.files.set(item.source.path, bytes);
    item.source.sha256 = hash(bytes); item.source.byteLength = bytes.length;
  }
  return fixture;
};

test('versioned near-opaque joins accept native 250–254 collars without raising alpha while v1 retains strict 255 checks', () => {
  const { edges, files, appearance } = softFixture(), saved = new Map([...files].map(([path, bytes]) => [path, Buffer.from(bytes)]));
  rejects(() => validateTerrainEdges(edges, appearance, { readAsset: path => files.get(path) }), 'TERRAIN_EDGE_OPAQUE_JOIN');
  const v2 = { ...structuredClone(edges), format: 'ai_scene_terrain_edges_v2', joinProfile: NEAR_OPAQUE_JOIN_PROFILE };
  assert.equal(validateTerrainEdges(v2, appearance, { readAsset: path => files.get(path) }), v2);
  const item = v2.left.wall, checked = validateTerrainEdgeJoin(item, { side: 'left', part: 'wall', joinProfile: v2.joinProfile, readAsset: path => files.get(path) });
  assert.equal(checked.collar.minimumAlpha, 252); assert.equal(checked.collar.requiredMinimumAlpha, 250);
  assert.equal(checked.alphaRaised, false); assert.equal(checked.nativeAlphaUnchanged, true); assert.equal(checked.visibleRgbaChanged, false);
  for (const [path, bytes] of saved) assert.deepEqual(files.get(path), bytes);
  const update = alpha => {
    const png = inspectPng(files.get(item.source.path), { includePixels: true }); png.rgba[(7 * png.width + item.innerX) * 4 + 3] = alpha;
    const bytes = encodeRgbaPng(png.width, png.height, png.rgba); files.set(item.source.path, bytes); item.source.sha256 = hash(bytes); item.source.byteLength = bytes.length;
  };
  update(250); assert.equal(validateTerrainEdgeJoin(item, { side: 'left', part: 'wall', joinProfile: v2.joinProfile, readAsset: path => files.get(path) }).collar.minimumAlpha, 250);
  update(249); rejects(() => validateTerrainEdges(v2, appearance, { readAsset: path => files.get(path) }), 'TERRAIN_EDGE_NEAR_OPAQUE_JOIN');
  rejects(() => validateTerrainEdges({ ...v2, joinProfile: 'arbitrary-alpha-tolerance' }, appearance), 'TERRAIN_EDGE_SHAPE');
  rejects(() => validateTerrainEdges({ ...edges, joinProfile: NEAR_OPAQUE_JOIN_PROFILE }, appearance), 'TERRAIN_EDGE_SHAPE');
  const { joinProfile, ...missing } = v2; rejects(() => validateTerrainEdges(missing, appearance), 'TERRAIN_EDGE_SHAPE');
});

test('v2 leaves one native pixel of body under the joining collar and preserves residual native transparency outside it', () => {
  const { edges, files, appearance } = softFixture();
  for (const side of ['left', 'right']) for (const part of ['wall', 'corner']) edges[side][part].scale = { numerator: 1, denominator: 1 };
  const original = curve(), strict = compileTerrainEdges([original], edges, { world }), strictBytes = JSON.stringify(strict);
  const v2 = { ...structuredClone(edges), format: 'ai_scene_terrain_edges_v2', joinProfile: NEAR_OPAQUE_JOIN_PROFILE };
  validateTerrainEdges(v2, appearance, { readAsset: path => files.get(path) });
  const result = compileTerrainEdges([original], v2, { world }), mesh = result.curves[0];
  assert.equal(result.report.format, 'ai_scene_terrain_edge_placement_v2');
  assert(result.report.placed.every(row => row.underlapWorld === 1 && row.nativeAlphaUnchanged && row.residualNativeTransparencyPreserved));
  assert(!covers(strict.curves[0].body, 47.75, 90)); assert(covers(mesh.body, 47.75, 90));
  assert.deepEqual(mesh.contour, original.contour); assert.deepEqual(mesh.surface, original.surface);
  const png = encodeRgbaPng(1, 1, Buffer.from([200, 0, 0, 255])); files.set('body.png', png);
  const material = { source: { path: 'body.png', sha256: hash(png) } }, scene = {
    defaultCamera: { center: { x: 128, y: 80 }, viewport: { width: 256, height: 160 } },
    layers: [{ layerId: 'terrain', visible: true, nodes: [] }], terrainMaterial: { body: material, cap: material }, curveTerrains: [mesh] };
  const output = inspectPng(renderCoherentFrame(scene, path => files.get(path)), { includePixels: true });
  assert.deepEqual(pixel(output, 47, 90), [141, 74, 35, 255], 'native 252/255 paint composites over retained body in the underlap');
  assert.deepEqual(pixel(output, 36, 90), [139, 75, 35, 255], 'outside the underlap the original slight transparency remains');
  assert.equal(JSON.stringify(compileTerrainEdges([original], edges, { world })), strictBytes); assert.equal(Object.hasOwn(strict.report, 'joinProfile'), false);
});

const blendedFixture = () => {
  const fixture = terrainEdgesFixture(); fixture.edges.format = 'ai_scene_terrain_edges_v3'; fixture.edges.joinProfile = NEAR_OPAQUE_JOIN_PROFILE;
  for (const side of ['left', 'right']) for (const part of ['wall', 'corner']) fixture.edges[side][part].inboardBlend =
    side === 'left' ? { fromX: 32, toX: 46 } : { fromX: 16, toX: 2 };
  return fixture;
};

test('v3 explicit inboard coverage stays behind the joining collar, bounds pieces and preserves original PNG bytes', () => {
  const { edges, files, appearance } = blendedFixture(), before = new Map([...files].map(([path, bytes]) => [path, Buffer.from(bytes)]));
  validateTerrainEdges(edges, appearance, { readAsset: path => files.get(path) });
  const result = compileTerrainEdges([curve()], edges, { world }), pieces = result.curves[0].edgeMeshes;
  assert.equal(result.report.format, 'ai_scene_terrain_edge_placement_v3'); assert.equal(result.report.effectiveRenderAlpha, 'native-alpha-times-coverageOpacity');
  const groups = new Map(); for (const piece of pieces) { const key = piece.edgeId.split('/band.')[0]; groups.set(key, (groups.get(key) ?? 0) + 1); }
  assert([...groups.values()].every(n => n <= 32)); assert(pieces.some(piece => piece.coverageOpacity === 1));
  assert(pieces.some(piece => piece.coverageOpacity > 0 && piece.coverageOpacity < 1));
  assert(pieces.filter(p => p.side === 'left').every(p => p.nativeCoverageInterval.toX <= 46));
  assert(pieces.filter(p => p.side === 'right').every(p => p.nativeCoverageInterval.fromX >= 2));
  assert(result.report.placed.every(row => row.inboardCoverage.effectiveRenderAlphaChanged && row.inboardCoverage.nativePngAlphaUnchanged));
  for (const [path, bytes] of before) assert.deepEqual(files.get(path), bytes);
  for (const change of [e => e.left.wall.inboardBlend.fromX = 31, e => e.right.wall.inboardBlend.fromX = 17,
    e => e.left.wall.inboardBlend.toX = 49, e => e.right.wall.inboardBlend.toX = 17]) {
    const bad = structuredClone(edges); change(bad); rejects(() => validateTerrainEdges(bad, appearance), 'TERRAIN_EDGE_INBOARD_COVERAGE');
  }
  rejects(() => validateTerrainEdges({ ...edges, format: 'ai_scene_terrain_edges_v2' }, appearance), 'TERRAIN_EDGE_SHAPE');
});

test('inboard rendered coverage blends the art into retained body while the outer silhouette retains its original coverage', () => {
  const { edges, files } = blendedFixture(), rendered = compileTerrainEdges([curve()], edges, { world }).curves[0];
  const bytes = encodeRgbaPng(1, 1, Buffer.from([200, 0, 0, 255])); files.set('body.png', bytes);
  const material = { source: { path: 'body.png', sha256: hash(bytes) } }, scene = {
    defaultCamera: { center: { x: 128, y: 80 }, viewport: { width: 256, height: 160 } },
    layers: [{ layerId: 'terrain', visible: true, nodes: [] }], terrainMaterial: { body: material, cap: material }, curveTerrains: [rendered] };
  const output = inspectPng(renderCoherentFrame(scene, path => files.get(path)), { includePixels: true });
  assert.deepEqual(pixel(output, 39, 90), [140, 75, 35, 255]);
  assert.deepEqual(pixel(output, 43, 90), [170, 38, 18, 255]);
  assert.deepEqual(pixel(output, 48, 90), [200, 0, 0, 255]);
  assert.deepEqual(pixel(output, 32, 58), [29, 43, 59, 255], 'the outer transparent recess is retained');
  const view = createSceneView({ resolveTexture: () => Texture.WHITE, resolveCurveMaterial: () => ({ body: Texture.WHITE, cap: Texture.WHITE,
    edges: Object.fromEntries(terrainEdgeSources(edges).map(item => [item.key, Texture.WHITE])) }) });
  view.update({ ...scene, format: 'ai_scene_compiled_v7' });
  assert.deepEqual(view.root.children[0].children.slice(2).map(mesh => mesh.alpha), rendered.edgeMeshes.map(piece => piece.coverageOpacity)); view.destroy();
});

test('v3 diagnostic shared-edge ownership prevents two coverage strips from double-compositing a half-pixel boundary', () => {
  const pixels = Buffer.alloc(3 * 2 * 4); for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
  const quad = (a, b) => ({ positions: [a, 0, a, 2, b, 0, b, 2], uvs: [0, 0, 0, 1, 1, 0, 1, 1], indices: [0, 1, 2, 2, 1, 3] });
  const texture = { width: 1, height: 1, rgba: Buffer.from([200, 100, 50, 255]) };
  for (const mesh of [quad(0, 1.5), quad(1.5, 3)]) paintCoherentMesh(pixels, { width: 3, height: 2 }, mesh, texture,
    { opacity: .5, topLeftRule: true, clampU: true, clampV: true });
  for (let i = 0; i < pixels.length; i += 4) assert.deepEqual([...pixels.subarray(i, i + 4)], [100, 50, 25, 255]);
});
