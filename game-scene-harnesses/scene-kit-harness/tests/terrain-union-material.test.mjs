import test from 'node:test';
import assert from 'node:assert/strict';
import { compileGridTerrainFields } from '../src/grid-terrain.mjs';
import { compileCurveGeometry } from '../src/curves.mjs';
import { compileTerrainUnionMaterial, TERRAIN_UNION_MATERIAL_PROFILE } from '../src/terrain-union-material.mjs';

const grid = { width: 64, height: 64 }, appearance = { format: 'ai_scene_continuous_terrain_appearance_v6',
  surfaceOriginInBodyPixels: { numerator: -40, denominator: 1 }, capDepth: { numerator: 36, denominator: 1 },
  capUvEnd: { numerator: 1, denominator: 1 }, surfaceMappingSha256: 'a'.repeat(64) };
const cells = points => new Map(points.map(([x, y]) => [`${x},${y}`, 'terrain.primary']));
const fields = points => compileGridTerrainFields(cells(points), { grid, appearance, layerId: 'ground' });
const curve = (id, fromX, toX, top, base) => ({ ...compileCurveGeometry({ curveId: id, familyId: 'terrain.primary',
  points: [{ x: fromX, y: top, slope: 0 }, { x: toX, y: top, slope: 0 }], baseY: base }, 16), layerId: 'ground' });
const compile = (points, curves = []) => compileTerrainUnionMaterial({ gridTerrains: fields(points), curveTerrains: curves, appearance, grid });
function samples(mesh, x, y) {
  const values = [];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const ids = mesh.indices.slice(i, i + 3), p = ids.map(n => ({ x: mesh.positions[n * 2], y: mesh.positions[n * 2 + 1] })),
      [a, b, c] = p, denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(denominator) < 1e-10) continue;
    const u = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / denominator,
      v = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / denominator, weights = [u, v, 1 - u - v];
    if (Math.min(...weights) < -1e-7) continue;
    values.push([0, 1].map(axis => ids.reduce((sum, id, j) => sum + mesh.uvs[id * 2 + axis] * weights[j], 0)));
  }
  return values;
}
const near = (a, b, message = '') => assert(Math.abs(a - b) < 2e-8, `${message}: ${a} != ${b}`);
function sameSamples(mesh, x, y) {
  const values = samples(mesh, x, y); assert(values.length > 0, `missing ${x},${y}`);
  for (const uv of values) { near(uv[0], values[0][0]); near(uv[1], values[0][1]); }
  return values[0];
}

test('partial upward extension shares fixed world body coordinates across old column and row boundaries without warping', () => {
  const points = [[2, 2], [3, 2], [1, 3], [2, 3], [3, 3], [1, 4], [2, 4], [3, 4]], input = fields(points), before = structuredClone(input),
    result = compileTerrainUnionMaterial({ gridTerrains: input, curveTerrains: [], appearance, grid }), body = result.gridTerrains[0].body;
  assert.deepEqual(input, before); assert.equal(result.report.profile, TERRAIN_UNION_MATERIAL_PROFILE); assert.equal(result.report.groups.length, 1);
  for (let y = 192; y < 320; y += 3.25) sameSamples(body, 128, y);
  for (let x = 128; x < 256; x += 3.25) sameSamples(body, x, 192);
  assert.equal(result.gridTerrains[0].stepPhase, 'fixed-world-body-no-column-or-owner-reset-v1');
  assert.deepEqual(result.report.bodyJacobian,{dUdX:1/512,dUdY:0,dVdX:0,dVdY:1/256});
  for(let i=0;i<body.positions.length;i+=2){near(body.uvs[i],body.positions[i]/512);near(body.uvs[i+1],body.positions[i+1]/256);}
  const p=sameSamples(body,160,230),right=sameSamples(body,172,230),down=sameSamples(body,160,242);
  near((right[0]-p[0])/12,1/512);near((right[1]-p[1])/12,0);near((down[0]-p[0])/12,0);near((down[1]-p[1])/12,1/256);
  const old=compile(points.filter(([,y])=>y>=3)).gridTerrains[0];
  for(const [x,y]of [[145,211],[174,250],[220,279]])assert.deepEqual(sameSamples(body,x,y),sameSamples(old.body,x,y),'adding cells above must retain the old body phase');
});

test('flat tops retain local source-strip coordinates with declared bottom source-over bands inside the original solid', () => {
  const result = compile([[2, 2], [3, 2], [2, 3], [3, 3]]), patch = result.gridTerrains[0],bands=patch.capBands;
  assert.deepEqual(patch.cap,{positions:[],uvs:[],indices:[]});assert.equal(bands.length,25);assert.equal(result.report.capFadeWorld,12);
  for (const depth of [0, 4, 16, 24.25, 31.25, 35.75]) {
    const body = sameSamples(patch.body, 180, 128 + depth), values=bands.flatMap(band=>samples(band,180,128+depth));
    near(body[1],(128+depth)/256);assert(values.length>0);for(const uv of values){near(uv[0],180/512);near(uv[1],depth/36);}
  }
  assert.equal(bands[0].coverageOpacity,1);assert.deepEqual(bands[0].localDepth,{fromWorld:0,toWorld:24});
  for(let i=1;i<bands.length;i++){near(bands[i].coverageOpacity,1-(i-.5)/24);assert.equal(bands[i].coverageProfile,'local-surface-bottom-source-over-v1');
    assert.equal(bands[i].sourcePngChanged,false);assert(bands[i].coverageOpacity<bands[i-1].coverageOpacity);}
  assert.equal(bands.flatMap(band=>samples(band,180,164.01)).length,0);assert.equal(bands.flatMap(band=>samples(band,120,140)).length,0);
  for(const band of bands)for (let i = 0; i < band.positions.length; i += 2) assert(samples(patch.body, band.positions[i], band.positions[i + 1]).length);
});

