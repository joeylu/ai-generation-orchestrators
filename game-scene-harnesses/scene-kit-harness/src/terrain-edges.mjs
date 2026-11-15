import { demand } from './errors.mjs';
import { clone } from './document.mjs';
import { inspectPng } from './png.mjs';
import { createHash } from 'node:crypto';
import { validateTerrainEdgeJunctions, TERRAIN_WALL_REPEAT_WINDOW_PROFILE } from './terrain-edge-junction.mjs';
import { TERRAIN_UNION_MATERIAL_PROFILE,validateTerrainSurfaceInterface } from './terrain-union-material.mjs';
export { buildTerrainEdgeJunctions, validateTerrainEdgeJunctions, TERRAIN_JUNCTION_PROFILE, TERRAIN_WALL_REPEAT_WINDOW_PROFILE } from './terrain-edge-junction.mjs';

export const TERRAIN_EDGE_PROFILE = 'curve-vertical-exposed-native-v1';
export const NEAR_OPAQUE_JOIN_PROFILE = 'native-near-opaque-underlap-v1';
export const INBOARD_COVERAGE_PROFILE = 'native-inboard-coverage-v1';
export const GRID_TERRAIN_EDGE_PROFILE = 'grid-solid-union-native-v1';
export const EXPOSED_SIDE_TERMINATION_PROFILE = 'exposed-side-only-v1';
const at = '/terrainEdges';
const check = (ok, code, message) => demand(ok, code, 'kit.json', at, message);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const ratio = value => value?.numerator / value?.denominator;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
const q = n => Math.round(n * 1e6) / 1e6;

export function terrainEdgeSources(edges) {
  return ['left', 'right'].flatMap(side => ['wall', 'corner'].map(part => ({ key: `${side}.${part}`, ...edges[side][part] })));
}

// This independent check also supports a single received source. It never
// fabricates the other side/corner roles or rewrites native alpha or color.
export function validateTerrainEdgeJoin(item, { side, part, joinProfile = 'opaque-inner-collar-v1', readAsset, allowHiddenRgb = false, allowCabx = false } = {}) {
  check(['left', 'right'].includes(side) && ['wall', 'corner'].includes(part)
    && ['opaque-inner-collar-v1', NEAR_OPAQUE_JOIN_PROFILE].includes(joinProfile) && typeof readAsset === 'function',
  'TERRAIN_EDGE_JOIN_PROFILE', 'A native joining check requires an explicit known role and profile');
  const width = item?.pixelSize?.width, height = item?.pixelSize?.height, wall = part === 'wall';
  const from = wall ? item?.repeatY?.from : item?.surfaceY, to = wall ? item?.repeatY?.to : item?.wallStartY;
  check(integer(width, 4, 4096) && integer(height, 4, 4096) && integer(item?.innerX, 1, width - 2)
    && integer(from, 0, height - 2) && integer(to, from + 2, height), 'TERRAIN_EDGE_ROWS', 'Native joining coordinates must lie inside the PNG');
  const bytes = readAsset(item.source.path);
  check(bytes instanceof Uint8Array && bytes.length === item.source.byteLength && sha(bytes) === item.source.sha256,
    'TERRAIN_EDGE_CHECKSUM', 'Edge PNG bytes must match the declared source');
  let image;
  try { image = inspectPng(Buffer.from(bytes), { includePixels: true, allowHiddenRgb, allowCabx }); } catch {
    check(false, 'TERRAIN_EDGE_PNG', 'Edge PNG could not be decoded with continuous alpha');
  }
  check(image.width === width && image.height === height && image.transparentPixels > 0 && image.nonzeroAlphaPixels > 0,
    'TERRAIN_EDGE_PNG', 'Edge artwork requires its declared size and genuine transparency');
  const requiredMinimumAlpha = joinProfile === NEAR_OPAQUE_JOIN_PROFILE ? 250 : 255;
  let minimumAlpha = 255, maximumAlpha = 0;
  const firstRow = Math.max(0, from - 1), lastRow = Math.min(height - 1, to);
  for (let y = firstRow; y <= lastRow; y++) for (let x = item.innerX - 1; x <= item.innerX + 1; x++) {
    const alpha = image.rgba[(y * width + x) * 4 + 3]; minimumAlpha = Math.min(minimumAlpha, alpha); maximumAlpha = Math.max(maximumAlpha, alpha);
  }
  check(minimumAlpha >= requiredMinimumAlpha, joinProfile === NEAR_OPAQUE_JOIN_PROFILE ? 'TERRAIN_EDGE_NEAR_OPAQUE_JOIN' : 'TERRAIN_EDGE_OPAQUE_JOIN',
    'The three-column inner collar and bilinear neighbor rows must meet the versioned native alpha minimum');
  return { side, part, joinProfile, sourceSha256: sha(bytes), sourceByteLength: bytes.length,
    collar: { fromX: item.innerX - 1, toX: item.innerX + 1, fromY: firstRow, toY: lastRow, minimumAlpha, maximumAlpha, requiredMinimumAlpha },
    nativeAlphaUnchanged: true, alphaRaised: false, visibleRgbaChanged: false };
}

// These are explicit artwork coordinates, not inferred silhouettes or art acceptance.
// An opaque inner collar makes the cut-back body meet real paint at every row.
export function validateTerrainEdges(edges, appearance, { readAsset } = {}) {
  const unionMaterial = edges?.format === 'ai_scene_terrain_edges_v6', junctionEnabled = unionMaterial || edges?.format === 'ai_scene_terrain_edges_v5', gridEnabled = junctionEnabled || edges?.format === 'ai_scene_terrain_edges_v4', blended = gridEnabled || edges?.format === 'ai_scene_terrain_edges_v3', nearOpaque = blended || edges?.format === 'ai_scene_terrain_edges_v2';
  const termination = Object.hasOwn(edges ?? {}, 'sideTerminationProfile');
  const nativeLip = Object.hasOwn(edges ?? {}, 'surfaceInterface');
  check(!nativeLip || unionMaterial, 'TERRAIN_SURFACE_INTERFACE_PROFILE', 'Native lip interface requires the explicit v6 union material');
  if(nativeLip)validateTerrainSurfaceInterface(edges.surfaceInterface,appearance);
  check(!termination || unionMaterial && edges.sideTerminationProfile === EXPOSED_SIDE_TERMINATION_PROFILE,
    'TERRAIN_EDGE_TERMINATION_PROFILE', 'Explicit side termination requires the supported v6 union profile');
  check(exact(edges, ['format', 'profile', 'sourceBinding', 'left', 'right', ...(nearOpaque ? ['joinProfile'] : []), ...(gridEnabled ? ['gridProfile'] : []), ...(junctionEnabled ? ['junctions'] : []), ...(unionMaterial ? ['materialProfile'] : []), ...(termination ? ['sideTerminationProfile'] : []), ...(nativeLip ? ['surfaceInterface'] : [])])
    && ['ai_scene_terrain_edges_v1', 'ai_scene_terrain_edges_v2', 'ai_scene_terrain_edges_v3', 'ai_scene_terrain_edges_v4', 'ai_scene_terrain_edges_v5', 'ai_scene_terrain_edges_v6'].includes(edges.format) && edges.profile === TERRAIN_EDGE_PROFILE
    && (!nearOpaque || edges.joinProfile === NEAR_OPAQUE_JOIN_PROFILE) && (!gridEnabled || edges.gridProfile === GRID_TERRAIN_EDGE_PROFILE),
  'TERRAIN_EDGE_SHAPE', 'Unsupported terrain edge contract');
  check(['ai_scene_continuous_terrain_appearance_v5','ai_scene_continuous_terrain_appearance_v6'].includes(appearance?.format)
    && exact(edges.sourceBinding, ['materialSourceSha256', 'surfaceMappingSha256'])
    && digest(edges.sourceBinding.materialSourceSha256) && digest(edges.sourceBinding.surfaceMappingSha256)
    && edges.sourceBinding.materialSourceSha256 === appearance.sourceSha256
    && edges.sourceBinding.surfaceMappingSha256 === appearance.surfaceMappingSha256,
  'TERRAIN_EDGE_BINDING', 'Edge artwork must bind the current measured terrain material and mapping');
  const paths = new Set([appearance.body?.source.path, appearance.cap?.source.path]), hashes = new Set([appearance.body?.source.sha256, appearance.cap?.source.sha256]);
  for (const side of ['left', 'right']) {
    check(exact(edges[side], ['wall', 'corner']), 'TERRAIN_EDGE_SHAPE', 'Both wall and top corner are required');
    for (const part of ['wall', 'corner']) {
      const item = edges[side][part], wall = part === 'wall';
      check(exact(item, ['source', 'pixelSize', 'scale', 'boundaryX', 'innerX', ...(wall ? ['repeatY'] : ['surfaceY', 'wallStartY']), ...(blended ? ['inboardBlend'] : [])]),
        'TERRAIN_EDGE_SHAPE', 'Edge coordinates must be explicit and bounded');
      check(exact(item.source, ['path', 'sha256', 'byteLength']) && typeof item.source.path === 'string'
        && /^[a-zA-Z0-9][a-zA-Z0-9._/-]*\.png$/.test(item.source.path) && !item.source.path.split('/').some(s => !s || s === '..' || s === '.')
        && digest(item.source.sha256) && integer(item.source.byteLength, 1, 16777216)
        && !paths.has(item.source.path) && !hashes.has(item.source.sha256),
      'TERRAIN_EDGE_SOURCE', 'Each side and corner requires a distinct portable PNG source');
      paths.add(item.source.path); hashes.add(item.source.sha256);
      check(exact(item.pixelSize, ['width', 'height']) && integer(item.pixelSize.width, 4, 4096) && integer(item.pixelSize.height, 4, 4096)
        && exact(item.scale, ['numerator', 'denominator']) && integer(item.scale.numerator, 1, 1048576)
        && integer(item.scale.denominator, 1, 1048576) && ratio(item.scale) <= 1,
      'TERRAIN_EDGE_SCALE', 'A uniform positive scale may reduce native artwork without source enlargement');
      const { width, height } = item.pixelSize, scale = ratio(item.scale);
      check(integer(item.boundaryX, 0, width - 1) && integer(item.innerX, 1, width - 2)
        && (side === 'left' ? item.innerX > item.boundaryX : item.innerX < item.boundaryX)
        && Math.abs(item.innerX - item.boundaryX) * scale <= 128 && width * scale <= 256,
      'TERRAIN_EDGE_JOIN', 'The inner opaque join must lie inside the solid with a bounded visual width');
      const from = wall ? item.repeatY?.from : item.surfaceY, to = wall ? item.repeatY?.to : item.wallStartY;
      check((!wall || exact(item.repeatY, ['from', 'to'])) && integer(from, 0, height - 2)
        && integer(to, from + 2, height) && (to - from) * scale >= 1,
      'TERRAIN_EDGE_ROWS', 'A finite native corner or repeat window needs at least two rows');
      if (blended) validateInboardCoverage(item, side);
      if (readAsset) {
        validateTerrainEdgeJoin(item, { side, part, ...(nearOpaque ? { joinProfile: edges.joinProfile } : {}), readAsset });
      }
    }
    const { wall, corner } = edges[side];
    check(Math.abs((wall.innerX - wall.boundaryX) * ratio(wall.scale)
      - (corner.innerX - corner.boundaryX) * ratio(corner.scale)) < 1e-9,
    'TERRAIN_EDGE_JOIN', 'Wall and corner must meet the same physical inner join');
  }
  if (unionMaterial) check(edges.materialProfile === TERRAIN_UNION_MATERIAL_PROFILE, 'TERRAIN_UNION_MATERIAL_PROFILE', 'Union material requires the explicit shared source-depth profile');
  if (junctionEnabled) validateTerrainEdgeJunctions(edges.junctions, edges, { readAsset });
  return edges;
}

