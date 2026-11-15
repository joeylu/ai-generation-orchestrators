// Geometry-only review of an independently observed world-space foreground extent.
// This does not inspect alpha, certify grounding, or alter rendering or author data.
export function reviewForegroundBottom({ bounds, camera, parallax }) {
  const finite = (...values) => values.every(Number.isFinite);
  const d = camera?.centerDomainWorld, o = camera?.referenceCenterWorld, v = camera?.viewportWorld;
  if (!bounds || !d || !o || !v || !parallax || !finite(bounds.x, bounds.y, bounds.width, bounds.height,
    d.minX, d.maxX, d.minY, d.maxY, o.x, o.y, v.width, v.height, parallax.x, parallax.y)
    || bounds.width <= 0 || bounds.height <= 0 || v.width <= 0 || v.height <= 0
    || d.minX > d.maxX || d.minY > d.maxY || !Array.isArray(camera.modes) || !camera.modes.length
    || new Set(camera.modes).size !== camera.modes.length
    || camera.modes.some(mode => !['editor-unparallax', 'play-parallax'].includes(mode))) {
    throw new TypeError('Invalid foreground camera review inputs');
  }
  const span = (origin, min, max, factor, half) => {
    const a = origin + (min - origin) * factor, b = origin + (max - origin) * factor;
    const result = [Math.min(a, b) - half, Math.max(a, b) + half];
    if (!finite(a, b, ...result)) throw new TypeError('Foreground camera review overflow');
    return result;
  };
  if (!finite(bounds.x + bounds.width, bounds.y + bounds.height)) throw new TypeError('Foreground camera review overflow');
  const modes = camera.modes.map(mode => {
    const x = mode === 'editor-unparallax' ? 1 : parallax.x;
    const y = mode === 'editor-unparallax' ? 1 : parallax.y;
    const [left, right] = span(o.x, d.minX, d.maxX, x, v.width / 2);
    const [top, bottom] = span(o.y, d.minY, d.maxY, y, v.height / 2);
    const edge = bounds.y + bounds.height;
    return { mode, visibleWorldUnion: { left, right, top, bottom },
      bottomMayEnterView: bounds.x < right && bounds.x + bounds.width > left && edge >= top && edge < bottom };
  });
  return { modes, bottomMayEnterView: modes.some(mode => mode.bottomMayEnterView),
    limitations: 'bounds-only; alpha, occlusion, support, continuity and art acceptance not assessed' };
}
