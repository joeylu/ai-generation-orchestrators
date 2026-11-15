import {check,digest,exact,seal,unseal} from './generation/common.mjs';
import {COHERENT_SAMPLING} from './coherent-sampling.mjs';
import {suggestCoherentContacts,validateCoherentContacts,calibratedCoherentTarget} from './coherent-layout.mjs';
import {validateMeasuredSurfaceMapping} from './terrain-proof/measured-field.mjs';
import {validateBackgroundBandPlacementShape} from './background-band-placement.mjs';
import {resolveReferenceFeatureTargets} from './reference-feature-layout.mjs';
import {validateTerrainRendering} from './terrain-intent.mjs';

export const COHERENT_TERRAIN_GEOMETRY='reviewed-surface-curves-v1';
export const COHERENT_TERRAIN_MATERIAL='joined-surface-field-v1';
export const COHERENT_MEASURED_TERRAIN_MATERIAL='measured-surface-field-v1';

// New candidates opt into this authoring policy; historical V1/V2 documents and
// their byte-derived plans keep their old interpretation.
export function createCoherentComposition(batch,target,options={}){
  exact(options,['transforms','layerOrder','contacts','surfaceCalibration'].filter(key=>Object.hasOwn(options,key)));
  const layoutTarget=calibratedCoherentTarget(target,options.surfaceCalibration);
  const explicit=new Set((options.transforms??[]).map(row=>row.instanceId));
  const profile=seal({format:'ai_scene_coherent_composition_v3',batchSha256:batch.sha256,targetSha256:target.sha256,
    sourceSampling:COHERENT_SAMPLING,terrainGeometry:COHERENT_TERRAIN_GEOMETRY,terrainMaterial:COHERENT_TERRAIN_MATERIAL,
    transforms:options.transforms??[],contacts:options.contacts??suggestCoherentContacts(layoutTarget).filter(row=>!explicit.has(row.instanceId)),
    ...(options.surfaceCalibration?{surfaceCalibration:options.surfaceCalibration}:{}),
    ...(Object.hasOwn(options,'layerOrder')?{layerOrder:options.layerOrder}:{})});
  validateCoherentComposition(profile,batch,target);return profile;
}

// Measurements are explicit author data. This opt-in entry never changes a
// previous composition, generation request, source PNG or art-review decision.
export function createMeasuredCoherentComposition(batch,target,mapping,options={}){
  const {bandPlacements,terrainRendering,...ordinary}=options,banded=Object.hasOwn(options,'bandPlacements'),
    {sha256:unused,...base}=createCoherentComposition(batch,target,ordinary);
  const profile=seal({...base,format:banded?'ai_scene_coherent_composition_v5':'ai_scene_coherent_composition_v4',
    terrainMaterial:COHERENT_MEASURED_TERRAIN_MATERIAL,surfaceMapping:mapping,...(banded?{bandPlacements}:{}),
    ...(terrainRendering===undefined?{}:{terrainRendering})});
  validateCoherentComposition(profile,batch,target);return profile;
}

export function createFeatureCoherentComposition(batch,target,mapping,structure,measurements,options={}){
  const {featureCorrection,featureSupplement,referenceIntentReview,terrainLayout,...layoutOptions}=options;
  const v=resolveReferenceFeatureTargets(structure,featureCorrection,featureSupplement),explicit=new Set([...v.assets.map(a=>a.instanceId),...(options.transforms??[]).map(t=>t.instanceId)]);
  const contacts=options.contacts??(terrainLayout?[]:suggestCoherentContacts(calibratedCoherentTarget(target,options.surfaceCalibration)).filter(row=>!explicit.has(row.instanceId)));
  const ordinary={...layoutOptions,contacts};if(ordinary.bandPlacements?.length===0)delete ordinary.bandPlacements;
  const {sha256:unused,...base}=createMeasuredCoherentComposition(batch,target,mapping,ordinary);
  const profile=seal({...base,format:'ai_scene_coherent_composition_v6',bandPlacements:base.bandPlacements??[],referenceStructure:structure,featureMeasurements:measurements,
    ...(featureCorrection?{featureCorrection}:{}),...(featureSupplement?{featureSupplement}:{}),...(referenceIntentReview?{referenceIntentReview}:{}),
    ...(terrainLayout?{terrainLayout}:{})});
  validateCoherentComposition(profile,batch,target);return profile;
}