function clipHalf(polygon, axis, boundary, keepGreater) {
  if (!polygon.length) return [];
  const output = [], inside = point => keepGreater ? point[axis] >= boundary - 1e-9 : point[axis] <= boundary + 1e-9;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length], ia = inside(a), ib = inside(b);
    if (ia) output.push(a);
    if (ia !== ib) {
      const t = (boundary - a[axis]) / (b[axis] - a[axis]);
      output.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
        u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t });
    }
  }
  return output;
}

// Subtract a side rectangle from indexed render meshes only. Author contours and
// collision suggestions are retained separately by compileMap.
function subtractRectangle(mesh, rect) {
  const positions = [], uvs = [], indices = [];
  const add = polygon => {
    if (polygon.length < 3) return;
    const start = positions.length / 2;
    for (const point of polygon) { positions.push(q(point.x), q(point.y)); uvs.push(q(point.u), q(point.v)); }
    for (let i = 1; i < polygon.length - 1; i++) {
      const a = polygon[0], b = polygon[i], c = polygon[i + 1];
      if (Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) > 1e-9) indices.push(start, start + i, start + i + 1);
    }
  };
  for (let index = 0; index < mesh.indices.length; index += 3) {
    let polygon = mesh.indices.slice(index, index + 3).map(i => ({ x: mesh.positions[i * 2], y: mesh.positions[i * 2 + 1], u: mesh.uvs[i * 2], v: mesh.uvs[i * 2 + 1] }));
    for (const [axis, boundary, keepGreater] of [['x', rect.left, true], ['x', rect.right, false], ['y', rect.top, true], ['y', rect.bottom, false]]) {
      add(clipHalf(polygon, axis, boundary, !keepGreater));
      polygon = clipHalf(polygon, axis, boundary, keepGreater);
    }
  }
  return { positions, uvs, indices };
}

function surfaceYAt(curve, x) {
  const points = curve.surface;
  if (x <= points[0].x) return points[0].y;
  if (x >= points.at(-1).x) return points.at(-1).y;
  const index = points.findIndex((point, i) => i < points.length - 1 && x >= point.x && x <= points[i + 1].x);
  const a = points[index], b = points[index + 1];
  return a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x);
}

function clipMeshAtBase(mesh, baseY) {
  if (mesh.positions.every((value, i) => i % 2 === 0 || value <= baseY)) return mesh;
  const positions = [], uvs = [], indices = [];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const polygon = clipHalf(mesh.indices.slice(i, i + 3).map(n => ({ x: mesh.positions[n * 2], y: mesh.positions[n * 2 + 1], u: mesh.uvs[n * 2], v: mesh.uvs[n * 2 + 1] })), 'y', baseY, false);
    if (polygon.length < 3) continue;
    const start = positions.length / 2;
    for (const point of polygon) { positions.push(q(point.x), q(point.y)); uvs.push(q(point.u), q(point.v)); }
    for (let j = 1; j < polygon.length - 1; j++) {
      const a = polygon[0], b = polygon[j], c = polygon[j + 1];
      if (Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) > 1e-9) indices.push(start, start + j, start + j + 1);
    }
  }
  return { positions, uvs, indices };
}

// Every native column keeps its physical X/Y scale. Only its vertical origin
// follows the same sampled surface used by the existing cap and body. Exterior
// columns clamp to the endpoint; no new silhouette is inferred from the image.
function projectedStrip(curve, item, endpoint, top, bottom, v0, v1, baseY, nativeFromX = 0, nativeToX = item.pixelSize.width) {
  const scale = ratio(item.scale), sourceLeft = endpoint.x - item.boundaryX * scale,
    left = sourceLeft + nativeFromX * scale, width = (nativeToX - nativeFromX) * scale;
  const columns = [...new Set([left, left + width, ...curve.surface.filter(p => p.x > left && p.x < left + width).map(p => p.x)])].sort((a, b) => a - b);
  const positions = [], uvs = [], indices = [];
  for (const [index, x] of columns.entries()) {
    const delta = surfaceYAt(curve, x) - endpoint.y, u = nativeFromX === 0 && nativeToX === item.pixelSize.width
      ? (x - left) / width : (nativeFromX + (x - left) / scale) / item.pixelSize.width;
    positions.push(x, top + delta, x, bottom + delta); uvs.push(u, v0, u, v1);
    if (index < columns.length - 1) { const i = index * 2; indices.push(i, i + 1, i + 2, i + 2, i + 1, i + 3); }
  }
  return clipMeshAtBase({ positions: positions.map(q), uvs: uvs.map(q), indices }, baseY);
}

function validateInboardCoverage(item, side) {
  const blend = item.inboardBlend, width = item.pixelSize.width;
  check(exact(blend, ['fromX', 'toX']) && integer(blend.fromX, 0, width) && integer(blend.toX, 0, width)
    && (side === 'left' ? item.innerX <= blend.fromX && blend.fromX < blend.toX : item.innerX >= blend.fromX && blend.fromX > blend.toX),
  'TERRAIN_EDGE_INBOARD_COVERAGE', 'Explicit coverage must fade inward entirely behind the retained terrain body');
}

