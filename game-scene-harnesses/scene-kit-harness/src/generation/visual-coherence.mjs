import {check,exact,id,isDigest,text,seal,unseal,digest} from './common.mjs';
import {SCOPE_OWNED_GROUNDING_INSTRUCTION,validateScopeOwnedGrounding} from './scope-owned-grounding.mjs';
import {SOURCE_APPEARANCE_PROFILE,SOURCE_ATMOSPHERE_PROMPT_PROFILE} from './source-appearance.mjs';
import {SOURCE_CONTENT_PROFILE,MATERIAL_SAMPLING_CONTENT_PROFILE,validateSourceContent} from './source-content.mjs';

// A shared art brief is an instruction/evidence contract, not image analysis or
// automatic art acceptance. It never carries another source's pixels or changes
// the single-layer responsibility of a generated asset.
export const VISUAL_COHERENCE_POLICY=seal({format:'ai_scene_visual_coherence_policy_v1',profile:'reference-relative-coherence-v1',
  referenceUsage:'accepted-reference-style-material-light',palette:'preserve-reference-colors-no-automatic-grading',
  materialScale:'reference-relative-per-material-family-not-equal-size-for-all-stones',
  terrainJoin:'one-continuous-painted-lip-soil-body-progression',
  placement:'observed-size-and-anchor-metadata-only-never-prompt-coordinates',
  backgroundPerspective:'reference-consistent-volume-and-small-top-faces-allowed',
  review:'whole-scene-prioritized-observations-separate-from-technical-gates',
  automatedSemanticDetection:false,pixelIdentityRequired:false,automaticRetry:false});

// Opt-in scene semantics live in a new sealed contract. The original policy,
// observations and prompt text remain byte-identical when this family is absent.
export const ENGINEERED_CITY_FAMILY='engineered-city';
export const ENGINEERED_VISUAL_COHERENCE_POLICY=seal({...unseal(VISUAL_COHERENCE_POLICY),
  format:'ai_scene_visual_coherence_policy_v2',profile:'reference-relative-engineered-coherence-v1',
  materialScale:'reference-relative-per-manufactured-material-family-not-equal-detail-size-for-every-fixture',
  sceneFamily:ENGINEERED_CITY_FAMILY,terrainJoin:'connected-manufactured-wearing-surface-fascia-body-with-deliberate-joints',
  lighting:'reference-bound-local-emissive-fixtures-no-global-color-grade-or-unbounded-bloom'});
export const VISUAL_COHERENCE_ENGINEERED_POLICY=ENGINEERED_VISUAL_COHERENCE_POLICY;

