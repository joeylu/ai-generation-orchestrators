import { demand, uniqueIds } from './errors.mjs';
import { deepFreeze,compareText } from './document.mjs';
import { LAYERED_TERRAIN_PROFILE,gridColumnIndex,gridCurveConflict,curveSolidsOverlap } from './terrain-overlap.mjs';

export const CURVE_PROFILE = deepFreeze({ profile: 'sideview-height-curve-v1',
  interpolation: 'cubic-hermite-linear-x-v1', maximumFlatness: 0.5, maximumChord: 32,
  maximumDepth: 16, maximumSamples: 2048, minimumPointSpacing: 32, maximumSpan: 4096,
  capWidth: 8, minimumDepth: 16, maximumSlope: 2, texturePeriod: 256,
  quantization: 0.000001, endpoints: 'horizontal',
  coexistence: 'separate-horizontal-domains-no-automatic-grid-or-curve-joins',
  collision: 'sampled-closed-contour-and-surface-not-physics-or-walkability',
});
const q = n => Math.round(n * 1000000) / 1000000;
const issue = (condition, code, path, message) => demand(condition, code, 'scene.document.json', path, message);
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export function curveBezier(a, b) {
  const dx = (b.x - a.x) / 3;
  return [{ x: a.x, y: a.y }, { x: a.x + dx, y: a.y + a.slope * dx },
    { x: b.x - dx, y: b.y - b.slope * dx }, { x: b.x, y: b.y }];
}
function split(p) {
  const a = midpoint(p[0], p[1]), b = midpoint(p[1], p[2]), c = midpoint(p[2], p[3]);
  const d = midpoint(a, b), e = midpoint(b, c), f = midpoint(d, e);
  return [[p[0], a, d, f], [f, e, c, p[3]]];
}
function flatness(p) {
  const dx = p[3].x - p[0].x, dy = p[3].y - p[0].y, length = Math.hypot(dx, dy);
  return Math.max(...p.slice(1, 3).map(point => Math.abs(dx * (point.y - p[0].y) - dy * (point.x - p[0].x)) / length));
}
export function sampleCurve(curve, capWidth = 8, options = {}) {
  const measured=options?.profile==='measured-source-depth-v1';
  issue(options&&typeof options==='object'&&!Array.isArray(options)&&Object.keys(options).length===(measured?1:0),
    'CURVE_CAP_PROFILE','/curveTerrains','Unsupported surface sampling profile');
  issue(measured?Number.isFinite(capWidth)&&capWidth>0&&capWidth<=128:[8, 16, 32].includes(capWidth), 'CURVE_CAP_WIDTH', '/curveTerrains', 'Unsupported versioned edge depth');
  const vertical=measured||capWidth===32;
  const samples = [{ x: curve.points[0].x, y: curve.points[0].y, slope: curve.points[0].slope }];
  for (let segment = 0; segment < curve.points.length - 1; segment++) {
    const a = curve.points[segment], b = curve.points[segment + 1];
    const visit = (points, t0, t1, depth) => {
      const flat = flatness(points) <= CURVE_PROFILE.maximumFlatness
        && Math.hypot(points[3].x - points[0].x, points[3].y - points[0].y) <= CURVE_PROFILE.maximumChord;
      issue(flat || depth < CURVE_PROFILE.maximumDepth, 'CURVE_SAMPLING_LIMIT', '/curveTerrains', 'Curve exceeds sampling depth');
      if (!flat) { const [left, right] = split(points), t = (t0 + t1) / 2; visit(left, t0, t, depth + 1); visit(right, t, t1, depth + 1); return; }
      issue(samples.length < CURVE_PROFILE.maximumSamples, 'CURVE_SAMPLING_LIMIT', '/curveTerrains', 'Curve exceeds sample budget');
      const t = t1, dx = b.x - a.x;
      const slope = ((6 * t * t - 6 * t) * a.y + (3 * t * t - 4 * t + 1) * dx * a.slope
        + (-6 * t * t + 6 * t) * b.y + (3 * t * t - 2 * t) * dx * b.slope) / dx;
      samples.push({ x: q(points[3].x), y: q(points[3].y), slope: q(slope) });
    };
    visit(curveBezier(a, b), 0, 1, 0);
  }
  let distance = 0;
  return samples.map((point, index) => {
    if (index) distance += Math.hypot(point.x - samples[index - 1].x, point.y - samples[index - 1].y);
    const divisor = Math.hypot(point.slope, 1);
    // The joined surface uses a deeper, partially transparent strip. Shallow
    // solids crop that strip at their base instead of squeezing all 32 pixels.
    const depth = vertical ? Math.min(capWidth, curve.baseY - point.y) : capWidth;
    return { x: point.x, y: point.y, distance: q(distance),
      ...(vertical ? { capFraction: q(depth / capWidth), slope:point.slope } : {}),
      inner: vertical ? {x:point.x,y:q(point.y+depth)}
        : { x: q(point.x - point.slope / divisor * depth), y: q(point.y + depth / divisor) } };
  });
}
export function compileCurveGeometry(curve, capWidth = 8, options = {}) {
  const measured=options.profile==='measured-source-depth-v1';
  const samples = sampleCurve(curve, capWidth,options), positions = [], uvs = [], capPositions = [], capUvs = [], indices = [];
  for (const [index, point] of samples.entries()) {
    issue(index === 0 || point.x > samples[index - 1].x, 'CURVE_FOLD', '/curveTerrains', 'Curve must move strictly right');
    issue(index === 0 || point.inner.x > samples[index - 1].inner.x, 'CURVE_CAP_FOLD', '/curveTerrains', 'Curve is too tight for its edge strip');
    issue(point.inner.x >= samples[0].x && point.inner.x <= samples.at(-1).x && point.inner.y <= curve.baseY,
      'CURVE_CAP_BOUNDS', '/curveTerrains', 'Edge strip must remain inside the declared shape');
    // The cap normal must point into the actual sampled solid, including valleys.
    let left = samples[0], right = samples[1];
    for (let j = 0; j < samples.length - 1; j++) if (samples[j].x <= point.inner.x && point.inner.x <= samples[j + 1].x) { left = samples[j]; right = samples[j + 1]; break; }
    const topY = left.y + (right.y - left.y) * (point.inner.x - left.x) / (right.x - left.x);
    issue(point.inner.y >= topY - 0.000001, 'CURVE_CAP_FOLD', '/curveTerrains', 'Edge strip crosses the terrain outline');
    positions.push(point.x, point.y, point.x, curve.baseY);
    uvs.push(point.x / 256, point.y / 256, point.x / 256, curve.baseY / 256);
    capPositions.push(point.x, point.y, point.inner.x, point.inner.y);
    capUvs.push(point.distance / 256, 0, point.distance / 256, point.capFraction ?? 1);
    if (index < samples.length - 1) { const i = index * 2; indices.push(i, i + 1, i + 2, i + 2, i + 1, i + 3); }
  }
  const surface = samples.map(({ x, y }) => ({ x, y }));
  const contour = [...surface, { x: surface.at(-1).x, y: curve.baseY }, { x: surface[0].x, y: curve.baseY }, surface[0]];
  return { curveId: curve.curveId, familyId: curve.familyId, profile: capWidth === 8&&!measured ? CURVE_PROFILE : { ...CURVE_PROFILE, capWidth,
    ...(capWidth===32||measured?{capDirection:'vertical-source-depth-v1'}:{}),...(measured?{surfaceProfile:options.profile}:{}) },
    bounds: { x: surface[0].x, y: Math.min(...surface.map(p => p.y)), width: surface.at(-1).x - surface[0].x,
      height: curve.baseY - Math.min(...surface.map(p => p.y)) },
    body: { positions, uvs: uvs.map(q), indices }, cap: { positions: capPositions, uvs: capUvs.map(q), indices: [...indices] },
    surface, contour, samples, visualAcceptance: 'not-assessed' };
}
export function analyzeCurves(map, { world, grid, cells, familyId, capWidth = 8, capOptions = {} }) {
  if (!['ai_scene_document_v2','ai_scene_document_v3','ai_scene_document_v4','ai_scene_document_v5','ai_scene_document_v6'].includes(map.format)) return [];
  uniqueIds(map.curveTerrains, 'curveId', 'scene.document.json', '/curveTerrains');
  issue(map.curveTerrains.length === 0 || (grid.width === 64 && grid.height === 64), 'CURVE_GRID', '/curveTerrains', 'Curve study requires the 64-unit engineering grid');
  const layered=map.format==='ai_scene_document_v6';
  const curves = [...map.curveTerrains].sort((a, b) => a.points[0].x - b.points[0].x||compareText(a.curveId,b.curveId));
  const occupiedColumns = new Set([...cells.keys()].map(key => Number(key.split(',')[0])));
  let end = -Infinity;
  const geometry=curves.map(curve => {
    const { points } = curve, start = points[0].x, last = points.at(-1).x;
    issue(curve.familyId === familyId, 'FAMILY_UNSUPPORTED', '/curveTerrains', 'Curve uses a different material family');
    issue(points[0].slope === 0 && points.at(-1).slope === 0, 'CURVE_ENDPOINT_TANGENT', '/curveTerrains', 'First prototype requires horizontal endpoint tangents');
    issue(last - start <= 4096 && (layered||start > end), 'CURVE_DOMAIN', '/curveTerrains', 'Curve objects require bounded span and legacy documents require disjoint horizontal domains'); end = last;
    issue(start >= world.x && last <= world.x + world.width && curve.baseY <= world.y + world.height && curve.baseY > world.y,
      'CURVE_OUT_OF_BOUNDS', '/curveTerrains', 'Curve must stay in map bounds');
    for (let i = 0; i < points.length - 1; i++) {
      issue(points[i + 1].x - points[i].x >= 32, 'CURVE_POINT_ORDER', '/curveTerrains', 'Points need at least 32 units spacing and increasing x');
      for (const point of curveBezier(points[i], points[i + 1])) issue(point.y >= world.y && point.y <= curve.baseY - 16,
        'CURVE_DEPTH', '/curveTerrains', 'Bezier control hull must leave at least 16 units of solid depth');
    }
    if(!layered)for (const column of occupiedColumns) issue(['ai_scene_document_v3','ai_scene_document_v4','ai_scene_document_v5'].includes(map.format)
      ? (column + 1) * grid.width <= start || column * grid.width >= last
      : (column + 1) * grid.width < start || column * grid.width > last,
      'CURVE_GRID_OVERLAP', '/curveTerrains', 'First prototype keeps curve and grid horizontal domains separate, including shared endpoints');
    const result=compileCurveGeometry(curve, capWidth,capOptions);
    return layered?{...result,profile:{...result.profile,coexistence:LAYERED_TERRAIN_PROFILE.profile}}:result;
  });
  if(layered){
    issue(!gridCurveConflict(geometry,gridColumnIndex(cells),grid),'CURVE_GRID_OVERLAP','/curveTerrains','Grid cell interiors intersect curve terrain solids');
    for(let i=0;i<geometry.length;i++)for(let j=i+1;j<geometry.length;j++)issue(!curveSolidsOverlap(geometry[i],geometry[j]),'CURVE_SOLID_OVERLAP','/curveTerrains','Curve terrain solid interiors intersect');
  }
  return geometry;
}
