import { demand } from './errors.mjs';
import { cellKey } from './topology.mjs';

export const TERRAIN_SKIN_PROFILE = 'alpha128-longest-row-first95-v1';
// This threshold measures a placement baseline only; no RGBA is changed.
export function measurePlatformSurface(image) {
  const rows = []; let maximum = 0;
  for (let y = 0; y < image.height; y++) {
    let start = 0, best = { left: 0, right: 0, y };
    for (let x = 0; x <= image.width; x++) {
      if (x < image.width && image.rgba[(y * image.width + x) * 4 + 3] >= 128) continue;
      if (x - start > best.right - best.left) best = { left: start, right: x, y };
      start = x + 1;
    }
    rows.push(best); maximum = Math.max(maximum, best.right - best.left);
  }
  demand(maximum >= 8, 'TERRAIN_SKIN_SURFACE', 'catalog', '/', 'Platform needs a measurable opaque top span');
  return rows.find(row => (row.right - row.left) * 100 >= maximum * 95);
}

export function validateTerrainSkinModule(module, kit, image, artifact, path) {
  const skin = module.terrainSkin; if (!skin) return;
  const surface = skin.surfacePx, measured = measurePlatformSurface(image), ratio = module.renderStyle?.scale;
  demand(kit.format === 'ai_scene_kit_v4' && module.kind === 'environment' && module.repeatAxis === 'none'
    && skin.profile === TERRAIN_SKIN_PROFILE && ratio && module.footprint.columns === skin.columns && module.footprint.rows === skin.rows
    && module.visualOffset.x === 0 && module.visualOffset.y === 0,
  'TERRAIN_SKIN_MODULE', artifact, path, 'Terrain appearances require an explicit rigid environment module');
  demand(surface.left === measured.left && surface.right === measured.right && surface.y === measured.y
    && module.anchorPx.x === surface.left && module.anchorPx.y === surface.y,
  'TERRAIN_SKIN_SURFACE', artifact, path, 'Surface and anchor must replay the declared pixel measurement');
  demand((surface.right - surface.left) * ratio.numerator * kit.pixelsPerUnit.denominator
    === skin.columns * kit.grid.width * ratio.denominator * kit.pixelsPerUnit.numerator,
  'TERRAIN_SKIN_SCALE', artifact, path, 'Measured surface span must match the declared grid width exactly');
}

export function analyzeTerrainSkins({ kit, modules, layers, cells, visuals, mixed, artifact }) {
  if (kit.format !== 'ai_scene_kit_v4') return [];
  const result = [], covered = new Set(), mixedCells = new Set(mixed.flatMap(p => p.source.gridCells.map(c => cellKey(c.x, c.y))));
  for (const visual of visuals) {
    const skin = modules.get(visual.assetId)?.terrainSkin; if (!skin) continue;
    const x = visual.x / kit.grid.width, y = visual.y / kit.grid.height, layer = layers.get(visual.layerId);
    demand(Number.isSafeInteger(x) && Number.isSafeInteger(y) && layer?.parallax.x === 1 && layer.parallax.y === 1,
      'TERRAIN_SKIN_ANCHOR', artifact, '/instances', 'Platform appearances must use grid anchors and unit parallax');
    const owns = (cx, cy) => cx >= x && cx < x + skin.columns && cy >= y && cy < y + skin.rows;
    const attached = [];
    for (let dy = 0; dy < skin.rows; dy++) for (let dx = 0; dx < skin.columns; dx++) {
      const cx = x + dx, cy = y + dy, key = cellKey(cx, cy);
      demand(cells.has(key) && !covered.has(key) && !mixedCells.has(key), 'TERRAIN_SKIN_CELLS', artifact, '/instances',
        'Appearance requires one complete, non-overlapping rectangle outside mixed terrain; remove the appearance before changing its cells');
      for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) demand(owns(cx + ox, cy + oy) || !cells.has(cellKey(cx + ox, cy + oy)),
        'TERRAIN_SKIN_ISOLATION', artifact, '/instances', 'Fixed platform appearances require an isolated rectangle; remove the appearance before extending it');
      covered.add(key); attached.push({ x: cx, y: cy });
    }
    result.push({ instanceId: visual.instanceId, assetId: visual.assetId, cells: attached,
      surface: { from: { x: visual.x, y: visual.y }, to: { x: visual.x + skin.columns * kit.grid.width, y: visual.y } },
      collisionRepresentation: 'original-grid-rectangle-suggestion-not-alpha-silhouette', geometryAcceptance: 'not-assessed' });
  }
  return result;
}
