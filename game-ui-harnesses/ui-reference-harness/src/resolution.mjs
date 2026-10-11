import { canonical, exact, requireThat } from './common.mjs';

export function resolutionPolicy(mode = 'native') {
  requireThat(['native', 'exact'].includes(mode), 'RESOLUTION_MODE_INVALID');
  return mode === 'exact' ? { mode } : { mode, minEdge: 256, maxEdge: 4096, maxAspectRatioErrorBps: 100 };
}
export function validateResolution(policy) {
  requireThat(policy && canonical(policy) === canonical(resolutionPolicy(policy.mode)), 'RESOLUTION_POLICY_INVALID');
  return policy;
}
function validateCanvas(value) {
  exact(value, ['width', 'height']);
  requireThat(Object.values(value).every(n => Number.isInteger(n) && n > 0 && n <= 4096), 'CANVAS_INVALID');
}
export function coordinateMapping(logicalCanvas, pixelCanvas, policy) {
  validateCanvas(logicalCanvas); validateCanvas(pixelCanvas); validateResolution(policy);
  if (policy.mode === 'exact') {
    requireThat(canonical(logicalCanvas) === canonical(pixelCanvas), 'GENERATED_SIZE_MISMATCH');
  } else {
    requireThat(Math.min(pixelCanvas.width, pixelCanvas.height) >= policy.minEdge
      && Math.max(pixelCanvas.width, pixelCanvas.height) <= policy.maxEdge, 'GENERATED_RESOLUTION_BOUNDS');
    // Relative aspect-ratio error, using integer cross-products and no rounding.
    const actual = pixelCanvas.width * logicalCanvas.height;
    const expected = pixelCanvas.height * logicalCanvas.width;
    requireThat(Math.abs(actual - expected) * 10000 <= expected * policy.maxAspectRatioErrorBps, 'GENERATED_ASPECT_RATIO_MISMATCH');
  }
  return { kind: 'ui_reference_coordinate_mapping_v1', logicalCanvas, pixelCanvas,
    origin: 'top-left', offset: { x: 0, y: 0 },
    scale: { x: { numerator: pixelCanvas.width, denominator: logicalCanvas.width },
      y: { numerator: pixelCanvas.height, denominator: logicalCanvas.height } },
    geometryEvidence: 'canvas-transform-only-human-layout-review-required' };
}
export function verifyMapping(mapping, logicalCanvas, pixelCanvas, policy) {
  requireThat(canonical(mapping) === canonical(coordinateMapping(logicalCanvas, pixelCanvas, policy)), 'COORDINATE_MAPPING_MISMATCH');
}
