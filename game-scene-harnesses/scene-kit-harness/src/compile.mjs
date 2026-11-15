import { contextFor } from './kit.mjs';
import { canonicalJson, canonicalMap, clone, compareObjectStack, compareText, deepFreeze } from './document.mjs';
import { sha256 } from './validate.mjs';
import { cellKey, signatureAt } from './topology.mjs';
import {LAYERED_TERRAIN_PROFILE} from './terrain-overlap.mjs';
import { compileTerrainEdges,compileGridTerrainEdges,compileTerrainUnionEdges } from './terrain-edges.mjs';
import { compileGridTerrainFields } from './grid-terrain.mjs';
import { compileTerrainUnionMaterial } from './terrain-union-material.mjs';
import { resolveTerrainMaterialAppearance,resolveTerrainSurfaceInterface } from './terrain-loop-material.mjs';
import {compileTerrainStepCorners} from './terrain-step-corners.mjs';
import {compileTerrainBottomEdges,captureTerrainBottomBodySupport,TERRAIN_BOTTOM_ADAPTIVE_COVERAGE_PROFILE,TERRAIN_BOTTOM_BODY_SUPPORT_PROFILE} from './terrain-bottom-edges.mjs';
import {compileSharedTerrainFields,SHARED_TERRAIN_UNION_PROFILE} from './shared-terrain-field.mjs';
import {compileSharedTerrainUnion} from './shared-terrain-union.mjs';
import { demand } from './errors.mjs';

// Compiled scenes contain plain data and large scalar mesh arrays. Order only
// the records first so JSON.stringify can write scalar arrays without a replacer.
function orderCompiledData(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (item !== null && typeof item === 'object') return value.map(orderCompiledData);
    }
    return value;
  }
  const ordered = {};
  for (const key of Object.keys(value).sort()) {
    const entry = orderCompiledData(value[key]);
    if (key === '__proto__') Object.defineProperty(ordered, key, { value: entry, enumerable: true });
    else ordered[key] = entry;
  }
  return ordered;
}

function boundaries(cells, grid) {
  const groups = new Map();
  const edges = [
    { direction: 'n', dx: 0, dy: -1, horizontal: true, ox: 0, oy: 0, normal: { x: 0, y: -1 } },
    { direction: 'e', dx: 1, dy: 0, horizontal: false, ox: 1, oy: 0, normal: { x: 1, y: 0 } },
    { direction: 's', dx: 0, dy: 1, horizontal: true, ox: 0, oy: 1, normal: { x: 0, y: 1 } },
    { direction: 'w', dx: -1, dy: 0, horizontal: false, ox: 0, oy: 0, normal: { x: -1, y: 0 } },
  ];
  for (const key of cells.keys()) {
    const [x, y] = key.split(',').map(Number);
    for (const edge of edges) {
      if (cells.has(cellKey(x + edge.dx, y + edge.dy))) continue;
      const line = edge.horizontal ? y + edge.oy : x + edge.ox;
      const start = edge.horizontal ? x : y;
      const groupKey = `${edge.direction}/${line}`;
      if (!groups.has(groupKey)) groups.set(groupKey, { edge, line, starts: [] });
      groups.get(groupKey).starts.push(start);
    }
  }
  const segments = [];
  for (const { edge, line, starts } of [...groups.values()].sort((a, b) => compareText(a.edge.direction, b.edge.direction) || a.line - b.line)) {
    starts.sort((a, b) => a - b);
    const merged = [];
    for (const start of starts) {
      if (merged.at(-1)?.end === start) merged.at(-1).end++;
      else merged.push({ start, end: start + 1 });
    }
    for (const { start, end } of merged) segments.push({
      direction: edge.direction, normal: edge.normal,
      from: edge.horizontal ? { x: start * grid.width, y: line * grid.height } : { x: line * grid.width, y: start * grid.height },
      to: edge.horizontal ? { x: end * grid.width, y: line * grid.height } : { x: line * grid.width, y: end * grid.height },
    });
  }
  return { boundarySegments: segments, standingSurfaces: segments.filter(segment => segment.direction === 'n') };
}

