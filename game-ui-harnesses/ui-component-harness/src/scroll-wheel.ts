/** Runtime input policy, shared with keyboard arrows; not observed content size. */
export const SCROLL_LINE_STEP = 40;

/** DOM deltaMode 0/1/2 -> logical canvas units. Null means an invalid event. */
export function scrollWheelDelta(
  event: { deltaMode: number; deltaX: number; deltaY: number },
  viewport: { width: number; height: number },
): { x: number; y: number } | null {
  const { deltaMode, deltaX, deltaY } = event;
  if (![0, 1, 2].includes(deltaMode) || ![deltaX, deltaY, viewport.width, viewport.height].every(Number.isFinite)
    || viewport.width <= 0 || viewport.height <= 0) return null;
  const x = deltaX * (deltaMode === 2 ? viewport.width : deltaMode === 1 ? SCROLL_LINE_STEP : 1);
  const y = deltaY * (deltaMode === 2 ? viewport.height : deltaMode === 1 ? SCROLL_LINE_STEP : 1);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}
