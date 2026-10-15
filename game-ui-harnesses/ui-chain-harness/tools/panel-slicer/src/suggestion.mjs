import { analyzePanel } from './analyze.mjs';
import { sliceSource } from './geometry.mjs';

// Analyze exact delivered PNG pixels, including contain padding. Suggestions
// never change density, safe areas, minimum sizes, or an accepted manual cut.
export function suggestSlices(image, resolution = 1, options) {
  const result = analyzePanel(image, options);
  if (result.status !== 'supported') return result;
  return { ...result, nineSlice: sliceSource({ ...image, density: resolution, borders: result.bordersPx }).borders };
}
