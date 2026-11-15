import { createHash } from 'node:crypto';
import { canonicalJson } from './document.mjs';
import { inspectPng } from './png.mjs';
import { demand } from './errors.mjs';

export const TERRAIN_JUNCTION_PROFILE = 'native-alpha-complete-overlap-v1';
export const TERRAIN_WALL_REPEAT_WINDOW_PROFILE = 'native-alpha-repeat-window-v1';
export const TERRAIN_JUNCTION_ALGORITHM = 'complete-source-over-bottom-to-top-v1';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = value => hash(canonicalJson(value));
const q = n => Math.round(n * 1e6) / 1e6;
const scale = item => item.scale.numerator / item.scale.denominator;
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
const check = (value, code, message) => demand(value, code, 'kit.json', '/terrainEdges/junctions', message);
const controls = item => ({ scale: item.scale, boundaryX: item.boundaryX, innerX: item.innerX,
  ...(item.repeatY ? { repeatY: item.repeatY } : { surfaceY: item.surfaceY, wallStartY: item.wallStartY }), inboardBlend: item.inboardBlend });
const keys = ['left.wall', 'left.corner', 'right.wall', 'right.corner'];
const itemAt = (edges, key) => { const [side, part] = key.split('.'); return edges[side][part]; };

function alphaAt(image, x, y) {
  x -= .5; y -= .5; const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  let alpha = 0;
  for (const [dx, dy, weight] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]]) {
    const px = ix + dx, py = iy + dy;
    if (px >= 0 && py >= 0 && px < image.width && py < image.height) alpha += image.rgba[(py * image.width + px) * 4 + 3] / 255 * weight;
  }
  return alpha;
}
function naturalSide(edges, images, side, options) {
  const wall = edges[side].wall, corner = edges[side].corner, ws = scale(wall), cs = scale(corner), wi = images.get(`${side}.wall`), ci = images.get(`${side}.corner`);
  const windowed = options.wallRepeatProfile === TERRAIN_WALL_REPEAT_WINDOW_PROFILE;
  const selected = windowed ? wall.repeatY : { from: 0, to: wi.height };
  check(Number.isSafeInteger(selected?.from) && Number.isSafeInteger(selected.to) && selected.from >= 0
    && selected.to <= wi.height && selected.to - selected.from >= 2, 'TERRAIN_JUNCTION_CONTEXT', 'Native repeat rows must lie within the original wall PNG');
  const period = (selected.to - selected.from) * ws;
  const tail = (ci.height - corner.wallStartY) * cs, height = q(period);
  check(tail >= 0 && tail <= 80, 'TERRAIN_JUNCTION_CONTEXT', 'Complete native corner tail exceeds the explicit 80-world bound');
  // Render/replay consume the recorded six-decimal placement. Use those same
  // values before sampling and overlap arithmetic, including rational scales.
  const origin = q(options.firstWallNativeOriginWorld?.[side] ?? (corner.wallStartY - corner.surfaceY) * cs - wall.repeatY.from * ws);
  const step = windowed ? period : q(options.wallStepWorld?.[side] ?? (wall.repeatY.to - wall.repeatY.from) * ws);
  const start = origin + selected.from * ws;
  check(Number.isFinite(start) && Math.abs(start) <= 128 && Number.isFinite(step) && step > 0
    && (windowed ? q(step) > 0 : step <= height && height / step <= 8),
    'TERRAIN_JUNCTION_CONTEXT', 'Complete native wall needs bounded placement and at most eight simultaneous source layers');
  const inset = (corner.innerX - corner.boundaryX) * cs, spacing = Math.min(ws, cs) / 2;
  const offsets = [inset - Math.min(ws, cs) / 2, inset, inset + Math.min(ws, cs) / 2];
  const end = Math.max((ci.height - corner.surfaceY) * cs, start + step * 2);
  const samples = Math.ceil(end / spacing);
  check(samples > 0 && samples <= 131072, 'TERRAIN_JUNCTION_BUDGET', 'Native overlap support exceeds its bounded vertical sampling budget');
  let minimum = 1;
  for (let n = 0; n <= samples; n++) {
    const y = end * n / samples;
    for (const x of offsets) {
      let remaining = 1 - alphaAt(ci, corner.boundaryX + x / cs, corner.surfaceY + y / cs);
      if (windowed) {
        if (y >= start) remaining *= 1 - alphaAt(wi, wall.boundaryX + x / ws, selected.from + ((y - start) % step) / ws);
      } else {
        const last = Math.max(0, Math.floor((y - origin) / step));
        for (let index = Math.max(0, last - 8); index <= last; index++) remaining *= 1 - alphaAt(wi, wall.boundaryX + x / ws, (y - origin - index * step) / ws);
      }
      minimum = Math.min(minimum, 1 - remaining);
    }
  }
  check(minimum * 255 >= 250 - 1e-6, 'TERRAIN_JUNCTION_SUPPORT', 'Complete native corner and wall leave a real joining-collar hole; choose explicit placement or step');
  return {
    cornerWall: { mode: 'natural-alpha-tail', source: `${side}.corner`, nativeFromY: 0, nativeToY: ci.height,
      tailAfterAnchorWorld: q(tail), firstWallNativeOriginWorld: q(origin), drawOrder: 'complete-corner-after-walls' },
    wallRepeat: { mode: windowed ? 'native-repeat-window' : 'natural-alpha-complete-overlap', source: `${side}.wall`, nativeFromY: selected.from, nativeToY: selected.to,
      stepWorld: q(step), sourceHeightWorld: height, overlapWorld: windowed ? 0 : q(height - step), drawOrder: 'lower-walls-before-upper-walls' },
    support: { minimumNativeCompositeAlpha: q(minimum * 255), sampleStepWorld: q(end / samples), fromWorld: 0, toWorld: q(end),
      collarWorldOffsets: offsets.map(q), coverage: 'original-alpha-source-over-before-inboard-coverage' },
  };
}