export function compileMap(handle, input) {
  const context = contextFor(handle);
  const analysis = context.model.analyzeMap(input);
  const document = canonicalMap(input);
  const { kit, rules, modules } = context;
  const terrainAppearance=resolveTerrainMaterialAppearance(kit.terrainAppearance,kit.terrainMaterialLoop,kit.terrainRigidRepeat,kit.terrainSurfaceCycle);
  const surfaceInterface=kit.terrainEdges?.surfaceInterface&&resolveTerrainSurfaceInterface(kit.terrainEdges.surfaceInterface,kit.terrainSurfaceCycle);
  const attached = kit.format === 'ai_scene_kit_v4', macro = attached || kit.format === 'ai_scene_kit_v3', continuous = macro || kit.format === 'ai_scene_kit_v2';
  const density = kit.pixelsPerUnit.numerator / kit.pixelsPerUnit.denominator;
  const appearances = new Map(document.instanceAppearances?.map(row => [`visual/${row.instanceId}`, row.appearance]));
  function node(instanceId, assetId, layerId, x, y, extra = {}) {
    const module = modules.get(assetId);
    let renderStyle = module.renderStyle ?? (macro && module.kind === 'terrain' && kit.terrainAppearance.tint !== undefined
      ? { scale: { numerator: 1, denominator: 1 }, tint: kit.terrainAppearance.tint, opacity: 1 } : undefined);
    let ratio = renderStyle?.scale;
    const instanceScale=document.instanceTransforms?.find(t=>`visual/${t.instanceId}`===instanceId)?.scale??1;
    if(instanceScale!==1){let n=Math.round(instanceScale*1000)*(ratio?.numerator??1),d=1000*(ratio?.denominator??1);
      const gcd=(a,b)=>b?gcd(b,a%b):a,g=gcd(n,d);ratio={numerator:n/g,denominator:d/g};
      if(renderStyle)renderStyle={...renderStyle,scale:ratio};}
    const scale = ratio ? ratio.numerator / ratio.denominator : 1;
    const appearance = appearances.get(instanceId);
    return {
      nodeId: instanceId, assetId, layerId,
      kind: module.kind === 'strip' ? 'repeat-x' : 'sprite',
      logicalAnchor: { x, y },
      position: { x: x + module.visualOffset.x - module.anchorPx.x * scale / density, y: y + module.visualOffset.y - module.anchorPx.y * scale / density },
      size: { width: module.pixelSize.width * scale / density, height: module.pixelSize.height * scale / density },
      source: { ...module.source, pixelSize: clone(module.pixelSize) },
      sourceToLogical: { numerator: kit.pixelsPerUnit.denominator * (ratio?.numerator ?? 1), denominator: kit.pixelsPerUnit.numerator * (ratio?.denominator ?? 1) },
      ...(renderStyle ? { renderStyle: clone(renderStyle) } : {}),
      ...(appearance ? { appearance } : {}),
      ...(module.kind === 'strip' ? { repeat: { axis: 'x', period: module.pixelSize.width / density } } : {}),
      ...extra,
    };
  }
  const terrain = [...analysis.cells.keys()].map(key => key.split(',').map(Number)).sort((a, b) => a[1] - b[1] || a[0] - b[0]).map(([x, y]) => {
    const signature = signatureAt(analysis.cells, x, y);
    const variants = context.entries.get(signature);
    const columns = macro ? 8 : 4, phase = ((y % 4 + 4) % 4) * columns + ((x % columns + columns) % columns);
    let variant = phase;
    if (!continuous) {
      const hash = sha256(canonicalJson([rules.rulesId, rules.revision, document.seed, analysis.terrainLayerId, x, y, signature]));
      variant = Number(BigInt(`0x${hash}`) % BigInt(variants.length));
    }
    const assetId = variants[variant];
    return node(`terrain/${x},${y}`, assetId, analysis.terrainLayerId, x * kit.grid.width, y * kit.grid.height, { cell: { x, y }, signature });
  });
  const visuals = [...analysis.visuals].sort(compareObjectStack).map(instance =>
    node(`visual/${instance.instanceId}`, instance.assetId, instance.layerId, instance.x, instance.y));
  const covered = new Set(analysis.terrainSkins.flatMap(skin => skin.cells.map(cell => cellKey(cell.x, cell.y))));
  const renderedTerrain = attached ? terrain.filter(node => !covered.has(cellKey(node.cell.x, node.cell.y))) : terrain;
  const allNodes = [...renderedTerrain, ...visuals];
  const layered=document.format==='ai_scene_document_v6';
  const curved = ['ai_scene_document_v2','ai_scene_document_v3','ai_scene_document_v4','ai_scene_document_v5','ai_scene_document_v6'].includes(document.format), mixed = ['ai_scene_document_v3','ai_scene_document_v4','ai_scene_document_v5','ai_scene_document_v6'].includes(document.format);
  const mixedCells = new Set(analysis.mixed.flatMap(patch=>patch.source.gridCells.map(cell=>cellKey(cell.x,cell.y))));
  const mixedCurves = new Set(analysis.mixed.flatMap(patch=>patch.source.curveIds));
  const collisionCells = mixed ? new Map([...analysis.cells].filter(([key])=>!mixedCells.has(key))) : analysis.cells;
  const materialGeometry = curve => {
    if (!macro) return curve;
    const result = clone(curve);
    for (const kind of ['body', 'cap']) result[kind].uvs = result[kind].uvs.map((v, i) => i % 2 ? v : v / 2);
    result.materialMapping = { format: 'ai_scene_world_material_mapping_v1', bodyPeriod: { width: 512, height: 256 }, capPeriod: 512 };
    const denseMeasured=kit.terrainAppearance.format==='ai_scene_continuous_terrain_appearance_v6';
    const measured=denseMeasured||kit.terrainAppearance.format==='ai_scene_continuous_terrain_appearance_v5';
    if (measured||['ai_scene_continuous_terrain_appearance_v3','ai_scene_continuous_terrain_appearance_v4'].includes(kit.terrainAppearance.format)) {
      result.cap.uvs = result.cap.uvs.map((v, i) => i % 2 ? v : result.cap.positions[i] / 512);
      result.materialMapping.capMapping = 'world-x-512-v1';
    }
    if (measured||kit.terrainAppearance.format === 'ai_scene_continuous_terrain_appearance_v4') {
      const origin=kit.terrainAppearance.surfaceOriginInBodyPixels;
      const normalizationHeight=denseMeasured?506:253;
      const offset=origin.numerator/origin.denominator/normalizationHeight;
      // Keep the surface strip and the body on the same source rows where they
      // overlap. Depth is measured from this surface, rather than world Y.
      result.body.uvs=result.body.uvs.map((value,index)=>{
        if(index%2===0)return value;
        const vertex=Math.floor(index/2),sample=result.samples[Math.floor(vertex/2)];
        return offset+(result.body.positions[vertex*2+1]-sample.y)/256;
      });
      const end=measured?kit.terrainAppearance.capUvEnd.numerator/kit.terrainAppearance.capUvEnd.denominator:253/256;
      result.cap.uvs=result.cap.uvs.map((value,index)=>index%2?value*end:value);
      result.materialMapping.bodyMapping='surface-vertical-depth-with-source-origin-v1';
      result.materialMapping.surfaceOriginInBodyPixels=clone(origin);
      if(denseMeasured)result.materialMapping.sourceOriginNormalizationHeight=506;
      if(measured){result.materialMapping.surfaceMappingSha256=kit.terrainAppearance.surfaceMappingSha256;result.materialMapping.capUvEnd=clone(kit.terrainAppearance.capUvEnd);}
    }
    return result;
  };
  let mappedCurves = curved ? analysis.curves.map(curve => ({ ...materialGeometry(curve), layerId: analysis.terrainLayerId })) : [];
  let edgeResult,gridResult,unionMaterial,stepCorners,bottomEdges,interiorBodySupport,sharedField;
  if(kit.terrainSharedField){
    const unified=kit.terrainSharedField.profile===SHARED_TERRAIN_UNION_PROFILE;
    demand(layered&&analysis.mixed.length===0&&(unified||analysis.curves.length===0),'SHARED_FIELD_GEOMETRY','scene.document.json','/','Use the v2 profile for authored curves and grid; mixed patches require a separate capability');
    const result=(unified?compileSharedTerrainUnion:compileSharedTerrainFields)(new Map([...analysis.cells].filter(([k])=>!covered.has(k))),{grid:kit.grid,appearance:terrainAppearance,layerId:analysis.terrainLayerId,profile:kit.terrainSharedField,...(unified?{curves:mappedCurves,world:analysis.world}:{})});
    if(unified)mappedCurves=result.curveTerrains;
    gridResult={gridTerrains:result.gridTerrains};sharedField=result.report;
  }
  if (kit.terrainEdges) {
    demand(layered && analysis.mixed.length === 0, 'TERRAIN_EDGE_GEOMETRY', 'scene.document.json', '/', 'Terrain side covers currently require v6 curves without mixed patches');
    let gridFields=['ai_scene_terrain_edges_v4','ai_scene_terrain_edges_v5','ai_scene_terrain_edges_v6'].includes(kit.terrainEdges.format)
      ?compileGridTerrainFields(analysis.cells,{grid:kit.grid,appearance:kit.terrainAppearance,layerId:analysis.terrainLayerId,excludedCells:covered}):[];
    if(kit.terrainEdges.format==='ai_scene_terrain_edges_v6'){
      const unified=compileTerrainUnionMaterial({gridTerrains:gridFields,curveTerrains:mappedCurves,appearance:terrainAppearance,grid:kit.grid,
        ...(surfaceInterface?{surfaceInterface}:{}),
        ...(kit.terrainSurfaceSpanEnvelope?{surfaceSpanEnvelope:kit.terrainSurfaceSpanEnvelope}:{}),
        ...(kit.terrainBottomEdges?.junctionProfile===TERRAIN_BOTTOM_ADAPTIVE_COVERAGE_PROFILE?{bottomCoverageProfile:TERRAIN_BOTTOM_ADAPTIVE_COVERAGE_PROFILE}:{})});
      gridFields=unified.gridTerrains;mappedCurves=unified.curveTerrains;unionMaterial=unified.report;
    }
    if(kit.terrainBottomEdges?.bodySupportProfile===TERRAIN_BOTTOM_BODY_SUPPORT_PROFILE)
      interiorBodySupport=captureTerrainBottomBodySupport({gridTerrains:gridFields,curveTerrains:mappedCurves,profile:TERRAIN_BOTTOM_BODY_SUPPORT_PROFILE});
    if(kit.terrainEdges.format==='ai_scene_terrain_edges_v6'){
      const joined=compileTerrainUnionEdges(gridFields,mappedCurves,kit.terrainEdges,{world:analysis.world,grid:kit.grid,cells:analysis.cells,allCells:analysis.cells});
      gridResult={gridTerrains:joined.gridTerrains,report:joined.report.grid};edgeResult={curves:joined.curves,report:joined.report};
    }else{
      if(gridFields.length)gridResult=compileGridTerrainEdges(gridFields,kit.terrainEdges,
        {world:analysis.world,grid:kit.grid,cells:analysis.cells,allCells:analysis.cells,curves:mappedCurves});
      edgeResult = compileTerrainEdges(mappedCurves, kit.terrainEdges, { world: analysis.world, cells: analysis.cells, grid: kit.grid,
        ...(gridFields.length?{gridUnion:true}:{}) });
    }
  }
  if(kit.terrainStepCorners){
    const junctions=compileTerrainStepCorners({gridTerrains:gridResult?.gridTerrains??[],curveTerrains:edgeResult?.curves??mappedCurves,
      edgePlacement:edgeResult.report,unionMaterial,appearance:terrainAppearance,profile:kit.terrainStepCorners,
      ...(kit.terrainStepSurface?{surfaceBinding:kit.terrainStepSurface,surfaceInterface,surfaceSpanEnvelope:kit.terrainSurfaceSpanEnvelope}:{}),
      world:analysis.world,cells:analysis.cells,grid:kit.grid},{ownedMeshes:true});
    gridResult.gridTerrains=junctions.gridTerrains;edgeResult.curves=junctions.curveTerrains;stepCorners=junctions.report;
  }
  if(kit.terrainBottomEdges){
    const bottom=compileTerrainBottomEdges({gridTerrains:gridResult?.gridTerrains??[],curveTerrains:edgeResult?.curves??mappedCurves,
      bottomEdges:kit.terrainBottomEdges,terrainEdges:kit.terrainEdges,world:analysis.world,grid:kit.grid,cells:analysis.cells,
      ...(interiorBodySupport?{interiorBodySupport}:{})},{ownedMeshes:true});
    gridResult.gridTerrains=bottom.gridTerrains;edgeResult.curves=bottom.curveTerrains;bottomEdges=bottom.report;
  }
  const meshGridCells=gridResult?.gridTerrains.reduce((n,terrain)=>n+terrain.source.gridCells.length,0)??0;
  const animatedAssets = [...new Set(allNodes.map(node => node.assetId))].filter(assetId => modules.get(assetId)?.animation).sort();
  const scene = {
    format: kit.terrainStepSurface?.endFade?.compiledFormat??(layered?'ai_scene_compiled_v7':attached ? 'ai_scene_compiled_v6' : macro ? 'ai_scene_compiled_v5' : kit.format === 'ai_scene_kit_v2' ? 'ai_scene_compiled_v4' : mixed ? 'ai_scene_compiled_v3' : curved ? 'ai_scene_compiled_v2' : 'ai_scene_compiled_v1'),
    ...(layered?{terrainCoexistence:{...LAYERED_TERRAIN_PROFILE}}:{}),
    source: { mapId: document.mapId, authorSha256: sha256(canonicalJson(document)), kitSha256: context.bundleSha256 },
    kitRef: clone(document.kitRef), rulesRef: clone(document.rulesRef),
    grid: clone(kit.grid), worldBounds: analysis.world, defaultCamera: clone(document.defaultCamera),
    layers: document.layers.map(layer => ({ ...layer, nodes: allNodes.filter(item => item.layerId === layer.layerId) })),
    ...(animatedAssets.length ? { environmentAnimations: Object.fromEntries(animatedAssets.map(assetId => {
      const module = modules.get(assetId);
      return [assetId, clone({ ...module.animation, anchorPx: module.anchorPx, pixelSize: module.pixelSize })];
    })) } : {}),
    collisionSuggestions: { ...boundaries(collisionCells, kit.grid), ...(curved ? {
      curveContours: analysis.curves.filter(curve=>!mixedCurves.has(curve.curveId)).map(curve => ({ curveId: curve.curveId, contour: curve.contour, surface: curve.surface,
        closed: true, walkability: 'not-assessed' })),
    } : {}), ...(mixed ? {mixedContours:analysis.mixed.map(patch=>({patchId:patch.patchId,contour:patch.contour,surface:patch.surface,closed:true,walkability:'not-assessed'}))} : {}) },
    counts: { terrainNodes: terrain.length, visualNodes: visuals.length },
    ...(attached ? { terrainSkins: clone(analysis.terrainSkins), terrainPresentation: { renderedGridNodes: renderedTerrain.length-meshGridCells,
      coveredGridCells: covered.size,...(gridResult?{meshCoveredGridCells:meshGridCells}:{}), collision: 'original-grid-and-curve-suggestions-unchanged' } } : {}),
    visualAcceptance: 'not-assessed', generationCalls: 0,
    ...(continuous ? { terrainMaterial: { ...clone(terrainAppearance), ...(kit.terrainStepSurface?{stepSurface:clone(kit.terrainStepSurface)}:{}), ...(kit.terrainEdges ? { edges: {...clone(kit.terrainEdges),...(surfaceInterface?{surfaceInterface}:{})} } : {}),
      ...(kit.terrainSurfaceSpanEnvelope?{surfaceSpanEnvelope:clone(kit.terrainSurfaceSpanEnvelope)}:{}),
      ...(kit.terrainBottomEdges?{bottomEdges:clone(kit.terrainBottomEdges)}:{}) } } : {}),
    ...(curved ? { curveTerrains: edgeResult?.curves ?? mappedCurves } : {}),
    ...(gridResult?{gridTerrains:gridResult.gridTerrains}:{}),
    ...(unionMaterial?{terrainUnionMaterial:unionMaterial}:{}),
    ...(stepCorners?{terrainStepCorners:stepCorners}:{}),
    ...(bottomEdges?{terrainBottomEdgePlacement:bottomEdges}:{}),
    ...(sharedField?{terrainSharedField:sharedField}:{}),
    ...(edgeResult ? { terrainEdgePlacement: kit.terrainEdges.format==='ai_scene_terrain_edges_v6'?edgeResult.report:gridResult?{...edgeResult.report,
      supportedGeometry:'v6-curves-and-grid-union-exposed-vertical-boundaries',grid:gridResult.report,
      placed:[...edgeResult.report.placed,...gridResult.report.placed],skipped:[...edgeResult.report.skipped,...gridResult.report.skipped]}:edgeResult.report } : {}),
    ...(mixed ? {mixedTerrains:analysis.mixed.map(patch=>({...materialGeometry(patch),layerId:analysis.terrainLayerId}))} : {}),
  };
  return deepFreeze({ ...scene, contentSha256: sha256(JSON.stringify(orderCompiledData(scene))) });
}
