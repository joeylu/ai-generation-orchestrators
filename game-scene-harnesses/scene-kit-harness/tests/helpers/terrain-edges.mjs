import { encodeRgbaPng } from '../../src/png.mjs';
import { hash } from '../../src/generation/common.mjs';

// Engineering fixtures only: these colored jagged strips are not generated art.
export function terrainEdgesFixture({ palette = 'autumn' } = {}) {
  const files = new Map(), appearance = { format: 'ai_scene_continuous_terrain_appearance_v5', sourceSha256: 'a'.repeat(64), surfaceMappingSha256: 'b'.repeat(64) };
  const edges = { format: 'ai_scene_terrain_edges_v1', profile: 'curve-vertical-exposed-native-v1',
    sourceBinding: { materialSourceSha256: appearance.sourceSha256, surfaceMappingSha256: appearance.surfaceMappingSha256 } };
  for (const [sideIndex, side] of ['left', 'right'].entries()) {
    edges[side] = {};
    for (const [partIndex, part] of ['wall', 'corner'].entries()) {
      const width = 48, height = 80, rgba = Buffer.alloc(width * height * 4);
      for (let y = 2; y < height - 2; y++) for (let x = 2; x < width - 2; x++) {
        const boundary = 12 + Math.floor(y / 4) % 8;
        if ((side === 'left' ? x >= boundary : x < width - boundary) && (part === 'wall' || y >= 8)) {
          const color = palette === 'snow' ? [145 + sideIndex * 20, 170 + partIndex * 15, 220]
            : [140 + sideIndex * 20, 75 + partIndex * 15, 35];
          rgba.set(color.concat(255), (y * width + x) * 4);
        }
      }
      const bytes = encodeRgbaPng(width, height, rgba), path = `edges/${palette}-${side}-${part}.png`;
      files.set(path, bytes);
      edges[side][part] = { source: { path, sha256: hash(bytes), byteLength: bytes.length }, pixelSize: { width, height },
        scale: { numerator: 1, denominator: 2 }, boundaryX: side === 'left' ? 16 : 32, innerX: side === 'left' ? 32 : 16,
        ...(part === 'wall' ? { repeatY: { from: 8, to: 72 } } : { surfaceY: 16, wallStartY: 64 }) };
    }
  }
  return { files, edges, appearance };
}
