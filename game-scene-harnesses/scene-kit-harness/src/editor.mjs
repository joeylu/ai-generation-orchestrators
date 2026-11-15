import { contextFor, readMap } from './kit.mjs';
import { compileMap } from './compile.mjs';
import { canonicalJson, canonicalMap, cellsFromRuns, clone, compareObjectStack, runsFromCells } from './document.mjs';
import { demand, reject } from './errors.mjs';
import { cellKey } from './topology.mjs';
import { sha256 } from './validate.mjs';
import { validateDocument } from './schema.mjs';
import { joinCurveTerrains } from './curve-join.mjs';
import { connectCurveToGrid } from './mixed-terrain.mjs';
import { terrainRegions,regionForTarget,moveTerrainRegion } from './terrain-move.mjs';
import { supportsInstanceAppearance } from './instance-appearance.mjs';
import { environmentPlacement, groupSceneLayers, layerGroupLeaves, reorderableLayers } from './studio/layer-groups.mjs';
const editorInternals=new WeakMap();
// One immutable compiled scene is enough to hand a checked candidate to the
// caller without retaining full terrain meshes for every map in a workspace.
let recentCompilation;

function compiled(handle, document) {
  if (recentCompilation?.handle === handle && recentCompilation.document === document) return recentCompilation.scene;
  const scene = compileMap(handle, document);
  recentCompilation = { handle, document, scene };
  return scene;
}

function checked(handle, document) {
  contextFor(handle).model.analyzeMap(document);
  const normalized = canonicalMap(document);
  demand(Buffer.byteLength(canonicalJson(normalized)) <= 2097152, 'RESOURCE_LIMIT', 'scene.document.json', '/', 'Author document exceeds 2 MiB');
  // Structural analysis alone cannot certify native render work budgets.
  compiled(handle, normalized);
  return normalized;
}

function commandShape(command, fields, path) {
  demand(command && typeof command === 'object' && !Array.isArray(command)
    && Object.keys(command).length === fields.length && fields.every(field => Object.hasOwn(command, field)),
  'COMMAND_SHAPE', 'commands.json', path, 'Command requires exactly the documented fields');
}

export function createEditor(handle, input = readMap(handle), { historyLimit = 32 } = {}) {
  demand(Number.isInteger(historyLimit) && historyLimit >= 1 && historyLimit <= 128,
    'HISTORY_LIMIT', 'commands.json', '/', 'History limit must be an integer from 1 to 128');
  return editorFromChecked(handle, checked(handle, input), historyLimit);
}

