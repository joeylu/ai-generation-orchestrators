import { compareObjectStack } from '../document.mjs';
import { environmentLibraryRoles } from '../environment-library-roles.mjs';

// Preserve the content groups. The author z-order owns rendering; use the flat
// draw-stack diagnostic to check and explicitly align existing documents.
const labels = {foreground:'前景', platform:'平台', terrain:'地形', environment:'环境', middle:'中景', far:'远景', background:'背景', empty:'空图层'};
export const environmentLibraryRoleLabel = role => role === 'environment' ? '平台 · 环境' : labels[role];
const legacyRoles=Object.freeze({sky:'background',background:'background',hills:'far',city:'far',valley:'far',middle:'middle',ground:'main',terrain:'main',platform:'main',foreground:'foreground',front:'foreground'});
export function layerGroupRole(layer){
  if(layer.kind==='terrain')return 'terrain';
  if(layer.kind==='foreground')return 'foreground';
  if(Object.hasOwn(legacyRoles,layer.layerId))return legacyRoles[layer.layerId];
  if(/^(foreground|front)([._-]|$)/.test(layer.layerId)||layer.parallax.x>1)return 'foreground';
  if(layer.kind==='background')return layer.parallax.x===0?'background':'far';
  if(layer.parallax.x===1&&layer.parallax.y===1)return 'main';
  return layer.parallax.x<=.4?'far':'middle';
}
export function sceneDisplayRole(layer) {
  const role = layerGroupRole(layer);
  return role === 'main' ? 'environment' : role;
}

const roleParallax = { foreground: 1.1, environment: 1, middle: 0.65, far: 0.3, background: 0 };

export function environmentPlacement(layers, role, activeLayer) {
  const existing = layers.filter(layer => layer.kind !== 'terrain' && sceneDisplayRole(layer) === role);
  const layer = existing.find(item => item.layerId === activeLayer) ?? existing.toSorted((a, b) => b.zIndex - a.zIndex)[0];
  if (layer) return { layer, create: false };
  if (layers.length >= 32 || !environmentLibraryRoles.includes(role)) return null;

  // Fit a new slot above the nearest group behind it. If every slot there is
  // occupied, the first placement will open a slot and preserve relative order.
  const rank = environmentLibraryRoles.indexOf(role);
  const ordered = layers.toSorted((a, b) => a.zIndex - b.zIndex);
  const index = ordered.findLastIndex(item =>
    environmentLibraryRoles.indexOf(item.kind === 'terrain' ? 'environment' : sceneDisplayRole(item)) >= rank) + 1;
  const below = ordered[index - 1]?.zIndex ?? -10001;
  const above = ordered[index]?.zIndex ?? 10001;
  let layerId = role;
  for (let suffix = 2; layers.some(item => item.layerId === layerId); suffix++) layerId = `${role}.${suffix}`;
  const added = { layerId,
    kind: role === 'foreground' ? 'foreground' : role === 'background' ? 'background' : 'environment',
    zIndex: below + 1, parallax: { x: roleParallax[role], y: 1 }, visible: true };
  ordered.splice(index, 0, added);
  const nextLayers = below + 1 < above ? ordered : ordered.map((item, slot) => ({ ...item, zIndex: slot * 10 }));
  return { layer: nextLayers[index], create: true, nextLayers };
}

export function sceneGroupTree(rowsByRole) {
  const group = role => ({role,label:labels[role],groupId:'group:'+role,rows:rowsByRole.get(role) ?? []});
  const platform = {...group('platform'),children:[group('terrain'),group('environment')]};
  return [group('foreground'),platform,group('middle'),group('far'),group('background'),group('empty')]
    .filter(group => group.rows.length || group.children?.some(section => section.rows.length));
}

export function sceneLayerRows(document) {
  const itemsByLayer = new Map(document.layers.map(layer => [layer.layerId, []]));
  for (const item of [...document.assemblyInstances, ...document.instances]) itemsByLayer.get(item.layerId).push(item);
  return document.layers.toSorted((a,b) => b.zIndex-a.zIndex).map(layer => {
    const terrain = layer.kind === 'terrain';
    const items = terrain ? document.curveTerrains ?? [] : itemsByLayer.get(layer.layerId).toSorted((a,b) => compareObjectStack(b,a));
    return {rowId:layer.layerId,layer,items,split:false,
      label:terrain ? '地形图层' : items.length ? labels[sceneDisplayRole(layer)] : '空图层 · '+layer.layerId,
      ...(terrain ? {brushCells:document.terrainRuns.reduce((count,run) => count+run.length,0)} : {})};
  });
}

export function groupSceneLayers(document, {modules = [], presets = []} = {}) {
  const terrainAssets = new Set(modules.filter(module => module.terrainSkin).map(module => module.assetId));
  const terrainPresets = new Set(presets.filter(preset => preset.hasTerrain).map(preset => preset.presetId));
  const itemsByLayer = new Map(document.layers.map(layer => [layer.layerId, []]));
  for (const item of [...document.assemblyInstances, ...document.instances]) itemsByLayer.get(item.layerId).push(item);
  const rowsByRole = new Map();
  function add(role, layer, items, split = false, brushCells) {
    if(!rowsByRole.has(role))rowsByRole.set(role,[]);
    const rows = rowsByRole.get(role);
    const label = brushCells !== undefined ? '地形图层' : role === 'empty' ? layer.layerId
      : role === 'terrain' ? '平台素材' : labels[role] + ' ' + (rows.length + 1);
    rows.push({rowId:layer.layerId + (split ? ':'+role : ''),layer,items,split,label,brushCells});
  }
  for (const layer of document.layers.toSorted((a,b)=>b.zIndex-a.zIndex)) {
    if (layer.kind === 'terrain') {
      const brushCells = document.terrainRuns.reduce((count, run) => count + run.length, 0);
      add('terrain', layer, document.curveTerrains ?? [], false, brushCells);
      continue;
    }
    const items = itemsByLayer.get(layer.layerId);
    if (!items.length) { add('empty', layer, items); continue; }
    items.sort((a,b)=>compareObjectStack(b,a));
    const physical = [], scenery = [];
    for (const item of items) (terrainAssets.has(item.assetId) || terrainPresets.has(item.presetId) ? physical : scenery).push(item);
    const split = physical.length > 0 && scenery.length > 0;
    if (physical.length) add('terrain', layer, physical, split);
    if (scenery.length) add(sceneDisplayRole(layer), layer, scenery, split);
  }
  return sceneGroupTree(rowsByRole);
}

export function reorderableLayers(group) {
  // Split rows share one author layer and therefore one rendering slot.
  return group.role === 'empty' ? [] : group.rows.filter(row => !row.split);
}

export function layerGroupLeaves(groups) {
  return groups.flatMap(group => group.children ?? [group]);
}