const appearanceKeys=['lighting','brushwork','materialScale','depth'];
const roles=['sky','backdrop','landmark','scenery','valley','ground','platform','foreground'];
const roleOf=role=>role==='solid-terrain'?'ground':role==='solid-platform'?'platform':role;
const parents={sky:'background',backdrop:'far',landmark:'far',scenery:'middle',valley:'far',ground:'main',platform:'main',foreground:'foreground'};
const wholeSceneChecks=[
  {key:'terrain-volume',focus:'Ground silhouette, valley opening and the visual rhythm of playable surfaces.'},
  {key:'relative-scale',focus:'Subject proportions and material-family detail frequency at their final displayed size.'},
  {key:'grounding',focus:'Root/base contact, natural local overlap and support without adding neighboring-layer scenery.'},
  {key:'terrain-join',focus:'Continuous surface thickness and soil/rock transition rather than an independent pasted stripe.'},
  {key:'depth-and-style',focus:'Shared light, edge treatment, brushwork and atmospheric value hierarchy.'},
];
const engineeredSceneChecks=[
  {key:'terrain-volume',focus:'Service-deck silhouette, rear-city openings and readable manufactured playable surfaces.'},
  {key:'relative-scale',focus:'Building proportions, panel spans, fasteners and service fixtures at their final displayed size.'},
  {key:'grounding',focus:'Foundation, mounting-foot and structural-support contact within each asset responsibility.'},
  {key:'terrain-join',focus:'Connected wearing surface, fascia and supporting body with deliberate manufactured joints and corners.'},
  {key:'depth-and-style',focus:'Shared brushwork and ambient light; bounded local emissive accents preserve material colors and depth hierarchy.'},
];
function observationsOf(value){
  check(value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value))
    &&Object.keys(value).every(k=>appearanceKeys.includes(k)||k==='sceneFamily'),'VISUAL_COHERENCE_OBSERVATIONS');
  if(Object.hasOwn(value,'sceneFamily'))check(value.sceneFamily===ENGINEERED_CITY_FAMILY,'VISUAL_COHERENCE_SCENE_FAMILY');
  for(const key of appearanceKeys)if(Object.hasOwn(value,key))text(value[key],{limit:600});
  return {...value};
}
export const validateVisualObservations=value=>observationsOf(value);
function frameOf(target){
  const frame=target.mapping?.viewport;
  check(frame&&Number.isSafeInteger(frame.width)&&frame.width>0&&Number.isSafeInteger(frame.height)&&frame.height>0,'VISUAL_COHERENCE_FRAME');return frame;
}
function boundsOf(points){
  check(Array.isArray(points)&&points.length>=3&&points.length<=128,'VISUAL_COHERENCE_ENVELOPE');
  for(const p of points)check(Number.isFinite(p.x)&&Number.isFinite(p.y),'VISUAL_COHERENCE_ENVELOPE');
  const x=Math.floor(Math.min(...points.map(p=>p.x))),y=Math.floor(Math.min(...points.map(p=>p.y)));
  return {x,y,width:Math.max(1,Math.ceil(Math.max(...points.map(p=>p.x)))-x),height:Math.max(1,Math.ceil(Math.max(...points.map(p=>p.y)))-y)};
}
function metricsOf(target){
  const frame=frameOf(target),seen=new Set();check(Array.isArray(target.instances)&&target.instances.length>0&&target.instances.length<=64,'VISUAL_COHERENCE_INSTANCES');
  return target.instances.map(instance=>{
    id(instance.instanceId);id(instance.subjectId);id(instance.layerId);check(!seen.has(instance.instanceId),'VISUAL_COHERENCE_INSTANCES');seen.add(instance.instanceId);
    const role=roleOf(instance.role);check(roles.includes(role),'VISUAL_COHERENCE_ROLE');const b=boundsOf(instance.visibleEnvelope);
    check(instance.anchor&&Number.isFinite(instance.anchor.x)&&Number.isFinite(instance.anchor.y),'VISUAL_COHERENCE_ANCHOR');
    return {instanceId:instance.instanceId,subjectId:instance.subjectId,layerId:instance.layerId,role,parentRole:parents[role],
      observedSize:{width:b.width,height:b.height},relativeSize:{width:{numerator:b.width,denominator:frame.width},height:{numerator:b.height,denominator:frame.height}},
      observedAnchorWithinEnvelope:{x:instance.anchor.x-b.x,y:instance.anchor.y-b.y},anchorEvidence:instance.anchorEvidence,
      anchorInterpretation:'observed-anchor-not-certified-root-or-footing',placementUsage:'assembly-only'};
  });
}
function validateMetrics(rows){
  check(Array.isArray(rows)&&rows.length>0&&rows.length<=64,'VISUAL_COHERENCE_INSTANCES');const seen=new Set();let width=null,height=null;
  for(const row of rows){
    exact(row,['instanceId','subjectId','layerId','role','parentRole','observedSize','relativeSize','observedAnchorWithinEnvelope','anchorEvidence','anchorInterpretation','placementUsage']);
    id(row.instanceId);id(row.subjectId);id(row.layerId);check(!seen.has(row.instanceId)&&roles.includes(row.role)&&row.parentRole===parents[row.role],'VISUAL_COHERENCE_INSTANCES');seen.add(row.instanceId);
    exact(row.observedSize,['width','height']);exact(row.relativeSize,['width','height']);exact(row.observedAnchorWithinEnvelope,['x','y']);
    for(const key of ['width','height']){
      const ratio=row.relativeSize[key];exact(ratio,['numerator','denominator']);
      check(Number.isSafeInteger(row.observedSize[key])&&row.observedSize[key]>0&&row.observedSize[key]<=16384
        &&ratio.numerator===row.observedSize[key]&&Number.isSafeInteger(ratio.denominator)&&ratio.denominator>0&&ratio.denominator<=16384,'VISUAL_COHERENCE_SIZE');
    }
    if(width===null){width=row.relativeSize.width.denominator;height=row.relativeSize.height.denominator;}
    check(row.relativeSize.width.denominator===width&&row.relativeSize.height.denominator===height,'VISUAL_COHERENCE_FRAME');
    check(['x','y'].every(k=>Number.isFinite(row.observedAnchorWithinEnvelope[k])&&Math.abs(row.observedAnchorWithinEnvelope[k])<=16384)
      &&['observed','inferred'].includes(row.anchorEvidence)&&row.anchorInterpretation==='observed-anchor-not-certified-root-or-footing'
      &&row.placementUsage==='assembly-only','VISUAL_COHERENCE_ANCHOR');
  }
}
export function createVisualCoherence(spec,style,target,observations={}){
  unseal(spec);unseal(style);unseal(target);unseal(spec.requirements);
  check(spec.format==='ai_scene_spec_v3'&&style.format==='ai_scene_style_v2'&&target.format==='ai_scene_reference_reconstruction_target_v2'
    &&target.status==='accepted-reference-and-measured-layout'&&target.requirementsSha256===spec.requirements.sha256&&isDigest(target.rawSha256)
    &&target.mapping?.viewport?.width===spec.viewport?.width&&target.mapping?.viewport?.height===spec.viewport?.height,'VISUAL_COHERENCE_CONTEXT');
  const checked=observationsOf(observations),engineered=checked.sceneFamily===ENGINEERED_CITY_FAMILY;
  return seal({format:engineered?'ai_scene_visual_coherence_v2':'ai_scene_visual_coherence_v1',
    policySha256:(engineered?ENGINEERED_VISUAL_COHERENCE_POLICY:VISUAL_COHERENCE_POLICY).sha256,
    ...(engineered?{sceneFamily:ENGINEERED_CITY_FAMILY}:{}),
    specSha256:spec.sha256,styleSha256:style.sha256,requirementsSha256:spec.requirements.sha256,
    targetSha256:target.sha256,referenceRawSha256:target.rawSha256,observations:checked,
    layoutMetrics:metricsOf(target),wholeSceneChecks:engineered?engineeredSceneChecks:wholeSceneChecks,
    layoutUsage:'assembly-only-not-image-prompt',observationOrigin:'reference-relative-brief-not-automatic-image-measurement',
    visualAcceptance:'not-assessed',automatedSemanticDetection:false,generationCalls:0});
}
export function validateVisualCoherence(record,{requirements,spec,style,target}={}){
  const body=unseal(record),engineered=body.format==='ai_scene_visual_coherence_v2';
  exact(body,['format','policySha256',...(engineered?['sceneFamily']:[]),'specSha256','styleSha256','requirementsSha256','targetSha256','referenceRawSha256',
    'observations','layoutMetrics','wholeSceneChecks','layoutUsage','observationOrigin','visualAcceptance','automatedSemanticDetection','generationCalls']);
  check(['ai_scene_visual_coherence_v1','ai_scene_visual_coherence_v2'].includes(body.format)
    &&body.policySha256===(engineered?ENGINEERED_VISUAL_COHERENCE_POLICY:VISUAL_COHERENCE_POLICY).sha256
    &&(!engineered||body.sceneFamily===ENGINEERED_CITY_FAMILY),'VISUAL_COHERENCE_POLICY');
  for(const key of ['specSha256','styleSha256','requirementsSha256','targetSha256','referenceRawSha256'])check(isDigest(body[key]),'VISUAL_COHERENCE_BINDING');
  observationsOf(body.observations);validateMetrics(body.layoutMetrics);
  check((body.observations.sceneFamily===ENGINEERED_CITY_FAMILY)===engineered,'VISUAL_COHERENCE_SCENE_FAMILY');
  check(digest(body.wholeSceneChecks)===digest(engineered?engineeredSceneChecks:wholeSceneChecks)&&body.layoutUsage==='assembly-only-not-image-prompt'
    &&body.observationOrigin==='reference-relative-brief-not-automatic-image-measurement'&&body.visualAcceptance==='not-assessed'
    &&body.automatedSemanticDetection===false&&body.generationCalls===0,'VISUAL_COHERENCE_POLICY');
  if(requirements){unseal(requirements);check(body.requirementsSha256===requirements.sha256,'VISUAL_COHERENCE_BINDING');}
  const complete=[spec,style,target].filter(Boolean).length;
  check(complete===0||complete===3,'VISUAL_COHERENCE_CONTEXT');
  if(complete)check(record.sha256===createVisualCoherence(spec,style,target,body.observations).sha256,'VISUAL_COHERENCE_BINDING');
  return body;
}
export function visualCoherencePrompt(record,role,groundingProfile=null,appearanceProfile=null,contentProfile=null,appearancePromptProfile=null){
  const body=validateVisualCoherence(record);check(role==='material'||roles.includes(role),'VISUAL_COHERENCE_ROLE');
  check(appearanceProfile===null||appearanceProfile===SOURCE_APPEARANCE_PROFILE,'SOURCE_APPEARANCE_PROFILE');
  if(contentProfile!==null)validateSourceContent({role,contentProfile});
  check(appearancePromptProfile===null||appearancePromptProfile===SOURCE_ATMOSPHERE_PROMPT_PROFILE&&appearanceProfile===SOURCE_APPEARANCE_PROFILE,'SOURCE_ATMOSPHERE_PROMPT_PROFILE');
  const ownedContent=contentProfile===SOURCE_CONTENT_PROFILE;
  const materialSampling=contentProfile===MATERIAL_SAMPLING_CONTENT_PROFILE;
  const atmosphere=appearancePromptProfile===SOURCE_ATMOSPHERE_PROMPT_PROFILE;
  if(groundingProfile!==null)validateScopeOwnedGrounding({role,groundingProfile});
  // A sky owns a continuous background field, not the scene family's surface materials.
  // This opt-in branch leaves every historical request byte unchanged.
  if(atmosphere&&role==='sky')return [
    'SHARED VISUAL COHERENCE: this sky/background field belongs to the same illustration as image 1. Follow only its source-owned celestial or atmospheric content and appearance rules; the scene material family supplies no extra subjects or surface-detail requirements.',
    'Preserve the selected broad value and color progression across the full field, its direction and relative strength. Do not replace a visible gradient with a flat fill, or let a local bright feature erase the field progression. A gradient is required only when observed and selected for this source.'
  ].join('\n\n');
  if(body.sceneFamily===ENGINEERED_CITY_FAMILY){
    const common=atmosphere?[
      'SHARED VISUAL COHERENCE: use the manufactured materials actually owned by this source, with reference-relative brushwork, edges and detail scale. Preserve designed joints and supporting structure where present; do not add panel seams, hardware or other material families absent from the source brief.',
      'Source appearance rules own illumination and atmospheric depth. A material identity does not require neutral colors, equally lit faces or equally sharp detail at every depth. Emissive accents stay attached to their declared parts; this restriction does not prohibit the selected ambient color, haze on solid surfaces or broad background gradient.'
    ]:[
      ownedContent?'SHARED VISUAL COHERENCE: use the reference-relative manufactured material treatment in the same illustrated scene as image 1. Subject identity and setting come only from the explicit source brief. Preserve original material colors, brushwork and edge treatment; modest painted side planes remain compatible with readable side-view play surfaces.':'SHARED VISUAL COHERENCE: this is an engineered city asset in the same illustrated scene as image 1. Preserve its local concrete, metal, paint and window colors, brushwork and edge treatment. Reference-consistent architectural side planes and small roof planes are allowed while playable surfaces remain readable in side view.',
      'Match detail frequency by manufactured material family at final displayed size: panel spans, masonry joints, seams, fasteners, piping and mounting hardware follow the reference proportions. Keep deliberate straight edges, right angles and designed structural joints; do not organically deform manufactured structure.',
      'Match the reference ambient illumination and atmospheric hierarchy. Emissive accents belong to the specified attached lamp, strip, indicator or window and may produce bounded local reflections. Keep their original colors and controlled intensity without an asset-sized glow halo, broad bloom, camera blur or a uniform color tint across every surface.'
    ];
    if(role==='material'||role==='platform')common.push('TERRAIN STRUCTURE: paint the thin wearing surface, manufactured edge fascia and lower concrete or panel body as one connected supported assembly. Preserve deliberate joints and material boundaries, appropriate contact shade, aligned panel rhythm and clean industrial corners. Surface trim belongs to the supporting body; do not turn it into a detached ornamental stripe.');
    if(role==='material'&&!materialSampling)common.push('The upper one-eighth contains the uninterrupted thin wearing surface. Show its immediate manufactured fascia and supporting body directly below, then continue the same body material across the remaining canvas. Preserve consistent physical detail scale and intended panel boundaries, without artificial atlas cells, unrelated bands or scene geometry.');
    if(['landmark','scenery','foreground'].includes(role))common.push(groundingProfile||ownedContent?SCOPE_OWNED_GROUNDING_INSTRUCTION:'Use only the asset\'s own compact structural footing, mounting feet, bracket or equipment base to show credible support. Keep complete attachment points and local contact shade; the host deck, neighboring architecture and rear-city scenery remain separate assets.');
    if(appearanceProfile===null)for(const key of appearanceKeys)if(Object.hasOwn(body.observations,key))common.push(`Shared ${key} observation: ${body.observations[key]}`);
    return common.join('\n\n');
  }
  const common=atmosphere?[
    'SHARED VISUAL COHERENCE: keep the source in the same painted scene as image 1, with the brushwork and material scale of its owned content. Source appearance rules own observed illumination, atmospheric color and contrast; do not substitute an unlit material palette or sharpen every depth equally.',
    'Keep broad masses and small accents in the selected balance. Near and far are depth roles, not fixed brightness or color presets. Do not add material families or atmospheric effects absent from this source brief.'
  ]:[
    'SHARED VISUAL COHERENCE: treat this asset as part of the same painted scene as image 1. Preserve the reference local colors, light direction and softness, brushwork and edge treatment. Match its observed depth; reference-consistent background volume and small painted top faces are allowed when the playable side-view remains readable.',
    'Match detail frequency by material family at the final displayed scale. Masonry joints may be finer than natural boulders; neither should become a different illustration style. Keep the reference balance of broad masses and small accents instead of making every surface equally sharp or saturated.',
    'Retain the reference atmospheric hierarchy and shared illumination. Near and far groups may have different contrast exactly as their depth requires; use their original palette rather than a separate color grade.'
  ];
  if(role==='material'||role==='platform')common.push('TERRAIN CONTINUITY: paint the thin surface lip, attached soil/cover, and lower rock/earth as one connected material progression. Let the reference cover penetrate locally into the underlying material with natural thickness, uneven interlocking edges and its own painted contact shade. Preserve the supporting body beneath it; avoid a uniform decorative stripe laid over an unrelated rock pattern.');
  if(role==='material'&&!materialSampling)common.push('The upper one-eighth contains the surface lip. Continue its adjacent soil/cover-to-body transition naturally through at least the upper quarter of the source canvas, then continue the body material below. Keep the same horizontal material scale through this entire progression, with no separated bands, atlas cells or hard divider. This describes the material field on its own canvas, not the scene layout.');
  if(['landmark','scenery','foreground'].includes(role))common.push(groundingProfile?SCOPE_OWNED_GROUNDING_INSTRUCTION:'Use compact attached roots or foundations to make this subject visually supported. Paint the local contact and small natural overlaps within its own allowed base; the host ground and surrounding scenery remain separate assets.');
  if(appearanceProfile===null)for(const key of appearanceKeys)if(Object.hasOwn(body.observations,key))common.push(`Shared ${key} observation: ${body.observations[key]}`);
  return common.join('\n\n');
}