// This exported single-part helper can preview one received native source. It
// never substitutes missing roles or modifies the source PNG's alpha channel.
export function projectTerrainEdgePart(curve, item, { side, endpoint, top, bottom, v0, v1, baseY, coverageProfile = null }) {
  if (coverageProfile === null) return [projectedStrip(curve, item, endpoint, top, bottom, v0, v1, baseY)];
  check(coverageProfile === INBOARD_COVERAGE_PROFILE && ['left', 'right'].includes(side), 'TERRAIN_EDGE_INBOARD_COVERAGE', 'Unknown rendered coverage profile');
  validateInboardCoverage(item, side);
  const { fromX, toX } = item.inboardBlend, bands = [], total = 31;
  const outerFrom = side === 'left' ? 0 : fromX, outerTo = side === 'left' ? fromX : item.pixelSize.width;
  if (outerTo > outerFrom) bands.push({ fromX: outerFrom, toX: outerTo, opacity: 1 });
  for (let i = 0; i < total; i++) {
    const a = fromX + (toX - fromX) * i / total, b = fromX + (toX - fromX) * (i + 1) / total;
    bands.push({ fromX: Math.min(a, b), toX: Math.max(a, b), opacity: 1 - (i + .5) / total });
  }
  return bands.map(band => ({ ...projectedStrip(curve, item, endpoint, top, bottom, v0, v1, baseY, band.fromX, band.toX),
    coverageOpacity: q(band.opacity), nativeCoverageInterval: { fromX: q(band.fromX), toX: q(band.toX) }, coverageProfile }));
}

export function compileTerrainEdges(curves, edges, { world, cells = new Map(), grid = { width: 64, height: 64 }, gridUnion = false }) {
  if (['ai_scene_terrain_edges_v5','ai_scene_terrain_edges_v6'].includes(edges.format)) {
    validateTerrainEdgeJunctions(edges.junctions, edges);
    return compileCurveGridUnionEdges(curves, edges, { world, cells, grid });
  }
  if (gridUnion) {
    check(edges.format === 'ai_scene_terrain_edges_v4' && edges.gridProfile === GRID_TERRAIN_EDGE_PROFILE, 'TERRAIN_EDGE_GRID_PROFILE', 'Grid union clipping requires the explicit versioned grid profile');
    return compileCurveGridUnionEdges(curves, edges, { world, cells, grid });
  }
  const gridEnabled = edges.format === 'ai_scene_terrain_edges_v4', blended = gridEnabled || edges.format === 'ai_scene_terrain_edges_v3', nearOpaque = blended || edges.format === 'ai_scene_terrain_edges_v2';
  check(!nearOpaque || edges.joinProfile === NEAR_OPAQUE_JOIN_PROFILE, 'TERRAIN_EDGE_JOIN_PROFILE', 'Unknown underlap profile');
  const output = curves.map(clone), report = { format: gridEnabled ? 'ai_scene_terrain_edge_placement_v4' : blended ? 'ai_scene_terrain_edge_placement_v3' : nearOpaque ? 'ai_scene_terrain_edge_placement_v2' : 'ai_scene_terrain_edge_placement_v1', profile: TERRAIN_EDGE_PROFILE,
    ...(gridEnabled ? { gridProfile: GRID_TERRAIN_EDGE_PROFILE } : {}),
    ...(nearOpaque ? { joinProfile: edges.joinProfile, minimumCollarAlpha: 250, sourceAlphaPolicy: 'native-alpha-preserved-with-body-underlap', residualNativeTransparency: 'preserved-outside-underlap' } : {}),
    ...(blended ? { coverageProfile: INBOARD_COVERAGE_PROFILE, maximumCoverageBandsPerPart: 32,
      sourceAlphaPolicy: 'native-png-alpha-preserved-render-coverage-multiplied', effectiveRenderAlpha: 'native-alpha-times-coverageOpacity',
      residualNativeTransparency: 'preserved-outside-inboard-coverage', coverageRegion: 'inward-of-opaque-join-over-retained-body', diagnosticRasterization: 'top-left-for-coverage-pieces-v1' } : {}),
    supportedGeometry: 'v6-curve-full-exposed-vertical-endpoints', cornerProjection: 'sampled-surface-column-offset-v1', worldBorderTolerance: 1, collision: 'original-contours-unchanged', generationCalls: 0,
    visualAcceptance: 'not-assessed', placed: [], skipped: [] };
  for (const curve of output) {
    const pending = [];
    for (const side of ['left', 'right']) {
      const endpoint = side === 'left' ? curve.surface[0] : curve.surface.at(-1), x = endpoint.x, top = endpoint.y, bottom = curve.bounds.y + curve.bounds.height;
      const record = { curveId: curve.curveId, side, x, fromY: top, toY: bottom };
      const skip = reason => report.skipped.push({ ...record, reason });
      if (x <= world.x + 1 || x >= world.x + world.width - 1) { skip('world-boundary'); continue; }
      const overlaps = curves.some(other => other.curveId !== curve.curveId && (side === 'left' ? Math.abs(other.surface.at(-1).x - x) < 1e-6 : Math.abs(other.surface[0].x - x) < 1e-6)
        && Math.min(bottom, other.bounds.y + other.bounds.height) > Math.max(top, side === 'left' ? other.surface.at(-1).y : other.surface[0].y) + 1e-6);
      const column = Math.round(x / grid.width) - (side === 'left' ? 1 : 0);
      const gridTouches = Math.abs(x / grid.width - Math.round(x / grid.width)) < 1e-6 && [...cells.keys()].some(key => {
        const [cx, cy] = key.split(',').map(Number); return cx === column && Math.min(bottom, (cy + 1) * grid.height) > Math.max(top, cy * grid.height) + 1e-6;
      });
      if (overlaps || gridTouches) { skip('shared-or-partially-occluded-side-not-supported'); continue; }
      const { wall, corner } = edges[side], ws = ratio(wall.scale), cs = ratio(corner.scale), inset = Math.abs(wall.innerX - wall.boundaryX) * ws;
      pending.push({ side, endpoint, wall, corner, ws, cs, inset, record, top, bottom, x });
    }
    check(pending.reduce((n, edge) => n + edge.inset, 0) < curve.bounds.width - 1,
      'TERRAIN_EDGE_NARROW_SOLID', 'Opposing edge joins must leave a positive body width');
    if (!pending.length) continue;
    curve.edgeMeshes = [];
    for (const edge of pending) {
      const { side, endpoint, wall, corner, ws, cs, inset, record, top, bottom, x } = edge;
      const underlap = nearOpaque ? Math.min(ws, cs) : 0, trimDepth = inset - underlap;
      const rect = { left: side === 'left' ? x - 1 : x - trimDepth, right: side === 'left' ? x + trimDepth : x + 1, top: curve.bounds.y, bottom };
      curve.body = subtractRectangle(curve.body, rect); curve.cap = subtractRectangle(curve.cap, rect);
      const cornerEnd = top + (corner.wallStartY - corner.surfaceY) * cs;
      const push = (part, item, data, index) => {
        for (const [bandIndex, piece] of data.entries()) {
          if (blended) check(curve.edgeMeshes.length < 32768, 'TERRAIN_EDGE_BUDGET', 'Rendered inboard coverage exceeds the per-curve mesh budget');
          curve.edgeMeshes.push({ edgeId: `${curve.curveId}/${side}/${part}/${index}${blended ? '/band.' + bandIndex : ''}`, side, part,
            materialKey: `${side}.${part}`, source: clone(item.source), pixelSize: clone(item.pixelSize), ...piece });
        }
      };
      const project = (item, y0, y1, v0, v1) => projectTerrainEdgePart(curve, item,
        { side, endpoint, top: y0, bottom: y1, v0, v1, baseY: bottom, ...(blended ? { coverageProfile: INBOARD_COVERAGE_PROFILE } : {}) });
      push('corner', corner, project(corner, top - corner.surfaceY * cs, cornerEnd, 0, corner.wallStartY / corner.pixelSize.height), 0);
      const period = (wall.repeatY.to - wall.repeatY.from) * ws;
      const wallLeft = x - wall.boundaryX * ws, wallRight = wallLeft + wall.pixelSize.width * ws;
      const minimumDelta = Math.min(surfaceYAt(curve, wallLeft), surfaceYAt(curve, wallRight),
        ...curve.surface.filter(p => p.x > wallLeft && p.x < wallRight).map(p => p.y)) - top;
      let count = 0;
      for (let y = cornerEnd; y + minimumDelta < bottom - 1e-6; y += period) {
        check(count < 4096, 'TERRAIN_EDGE_BUDGET', 'Side cover exceeds its bounded repeat budget');
        push('wall', wall, project(wall, y, y + period, wall.repeatY.from / wall.pixelSize.height, wall.repeatY.to / wall.pixelSize.height), count++);
      }
      const rangeLeft = Math.min(wallLeft, x - corner.boundaryX * cs), rangeRight = Math.max(wallRight, x + (corner.pixelSize.width - corner.boundaryX) * cs);
      const shifts = [surfaceYAt(curve, rangeLeft), surfaceYAt(curve, rangeRight),
        ...curve.surface.filter(p => p.x > rangeLeft && p.x < rangeRight).map(p => p.y)].map(y => y - top);
      report.placed.push({ ...record, inset, cornerEndY: q(Math.min(bottom, cornerEnd)), wallRepeatCount: count,
        ...(nearOpaque ? { joinProfile: edges.joinProfile, minimumCollarAlpha: 250, underlapWorld: q(underlap), nativeAlphaUnchanged: true,
          ...(blended ? { residualNativeTransparencyPreservedOutsideCoverage: true } : { residualNativeTransparencyPreserved: true }) } : {}),
        ...(blended ? { inboardCoverage: { profile: INBOARD_COVERAGE_PROFILE, wall: clone(wall.inboardBlend), corner: clone(corner.inboardBlend),
          effectiveRenderAlphaChanged: true, nativePngAlphaUnchanged: true, maximumBandsPerPart: 32 } } : {}),
        baseScaleUniform: true, densityScaleReference: 'native-axis-scale-before-column-projection',
        geometryProjection: 'piecewise-column-shift-to-compiled-surface', renderedShape: 'column-shear-not-a-rigid-native-sprite',
        columnShiftWorld: { minimum: q(Math.min(...shifts)), maximum: q(Math.max(...shifts)) },
        nativePngModified: false, mirrored: false, bodyTrimmed: true });
    }
  }
  return { curves: output, report };
}

