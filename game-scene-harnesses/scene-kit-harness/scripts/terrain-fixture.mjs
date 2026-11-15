import { encodeFixturePng } from '../src/png.mjs';

// Engineering source fixture, never an AI-generated material or an art sample.
export function syntheticTerrainMaterial(width = 1024, height = 512) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const top = y < Math.floor(height / 8), p = (y * width + x) * 4;
    rgba[p] = top ? 70 + x % 40 : 100 + Math.floor(x / 24) % 60;
    rgba[p + 1] = top ? 120 + y % 70 : 85 + Math.floor(y / 20) % 70;
    rgba[p + 2] = top ? 55 : 70 + (x + y) % 45;
    rgba[p + 3] = 255;
  }
  return encodeFixturePng(width, height, rgba);
}
