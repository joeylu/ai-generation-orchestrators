/** Pure state helpers shared by the browser runtime and its regression tests. */
export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/** Snap a finite value to the document's inclusive slider lattice. */
export function snapSlider(value: number, minimum: number, maximum: number, step: number): number {
  if (![value, minimum, maximum, step].every(Number.isFinite) || maximum <= minimum || step <= 0) {
    throw new TypeError('INVALID_SLIDER_RANGE');
  }
  const span = (maximum - minimum) / step;
  if (!Number.isFinite(span)) throw new TypeError('INVALID_SLIDER_RANGE');
  const last = isStepAligned(maximum, minimum, step) ? Math.round(span) : Math.floor(span);
  const index = clamp(Math.round((clamp(value, minimum, maximum) - minimum) / step), 0, last);
  const snapped = minimum + index * step;
  // Preserve fractional origins and scientific notation, not just step's decimal tail.
  const places = (n: number) => { const [mantissa, exponent = '0'] = String(n).split('e'); return Math.max(0, (mantissa.split('.')[1]?.length ?? 0) - Number(exponent)); };
  const precision = Math.max(places(minimum), places(step));
  const rounded = precision <= 100 ? Number(snapped.toFixed(precision)) : snapped;
  if (rounded >= minimum && rounded <= maximum && isStepAligned(rounded, minimum, step)) return rounded;
  if (snapped >= minimum && snapped <= maximum && isStepAligned(snapped, minimum, step)) return snapped;
  if (index === last && isStepAligned(maximum, minimum, step)) return maximum;
  throw new TypeError('UNREPRESENTABLE_SLIDER_VALUE');
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