export function coherentCompositionContacts(profile){
  if(profile===null||!['ai_scene_coherent_composition_v3','ai_scene_coherent_composition_v4','ai_scene_coherent_composition_v5','ai_scene_coherent_composition_v6'].includes(profile.format))return new Map();
  const body=unseal(profile);return new Map(body.contacts.map(row=>[row.instanceId,row]));
}

// Authoring data for a fresh candidate. V1 keeps legacy derived PNGs; V2 binds
// native sampling density separately from world scale. Neither changes a generation request.
export function validateCoherentComposition(profile,batch,target){
  if(profile===null)return new Map();
  const body=unseal(profile),featured=body.format==='ai_scene_coherent_composition_v6',banded=body.format==='ai_scene_coherent_composition_v5'||featured,measured=body.format==='ai_scene_coherent_composition_v4'||banded,joined=measured||body.format==='ai_scene_coherent_composition_v3',sampled=joined||body.format==='ai_scene_coherent_composition_v2';
  exact(body,['format','batchSha256','targetSha256','transforms',...(Object.hasOwn(body,'layerOrder')?['layerOrder']:[]),...(sampled?['sourceSampling']:[]),...(joined?['terrainGeometry','terrainMaterial','contacts']:[]),...(measured?['surfaceMapping']:[]),...(banded?['bandPlacements']:[]),...(featured?['referenceStructure','featureMeasurements',...(Object.hasOwn(body,'featureCorrection')?['featureCorrection']:[]),...(Object.hasOwn(body,'featureSupplement')?['featureSupplement']:[]),...(Object.hasOwn(body,'referenceIntentReview')?['referenceIntentReview']:[]),...(Object.hasOwn(body,'terrainLayout')?['terrainLayout']:[])]:[]),...(Object.hasOwn(body,'surfaceCalibration')?['surfaceCalibration']:[]),...(Object.hasOwn(body,'terrainRendering')?['terrainRendering']:[])]);
  if(Object.hasOwn(body,'terrainRendering')){check(measured,'TERRAIN_RENDERING_MEASURED_REQUIRED');validateTerrainRendering(body.terrainRendering);}
  if(Object.hasOwn(body,'terrainLayout')){
    exact(body.terrainLayout,['terrainRuns','curveTerrains','terrainConnections']);
    const {terrainRuns,curveTerrains,terrainConnections}=body.terrainLayout;
    const cols=Math.ceil(target.mapping.viewport.width/64),rows=Math.ceil(target.mapping.viewport.height/64);
    check(!body.surfaceCalibration&&body.contacts.length===0
      &&Array.isArray(terrainRuns)&&Array.isArray(curveTerrains)&&Array.isArray(terrainConnections)
      &&terrainRuns.length+curveTerrains.length>0&&terrainRuns.length<=cols*rows
      &&terrainRuns.every(run=>run&&[run.x,run.y,run.length].every(Number.isSafeInteger)&&run.x>=0&&run.y>=0
        &&run.y<rows&&run.length>0&&run.x+run.length<=cols),'COHERENT_AUTHORED_TERRAIN_LAYOUT');
  }
  check(!Object.hasOwn(body,'surfaceCalibration')||joined,'COHERENT_CALIBRATION_PROFILE');
  const layoutTarget=calibratedCoherentTarget(target,body.surfaceCalibration);
  check(['ai_scene_coherent_composition_v1','ai_scene_coherent_composition_v2','ai_scene_coherent_composition_v3','ai_scene_coherent_composition_v4','ai_scene_coherent_composition_v5','ai_scene_coherent_composition_v6'].includes(body.format)&&body.batchSha256===batch.sha256&&body.targetSha256===target.sha256,'COHERENT_COMPOSITION_IDENTITY');
  if(sampled)check(body.sourceSampling===COHERENT_SAMPLING,'COHERENT_COMPOSITION_SAMPLING');
  if(joined)check(body.terrainGeometry===COHERENT_TERRAIN_GEOMETRY&&body.terrainMaterial===(measured?COHERENT_MEASURED_TERRAIN_MATERIAL:COHERENT_TERRAIN_MATERIAL),'COHERENT_COMPOSITION_TERRAIN');
  if(measured){
    unseal(target);validateMeasuredSurfaceMapping(body.surfaceMapping);
    const mapping=body.surfaceMapping;
    check(mapping.targetSha256===target.sha256&&mapping.reference.sha256===target.rawSha256
      &&digest(mapping.targetMapping)===digest(target.mapping)
      &&digest(mapping.reference.pixelSize)===digest(target.mapping.nativeSize)
      &&mapping.observations.referenceSurfaceSamples.every(sample=>target.surfaces?.some(surface=>surface.surfaceId===sample.surfaceId)),
    'COHERENT_COMPOSITION_SURFACE_MAPPING');
  }
  check(Array.isArray(body.transforms)&&body.transforms.length>=(sampled?0:1)&&body.transforms.length<=24,'COHERENT_COMPOSITION_TRANSFORMS');
  if(Object.hasOwn(body,'layerOrder'))check(Array.isArray(body.layerOrder)&&body.layerOrder.length===target.layers.length
    &&new Set(body.layerOrder).size===target.layers.length&&target.layers.every(l=>body.layerOrder.includes(l.layerId)),'COHERENT_COMPOSITION_LAYERS');
  const rows=new Map();
  for(const row of body.transforms){
    exact(row,['instanceId','x','y','scale','tint','opacity']);exact(row.scale,['numerator','denominator']);
    const instance=target.instances.find(i=>i.instanceId===row.instanceId);
    check(instance&&!['ground','solid-terrain','platform','solid-platform'].includes(instance.role)&&!rows.has(row.instanceId),'COHERENT_COMPOSITION_INSTANCE');
    check([row.x,row.y].every(v=>Number.isInteger(v)&&Math.abs(v)<=4096)
      &&[row.scale.numerator,row.scale.denominator].every(v=>Number.isInteger(v)&&v>=1&&v<=16)
      &&row.scale.numerator/row.scale.denominator>=.25&&row.scale.numerator/row.scale.denominator<=4
      &&Number.isInteger(row.tint)&&row.tint>=0&&row.tint<=0xffffff
      &&Number.isFinite(row.opacity)&&row.opacity>=.1&&row.opacity<=1,'COHERENT_COMPOSITION_VALUE');
    check(instance.role!=='sky'||row.opacity===1&&row.tint===0xffffff,'COHERENT_COMPOSITION_BACKGROUND');
    rows.set(row.instanceId,row);
  }
  if(joined)validateCoherentContacts(body.contacts,layoutTarget,rows);
  if(featured){const v=resolveReferenceFeatureTargets(body.referenceStructure,body.featureCorrection,body.featureSupplement);
    check(v.referenceRawSha256===target.rawSha256&&digest(v.viewport)===digest(target.mapping.viewport)&&Array.isArray(body.featureMeasurements),'REFERENCE_STRUCTURE_TARGET');
    for(const a of v.assets){const instance=target.instances.find(i=>i.instanceId===a.instanceId);
      check(instance&&instance.subjectId===a.subjectId&&['scenery','landmark','foreground','backdrop','valley'].includes(instance.role),'REFERENCE_STRUCTURE_ASSET');
      check(!rows.has(a.instanceId)&&!body.contacts.some(c=>c.instanceId===a.instanceId),'REFERENCE_FEATURE_PLACEMENT_CONFLICT');}
  }
  if(banded){
    check(Array.isArray(body.bandPlacements)&&body.bandPlacements.length>=(featured?0:1)&&body.bandPlacements.length<=24,'BACKGROUND_BAND_PLACEMENTS');const seen=new Set();
    for(const row of body.bandPlacements){validateBackgroundBandPlacementShape(row);const instance=target.instances.find(i=>i.instanceId===row.instanceId);
      check(instance&&['backdrop','valley'].includes(instance.role)&&!seen.has(row.instanceId)&&batch.planSha256s.includes(row.sourcePlanSha256),'BACKGROUND_BAND_PLACEMENT_BINDING');seen.add(row.instanceId);
      check(!rows.has(row.instanceId)&&!body.contacts.some(c=>c.instanceId===row.instanceId),'BACKGROUND_BAND_PLACEMENT_CONFLICT');}
  }
  return rows;
}
export function coherentDisplayPlacement(row,module,viewport){
  const x=Math.max(0,Math.min(viewport.width-1,row.x)),y=Math.max(0,Math.min(viewport.height-1,row.y));
  module.visualOffset={x:row.x-x,y:row.y-y};module.renderStyle={scale:{...row.scale},tint:row.tint,opacity:row.opacity};
  return {x,y};
}
