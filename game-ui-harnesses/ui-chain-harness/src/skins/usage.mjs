import { sliceSource, measureSlices, sides } from '../slicing/geometry.mjs';

// Single adapter for package pixels, logical slices and both rendering APIs.
// This never infers new cuts or mutates authoring metadata during loading.
export function skinUsage(meta, width, height, scale = 1) {
  if (!Number.isFinite(scale) || scale <= 0) throw Error('Invalid skin scale.');
  const resolution = scale * (meta.density ?? 1);
  const source = sliceSource({ width, height, density: resolution, borders: meta.nineSlice, borderUnits: 'logical' });
  const borders = source.borders;
  return {
    ...source, resolution,
    tuple: [borders.left, borders.top, borders.right, borders.bottom],
    pixi: { leftWidth: borders.left, topHeight: borders.top, rightWidth: borders.right, bottomHeight: borders.bottom },
    contentInsets: Object.fromEntries(sides.map(k => [k, meta.contentInsets[k]])),
    measure(width, height, multiplier = 1) { return measureSlices({ ...source, width, height, multiplier }); },
  };
}
