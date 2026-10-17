import { analyzePanelStructure } from './structure.mjs';
// Conservative, deterministic first pass: panels with a broad, repeated
// central row/column band. Compare every pixel, including edge decorations.
// No resizing, sampling, image generation or probabilistic confidence score.
export function analyzePanel({ width, height, pixels }, { axis = 'both' } = {}) {
  if (!['both', 'horizontal', 'vertical'].includes(axis))
    return { status: 'unsupported', reason: '不支持的拉伸方向。' };
  if (![width, height].every(n => Number.isInteger(n) && n >= 8 && n <= 4096)
    || !(pixels instanceof Uint8Array || pixels instanceof Uint8ClampedArray)
    || pixels.length !== width * height * 4)
    return { status: 'unsupported', reason: '图片尺寸或像素数据不适合自动分析。' };
  const cx = Math.floor(width / 2), cy = Math.floor(height / 2);
  if (pixels[(cy * width + cx) * 4 + 3] < 32)
    return { status: 'unsupported', reason: '中心透明或过于稀薄，无法可靠识别可拉伸区域。' };
  // Premultiplied comparison ignores invisible RGB without discarding alpha.
  const equal = (a, b) => {
    const aa = pixels[a + 3], ba = pixels[b + 3];
    if (Math.abs(aa - ba) > 2) return false;
    for (let c = 0; c < 3; c++)
      if (Math.abs(pixels[a + c] * aa - pixels[b + c] * ba) > 2 * 255) return false;
    return true;
  };
  const band = horizontal => {
    const length = horizontal ? width : height, cross = horizontal ? height : width;
    const center = Math.floor(length / 2);
    const matches = index => {
      for (let j = 0; j < cross; j++) {
        const a = horizontal ? j * width + index : index * width + j;
        const b = horizontal ? j * width + center : center * width + j;
        if (!equal(a * 4, b * 4)) return false;
      }
      return true;
    };
    let lo = center, hi = center;
    while (lo > 0 && matches(lo - 1)) lo--;
    while (hi + 1 < length && matches(hi + 1)) hi++;
    // Keep a matching texel inside each edge for linear-filter seams.
    return { start: lo === 0 ? 0 : lo + 1, end: hi === length - 1 ? length : hi };
  };
  const x = band(true), y = band(false);
  if ((axis !== 'vertical' && x.end - x.start < Math.max(4, Math.ceil(width / 4)))
    || (axis !== 'horizontal' && y.end - y.start < Math.max(4, Math.ceil(height / 4))))
    return analyzePanelStructure({ width, height, pixels }, { axis });
  return { status: 'supported', method: 'repeated-center-bands-v1',
    bordersPx: { left: axis === 'vertical' ? 0 : x.start, top: axis === 'horizontal' ? 0 : y.start,
      right: axis === 'vertical' ? 0 : width - x.end, bottom: axis === 'horizontal' ? 0 : height - y.end } };
}