// Source pixels are never repaired. The natural alpha edge itself owns the
// junction. Sampling is only a bounded continuity check of the attachment collar.
export function buildTerrainEdgeJunctions(edges, options = {}) {
  const { readAsset } = options;
  check(typeof readAsset === 'function', 'TERRAIN_JUNCTION_SOURCE', 'Native overlap preparation requires checked source bytes');
  const windowed = options.wallRepeatProfile === TERRAIN_WALL_REPEAT_WINDOW_PROFILE;
  check(options.wallRepeatProfile === undefined || windowed && options.wallStepWorld === undefined,
    'TERRAIN_JUNCTION_PROFILE', 'An explicit native repeat window owns its physical step');
  for (const field of ['firstWallNativeOriginWorld', 'wallStepWorld']) if (options[field] !== undefined) check(exact(options[field], ['left', 'right']), 'TERRAIN_JUNCTION_PROFILE', 'Native placement overrides require explicit values for both sides');
  const images = new Map(), sourceInputs = [];
  for (const key of keys) {
    const item = itemAt(edges, key), bytes = readAsset(item.source.path);
    check(bytes instanceof Uint8Array && bytes.length === item.source.byteLength && hash(bytes) === item.source.sha256, 'TERRAIN_JUNCTION_SOURCE', 'Native overlap requires exact checked source artwork');
    let image; try { image = inspectPng(Buffer.from(bytes), { includePixels: true, allowCabx: true, allowHiddenRgb: true }); } catch { check(false, 'TERRAIN_JUNCTION_SOURCE', 'Native overlap source could not be decoded'); }
    check(image.width === item.pixelSize.width && image.height === item.pixelSize.height, 'TERRAIN_JUNCTION_SOURCE', 'Native overlap source dimensions differ');
    images.set(key, image); sourceInputs.push({ key, sha256: item.source.sha256, pixelSize: item.pixelSize, controlsSha256: digest(controls(item)) });
  }
  const body = { format: 'ai_scene_terrain_edge_junctions_v1', profile: windowed ? TERRAIN_WALL_REPEAT_WINDOW_PROFILE : TERRAIN_JUNCTION_PROFILE, algorithm: TERRAIN_JUNCTION_ALGORITHM,
    maxTailAfterAnchorWorld: 80, maximumOverlapLayers: 8, sourceInputs,
    left: naturalSide(edges, images, 'left', options), right: naturalSide(edges, images, 'right', options),
    coverage: 'native-alpha-source-over-overlap', sourcePngChanged: false, visualAcceptance: 'not-assessed' };
  return { ...body, sha256: digest(body) };
}

