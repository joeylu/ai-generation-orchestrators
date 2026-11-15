import {validateScopeTerrainIntent,validateTerrainIntent,terrainIntentPrompt} from '../terrain-intent.mjs';
import {canonicalJson} from '../document.mjs';
import {SOURCE_CONTENT_PROFILE,MATERIAL_SAMPLING_CONTENT_PROFILE,MATERIAL_SAMPLING_CONTENT_INSTRUCTION,REGISTERED_BAND_CONTENT_PROFILE,REGISTERED_BAND_REGISTRATION_PROFILE,validateSourceContent,sourceContentInstruction,SOURCE_GROUP_INSTRUCTION} from './source-content.mjs';
import {check,exact,id,text,seal,unseal,digest} from './common.mjs';
import {validateVisualCoherence,visualCoherencePrompt,ENGINEERED_CITY_FAMILY} from './visual-coherence.mjs';
import {SOURCE_VISUAL_GUIDE_PROFILE,SOURCE_VISUAL_GUIDE_INSTRUCTION,sourceVisualGuide} from './source-visual-guide.mjs';
import {SCOPE_OWNED_GROUNDING_PROFILE,SCOPE_OWNED_GROUNDING_INSTRUCTION,validateScopeOwnedGrounding} from './scope-owned-grounding.mjs';
import {validateBackgroundBand,backgroundBandCoverage,backgroundBandPrompt} from './background-band.mjs';
import {backgroundBandGuide,BACKGROUND_BAND_GUIDE_IMAGE_ROLE,BACKGROUND_BAND_GUIDE_INSTRUCTION} from './background-band-guide.mjs';
import {backgroundBandCoverageGuide,BACKGROUND_BAND_COVERAGE_GUIDE_IMAGE_ROLE,BACKGROUND_BAND_COVERAGE_GUIDE_INSTRUCTION} from './background-band-coverage-guide.mjs';
import {backgroundBandOpenDepthGuide,BACKGROUND_BAND_OPEN_DEPTH_GUIDE_IMAGE_ROLE,BACKGROUND_BAND_OPEN_DEPTH_GUIDE_INSTRUCTION} from './background-band-open-depth-guide.mjs';
import {backgroundBandOpenTrenchGuide,BACKGROUND_BAND_OPEN_TRENCH_GUIDE_IMAGE_ROLE,BACKGROUND_BAND_OPEN_TRENCH_GUIDE_INSTRUCTION} from './background-band-open-trench-guide.mjs';
import {backgroundBandIrregularValleyGuide,BACKGROUND_BAND_IRREGULAR_VALLEY_GUIDE_IMAGE_ROLE,BACKGROUND_BAND_IRREGULAR_VALLEY_GUIDE_INSTRUCTION} from './background-band-irregular-valley-guide.mjs';
import {COMPLETE_SOURCE_FRAMING_PROFILE,COMPLETE_SOURCE_FRAMING_INSTRUCTION,validateSourceFraming} from './source-framing.mjs';
export {COMPLETE_SOURCE_FRAMING_PROFILE} from './source-framing.mjs';
import {SOURCE_APPEARANCE_PROFILE,validateSourceAppearance,sourceAppearancePrompt} from './source-appearance.mjs';
import {validateBandFeatureRelations,bandFeatureRelationsPrompt} from './band-feature-relations.mjs';
import {bandCompositionGuide,validateBandCompositionGuideConfiguration,isReferenceWindowGuide,isFeatureMarkersGuide,BAND_REFERENCE_WINDOW_GUIDE_IMAGE_ROLE,BAND_COMPOSITION_GUIDE_IMAGE_ROLE} from './band-composition-guide.mjs';
import {validateReferenceStructure,resolveReferenceFeatureTargets,referenceStructurePrompt} from '../reference-feature-layout.mjs';
import {sourceFrameGuide,validateSourceFrameGuideConfiguration,SOURCE_FRAME_GUIDE_INSTRUCTION} from './source-frame-guide.mjs';
import {isRegisteredMasterSpec,isRegisteredLocalEdit,registeredMasterInputRole,registeredMasterEditPlan} from './registered-layout-master.mjs';
export {BACKGROUND_BAND_PROFILE,GUIDED_BACKGROUND_BAND_PROFILE,COVERAGE_BACKGROUND_BAND_PROFILE,OPEN_DEPTH_BACKGROUND_BAND_PROFILE,BACKGROUND_BAND_FINITE_CUTS_PROFILE,validateBackgroundBand,backgroundBandCoverage} from './background-band.mjs';
export {SCOPE_OWNED_GROUNDING_PROFILE} from './scope-owned-grounding.mjs';

export const LAYER_SOURCE_INTENT='isolated-layer-v4';
const BAND_FEATURE_MARKERS_INSTRUCTION='Image 2 is a transparent full-canvas diagram containing only the reviewed, numbered locations of the source-owned features. Keep each feature center within its marked region at the scale implied by the whole canvas. The transparent field around the markers gives no terrain outline or coverage target. Use the single-asset brief for the owned silhouette, openings and continuation. Never paint the markers, labels or a diagram border into the output.';
export const SOURCE_SHADOW_LIGHTING_PROFILE='majority-surfaces-deep-shadow-v1';
export const SOURCE_GUIDED_REFERENCE_ROLE='accepted-scene-style-material-light-direction-temperature-reference';
export const LAYER_SOURCE_POLICY=seal({format:'ai_scene_layer_source_policy_v1',profile:LAYER_SOURCE_INTENT,
  content:'single-subject-brief',layout:'metadata-only-never-prompt-coordinates',reference:'style-material-light-only',
  parentRoles:['background','far','middle','main','foreground'],subjectCounts:'reviewed-instances-not-fixed-template',
  scopeDetection:'human-review-not-automated',alphaCleanupAllowed:false,pixelIdentityRequired:false,automaticRetry:false});
const roleOf=role=>role==='solid-terrain'?'ground':role==='solid-platform'?'platform':role;
const parents={sky:'background',backdrop:'far',landmark:'far',scenery:'middle',valley:'far',ground:'main',platform:'main',foreground:'foreground'};
const exclusions={
  sky:['Mountains, landforms or terrain','Architecture, vegetation and foreground framing'],
  backdrop:['Painted sky or horizon backdrop','Playable ground or floating platforms','Neighboring landmark architecture and near-camera framing'],
  landmark:['Main playable terrain and floating platforms','Independent foreground framing','Neighboring scenery groups'],
  scenery:['Main terrain walls or continuous playable ledges','Floating platforms','Sky and neighboring landmark buildings'],
  valley:['Main playable ground or platform surfaces','Near-camera framing decorations','Water unless this subject explicitly calls for water'],
  ground:['Sky and environmental scenery','Independent platform silhouettes or terrain islands','Holes, scene layouts, atlases or comparison panels'],
  platform:['Main terrain walls or neighboring platforms','Pillars, legs and scenery','Receding walkable top planes'],
  foreground:['Main supporting cliff wall or backing terrain slab','Continuous walkable ledge or elevated platform cap','Neighboring sky, mountains, architecture and middle scenery'],
};
const instructions={
  material:'Opaque continuous terrain MATERIAL FIELD only. The upper one-eighth is one uninterrupted thin surface lip; below it is solid material filling the canvas. This is not terrain geometry or a scene.',
  sky:'Opaque sky/atmosphere background only, filling the complete landscape canvas.',
  backdrop:'One isolated distant landform group, retaining atmospheric low contrast. Open areas outside the requested landforms are transparent, not painted sky.',
  landmark:'One isolated distant landmark, including ONLY its own attached foundation or supporting rock if requested. Its local support belongs to this asset; the main playable cliff does not.',
  scenery:'One isolated environmental group with its own small attached bases. Keep the stated vegetation or architecture identity without copying the surrounding scene.',
  valley:'One isolated valley-depth vista appropriate to this subject. A dry valley stays dry; add water only when requested. This is distant depth scenery, not playable ground.',
  platform:'One complete solid floating platform in flat side elevation: thin horizontal cap and a shallow frontal underside, with no receding top plane.',
  foreground:'One standalone near-camera decorative group, not a terrain cross-section. Individual rounded rock surfaces are allowed; a main cliff, backing slab or continuous playable platform is a wrong source.',
};
const engineeredInstructions={
  material:'Opaque continuous engineered MATERIAL FIELD only. The upper one-eighth is one uninterrupted thin wearing surface with its attached manufactured fascia; below is the supported concrete or metal-panel body filling the canvas. This is not deck geometry or a scene.',
  sky:'Opaque city sky/atmosphere background only, filling the complete landscape canvas. Preserve the requested night-time value range without making an empty black canvas.',
  backdrop:'One isolated distant city-building group with restrained atmospheric contrast and bounded window accents. Open areas outside the requested buildings are transparent, with no painted sky or rear-street layer.',
  landmark:'One isolated architectural landmark, including ONLY its own attached structural footing or mounting base when requested. Its local support belongs to this asset; the host playable service deck and surrounding buildings do not.',
  scenery:'One isolated environmental service-fixture or utility group, with only its own compact mounts and complete attachment points. Keep the specified equipment identity without copying the surrounding architecture.',
  valley:'One isolated rear-city depth group appropriate to this subject: building facades, service infrastructure or other explicitly requested rear environment. This is distant depth scenery, not the playable deck or a receding traversable road.',
  platform:'One complete closed-body maintenance platform in flat side elevation: thin horizontal wearing surface, manufactured edge fascia and shallow frontal underside. Include a compact attached lift mechanism only when explicitly requested. No pillars, legs, receding walkable plane or open lattice is inferred.',
  foreground:'One standalone near-camera municipal or industrial fixture group, with only its own compact bases and complete connections. It is neither a backing facade slab nor a continuous playable deck. Emissive parts and their bounded painted spill belong to this fixture only.',
};

