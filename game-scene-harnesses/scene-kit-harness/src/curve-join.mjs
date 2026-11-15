import { demand } from './errors.mjs';
import { deepFreeze } from './document.mjs';

export const CURVE_JOIN_POLICY = deepFreeze({ profile: 'curve-endpoint-join-v1',
  screenRadius: 12, maximumDistance: 64, retainedId: 'left-curve',
  position: 'stationary-endpoint', tangent: 'horizontal', trigger: 'drag-release-or-explicit-command',
});
const check = (condition, code, message) => demand(condition, code, 'commands.json', '/curveJoin', message);
export function curveEndpoint(curve, index) {
  return index === 0 ? 'start' : index === curve.points.length - 1 ? 'end' : null;
}

// The editor validates the closed author schema first; final topology and meshes
// are validated on the complete merged draft before a command can commit.
export function joinCurveTerrains(document, moved, endpoint, targetCurveId) {
  check(['start', 'end'].includes(endpoint), 'CURVE_JOIN_ENDPOINT', 'Choose a curve endpoint');
  const source = document.curveTerrains?.find(curve => curve.curveId === moved?.curveId);
  const target = document.curveTerrains?.find(curve => curve.curveId === targetCurveId);
  check(source && target && source !== target, 'CURVE_JOIN_TARGET', 'Join requires two different existing curves');
  check(!document.terrainConnections?.some(c=>(c.curveId===source.curveId&&c.endpoint===endpoint)
    ||(c.curveId===target.curveId&&c.endpoint===(endpoint==='end'?'start':'end'))),
    'GRID_CONNECTION_LOCKED','Disconnect the grid endpoint before joining curves');
  check(moved.familyId === target.familyId && moved.profile === target.profile,
    'CURVE_JOIN_MATERIAL', 'Joined curves require the same material family and profile');
  check(moved.baseY === target.baseY, 'CURVE_JOIN_BASE', 'Joined curves require the same solid base');
  const movingPoint = endpoint === 'end' ? moved.points.at(-1) : moved.points[0];
  const stationaryPoint = endpoint === 'end' ? target.points[0] : target.points.at(-1);
  check(Math.hypot(movingPoint.x - stationaryPoint.x, movingPoint.y - stationaryPoint.y) <= CURVE_JOIN_POLICY.maximumDistance,
    'CURVE_JOIN_DISTANCE', 'Endpoints are outside the join distance');
  check(movingPoint.slope === 0 && stationaryPoint.slope === 0, 'CURVE_ENDPOINT_TANGENT', 'Endpoint tangents must be horizontal');
  const left = endpoint === 'end' ? moved : target, right = endpoint === 'end' ? target : moved;
  const points = [...left.points.slice(0, -1), { ...stationaryPoint }, ...right.points.slice(1)].map(point => ({ ...point }));
  check(points.length <= 32, 'CURVE_JOIN_POINT_LIMIT', 'Merged curve exceeds 32 control points');
  check(points.at(-1).x - points[0].x <= 4096, 'CURVE_JOIN_SPAN', 'Merged curve exceeds 4096 units');
  check(points.every((point, index) => !index || point.x - points[index - 1].x >= 32),
    'CURVE_POINT_ORDER', 'Merged points need increasing x and at least 32 units spacing');
  const curve = { ...left, points }, joinPointIndex = left.points.length - 1;
  return { curve, removedCurveId: right.curveId, joinPointIndex,
    ...(document.terrainConnections?{connections:document.terrainConnections.map(c=>c.curveId===right.curveId?{...c,curveId:left.curveId}:c)}:{}),
    curves: document.curveTerrains.filter(item => item.curveId !== left.curveId && item.curveId !== right.curveId).concat([curve]) };
}

// Screen distance controls the gesture, while the independent world cap prevents
// a distant join when zoomed far out. No merge happens on load or camera change.
export function findCurveEndpointJoin(document, moved, pointIndex, scale) {
  const endpoint = curveEndpoint(moved, pointIndex);
  if (!endpoint || !(scale > 0)) return null;
  const point = moved.points[pointIndex], radius = Math.min(CURVE_JOIN_POLICY.maximumDistance, CURVE_JOIN_POLICY.screenRadius / scale);
  const candidates = (document.curveTerrains ?? []).filter(curve => curve.curveId !== moved.curveId).map(curve => {
    const target = endpoint === 'end' ? curve.points[0] : curve.points.at(-1);
    return { targetCurveId: curve.curveId, target: { ...target }, distance: Math.hypot(point.x - target.x, point.y - target.y) };
  }).filter(item => item.distance <= radius).sort((a, b) => a.distance - b.distance || (a.targetCurveId < b.targetCurveId ? -1 : a.targetCurveId > b.targetCurveId ? 1 : 0));
  if (!candidates.length) return null;
  const candidate = { ...candidates[0], endpoint, command: { type: 'join-curve-terrains', curve: moved, endpoint, targetCurveId: candidates[0].targetCurveId } };
  try { return { ...candidate, merged: joinCurveTerrains(document, moved, endpoint, candidate.targetCurveId), blocked: null }; }
  catch (error) { return { ...candidate, merged: null, blocked: error.errors?.[0]?.code ?? 'CURVE_JOIN_TARGET' }; }
}