function editorFromChecked(handle, document, historyLimit) {
  const context = contextFor(handle);
  let past = [], future = [], discarded = 0;
  const status = changed => ({ changed, undoDepth: past.length, redoDepth: future.length, historyTruncated: discarded, recompile: 'full' });

  function apply(draft, command, index) {
    const path = `/commands/${index}`;
    demand(command && typeof command.type === 'string', 'COMMAND_SHAPE', 'commands.json', path, 'Command type is required');
    const reserved = id => draft.instances.some(item => item.instanceId === id) || draft.assemblyInstances.some(item => item.instanceId === id);
    const layerGroups = () => layerGroupLeaves(groupSceneLayers(draft, {
      modules: context.catalog.modules,
      presets: context.library.presets.map(preset => ({
        presetId: preset.presetId, hasTerrain: context.model.getPreset(preset.presetId).cells.size > 0,
      })),
    }));
    const expandAssembly=(instance,index,preset,omitVisualId)=>{
      const cells=cellsFromRuns(draft.terrainRuns);
      for(const [key,family]of preset.cells){const [x,y]=key.split(',').map(Number),target=cellKey(x+instance.column,y+instance.row);
        demand(!cells.has(target),'TERRAIN_OVERLAP','commands.json',path,'Expanded terrain conflicts with direct terrain');cells.set(target,family);}
      for(const visual of preset.visuals){
        if(visual.instanceId===omitVisualId)continue;
        const instanceId=`expanded.${sha256(canonicalJson([instance.instanceId,visual.instanceId])).slice(0,32)}`;
        demand(!reserved(instanceId),'DUPLICATE_ID','commands.json',path,'Stable expanded instance ID is already in use');
        draft.instances.push({instanceId,assetId:visual.assetId,layerId:instance.layerId,
          x:visual.x+instance.column*context.kit.grid.width,y:visual.y+instance.row*context.kit.grid.height,
          ...(instance.drawOrder===undefined?{}:{drawOrder:instance.drawOrder})});
      }
      draft.assemblyInstances.splice(index,1);draft.terrainRuns=runsFromCells(cells);
    };
    switch (command.type) {
      case 'enable-layered-terrain':
        commandShape(command,['type'],path);
        demand(['ai_scene_document_v1','ai_scene_document_v2','ai_scene_document_v3','ai_scene_document_v4','ai_scene_document_v5'].includes(draft.format),'LAYERED_TERRAIN_UPGRADE','commands.json',path,'Upgrade an earlier author document explicitly');
        draft.format='ai_scene_document_v6';draft.curveTerrains??=[];draft.terrainConnections??=[];draft.instanceTransforms??=[];break;
      case 'move-terrain': {
        commandShape(command,['type','target','dx','dy'],path);
        const target=command.target;
        demand(target&&typeof target==='object'&&!Array.isArray(target)&&Object.keys(target).length===1,'TERRAIN_MOVE_TARGET','commands.json',path,'Choose one terrain target');
        if(Object.hasOwn(target,'cell')){commandShape(target.cell,['x','y'],path);demand(Number.isSafeInteger(target.cell.x)&&Number.isSafeInteger(target.cell.y),'TERRAIN_MOVE_TARGET','commands.json',path,'Target cells must use integers');}
        else demand((Object.hasOwn(target,'curveId')&&typeof target.curveId==='string')||(Object.hasOwn(target,'assemblyId')&&typeof target.assemblyId==='string'),'TERRAIN_MOVE_TARGET','commands.json',path,'Choose a cell, curve or terrain assembly');
        const analysis=context.model.analyzeMap(draft),presets=context.library.presets.map(p=>({presetId:p.presetId,terrainRuns:runsFromCells(context.model.getPreset(p.presetId).cells)}));
        const region=regionForTarget(terrainRegions(draft,{grid:context.kit.grid,presets,terrainSkins:analysis.terrainSkins}),target);
        demand(region,'TERRAIN_MOVE_TARGET','commands.json',path,'Terrain target does not exist');
        Object.assign(draft,moveTerrainRegion(draft,region,command.dx,command.dy,context.kit.grid));break;
      }
      case 'enable-free-placement':
        commandShape(command,['type'],path);
        demand(['ai_scene_document_v1','ai_scene_document_v2','ai_scene_document_v3','ai_scene_document_v4'].includes(draft.format),'FREE_PLACEMENT_UPGRADE','commands.json',path,'Upgrade an earlier author document explicitly');
        draft.format='ai_scene_document_v5';draft.curveTerrains??=[];draft.terrainConnections??=[];draft.instanceTransforms??=[];break;
      case 'enable-instance-transforms':
        commandShape(command,['type'],path);
        demand(['ai_scene_document_v1','ai_scene_document_v2','ai_scene_document_v3'].includes(draft.format),'INSTANCE_TRANSFORM_UPGRADE','commands.json',path,'Upgrade an earlier author document explicitly');
        draft.format='ai_scene_document_v4';draft.curveTerrains??=[];draft.terrainConnections??=[];draft.instanceTransforms=[];break;
      case 'transform-instance': {
        commandShape(command,['type','instanceId','x','y','scale'],path);
        demand(['ai_scene_document_v4','ai_scene_document_v5','ai_scene_document_v6'].includes(draft.format),'INSTANCE_TRANSFORM_UPGRADE','commands.json',path,'Explicitly enable instance transforms first');
        const item=draft.instances.find(i=>i.instanceId===command.instanceId);
        demand(item&&Number.isFinite(command.scale)&&command.scale>=.125&&command.scale<=8,'INSTANCE_TRANSFORM_VALUE','commands.json',path,'Scale must be finite and between one eighth and eight');
        item.x=command.x;item.y=command.y;
        draft.instanceTransforms=draft.instanceTransforms.filter(t=>t.instanceId!==command.instanceId);
        if(command.scale!==1)draft.instanceTransforms.push({instanceId:command.instanceId,scale:command.scale});break;
      }
      case 'set-instance-appearance': {
        commandShape(command, ['type', 'instanceId', 'appearance'], path);
        const item = draft.instances.find(instance => instance.instanceId === command.instanceId);
        demand(draft.format === 'ai_scene_document_v6' && supportsInstanceAppearance(context.modules.get(item?.assetId)),
          'INSTANCE_APPEARANCE_TARGET', 'commands.json', path, 'Appearance requires a direct environment or background sprite in a v6 map');
        draft.instanceAppearances = (draft.instanceAppearances ?? []).filter(row => row.instanceId !== command.instanceId);
        if (command.appearance !== null) draft.instanceAppearances.push({instanceId: item.instanceId, appearance: clone(command.appearance)});
        break;
      }
      case 'enable-mixed-terrain':
        commandShape(command,['type'],path);
        demand(draft.format==='ai_scene_document_v2','MIXED_UPGRADE_STATE','commands.json',path,'Only v2 maps can explicitly enable mixed terrain');
        draft.format='ai_scene_document_v3';draft.terrainConnections=[];
        break;
      case 'connect-curve-grid': {
        commandShape(command,['type','curve','endpoint','cell'],path);
        demand(['ai_scene_document_v3','ai_scene_document_v4','ai_scene_document_v5','ai_scene_document_v6'].includes(draft.format),'MIXED_UPGRADE_REQUIRED','commands.json',path,'Explicitly enable v3 mixed terrain first');
        demand(validateDocument(draft.format,{...draft,curveTerrains:[command.curve],terrainConnections:[{curveId:command.curve?.curveId,endpoint:command.endpoint,cell:command.cell}]}).length===0,
          'GRID_CONNECTION_SHAPE','commands.json',path,'Connection requires closed curve and grid coordinates');
        const cells=context.model.analyzeMap(draft).cells;
        const result=connectCurveToGrid(draft,clone(command.curve),command.endpoint,command.cell,cells);
        draft.curveTerrains=draft.curveTerrains.map(curve=>curve.curveId===result.curve.curveId?result.curve:curve);
        draft.terrainConnections.push(result.connection);break;
      }
      case 'disconnect-curve-grid': {
        commandShape(command,['type','curveId','endpoint'],path);
        const index=draft.terrainConnections?.findIndex(item=>item.curveId===command.curveId&&item.endpoint===command.endpoint)??-1;
        demand(index>=0,'GRID_CONNECTION_MISSING','commands.json',path,'Connection does not exist');draft.terrainConnections.splice(index,1);break;
      }
      case 'join-curve-terrains': {
        commandShape(command, ['type', 'curve', 'endpoint', 'targetCurveId'], path);
        demand(['ai_scene_document_v2','ai_scene_document_v3','ai_scene_document_v4','ai_scene_document_v5','ai_scene_document_v6'].includes(draft.format), 'CURVE_UPGRADE_REQUIRED', 'commands.json', path, 'Explicitly enable v2 curve terrain first');
        demand(validateDocument(draft.format, { ...draft, curveTerrains: [command.curve] }).length === 0,
          'CURVE_JOIN_SHAPE', 'commands.json', path, 'Join requires a complete closed curve author');
        const result=joinCurveTerrains(draft,clone(command.curve),command.endpoint,command.targetCurveId);
        draft.curveTerrains=result.curves;
        if(draft.terrainConnections)draft.terrainConnections=result.connections;
        break;
      }
      case 'enable-curve-terrain':
        commandShape(command, ['type'], path);
        demand(draft.format === 'ai_scene_document_v1', 'CURVE_UPGRADE_STATE', 'commands.json', path, 'Only a v1 map can explicitly enable curves');
        draft.format = 'ai_scene_document_v2'; draft.curveTerrains = [];
        break;
      case 'add-curve-terrain':
      case 'replace-curve-terrain': {
        commandShape(command, ['type', 'curve'], path);
        demand(['ai_scene_document_v2','ai_scene_document_v3','ai_scene_document_v4','ai_scene_document_v5','ai_scene_document_v6'].includes(draft.format), 'CURVE_UPGRADE_REQUIRED', 'commands.json', path, 'Explicitly enable v2 curve terrain first');
        const index = draft.curveTerrains.findIndex(item => item.curveId === command.curve?.curveId);
        if (command.type === 'add-curve-terrain') {
          demand(index < 0, 'DUPLICATE_ID', 'commands.json', path, 'Curve ID already exists'); draft.curveTerrains.push(clone(command.curve));
        } else {
          demand(index >= 0, 'CURVE_MISSING', 'commands.json', path, 'Curve does not exist'); draft.curveTerrains[index] = clone(command.curve);
        }
        break;
      }
      case 'remove-curve-terrain': {
        commandShape(command, ['type', 'curveId'], path);
        const index = draft.curveTerrains?.findIndex(item => item.curveId === command.curveId) ?? -1;
        demand(index >= 0, 'CURVE_MISSING', 'commands.json', path, 'Curve does not exist'); draft.curveTerrains.splice(index, 1);
        if(draft.terrainConnections)draft.terrainConnections=draft.terrainConnections.filter(item=>item.curveId!==command.curveId);
        break;
      }
      case 'paint-cells':
      case 'erase-cells': {
        const painting = command.type === 'paint-cells';
        commandShape(command, painting ? ['type', 'cells', 'familyId'] : ['type', 'cells'], path);
        demand(Array.isArray(command.cells) && command.cells.length <= 100000, 'COMMAND_CELLS', 'commands.json', `${path}/cells`, 'Cell list must be a bounded array');
        if (painting) demand(command.familyId === context.rules.familyId, 'FAMILY_UNSUPPORTED', 'commands.json', `${path}/familyId`, 'Paint requires the bound terrain family');
        const analysis = context.model.analyzeMap(draft);
        const direct = cellsFromRuns(draft.terrainRuns);
        command.cells.forEach((cell, cellIndex) => {
          commandShape(cell, ['x', 'y'], `${path}/cells/${cellIndex}`);
          demand(Number.isSafeInteger(cell.x) && Number.isSafeInteger(cell.y), 'COMMAND_CELL', 'commands.json', `${path}/cells/${cellIndex}`, 'Cell coordinates must be safe integers');
          demand(cell.x >= draft.bounds.x && cell.y >= draft.bounds.y && cell.x < draft.bounds.x + draft.bounds.width && cell.y < draft.bounds.y + draft.bounds.height,
            'TERRAIN_OUT_OF_BOUNDS', 'commands.json', `${path}/cells/${cellIndex}`, 'Brush cannot expand map bounds implicitly');
          const key = cellKey(cell.x, cell.y);
          demand(!analysis.cells.has(key) || direct.has(key), 'ASSEMBLY_CELL_LOCKED', 'commands.json', `${path}/cells/${cellIndex}`, 'Expand an assembly before editing its terrain cells');
          if (painting) direct.set(key, command.familyId);
          else direct.delete(key);
        });
        draft.terrainRuns = runsFromCells(direct);
        break;
      }
      case 'add-instance':
      case 'place-generated-environment':
      case 'place-assembly': {
        commandShape(command, ['type', 'instance'], path);
        demand(command.instance && typeof command.instance === 'object' && !reserved(command.instance.instanceId),
          'DUPLICATE_ID', 'commands.json', `${path}/instance/instanceId`, 'New instance must have an unused ID');
        if (command.type === 'place-generated-environment') {
          const instance = command.instance;
          const role = context.modules.get(instance.assetId)?.placementRole;
          const target = role && environmentPlacement(draft.layers, role);
          demand(target?.create && instance.layerId === target.layer.layerId, 'ENVIRONMENT_PLACEMENT_LAYER',
            'commands.json', path, 'A new layer must match the environment sprite placement role');
          draft.layers = target.nextLayers;
        }
        (command.type === 'place-assembly' ? draft.assemblyInstances : draft.instances).push(clone(command.instance));
        break;
      }
      case 'move-instance': {
        commandShape(command, ['type', 'instanceId', 'x', 'y'], path);
        const instance = draft.instances.find(item => item.instanceId === command.instanceId);
        demand(instance, 'INSTANCE_MISSING', 'commands.json', `${path}/instanceId`, 'Direct instance does not exist');
        instance.x = command.x; instance.y = command.y;
        break;
      }
      case 'remove-instance':
      case 'remove-assembly': {
        commandShape(command, ['type', 'instanceId'], path);
        const field = command.type === 'remove-instance' ? 'instances' : 'assemblyInstances';
        const found = draft[field].findIndex(item => item.instanceId === command.instanceId);
        demand(found >= 0, 'INSTANCE_MISSING', 'commands.json', `${path}/instanceId`, 'Selected instance does not exist');
        draft[field].splice(found, 1);
        if(field==='instances'&&draft.instanceTransforms)draft.instanceTransforms=draft.instanceTransforms.filter(t=>t.instanceId!==command.instanceId);
        if(field==='instances'&&draft.instanceAppearances)draft.instanceAppearances=draft.instanceAppearances.filter(row=>row.instanceId!==command.instanceId);
        break;
      }
      case 'expand-assembly': {
        commandShape(command, ['type', 'instanceId'], path);
        const index = draft.assemblyInstances.findIndex(item => item.instanceId === command.instanceId);
        demand(index >= 0, 'INSTANCE_MISSING', 'commands.json', `${path}/instanceId`, 'Selected assembly does not exist');
        const instance = draft.assemblyInstances[index];
        const preset = context.model.getPreset(instance.presetId);
        expandAssembly(instance,index,preset);
        break;
      }
      case 'convert-terrain-skin': {
        commandShape(command,['type','instanceId'],path);
        demand(context.kit.format==='ai_scene_kit_v4'&&typeof command.instanceId==='string',
          'TERRAIN_SKIN_CONVERSION_TARGET','commands.json',path,'Choose one complete platform appearance');
        const directIndex=draft.instances.findIndex(item=>item.instanceId===command.instanceId);
        if(directIndex>=0){
          const instance=draft.instances[directIndex];
          demand(context.modules.get(instance.assetId)?.terrainSkin,'TERRAIN_SKIN_CONVERSION_TARGET','commands.json',path,
            'Only a complete terrain appearance can be converted into brushable terrain');
          draft.instances.splice(directIndex,1);
          if(draft.instanceTransforms)draft.instanceTransforms=draft.instanceTransforms.filter(t=>t.instanceId!==command.instanceId);
        }else{
          const index=draft.assemblyInstances.findIndex(item=>item.instanceId===command.instanceId);
          demand(index>=0,'TERRAIN_SKIN_CONVERSION_TARGET','commands.json',path,'Selected platform appearance does not exist');
          const instance=draft.assemblyInstances[index],preset=context.model.getPreset(instance.presetId),
            skins=preset.visuals.filter(visual=>context.modules.get(visual.assetId)?.terrainSkin);
          demand(skins.length===1,'TERRAIN_SKIN_CONVERSION_TARGET','commands.json',path,
            'Select an assembly containing exactly one complete platform appearance');
          expandAssembly(instance,index,preset,skins[0].instanceId);
        }
        break;
      }
      case 'resize-bounds':
        commandShape(command, ['type', 'bounds'], path);
        draft.bounds = clone(command.bounds);
        break;
      case 'reorder-layers': {
        commandShape(command, ['type', 'layerIds'], path);
        const ids = command.layerIds;
        demand(Array.isArray(ids) && ids.length >= 2 && ids.length <= draft.layers.length && new Set(ids).size === ids.length,
          'LAYER_ORDER_GROUP', 'commands.json', path, 'Provide one complete group of independent layers');
        const fullStack = ids.length === draft.layers.length && draft.layers.every(layer => ids.includes(layer.layerId));
        const group = fullStack ? draft.layers.toSorted((a,b) => b.zIndex-a.zIndex).map(layer => ({layer}))
          : layerGroups().map(reorderableLayers).find(rows => rows.length === ids.length && rows.every(row => ids.includes(row.layer.layerId)));
        demand(group, 'LAYER_ORDER_GROUP', 'commands.json', path, 'Provide the complete layer stack or one complete legacy group');
        const layers = new Map(group.map(row => [row.layer.layerId, row.layer]));
        const slots = group.map(row => row.layer.zIndex);
        ids.forEach((id, index) => { layers.get(id).zIndex = slots[index]; });
        break;
      }
      case 'reorder-layer-objects': {
        commandShape(command, ['type', 'layerId', 'instanceIds'], path);
        const {layerId, instanceIds} = command;
        const objects = [...draft.instances, ...draft.assemblyInstances].filter(item => item.layerId === layerId);
        const ids = new Set(Array.isArray(instanceIds) ? instanceIds : []);
        demand(ids.size >= 2 && ids.size === instanceIds.length && ids.size <= objects.length,
          'OBJECT_ORDER_LAYER', 'commands.json', path, 'Provide the complete order for one row of objects');
        const fullLayer = objects.length === ids.size && objects.every(item => ids.has(item.instanceId));
        const row = fullLayer ? {items:objects.toSorted((a,b) => compareObjectStack(b,a))}
          : layerGroups().flatMap(group => group.rows).find(entry => entry.layer.layerId === layerId
            && entry.items.length === ids.size && entry.items.every(item => ids.has(item.instanceId)));
        demand(row, 'OBJECT_ORDER_LAYER', 'commands.json', path, 'Objects must be siblings in the same layer row');
        if (row.items.every((item, index) => item.instanceId === instanceIds[index])) break;
        const byId = new Map(objects.map(item => [item.instanceId, item]));
        const bottomToTop = instanceIds.toReversed();
        let next = 0;
        objects.sort(compareObjectStack).forEach((item, index) => {
          const reordered = ids.has(item.instanceId) ? byId.get(bottomToTop[next++]) : item;
          reordered.drawOrder = index;
        });
        break;
      }
      default:
        reject('COMMAND_UNSUPPORTED', 'commands.json', `${path}/type`, 'Unsupported editor command');
    }
    // Shared full validation before the next command; no partially valid author state escapes.
    context.model.analyzeMap(draft);
  }

  const editor=Object.freeze({
    getDocument: () => clone(document),
    getScene: () => compiled(handle, document),
    history: () => status(false),
    fork(){const copy=editorFromChecked(handle,document,historyLimit);editorInternals.get(copy)({past:[...past],future:[...future],discarded});return copy;},
    rebind(nextHandle) {
      demand(handle.kitId === nextHandle.kitId, 'KIT_REVISION_MISMATCH', 'scene.document.json', '/kitRef', 'Cannot rebind to a different kit family');
      const rebind = value => ({ ...value, kitRef: { kitId: nextHandle.kitId, revision: nextHandle.revision } });
      const copy = createEditor(nextHandle, rebind(document), { historyLimit });
      const bindEntry = entry => Object.fromEntries(['before', 'after'].map(key => {
        const value = rebind(JSON.parse(entry[key]));
        compileMap(nextHandle, value);
        return [key, canonicalJson(value)];
      }));
      editorInternals.get(copy)({ past: past.map(bindEntry), future: future.map(bindEntry), discarded });
      return copy;
    },
    execute(commands) {
      demand(Array.isArray(commands) && commands.length <= 256, 'COMMAND_BATCH', 'commands.json', '/', 'A gesture is a bounded command array');
      const totalCells = commands.reduce((sum, command) => sum + (Array.isArray(command?.cells) ? command.cells.length : 0), 0);
      demand(totalCells <= 100000, 'RESOURCE_LIMIT', 'commands.json', '/', 'Gesture cell budget exceeded');
      const draft = clone(document);
      commands.forEach((command, index) => apply(draft, command, index));
      const next = checked(handle, draft);
      const before = canonicalJson(document), after = canonicalJson(next);
      if (before === after) return status(false);
      past.push({ before, after });
      let historyBytes = past.reduce((sum, item) => sum + Buffer.byteLength(item.before) + Buffer.byteLength(item.after), 0);
      while (past.length > historyLimit || historyBytes > 16777216) {
        const removed = past.shift(); discarded++;
        historyBytes -= Buffer.byteLength(removed.before) + Buffer.byteLength(removed.after);
      }
      document = next; future = [];
      return status(true);
    },
    undo() {
      if (!past.length) return status(false);
      const entry = past.at(-1),next=checked(handle, JSON.parse(entry.before));
      past.pop(); future.push(entry); document = next;
      return status(true);
    },
    redo() {
      if (!future.length) return status(false);
      const entry = future.at(-1),next=checked(handle, JSON.parse(entry.after));
      future.pop(); past.push(entry); document = next;
      return status(true);
    },
    serialize: () => `${canonicalJson(document, true)}\n`,
  });
  editorInternals.set(editor,state=>{past=state.past;future=state.future;discarded=state.discarded;});
  return editor;
}