const EPS = 1e-6;
function junctionReport(edges) {
  return { junctionProfile: edges.junctions.profile, junctionsSha256: edges.junctions.sha256, maxTailAfterAnchorWorld: edges.junctions.maxTailAfterAnchorWorld,
    maximumOverlapLayers: edges.junctions.maximumOverlapLayers, verticalJunctionCoverage: 'native-alpha-source-over-overlap',
    sourceContext: edges.junctions.profile === TERRAIN_WALL_REPEAT_WINDOW_PROFILE
      ? 'original-native-wall-repeat-rows-and-complete-native-corners' : 'complete-native-PNG-heads-and-tails-no-pixel-rewrite',
    drawOrder: 'lower-walls-upper-walls-complete-corner',
    transitionBlend: 'original-alpha-contours-no-added-feather' };
}
const cellName = (x, y) => `${x},${y}`;
const emptyMesh = () => ({ positions: [], uvs: [], indices: [] });
function joinMeshes(meshes) {
  const result = emptyMesh();
  for (const mesh of meshes) { const offset = result.positions.length / 2; result.positions.push(...mesh.positions); result.uvs.push(...mesh.uvs); result.indices.push(...mesh.indices.map(i => i + offset)); }
  return result;
}
function clippedMesh(mesh, limits) {
  const polygons = [];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    let polygon = mesh.indices.slice(i, i + 3).map(n => ({ x: mesh.positions[n * 2], y: mesh.positions[n * 2 + 1], u: mesh.uvs[n * 2], v: mesh.uvs[n * 2 + 1] }));
    for (const [axis, value, greater] of limits) polygon = clipHalf(polygon, axis, value, greater);
    if (polygon.length >= 3) polygons.push(polygon);
  }
  const result = emptyMesh();
  for (const polygon of polygons) {
    const start = result.positions.length / 2;
    for (const point of polygon) { result.positions.push(q(point.x), q(point.y)); result.uvs.push(q(point.u), q(point.v)); }
    for (let i = 1; i < polygon.length - 1; i++) {
      const [a, b, c] = [polygon[0], polygon[i], polygon[i + 1]];
      if (Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) > 1e-9) result.indices.push(start, start + i, start + i + 1);
    }
  }
  return result;
}
function intersectRect(mesh, rect) {
  return clippedMesh(mesh, [['x', rect.left, true], ['x', rect.right, false], ['y', rect.top, true], ['y', rect.bottom, false]]);
}
function meshBox(mesh) {
  if (!mesh.indices.length) return null;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (let i = 0; i < mesh.positions.length; i += 2) { left = Math.min(left, mesh.positions[i]); right = Math.max(right, mesh.positions[i]); top = Math.min(top, mesh.positions[i + 1]); bottom = Math.max(bottom, mesh.positions[i + 1]); }
  return { left, right, top, bottom };
}
const rectanglesOverlap = (a, b) => a && b && Math.min(a.right, b.right) > Math.max(a.left, b.left) + EPS && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + EPS;
function mergeIntervals(values) {
  const result = [];
  for (const interval of values.filter(v => v[1] > v[0] + EPS).sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    if (result.length && interval[0] <= result.at(-1)[1] + EPS) result.at(-1)[1] = Math.max(result.at(-1)[1], interval[1]);
    else result.push([...interval]);
  }
  return result;
}
function exposedIntervals(from, to, blocked) {
  const result = []; let start = from;
  for (const [a, b] of mergeIntervals(blocked)) { if (b <= start || a >= to) continue; if (a > start + EPS) result.push([start, Math.min(to, a)]); start = Math.max(start, b); }
  if (start < to - EPS) result.push([start, to]); return result;
}
function curveSideBlocks(curves, side, x) {
  return curves.flatMap(curve => {
    const endpoint = side === 'left' ? curve.surface.at(-1) : curve.surface[0];
    return Math.abs(endpoint.x - x) < EPS ? [[endpoint.y, curve.bounds.y + curve.bounds.height]] : [];
  });
}
function gridSideBlocks(cells, side, x, grid) {
  if (Math.abs(x / grid.width - Math.round(x / grid.width)) >= EPS) return [];
  const column = Math.round(x / grid.width) - (side === 'left' ? 1 : 0);
  return [...cells.keys()].flatMap(key => { const [cx, cy] = key.split(',').map(Number); return cx === column ? [[cy * grid.height, (cy + 1) * grid.height]] : []; });
}
function localCellRectangles(cells, box, grid) {
  if (!box) return [];
  const x0 = Math.floor(box.left / grid.width), x1 = Math.ceil(box.right / grid.width), y0 = Math.floor(box.top / grid.height), y1 = Math.ceil(box.bottom / grid.height);
  check((x1 - x0) * (y1 - y0) <= 131072, 'TERRAIN_EDGE_BUDGET', 'A side piece exceeds the bounded local occupancy query');
  const result = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (cells.has(cellName(x, y))) result.push({ left: x * grid.width, right: (x + 1) * grid.width, top: y * grid.height, bottom: (y + 1) * grid.height });
  return result;
}
function clipLine(polygon, a, b, keepInside) {
  if (!polygon.length) return [];
  const value = point => (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x), output = [];
  const inside = v => keepInside ? v >= -1e-9 : v <= 1e-9;
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i], r = polygon[(i + 1) % polygon.length], vp = value(p), vr = value(r), ip = inside(vp), ir = inside(vr);
    if (ip) output.push(p);
    if (ip !== ir) { const t = vp / (vp - vr); output.push({ x: p.x + (r.x - p.x) * t, y: p.y + (r.y - p.y) * t, u: p.u + (r.u - p.u) * t, v: p.v + (r.v - p.v) * t }); }
  }
  return output;
}
function subtractConvex(mesh, polygon) {
  const result = emptyMesh(), add = points => {
    if (points.length < 3) return;
    const start = result.positions.length / 2;
    for (const p of points) { result.positions.push(q(p.x), q(p.y)); result.uvs.push(q(p.u), q(p.v)); }
    for (let i = 1; i < points.length - 1; i++) {
      const [a, b, c] = [points[0], points[i], points[i + 1]];
      if (Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) > 1e-9) result.indices.push(start, start + i, start + i + 1);
    }
  };
  for (let i = 0; i < mesh.indices.length; i += 3) {
    let rest = mesh.indices.slice(i, i + 3).map(n => ({ x: mesh.positions[n * 2], y: mesh.positions[n * 2 + 1], u: mesh.uvs[n * 2], v: mesh.uvs[n * 2 + 1] }));
    for (let j = 0; j < polygon.length; j++) { const a = polygon[j], b = polygon[(j + 1) % polygon.length]; add(clipLine(rest, a, b, false)); rest = clipLine(rest, a, b, true); }
  }
  check(result.indices.length <= 393216, 'TERRAIN_EDGE_BUDGET', 'Curve contact clipping exceeds the bounded piece geometry');
  return result;
}
function subtractCurveSolids(mesh, curves) {
  let result = mesh;
  for (const curve of curves) {
    const bottom = curve.bounds.y + curve.bounds.height;
    for (let i = 0; i < curve.surface.length - 1; i++) {
      const a = curve.surface[i], b = curve.surface[i + 1], box = { left: a.x, right: b.x, top: Math.min(a.y, b.y), bottom };
      if (rectanglesOverlap(box, meshBox(result))) result = subtractConvex(result, [a, b, { x: b.x, y: bottom }, { x: a.x, y: bottom }]);
    }
  }
  return result;
}
function inwardExtent(item, side) {
  const end = item.inboardBlend?.toX ?? (side === 'left' ? item.pixelSize.width : 0);
  return Math.abs(end - item.boundaryX) * ratio(item.scale);
}
function applyInwardFit(mesh, side, x, factor) {
  return { ...mesh, positions: mesh.positions.map((v, i) => i % 2 || (side === 'left' ? v <= x : v >= x) ? v : q(x + (v - x) * factor)) };
}
function surfaceForFit(surface, side, x, factor) {
  return { surface: surface.map(point => ({ ...point, x: side === 'left' ? point.x <= x ? point.x : x + (point.x - x) / factor : point.x >= x ? point.x : x + (point.x - x) / factor })) };
}