function checkedExclusions(values){check(Array.isArray(values)&&values.length<=16,'LAYER_SCOPE_EXCLUSIONS');values.forEach(v=>text(v,{limit:200}));check(new Set(values).size===values.length,'LAYER_SCOPE_EXCLUSIONS');return values;}
function validateFrameGuide(row){
  if(!Object.hasOwn(row,'sourceFrameGuide'))return;
  check(row.referenceStructure&&!['backgroundBand','bandCompositionGuide','visualGuideProfile','lightingProfile'].some(k=>Object.hasOwn(row,k)),'SOURCE_FRAME_GUIDE_SCOPE');
  exact(row.sourceFrameGuide,['spec','decision']);
  check(row.framingProfile===COMPLETE_SOURCE_FRAMING_PROFILE,'SOURCE_FRAME_GUIDE_FRAMING');
  validateSourceFrameGuideConfiguration({...row.sourceFrameGuide,structure:row.referenceStructure,correction:row.featureCorrection,supplement:row.featureSupplement,role:row.role});
}
function validateSourceGuide(row){
  check(row.role==='foreground'&&row.parentRole==='foreground','SOURCE_VISUAL_GUIDE_ROLE');
  check(row.lightingProfile===SOURCE_SHADOW_LIGHTING_PROFILE&&row.visualGuideProfile===SOURCE_VISUAL_GUIDE_PROFILE,'SOURCE_VISUAL_GUIDE_PROFILE');
}
function validateCompositionRelations(guide,relations){
  validateBandFeatureRelations(relations);
  const features=guide.spec.features;
  check(guide.spec.referenceRawSha256===relations.referenceRawSha256&&features.length===relations.features.length
    &&features.every(f=>relations.features.some(r=>r.featureId===f.featureId&&r.description===f.description)),'BAND_COMPOSITION_RELATIONS');
  // Difference constraints share a synthetic origin, so source-local regions
  // and all requested relative intervals must admit a simultaneous solution.
  const indices=new Map(features.map((f,i)=>[f.featureId,i+1])),n=features.length+1;
  for(const axis of ['x','y']){
    const edges=[];for(const f of features){const i=indices.get(f.featureId),[lo,hi]=f.native[axis];edges.push([0,i,hi],[i,0,-lo]);}
    for(const r of relations.relations)if(r.axis===axis){const a=indices.get(r.from),b=indices.get(r.to);edges.push([a,b,r.max],[b,a,-r.min]);}
    const d=Array(n).fill(0);let changed=false;for(let step=0;step<n;step++){changed=false;for(const [a,b,w] of edges)if(d[b]>d[a]+w+1e-12){d[b]=d[a]+w;changed=true;}if(!changed)break;}
    check(!changed,'BAND_COMPOSITION_RELATIONS_INFEASIBLE');
  }
}
function itemScopeShape(value){
  const appearance=value.format==='ai_scene_layer_source_scope_v6',banded=value.format==='ai_scene_layer_source_scope_v5'||appearance&&Object.hasOwn(value,'backgroundBand'),grounded=value.format==='ai_scene_layer_source_scope_v4'||appearance&&Object.hasOwn(value,'groundingProfile'),guided=value.format==='ai_scene_layer_source_scope_v3'
    ||(grounded||appearance)&&(Object.hasOwn(value,'lightingProfile')||Object.hasOwn(value,'visualGuideProfile')),
    shared=value.format==='ai_scene_layer_source_scope_v2'||['ai_scene_layer_source_scope_v3','ai_scene_layer_source_scope_v4','ai_scene_layer_source_scope_v5','ai_scene_layer_source_scope_v6'].includes(value.format)&&Object.hasOwn(value,'visualCoherence');
  check(['ai_scene_layer_source_scope_v1','ai_scene_layer_source_scope_v2','ai_scene_layer_source_scope_v3','ai_scene_layer_source_scope_v4','ai_scene_layer_source_scope_v5','ai_scene_layer_source_scope_v6'].includes(value.format),'LAYER_SCOPE_BINDING');
  exact(value,['format','policySha256','requirementsSha256','subjectIds','role','layerId','parentRole','content','exclusions','contentOrigin',
    ...(shared?['visualCoherence']:[]),...(guided?['lightingProfile','visualGuideProfile']:[]),...(grounded?['groundingProfile']:[]),...(banded?['backgroundBand']:[]),...(appearance?['sourceAppearance']:[]),...(Object.hasOwn(value,'bandFeatureRelations')?['bandFeatureRelations']:[]),...(Object.hasOwn(value,'bandCompositionGuide')?['bandCompositionGuide']:[]),...(Object.hasOwn(value,'referenceStructure')?['referenceStructure']:[]),...(Object.hasOwn(value,'featureCorrection')?['featureCorrection']:[]),...(Object.hasOwn(value,'featureSupplement')?['featureSupplement']:[]),...(Object.hasOwn(value,'sourceFrameGuide')?['sourceFrameGuide']:[]),...(Object.hasOwn(value,'contentProfile')?['contentProfile']:[]),...(Object.hasOwn(value,'framingProfile')?['framingProfile']:[]),...(Object.hasOwn(value,'terrainIntent')?['terrainIntent']:[])]);
  validateScopeTerrainIntent(value);
  if(Object.hasOwn(value,'framingProfile'))validateSourceFraming(value);
  validateSourceContent(value);validateFrameGuide(value);
  if(Object.hasOwn(value,'featureCorrection')||Object.hasOwn(value,'featureSupplement')){check(value.referenceStructure,'REFERENCE_FEATURE_CORRECTION_STRUCTURE_REQUIRED');resolveReferenceFeatureTargets(value.referenceStructure,value.featureCorrection,value.featureSupplement);}
  if(Object.hasOwn(value,'referenceStructure')){const v=validateReferenceStructure(value.referenceStructure);check(['landmark','scenery','foreground','backdrop','valley'].includes(value.role)&&v.assets.some(a=>value.subjectIds.includes(a.subjectId)),'REFERENCE_STRUCTURE_ASSET');}
  if(Object.hasOwn(value,'bandCompositionGuide')){check(banded&&Object.hasOwn(value,'bandFeatureRelations'),'BAND_COMPOSITION_BAND_REQUIRED');exact(value.bandCompositionGuide,['spec','decision']);validateBandCompositionGuideConfiguration({band:value.backgroundBand,role:value.role,...value.bandCompositionGuide});validateCompositionRelations(value.bandCompositionGuide,value.bandFeatureRelations);}
  if(Object.hasOwn(value,'bandFeatureRelations')){check(banded,'BAND_RELATIONS_BAND_REQUIRED');validateBandFeatureRelations(value.bandFeatureRelations);}
  if(appearance)validateSourceAppearance(value.sourceAppearance);
  check(!appearance||!banded||!guided&&!grounded,'BACKGROUND_BAND_ROLE');
  if(guided)validateSourceGuide(value);
  if(grounded)validateScopeOwnedGrounding(value);
  if(banded)validateBackgroundBand(value.backgroundBand,{role:value.role});
  return {grounded,guided,shared,banded,appearance};
}
export function createLayerSourceScopes(requirements,overrides=[],visualCoherence=null){
  unseal(requirements);check(Array.isArray(overrides)&&overrides.length<=24,'LAYER_SCOPE_OVERRIDES');const byId=new Map();
  for(const row of overrides){exact(row,['subjectId','content','exclusions','parentRole',...(Object.hasOwn(row,'backgroundBand')?['backgroundBand']:[]),...(Object.hasOwn(row,'sourceAppearance')?['sourceAppearance']:[]),...(Object.hasOwn(row,'groundingProfile')?['groundingProfile']:[]),...(Object.hasOwn(row,'bandFeatureRelations')?['bandFeatureRelations']:[]),...(Object.hasOwn(row,'bandCompositionGuide')?['bandCompositionGuide']:[]),...(Object.hasOwn(row,'referenceStructure')?['referenceStructure']:[]),...(Object.hasOwn(row,'featureCorrection')?['featureCorrection']:[]),...(Object.hasOwn(row,'featureSupplement')?['featureSupplement']:[]),...(Object.hasOwn(row,'sourceFrameGuide')?['sourceFrameGuide']:[]),...(Object.hasOwn(row,'contentProfile')?['contentProfile']:[]),...(Object.hasOwn(row,'framingProfile')?['framingProfile']:[]),...(Object.hasOwn(row,'terrainIntent')?['terrainIntent']:[])]);id(row.subjectId);text(row.content,{limit:1200});checkedExclusions(row.exclusions);
    if(row.terrainIntent)validateTerrainIntent(row.terrainIntent);
    validateSourceContent(row);if(Object.hasOwn(row,'sourceAppearance'))validateSourceAppearance(row.sourceAppearance);
    if(Object.hasOwn(row,'groundingProfile'))check(row.groundingProfile===SCOPE_OWNED_GROUNDING_PROFILE,'SCOPE_OWNED_GROUNDING_PROFILE');
    check(!byId.has(row.subjectId)&&LAYER_SOURCE_POLICY.parentRoles.includes(row.parentRole),'LAYER_SCOPE_OVERRIDE');byId.set(row.subjectId,row);}
  const subjects=requirements.subjects.map(subject=>{const role=roleOf(subject.role),override=byId.get(subject.subjectId);check(parents[role],'LAYER_SCOPE_ROLE');byId.delete(subject.subjectId);
    return {subjectId:subject.subjectId,role,layerId:subject.layerId,parentRole:override?.parentRole??parents[role],content:override?.content??subject.content,
      exclusions:[...new Set([...exclusions[role],...override?.exclusions??[]])],contentOrigin:override?'explicit-source-brief':'subject-description',
      ...(override&&Object.hasOwn(override,'backgroundBand')?{backgroundBand:override.backgroundBand}:{}),...(override&&Object.hasOwn(override,'sourceAppearance')?{sourceAppearance:override.sourceAppearance}:{}),...(override&&Object.hasOwn(override,'bandFeatureRelations')?{bandFeatureRelations:override.bandFeatureRelations}:{}),...(override&&Object.hasOwn(override,'bandCompositionGuide')?{bandCompositionGuide:override.bandCompositionGuide}:{}),...(override&&Object.hasOwn(override,'referenceStructure')?{referenceStructure:override.referenceStructure}:{}),...(override&&Object.hasOwn(override,'featureCorrection')?{featureCorrection:override.featureCorrection}:{}),...(override&&Object.hasOwn(override,'featureSupplement')?{featureSupplement:override.featureSupplement}:{}),...(override&&Object.hasOwn(override,'sourceFrameGuide')?{sourceFrameGuide:override.sourceFrameGuide}:{}),...(override&&Object.hasOwn(override,'contentProfile')?{contentProfile:override.contentProfile}:{}),...(override&&Object.hasOwn(override,'framingProfile')?{framingProfile:override.framingProfile}:{}),...(override&&Object.hasOwn(override,'terrainIntent')?{terrainIntent:override.terrainIntent}:{})};});
  check(byId.size===0,'LAYER_SCOPE_UNKNOWN_SUBJECT');const result=seal({format:subjects.some(s=>Object.hasOwn(s,'sourceAppearance'))?'ai_scene_layer_source_scopes_v6':subjects.some(s=>Object.hasOwn(s,'backgroundBand'))?'ai_scene_layer_source_scopes_v5':'ai_scene_layer_source_scopes_v1',requirementsSha256:requirements.sha256,policySha256:LAYER_SOURCE_POLICY.sha256,subjects});
  validateLayerSourceScopes(requirements,result);
  const selected=overrides.filter(row=>Object.hasOwn(row,'groundingProfile')).map(row=>row.subjectId),grounded=selected.length?withScopeOwnedGroundingScopes(requirements,result,selected):result;
  return visualCoherence?withVisualCoherenceScopes(requirements,grounded,visualCoherence):grounded;
}
export function withVisualCoherenceScopes(requirements,existingScopes,visualCoherence){
  const value=validateLayerSourceScopes(requirements,existingScopes);validateVisualCoherence(visualCoherence,{requirements});
  return seal({...value,format:['ai_scene_layer_source_scopes_v3','ai_scene_layer_source_scopes_v4','ai_scene_layer_source_scopes_v5','ai_scene_layer_source_scopes_v6'].includes(value.format)?value.format:'ai_scene_layer_source_scopes_v2',visualCoherence});
}
// An explicit source-only guide never changes the default scope or reference.
export function withSourceVisualGuideScopes(requirements,existingScopes,subjectIds){
  const value=validateLayerSourceScopes(requirements,existingScopes);
  check(Array.isArray(subjectIds)&&subjectIds.length>0&&subjectIds.length<=24&&new Set(subjectIds).size===subjectIds.length,'SOURCE_VISUAL_GUIDE_SUBJECTS');
  const remaining=new Set(subjectIds);subjectIds.forEach(id);
  const subjects=value.subjects.map(row=>{if(!remaining.delete(row.subjectId))return row;
    const next={...row,lightingProfile:SOURCE_SHADOW_LIGHTING_PROFILE,visualGuideProfile:SOURCE_VISUAL_GUIDE_PROFILE};validateSourceGuide(next);return next;});
  check(remaining.size===0,'SOURCE_VISUAL_GUIDE_SUBJECTS');
  const result=seal({...value,format:['ai_scene_layer_source_scopes_v4','ai_scene_layer_source_scopes_v5','ai_scene_layer_source_scopes_v6'].includes(value.format)?value.format:'ai_scene_layer_source_scopes_v3',subjects});validateLayerSourceScopes(requirements,result);return result;
}
export function withSourceVisualGuide(existingScope){
  const value=unseal(existingScope),{grounded,appearance}=itemScopeShape(value);
  const next={...value,format:appearance?'ai_scene_layer_source_scope_v6':grounded?'ai_scene_layer_source_scope_v4':'ai_scene_layer_source_scope_v3',lightingProfile:SOURCE_SHADOW_LIGHTING_PROFILE,visualGuideProfile:SOURCE_VISUAL_GUIDE_PROFILE};
  validateSourceGuide(next);return seal(next);
}
// Explicit ownership changes only selected sources; old scopes remain byte-identical.
export function withScopeOwnedGrounding(existingScope){
  const value=unseal(existingScope);itemScopeShape(value);
  const next={...value,format:value.format==='ai_scene_layer_source_scope_v6'?value.format:'ai_scene_layer_source_scope_v4',groundingProfile:SCOPE_OWNED_GROUNDING_PROFILE};
  validateScopeOwnedGrounding(next);return seal(next);
}
export function withScopeOwnedGroundingScopes(requirements,existingScopes,subjectIds){
  const value=validateLayerSourceScopes(requirements,existingScopes);
  check(Array.isArray(subjectIds)&&subjectIds.length>0&&subjectIds.length<=24&&new Set(subjectIds).size===subjectIds.length,'SCOPE_OWNED_GROUNDING_SUBJECTS');
  const remaining=new Set(subjectIds);subjectIds.forEach(id);
  const subjects=value.subjects.map(row=>{if(!remaining.delete(row.subjectId))return row;
    const next={...row,groundingProfile:SCOPE_OWNED_GROUNDING_PROFILE};validateScopeOwnedGrounding(next);return next;});
  check(remaining.size===0,'SCOPE_OWNED_GROUNDING_SUBJECTS');
  const result=seal({...value,format:['ai_scene_layer_source_scopes_v5','ai_scene_layer_source_scopes_v6'].includes(value.format)?value.format:'ai_scene_layer_source_scopes_v4',subjects});validateLayerSourceScopes(requirements,result);return result;
}
export function withBackgroundBand(existingScope,backgroundBand){
  const value=unseal(existingScope);itemScopeShape(value);
  const next={...value,format:value.format==='ai_scene_layer_source_scope_v6'?value.format:'ai_scene_layer_source_scope_v5',backgroundBand};itemScopeShape(next);return seal(next);
}
export function withBackgroundBandScopes(requirements,existingScopes,assignments){
  const value=validateLayerSourceScopes(requirements,existingScopes),remaining=new Map();
  check(Array.isArray(assignments)&&assignments.length>0&&assignments.length<=24,'BACKGROUND_BAND_SUBJECTS');
  for(const row of assignments){exact(row,['subjectId','backgroundBand']);id(row.subjectId);check(!remaining.has(row.subjectId),'BACKGROUND_BAND_SUBJECTS');remaining.set(row.subjectId,row.backgroundBand);}
  const subjects=value.subjects.map(row=>{if(!remaining.has(row.subjectId))return row;const backgroundBand=remaining.get(row.subjectId);remaining.delete(row.subjectId);return {...row,backgroundBand};});
  check(!remaining.size,'BACKGROUND_BAND_SUBJECTS');const result=seal({...value,format:value.format==='ai_scene_layer_source_scopes_v6'?value.format:'ai_scene_layer_source_scopes_v5',subjects});validateLayerSourceScopes(requirements,result);return result;
}
export function withSourceAppearance(existingScope,sourceAppearance){
  const value=unseal(existingScope);itemScopeShape(value);validateSourceAppearance(sourceAppearance);
  const next={...value,format:'ai_scene_layer_source_scope_v6',sourceAppearance};itemScopeShape(next);return seal(next);
}
export function withSourceFraming(existingScope,framingProfile=COMPLETE_SOURCE_FRAMING_PROFILE){
  const value=unseal(existingScope);itemScopeShape(value);
  const next={...value,framingProfile};itemScopeShape(next);return seal(next);
}
export function withReferenceFeatureSupplement(existingScope,featureSupplement){
  const value=unseal(existingScope);itemScopeShape(value);const next={...value,featureSupplement};itemScopeShape(next);return seal(next);
}
export function withReferenceFeatureCorrection(existingScope,featureCorrection){
  const value=unseal(existingScope);itemScopeShape(value);
  const next={...value,featureCorrection};itemScopeShape(next);return seal(next);
}
export function withSourceFrameGuide(existingScope,sourceFrameGuide){
  const value=unseal(existingScope);itemScopeShape(value);
  const next={...value,sourceFrameGuide};itemScopeShape(next);return seal(next);
}
export function withReferenceStructure(existingScope,referenceStructure){
  const value=unseal(existingScope);itemScopeShape(value);validateReferenceStructure(referenceStructure);
  const next={...value,referenceStructure};itemScopeShape(next);return seal(next);
}
// Add only to a fresh/revised band scope; it never edits an existing plan.
export function withBandFeatureRelations(existingScope,bandFeatureRelations){
  const value=unseal(existingScope);itemScopeShape(value);check(value.backgroundBand,'BAND_RELATIONS_BAND_REQUIRED');
  validateBandFeatureRelations(bandFeatureRelations);const next={...value,bandFeatureRelations};itemScopeShape(next);return seal(next);
}
export function withSourceAppearanceScopes(requirements,existingScopes,assignments){
  const value=validateLayerSourceScopes(requirements,existingScopes),remaining=new Map();
  check(Array.isArray(assignments)&&assignments.length>0&&assignments.length<=24,'SOURCE_APPEARANCE_SUBJECTS');
  for(const row of assignments){exact(row,['subjectId','sourceAppearance']);id(row.subjectId);validateSourceAppearance(row.sourceAppearance);check(!remaining.has(row.subjectId),'SOURCE_APPEARANCE_SUBJECTS');remaining.set(row.subjectId,row.sourceAppearance);}
  const subjects=value.subjects.map(row=>{if(!remaining.has(row.subjectId))return row;const sourceAppearance=remaining.get(row.subjectId);remaining.delete(row.subjectId);return {...row,sourceAppearance};});
  check(!remaining.size,'SOURCE_APPEARANCE_SUBJECTS');const result=seal({...value,format:'ai_scene_layer_source_scopes_v6',subjects});validateLayerSourceScopes(requirements,result);return result;
}
export function validateLayerSourceScopes(requirements,record){
  unseal(requirements);const value=unseal(record),appearance=value.format==='ai_scene_layer_source_scopes_v6',banded=value.format==='ai_scene_layer_source_scopes_v5'||appearance,grounded=value.format==='ai_scene_layer_source_scopes_v4'||banded,guided=value.format==='ai_scene_layer_source_scopes_v3'||grounded,shared=value.format==='ai_scene_layer_source_scopes_v2'||guided&&Object.hasOwn(value,'visualCoherence');exact(value,['format','requirementsSha256','policySha256','subjects',...(shared?['visualCoherence']:[])]);
  check(['ai_scene_layer_source_scopes_v1','ai_scene_layer_source_scopes_v2','ai_scene_layer_source_scopes_v3','ai_scene_layer_source_scopes_v4','ai_scene_layer_source_scopes_v5','ai_scene_layer_source_scopes_v6'].includes(value.format)&&value.requirementsSha256===requirements.sha256&&value.policySha256===LAYER_SOURCE_POLICY.sha256,'LAYER_SCOPE_BINDING');
  if(shared)validateVisualCoherence(value.visualCoherence,{requirements});
  check(Array.isArray(value.subjects)&&value.subjects.length===requirements.subjects.length,'LAYER_SCOPE_COVERAGE');const seen=new Set();
  let guideCount=0,groundingCount=0,bandCount=0,appearanceCount=0;
  for(const row of value.subjects){const usesGuide=guided&&(Object.hasOwn(row,'lightingProfile')||Object.hasOwn(row,'visualGuideProfile'));
    const usesGrounding=grounded&&Object.hasOwn(row,'groundingProfile'),usesBand=banded&&Object.hasOwn(row,'backgroundBand'),usesAppearance=appearance&&Object.hasOwn(row,'sourceAppearance');
    const usesRelations=Object.hasOwn(row,'bandFeatureRelations'),usesComposition=Object.hasOwn(row,'bandCompositionGuide');
    exact(row,['subjectId','role','layerId','parentRole','content','exclusions','contentOrigin',...(usesGuide?['lightingProfile','visualGuideProfile']:[]),...(usesGrounding?['groundingProfile']:[]),...(usesBand?['backgroundBand']:[]),...(usesAppearance?['sourceAppearance']:[]),...(usesRelations?['bandFeatureRelations']:[]),...(usesComposition?['bandCompositionGuide']:[]),...(Object.hasOwn(row,'referenceStructure')?['referenceStructure']:[]),...(Object.hasOwn(row,'featureCorrection')?['featureCorrection']:[]),...(Object.hasOwn(row,'featureSupplement')?['featureSupplement']:[]),...(Object.hasOwn(row,'sourceFrameGuide')?['sourceFrameGuide']:[]),...(Object.hasOwn(row,'contentProfile')?['contentProfile']:[]),...(Object.hasOwn(row,'framingProfile')?['framingProfile']:[]),...(Object.hasOwn(row,'terrainIntent')?['terrainIntent']:[])]);const subject=requirements.subjects.find(s=>s.subjectId===row.subjectId);
    validateScopeTerrainIntent(row);
    if(Object.hasOwn(row,'framingProfile'))validateSourceFraming(row);
    validateSourceContent(row);validateFrameGuide(row);
    if(Object.hasOwn(row,'featureCorrection')||Object.hasOwn(row,'featureSupplement')){check(row.referenceStructure,'REFERENCE_FEATURE_CORRECTION_STRUCTURE_REQUIRED');resolveReferenceFeatureTargets(row.referenceStructure,row.featureCorrection,row.featureSupplement);}
    if(Object.hasOwn(row,'referenceStructure')){const v=validateReferenceStructure(row.referenceStructure);check(['landmark','scenery','foreground','backdrop','valley'].includes(row.role)&&v.assets.some(a=>a.subjectId===row.subjectId),'REFERENCE_STRUCTURE_ASSET');}
    if(usesComposition){check(usesBand&&usesRelations&&row.contentOrigin==='explicit-source-brief','BAND_COMPOSITION_BAND_REQUIRED');exact(row.bandCompositionGuide,['spec','decision']);validateBandCompositionGuideConfiguration({band:row.backgroundBand,role:row.role,...row.bandCompositionGuide});validateCompositionRelations(row.bandCompositionGuide,row.bandFeatureRelations);}
    if(usesRelations){check(usesBand&&row.contentOrigin==='explicit-source-brief','BAND_RELATIONS_BAND_REQUIRED');validateBandFeatureRelations(row.bandFeatureRelations);}
    check(subject&&!seen.has(row.subjectId)&&row.role===roleOf(subject.role)&&row.layerId===subject.layerId,'LAYER_SCOPE_COVERAGE');seen.add(row.subjectId);
    text(row.content,{limit:1200});checkedExclusions(row.exclusions);check(exclusions[row.role].every(v=>row.exclusions.includes(v)),'LAYER_SCOPE_REQUIRED_EXCLUSIONS');
    check(LAYER_SOURCE_POLICY.parentRoles.includes(row.parentRole)&&['explicit-source-brief','subject-description'].includes(row.contentOrigin),'LAYER_SCOPE_BINDING');
    if(row.contentOrigin==='subject-description')check(row.content===subject.content,'LAYER_SCOPE_CONTENT_ORIGIN');
    if(['ground','platform'].includes(row.role))check(row.parentRole==='main','LAYER_SCOPE_PARENT');
    if(row.role==='sky')check(row.parentRole==='background','LAYER_SCOPE_PARENT');
    if(row.role==='foreground')check(row.parentRole==='foreground','LAYER_SCOPE_PARENT');
    if(usesGuide){validateSourceGuide(row);guideCount++;}
    if(usesGrounding){validateScopeOwnedGrounding(row);groundingCount++;}
    if(usesBand){check(!usesGuide&&!usesGrounding,'BACKGROUND_BAND_ROLE');validateBackgroundBand(row.backgroundBand,{role:row.role,layerId:row.layerId,requirements});bandCount++;}
    if(usesAppearance){validateSourceAppearance(row.sourceAppearance);appearanceCount++;}
  }check(value.format!=='ai_scene_layer_source_scopes_v3'||guideCount>0,'SOURCE_VISUAL_GUIDE_SUBJECTS');
  check(value.format!=='ai_scene_layer_source_scopes_v4'||groundingCount>0,'SCOPE_OWNED_GROUNDING_SUBJECTS');check(value.format!=='ai_scene_layer_source_scopes_v5'||bandCount>0,'BACKGROUND_BAND_SUBJECTS');check(!appearance||appearanceCount>0,'SOURCE_APPEARANCE_SUBJECTS');return value;
}
export function scopeForCoherentItem(requirements,record,item){
  const set=validateLayerSourceScopes(requirements,record),rows=item.role==='material'?set.subjects.filter(s=>s.role==='ground'):set.subjects.filter(s=>s.subjectId===item.instance.subjectId);
  check(rows.length>0,'LAYER_SCOPE_COVERAGE');const origins=new Set(rows.map(r=>r.contentOrigin));
  const guided=Object.hasOwn(rows[0],'visualGuideProfile'),grounded=Object.hasOwn(rows[0],'groundingProfile'),banded=Object.hasOwn(rows[0],'backgroundBand'),appearance=Object.hasOwn(rows[0],'sourceAppearance');
  if(rows.some(row=>Object.hasOwn(row,'terrainIntent')))check(rows.every(row=>Object.hasOwn(row,'terrainIntent')&&digest(row.terrainIntent)===digest(rows[0].terrainIntent)),'TERRAIN_INTENT_MATERIAL_AMBIGUOUS');
  if(rows.some(row=>Object.hasOwn(row,'contentProfile')))check(rows.every(row=>row.contentProfile===rows[0].contentProfile),'SOURCE_CONTENT_MATERIAL_AMBIGUOUS');
  if(rows.some(row=>Object.hasOwn(row,'sourceAppearance')))check(rows.every(row=>Object.hasOwn(row,'sourceAppearance')&&digest(row.sourceAppearance)===digest(rows[0].sourceAppearance)),'SOURCE_APPEARANCE_MATERIAL_AMBIGUOUS');
  return seal({format:appearance?'ai_scene_layer_source_scope_v6':banded?'ai_scene_layer_source_scope_v5':grounded?'ai_scene_layer_source_scope_v4':guided?'ai_scene_layer_source_scope_v3':set.visualCoherence?'ai_scene_layer_source_scope_v2':'ai_scene_layer_source_scope_v1',policySha256:LAYER_SOURCE_POLICY.sha256,requirementsSha256:requirements.sha256,
    subjectIds:rows.map(r=>r.subjectId).sort(),role:item.role,layerId:rows[0].layerId,parentRole:rows[0].parentRole,
    content:rows.map(r=>r.content).join('\n'),exclusions:[...new Set(rows.flatMap(r=>r.exclusions))],
    contentOrigin:origins.size===1?[...origins][0]:'mixed-source-briefs',...(set.visualCoherence?{visualCoherence:set.visualCoherence}:{}),
    ...(guided?{lightingProfile:rows[0].lightingProfile,visualGuideProfile:rows[0].visualGuideProfile}:{}),
    ...(grounded?{groundingProfile:rows[0].groundingProfile}:{}),...(banded?{backgroundBand:rows[0].backgroundBand}:{}),...(appearance?{sourceAppearance:rows[0].sourceAppearance}:{}),...(Object.hasOwn(rows[0],'bandFeatureRelations')?{bandFeatureRelations:rows[0].bandFeatureRelations}:{}),...(Object.hasOwn(rows[0],'bandCompositionGuide')?{bandCompositionGuide:rows[0].bandCompositionGuide}:{}),...(rows[0].referenceStructure?{referenceStructure:rows[0].referenceStructure}:{}),...(Object.hasOwn(rows[0],'featureCorrection')?{featureCorrection:rows[0].featureCorrection}:{}),...(Object.hasOwn(rows[0],'featureSupplement')?{featureSupplement:rows[0].featureSupplement}:{}),...(Object.hasOwn(rows[0],'sourceFrameGuide')?{sourceFrameGuide:rows[0].sourceFrameGuide}:{}),...(Object.hasOwn(rows[0],'contentProfile')?{contentProfile:rows[0].contentProfile}:{}),...(Object.hasOwn(rows[0],'framingProfile')?{framingProfile:rows[0].framingProfile}:{}),...(Object.hasOwn(rows[0],'terrainIntent')?{terrainIntent:rows[0].terrainIntent}:{})});
}
function validateItemScope(spec,item,record){
  const scope=unseal(record),{guided,shared}=itemScopeShape(scope);
  const subjects=item.role==='material'?spec.requirements.subjects.filter(s=>roleOf(s.role)==='ground'):spec.requirements.subjects.filter(s=>s.subjectId===item.instance.subjectId);
  check(scope.policySha256===LAYER_SOURCE_POLICY.sha256&&scope.requirementsSha256===spec.requirements.sha256
    &&scope.role===item.role&&scope.layerId===subjects[0]?.layerId&&digest(scope.subjectIds)===digest(subjects.map(s=>s.subjectId).sort()),'LAYER_SCOPE_BINDING');
  if(shared)validateVisualCoherence(scope.visualCoherence,{requirements:spec.requirements});
  text(scope.content,{limit:28800});checkedExclusions(scope.exclusions);
  const role=item.role==='material'?'ground':item.role;check(exclusions[role].every(v=>scope.exclusions.includes(v)),'LAYER_SCOPE_REQUIRED_EXCLUSIONS');
  check(LAYER_SOURCE_POLICY.parentRoles.includes(scope.parentRole)&&['explicit-source-brief','subject-description','mixed-source-briefs'].includes(scope.contentOrigin),'LAYER_SCOPE_BINDING');
  if(['material','platform'].includes(item.role))check(scope.parentRole==='main','LAYER_SCOPE_PARENT');
  if(item.role==='sky')check(scope.parentRole==='background','LAYER_SCOPE_PARENT');
  if(item.role==='foreground')check(scope.parentRole==='foreground','LAYER_SCOPE_PARENT');
  if(scope.contentOrigin==='subject-description')check(scope.content===subjects.map(s=>s.content).join('\n'),'LAYER_SCOPE_CONTENT_ORIGIN');
  if(guided)validateSourceGuide(scope);
  if(scope.backgroundBand)validateBackgroundBand(scope.backgroundBand,{role:scope.role,layerId:scope.layerId,requirements:spec.requirements,viewport:spec.viewport});
  return scope;
}
export function compileLayerScopedSource(base,recipe,state,item,readBlob){
  const spec=state.designs.get(recipe.specSha256),style=state.designs.get(recipe.styleSha256),scope=validateItemScope(spec,item,recipe.sourceScope);
  if(scope.referenceStructure){const v=validateReferenceStructure(scope.referenceStructure),a=v.assets.find(a=>a.instanceId===recipe.assetId),target=state.plans.get(recipe.referencePlans[0])?.reconstructionTarget;
    check(a&&a.subjectId===item.instance.subjectId&&v.referenceRawSha256===target?.rawSha256&&digest(v.viewport)===digest(target.mapping.viewport),'REFERENCE_STRUCTURE_TARGET');}
  if(scope.backgroundBand){const target=state.plans.get(recipe.referencePlans[0])?.reconstructionTarget;
    check(target,'BACKGROUND_BAND_REFERENCE_REQUIRED');validateBackgroundBand(scope.backgroundBand,{role:scope.role,layerId:scope.layerId,
      requirements:{layers:target.layers},viewport:target.mapping.viewport});}
  if(scope.bandFeatureRelations)check(scope.bandFeatureRelations.referenceRawSha256===state.plans.get(recipe.referencePlans[0])?.result?.rawSha256,'BAND_RELATIONS_REFERENCE');
  if(scope.bandCompositionGuide){check(scope.bandCompositionGuide.spec.referenceRawSha256===state.plans.get(recipe.referencePlans[0])?.result?.rawSha256,'BAND_COMPOSITION_REFERENCE');if(isReferenceWindowGuide(scope.bandCompositionGuide.spec)||isRegisteredMasterSpec(scope.bandCompositionGuide.spec))check(digest(scope.bandCompositionGuide.spec.referenceViewport)===digest(spec.viewport),'BAND_REFERENCE_WINDOW_VIEWPORT');}
  const featureMarkers=isFeatureMarkersGuide(scope.bandCompositionGuide?.spec);
  if(isReferenceWindowGuide(scope.bandCompositionGuide?.spec)||isRegisteredMasterSpec(scope.bandCompositionGuide?.spec)||featureMarkers){
    const owned=scope.referenceStructure&&resolveReferenceFeatureTargets(scope.referenceStructure,scope.featureCorrection,scope.featureSupplement).assets.find(a=>a.instanceId===recipe.assetId),features=scope.bandCompositionGuide.spec.features;
    check(owned&&owned.features.length===features.length&&features.every(f=>owned.features.some(p=>p.featureId===f.featureId&&p.description===f.description&&['x','y'].every(axis=>f.target[axis][0]<=p.target[axis]&&f.target[axis][1]>=p.target[axis]&&f.target[axis][0]>=p.target[axis]-p.toleranceWorld&&f.target[axis][1]<=p.target[axis]+p.toleranceWorld))),'BAND_REFERENCE_WINDOW_FEATURES');
  }
  if(isRegisteredMasterSpec(scope.bandCompositionGuide?.spec))check(scope.bandCompositionGuide.spec.referenceStructureSha256===scope.referenceStructure?.sha256,'REGISTERED_MASTER_STRUCTURE');
  if(isRegisteredLocalEdit(scope.bandCompositionGuide?.spec)){
    const parent=state.plans.get(recipe.parents?.[0]),master=scope.bandCompositionGuide.spec.master.artifact;
    check(parent?.plan.format==='ai_scene_generation_plan_v27'&&parent.plan.recipe.assetId===recipe.assetId
      &&parent.plan.recipe.targetSha256===recipe.targetSha256&&parent.result?.technical.status==='pass'
      &&parent.plan.recipe.sourceScope?.backgroundBand&&digest(parent.plan.recipe.sourceScope.backgroundBand)===digest(scope.backgroundBand)
      &&parent.result.rawSha256===master.sha256&&digest(parent.result.technical.image)===digest(master),
    'REGISTERED_LOCAL_EDIT_PARENT');
  }
  if(scope.visualCoherence){
    const ref=state.plans.get(recipe.referencePlans[0]);validateVisualCoherence(scope.visualCoherence,{spec,style,target:ref?.reconstructionTarget});
    check(scope.visualCoherence.referenceRawSha256===ref?.result.rawSha256&&scope.visualCoherence.targetSha256===recipe.targetSha256,'VISUAL_COHERENCE_BINDING');
  }
  check(Array.isArray(recipe.parents)&&recipe.parents.length<=1,'PLAN_PARENT');
  if(recipe.parents.length){const parent=state.plans.get(recipe.parents[0]);
    // An unsubmitted v4 plan may be replaced before compute. A status label
    // alone cannot make a reserved/returned attempt eligible for this branch.
    // The new plan is independently frozen; no authorization is copied here.
    const unsubmitted=parent?.plan.format==='ai_scene_generation_plan_v27'&&parent.plan.recipe.intent===LAYER_SOURCE_INTENT
      &&['planned','authorized'].includes(parent.status)&&['attempt','submission','result','terminal'].every(field=>!Object.hasOwn(parent,field));
    check(['ai_scene_generation_plan_v27','ai_scene_coherent_border_preparation_v1','ai_scene_coherent_canvas_gutter_preparation_v1','ai_scene_coherent_canvas_gutter_preparation_v2','ai_scene_coherent_rebind_v1'].includes(parent?.plan.format)
    &&parent.plan.recipe.assetId===recipe.assetId&&parent.plan.recipe.targetSha256===recipe.targetSha256
    &&(['failed','indeterminate','rejected-technical','rejected-visual'].includes(parent.status)
      ||['pending-visual-review','accepted'].includes(parent.status)&&parent.result?.technical.status==='pass'||unsubmitted),'PLAN_PARENT');}
  const opaque=['material','sky'].includes(item.role),s=base.target.sourcePolicy,
    engineered=scope.visualCoherence?.sceneFamily===ENGINEERED_CITY_FAMILY;
  const scopeOwnedRegistration=scope.contentProfile===REGISTERED_BAND_REGISTRATION_PROFILE;
  const registeredBand=scopeOwnedRegistration||scope.contentProfile===REGISTERED_BAND_CONTENT_PROFILE;
  const masterEdit=isRegisteredMasterSpec(scope.bandCompositionGuide?.spec),referenceWindow=isReferenceWindowGuide(scope.bandCompositionGuide?.spec),registeredWindow=registeredBand||scope.bandCompositionGuide?.spec.instructionProfile==='registered-window-extraction-v1';
  const ownedContent=scope.contentProfile===SOURCE_CONTENT_PROFILE;
  const materialSampling=scope.contentProfile===MATERIAL_SAMPLING_CONTENT_PROFILE;
  const ownedFeatureGroup=scope.referenceStructure?.assets.find(a=>a.instanceId===recipe.assetId)?.compositionProfile==='source-owned-feature-group-v1';
  const grounded=scope.groundingProfile===SCOPE_OWNED_GROUNDING_PROFILE,guide=Object.hasOwn(scope,'visualGuideProfile')?sourceVisualGuide(scope.visualGuideProfile):null,band=scope.backgroundBand,
    coverageBand=band?.format==='ai_scene_background_band_v3',openBand=band?.format==='ai_scene_background_band_v4',trenchBand=openBand&&band.guidanceProfile==='open-trench-three-cut-coverage-v2',irregularBand=openBand&&band.guidanceProfile==='open-valley-irregular-coverage-v3',finiteBand=coverageBand||openBand,
    bandGuide=scope.bandCompositionGuide?bandCompositionGuide({band,role:item.role,...scope.bandCompositionGuide,...(referenceWindow?{referenceBytes:readBlob(scope.bandCompositionGuide.spec.referenceRawSha256)}:{}),...(masterEdit?{masterBytes:readBlob(scope.bandCompositionGuide.spec.master.artifact.sha256)}:{})}):irregularBand?backgroundBandIrregularValleyGuide({canvasAspect:band.canvasAspect,coverageBudget:band.coverageBudget,role:item.role}):trenchBand?backgroundBandOpenTrenchGuide({canvasAspect:band.canvasAspect,coverageBudget:band.coverageBudget,role:item.role}):openBand?backgroundBandOpenDepthGuide({canvasAspect:band.canvasAspect,coverageBudget:band.coverageBudget,role:item.role}):coverageBand?backgroundBandCoverageGuide({canvasAspect:band.canvasAspect,coverageBudget:band.coverageBudget,role:item.role})
      :band?.format==='ai_scene_background_band_v2'?backgroundBandGuide(band.guidanceProfile,item.role):null,
    bandGuideImageRole=scope.bandCompositionGuide?(masterEdit?registeredMasterInputRole(scope.bandCompositionGuide.spec):referenceWindow?BAND_REFERENCE_WINDOW_GUIDE_IMAGE_ROLE:BAND_COMPOSITION_GUIDE_IMAGE_ROLE):irregularBand?BACKGROUND_BAND_IRREGULAR_VALLEY_GUIDE_IMAGE_ROLE:trenchBand?BACKGROUND_BAND_OPEN_TRENCH_GUIDE_IMAGE_ROLE:openBand?BACKGROUND_BAND_OPEN_DEPTH_GUIDE_IMAGE_ROLE:coverageBand?BACKGROUND_BAND_COVERAGE_GUIDE_IMAGE_ROLE:BACKGROUND_BAND_GUIDE_IMAGE_ROLE;
  if(guide)check(!opaque&&base.target.alpha==='transparent'&&state.capabilities.get(recipe.capabilitiesSha256)?.maxInputImages>=2,'SOURCE_VISUAL_GUIDE_CAPABILITY');
  if(bandGuide)check(!opaque&&!guide&&base.target.alpha==='transparent'&&state.capabilities.get(recipe.capabilitiesSha256)?.maxInputImages>=(masterEdit?1:2),'BACKGROUND_BAND_GUIDE_CAPABILITY');
  const frameGuide=scope.sourceFrameGuide?sourceFrameGuide({...scope.sourceFrameGuide,structure:scope.referenceStructure,correction:scope.featureCorrection,supplement:scope.featureSupplement,role:item.role,referenceBytes:readBlob(scope.sourceFrameGuide.spec.referenceRawSha256)}):null;
  if(frameGuide)check(scope.sourceFrameGuide.spec.instanceId===recipe.assetId&&base.target.alpha==='transparent'&&state.capabilities.get(recipe.capabilitiesSha256)?.maxInputImages>=2,'SOURCE_FRAME_GUIDE_BINDING');
  if(frameGuide){const m=state.plans.get(recipe.referencePlans[0]).reconstructionTarget.mapping;
    check(digest(frameGuide.recipe.referenceMapping.referenceContentFrame)===digest({...m.offset,...m.resized}),'SOURCE_FRAME_GUIDE_MAPPING');}
  const prompt=[
    ...(frameGuide?[SOURCE_FRAME_GUIDE_INSTRUCTION]:[]),
    ...(frameGuide?[`Use the ${scope.sourceFrameGuide.spec.frameWorld.width}:${scope.sourceFrameGuide.spec.frameWorld.height} canvas aspect shown in Image 2. Preserve its source-owned registration; the numbered centers correspond to the following named features in order: ${frameGuide.recipe.featureIds.join(', ')}.`]:[]),
    ...(scopeOwnedRegistration?['REFERENCE WINDOW REGISTRATION: Image 2 registers the brief-owned visible forms in the full source canvas. Match their scale and positions within the numbered regions. The striped reserve indicates where new same-layer continuation may be needed. Keep only the declared layer and leave its true openings transparent.']:referenceWindow?['REFERENCE WINDOW REGISTRATION: Image 2 maps the complete accepted reference into the WHOLE requested source frame. Retain the original size, location, slope and relative depth of the brief-owned canyon and facilities inside its colored reference window. Do not zoom or recenter those owned forms to fill the canvas. The striped area lies outside the observed reference frame and requires inferred same-layer continuation. This is new paint, not recovered hidden pixels. Remove every neighboring layer listed in the brief, including playable ledges, props, foreground and sky. The full-scene guide does not assign those neighbors to this asset. Never paint the stripes, markers, labels or a rectangular reference border into the transparent source.']:[]),
    featureMarkers?`SOURCE FEATURE FRAME: use the ${band.canvasAspect.numerator}:${band.canvasAspect.denominator} whole-canvas aspect of Image 2. Keep at least two truly transparent native rows at the top. Left, right and bottom are finite cuts. Continue the same-layer forms through their cuts and keep genuine voids transparent.`:registeredWindow?`REGISTERED SOURCE FRAME: use the ${band.canvasAspect.numerator}:${band.canvasAspect.denominator} whole-canvas aspect of Image 2. Its colored scene window supplies registration for the declared source only, and its stripes mark unobserved reserve. Preserve source-owned structure at that size and location while completing hidden and outside-frame continuation. Neither the full reference nor its foreground becomes this source. Keep the natural top and true openings transparent, with at least TWO clear native rows at the outer top. Left, right and bottom are finite cuts: owned material crossing a cut continues there; actual voids stay transparent. Do not close the band into a centered island, recenter it, or fill voids with sky or a fog sheet. The source brief owns every included form; no abstract gray contour is an artwork target.`:finiteBand?backgroundBandPrompt(band):band?'Generate ONE continuous same-depth background band for a pure 2D SIDE-VIEW scene. Output content is decided ONLY by the single-layer brief below, not by the complete scene image.':'Generate ONE isolated static source asset for a pure 2D SIDE-VIEW scene. Output content is decided ONLY by the single-asset brief below, not by the complete scene image.',
    `SINGLE-ASSET BRIEF: ${scope.content}`,
    band?'Paint only the declared continuous distant layer. Keep its original atmospheric depth, material identity and palette; surrounding sky, playable terrain and other depth groups remain separate sources.':materialSampling?MATERIAL_SAMPLING_CONTENT_INSTRUCTION:ownedContent?sourceContentInstruction(item.role,engineered):grounded?`One isolated ${item.role==='foreground'?'near-camera decorative':item.role==='landmark'?'distant landmark':'environmental'} group. Its entire subject identity, allowed bases and complete attachment points are decided by the single-asset brief.`:(engineered?engineeredInstructions:instructions)[item.role],
    scope.referenceStructure?'Image 1 constrains the declared source-owned structure and feature proportions as well as material, brushwork and light. Preserve the named relationships without copying unowned neighboring subjects or the complete scene.' : ownedContent?'Image 1 supplies the explicitly owned subject identities, members, relative arrangement and openings as well as material, brushwork and light. Preserve that source-local intent with reasonable proportion and detail variation; do not copy neighboring layers or whole-scene coordinates.' : scope.bandFeatureRelations?'Image 1 is the accepted whole reference for brushwork, palette, material treatment, light and the explicitly declared same-layer feature relationships only. Neighboring subjects, main-ground outlines and camera framing are not output instructions. Do not copy a scene slice.' : guide?'Image 1 is the accepted complete reference for brushwork, original material hues, surface treatment, light direction and temperature ONLY. Its foreground exposure, bright top faces, composition and surrounding subjects are not output targets. Keep image 1 intact; do not copy a scene slice.'
      :'Image 1 is the accepted whole reference for brushwork, palette, material treatment and light ONLY. Its composition, neighboring subjects, main-ground outlines and camera framing are not output instructions. Do not copy a left/right slice of the scene.',
    item.role==='material'?(engineered?'Use the brief for manufactured material identity only. Ignore position, count, outline, service-deck arrangement or other scene-layout words. The material field extends across the ENTIRE canvas with no surrounding scene or centered asset.':'Use the brief for material identity only. Ignore position, count, outline, cliffs, platform arrangement or other layout words. The material field extends across the ENTIRE canvas with no surrounding scene or centered island.')
      :item.role==='sky'?'The sky fills the ENTIRE background canvas without a centered cutout or empty border. Scene coordinates and neighboring subject placement do not apply.'
        :frameGuide?'Exactly ONE source-owned fixed group belongs in the declared frame. Retain every named part, its relative scale and location in Image 2; the program calibrates the complete native PNG later. Do not copy unowned neighboring layers or recenter parts separately.':registeredBand?'Image 2 fixes the scale and placement of the declared layer. Continue the same-layer forms into the unobserved reserve while preserving their visible relationships.':referenceWindow?'The visible reference window in Image 2 fixes source-owned registration within this wide canvas. Relative feature lines below are consistency checks, not permission to recenter the asset. Continue owned canyon forms into the unobserved reserve without changing the accepted visible composition.':band?'Exactly ONE same-layer landscape band belongs in this output. Use its own wide canvas for lateral and lower continuation; the program calibrates it later without copying the old scene layout. No scene coordinates are required.':ownedFeatureGroup?'Exactly ONE source-owned feature group belongs in this output. Keep every declared part, including opposite-side parts, with the relative proportions, openings and internal occlusions in the bound reference structure. These are parts of one fixed group, not extra independent scene layers. Do not add unowned neighboring subjects. Center the complete group on its OWN canvas; the program places it later. No whole-scene coordinates are required.':ownedContent?SOURCE_GROUP_INSTRUCTION:'Exactly ONE corresponding subject group belongs in this output. Any paired-side, plural, count or placement wording inherited by the brief describes context, not a request for both sides or extra scene layers. Center the one group on its OWN canvas; the program places it later. No scene coordinates are required.',
    `Exclude entirely: ${scope.exclusions.join('; ')}.`,
    ...(featureMarkers?resolveReferenceFeatureTargets(scope.referenceStructure,scope.featureCorrection,scope.featureSupplement).assets.find(a=>a.instanceId===recipe.assetId).checks.map(c=>`Required structure ${c.checkId}: ${c.description}`):scope.referenceStructure&&!scopeOwnedRegistration?[referenceStructurePrompt(scope.referenceStructure,recipe.assetId,scope.featureCorrection,scope.featureSupplement)]:[]),
    ...(scope.bandFeatureRelations?[bandFeatureRelationsPrompt(scope.bandFeatureRelations)]:[]),
    featureMarkers?'Keep the named features within the complete frame and use the single-asset brief for finite-cut continuation.':registeredBand?'Use the complete registered canvas. Follow the brief for same-layer continuation outside the visible reference window.':finiteBand?'Keep only the requested single-depth band. Apply the aspect and relative coverage budget above without adding neighboring layers.':band?backgroundBandPrompt(band):opaque?'Fill one varied opaque landscape PNG; no transparency, margins, isolated terrain silhouettes or scene collage.'
      :scope.framingProfile===COMPLETE_SOURCE_FRAMING_PROFILE?COMPLETE_SOURCE_FRAMING_INSTRUCTION:'Return one complete isolated group on genuine transparency with continuous Alpha and real transparent openings. Keep at least 12 percent fully transparent space on EACH side. No object, shadow or glow touches the image border. Complete previously hidden parts consistently; these are design assumptions, not measured reconstruction.',
    item.role==='foreground'?(engineered?'Keep the near-camera silhouette, cables, cutouts and fine forms crisp, without depth-of-field blur. Compact fixture surfaces are allowed; continuous walkable ledges, elevated deck caps and backing facade slabs are not.':'Keep the near-camera silhouette and fine forms crisp, without depth-of-field blur. Local rock tops are allowed; continuous walkable ledges, elevated platform caps, tall cliff walls and backing slabs are not.')
      :item.role==='material'?'Keep coherent material scale and palette without perspective or atmospheric scene-depth painting.'
        :'Preserve the requested depth and value relationships. Distant groups keep atmospheric contrast; do not turn them into foreground decorations.',
    engineered?'No character, collectible item, unrelated game prop, readable lettering, brand, UI, atlas, painted checkerboard or comparison panel. Abstract geometric light signs are permitted only when specified in this asset brief. No isometric or top-down playable plane. Approximate identity and coherent materials are sufficient; pixel-exact silhouettes and small fitting alignment are not required.'
      :registeredWindow?'No character, independent game prop, text, UI, atlas, painted checkerboard, diagnostic stripe or comparison panel. Keep the registered source-owned visible structure and scale; inferred continuation must not change that accepted layout. No isometric or top-down playable plane.':'No character, independent game prop, text, UI, atlas, painted checkerboard or comparison panel. No isometric or top-down playable plane. Approximate identity and coherent materials are sufficient; pixel-exact silhouettes and tiny-branch alignment are not required.',
    ...(scope.sourceAppearance?[sourceAppearancePrompt(scope.sourceAppearance,style.name)]:[`Style: ${canonicalJson({name:style.name,rules:style.rules})}`]),
    ...(scope.terrainIntent?[terrainIntentPrompt(scope.terrainIntent)]:[]),
    ...(scope.visualCoherence?[visualCoherencePrompt(scope.visualCoherence,item.role,grounded?scope.groundingProfile:null,scope.sourceAppearance?SOURCE_APPEARANCE_PROFILE:null,scope.contentProfile??null,scope.sourceAppearance?.promptProfile??null)]:grounded?[SCOPE_OWNED_GROUNDING_INSTRUCTION]:[]),
    ...(guide?[SOURCE_VISUAL_GUIDE_INSTRUCTION,
      'SOURCE LIGHTING PROFILE: majority-surfaces-deep-shadow-v1. Paint the broad FRONT, SIDE and TOP faces mostly in deep shade, visibly darker than the main supporting wall in image 1. Retain the original material hues, readable shadow structure, complete silhouette and every required end cap, port and short connection. Tiny attached indicators and narrow rim accents remain limited; a bright front or roof with only dark side trim does not meet this profile. This is newly painted source lighting, never a post-generation multiply, tint, opacity change or black silhouette.']:[]),
    ...(bandGuide?[scope.bandCompositionGuide?[featureMarkers?BAND_FEATURE_MARKERS_INSTRUCTION:referenceWindow?'Image 2 is a reference-window layout guide, not a final asset or segmented layer. Its colored area contains the original full scene only to establish the visible window. Preserve the declared source-owned forms at that registration, infer their occluded continuation, and exclude all unowned scene content. Continue the same layer beyond that window through the striped reserve where required by its finite-cut contract; leave true sky and voids transparent. Numbered centers identify reference observations; an observed occlusion edge is not a demand for a physical end cap. Do not copy the technical overlay.':scope.bandCompositionGuide.spec.format==='ai_scene_band_composition_guide_spec_v2'?'Image 2 is the reviewed full-canvas feature placement guide. Keep the SAME canvas aspect and place the center of EACH named feature at its numbered cross and dashed region, retaining the reference proportions between them. Preserve both the small feature group size and its location within the WHOLE wide canvas; do not enlarge the group to fill the source. Gray masses and transparency retain the declared band topology only; the original reference and brief supply actual rock, structures and style. Never paint the boxes, cross marks, numbered badges, diagram or labels into the output. Preserve genuine top/void transparency. This guide is not artwork or approval.':'Image 2 is a neutral technical guide: use its canvas aspect, three finite cuts and numbered dashed feature regions as approximate same-layer placement hints. Never paint the boxes, numbered badges, gray diagram or labels into the output. Preserve a naturally transparent upper contour. The complete reference supplies style and light; the brief owns all content. The guide is not artwork or approval.',...scope.bandCompositionGuide.spec.features.map((f,i)=>`Feature ${i+1}: ${f.description}.`)].join('\n'):irregularBand?BACKGROUND_BAND_IRREGULAR_VALLEY_GUIDE_INSTRUCTION:trenchBand?BACKGROUND_BAND_OPEN_TRENCH_GUIDE_INSTRUCTION:openBand?BACKGROUND_BAND_OPEN_DEPTH_GUIDE_INSTRUCTION:coverageBand?BACKGROUND_BAND_COVERAGE_GUIDE_INSTRUCTION:BACKGROUND_BAND_GUIDE_INSTRUCTION]:[]),
    `Native PNG, minimum ${s.minimumWidth}x${s.minimumHeight}, maximum ${s.maximumWidth}x${s.maximumHeight}. Preserve the original PNG. No automatic retry, post-generation silhouette cleanup, Alpha repair or recoloring.`,
    'FINAL CONTENT CHECK: only the requested single-layer subject is present. A transparent PNG containing neighboring-layer content is still a wrong source and requires separate visual review.'
  ].join('\n\n');
  const body=unseal(base);
  const compiler=(engineered?'scene-kit-isolated-layer-source-v4-coherent-v2-engineered':scope.visualCoherence?'scene-kit-isolated-layer-source-v4-coherent-v1':'scene-kit-isolated-layer-source-v4')+(ownedFeatureGroup?'-owned-feature-group-v1':'')+(scope.sourceAppearance?.promptProfile?'-reference-atmosphere-v1':'')+(materialSampling?`-${MATERIAL_SAMPLING_CONTENT_PROFILE}`:'')+(registeredBand?`-${scope.contentProfile}`:'');
  const compiled=seal({...body,compiler:compiler+(guide?'-shadow-guide-v1':'')+(grounded?'-scope-owned-support-v1':'')+(scope.bandCompositionGuide?(masterEdit?'-registered-layout-master-edit-v1':referenceWindow?'-background-band-reference-window-guide-v3':featureMarkers?'-background-band-feature-markers-guide-v4':scope.bandCompositionGuide.spec.format==='ai_scene_band_composition_guide_spec_v2'?'-background-band-feature-envelope-guide-v2':'-background-band-feature-envelope-guide-v1'):irregularBand?'-background-band-irregular-valley-v4-guide-v3':trenchBand?'-background-band-open-trench-v4-guide-v2':openBand?'-background-band-open-depth-v4-guide-v1':coverageBand?'-background-band-coverage-v3-guide-v1':bandGuide?'-background-band-v2-guide-v1':band?'-background-band-v1':'')+(registeredWindow?'-registered-window-extraction-v1':'')+(ownedContent?'-scope-owned-content-v1':'')+(scope.sourceAppearance?'-source-owned-appearance-v1':'')+(scope.bandFeatureRelations?'-band-feature-relations-v1':'')+(scope.referenceStructure?'-reference-structure-v1':'')+(scope.featureCorrection?'-reference-feature-correction-v1':'')+(scope.featureSupplement?'-reference-feature-supplement-v1':'')+(frameGuide?'-source-frame-guide-v1':'')+(scope.framingProfile?'-complete-silhouette-v1':'')+(scope.terrainIntent?'-'+scope.terrainIntent.profile:''),recipe,
    sourceScope:{profile:LAYER_SOURCE_INTENT,definition:recipe.sourceScope,parentRole:scope.parentRole,layerId:scope.layerId,
      referenceUsage:scope.referenceStructure?'style-material-light-and-declared-reference-structure':scope.bandFeatureRelations?'style-material-light-and-explicit-same-layer-relations-only':guide?'style-material-light-direction-temperature-only-not-foreground-exposure':'style-material-light-only',sceneCoordinatesInPrompt:false,contentOrigin:scope.contentOrigin,
      alphaCleanupAllowed:false,semanticIsolationProven:false,predecessorArtDecisionUnchanged:true,
      ...(scope.visualCoherence?{visualCoherenceSha256:scope.visualCoherence.sha256}: {}),
      ...(scope.sourceAppearance?{sourceAppearanceEvidence:{profile:SOURCE_APPEARANCE_PROFILE,...(scope.sourceAppearance.promptProfile?{promptProfile:scope.sourceAppearance.promptProfile}:{}),sourceAppearanceSha256:digest(scope.sourceAppearance),sceneStyleSha256:style.sha256,inheritedSceneRules:false,inheritedSceneObservations:false,sceneStyleNameRetained:true}}:{}),
      ...(grounded?{groundingProfile:scope.groundingProfile}:{}),
      ...(scope.framingProfile?{framingProfile:scope.framingProfile}:{}),
      ...(scope.terrainIntent?{terrainIntentSha256:digest(scope.terrainIntent)}:{}),
      ...(band?{backgroundBandSha256:digest(band),backgroundBandCoverage:{...backgroundBandCoverage(band),calibration:'required-before-derive'}}:{}),
      ...(scope.bandFeatureRelations?{bandFeatureRelationsSha256:digest(scope.bandFeatureRelations)}:{}),
      ...(scope.referenceStructure?{referenceStructureSha256:scope.referenceStructure.sha256}:{}),
      ...(scope.featureCorrection?{featureCorrectionSha256:digest(scope.featureCorrection)}:{}),
      ...(scope.featureSupplement?{featureSupplementSha256:digest(scope.featureSupplement)}:{}),
      ...(frameGuide?{sourceFrameGuideEvidence:{recipeSha256:frameGuide.recipe.sha256,rawSha256:frameGuide.artifact.sha256,role:frameGuide.role,usage:'reviewed-isolated-source-registration-hint-not-segmentation-or-acceptance'}}:{}),
      ...(bandGuide?{backgroundBandGuideEvidence:{profile:bandGuide.profile,role:bandGuide.role,imageRole:bandGuideImageRole,
        recipeSha256:bandGuide.recipe.sha256,rawSha256:bandGuide.artifact.sha256,usage:featureMarkers?'reviewed-asset-local-feature-locations-only':referenceWindow?'reviewed-reference-window-registration-and-unobserved-reserve-not-segmentation-or-asset-acceptance':scope.bandCompositionGuide?'reviewed-asset-local-feature-envelopes-and-coverage-only':irregularBand?'asset-local-irregular-material-and-real-void-topology-only-not-style-theme-exact-outline-or-count':trenchBand?'asset-local-broad-side-body-and-through-trench-topology-only-not-style-theme-exact-outline-or-count':openBand?'asset-local-open-material-and-real-void-topology-with-finite-cuts-only-not-style-theme-exact-outline-or-count':coverageBand?'asset-local-aspect-normalized-coverage-and-soft-feature-frequency-only-not-style-theme-exact-outline-or-count':'asset-local-three-edge-continuation-only-not-style-theme-count-or-specific-outline'}}:{}),
      ...(finiteBand?{boundaryPolicy:{profile:band.boundaryProfile,top:'original-top-two-pixel-alpha-at-most-one-and-real-transparency',
        finiteCuts:['left','right','bottom'],cutAlpha:'preserve-all-native-rgba-including-strong-cut-alpha',
        overrides:openBand?'legacy-all-edge-transparent-border-test-only-for-this-new-v4-plan':'legacy-all-edge-transparent-border-test-only-for-this-new-v3-plan',contentContinuity:'requires-visual-review'}}:{}),
      ...(guide?{lightingProfile:scope.lightingProfile,visualGuideEvidence:{profile:guide.profile,role:guide.role,recipeSha256:guide.recipe.sha256,
        rawSha256:guide.artifact.sha256,usage:'majority-surface-shadow-and-complete-interfaces-only-not-geometry-style-palette-or-layout'}}:{})},
    visualReviewChecklist:{requiredChecks:['Only one requested subject; all scope exclusions absent.','No neighboring-layer content even when PNG transparency passes.',
      band?'Natural upper silhouette and real transparent openings; left/right/bottom continue the same layer into the declared off-camera area. Side and lower endings are not required to form a closed island.':'Complete silhouette and transparent openings where applicable; coherent material, light and depth.','Readable overall recomposition; no pixel-exact requirement.',
      ...(scope.bandFeatureRelations?['Review the declared same-layer feature relations in the native source and actual Studio composition; the declared ranges and technical guide do not prove model compliance or final art acceptance.']:[]),
      ...(band?['Full native frame and actual Alpha-at-least-8 side/bottom termination lines require explicit camera-domain calibration; a border pass or bounding box does not certify painted continuity or style.']:[]),
      ...(bandGuide?[trenchBand?'Broad same-layer side bodies retain a true through-trench void. The neutral topology does not introduce narrow post forests, rows of enclosed arch holes, independent subject groups or a playable scene layout.':openBand?'Only same-layer material forms extend through their side or bottom finite cuts; true voids may continue through those cuts. No opaque background, shared solid lower body or invented enclosing upper wave fills the real openings.':'The same layer is newly painted to both side technical ends and the lower technical end, without a closed mountain foot or surrounding fade; the neutral guide contributes no palette, opaque surround, theme or crest count.']:[]),
      ...(grounded?['Support forms, contact shading and small overlaps belong only to the parts explicitly declared in this single-asset brief; no inferred neighboring forms.']:[]),
      ...(guide?['Most front, side and top planes remain in deep shade, visibly darker than the main wall; sparse lights do not brighten broad faces.',
        'Requested end caps, ports and short attachments are complete; no neutral guide geometry, grayscale conversion or opaque technical surround is copied.']:[]),
      ...(scope.visualCoherence?scope.visualCoherence.wholeSceneChecks.map(c=>c.focus):[])],automatedSemanticDetection:false,visualAcceptance:'not-assessed'},
    request:{...body.request,prompt,images:[...body.request.images.map(i=>({...i,role:scope.referenceStructure?'accepted-scene-style-material-light-and-declared-structure-reference':ownedContent?'accepted-scene-style-material-light-and-declared-content-reference':guide?SOURCE_GUIDED_REFERENCE_ROLE:'accepted-scene-style-material-light-reference'})),
      ...(frameGuide?[{role:frameGuide.role,artifact:frameGuide.artifact}]:[]),...(guide?[{role:guide.role,artifact:guide.artifact}]:[]),...(bandGuide?[{role:bandGuideImageRole,artifact:bandGuide.artifact}]:[])]}});
  return masterEdit?registeredMasterEditPlan(compiled,scope):compiled;
}
