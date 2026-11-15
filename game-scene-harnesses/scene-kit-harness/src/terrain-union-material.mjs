import { demand } from './errors.mjs';
import { clone, deepFreeze } from './document.mjs';
import {TERRAIN_BOTTOM_ADAPTIVE_COVERAGE_PROFILE} from './terrain-bottom-edges.mjs';
import {TERRAIN_SURFACE_SPAN_PROFILE,validateTerrainSurfaceSpanProfile,buildTerrainSurfaceSpanEnvelope} from './terrain-surface-span-envelope.mjs';

export const TERRAIN_UNION_MATERIAL_PROFILE = 'union-world-body-local-surface-v1';
export const TERRAIN_SURFACE_INTERFACE_PROFILE = 'world-body-native-lip-v1';
export const TERRAIN_UNION_MATERIAL_LIMITS = deepFreeze({ capFadeWorld: 12, capFadeBands: 24, maximumOwners: 2048,
  maximumBoundarySegments: 262144, maximumNorthSegments: 16384, maximumContactComparisons: 262144,
  maximumExposureComparisons:16777216,maximumSurfaceClips: 2097152, maximumOutputTriangles: 262144 });
const EPS = 1e-7, q = n => Math.round(n * 1e12) / 1e12;
const check = (value, code, message) => demand(value, code, 'scene.document.json', '/terrainRuns', message);
const mesh = () => ({ positions: [], uvs: [], indices: [] });
const ratio = value => value?.numerator / value?.denominator;
export function validateTerrainSurfaceInterface(value, appearance) {
  check(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 4 && ['profile','capSourceSha256','capEndRow','fadeRows'].every(key => Object.hasOwn(value,key))
    && value.profile === TERRAIN_SURFACE_INTERFACE_PROFILE, 'TERRAIN_SURFACE_INTERFACE_PROFILE', 'Unknown native surface interface');
  const height = appearance?.cap?.pixelSize?.height, depth = ratio(appearance?.capDepth), uvEnd = ratio(appearance?.capUvEnd);
  check(typeof value.capSourceSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.capSourceSha256)
    && value.capSourceSha256 === appearance?.cap?.source?.sha256, 'TERRAIN_SURFACE_INTERFACE_BINDING', 'Native lip rows must bind the current cap source');
  check(Number.isSafeInteger(height) && height >= 2 && height <= 4096
    && Number.isSafeInteger(value.capEndRow) && value.capEndRow >= 1 && value.capEndRow <= height
    && Number.isSafeInteger(value.fadeRows) && value.fadeRows >= 0 && value.fadeRows <= value.capEndRow
    && Number.isFinite(depth) && depth > 0 && depth <= 128 && Number.isFinite(uvEnd) && uvEnd > 0 && uvEnd <= 1,
  'TERRAIN_SURFACE_INTERFACE_ROWS', 'Native lip end and fade rows must remain inside the checked cap');
  const overlayDepthWorld=value.capEndRow*depth/(uvEnd*height),fadeWorld=value.fadeRows*depth/(uvEnd*height);
  check(Number.isFinite(overlayDepthWorld)&&overlayDepthWorld>0&&overlayDepthWorld<=128
    &&Number.isFinite(fadeWorld)&&fadeWorld>=0&&fadeWorld<=overlayDepthWorld,
  'TERRAIN_SURFACE_INTERFACE_ROWS','Native surface coverage must remain within the bounded 128-world depth');
  return {overlayDepthWorld,fadeWorld};
}
const cross = (a, b, p) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
const keyOf = (x, y) => `${x},${y}`;
function clean(points) {
  const out = [];
  for (const p of points) if (!out.length || Math.hypot(p.x - out.at(-1).x, p.y - out.at(-1).y) > EPS) out.push(p);
  if (out.length > 1 && Math.hypot(out[0].x - out.at(-1).x, out[0].y - out.at(-1).y) <= EPS) out.pop();
  return out;
}
function clip(points, value) {
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], va = value(a), vb = value(b), ia = va >= -EPS, ib = vb >= -EPS;
    if (ia) out.push(a);
    if (ia !== ib) { const t = va / (va - vb); out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
      ...(a.d === undefined ? {} : { d: a.d + (b.d - a.d) * t }) }); }
  }
  return clean(out);
}
function intervalUnion(intervals) {
  const out = [];
  for (const [from, to] of intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    if (to <= from + EPS) continue;
    if (out.length && from <= out.at(-1)[1] + EPS) out.at(-1)[1] = Math.max(out.at(-1)[1], to);
    else out.push([from, to]);
  }
  return out;
}
function subtractIntervals(from, to, intervals) {
  const out = []; let cursor = from;
  for (const [a, b] of intervalUnion(intervals)) {
    if (b <= cursor || a >= to) continue;
    if (a > cursor + EPS) out.push([cursor, Math.min(a, to)]);
    cursor = Math.max(cursor, b);
  }
  if (cursor < to - EPS) out.push([cursor, to]);
  return out;
}
function ownerGeometry(patch, index, grid) {
  const boundary = [], north = [], south = [], add = (axis, fixed, from, to) => boundary.push({ axis, fixed, from, to, owner: index });
  if (patch.gridTerrainId) {
    const cells = new Set(patch.source.gridCells.map(c => keyOf(c.x, c.y)));
    for (const { x, y } of patch.source.gridCells) {
      const x0 = x * grid.width, x1 = x0 + grid.width, y0 = y * grid.height, y1 = y0 + grid.height;
      if (!cells.has(keyOf(x - 1, y))) add('v', x0, y0, y1);
      if (!cells.has(keyOf(x + 1, y))) add('v', x1, y0, y1);
      if (!cells.has(keyOf(x, y - 1))) add('h', y0, x0, x1);
      if (!cells.has(keyOf(x, y + 1))) { add('h', y1, x0, x1); south.push({ y: y1, from: x0, to: x1, owner: index }); }
    }
    // This list already excludes a north face covered by an attached owner.
    for (const span of patch.surfaceSpans) north.push({ a: { ...span.from }, b: { ...span.to }, owner: index });
  } else {
    const line = patch.surface, bottom = patch.bounds.y + patch.bounds.height;
    check(Array.isArray(line) && line.length >= 2, 'TERRAIN_UNION_GEOMETRY', 'Curves need their validated sampled surface');
    add('v', line[0].x, line[0].y, bottom); add('v', line.at(-1).x, line.at(-1).y, bottom);
    add('h', bottom, line[0].x, line.at(-1).x); south.push({ y: bottom, from: line[0].x, to: line.at(-1).x, owner: index });
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i], b = line[i + 1]; north.push({ a: { ...a }, b: { ...b }, owner: index });
      if (Math.abs(a.y - b.y) < EPS) add('h', a.y, a.x, b.x);
    }
  }
  // Adjacent cell faces are a single contact interval, not a quadratic list.
  const grouped = new Map();
  for (const s of boundary) { const key = `${s.axis}/${s.fixed}`; if (!grouped.has(key)) grouped.set(key, { ...s, spans: [] }); grouped.get(key).spans.push([s.from, s.to]); }
  return { boundary: [...grouped.values()].flatMap(s => intervalUnion(s.spans).map(([from, to]) => ({ axis: s.axis, fixed: s.fixed, from, to, owner: index }))), north, south };
}