function addCompleteNativeSide(patch, edges, segment, { factor, reference, mask }) {
  const { side, x, fromY, toY, corner } = segment, { wall, corner: cap } = edges[side], ws = ratio(wall.scale), cs = ratio(cap.scale), settings = edges.junctions[side];
  const endpoint = { x, y: fromY }, { nativeFromY, nativeToY } = settings.wallRepeat, sourceHeight = (nativeToY - nativeFromY) * ws;
  const step = edges.junctions.profile === TERRAIN_WALL_REPEAT_WINDOW_PROFILE ? sourceHeight : settings.wallRepeat.stepWorld;
  const firstOrigin = fromY + (corner ? settings.cornerWall.firstWallNativeOriginWorld : -wall.repeatY.from * ws);
  const wallLeft = x - wall.boundaryX * ws, wallRight = wallLeft + wall.pixelSize.width * ws;
  const ys = [surfaceYAt(reference, wallLeft), surfaceYAt(reference, wallRight), ...reference.surface.filter(p => p.x > wallLeft && p.x < wallRight).map(p => p.y)];
  const minimumShift = Math.min(...ys) - fromY, maximumShift = Math.max(...ys) - fromY, origins = [];
  for (let index = 0, origin = firstOrigin; origin + nativeFromY * ws + minimumShift < toY - EPS; index++, origin = firstOrigin + index * step) {
    check(index < 4096, 'TERRAIN_EDGE_BUDGET', 'Complete native repetitions exceed their bounded segment budget');
    if (origin + nativeToY * ws + maximumShift > fromY + EPS) origins.push({ origin, index });
  }
  patch.edgeMeshes ??= [];
  const push = (part, item, top, bottom, repeat, nativeOrigin = top, firstRow = 0, lastRow = item.pixelSize.height) => {
    const supportTail = edges.format === 'ai_scene_terrain_edges_v6' && part === 'corner'
      && edges.sideTerminationProfile !== EXPOSED_SIDE_TERMINATION_PROFILE,
      baseY = supportTail ? Math.max(toY, bottom + Math.max(0, ...reference.surface.map(p => p.y - fromY))) : toY;
    const pieces = projectTerrainEdgePart(reference, item, { side, endpoint, top, bottom,
      v0: firstRow / item.pixelSize.height, v1: lastRow / item.pixelSize.height, baseY, coverageProfile: INBOARD_COVERAGE_PROFILE });
    for (const [band, piece] of pieces.entries()) {
      const result = mask(applyInwardFit(piece, side, x, factor), part); if (!result.indices.length) continue;
      check(patch.edgeMeshes.length < 32768, 'TERRAIN_EDGE_BUDGET', 'Complete native source-over exceeds the bounded patch mesh budget');
      patch.edgeMeshes.push({ ...piece, ...result, edgeId: `${patch.gridTerrainId ?? patch.curveId}/${side}/${q(x)}/${q(fromY)}/${part}/${repeat}/band.${band}`,
        side, part, materialKey: `${side}.${part}`, source: clone(item.source), pixelSize: clone(item.pixelSize),
        unionSide: { x, fromY, toY }, inboardProjectionFactor: q(factor), junctionProfile: edges.junctions.profile,
        nativeVerticalRange: { fromY: firstRow, toY: lastRow }, nativeOriginWorld: q(nativeOrigin), sourceOverOrder: 'lower-walls-upper-walls-complete-corner',
        ...(supportTail ? { belowExposedEnd: 'original-corner-tail-clipped-to-same-union-support-only' } : {}) });
    }
  };
  for (const item of [...origins].reverse()) push('wall', wall, item.origin + nativeFromY * ws, item.origin + nativeToY * ws,
    item.index, item.origin, nativeFromY, nativeToY);
  if (corner) push('corner', cap, fromY - cap.surfaceY * cs, fromY + (cap.pixelSize.height - cap.surfaceY) * cs, 0);
  return { nativeWallSegmentCount: origins.length, wallRepeatCount: origins.length,
    completeCornerDrawnLast: corner, completeCornerNativeToY: corner ? cap.pixelSize.height : null,
    firstWallNativeOriginWorld: q(firstOrigin - fromY), wallStepWorld: settings.wallRepeat.stepWorld,
    junctionsSha256: edges.junctions.sha256, junctionCoverage: 'native-alpha-source-over-overlap',
    nativePngChanged: false, addedVerticalFeather: false,
    ...(edges.format === 'ai_scene_terrain_edges_v6' ? { cornerEndOverlap: edges.sideTerminationProfile === EXPOSED_SIDE_TERMINATION_PROFILE
      ? 'clipped-to-exposed-union-side' : 'original-corner-tail-inside-same-union-support-only',
      cornerEndOutsideUnionExtended: false, wallEndOverlap: false } : {}) };
}

// A segment is a union boundary, never one decoration per grid cell. Only its
// inward portion can be compressed to fit a narrow solid; native PNGs stay intact.
function addUnionSide(patch, edges, segment, { maximumInward, surface, mask = mesh => mesh }) {
  const { side, x, fromY, toY, corner } = segment, { wall, corner: cap } = edges[side];
  const ws = ratio(wall.scale), cs = ratio(cap.scale), extent = Math.max(inwardExtent(wall, side), inwardExtent(cap, side));
  const factor = Math.min(1, maximumInward / Math.max(extent, EPS));
  check(factor > 0 && Number.isFinite(factor), 'TERRAIN_EDGE_NARROW_SOLID', 'Union side requires a nonempty inward region');
  const inset = Math.abs(wall.innerX - wall.boundaryX) * ws * factor, underlap = Math.min(ws, cs) * factor, trim = Math.max(0, inset - underlap);
  const topTrim = corner ? Math.min(fromY, surfaceYAt({ surface }, x + (side === 'left' ? trim : -trim)), ...surface.filter(p => Math.abs(p.x - x) <= trim + EPS).map(p => p.y)) : fromY;
  const cut = { left: side === 'left' ? x - 1 : x - trim, right: side === 'left' ? x + trim : x + 1, top: topTrim, bottom: toY };
  patch.body = subtractRectangle(patch.body, cut); patch.cap = subtractRectangle(patch.cap, cut);
  const reference = corner ? surfaceForFit(surface, side, x, factor) : { surface: [{ x: x - 4096, y: fromY }, { x: x + 4096, y: fromY }] };
  const endpoint = { x, y: fromY }, cornerEnd = corner ? fromY + (cap.wallStartY - cap.surfaceY) * cs : fromY;
  const junctionEnabled = ['ai_scene_terrain_edges_v5','ai_scene_terrain_edges_v6'].includes(edges.format);
  if (junctionEnabled) return { ...segment, cornerApplied: corner, inwardFitFactor: q(factor), maximumInwardWorld: q(maximumInward), insetWorld: q(inset), underlapWorld: q(underlap),
    inboardProjection: factor < 1 ? 'inward-x-compressed-to-solid-half-span' : 'native-inward-x-scale',
    sourcePngChanged: false, effectiveRenderAlpha: 'native-alpha-times-inboard-coverageOpacity-then-source-over',
    ...addCompleteNativeSide(patch, edges, segment, { factor, reference, mask }) };
  patch.edgeMeshes ??= [];
  const push = (part, item, y0, y1, v0, v1, repeat) => {
    const pieces = projectTerrainEdgePart(reference, item, { side, endpoint, top: y0, bottom: y1, v0, v1, baseY: toY, coverageProfile: INBOARD_COVERAGE_PROFILE });
    for (const [band, piece] of pieces.entries()) {
      const fitted = applyInwardFit(piece, side, x, factor), result = mask(fitted, part);
      if (!result.indices.length) continue;
      check(patch.edgeMeshes.length < 32768, 'TERRAIN_EDGE_BUDGET', 'Union edge meshes exceed the bounded patch budget');
      patch.edgeMeshes.push({ ...piece, ...result, edgeId: `${patch.gridTerrainId ?? patch.curveId}/${side}/${q(x)}/${q(fromY)}/${part}/${repeat}/band.${band}`,
        side, part, materialKey: `${side}.${part}`, source: clone(item.source), pixelSize: clone(item.pixelSize),
        unionSide: { x, fromY, toY }, inboardProjectionFactor: q(factor) });
    }
  };
  if (corner) push('corner', cap, fromY - cap.surfaceY * cs, cornerEnd, 0, cap.wallStartY / cap.pixelSize.height, 0);
  const period = (wall.repeatY.to - wall.repeatY.from) * ws;
  const shift = corner ? Math.min(0, ...reference.surface.map(p => p.y - fromY)) : 0;
  let repeats = 0;
  for (let y = cornerEnd; y + shift < toY - EPS; y += period) {
    check(repeats < 4096, 'TERRAIN_EDGE_BUDGET', 'Union edge repetitions exceed the bounded budget');
    push('wall', wall, y, y + period, wall.repeatY.from / wall.pixelSize.height, wall.repeatY.to / wall.pixelSize.height, repeats);
    repeats++;
  }
  return { ...segment, cornerApplied: corner, inwardFitFactor: q(factor), maximumInwardWorld: q(maximumInward), insetWorld: q(inset), underlapWorld: q(underlap),
    inboardProjection: factor < 1 ? 'inward-x-compressed-to-solid-half-span' : 'native-inward-x-scale', wallRepeatCount: repeats,
    sourcePngChanged: false, effectiveRenderAlpha: 'native-alpha-times-inboard-coverageOpacity' };
}

