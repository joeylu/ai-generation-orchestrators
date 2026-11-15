import { check } from '../generation/common.mjs';

export const raster = (width, height) => ({ width, height, rgba: Buffer.alloc(width * height * 4) });
const index = (image, x, y) => (y * image.width + x) * 4;
export function validateRaster(image) {
  check(image && Number.isSafeInteger(image.width) && Number.isSafeInteger(image.height) && image.width > 0 && image.height > 0
    && image.width <= 4096 && image.height <= 4096 && image.rgba instanceof Uint8Array
    && image.rgba.length === image.width * image.height * 4, 'PROOF_RASTER');
}

// Pixel boundaries are integer multiples of the destination dimension. Each
// destination footprint has exactly rect.width * rect.height integer weight.
// Opaque material only: no alpha interpretation or hidden-background repair.
export function areaResample(source, rect, width, height) {
  validateRaster(source);
  check([rect.x, rect.y, rect.width, rect.height, width, height].every(Number.isSafeInteger)
    && rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0 && width > 0 && height > 0
    && width <= rect.width && height <= rect.height
    && rect.x + rect.width <= source.width && rect.y + rect.height <= source.height, 'PROOF_CROP');
  const result = raster(width, height), denominator = rect.width * rect.height;
  for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < width; dx++) {
    const x0 = dx * rect.width, x1 = (dx + 1) * rect.width, y0 = dy * rect.height, y1 = (dy + 1) * rect.height;
    const sums = [0, 0, 0];
    for (let sy = Math.floor(y0 / height); sy < Math.ceil(y1 / height); sy++) {
      const wy = Math.min(y1, (sy + 1) * height) - Math.max(y0, sy * height);
      for (let sx = Math.floor(x0 / width); sx < Math.ceil(x1 / width); sx++) {
        const wx = Math.min(x1, (sx + 1) * width) - Math.max(x0, sx * width), p = index(source, rect.x + sx, rect.y + sy);
        check(source.rgba[p + 3] === 255, 'PROOF_SOURCE_ALPHA');
        for (let channel = 0; channel < 3; channel++) sums[channel] += source.rgba[p + channel] * wx * wy;
      }
    }
    const p = index(result, dx, dy);
    for (let channel = 0; channel < 3; channel++) result.rgba[p + channel] = Math.floor((sums[channel] + Math.floor(denominator / 2)) / denominator);
    result.rgba[p + 3] = 255;
  }
  return result;
}

export function periodize(source, band, vertical) {
  validateRaster(source);
  check(Number.isSafeInteger(band) && band > 0 && band * 2 <= source.width && (!vertical || band * 2 <= source.height), 'PROOF_BLEND');
  const result = { width: source.width, height: source.height, rgba: Buffer.from(source.rgba) };
  const blendAxis = horizontal => {
    const length = horizontal ? result.width : result.height, cross = horizontal ? result.height : result.width;
    for (let i = 0; i < cross; i++) for (let d = 0; d < band; d++) {
      const a = index(result, horizontal ? d : i, horizontal ? i : d);
      const b = index(result, horizontal ? length - d - 1 : i, horizontal ? i : length - d - 1);
      const weight = band - d;
      for (let channel = 0; channel < 3; channel++) {
        const left = result.rgba[a + channel], right = result.rgba[b + channel];
        const mean = Math.floor((left + right + 1) / 2);
        result.rgba[a + channel] = Math.floor((left * d + mean * weight + Math.floor(band / 2)) / band);
        result.rgba[b + channel] = Math.floor((right * d + mean * weight + Math.floor(band / 2)) / band);
      }
    }
  };
  blendAxis(true); if (vertical) blendAxis(false);
  return result;
}

export function blit(target, source, x, y) {
  check(x >= 0 && y >= 0 && x + source.width <= target.width && y + source.height <= target.height, 'PROOF_BLIT');
  for (let row = 0; row < source.height; row++) target.rgba.set(source.rgba.subarray(row * source.width * 4, (row + 1) * source.width * 4), index(target, x, y + row));
}
