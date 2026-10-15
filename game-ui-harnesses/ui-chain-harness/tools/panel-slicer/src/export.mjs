import { Rectangle } from 'pixi.js';
import { maxExportSide } from './document.mjs';
import { sliceError } from './geometry.mjs';

// Capture synchronously before awaiting PNG encoding. Concurrent edits cannot
// alter this snapshot. The caller owns the download and stale-result policy.
export async function exportBackgroundPng(renderer, background, resolution = 1) {
  const { width, height } = background;
  if (![1, 2, 4].includes(resolution) || ![width, height].every(n => Number.isInteger(n) && n > 0 && n * resolution <= maxExportSide))
    sliceError('slice.export-size', 'PNG 尺寸或导出分辨率超出限制。');
  const extracted = renderer.extract.pixels({
    target: background, frame: new Rectangle(0, 0, width, height),
    resolution, clearColor: [0, 0, 0, 0],
  });
  // Pixi 8.20.1 WebGL extraction returns premultiplied RGB. ImageData and PNG
  // require straight RGB; passing those bytes directly to a canvas darkens
  // translucent edges a second time. All slicing consumers use WebGL.
  const pixels = new Uint8ClampedArray(extracted.pixels);
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3];
    for (let channel = 0; channel < 3; channel++)
      pixels[i + channel] = alpha ? Math.round(pixels[i + channel] * 255 / alpha) : 0;
  }
  const canvas = document.createElement('canvas');
  canvas.width = extracted.width; canvas.height = extracted.height;
  canvas.getContext('2d').putImageData(new ImageData(pixels, extracted.width, extracted.height), 0, 0);
  const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG 编码失败。')), 'image/png'));
  return { blob, width: width * resolution, height: height * resolution };
}
