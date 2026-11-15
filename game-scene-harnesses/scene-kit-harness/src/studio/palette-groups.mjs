import { sceneDisplayRole } from './layer-groups.mjs';
import { isGeneratedEnvironment } from './generated-environment-id.mjs';

export function paletteAssetRoles(document) {
  const layers = new Map(document.layers.filter(layer => layer.kind !== 'terrain').map(layer => [layer.layerId, layer]));
  const uses = new Map();
  for (const item of [...document.instances, ...document.assemblyInstances]) {
    const layer = layers.get(item.layerId);
    if (!layer) continue;
    const key = item.assetId ? 'module/'+item.assetId : 'preset/'+item.presetId;
    if (!uses.has(key)) uses.set(key, new Set());
    uses.get(key).add(layer);
  }
  return (kind, asset) => {
    if (asset.terrainSkin || asset.hasTerrain) return 'terrain';
    if (kind === 'module' && asset.placementRole) return asset.placementRole;
    if (kind === 'module' && isGeneratedEnvironment(asset)) return 'environment';
    const preferred = layers.get(asset.preferredLayerId);
    const placed = uses.get(kind+'/'+(asset.assetId ?? asset.presetId));
    // A shared asset still has one card. Prefer its authored preferred layer
    // when it participates in this map, then the frontmost actual use.
    let layer = preferred;
    if (placed?.size && !placed.has(preferred)) {
      layer = [...placed].reduce((front, next) => next.zIndex > front.zIndex ? next : front);
    }
    if (layer) return sceneDisplayRole(layer);
    return ['background','strip'].includes(asset.kind) ? 'background' : 'environment';
  };
}
