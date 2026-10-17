// Renderer-independent geometry. All inputs here use logical units. Source-pixel
// conversion belongs to document.mjs; output resolution never enters this math.
import schema from '../../../schemas/slice-document.schema.json' with { type: 'json' };

export const sides = Object.freeze(['left', 'top', 'right', 'bottom']);
export const multiplierRange = Object.freeze({
  min: schema.properties.multiplier.minimum,
  max: schema.properties.multiplier.maximum,
});
export function sliceError(code, message) {
  throw Object.assign(new Error(message), { code });
}
// Shared source conversion for Panel documents and component skin metadata.
// Density is physical pixels per logical unit; border units must be explicit.
export function sliceSource({ width, height, density = 1, borders, borderUnits = 'pixels' }) {
  if (![width, height, density].every(n => Number.isFinite(n) && n > 0))
    sliceError('slice.source', 'Source dimensions and density must be positive.');
  if (!['pixels', 'logical'].includes(borderUnits) || !borders || sides.some(k => !Number.isFinite(borders[k]) || borders[k] < 0))
    sliceError('slice.border', 'Expected four non-negative borders with explicit units.');
  return {
    sourceWidth: width / density, sourceHeight: height / density,
    borders: Object.fromEntries(sides.map(k => [k, borders[k] / (borderUnits === 'pixels' ? density : 1)])),
  };
}
export function measureSlices({ sourceWidth, sourceHeight, borders, width, height, multiplier = 1, resizePolicy }) {
  if (![sourceWidth, sourceHeight, width, height].every(n => Number.isFinite(n) && n > 0))
    sliceError('slice.size', '图片和目标尺寸必须为正数。');
  if (!Number.isFinite(multiplier) || multiplier < multiplierRange.min || multiplier > multiplierRange.max)
    sliceError('slice.multiplier', `边框倍率须在 ${multiplierRange.min}–${multiplierRange.max} 之间。`);
  if (!borders || sides.some(k => !Number.isFinite(borders[k]) || borders[k] < 0))
    sliceError('slice.border', '四边切线必须是非负数。');
  const horizontal = borders.left + borders.right, vertical = borders.top + borders.bottom;
  if (horizontal >= sourceWidth || vertical >= sourceHeight)
    sliceError('slice.center', '切线之间必须保留原图中心区域。');
  const minWidth = horizontal / multiplier, minHeight = vertical / multiplier;
  if (width < minWidth || height < minHeight)
    sliceError('slice.minimum', `当前倍率需要至少 ${Math.ceil(minWidth)} × ${Math.ceil(minHeight)} 的尺寸。`);
  if (resizePolicy) {
    if (resizePolicy !== 'texture-balanced-v1') sliceError('slice.policy', '未知尺寸适用规则。');
    const x = (width * multiplier - horizontal) / (sourceWidth - horizontal);
    const y = (height * multiplier - vertical) / (sourceHeight - vertical);
    if (Math.min(x, y) < .25 || Math.max(x, y) > 4 || Math.max(x / y, y / x) > 3)
      sliceError('slice.distortion', '此纹理素材不适合当前尺寸：中心区域拉伸或横纵差异过大。请使用更接近原图比例的尺寸，或更换素材。');
  }
  return {
    width, height, multiplier, minWidth, minHeight,
    innerWidth: width * multiplier, innerHeight: height * multiplier,
    scale: 1 / multiplier,
    displayedBorders: Object.fromEntries(sides.map(k => [k, borders[k] / multiplier])),
  };
}
