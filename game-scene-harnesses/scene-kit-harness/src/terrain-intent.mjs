import {check,digest,exact,text} from './generation/common.mjs';
import {createSharedTerrainFieldProfile,SHARED_TERRAIN_UNION_PROFILE} from './shared-terrain-field.mjs';
import {TERRAIN_COMPLETION_INTENT,NATIVE_TERRAIN_RENDERING,validateTerrainCompletion,needsCompleteTerrain} from './terrain-perimeter-contract.mjs';

export const TERRAIN_INTENT_POLICY='explicit-terrain-intent-required-v1';
export const TERRAIN_INTENT_PROFILE='reference-terrain-intent-v1';
export const TERRAIN_RENDERING_PROFILE='intent-bound-shared-terrain-v1';
export function validateTerrainIntent(intent){
  const complete=intent?.profile===TERRAIN_COMPLETION_INTENT;
  exact(intent,['profile','contour','notes',...(complete?['usage',...(intent.usage==='complete-brush'?['perimeter']:[])]:[])]);
  check([TERRAIN_INTENT_PROFILE,TERRAIN_COMPLETION_INTENT].includes(intent.profile)&&['rigid-manufactured','irregular-natural','authored'].includes(intent.contour),'TERRAIN_INTENT_CONTOUR');
  if(complete)validateTerrainCompletion(intent);
  text(intent.notes,{limit:1200});return intent;
}
export function validateScopeTerrainIntent(scope){
  if(!Object.hasOwn(scope,'terrainIntent'))return;
  check(['ground','material'].includes(scope.role),'TERRAIN_INTENT_ROLE');validateTerrainIntent(scope.terrainIntent);
}
export function assertTerrainIntentScopes(scopes,{completionRequired=false}={}){
  const ground=scopes.subjects.filter(row=>row.role==='ground');
  check(ground.length>0&&ground.every(row=>row.terrainIntent),'TERRAIN_INTENT_REQUIRED','Record the terrain contour before freezing new source plans');
  ground.forEach(validateScopeTerrainIntent);
  if(completionRequired)check(ground.every(row=>row.terrainIntent.profile===TERRAIN_COMPLETION_INTENT),'TERRAIN_COMPLETION_REQUIRED');
  check(ground.every(row=>digest(row.terrainIntent)===digest(ground[0].terrainIntent)),'TERRAIN_INTENT_MATERIAL_AMBIGUOUS','One shared terrain material cannot silently merge different contour contracts');
}
export function terrainIntentPrompt(intent){
  validateTerrainIntent(intent);
  return `TERRAIN CONTOUR INTENT: ${intent.contour}. ${intent.notes}\nThis source supplies the continuous material, including its own painted seams and surface transition. The checked terrain renderer owns the editable contour. Do not add a complete platform silhouette, a tile grid or a procedural wave to illustrate that contour.`;
}
export function validateTerrainRendering(settings){
  if(settings?.profile===NATIVE_TERRAIN_RENDERING){exact(settings,['profile','terrainIntentSha256']);check(/^[a-f0-9]{64}$/.test(settings.terrainIntentSha256),'TERRAIN_RENDERING_PROFILE');return settings;}
  exact(settings,['profile','terrainIntentSha256','outline','capEndRow','fadeRows']);
  check(settings.profile===TERRAIN_RENDERING_PROFILE&&/^[a-f0-9]{64}$/.test(settings.terrainIntentSha256),'TERRAIN_RENDERING_PROFILE');
  exact(settings.outline,['maximumInsetWorld','sampleStepWorld','wavelengthWorld','seed']);const o=settings.outline;
  check(Number.isFinite(o.maximumInsetWorld)&&o.maximumInsetWorld>=0&&o.maximumInsetWorld<=16
    &&[4,8,16].includes(o.sampleStepWorld)&&Number.isFinite(o.wavelengthWorld)&&o.wavelengthWorld>=32&&o.wavelengthWorld<=512
    &&Number.isSafeInteger(o.seed)&&o.seed>=0&&o.seed<=4294967295,'TERRAIN_RENDERING_OUTLINE');
  check(Number.isSafeInteger(settings.capEndRow)&&settings.capEndRow>=1&&settings.capEndRow<=4096
    &&Number.isSafeInteger(settings.fadeRows)&&settings.fadeRows>=0&&settings.fadeRows<=settings.capEndRow,'TERRAIN_RENDERING_SURFACE');
  return settings;
}
export function assertTerrainIntentRendering(intent,settings){
  if(intent===undefined&&settings===undefined)return;
  check(intent!==undefined,'TERRAIN_INTENT_REQUIRED');validateTerrainIntent(intent);
  check(settings!==undefined,'TERRAIN_RENDERING_REQUIRED','Intent-bound terrain must not fall back to legacy derived tiles');validateTerrainRendering(settings);
  check(settings.terrainIntentSha256===digest(intent),'TERRAIN_RENDERING_INTENT_BINDING');
  if(needsCompleteTerrain(intent)){check(settings.profile===NATIVE_TERRAIN_RENDERING,'TERRAIN_PERIMETER_RENDERING_REQUIRED');return;}
  check(settings.profile===TERRAIN_RENDERING_PROFILE,'TERRAIN_RENDERING_PROFILE');
  check(intent.contour==='irregular-natural'?settings.outline.maximumInsetWorld>0:settings.outline.maximumInsetWorld===0,
    'TERRAIN_RENDERING_CONTOUR','Rigid or authored contours forbid procedural inset; irregular contours need an explicitly bounded inset');
}
export function createIntentTerrainProfile(intent,settings,appearance){
  assertTerrainIntentRendering(intent,settings);
  return createSharedTerrainFieldProfile(appearance,{geometryProfile:SHARED_TERRAIN_UNION_PROFILE,outline:settings.outline,
    surfaceInterface:{profile:'world-body-native-lip-v1',capSourceSha256:appearance.cap.source.sha256,capEndRow:settings.capEndRow,fadeRows:settings.fadeRows}});
}
