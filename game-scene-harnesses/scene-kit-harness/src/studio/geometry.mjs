import { compareObjectStack } from '../document.mjs';

// Integer rasterization closes gaps when pointer events skip over cells.
export function strokeCells(from, to) {
  const cells = [];
  let x = from.x, y = from.y;
  const dx = Math.abs(to.x - x), sx = x < to.x ? 1 : -1;
  const dy = -Math.abs(to.y - y), sy = y < to.y ? 1 : -1;
  let error = dx + dy;
  for (let i = 0; i < 100000; i++) {
    cells.push({ x, y });
    if (x === to.x && y === to.y) return cells;
    const twice = 2 * error;
    if (twice >= dy) { error += dy; x += sx; }
    if (twice <= dx) { error += dx; y += sy; }
  }
  throw new Error('Stroke exceeds cell budget');
}

export { layerOffset, repeatCoverage } from '../pixi/projection.mjs';

export function selectionBox(document, scene, presets, selected) {
  const assembly = document.assemblyInstances.find(item => item.instanceId === selected);
  if (assembly) {
    const preset = presets.find(item => item.presetId === assembly.presetId);
    return { x: assembly.column * scene.grid.width, y: assembly.row * scene.grid.height,
      width: preset.sizeCells.width * scene.grid.width, height: preset.sizeCells.height * scene.grid.height, assembly: true };
  }
  const item = document.instances.find(item => item.instanceId === selected);
  if (!item) return null;
  const node = scene.layers.flatMap(layer => layer.nodes).find(node => node.nodeId === `visual/${item.instanceId}`);
  return node ? { ...node.position, ...node.size, assembly: false } : null;
}

export function hitSelection(point, document, scene, presets, hidden = new Set(),locked=new Set(),pixelHit=()=>true) {
  // Author objects only. Terrain is edited through occupancy, never image selection.
  const layers = new Map(document.layers.map(layer => [layer.layerId, layer]));
  const objects = [...document.instances, ...document.assemblyInstances]
    .filter(item => !hidden.has(item.layerId)&&!hidden.has(item.instanceId)&&!locked.has(item.layerId)&&!locked.has(item.instanceId) && layers.get(item.layerId).visible)
    .sort((a, b) => layers.get(b.layerId).zIndex - layers.get(a.layerId).zIndex || compareObjectStack(b, a));
  return objects.find(item => {
    const box = selectionBox(document, scene, presets, item.instanceId);
    return box && point.x >= box.x && point.y >= box.y && point.x < box.x + box.width && point.y < box.y + box.height&&pixelHit(item,box,point);
  })?.instanceId ?? '';
}