export function compileGridTerrainEdges(patches, edges, { world, grid = { width: 64, height: 64 }, cells = new Map(), allCells = cells, curves = [] }) {
  const junctionEnabled = ['ai_scene_terrain_edges_v5','ai_scene_terrain_edges_v6'].includes(edges.format);
  check(['ai_scene_terrain_edges_v4', 'ai_scene_terrain_edges_v5', 'ai_scene_terrain_edges_v6'].includes(edges.format) && edges.gridProfile === GRID_TERRAIN_EDGE_PROFILE, 'TERRAIN_EDGE_GRID_PROFILE', 'Grid sides require the explicit union grid profile');
  if (junctionEnabled) validateTerrainEdgeJunctions(edges.junctions, edges);
  const output = patches.map(clone), report = { format: junctionEnabled ? 'ai_scene_grid_terrain_edge_placement_v2' : 'ai_scene_grid_terrain_edge_placement_v1', profile: GRID_TERRAIN_EDGE_PROFILE,
    ...(junctionEnabled ? junctionReport(edges) : {}),
    joinProfile: edges.joinProfile, minimumCollarAlpha: 250, coverageProfile: INBOARD_COVERAGE_PROFILE, maximumCoverageBandsPerPart: 32,
    effectiveRenderAlpha: 'native-alpha-times-coverageOpacity', sourceAlphaPolicy: 'native-png-alpha-preserved-render-coverage-multiplied',
    topology: 'ordinary-grid-solid-union-with-curve-contact-subtraction', collision: 'original-author-solids-unchanged', sourcePngChanged: false,
    visualAcceptance: 'not-assessed', generationCalls: 0, placed: [], skipped: [] };
  for (const patch of output) {
    const owned = new Map(patch.source.gridCells.map(cell => [cellName(cell.x, cell.y), true])), groups = new Map();
    for (const cell of patch.source.gridCells) for (const side of ['left', 'right']) {
      if (allCells.has(cellName(cell.x + (side === 'left' ? -1 : 1), cell.y))) continue;
      const x = (cell.x + (side === 'right' ? 1 : 0)) * grid.width, key = `${side}/${x}`;
      if (!groups.has(key)) groups.set(key, { side, x, intervals: [] }); groups.get(key).intervals.push([cell.y * grid.height, (cell.y + 1) * grid.height]);
    }
    for (const { side, x, intervals } of groups.values()) for (const [start, end] of mergeIntervals(intervals)) {
      if (x <= world.x + 1 || x >= world.x + world.width - 1) { report.skipped.push({ gridTerrainId: patch.gridTerrainId, side, x, fromY: start, toY: end, reason: 'world-boundary' }); continue; }
      for (const [fromY, toY] of exposedIntervals(start, end, curveSideBlocks(curves, side, x))) {
        const spans = patch.surfaceSpans ?? [];
        const topSpan = spans.find(span => Math.abs(span.from.y - fromY) < EPS && (side === 'left' ? Math.abs(span.from.x - x) < EPS : Math.abs(span.to.x - x) < EPS));
        const corner = Boolean(topSpan), ownerX = Math.round(x / grid.width) - (side === 'right' ? 1 : 0);
        let rowWidth = Infinity;
        for (let y = Math.floor((fromY + EPS) / grid.height); y < Math.ceil((toY - EPS) / grid.height); y++) {
          let width = 0, cx = ownerX;
          while (owned.has(cellName(cx, y))) { width += grid.width; cx += side === 'left' ? 1 : -1; }
          rowWidth = Math.min(rowWidth, width);
        }
        const maximumInward = rowWidth / 2, segment = { gridTerrainId: patch.gridTerrainId, side, x, fromY, toY, corner };
        const mask = (mesh, part) => {
          const box = meshBox(mesh); if (!box) return emptyMesh();
          const limits = [['x', x, side === 'left']], inside = clippedMesh(mesh, limits), outside = clippedMesh(mesh, [['x', x, side !== 'left']]);
          const restrictedRects = localCellRectangles(owned, meshBox(inside), grid).map(rect => ({ ...rect, top: Math.max(rect.top, fromY), bottom: Math.min(rect.bottom, toY) })).filter(rect => rectanglesOverlap(rect, meshBox(inside)));
          if (part === 'corner' && topSpan) restrictedRects.push({ left: side === 'left' ? x : Math.max(topSpan.from.x, x - maximumInward), right: side === 'left' ? Math.min(topSpan.to.x, x + maximumInward) : x,
            top: box.top, bottom: fromY });
          let exterior = clippedMesh(outside, [['y', part === 'corner' ? box.top : fromY, true], ['y', toY, false]]);
          for (const rect of localCellRectangles(allCells, meshBox(exterior), grid)) if (rectanglesOverlap(rect, meshBox(exterior))) exterior = subtractRectangle(exterior, rect);
          return subtractCurveSolids(joinMeshes([exterior, ...restrictedRects.map(rect => intersectRect(inside, rect))]), curves);
        };
        report.placed.push(addUnionSide(patch, edges, segment, { maximumInward, surface: [{ x: x - 4096, y: fromY }, { x: x + 4096, y: fromY }], mask }));
      }
    }
  }
  return { gridTerrains: output, report };
}

