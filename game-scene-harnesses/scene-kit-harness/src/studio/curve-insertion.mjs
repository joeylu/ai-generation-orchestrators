import { CURVE_PROFILE, sampleCurve } from '../curves.mjs';

// Work in world coordinates; the hit radius stays constant on screen when zooming.
export function findCurveSurface(curves, position, scale, selectedCurveId = '') {
  if (!(scale > 0) || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return null;
  let best = null;
  for (const curve of curves) {
    const line = sampleCurve(curve);
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i], dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((position.x - a.x) * dx + (position.y - a.y) * dy) / (dx * dx + dy * dy)));
      const x = a.x + t * dx, y = a.y + t * dy, distance = Math.hypot(position.x - x, position.y - y) * scale;
      if (distance <= 10 && (!best || distance < best.distance - 1e-6 ||
        (Math.abs(distance - best.distance) <= 1e-6 && curve.curveId === selectedCurveId))) best = { curve, x, distance };
    }
  }
  return best;
}

// Split the existing Hermite segment, rather than pulling its outline to the mouse.
export function insertCurvePoint(curve, requestedX) {
  const blocked = message => ({ message });
  if (curve.points.length >= 32) return blocked('每条曲线最多 32 个控制点，请先删除多余点。');
  const x = Math.round(requestedX), index = curve.points.findIndex((p, i) => i && curve.points[i - 1].x < x && x < p.x);
  if (index < 1) return blocked('请在两个控制点之间的曲线边缘双击。');
  const a = curve.points[index - 1], b = curve.points[index], dx = b.x - a.x;
  if (x - a.x < CURVE_PROFILE.minimumPointSpacing || b.x - x < CURVE_PROFILE.minimumPointSpacing)
    return blocked('这里离已有控制点太近，请换个位置；相邻点至少间隔 32 单位。');
  const t = (x - a.x) / dx;
  const y = (2 * t ** 3 - 3 * t ** 2 + 1) * a.y + (t ** 3 - 2 * t ** 2 + t) * dx * a.slope
    + (-2 * t ** 3 + 3 * t ** 2) * b.y + (t ** 3 - t ** 2) * dx * b.slope;
  const slope = Math.round(((6 * t * t - 6 * t) * a.y / dx + (3 * t * t - 4 * t + 1) * a.slope
    + (-6 * t * t + 6 * t) * b.y / dx + (3 * t * t - 2 * t) * b.slope) * 1e6) / 1e6;
  if (Math.abs(slope) > CURVE_PROFILE.maximumSlope) return blocked('这里的坡度过大，请选择更平缓的位置加点。');
  const next = structuredClone(curve);
  next.points.splice(index, 0, { x, y: Math.round(y), slope });
  return { curve: next, pointIndex: index };
}
