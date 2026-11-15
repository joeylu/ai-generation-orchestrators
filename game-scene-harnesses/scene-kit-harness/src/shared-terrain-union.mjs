import {compileSharedTerrainFields,sharedTerrainInset,SHARED_TERRAIN_UNION_PROFILE} from './shared-terrain-field.mjs';
import {compileTerrainUnionMaterial} from './terrain-union-material.mjs';
import {check,digest,seal} from './generation/common.mjs';

// The existing union compiler owns exposed cap removal, world UVs and budgets.
// The author surface and collision stay exact. Grid relief meets original
// curve contacts, and optional curve relief is restricted to detached sides.
export function compileSharedTerrainUnion(cells,{grid,appearance,layerId,profile,curves,world}){
  check(profile.profile===SHARED_TERRAIN_UNION_PROFILE,'SHARED_FIELD_UNION_PROFILE');
  const field=compileSharedTerrainFields(cells,{grid,appearance,layerId,profile,curveContacts:curves});
  const grids=field.gridTerrains.map(p=>({...p,surfaceSpans:field.boundaries.filter(e=>e.direction==='n').map(e=>({from:e.a,to:e.b}))}));
  const curveRelief=profile.curveSideRelief?{...profile.outline,world,insetAt:(x,y)=>sharedTerrainInset(profile.outline,x,y)}:undefined;
  const union=compileTerrainUnionMaterial({gridTerrains:grids,curveTerrains:curves,appearance,grid,surfaceInterface:profile.surfaceInterface,spatialSurfaceClips:true,curveRelief});
  return {...union,report:seal({format:'ai_scene_shared_terrain_union_report_v2',profileSha256:profile.sha256,
    gridReportSha256:field.report.sha256,unionReportSha256:digest(union.report),curves:curves.length,gridCells:cells.size,
    bodyMapping:'one-world-field-across-grid-and-authored-curves',
    curveGeometry:curveRelief?'exposed-sides-trimmed-inside-author-solid':'original-author-triangles-unchanged',
    ...(curveRelief?{curveSideRelief:union.report.curveSideRelief}:{}),
    gridContacts:'original-curve-boundary-no-inset',cap:'exposed-union-native-source-depth',
    curveLighting:'original-material-unmodulated',gridLighting:profile.lighting??null,
    sourcePngChanged:false,collisionChanged:false,generationCalls:0,visualAcceptance:'not-assessed'})};
}