function compileCurveGridUnionEdges(curves, edges, { world, cells, grid }) {
  const junctionEnabled = ['ai_scene_terrain_edges_v5','ai_scene_terrain_edges_v6'].includes(edges.format);
  const output = curves.map(clone), report = { format: junctionEnabled ? 'ai_scene_terrain_edge_placement_v5' : 'ai_scene_terrain_edge_placement_v4', profile: TERRAIN_EDGE_PROFILE,
    ...(junctionEnabled ? junctionReport(edges) : {}),
    joinProfile: edges.joinProfile, minimumCollarAlpha: 250, coverageProfile: INBOARD_COVERAGE_PROFILE, maximumCoverageBandsPerPart: 32,
    effectiveRenderAlpha: 'native-alpha-times-coverageOpacity', sourceAlphaPolicy: 'native-png-alpha-preserved-render-coverage-multiplied',
    gridProfile: GRID_TERRAIN_EDGE_PROFILE, topology: 'curve-side-intervals-minus-grid-and-curve-solids', collision: 'original-contours-unchanged',
    sourcePngChanged: false, visualAcceptance: 'not-assessed', generationCalls: 0, placed: [], skipped: [] };
  for (const curve of output) for (const side of ['left', 'right']) {
    const endpoint = side === 'left' ? curve.surface[0] : curve.surface.at(-1), x = endpoint.x, bottom = curve.bounds.y + curve.bounds.height;
    if (x <= world.x + 1 || x >= world.x + world.width - 1) { report.skipped.push({ curveId: curve.curveId, side, x, reason: 'world-boundary' }); continue; }
    const blocks = [...gridSideBlocks(cells, side, x, grid), ...curveSideBlocks(curves.filter(c => c.curveId !== curve.curveId), side, x)];
    const intervals = exposedIntervals(endpoint.y, bottom, blocks);
    if (!intervals.length) report.skipped.push({ curveId: curve.curveId, side, x, reason: 'internal-union-side' });
    for (const [fromY, toY] of intervals) {
      const corner = Math.abs(fromY - endpoint.y) < EPS;
      const mask = mesh => {
        let result = clippedMesh(mesh, [['y', corner ? Math.min(...mesh.positions.filter((_, i) => i % 2)) : fromY, true], ['y', toY, false]]);
        for (const rect of localCellRectangles(cells, meshBox(result), grid)) if (rectanglesOverlap(rect, meshBox(result))) result = subtractRectangle(result, rect);
        return subtractCurveSolids(result, curves.filter(other => other.curveId !== curve.curveId));
      };
      report.placed.push(addUnionSide(curve, edges, { curveId: curve.curveId, side, x, fromY, toY, corner }, { maximumInward: curve.bounds.width / 2, surface: curve.surface, mask }));
    }
  }
  return { curves: output, report };
}

function intersectConvex(mesh, polygon) {
  const result = emptyMesh();
  for (let i = 0; i < mesh.indices.length; i += 3) {
    let points = mesh.indices.slice(i, i + 3).map(n => ({ x: mesh.positions[n * 2], y: mesh.positions[n * 2 + 1], u: mesh.uvs[n * 2], v: mesh.uvs[n * 2 + 1] }));
    for (let j = 0; j < polygon.length && points.length; j++) points = clipLine(points, polygon[j], polygon[(j + 1) % polygon.length], true);
    if (points.length < 3) continue;
    const start = result.positions.length / 2;
    for (const p of points) { result.positions.push(q(p.x), q(p.y)); result.uvs.push(q(p.u), q(p.v)); }
    for (let j = 1; j < points.length - 1; j++) if (Math.abs((points[j].x - points[0].x) * (points[j + 1].y - points[0].y)
      - (points[j].y - points[0].y) * (points[j + 1].x - points[0].x)) > 1e-9) result.indices.push(start, start + j, start + j + 1);
  }
  return result;
}

