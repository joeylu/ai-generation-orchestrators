import { encodeRgbaPng } from '../../src/png.mjs';

export function animationAtlas(colors) {
  const cell = 32, width = cell * colors.length;
  const rgba = Buffer.alloc(width * cell * 4);
  for (const [index, color] of colors.entries()) {
    for (let y = 5; y < 27; y++) for (let x = 5; x < 27; x++)
      rgba.set([...color, 255], (y * width + x + index * cell) * 4);
  }
  return encodeRgbaPng(width, cell, rgba);
}
