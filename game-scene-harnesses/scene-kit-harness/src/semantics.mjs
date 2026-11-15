import { validateDocument } from './schema.mjs';
import { InvalidKit, demand, uniqueIds, uniqueInstances } from './errors.mjs';
import { cellKey, SIGNATURES, signatureAt } from './topology.mjs';
import { analyzeCurves } from './curves.mjs';
import { analyzeMixedTerrain } from './mixed-terrain.mjs';
import { analyzeTerrainSkins } from './terrain-skins.mjs';
import { supportsInstanceAppearance } from './instance-appearance.mjs';

const MAX_CELLS = 100000;
const MAX_EXPANSION_WORK = 1000000;

// Shared by source-package validation, map compilation and every editor commit.
export function createSceneSemantics({ kit, catalog, rules, library, artifacts }) {
  const refs = { presets: { path: artifacts.presets } };
  const modules = new Map(catalog.modules.map(module => [module.assetId, module]));
  let work = 0;
  const spend = (count, artifact) => {
    work += count;
    demand(work <= MAX_EXPANSION_WORK, 'RESOURCE_LIMIT', artifact, '/', 'Preset/map expansion exceeds its work budget');
  };
  const insideCell = (x, y, bounds) => x >= bounds.x && y >= bounds.y && x < bounds.x + bounds.width && y < bounds.y + bounds.height;
  const addCell = (cells, x, y, family, bounds, artifact, path) => {
    spend(1, artifact);
    demand(insideCell(x, y, bounds), 'TERRAIN_OUT_OF_BOUNDS', artifact, path, 'Terrain cell lies outside its declared bounds');
    demand(family === rules.familyId, 'FAMILY_UNSUPPORTED', artifact, path, 'Only the bound terrain family is supported');
    demand(!cells.has(cellKey(x, y)), 'TERRAIN_OVERLAP', artifact, path, 'Terrain sources overlap; silent replacement is forbidden');
    demand(cells.size < MAX_CELLS, 'RESOURCE_LIMIT', artifact, path, 'Occupied cell limit exceeded');
    cells.set(cellKey(x, y), family);
  };
  const addRuns = (cells, runs, bounds, artifact, path) => runs.forEach((run, index) => {
    demand(run.length <= MAX_CELLS, 'RESOURCE_LIMIT', artifact, `${path}/${index}`, 'Terrain run exceeds the cell budget');
    for (let dx = 0; dx < run.length; dx++) addCell(cells, run.x + dx, run.y, run.familyId, bounds, artifact, `${path}/${index}`);
  });
  const checkVisual = (instance, bounds, artifact, path, freePlacement = false) => {
    const module = modules.get(instance.assetId);
    demand(module && module.kind !== 'terrain', 'INSTANCE_ASSET_REFERENCE', artifact, `${path}/assetId`, 'Visual instances must reference an environment or strip module');
    demand((freePlacement && !module.terrainSkin) || (instance.x >= bounds.x * kit.grid.width && instance.x < (bounds.x + bounds.width) * kit.grid.width
      && instance.y >= bounds.y * kit.grid.height && instance.y < (bounds.y + bounds.height) * kit.grid.height),
    'INSTANCE_OUT_OF_BOUNDS', artifact, path, 'Instance anchor lies outside its declared world bounds');
  };
  uniqueIds(library.presets, 'presetId', refs.presets.path, '/presets');
  const presets = new Map(library.presets.map(preset => [preset.presetId, preset]));
  const expanded = new Map();
  const expandPreset = (id, ancestors = []) => {
    demand(!ancestors.includes(id), 'PRESET_CYCLE', refs.presets.path, '/presets', 'Assembly references form a cycle');
    demand(ancestors.length < 32, 'RESOURCE_LIMIT', refs.presets.path, '/presets', 'Assembly nesting is too deep');
    if (expanded.has(id)) return expanded.get(id);
    const preset = presets.get(id);
    demand(preset, 'PRESET_MISSING', refs.presets.path, '/presets', 'Referenced preset is not declared');
    const index = library.presets.indexOf(preset), at = `/presets/${index}`;
    const bounds = { x: 0, y: 0, width: preset.sizeCells.width, height: preset.sizeCells.height };
    const cells = new Map(), visuals = [];
    uniqueInstances([[preset.instances, `${at}/instances`], [preset.assemblies, `${at}/assemblies`]], refs.presets.path);
    addRuns(cells, preset.terrainRuns, bounds, refs.presets.path, `${at}/terrainRuns`);
    preset.instances.forEach((instance, instanceIndex) => {
      checkVisual(instance, bounds, refs.presets.path, `${at}/instances/${instanceIndex}`);
      visuals.push(instance);
    });
    for (const [childIndex, child] of preset.assemblies.entries()) {
      demand(presets.has(child.presetId), 'PRESET_MISSING', refs.presets.path, `${at}/assemblies/${childIndex}/presetId`, 'Referenced child preset is not declared');
      const source = expandPreset(child.presetId, [...ancestors, id]);
      mergeAssembly(cells, visuals, child, source, bounds, refs.presets.path, at);
    }
    const result = { cells, visuals, bounds };
    expanded.set(id, result);
    return result;
  };
  function mergeAssembly(cells, visuals, instance, source, bounds, artifact, path) {
    demand(instance.column >= bounds.x && instance.row >= bounds.y
      && instance.column + source.bounds.width <= bounds.x + bounds.width
      && instance.row + source.bounds.height <= bounds.y + bounds.height,
    'ASSEMBLY_OUT_OF_BOUNDS', artifact, path, 'Assembly footprint lies outside its parent bounds');
    for (const [key, family] of source.cells) {
      const [x, y] = key.split(',').map(Number);
      addCell(cells, x + instance.column, y + instance.row, family, bounds, artifact, path);
    }
    spend(source.visuals.length, artifact);
    demand(visuals.length + source.visuals.length <= 100000, 'RESOURCE_LIMIT', artifact, path, 'Expanded instance limit exceeded');
    for (const visual of source.visuals) visuals.push({
      ...visual, instanceId: `${instance.instanceId}/${visual.instanceId}`,
      x: visual.x + instance.column * kit.grid.width, y: visual.y + instance.row * kit.grid.height,
      ...(instance.layerId ? { layerId: instance.layerId } : {}),
      ...(instance.drawOrder === undefined ? {} : { drawOrder: instance.drawOrder }),
    });
  }
  for (const id of presets.keys()) expandPreset(id);

  const presetWork = work;
  function analyzeMap(map, { artifact = 'scene.document.json', role = 'draft', allowEmpty = true } = {}) {
    work = presetWork;
    const file = { path: artifact };
    const schemaErrors = validateDocument(['ai_scene_document_v2','ai_scene_document_v3','ai_scene_document_v4','ai_scene_document_v5','ai_scene_document_v6'].includes(map?.format) ? map.format : 'ai_scene_document_v1', map);
    if (schemaErrors.length) throw new InvalidKit(schemaErrors.map(error => ({ artifact, ...error })));
    demand(map.kitRef.kitId === kit.kitId && map.kitRef.revision === kit.revision,
      'KIT_REVISION_MISMATCH', artifact, '/kitRef', 'Document is bound to a different kit revision');
    demand(map.rulesRef.rulesId === rules.rulesId && map.rulesRef.revision === rules.revision,
      'RULE_REVISION_MISMATCH', artifact, '/rulesRef', 'Map is bound to a different terrain-rule revision');
    uniqueIds(map.layers, 'layerId', file.path, '/layers');
    uniqueIds(map.layers, 'zIndex', file.path, '/layers');
    const layers = new Map(map.layers.map(layer => [layer.layerId, layer]));
    const terrainLayers = map.layers.filter(layer => layer.kind === 'terrain');
    demand(terrainLayers.length === 1 && terrainLayers[0].parallax.x === 1 && terrainLayers[0].parallax.y === 1,
      'TERRAIN_LAYER', file.path, '/layers', 'Exactly one terrain layer with unit parallax is required');
    uniqueInstances([[map.instances, '/instances'], [map.assemblyInstances, '/assemblyInstances']], file.path);
    const checkLayer = (instance, path) => demand(layers.has(instance.layerId) && layers.get(instance.layerId).kind !== 'terrain',
      'INSTANCE_LAYER_REFERENCE', file.path, `${path}/layerId`, 'Visual instances require a non-terrain map layer');
    const cells = new Map(), visuals = [...map.instances];
    addRuns(cells, map.terrainRuns, map.bounds, file.path, '/terrainRuns');
    map.instances.forEach((instance, index) => { checkVisual(instance, map.bounds, file.path, `/instances/${index}`,['ai_scene_document_v5','ai_scene_document_v6'].includes(map.format)); checkLayer(instance, `/instances/${index}`); });
    if(['ai_scene_document_v4','ai_scene_document_v5','ai_scene_document_v6'].includes(map.format)){
      uniqueIds(map.instanceTransforms,'instanceId',file.path,'/instanceTransforms');
      for(const transform of map.instanceTransforms){const item=map.instances.find(i=>i.instanceId===transform.instanceId),module=modules.get(item?.assetId);
        demand(item&&module&&!module.terrainSkin&&!['terrain','strip'].includes(module.kind),'INSTANCE_TRANSFORM_TARGET',file.path,'/instanceTransforms','Only direct non-terrain sprites can be scaled');}
    }
    if (map.instanceAppearances) {
      uniqueIds(map.instanceAppearances, 'instanceId', file.path, '/instanceAppearances');
      const direct = new Map(map.instances.map(instance => [instance.instanceId, instance.assetId]));
      for (const {instanceId} of map.instanceAppearances) {
        demand(supportsInstanceAppearance(modules.get(direct.get(instanceId))), 'INSTANCE_APPEARANCE_TARGET', file.path,
          '/instanceAppearances', 'Only direct environment and background sprites support appearance adjustment');
      }
    }
    map.assemblyInstances.forEach((instance, index) => {
      checkLayer(instance, `/assemblyInstances/${index}`);
      demand(presets.has(instance.presetId), 'PRESET_MISSING', file.path, `/assemblyInstances/${index}/presetId`, 'Referenced map preset is not declared');
      const source = expandPreset(instance.presetId);
      mergeAssembly(cells, visuals, instance, source, map.bounds, file.path, `/assemblyInstances/${index}`);
    });
    demand(allowEmpty || cells.size > 0 || map.curveTerrains?.length > 0, 'MAP_EMPTY', file.path, '/terrainRuns', 'Delivery maps must contain terrain');
    const world = { x: map.bounds.x * kit.grid.width, y: map.bounds.y * kit.grid.height,
      width: map.bounds.width * kit.grid.width, height: map.bounds.height * kit.grid.height };
    const measured=['ai_scene_continuous_terrain_appearance_v5','ai_scene_continuous_terrain_appearance_v6'].includes(kit.terrainAppearance?.format);
    const capWidth = measured?kit.terrainAppearance.capDepth.numerator/kit.terrainAppearance.capDepth.denominator
      : kit.terrainAppearance?.format === 'ai_scene_continuous_terrain_appearance_v4' ? 32
      : kit.terrainAppearance?.format === 'ai_scene_continuous_terrain_appearance_v3' ? 16 : 8;
    const capOptions=measured?{profile:'measured-source-depth-v1'}:{};
    const curves = analyzeCurves(map, { world, grid: kit.grid, cells, familyId: rules.familyId, capWidth,capOptions });
    const mixed = analyzeMixedTerrain(map,cells,capWidth,capOptions);
    const terrainSkins = analyzeTerrainSkins({ kit, modules, layers, cells, visuals, mixed, artifact });
    demand(map.defaultCamera.center.x >= world.x && map.defaultCamera.center.x <= world.x + world.width
      && map.defaultCamera.center.y >= world.y && map.defaultCamera.center.y <= world.y + world.height,
    'CAMERA_OUT_OF_BOUNDS', file.path, '/defaultCamera/center', 'Default camera center must lie inside world bounds');
    uniqueIds(map.inspectionCases, 'caseId', file.path, '/inspectionCases');
    const inspected = new Set(), inspectedCells = new Set();
    map.inspectionCases.forEach((entry, index) => {
      const key = cellKey(entry.cell.x, entry.cell.y);
      demand(!inspectedCells.has(key), 'INSPECTION_DUPLICATE', file.path, `/inspectionCases/${index}/cell`, 'A check cell must not be reused');
      inspectedCells.add(key);
      demand(signatureAt(cells, entry.cell.x, entry.cell.y) === entry.expectedSignature,
        'INSPECTION_SIGNATURE', file.path, `/inspectionCases/${index}`, 'Actual terrain does not match the expected inspection signature');
      inspected.add(entry.expectedSignature);
    });
    if (role === 'inspection') demand(map.inspectionCases.length === 47 && inspected.size === 47,
      'INSPECTION_COVERAGE', file.path, '/inspectionCases', 'Inspection map must demonstrate all 47 roles exactly once');
    const usedSignatures = new Set();
    for (const key of cells.keys()) {
      const [x, y] = key.split(',').map(Number);
      usedSignatures.add(signatureAt(cells, x, y));
    }

    return { cells, visuals, world, curves, mixed, terrainSkins, terrainLayerId: terrainLayers[0].layerId, summary: {
      role, mapId: map.mapId, occupiedCells: cells.size, visualInstances: visuals.length,
      assemblyInstances: map.assemblyInstances.length, inspectionCases: map.inspectionCases.length,
      signatures: [...usedSignatures].sort((a, b) => a - b),
    } };
  }
  return Object.freeze({ analyzeMap, getPreset: id => expandPreset(id) });
}