export function validateTerrainEdgeJunctions(record, edges, { readAsset } = {}) {
  check(exact(record, ['format', 'profile', 'algorithm', 'maxTailAfterAnchorWorld', 'maximumOverlapLayers', 'sourceInputs', 'left', 'right', 'coverage', 'sourcePngChanged', 'visualAcceptance', 'sha256']), 'TERRAIN_JUNCTION_SHAPE', 'Unknown native overlap record shape');
  const { sha256, ...body } = record;
  const windowed = record.profile === TERRAIN_WALL_REPEAT_WINDOW_PROFILE;
  check(digest(body) === sha256 && record.format === 'ai_scene_terrain_edge_junctions_v1' && (record.profile === TERRAIN_JUNCTION_PROFILE || windowed) && record.algorithm === TERRAIN_JUNCTION_ALGORITHM
    && record.maxTailAfterAnchorWorld === 80 && record.maximumOverlapLayers === 8 && record.coverage === 'native-alpha-source-over-overlap'
    && record.sourcePngChanged === false && record.visualAcceptance === 'not-assessed', 'TERRAIN_JUNCTION_INTEGRITY', 'Native overlap profile or digest differs');
  check(Array.isArray(record.sourceInputs) && record.sourceInputs.length === keys.length, 'TERRAIN_JUNCTION_SOURCE', 'Native overlap source coverage differs');
  for (const [index, key] of keys.entries()) {
    const input = record.sourceInputs[index], item = itemAt(edges, key);
    check(exact(input, ['key', 'sha256', 'pixelSize', 'controlsSha256']) && input.key === key && input.sha256 === item.source.sha256
      && digest(input.pixelSize) === digest(item.pixelSize) && input.controlsSha256 === digest(controls(item)), 'TERRAIN_JUNCTION_SOURCE', 'Native overlap binds different source artwork or controls');
  }
  for (const side of ['left', 'right']) {
    const item = record[side], wall = edges[side].wall, corner = edges[side].corner;
    check(exact(item, ['cornerWall', 'wallRepeat', 'support']), 'TERRAIN_JUNCTION_SHAPE', 'Both complete native overlap roles are required');
    const c = item.cornerWall, w = item.wallRepeat, support = item.support;
    const selected = windowed ? wall.repeatY : { from: 0, to: wall.pixelSize.height };
    check(selected, 'TERRAIN_JUNCTION_CONTEXT', 'Native repeat rows must lie within the original wall PNG');
    check(exact(c, ['mode', 'source', 'nativeFromY', 'nativeToY', 'tailAfterAnchorWorld', 'firstWallNativeOriginWorld', 'drawOrder'])
      && c.mode === 'natural-alpha-tail' && c.source === `${side}.corner` && c.nativeFromY === 0 && c.nativeToY === corner.pixelSize.height
      && Math.abs(c.tailAfterAnchorWorld - (corner.pixelSize.height - corner.wallStartY) * scale(corner)) < 1e-6
      && c.tailAfterAnchorWorld >= 0 && c.tailAfterAnchorWorld <= 80 && Number.isFinite(c.firstWallNativeOriginWorld)
      && Math.abs(c.firstWallNativeOriginWorld + selected.from * scale(wall)) <= 128
      && c.drawOrder === 'complete-corner-after-walls', 'TERRAIN_JUNCTION_CONTEXT', 'Complete corner context or placement differs');
    check(exact(w, ['mode', 'source', 'nativeFromY', 'nativeToY', 'stepWorld', 'sourceHeightWorld', 'overlapWorld', 'drawOrder'])
      && w.mode === (windowed ? 'native-repeat-window' : 'natural-alpha-complete-overlap') && w.source === `${side}.wall`
      && w.nativeFromY === selected.from && w.nativeToY === selected.to
      && Number.isSafeInteger(w.nativeFromY) && Number.isSafeInteger(w.nativeToY) && w.nativeFromY >= 0
      && w.nativeToY <= wall.pixelSize.height && w.nativeToY - w.nativeFromY >= 2
      && (!windowed || w.stepWorld === w.sourceHeightWorld)
      && Number.isFinite(w.stepWorld) && w.stepWorld > 0 && Math.abs(w.sourceHeightWorld - (selected.to - selected.from) * scale(wall)) < 1e-6
      && w.stepWorld <= w.sourceHeightWorld && w.sourceHeightWorld / w.stepWorld <= 8 && Math.abs(w.overlapWorld - (w.sourceHeightWorld - w.stepWorld)) < 1e-6
      && w.drawOrder === 'lower-walls-before-upper-walls', 'TERRAIN_JUNCTION_CONTEXT', 'Complete wall overlap does not fit the original source');
    check(exact(support, ['minimumNativeCompositeAlpha', 'sampleStepWorld', 'fromWorld', 'toWorld', 'collarWorldOffsets', 'coverage'])
      && Number.isFinite(support.minimumNativeCompositeAlpha) && support.minimumNativeCompositeAlpha >= 250 && support.minimumNativeCompositeAlpha <= 255
      && Number.isFinite(support.sampleStepWorld) && support.sampleStepWorld > 0 && support.sampleStepWorld <= Math.min(scale(wall), scale(corner)) / 2 + 1e-6
      && support.fromWorld === 0 && Number.isFinite(support.toWorld) && support.toWorld > 0 && support.toWorld / support.sampleStepWorld <= 131073
      && Array.isArray(support.collarWorldOffsets) && support.collarWorldOffsets.length === 3 && support.collarWorldOffsets.every(Number.isFinite)
      && support.coverage === 'original-alpha-source-over-before-inboard-coverage', 'TERRAIN_JUNCTION_SUPPORT', 'Native support evidence is missing or insufficient');
  }
  if (readAsset) check(buildTerrainEdgeJunctions(edges, { readAsset,
    firstWallNativeOriginWorld: { left: record.left.cornerWall.firstWallNativeOriginWorld, right: record.right.cornerWall.firstWallNativeOriginWorld },
    ...(windowed ? { wallRepeatProfile: TERRAIN_WALL_REPEAT_WINDOW_PROFILE }
      : { wallStepWorld: { left: record.left.wallRepeat.stepWorld, right: record.right.wallRepeat.stepWorld } }) }).sha256 === sha256,
  'TERRAIN_JUNCTION_REPLAY', 'Native overlap does not replay from unchanged artwork');
  return record;
}
