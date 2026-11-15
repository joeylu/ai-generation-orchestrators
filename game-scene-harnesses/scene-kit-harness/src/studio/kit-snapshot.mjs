import {contextFor} from '../kit.mjs';
import {runsFromCells} from '../document.mjs';
import {readTerrainStudyPreviewImage} from '../terrain-proof/preview.mjs';
import {compilePresetPreview} from './preset-preview.mjs';
import {resolveTerrainMaterialAppearance,resolveTerrainSurfaceInterface} from '../terrain-loop-material.mjs';
import {renderTerrainBrushExamples} from './terrain-brush-preview.mjs';

export function studioKitSnapshot(handle,{assetPrefix='/assets',terrainPreview=null}={}){
  const context=contextFor(handle);
  const assets = new Map(context.catalog.modules.map(module => [
    `${assetPrefix}/${encodeURIComponent(module.assetId)}.png`, context.files.get(module.source.path),
  ]));
  const animationAtlases = new Map();
  for (const module of context.catalog.modules) for (const { clip } of module.animation?.states ?? []) {
    if (!clip || animationAtlases.has(clip.source.sha256)) continue;
    const url = `${assetPrefix}/_animation/${clip.source.sha256}.png`;
    animationAtlases.set(clip.source.sha256, url);
    assets.set(url, context.files.get(clip.source.path));
  }
  const kitMaterial = context.kit.terrainAppearance ? { ...resolveTerrainMaterialAppearance(context.kit.terrainAppearance,context.kit.terrainMaterialLoop,context.kit.terrainRigidRepeat,context.kit.terrainSurfaceCycle) } : null;
  if (kitMaterial) for (const kind of ['body', 'cap']) {
    const item = kitMaterial[kind], url = `${assetPrefix}/_terrain-material-${kind}.png`;
    kitMaterial[kind] = { ...item, url }; assets.set(url, context.files.get(item.source.path));
  }
  if (kitMaterial && context.kit.terrainEdges) {
    if(context.kit.terrainSurfaceSpanEnvelope)kitMaterial.surfaceSpanEnvelope=structuredClone(context.kit.terrainSurfaceSpanEnvelope);
    if(context.kit.terrainStepSurface)kitMaterial.stepSurface=structuredClone(context.kit.terrainStepSurface);
    kitMaterial.edges = structuredClone(context.kit.terrainEdges);
    if(kitMaterial.edges.surfaceInterface)kitMaterial.edges.surfaceInterface=resolveTerrainSurfaceInterface(kitMaterial.edges.surfaceInterface,context.kit.terrainSurfaceCycle);
    for (const side of ['left', 'right']) for (const part of ['wall', 'corner']) {
      const item = kitMaterial.edges[side][part], url = `${assetPrefix}/_terrain-edge-${side}-${part}.png`;
      kitMaterial.edges[side][part] = { ...item, url }; assets.set(url, context.files.get(item.source.path));
    }
  }
  if(kitMaterial&&context.kit.terrainBottomEdges){
    kitMaterial.bottomEdges=structuredClone(context.kit.terrainBottomEdges);
    for(const part of ['edge','leftCorner','rightCorner']){
      const item=kitMaterial.bottomEdges[part],url=`${assetPrefix}/_terrain-bottom-${part}.png`;
      kitMaterial.bottomEdges[part]={...item,url};assets.set(url,context.files.get(item.source.path));
    }
  }
  const brushExamples=renderTerrainBrushExamples(handle).map(({id,label,bytes})=>{
    const url=`${assetPrefix}/_terrain-brush-${id}.png`;assets.set(url,bytes);return {id,label,url};
  });
  const metadata = {
    ...(animationAtlases.size ? { animationAtlases: Object.fromEntries(animationAtlases) } : {}),
    kit: handle, grid: context.kit.grid, pixelsPerUnit:context.kit.pixelsPerUnit, familyId: context.rules.familyId,
    brushes:[{brushId:context.rules.familyId,kind:'terrain',name:'地形画刷',description:context.kit.terrainBottomEdges?'自动拼接地表、侧边与下缘':['ai_scene_terrain_edges_v4','ai_scene_terrain_edges_v5','ai_scene_terrain_edges_v6'].includes(context.kit.terrainEdges?.format)?'自动拼接地表与岩边':'自动拼接地形',familyId:context.rules.familyId,
      previewAssetId:context.rules.entries.find(entry=>entry.signature===124).variantAssetIds[0],
      ...(brushExamples.length?{previewUrl:brushExamples[0].url,previewExamples:brushExamples}:{}),
      tileAssetIds:context.rules.entries.map(entry=>entry.variantAssetIds[0])}],
    modules: context.catalog.modules.map(module => ({ ...module, url: `${assetPrefix}/${encodeURIComponent(module.assetId)}.png`,
      ...(kitMaterial && module.kind === 'terrain' ? { terrainPhase: context.rules.entries.find(entry => entry.variantAssetIds.includes(module.assetId)).variantAssetIds.indexOf(module.assetId) } : {}),
      ...(terrainPreview && module.kind === 'terrain' ? { terrainSignature: context.rules.entries.find(entry => entry.variantAssetIds.includes(module.assetId))?.signature } : {}) })),
    presets: context.library.presets.map(preset => {
      const expanded=context.model.getPreset(preset.presetId);
      const skin = context.kit.format === 'ai_scene_kit_v4' ? expanded.visuals
        .map(v => context.catalog.modules.find(m => m.assetId === v.assetId)).find(m => m.terrainSkin) : undefined;
      return { presetId: preset.presetId, sizeCells: preset.sizeCells, hasTerrain:expanded.cells.size>0, terrainRuns:runsFromCells(expanded.cells),
        thumbnail:compilePresetPreview(handle,preset,skin?.preferredLayerId),
        ...(skin?{previewAssetId:skin.assetId}:{}),...(skin?.preferredLayerId ? { preferredLayerId: skin.preferredLayerId } : {}) };
    }),
    ...(kitMaterial ? { kitMaterial } : {}),
    ...(terrainPreview ? { terrainPreview: { ...terrainPreview, modules: terrainPreview.modules.map(module => ({ ...module,
      url: `/terrain-assets/${encodeURIComponent(module.key)}.png` })), materialFields: Object.fromEntries(
        Object.entries(terrainPreview.materialFields).map(([kind, item]) => [kind, { ...item, url: `/terrain-assets/${item.key}.png` }])) } } : {}),
  };
  if (terrainPreview) for (const module of terrainPreview.modules) assets.set(`/terrain-assets/${encodeURIComponent(module.key)}.png`,
    readTerrainStudyPreviewImage(terrainPreview, module.key));
  if (terrainPreview) for (const item of Object.values(terrainPreview.materialFields)) assets.set(`/terrain-assets/${item.key}.png`,
    readTerrainStudyPreviewImage(terrainPreview, item.key));
  return {metadata,assets};
}