test('touching curve and grid use the same affine body mapping even where their input diagonals differ', () => {
  const original = curve('curve.touching', 256, 400, 175, 384), originalCopy = structuredClone(original),
    result = compile([[2, 2], [3, 2], [2, 3], [3, 3], [2, 4], [3, 4]], [original]),
    a = result.gridTerrains[0], b = result.curveTerrains[0];
  assert.equal(result.report.groups.length, 1); assert.equal(result.report.groups[0].ownerIds.length, 2);
  for (let y = 175; y < 320; y += 1.7) {
    const va = sameSamples(a.body, 256, y), vb = sameSamples(b.body, 256, y); near(va[0], vb[0]); near(va[1], vb[1]);
  }
  assert.deepEqual(original, originalCopy); assert.deepEqual(b.contour, original.contour); assert.deepEqual(b.surface, original.surface);
});

test('a grid stacked over a curve suppresses the buried curve top and carries one body field through their horizontal join', () => {
  const result = compile([[2, 2], [3, 2]], [curve('curve.below', 96, 288, 192, 384)]), a = result.gridTerrains[0], b = result.curveTerrains[0], group = result.report.groups[0];
  assert.equal(group.ownerIds.length, 2);
  assert(!group.exposedNorthSegments.some(s => s.ownerId === 'curve.below' && s.from.x < 256 && s.to.x > 128));
  assert.equal(b.capBands.flatMap(band=>samples(band,192,192)).length, 0, 'the old buried cap does not form a grass stripe inside the union');
  for (let x = 128; x < 256; x += 2.3) { const va = sameSamples(a.body, x, 192), vb = sameSamples(b.body, x, 192); near(va[1], vb[1]); }
  assert(b.capBands.some(band=>samples(band,110,192).length), 'the uncovered curve ledge remains visible');
});

test('a curve over a grid suppresses buried grid north faces while retaining the uncovered ledge', () => {
  const result = compile([[1, 3], [2, 3], [3, 3], [4, 3]], [curve('curve.above', 128, 256, 128, 192)]), a = result.gridTerrains[0], b = result.curveTerrains[0];
  assert.equal(result.report.groups[0].ownerIds.length, 2); assert.equal(a.capBands.flatMap(band=>samples(band,192,192)).length, 0);
  assert(a.capBands.some(band=>samples(band,90,192).length));
  for (let x = 128; x < 256; x += 2.3) { const va = sameSamples(a.body, x, 192), vb = sameSamples(b.body, x, 192); near(va[1], vb[1]); }
});

test('holes, one-cell overhangs and diagonal contacts keep original occupancy without joining detached source fields', () => {
  const ring = []; for (let y = 2; y <= 4; y++) for (let x = 2; x <= 4; x++) if (x !== 3 || y !== 3) ring.push([x, y]);
  const result = compile(ring), patch = result.gridTerrains[0];
  assert.equal(samples(patch.body, 220, 220).length, 0); assert.equal(patch.capBands.flatMap(band=>samples(band,220,220)).length, 0);
  assert(patch.capBands.some(band=>samples(band,220,256).length), 'hole floor retains an exposed north face');
  const overhang = compile([[2, 2], [3, 2], [2, 3]]).gridTerrains[0];
  assert.equal(samples(overhang.body, 220, 220).length, 0); assert.equal(overhang.capBands.flatMap(band=>samples(band,220,220)).length, 0);
  const detached = curve('detached', 128, 192, 64, 128), split = compile([[1, 2]], [detached]);
  assert.equal(split.report.groups[0].ownerIds.length, 1, 'a diagonal point is not a shared material component');
  assert.deepEqual(split.curveTerrains[0], detached);
  const standalone = compileTerrainUnionMaterial({ gridTerrains: [], curveTerrains: [detached], appearance, grid });
  assert.deepEqual(standalone.curveTerrains, [detached]); assert.equal(standalone.report.outputTriangles, 0);
});

test('detached grid components cannot affect each other through empty space and results are deterministic', () => {
  const alone = compile([[2, 2], [2, 3]]), together = compile([[2, 2], [2, 3], [4, 4]]), a = alone.gridTerrains[0], b = together.gridTerrains.find(p => p.gridTerrainId === a.gridTerrainId);
  assert.deepEqual(a.body, b.body); assert.deepEqual(a.capBands, b.capBands); assert.equal(together.report.groups.length, 2);
  assert.deepEqual(together, compile([[4, 4], [2, 3], [2, 2]]));
});

test('budget exhaustion fails explicitly and never returns a partial remapped scene', () => {
  const patch = fields([[2, 2]])[0],input=Array.from({length:2049},(_,i)=>({...structuredClone(patch),gridTerrainId:'budget.'+i})),before=structuredClone(input);
  assert.throws(() => compileTerrainUnionMaterial({ gridTerrains: input, curveTerrains: [], appearance, grid }), error => error.errors?.some(issue => issue.code === 'TERRAIN_UNION_BUDGET'));
  assert.deepEqual(input, before);
});