// v6 sides belong to the exposed solid union, not to the authoring object's
// rectangular range. One native corner/repeat sequence can cross a curve base
// and an attached ordinary-grid top without restarting or cutting the PNG.
export function compileTerrainUnionEdges(patches, curves, edges, { world, grid = { width: 64, height: 64 }, cells = new Map(), allCells = cells }) {
  check(edges.format === 'ai_scene_terrain_edges_v6' && edges.gridProfile === GRID_TERRAIN_EDGE_PROFILE,
    'TERRAIN_EDGE_GRID_PROFILE', 'Coalesced sides require the explicit v6 union contract');
  const termination = Object.hasOwn(edges, 'sideTerminationProfile');
  check(!termination || edges.sideTerminationProfile === EXPOSED_SIDE_TERMINATION_PROFILE,
    'TERRAIN_EDGE_TERMINATION_PROFILE', 'Unknown union side termination profile');
  validateTerrainEdgeJunctions(edges.junctions, edges);
  const outputGrid = patches.map(clone), outputCurves = curves.map(clone), owners = [...outputGrid, ...outputCurves], gridCount = outputGrid.length,
    idOf = i => owners[i].gridTerrainId ?? owners[i].curveId, ordinary = new Map(), units = [], maxWork = 4194304;
  let work = 0, nativeMeshCount = 0;
  const consume = n => { work += n; check(work <= maxWork, 'TERRAIN_EDGE_BUDGET', 'Coalesced union side geometry exceeds its bounded work'); };
  const report = { format: 'ai_scene_terrain_edge_placement_v6', profile: TERRAIN_EDGE_PROFILE, ...junctionReport(edges),
    ...(termination ? { sideTerminationProfile: edges.sideTerminationProfile } : {}),
    gridProfile: GRID_TERRAIN_EDGE_PROFILE, topology: 'coalesced-curve-grid-exterior-vertical-intervals',
    sideOwnership: 'one-native-sequence-across-touching-author-owners', joinProfile: edges.joinProfile,
    minimumCollarAlpha: 250, coverageProfile: INBOARD_COVERAGE_PROFILE, maximumCoverageBandsPerPart: 32,
    effectiveRenderAlpha: 'native-alpha-times-inboard-coverageOpacity-then-source-over',
    sourceAlphaPolicy: 'native-png-alpha-preserved-render-coverage-multiplied', collision: 'original-author-solids-unchanged',
    sourcePngChanged: false, visualAcceptance: 'not-assessed', generationCalls: 0, placed: [], skipped: [],
    maximumWork: maxWork, maximumNativeMeshes: 32768, work: 0 };
  for (let index = 0; index < gridCount; index++) for (const c of owners[index].source.gridCells) ordinary.set(cellName(c.x, c.y), index);
  // Cache each original horizontal run width once; narrow inward covers keep
  // their existing conservative half-span fit even across author ownership.
  const runWidth = new Map(), byRow = new Map();
  for (const key of ordinary.keys()) { const [x, y] = key.split(',').map(Number); if (!byRow.has(y)) byRow.set(y, []); byRow.get(y).push(x); }
  for (const [y, xs] of byRow) {
    xs.sort((a, b) => a - b); let run = [];
    const finish = () => { for (const x of run) runWidth.set(cellName(x, y), run.length * grid.width); run = []; };
    for (const x of xs) { if (run.length && x !== run.at(-1) + 1) finish(); run.push(x); } finish();
  }
  for (let index = 0; index < gridCount; index++) {
    const patch = owners[index];
    for (const c of patch.source.gridCells) for (const side of ['left', 'right']) {
      if (allCells.has(cellName(c.x + (side === 'left' ? -1 : 1), c.y))) continue;
      const x = (c.x + (side === 'right' ? 1 : 0)) * grid.width;
      for (const [fromY, toY] of exposedIntervals(c.y * grid.height, (c.y + 1) * grid.height, curveSideBlocks(curves, side, x))) {
        const span = patch.surfaceSpans?.find(s => Math.abs(s.from.y - fromY) < EPS && (side === 'left' ? Math.abs(s.from.x - x) : Math.abs(s.to.x - x)) < EPS);
        units.push({ side, x, fromY, toY, owner: index, corner: Boolean(span), maximumInward: runWidth.get(cellName(c.x, c.y)) / 2,
          surface: [{ x: x - 4096, y: fromY }, { x: x + 4096, y: fromY }] });
      }
    }
  }
  for (let ci = 0; ci < outputCurves.length; ci++) for (const side of ['left', 'right']) {
    const curve = outputCurves[ci], endpoint = side === 'left' ? curve.surface[0] : curve.surface.at(-1), x = endpoint.x,
      blocks = [...gridSideBlocks(allCells, side, x, grid), ...curveSideBlocks(curves.filter(c => c.curveId !== curve.curveId), side, x)];
    for (const [fromY, toY] of exposedIntervals(endpoint.y, curve.bounds.y + curve.bounds.height, blocks)) units.push({ side, x, fromY, toY,
      owner: gridCount + ci, corner: Math.abs(fromY - endpoint.y) < EPS, maximumInward: curve.bounds.width / 2, surface: curve.surface });
  }
  check(units.length <= 262144, 'TERRAIN_EDGE_BUDGET', 'Coalesced union side intervals exceed their budget');
  const lines = new Map();
  for (const unit of units) { const key = `${unit.side}/${unit.x}`; if (!lines.has(key)) lines.set(key, []); lines.get(key).push(unit); }
  const chains = [];
  for (const values of [...lines.values()].sort((a, b) => a[0].side.localeCompare(b[0].side) || a[0].x - b[0].x)) {
    values.sort((a, b) => a.fromY - b.fromY || a.toY - b.toY || a.owner - b.owner);
    let chain;
    for (const unit of values) {
      if (chain && unit.fromY <= chain.toY + EPS) { chain.toY = Math.max(chain.toY, unit.toY); chain.units.push(unit); }
      else { chain = { side: unit.side, x: unit.x, fromY: unit.fromY, toY: unit.toY, units: [unit] }; chains.push(chain); }
    }
  }
  const allCurvePrimitives = outputCurves.flatMap((curve, ci) => {
    const bottom = curve.bounds.y + curve.bounds.height;
    return curve.surface.slice(0, -1).map((a, j) => { const b = curve.surface[j + 1]; return { owner: gridCount + ci,
      box: { left: a.x, right: b.x, top: Math.min(a.y, b.y), bottom }, polygon: [a, b, { x: b.x, y: bottom }, { x: a.x, y: bottom }] }; });
  });
  const localPrimitives = (box, allowed, includeAttached = false) => {
    if (!box) return [];
    const result = [], x0 = Math.floor(box.left / grid.width), x1 = Math.ceil(box.right / grid.width),
      y0 = Math.floor(box.top / grid.height), y1 = Math.ceil(box.bottom / grid.height);
    check((x1 - x0) * (y1 - y0) <= 131072, 'TERRAIN_EDGE_BUDGET', 'Coalesced cover exceeds its local solid query');
    consume((x1 - x0) * (y1 - y0) + allCurvePrimitives.length);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const key = cellName(x, y), owner = ordinary.get(key);
      if (!(owner !== undefined && (!allowed || allowed.has(owner))) && !(includeAttached && allCells.has(key) && !ordinary.has(key))) continue;
      const left = x * grid.width, right = left + grid.width, top = y * grid.height, bottom = top + grid.height;
      result.push({ owner, box: { left, right, top, bottom }, polygon: [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }] });
    }
    for (const p of allCurvePrimitives) if ((!allowed || allowed.has(p.owner)) && rectanglesOverlap(box, p.box)) result.push(p);
    return result;
  };
  for (const [chainIndex, chain] of chains.entries()) {
    const { side, x, fromY, toY } = chain, contributors = [...new Set(chain.units.map(u => u.owner))], top = chain.units[0], corner = top.corner,
      grouped = owners[top.owner].unionMaterial?.group,
      allowed = new Set(grouped === undefined ? contributors : owners.flatMap((owner, i) => owner.unionMaterial?.group === grouped ? [i] : []));
    for (const i of contributors) allowed.add(i);
    const ownerIds = contributors.map(idOf), drawOwner = Math.max(...allowed), maximumInward = Math.min(...chain.units.map(u => u.maximumInward));
    if (x <= world.x + 1 || x >= world.x + world.width - 1) { report.skipped.push({ side, x, fromY, toY, ownerIds, reason: 'world-boundary' }); continue; }
    const carrier = { gridTerrainId: `union-edge/${chainIndex}`, body: emptyMesh(), cap: emptyMesh() },
      worldRect = { left: world.x, right: world.x + world.width, top: world.y, bottom: world.y + world.height },
      mask = (mesh, part) => {
        const bounded = intersectRect(mesh, worldRect), box = meshBox(bounded); if (!box) return emptyMesh();
        const inside = clippedMesh(bounded, [['x', x, side === 'left'], ['y', fromY, true], ['y', toY, false]]),
          insideParts = localPrimitives(meshBox(inside), allowed).map(p => intersectConvex(inside, p.polygon));
        let exterior = clippedMesh(bounded, [['x', x, side !== 'left'], ['y', part === 'corner' ? box.top : fromY, true], ['y', toY, false]]);
        for (const p of localPrimitives(meshBox(exterior), null, true)) exterior = subtractConvex(exterior, p.polygon);
        const above = [];
        if (part === 'corner' && corner) {
          const reference = surfaceForFit(top.surface, side, x, Math.min(1, maximumInward / Math.max(inwardExtent(edges[side].wall, side), inwardExtent(edges[side].corner, side), EPS))).surface,
            left = side === 'left' ? x : x - maximumInward, right = side === 'left' ? x + maximumInward : x,
            xs = [...new Set([left, right, ...reference.filter(p => p.x > left && p.x < right).map(p => p.x)])].sort((a, b) => a - b);
          for (let j = 0; j < xs.length - 1; j++) {
            const a = { x: xs[j], y: surfaceYAt({ surface: reference }, xs[j]) }, b = { x: xs[j + 1], y: surfaceYAt({ surface: reference }, xs[j + 1]) },
              polygon = [{ x: a.x, y: box.top }, { x: b.x, y: box.top }, b, a];
            let piece = intersectConvex(bounded, polygon);
            for (const p of localPrimitives(meshBox(piece), null, true)) piece = subtractConvex(piece, p.polygon);
            above.push(piece);
          }
        }
        // Legacy natural covers can retain an original rock shoulder over a
        // connected support. Manufactured trim opts into the actual exposed
        // interval, so its complete native tail cannot mark a buried seam.
        const tail = part === 'corner' && !termination ? clippedMesh(bounded, [['y', toY, true]]) : emptyMesh(),
          supportParts = localPrimitives(meshBox(tail), allowed).map(p => intersectConvex(tail, p.polygon));
        return joinMeshes([exterior, ...insideParts, ...above, ...supportParts]);
      };
    const placed = addUnionSide(carrier, edges, { side, x, fromY, toY, corner }, { maximumInward, surface: top.surface, mask });
    const trim = Math.max(0, placed.insetWorld - placed.underlapWorld), topTrim = corner ? Math.min(fromY,
      surfaceYAt({ surface: top.surface }, x + (side === 'left' ? trim : -trim)), ...top.surface.filter(p => Math.abs(p.x - x) <= trim + EPS).map(p => p.y)) : fromY,
      cut = { left: side === 'left' ? x - 1 : x - trim, right: side === 'left' ? x + trim : x + 1, top: topTrim, bottom: toY };
    for (const owner of owners) if (rectanglesOverlap(cut, { left: owner.bounds.x, right: owner.bounds.x + owner.bounds.width, top: owner.bounds.y, bottom: owner.bounds.y + owner.bounds.height })) {
      consume(owner.body.indices.length / 3 + owner.cap.indices.length / 3 + (owner.capBands ?? []).reduce((n, band) => n + band.indices.length / 3, 0)
        + (owner.topCoverBands ?? []).reduce((n, band) => n + band.indices.length / 3, 0));
      owner.body = subtractRectangle(owner.body, cut); owner.cap = subtractRectangle(owner.cap, cut);
      if (owner.capBands) owner.capBands = owner.capBands.map(band => ({ ...band, ...subtractRectangle(band, cut) }));
      // The late central cover has the same native-side ownership boundary as
      // the original cap. It cannot replace a transparent upper-corner recess
      // with the logical solid's rectangular material field.
      if (owner.topCoverBands) owner.topCoverBands = owner.topCoverBands.map(band => ({ ...band, ...subtractRectangle(band, cut) }));
    }
    const target = owners[drawOwner]; target.edgeMeshes ??= [];
    for (const piece of carrier.edgeMeshes ?? []) {
      check(++nativeMeshCount <= report.maximumNativeMeshes, 'TERRAIN_EDGE_BUDGET', 'Coalesced native cover meshes exceed their total budget');
      target.edgeMeshes.push({ ...piece, unionOwnerIds: ownerIds,
        drawOwnerId: idOf(drawOwner), coalescedAcrossAuthorOwners: ownerIds.length > 1 });
    }
    report.placed.push({ ...placed, ownerIds, drawOwnerId: idOf(drawOwner),
      coalescedAcrossAuthorOwners: ownerIds.length > 1, authorBoundaryRestarts: 0 });
  }
  // Rectangle clipping quantizes general mesh UVs for legacy replay. The new
  // world-field contract is affine, so derive its coordinates again from the
  // final clipped positions instead of retaining quantized interpolation.
  for (const owner of owners) if (owner.unionMaterial) {
    const rigid=owner.materialMapping?.bodyMapping==='fixed-world-rigid-row-repeat-v1';
    const originY=rigid?ratio(owner.materialMapping.bodyOriginWorldY):0;
    owner.body.uvs = owner.body.positions.map((value, i) => (rigid&&i%2?value-originY:value) / (i % 2 ? (owner.materialMapping?.bodyPeriod?.height??256) : (owner.materialMapping?.bodyPeriod?.width??512)));
  }
  report.work = work; report.nativeMeshCount = nativeMeshCount;
  report.grid = { format: 'ai_scene_grid_terrain_edge_placement_v3', profile: GRID_TERRAIN_EDGE_PROFILE,
    topology: report.topology, placed: report.placed.filter(p => p.ownerIds.some(id => id.startsWith('grid-field/'))),
    skipped: report.skipped.filter(p => p.ownerIds.some(id => id.startsWith('grid-field/'))),
    sourcePngChanged: false, visualAcceptance: 'not-assessed', generationCalls: 0 };
  return { gridTerrains: outputGrid, curves: outputCurves, report };
}
