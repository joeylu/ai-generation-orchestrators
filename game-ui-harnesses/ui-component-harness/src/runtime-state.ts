/** Pure state helpers shared by the browser runtime and its regression tests. */
export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/** Snap a finite value to the document's inclusive slider lattice. */
export function snapSlider(value: number, minimum: number, maximum: number, step: number): number {
  if (![value, minimum, maximum, step].every(Number.isFinite) || maximum <= minimum || step <= 0) {
    throw new TypeError('INVALID_SLIDER_RANGE');
  }
  const snapped = minimum + Math.round((clamp(value, minimum, maximum) - minimum) / step) * step;
  // Decimal steps can leave a representational tail.  This keeps validated values on the same lattice.
  const precision = Math.min(12, Math.max(0, `${step}`.split('.')[1]?.length ?? 0));
  return clamp(Number(snapped.toFixed(precision)), minimum, maximum);
}

/** Match the contract's tolerance without turning an invalid program value into a new value. */
export function isStepAligned(value: number, minimum: number, step: number): boolean {
  if (![value, minimum, step].every(Number.isFinite) || step <= 0) return false;
  const quotient = (value - minimum) / step;
  return Math.abs(quotient - Math.round(quotient)) <= Number.EPSILON * Math.max(1, Math.abs(quotient)) * 8;
}

export function clampScroll(value: number, content: number, viewport: number): number {
  if (![value, content, viewport].every(Number.isFinite) || content <= 0 || viewport <= 0) {
    throw new TypeError('INVALID_SCROLL_RANGE');
  }
  return clamp(value, 0, Math.max(0, content - viewport));
}
