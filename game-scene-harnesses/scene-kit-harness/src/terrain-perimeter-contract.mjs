import {check,exact,text,digest} from './generation/common.mjs';
import {validateSourceAppearance} from './generation/source-appearance.mjs';

export const COMPLETE_TERRAIN_ROLES=Object.freeze(['left-wall','right-wall','left-top-corner','right-top-corner','bottom-edge','left-bottom-corner','right-bottom-corner']);
export const TERRAIN_COMPLETION_POLICY='explicit-terrain-completion-required-v2';
export const TERRAIN_COMPLETION_INTENT='reference-terrain-intent-v2';
export const NATIVE_TERRAIN_RENDERING='intent-bound-native-perimeter-v1';
export const TERRAIN_REFERENCE_DEFINED_MANUFACTURED_PROFILE='reference-defined-manufactured-v1';
export const TERRAIN_EDGE_GUTTER_WARNING_PROFILE='alpha-one-gutter-warning-v1';
export const needsCompleteTerrain=intent=>intent?.profile===TERRAIN_COMPLETION_INTENT&&intent.usage==='complete-brush';
export function validateTerrainCompletion(intent){
  check(['complete-brush','material-study'].includes(intent.usage),'TERRAIN_USAGE_REQUIRED');
  if(intent.usage==='material-study')return;
  const p=intent.perimeter;check(p,'TERRAIN_PERIMETER_REQUIRED');exact(p,['surfaceFamily','items']);
  check(['natural','engineered-city'].includes(p.surfaceFamily),'TERRAIN_PERIMETER_FAMILY');
  check(Array.isArray(p.items)&&p.items.length===7&&new Set(p.items.map(i=>i.role)).size===7
    &&COMPLETE_TERRAIN_ROLES.every(role=>p.items.some(i=>i.role===role)),'TERRAIN_PERIMETER_COVERAGE');
  for(const item of p.items){exact(item,['role','content','exclusions','sourceAppearance']);text(item.content,{limit:1200});
    check(Array.isArray(item.exclusions)&&item.exclusions.length>0&&item.exclusions.length<=16,'TERRAIN_PERIMETER_EXCLUSIONS');item.exclusions.forEach(s=>text(s,{limit:500}));validateSourceAppearance(item.sourceAppearance);}
}
export function terrainPerimeterOptions(intent,{batchId,baseBatchSha256,capabilitiesSha256,manufacturedMaterialProfile,
  gutterPolicy=TERRAIN_EDGE_GUTTER_WARNING_PROFILE}){
  check(needsCompleteTerrain(intent),'TERRAIN_COMPLETE_BRUSH_REQUIRED');validateTerrainCompletion(intent);
  check(manufacturedMaterialProfile===undefined||intent.perimeter.surfaceFamily==='engineered-city'
    &&manufacturedMaterialProfile===TERRAIN_REFERENCE_DEFINED_MANUFACTURED_PROFILE,'TERRAIN_EDGE_MANUFACTURED_MATERIAL_PROFILE');
  check(gutterPolicy==='strict'||gutterPolicy===TERRAIN_EDGE_GUTTER_WARNING_PROFILE,'TERRAIN_EDGE_GUTTER_POLICY');
  return {batchId,baseBatchSha256,capabilitiesSha256,coverageProfile:'full-perimeter-v1',nativeSizeProfile:'bounded-native-4m-v1',renderEnvelopeProfile:'visible-alpha8-outward16-native-rgba-v1',
    ...(intent.perimeter.surfaceFamily==='engineered-city'?{surfaceFamily:'engineered-city'}:{naturalSurfaceProfile:'reference-defined-cover-v1'}),
    ...(manufacturedMaterialProfile===undefined?{}:{manufacturedMaterialProfile}),
    ...(gutterPolicy==='strict'?{}:{gutterPolicy}),
    items:COMPLETE_TERRAIN_ROLES.map(role=>({assetId:'perimeter.'+role,...intent.perimeter.items.find(i=>i.role===role)}))};
}
export function assertTerrainPerimeterInputs(intent,baseBatchSha256,{batch,sources},controls){
  check(needsCompleteTerrain(intent),'TERRAIN_COMPLETE_BRUSH_REQUIRED');validateTerrainCompletion(intent);
  check(batch.baseBatchSha256===baseBatchSha256&&sources.length===7,'TERRAIN_PERIMETER_BATCH_BINDING');
  for(const role of COMPLETE_TERRAIN_ROLES){const matches=sources.filter(s=>s.plan.recipe.edgeRole===role);check(matches.length===1,'TERRAIN_PERIMETER_COVERAGE');
    const recipe=matches[0].plan.recipe,item=intent.perimeter.items.find(i=>i.role===role);
    check(recipe.coverageProfile==='full-perimeter-v1'&&recipe.nativeSizeProfile==='bounded-native-4m-v1'
      &&recipe.renderEnvelopeProfile==='visible-alpha8-outward16-native-rgba-v1'
      &&(intent.perimeter.surfaceFamily==='engineered-city'?recipe.surfaceFamily==='engineered-city':!recipe.surfaceFamily&&recipe.naturalSurfaceProfile==='reference-defined-cover-v1')
      &&digest(recipe.subjectBrief)===digest({content:item.content,exclusions:item.exclusions})&&digest(recipe.sourceAppearance)===digest(item.sourceAppearance),'TERRAIN_PERIMETER_SOURCE_BINDING');
  }
  check(controls?.gridProfile==='grid-solid-union-native-v1'&&controls.materialProfile==='union-world-body-local-surface-v1'&&controls.junctions
    &&controls.bottom?.nativeSizeProfile==='bounded-native-4m-v1'&&controls.bottom.renderEnvelopeProfile==='visible-alpha8-outward16-native-rgba-v1','TERRAIN_PERIMETER_RENDERING_REQUIRED');
}