function trimCurveSides(owner, index, lines, profile, report) {
  const source = owner.body, sides = [];
  const maximumInset = Math.min(profile.maximumInsetWorld, owner.bounds.width / 4);
  const baseY = owner.bounds.y + owner.bounds.height;
  for (const sign of [1, -1]) {
    const endpoint = sign === 1 ? owner.surface[0] : owner.surface.at(-1);
    if (profile.world) {
      const boundary = sign === 1 ? profile.world.x : profile.world.x + profile.world.width;
      if (Math.abs(endpoint.x-boundary) < EPS) continue;
    }
    const attached = (lines.get(`v/${endpoint.x}`) ?? []).some(span => span.owner !== index
      && Math.min(span.to, baseY) > Math.max(span.from, endpoint.y) + EPS);
    if (attached) continue;
    // Keep the entire walkable surface, including a steep descent next to the end.
    const limitX = endpoint.x + sign * maximumInset;
    let top = endpoint.y;
    for (let i = 1; i < owner.surface.length; i++) {
      const a = owner.surface[i - 1], b = owner.surface[i];
      for (const p of [a, b]) if ((p.x - limitX) * sign <= EPS) top = Math.max(top, p.y);
      if (a.x <= limitX && limitX <= b.x) top = Math.max(top, a.y + (b.y - a.y) * (limitX - a.x) / (b.x - a.x));
    }
    if (baseY - top <= profile.sampleStepWorld * 2) continue;
    const count = Math.ceil((baseY - top) / profile.sampleStepWorld);
    const row = i => {
      const y = top + (baseY - top) * i / count;
      const taper = Math.min(1, (y - top) / maximumInset, (baseY - y) / maximumInset);
      return { y, inset: Math.min(maximumInset, profile.insetAt(endpoint.x, y)) * taper };
    };
    sides.push({ x: endpoint.x, sign, top, count, row });
  }
  if (!sides.length) return source;
  const result = mesh();
  const append = polygon => {
    for (let i = 1; i < polygon.length - 1; i++) {
      const points = [polygon[0], polygon[i], polygon[i + 1]];
      if (Math.abs(cross(...points)) <= EPS) continue;
      check(++report.triangles <= TERRAIN_UNION_MATERIAL_LIMITS.maximumOutputTriangles, 'TERRAIN_UNION_BUDGET', 'Curve relief exceeds the triangle budget');
      const start = result.positions.length / 2;
      for (const p of points) { result.positions.push(q(p.x), q(p.y)); result.uvs.push(0, 0); }
      result.indices.push(start, start + 1, start + 2);
    }
  };
  for (let i = 0; i < source.indices.length; i += 3) {
    const triangle = source.indices.slice(i, i + 3).map(n => ({ x: source.positions[2*n], y: source.positions[2*n + 1] }));
    const hits = sides.filter(s => triangle.some(p => (p.x - s.x) * s.sign < maximumInset - EPS));
    if (!hits.length) { append(triangle); continue; }
    for (const side of hits) {
      const middleX = owner.bounds.x + owner.bounds.width / 2;
      const piece = hits.length === 1 ? triangle : clip(triangle, p => (middleX - p.x) * side.sign);
      append(clip(piece, p => side.top - p.y));
      for (let j = 0; j < side.count; j++) {
        check(++report.clips <= TERRAIN_UNION_MATERIAL_LIMITS.maximumSurfaceClips, 'TERRAIN_UNION_BUDGET', 'Curve relief exceeds the clip budget');
        const a = side.row(j), b = side.row(j + 1);
        const strip = clip(clip(piece, p => p.y - a.y), p => b.y - p.y);
        append(clip(strip, p => (p.x - side.x) * side.sign - a.inset - (b.inset - a.inset) * (p.y - a.y) / (b.y - a.y)));
      }
    }
  }
  report.exposedSides += sides.length;
  return result;
}
// Body pixels keep one fixed world phase and their original physical scale.
// Exposed surfaces use local source rows with an explicit short coverage fade;
// neither source PNG nor body coordinates are warped to conceal a seam.
export function compileTerrainUnionMaterial({ gridTerrains, curveTerrains, appearance, grid = { width: 64, height: 64 }, surfaceInterface, surfaceSpanEnvelope, bottomCoverageProfile,spatialSurfaceClips=false,curveRelief }) {
  check(typeof spatialSurfaceClips==='boolean','TERRAIN_UNION_GEOMETRY','Surface index selection must be explicit');
  check(bottomCoverageProfile===undefined||bottomCoverageProfile===TERRAIN_BOTTOM_ADAPTIVE_COVERAGE_PROFILE,
    'TERRAIN_BOTTOM_JUNCTION_PROFILE','Supported top cover requires the explicit adaptive bottom coverage profile');
  const preserveTop=bottomCoverageProfile===TERRAIN_BOTTOM_ADAPTIVE_COVERAGE_PROFILE;
  check(Array.isArray(gridTerrains) && Array.isArray(curveTerrains) && grid.width === 64 && grid.height === 64,
    'TERRAIN_UNION_GEOMETRY', 'Union material requires validated grid and curve meshes');
  const materialFormat=appearance?.format==='ai_scene_continuous_terrain_appearance_v9'?appearance.bodyMaterialFormat:appearance?.format;
  const looped=materialFormat==='ai_scene_continuous_terrain_appearance_v7';
  const rigid=materialFormat==='ai_scene_continuous_terrain_appearance_v8',periodic=looped||rigid;
  const nativeLip=surfaceInterface!==undefined,interfaceDepth=nativeLip?validateTerrainSurfaceInterface(surfaceInterface,appearance):null;
  const spanEnvelope=surfaceSpanEnvelope!==undefined;
  if(spanEnvelope){check(nativeLip,'TERRAIN_SURFACE_SPAN_BINDING','Span coverage requires the explicit native lip interface');
    validateTerrainSurfaceSpanProfile(surfaceSpanEnvelope,{appearance,surfaceInterface});}
  check(['ai_scene_continuous_terrain_appearance_v5', 'ai_scene_continuous_terrain_appearance_v6','ai_scene_continuous_terrain_appearance_v7','ai_scene_continuous_terrain_appearance_v8'].includes(materialFormat),
    'TERRAIN_UNION_MATERIAL', 'Union material requires the existing measured source fields');
  const normalization = periodic||materialFormat.endsWith('_v6') ? 506 : 253, origin = ratio(appearance.surfaceOriginInBodyPixels) / normalization,
    capDepth = ratio(appearance.capDepth), capUvEnd = ratio(appearance.capUvEnd);
  const bodyWidth=periodic?ratio(appearance.bodyPeriod?.width):512,bodyHeight=periodic?ratio(appearance.bodyPeriod?.height):256;
  const bodyOriginY=rigid?ratio(appearance.bodyOriginWorldY):0;
  check(Number.isFinite(bodyOriginY)&&bodyOriginY>=0&&bodyOriginY<=4096,'RIGID_REPEAT_ORIGIN','Rigid repeat requires a bounded shared world origin');
  check(Number.isFinite(bodyWidth)&&bodyWidth>0&&bodyWidth<=4096&&Number.isFinite(bodyHeight)&&bodyHeight>0&&bodyHeight<=4096,
    'TERRAIN_UNION_MATERIAL','Loop material needs a checked bounded physical period');
  check(Number.isFinite(origin) && capDepth > 0 && capDepth <= 128 && capUvEnd > 0 && capUvEnd <= 1,
    'TERRAIN_UNION_MATERIAL', 'Measured cap and body coordinates must remain bounded');
  const outputGrid = gridTerrains.map(clone), outputCurves = curveTerrains.map(clone), owners = [...outputGrid, ...outputCurves], limits = TERRAIN_UNION_MATERIAL_LIMITS;
  check(owners.length <= limits.maximumOwners, 'TERRAIN_UNION_BUDGET', 'Union material exceeds its owner budget');
  const report = { format: 'ai_scene_terrain_union_material_report_v1', profile: TERRAIN_UNION_MATERIAL_PROFILE,
    bodyMapping: periodic?'fixed-world-rational-source-scale-period-no-coordinate-warp':'fixed-world-x512-y256-no-coordinate-warp', cap: 'exposed-local-source-strip-with-bounded-bottom-coverage',
    grouping: 'positive-length-shared-solid-boundary-no-diagonal-point-or-detached-joins',
    bodyJacobian: { dUdX: 1/bodyWidth, dUdY: 0, dVdX: 0, dVdY: 1/bodyHeight },
    ...(looped?{bodyLoopSha256:appearance.bodyLoopSha256,bodyPeriod:clone(appearance.bodyPeriod),
      physicalPixelsPerWorld:{x:appearance.body.pixelSize.width/bodyWidth,y:appearance.body.pixelSize.height/bodyHeight},
      standaloneCurvesRemapped:true}:{}),
    ...(rigid?{bodyRepeatSha256:appearance.bodyRepeatSha256,bodyPeriod:clone(appearance.bodyPeriod),bodyOriginWorldY:clone(appearance.bodyOriginWorldY),
      physicalPixelsPerWorld:{x:appearance.body.pixelSize.width/bodyWidth,y:appearance.body.pixelSize.height/bodyHeight},standaloneCurvesRemapped:true}:{}),
    capFadeWorld: nativeLip?interfaceDepth.fadeWorld:Math.min(limits.capFadeWorld,capDepth/2), capFadeBands: limits.capFadeBands,
    ...(nativeLip?{surfaceInterface:clone(surfaceInterface),surfaceOverlayDepthWorld:interfaceDepth.overlayDepthWorld,
      capSourceRows:'unchanged-native-uv-clipped-before-bulk-fascia',standaloneWorldBody:true}:{}),
    ...(spanEnvelope?{surfaceSpanEnvelope:{profile:TERRAIN_SURFACE_SPAN_PROFILE,sha256:surfaceSpanEnvelope.sha256,scope:'continuous-exposed-top-horizontal-span-within-connected-solid-group',
      interpolation:'linear-native-row-end-and-fade-no-UV-compression',sourceAlphaChanged:false}}:{}),
    sourcePngChanged: false, colorGrading: false, collision: 'original-author-solids-unchanged',
    standaloneCurves: nativeLip?'explicit-world-phase-and-native-lip':periodic?'explicit-loop-world-phase-and-local-cap':'unchanged-unless-connected-to-ordinary-grid', limits: clone(limits),
    contactComparisons: 0, exposureComparisons:0,surfaceClips: 0, outputTriangles: 0, groups: [],
    visualAcceptance: 'not-assessed', generationCalls: 0,
    ...(curveRelief?{curveSideRelief:{profile:'exposed-inset-v1',exposedSides:0,triangles:0,clips:0}}:{}),
    ...(preserveTop?{supportedTopCover:{profile:bottomCoverageProfile,source:'original-exposed-union-cap-bands',
      mask:'original-owner-solid-triangles-side-trimmed-then-adaptive-fade-before-native-bottom-cutback-no-air',
      drawOrder:'late-central-cap-then-original-native-top-corners-once-before-step-corners-in-layer',sourcePngChanged:false}}:{}) };
  if (!outputGrid.length&&!periodic&&!nativeLip&&!preserveTop) return { gridTerrains: outputGrid, curveTerrains: outputCurves, report };
  const geometry = owners.map((owner, index) => ownerGeometry(owner, index, grid)), parents = owners.map((_, i) => i),
    find = n => { while (parents[n] !== n) { parents[n] = parents[parents[n]]; n = parents[n]; } return n; },
    unite = (a, b) => { a = find(a); b = find(b); if (a !== b) parents[Math.max(a, b)] = Math.min(a, b); };
  const boundaries = geometry.flatMap(g => g.boundary);
  check(boundaries.length <= limits.maximumBoundarySegments, 'TERRAIN_UNION_BUDGET', 'Union material exceeds its boundary budget');
  const lines = new Map();
  for (const s of boundaries) { const key = `${s.axis}/${s.fixed}`; if (!lines.has(key)) lines.set(key, []); lines.get(key).push(s); }
  for (const values of lines.values()) {
    values.sort((a, b) => a.from - b.from || a.to - b.to || a.owner - b.owner);
    for (let i = 0; i < values.length; i++) for (let j = i + 1; j < values.length && values[j].from < values[i].to - EPS; j++) {
      check(++report.contactComparisons <= limits.maximumContactComparisons, 'TERRAIN_UNION_BUDGET', 'Union contact comparisons exceed their budget');
      if (values[i].owner !== values[j].owner && Math.min(values[i].to, values[j].to) > Math.max(values[i].from, values[j].from) + EPS) unite(values[i].owner, values[j].owner);
    }
  }
  const groups = new Map();
  for (let i = 0; i < owners.length; i++) { const root = find(i); if (!groups.has(root)) groups.set(root, []); groups.get(root).push(i); }
  for (const indices of groups.values()) {
    if (!periodic&&!nativeLip&&!preserveTop&&!indices.some(i => i < outputGrid.length)) continue;
    const south = indices.flatMap(i => geometry[i].south), allNorth = indices.flatMap(i => geometry[i].north), exposed = [];
    check(allNorth.length<=limits.maximumNorthSegments,'TERRAIN_UNION_BUDGET','Union north surfaces exceed the explicit budget');
    const southByY=new Map();for(const s of south){const key=q(s.y);if(!southByY.has(key))southByY.set(key,[]);southByY.get(key).push(s);}
    for (const segment of allNorth) {
      if (Math.abs(segment.a.y - segment.b.y) > EPS) { exposed.push(segment); continue; }
      const covered=[];for(const s of southByY.get(q(segment.a.y))??[]){
        check(++report.exposureComparisons<=limits.maximumExposureComparisons,'TERRAIN_UNION_BUDGET','Union exposure comparisons exceed the explicit budget');
        if(s.owner!==segment.owner&&s.to>segment.a.x&&s.from<segment.b.x)covered.push([s.from,s.to]);}
      for (const [from, to] of subtractIntervals(segment.a.x, segment.b.x, covered)) exposed.push({ a: { x: from, y: segment.a.y }, b: { x: to, y: segment.a.y }, owner: segment.owner });
    }
    check(exposed.length > 0 && exposed.length <= limits.maximumNorthSegments, 'TERRAIN_UNION_BUDGET', 'Connected union requires bounded exposed north segments');
    const groupRecord = { ownerIds: indices.map(i => owners[i].gridTerrainId ?? owners[i].curveId),
      exposedNorthSegments: exposed.map(s => ({ from: { ...s.a }, to: { ...s.b }, ownerId: owners[s.owner].gridTerrainId ?? owners[s.owner].curveId })),
      inputNorthSegmentCount: allNorth.length,
      buriedNorthWorldLength: q(allNorth.reduce((n, s) => n + Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y), 0)
        - exposed.reduce((n, s) => n + Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y), 0)) };
    report.groups.push(groupRecord);
    const envelope=spanEnvelope?buildTerrainSurfaceSpanEnvelope(exposed,{envelope:surfaceSpanEnvelope.options,capEndRow:surfaceInterface.capEndRow,fadeRows:surfaceInterface.fadeRows}):null;
    if(envelope){report.surfaceClips+=envelope.work;check(report.surfaceClips<=limits.maximumSurfaceClips,'TERRAIN_UNION_BUDGET','Span topology shares the original surface work budget');
      groupRecord.surfaceSpanEnvelope={spans:clone(envelope.spans),work:envelope.work,endpointToleranceWorld:envelope.endpointToleranceWorld};}
    const selectedBySegment=envelope?new Map(exposed.map((segment,i)=>[segment,envelope.selection[i]])):null;
    for (const index of indices) {
      const owner = owners[index];
      const before = curveRelief && !owner.gridTerrainId ? trimCurveSides(owner,index,lines,curveRelief,report.curveSideRelief) : owner.body;
      const body = clone(before), bands=[];
      let triangleIndex;
      if(spatialSurfaceClips){
        triangleIndex=new Map();
        for(let tri=0;tri<before.indices.length;tri+=3){const xs=before.indices.slice(tri,tri+3).map(n=>before.positions[n*2]);
          for(let bin=Math.floor(Math.min(...xs)/64);bin<=Math.floor(Math.max(...xs)/64);bin++){
            check(++report.surfaceClips<=limits.maximumSurfaceClips,'TERRAIN_UNION_BUDGET','Surface index exceeds the original clip-work budget');
            if(!triangleIndex.has(bin))triangleIndex.set(bin,[]);triangleIndex.get(bin).push(tri);
          }
        }
      }
      body.uvs=body.positions.map((p,i)=>q((p-(i%2?bodyOriginY:0))/(i%2?bodyHeight:bodyWidth)));
      const append = (target, polygon, segment) => {
        if (polygon.length < 3) return;
        for (let i = 1; i < polygon.length - 1; i++) {
          const points = [polygon[0], polygon[i], polygon[i + 1]]; if (Math.abs(cross(...points)) <= EPS) continue;
          check(++report.outputTriangles <= limits.maximumOutputTriangles, 'TERRAIN_UNION_BUDGET', 'Union output triangles exceed their budget');
          const start = target.positions.length / 2;
          for (const p of points) { const top=segment.a.y+(segment.b.y-segment.a.y)*(p.x-segment.a.x)/(segment.b.x-segment.a.x);
            target.positions.push(q(p.x), q(p.y)); target.uvs.push(q(p.x / 512), q((p.y-top)/capDepth*capUvEnd)); }
          target.indices.push(start, start + 1, start + 2);
        }
      };
      check(before && before.positions.length === before.uvs.length && before.indices.length % 3 === 0,
        'TERRAIN_UNION_GEOMETRY', 'Union owners require validated indexed body triangles');
      report.outputTriangles+=body.indices.length/3;
      check(report.outputTriangles<=limits.maximumOutputTriangles,'TERRAIN_UNION_BUDGET','Union body triangles exceed the explicit budget');
      const fade=report.capFadeWorld,ownNorth=exposed.filter(s=>s.owner===index);
      for(const segment of ownNorth){
        const selected=selectedBySegment?.get(segment),rowWorld=selected?capDepth/(capUvEnd*appearance.cap.pixelSize.height):0,
          segmentFade=selected?selected.fadeRows*rowWorld:fade,
          overlayEnd=selected?selected.capEndRow*rowWorld:nativeLip?interfaceDepth.overlayDepthWorld:capDepth,opaqueEnd=overlayEnd-segmentFade;
        let triangleStarts;
        if(triangleIndex){const ids=new Set();for(let bin=Math.floor(segment.a.x/64);bin<=Math.floor(segment.b.x/64);bin++){
          check(++report.surfaceClips<=limits.maximumSurfaceClips,'TERRAIN_UNION_BUDGET','Surface queries exceed the original clip-work budget');
          for(const tri of triangleIndex.get(bin)??[])ids.add(tri);
        }triangleStarts=[...ids].sort((a,b)=>a-b);}
        else triangleStarts=Array.from({length:before.indices.length/3},(_,i)=>i*3);
        const depth=p=>p.y-segment.a.y-(segment.b.y-segment.a.y)*(p.x-segment.a.x)/(segment.b.x-segment.a.x);
        const ranges=[{from:0,to:opaqueEnd,opacity:1},...(segmentFade>0?Array.from({length:limits.capFadeBands},(_,n)=>({
          from:opaqueEnd+segmentFade*n/limits.capFadeBands,to:opaqueEnd+segmentFade*(n+1)/limits.capFadeBands,opacity:1-(n+.5)/limits.capFadeBands})):[])];
        for(const range of ranges){const band=mesh();
          for(const tri of triangleStarts){
            check(++report.surfaceClips<=limits.maximumSurfaceClips,'TERRAIN_UNION_BUDGET','Exposed surface clips exceed the explicit budget');
            let piece=before.indices.slice(tri,tri+3).map(n=>({x:before.positions[n*2],y:before.positions[n*2+1]}));
            if(Math.max(...piece.map(p=>p.x))<segment.a.x-EPS||Math.min(...piece.map(p=>p.x))>segment.b.x+EPS)continue;
            for(const predicate of [p=>p.x-segment.a.x,p=>segment.b.x-p.x,p=>depth(p)-range.from,p=>range.to-depth(p)])piece=clip(piece,predicate);
            append(band,piece,segment);
          }
          if(band.indices.length)bands.push({...band,coverageOpacity:q(range.opacity),coverageProfile:'local-surface-bottom-source-over-v1',
            localDepth:{fromWorld:q(range.from),toWorld:q(range.to)},...(selected?{surfaceSpanEnvelope:clone(selected)}:{}),sourcePngChanged:false});
        }
      }
      owner.body = body; owner.cap = mesh();owner.capBands=bands;
      if(preserveTop){
        const triangles=bands.reduce((n,b)=>n+b.indices.length/3,0);report.outputTriangles+=triangles;
        check(report.outputTriangles<=limits.maximumOutputTriangles,'TERRAIN_UNION_BUDGET','Supported top cover exceeds the original bounded output budget');
        owner.topCoverBands=bands.map(band=>({...clone(band),coverageProfile:'supported-top-cover-after-native-bottom-v2',
          originalSolidOnly:true,sourcePngChanged:false}));
      }
      owner.materialMapping = { ...owner.materialMapping, bodyMapping: 'fixed-world-x512-y256-v1',
        ...(looped?{bodyMapping:'fixed-world-source-scale-period-v1',bodyPeriod:{width:bodyWidth,height:bodyHeight},
          bodyPeriodRational:clone(appearance.bodyPeriod),bodyLoopSha256:appearance.bodyLoopSha256}:{}),
        ...(rigid?{bodyMapping:'fixed-world-rigid-row-repeat-v1',bodyPeriod:{width:bodyWidth,height:bodyHeight},
          bodyPeriodRational:clone(appearance.bodyPeriod),bodyOriginWorldY:clone(appearance.bodyOriginWorldY),bodyRepeatSha256:appearance.bodyRepeatSha256}:{}),
        capMapping: 'exposed-local-vertical-source-depth-with-bottom-coverage-v1', unionMaterialProfile: TERRAIN_UNION_MATERIAL_PROFILE,
        sourceOriginNormalizationHeight: normalization, surfaceOriginInBodyPixels: clone(appearance.surfaceOriginInBodyPixels),
        capUvEnd: clone(appearance.capUvEnd), capDepth: clone(appearance.capDepth), capFadeWorld:fade,
        ...(nativeLip?{surfaceInterface:clone(surfaceInterface),surfaceOverlayDepthWorld:interfaceDepth.overlayDepthWorld}:{}),
        bodyJacobian:clone(report.bodyJacobian) };
      owner.unionMaterial = { profile: TERRAIN_UNION_MATERIAL_PROFILE, group: report.groups.length - 1,
        geometry: 'original-solid-triangles-fixed-world-material-phase', cap: 'exposed-local-source-strip-with-bottom-coverage',
        ...(nativeLip?{surfaceInterface:clone(surfaceInterface),surfaceOverlayDepthWorld:interfaceDepth.overlayDepthWorld}:{}),
        sourcePngChanged: false, colorGrading: false, visualAcceptance: 'not-assessed' };
      if (owner.gridTerrainId) owner.stepPhase = 'fixed-world-body-no-column-or-owner-reset-v1';
    }
  }
  return { gridTerrains: outputGrid, curveTerrains: outputCurves, report };
}
