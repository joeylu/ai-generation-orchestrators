import {canonicalJson} from '../document.mjs';
import {TERRAIN_REFERENCE_DEFINED_MANUFACTURED_PROFILE,TERRAIN_EDGE_GUTTER_WARNING_PROFILE} from '../terrain-perimeter-contract.mjs';
import {assessCoherentSource} from './coherent-source.mjs';
import {check,digest,exact,hash,id,isDigest,seal,text,unseal} from './common.mjs';
import {validateSourceAppearance,sourceAppearancePrompt} from './source-appearance.mjs';
import {TERRAIN_EDGE_TOPOLOGY_PROFILE,TERRAIN_EDGE_TOPOLOGY_V2_PROFILE,resolveTerrainEdgeTopologyGuide} from './terrain-edge-topology-guide.mjs';

// Preserve historical prompt bytes when absent. An explicit source-owned
// appearance contract replaces the whole scene rule list, without classifying
// or deleting phrases from immutable scene styles.
const sourceStyle=(recipe,style)=>Object.hasOwn(recipe,'sourceAppearance')
  ?sourceAppearancePrompt(recipe.sourceAppearance,style.name)
  :`Style: ${canonicalJson({name:style.name,rules:style.rules})}`;

export const TERRAIN_EDGE_ROLES=Object.freeze(['left-wall','right-wall','left-top-corner','right-top-corner']);
export const TERRAIN_BOTTOM_EDGE_ROLES=Object.freeze(['bottom-edge','left-bottom-corner','right-bottom-corner']);
export const TERRAIN_PERIMETER_ROLES=Object.freeze([...TERRAIN_EDGE_ROLES,...TERRAIN_BOTTOM_EDGE_ROLES]);
export const TERRAIN_PERIMETER_COVERAGE_PROFILE='full-perimeter-v1';
export const TERRAIN_NATIVE_SIZE_PROFILE='bounded-native-4m-v1';
export const TERRAIN_NATIVE_RENDER_ENVELOPE_PROFILE='visible-alpha8-outward16-native-rgba-v1';
export const TERRAIN_REFERENCE_DEFINED_COVER_PROFILE='reference-defined-cover-v1';
export const TERRAIN_EDGE_PLAN_FORMATS=Object.freeze(['ai_scene_generation_plan_v29','ai_scene_generation_plan_v30','ai_scene_generation_plan_v33','ai_scene_generation_plan_v34','ai_scene_generation_plan_v35','ai_scene_generation_plan_v36','ai_scene_generation_plan_v37']);
export const TERRAIN_EDGE_BATCH_FORMATS=Object.freeze(['ai_scene_terrain_edge_batch_v1','ai_scene_terrain_edge_batch_v2','ai_scene_terrain_edge_batch_v3','ai_scene_terrain_edge_batch_v4','ai_scene_terrain_edge_batch_v5','ai_scene_terrain_edge_batch_v6','ai_scene_terrain_edge_batch_v7','ai_scene_terrain_edge_prepared_batch_v1','ai_scene_terrain_edge_canvas_gutter_batch_v1','ai_scene_terrain_edge_rebind_batch_v1','ai_scene_terrain_edge_recovery_batch_v1','ai_scene_terrain_edge_recovery_batch_v2']);
export const TERRAIN_EDGE_POLICY=seal({format:'ai_scene_terrain_edge_source_policy_v1',profile:'isolated-terrain-edge-v1',
  scope:'one-exposed-edge-or-one-top-corner-per-native-image',reference:'accepted-whole-reference-style-material-light',
  material:'current-checked-native-material-color-brushwork-and-scale',placement:'explicit-data-not-prompt-coordinates',
  nativePng:'preserve-original-bytes',continuousAlpha:true,sourceArtAcceptance:'separate-not-inferred-from-technical-pass',
  semanticDetection:false,automaticRetry:false,maximumCallsPerPlan:1,referencePixelsCopied:false});
export const ENGINEERED_CITY_TERRAIN_EDGE_POLICY=seal({format:'ai_scene_terrain_edge_source_policy_v2',profile:'isolated-engineered-city-edge-v1',
  surfaceFamily:'engineered-city',scope:'one-exposed-edge-or-one-top-corner-per-native-image',reference:'accepted-whole-reference-style-material-light',
  material:'current-checked-native-material-color-brushwork-and-scale',placement:'explicit-data-not-prompt-coordinates',
  geometry:'manufactured-front-facing-solid-section-deliberate-straight-corners',light:'bounded-attached-native-png-appearance-no-dynamic-light',
  nativePng:'preserve-original-bytes',continuousAlpha:true,sourceArtAcceptance:'separate-not-inferred-from-technical-pass',
  semanticDetection:false,automaticRetry:false,maximumCallsPerPlan:1,referencePixelsCopied:false});
export const TERRAIN_PERIMETER_POLICY=seal({...unseal(TERRAIN_EDGE_POLICY),format:'ai_scene_terrain_edge_source_policy_v3',profile:'isolated-terrain-perimeter-v1',
  coverageProfile:TERRAIN_PERIMETER_COVERAGE_PROFILE,roles:TERRAIN_PERIMETER_ROLES,
  scope:'one-exposed-side-bottom-or-local-outer-corner-per-native-image',sourceTransforms:'identity-only-no-rotation-or-mirroring',
  scale:'measure-native-source-after-reception-no-seam-or-scale-success-inferred'});
export const ENGINEERED_CITY_TERRAIN_PERIMETER_POLICY=seal({...unseal(ENGINEERED_CITY_TERRAIN_EDGE_POLICY),format:'ai_scene_terrain_edge_source_policy_v4',profile:'isolated-engineered-city-perimeter-v1',
  coverageProfile:TERRAIN_PERIMETER_COVERAGE_PROFILE,roles:TERRAIN_PERIMETER_ROLES,
  scope:'one-exposed-side-bottom-or-local-outer-corner-per-native-image',sourceTransforms:'identity-only-no-rotation-or-mirroring',
  scale:'measure-native-source-after-reception-no-seam-or-scale-success-inferred'});
const nativeSizePolicy={nativeSizeProfile:TERRAIN_NATIVE_SIZE_PROFILE,requiredRenderEnvelopeProfile:TERRAIN_NATIVE_RENDER_ENVELOPE_PROFILE,
  maximumSourceDimension:4096,maximumSourcePixels:4194304,minimumTransparentGutterPixels:1,preferredGutter:{numerator:12,denominator:100},
  actualGutter:'report-actual-four-side-margins-for-independent-review',sourceRgba:'preserve-all-original-values',
  renderEnvelope:'alpha-at-least-eight-visible-contour-outward16-weak-tail-render-clips-measured-later-no-source-alpha-edit'};
export const TERRAIN_NATIVE_SIZE_PERIMETER_POLICY=seal({...unseal(TERRAIN_PERIMETER_POLICY),...nativeSizePolicy,
  format:'ai_scene_terrain_edge_source_policy_v5',profile:'isolated-native-size-terrain-perimeter-v1'});
export const ENGINEERED_CITY_TERRAIN_NATIVE_SIZE_PERIMETER_POLICY=seal({...unseal(ENGINEERED_CITY_TERRAIN_PERIMETER_POLICY),...nativeSizePolicy,
  format:'ai_scene_terrain_edge_source_policy_v6',profile:'isolated-native-size-engineered-city-perimeter-v1'});
export const TERRAIN_REFERENCE_DEFINED_COVER_POLICY=seal({...unseal(TERRAIN_NATIVE_SIZE_PERIMETER_POLICY),
  format:'ai_scene_terrain_edge_source_policy_v7',profile:'isolated-native-size-reference-defined-natural-perimeter-v1',
  naturalSurfaceProfile:TERRAIN_REFERENCE_DEFINED_COVER_PROFILE,
  coverAndBody:'accepted-reference-plus-checked-native-material-plus-explicit-subject-brief',
  attachments:'only-design-specified-reference-supported-attached-details-no-default-cover-or-light',
  uncoveredSurface:'continue-matching-body-when-design-specifies-no-separate-cover'});
const usable=entry=>entry&&['pending-visual-review','accepted'].includes(entry.status)&&entry.result?.technical.status==='pass';
const baseFormats=['ai_scene_coherent_source_batch_v1','ai_scene_coherent_source_batch_v2','ai_scene_coherent_source_batch_v3'];
function policyFor(recipe){
  const perimeter=Object.hasOwn(recipe,'coverageProfile'),engineered=Object.hasOwn(recipe,'surfaceFamily'),native=Object.hasOwn(recipe,'nativeSizeProfile'),
    render=Object.hasOwn(recipe,'renderEnvelopeProfile'),cover=Object.hasOwn(recipe,'naturalSurfaceProfile');
  check(!perimeter||recipe.coverageProfile===TERRAIN_PERIMETER_COVERAGE_PROFILE,'TERRAIN_EDGE_COVERAGE_PROFILE');
  check(!engineered||recipe.surfaceFamily==='engineered-city','TERRAIN_EDGE_SURFACE_FAMILY');
  check(!native||perimeter&&recipe.nativeSizeProfile===TERRAIN_NATIVE_SIZE_PROFILE,'TERRAIN_EDGE_NATIVE_SIZE_PROFILE');
  check(native?render&&recipe.renderEnvelopeProfile===TERRAIN_NATIVE_RENDER_ENVELOPE_PROFILE:!render,'TERRAIN_EDGE_RENDER_ENVELOPE_PROFILE');
  check(!cover||!engineered&&perimeter&&native&&recipe.naturalSurfaceProfile===TERRAIN_REFERENCE_DEFINED_COVER_PROFILE,
    'TERRAIN_EDGE_NATURAL_SURFACE_PROFILE');
  check(!Object.hasOwn(recipe,'manufacturedMaterialProfile')||engineered&&native
    &&recipe.manufacturedMaterialProfile===TERRAIN_REFERENCE_DEFINED_MANUFACTURED_PROFILE,'TERRAIN_EDGE_MANUFACTURED_MATERIAL_PROFILE');
  check(!Object.hasOwn(recipe,'gutterPolicy')||native&&recipe.gutterPolicy===TERRAIN_EDGE_GUTTER_WARNING_PROFILE,
    'TERRAIN_EDGE_GUTTER_POLICY');
  if(cover)return TERRAIN_REFERENCE_DEFINED_COVER_POLICY;
  if(native)return engineered?ENGINEERED_CITY_TERRAIN_NATIVE_SIZE_PERIMETER_POLICY:TERRAIN_NATIVE_SIZE_PERIMETER_POLICY;
  return perimeter?(engineered?ENGINEERED_CITY_TERRAIN_PERIMETER_POLICY:TERRAIN_PERIMETER_POLICY)
    :(engineered?ENGINEERED_CITY_TERRAIN_EDGE_POLICY:TERRAIN_EDGE_POLICY);
}
const isReferenceDefinedCover=policy=>policy===TERRAIN_REFERENCE_DEFINED_COVER_POLICY;
const isNativeSize=policy=>[TERRAIN_NATIVE_SIZE_PERIMETER_POLICY,ENGINEERED_CITY_TERRAIN_NATIVE_SIZE_PERIMETER_POLICY,TERRAIN_REFERENCE_DEFINED_COVER_POLICY].includes(policy);
const isPerimeter=policy=>[TERRAIN_PERIMETER_POLICY,ENGINEERED_CITY_TERRAIN_PERIMETER_POLICY].includes(policy)||isNativeSize(policy);
const isEngineered=policy=>[ENGINEERED_CITY_TERRAIN_EDGE_POLICY,ENGINEERED_CITY_TERRAIN_PERIMETER_POLICY,ENGINEERED_CITY_TERRAIN_NATIVE_SIZE_PERIMETER_POLICY].includes(policy);
const planFormat=policy=>isReferenceDefinedCover(policy)?'ai_scene_generation_plan_v37':isNativeSize(policy)?(isEngineered(policy)?'ai_scene_generation_plan_v36':'ai_scene_generation_plan_v35')
  :isPerimeter(policy)?(isEngineered(policy)?'ai_scene_generation_plan_v34':'ai_scene_generation_plan_v33')
  :(isEngineered(policy)?'ai_scene_generation_plan_v30':'ai_scene_generation_plan_v29');

function context(state,recipe,readBlob){
  const batch=state.batches.get(recipe.baseBatchSha256),ref=state.plans.get(recipe.referencePlans?.[0]);
  check(baseFormats.includes(batch?.format)&&batch.referencePlanSha256===ref?.plan.sha256
    &&ref?.status==='accepted'&&ref.reconstructionTarget?.sha256===recipe.targetSha256,'TERRAIN_EDGE_BASE');
  check(batch.planSha256s.every(sha=>usable(state.plans.get(sha))),'TERRAIN_EDGE_BASE_INCOMPLETE');
  const material=state.plans.get(recipe.materialPlanSha256);
  const rebound=material?.plan.format==='ai_scene_coherent_rebind_v1';
  check(batch.planSha256s.includes(recipe.materialPlanSha256)&&(material?.plan.format==='ai_scene_generation_plan_v27'
    ||rebound&&batch.format==='ai_scene_coherent_source_batch_v3'&&batch.reboundPlanSha256s?.includes(material.plan.sha256))
    &&material.plan.instanceBinding.role==='material'&&usable(material)&&material.result.rawSha256===recipe.materialRawSha256,
    'TERRAIN_EDGE_MATERIAL');
  if(rebound){
    const plan=material.plan,source=unseal(plan.sourceEvidence),proposal=unseal(plan.proposal);
    check(material.kind==='coherent-rebind'&&plan.request.format==='ai_scene_no_generation_request_v1'&&plan.request.maximumCalls===0
      &&plan.receipt?.decision==='accept'&&plan.receipt.targetSha256===plan.proposal.sha256
      &&proposal.sourceEvidenceSha256===plan.sourceEvidence.sha256&&proposal.target.planSha256===plan.targetPlanSha256
      &&proposal.target.targetSha256===recipe.targetSha256&&proposal.target.role==='material'
      &&source.rawSha256===plan.rawSha256&&plan.rawSha256===material.result.rawSha256
      &&material.result.format==='ai_scene_coherent_rebind_result_v1'&&material.result.rebindSha256===plan.sha256
      &&material.result.targetPlanSha256===plan.targetPlanSha256&&material.result.maximumCalls===0
      &&material.result.technical.sha256===plan.technical.sha256&&plan.technical.planSha256===plan.targetPlanSha256,
      'TERRAIN_EDGE_MATERIAL');
  }
  check(material.plan.sourceScope?.definition?.visualCoherence?.sceneFamily!=='engineered-city'||recipe.surfaceFamily==='engineered-city',
    'TERRAIN_EDGE_SURFACE_FAMILY');
  check(material.plan.referenceEvidence[0].rawSha256===ref.result.rawSha256
    &&material.plan.recipe.targetSha256===recipe.targetSha256,'TERRAIN_EDGE_MATERIAL');
  if(readBlob)for(const sha of [ref.result.rawSha256,material.result.rawSha256])check(hash(readBlob(sha))===sha,'TERRAIN_EDGE_INPUT');
  return {batch,ref,material};
}

export function assertTerrainEdgeCurrent(state,plan){
  check(plan.recipe.specSha256===state.activeSpec&&plan.recipe.styleSha256===state.activeStyle,'PLAN_STALE');
  const policy=policyFor(plan.recipe);
  check(plan.format===planFormat(policy)
    &&plan.recipe.policySha256===policy.sha256&&plan.qualityPolicy?.sha256===policy.sha256,'TERRAIN_EDGE_POLICY');
  const {ref,material}=context(state,plan.recipe);
  check(ref.result.rawSha256===plan.referenceEvidence[0].rawSha256,'REFERENCE_ASSET_TARGET_STALE');
  check(material.result.rawSha256===plan.materialEvidence.rawSha256&&material.plan.sha256===plan.materialEvidence.planSha256,'TERRAIN_EDGE_MATERIAL');
}

const directions={
  'left-wall':'ONE narrow VERTICAL LEFT EXPOSED CLIFF EDGE: empty exterior is on its LEFT and the attachment/overlap side is on its RIGHT. Continue a natural front-facing rock cross-section down the vertical direction. No horizontal playable cap in this asset.',
  'right-wall':'ONE narrow VERTICAL RIGHT EXPOSED CLIFF EDGE: empty exterior is on its RIGHT and the attachment/overlap side is on its LEFT. Continue a natural front-facing rock cross-section down the vertical direction. No horizontal playable cap in this asset.',
  'left-top-corner':'ONE TOP-LEFT OUTER TERRAIN CORNER: the thin illuminated leaf/soil surface extends to the RIGHT into the ground, then wraps naturally DOWN around the LEFT exposed rock edge. The outer silhouette opens toward the LEFT and above. This is a local corner connection, not a complete platform.',
  'right-top-corner':'ONE TOP-RIGHT OUTER TERRAIN CORNER: the thin illuminated leaf/soil surface extends to the LEFT into the ground, then wraps naturally DOWN around the RIGHT exposed rock edge. The outer silhouette opens toward the RIGHT and above. This is a local corner connection, not a complete platform.',
};
const engineeredDirections={
  'left-wall':'ONE narrow VERTICAL LEFT EXPOSED MANUFACTURED EDGE: empty exterior is on its LEFT and the attachment/overlap side is on its RIGHT. Continue a front-facing concrete or metal-panel section down the vertical direction. No horizontal playable cap in this asset.',
  'right-wall':'ONE narrow VERTICAL RIGHT EXPOSED MANUFACTURED EDGE: empty exterior is on its RIGHT and the attachment/overlap side is on its LEFT. Continue a front-facing concrete or metal-panel section down the vertical direction. No horizontal playable cap in this asset.',
  'left-top-corner':'ONE TOP-LEFT OUTER MANUFACTURED CORNER: the thin walkway lip extends to the RIGHT into the solid section, then connects DOWN to the LEFT exposed panel edge. The exterior opens toward the LEFT and above. Preserve a deliberate clean manufactured corner or small reference-matched bevel. This is a local corner connection, not a complete platform.',
  'right-top-corner':'ONE TOP-RIGHT OUTER MANUFACTURED CORNER: the thin walkway lip extends to the LEFT into the solid section, then connects DOWN to the RIGHT exposed panel edge. The exterior opens toward the RIGHT and above. Preserve a deliberate clean manufactured corner or small reference-matched bevel. This is a local corner connection, not a complete platform.',
};
function engineeredPrompt(recipe,style,sourcePolicy,wall){
  const referenceDefined=recipe.manufacturedMaterialProfile===TERRAIN_REFERENCE_DEFINED_MANUFACTURED_PROFILE;
  const side=recipe.edgeRole==='left-wall'?'LEFT':'RIGHT';
  const inward=side==='LEFT'?'RIGHT':'LEFT';
  const direction=referenceDefined&&wall
    ?`ONE narrow VERTICAL ${side} EXPOSED MANUFACTURED EDGE: empty exterior is on its ${side} and the attachment/overlap side is on its ${inward}. Continue the front-facing cross-section of the checked native material down the vertical direction. No horizontal playable cap in this asset.`
    :engineeredDirections[recipe.edgeRole];
  return [
    referenceDefined?'Generate ONE native transparent manufactured edge asset for a pure 2D SIDE-VIEW scene. Output only the requested boundary on its own canvas.'
      :'Generate ONE native transparent manufactured edge asset for a pure 2D SIDE-VIEW city scene. Output only the single edge responsibility below; this is not a scene slice, a complete structure or an atlas.',
    direction,`SINGLE-ASSET BRIEF: ${recipe.subjectBrief.content}`,
    referenceDefined?'Image 1 is the accepted complete scene reference for original palette, illumination, painting treatment and constructed forms. Image 2 is the checked native solid-section material for its original substance, color, feature scale, seam spacing and surface-to-front connection. Use both images as references for the local boundary only. Neither image is an edit target. Do not copy the full layout or surrounding subjects.'
      :'Image 1 is the accepted complete scene reference for palette, illumination, painting treatment and broad manufactured forms ONLY. Image 2 is the existing native solid-section material to match its original colors, concrete or metal-panel scale, panel spacing and walkway-to-front connection. Neither image is an edit target. Do not reproduce their full layout or copy surrounding subjects.',
    referenceDefined?'REFERENCE-DEFINED MANUFACTURED MATERIAL: continue the front-face substance, surface transition, feature scale and spacing specified in the brief and supported by the accepted reference and checked native material. Preserve designed joints and modest bevels. Include attached details only where specified and supported. Keep the requested side or corner orientation and the original direction of illumination.'
      :'Use front-facing concrete and metal-panel construction appropriate to the brief. Keep clean manufactured corners, coherent panel thickness and restrained attached fasteners or conduits. Preserve deliberate straight industrial geometry rather than forcing an irregular decorative outline. Do not rotate a horizontal walkway lip, rotate the painting light, or mirror the other side.',
    'Provide a compact solid inward-facing attachment area for overlap with the matching body. Maintain coherent joints and local original shading, without a detached border or invented full-height dark outline. Keep horizontal and vertical material scale equal; do not stretch panels or fasteners. Open elevated supports and complete freestanding walkways are outside this solid-section edge responsibility.',
    wall?'Prefer a portrait canvas with one complete narrow vertical edge segment. Its upper and lower end regions must remain visible for later explicit crop/overlap planning; no seam compatibility is assumed from this request.'
      :referenceDefined?'Prefer a square canvas with one compact manufactured corner. Keep the surface lip and supporting face continuously connected where specified. Preserve the reference-matched joint or modest bevel.'
      :'Prefer a square canvas with one compact manufactured corner. Keep the thin lit walkway lip and supporting front panel continuously connected; preserve the reference-matched clean joint or modest bevel.',
    referenceDefined?'Retain original bounded painted light only on details supported by the reference and named in the brief. Keep those details attached to the boundary. No detached glow sheet or full-scene haze.'
      :'Only if requested in the brief, retain small attached neon strips and their bounded local halo in their original colors. The PNG records painted light appearance only, not dynamic illumination, global bloom or lighting of other layers. No detached glow sheet or full-scene haze.',
    'Center the ONE asset on its OWN canvas, leaving at least 12 percent completely transparent empty gutter on ALL FOUR sides. No object, shadow or glow touches the image border. Preserve real transparent openings and continuous Alpha. Inferred or previously hidden forms are design assumptions, not measured reconstruction.',
    `Exclude entirely: ${['sky, skyline and distant architecture','whole buildings, streets, vehicles, characters and independent props','complete platforms, backing slabs, scene compositions, text, UI, grid, atlas or comparison panels',...recipe.subjectBrief.exclusions].join('; ')}.`,
    sourceStyle(recipe,style),
    `Native RGBA PNG, minimum ${sourcePolicy.minimumWidth}x${sourcePolicy.minimumHeight}, maximum ${sourcePolicy.maximumWidth}x${sourcePolicy.maximumHeight}. Preserve original colors and native PNG. No post-generation Alpha cleanup, recoloring, sharpening or silhouette repair. One image only; no automatic retry.`,
    'FINAL CONTENT CHECK: only the requested one side segment or one corner is present. Review material scale, light, connection and actual recomposition separately; a technical transparency pass does not prove the art is suitable.',
  ].join('\n\n');
}

const bottomDirections={
  'bottom-edge':'ONE HORIZONTAL BOTTOM EXPOSED TERRAIN EDGE: empty exterior is BELOW and the inward attachment/overlap area is ABOVE. Show one narrow front-facing underside termination with both horizontal ends fully visible. No vertical side corner and no playable top surface in this asset.',
  'left-bottom-corner':'ONE BOTTOM-LEFT OUTER TERRAIN CORNER: the bottom termination extends RIGHT into the solid and connects UP to its LEFT exposed vertical side. The empty exterior opens LEFT and BELOW. Include only this local lower corner and short attachment arms, not a complete platform.',
  'right-bottom-corner':'ONE BOTTOM-RIGHT OUTER TERRAIN CORNER: the bottom termination extends LEFT into the solid and connects UP to its RIGHT exposed vertical side. The empty exterior opens RIGHT and BELOW. Include only this local lower corner and short attachment arms, not a complete platform.',
};
function bottomPrompt(recipe,style,sourcePolicy,engineered){
  const referenceDefined=recipe.manufacturedMaterialProfile===TERRAIN_REFERENCE_DEFINED_MANUFACTURED_PROFILE;
  const surface=referenceDefined?'manufactured':engineered?'manufactured city':'hand-painted natural terrain';
  return [
    `Generate ONE native transparent ${surface} BOTTOM edge asset for a pure 2D SIDE-VIEW scene. Output only the one bottom responsibility below; this is not a scene slice, full solid section, atlas or set of alternatives.`,
    bottomDirections[recipe.edgeRole],`SINGLE-ASSET BRIEF: ${recipe.subjectBrief.content}`,
    'Image 1 is the accepted COMPLETE scene reference for original palette, illumination and painting treatment ONLY. Image 2 is the checked COMPLETE native solid-section material for matching its original colors, source feature scale, front-face construction and local shading. Neither image is an edit target. Do not copy their full layout or surrounding subjects.',
    referenceDefined?'REFERENCE-DEFINED MANUFACTURED MATERIAL: continue the specified and reference-supported front face and its narrow lower termination. The brief, accepted reference and checked native material define the substance, boundary thickness, joint spacing and illumination. Keep only its specified, reference-supported attachments. No playable upper lip.'
      :engineered?'Use front-facing concrete and metal-panel construction with deliberate clean manufactured corners or a small reference-matched bevel. Finish the lower front panel or beam with a narrow attached underside termination. Retain coherent panel thickness, joint spacing and restrained fasteners. A bottom edge is not a second illuminated walkway lip.'
      :'Use broad irregular rock or earth masses with a naturally uneven lower silhouette and genuine transparent recesses. The bare underside may retain restrained attached roots or small stone projections appropriate to the brief. A bottom edge is not an upside-down grassy or illuminated leaf-covered top cap.',
    'Draw the requested bottom orientation natively under the SAME original scene illumination. Do not rotate, flip or mirror a top lip, a side strip, the other corner or the painting light. Do not invent a long black outline. The lower attachment must connect to its own front face, with a compact solid inward overlap area rather than a detached border.',
    'Keep horizontal and vertical feature scale equal and preserve the reference material colors, value hierarchy and brushwork. Do not stretch panels, fasteners, rocks or texture. Source-to-world scale, opaque joining collars, repeat windows and corner anchors will be explicitly measured AFTER reception; this image request does not prove seamlessness, final scale or body compatibility.',
    recipe.edgeRole==='bottom-edge'?'Prefer a landscape canvas with ONE complete narrow horizontal bottom segment, both end regions visible for later measured crop/overlap planning.'
      :'Prefer a square canvas with ONE compact lower corner and both short arms visible for later measured body/side/bottom attachment planning.',
    ...(engineered?[referenceDefined?'Retain small attached painted light only when specified in the brief and supported by the reference. Preserve its original hue and bounded local appearance. No detached glow sheet, global bloom or dynamic illumination.'
      :'Retain small attached colored light only if explicitly requested in the brief and supported by the reference. Preserve its original hue and bounded local appearance. No new continuous cyan top walkway, detached glow sheet, global bloom or dynamic illumination.']:[]),
    'Center the ONE complete asset on its OWN canvas, leaving at least 12 percent completely transparent empty gutter on ALL FOUR sides. No object, shadow or glow touches any image border. Preserve genuine transparent recesses and continuous Alpha. Hidden lower forms are disclosed design assumptions, not measured reconstruction.',
    `Exclude entirely: ${['sky, scenery and distant architecture','water, whole buildings, streets, vehicles, characters and independent props','playable top surfaces, top vegetation caps, full platforms, backing slabs, scene compositions, text, UI, grid, atlas or comparison panels',...recipe.subjectBrief.exclusions].join('; ')}.`,
    sourceStyle(recipe,style),
    `Native RGBA PNG, minimum ${sourcePolicy.minimumWidth}x${sourcePolicy.minimumHeight}, maximum ${sourcePolicy.maximumWidth}x${sourcePolicy.maximumHeight}. Preserve original colors and native PNG. No post-generation Alpha cleanup, recoloring, sharpening or silhouette repair. One image only; no automatic retry.`,
    'FINAL CONTENT CHECK: exactly the requested bottom segment or lower corner is present, fully isolated and fully visible. Check palette, orientation, material scale, joining collars and actual recomposition separately. A technical PNG pass does not certify art or native boundary fit.',
  ].join('\n\n');
}

// An opt-in contract: historical prompts remain byte-identical. The design and
// its two immutable image inputs own the surface choice, including no cover.
const referenceDefinedDirections={...bottomDirections,
  'left-wall':'ONE narrow VERTICAL LEFT EXPOSED NATURAL TERRAIN EDGE: empty exterior is LEFT, inward attachment/overlap is RIGHT. Continue the reference-defined front-facing terrain body vertically. No horizontal playable cap.',
  'right-wall':'ONE narrow VERTICAL RIGHT EXPOSED NATURAL TERRAIN EDGE: empty exterior is RIGHT, inward attachment/overlap is LEFT. Continue the reference-defined front-facing terrain body vertically. No horizontal playable cap.',
  'left-top-corner':'ONE TOP-LEFT OUTER NATURAL TERRAIN CORNER: the reference-defined surface extends RIGHT into the ground and meets the supporting LEFT exposed body. Empty exterior opens LEFT and ABOVE. Only a local corner connection and short attachment arms.',
  'right-top-corner':'ONE TOP-RIGHT OUTER NATURAL TERRAIN CORNER: the reference-defined surface extends LEFT into the ground and meets the supporting RIGHT exposed body. Empty exterior opens RIGHT and ABOVE. Only a local corner connection and short attachment arms.',
};
export const TERRAIN_LOWER_BODY_PROFILE='lower-body-appearance-v1';
function referenceDefinedCoverPrompt(recipe,style,sourcePolicy){
  const wall=recipe.edgeRole.endsWith('wall'),bottom=TERRAIN_BOTTOM_EDGE_ROLES.includes(recipe.edgeRole),lowerBody=bottom&&recipe.lowerBodyProfile===TERRAIN_LOWER_BODY_PROFILE;
  return [
    'Generate ONE native transparent natural terrain perimeter asset for a pure 2D SIDE-VIEW scene. Only the single responsibility below; no complete platform, scene slice or atlas.',
    referenceDefinedDirections[recipe.edgeRole],`SINGLE-ASSET BRIEF: ${recipe.subjectBrief.content}`,
    lowerBody?'Image 1 is the accepted COMPLETE scene reference for original palette, illumination and painting treatment. Image 2 is the checked COMPLETE native terrain material for matching its body construction, original colors and feature scale. Read both complete inputs together with the explicit lower-boundary brief; neither image is an edit target. Do not copy their layout, upper surface or surrounding subjects.'
      :'Image 1 is the accepted COMPLETE scene reference for the designed surface, original palette, illumination and painting treatment. Image 2 is the checked COMPLETE native terrain material for the original cover/body boundary, body construction, colors and feature scale. Read both complete inputs together with the explicit brief; neither image is an edit target. Do not copy their layout or surrounding subjects.',
    lowerBody?'REFERENCE-DEFINED LOWER-BODY CONTRACT: continue the reference-matched solid body and its front-facing material to the requested lower boundary. Derive any lower attachments only from the explicit brief and reference evidence; hidden forms remain design assumptions. The upper cover/body transition belongs to the upper surface, not this lower asset. Do not invent a cover, glowing lip or playable upper surface.'
      :'REFERENCE-DEFINED COVER/BODY CONTRACT: derive the surface substance, thickness, boundary shape and any local overhang from the accepted reference, original native material and explicit subject brief. Preserve their cover-to-body transition and supporting front face. When the design specifies no separate covering, continue the matching exposed body through the surface boundary without inventing a cap. No preset substance, color, glow or illuminated lip is required.',
    'Include attached details ONLY when specified by the design/brief and supported by the accepted reference and material. Do not infer decorative growth, hanging elements or colored lighting merely from a natural terrain label. Keep explicitly designed attachments local to their designated boundary; never convert a local overhang into a uniform full-height stripe. Disclose unseen forms as design assumptions, not measured reconstruction.',
    bottom?'Preserve the reference-defined bare lower termination unless the design explicitly specifies lower attachments. No playable upper surface on this bottom asset; do not turn the surface covering upside down.'
      :wall?'The vertical segment continues the matching body; any surface-cover continuation requires explicit design support. Do not add a horizontal upper cap.'
        :'Keep the designed surface and supporting body continuously connected at this upper corner. Match the actual cover thickness or uncovered boundary without imposing a material or generic lit rim.',
    'Draw this orientation natively under the SAME original scene illumination. Do not rotate, flip or mirror another boundary, surface cap or painting light. Preserve genuine transparent recesses and a compact solid inward overlap area; no detached border, artificial dark outline or stretched features. Keep horizontal and vertical material scale equal.',
    'Opaque joining collars, repeat windows, native scale and anchors will be explicitly measured AFTER reception. This image request does not prove seamlessness, body compatibility or final displayed scale.',
    wall?'Prefer a portrait canvas with one complete vertical segment and both end regions visible.'
      :recipe.edgeRole==='bottom-edge'?'Prefer a landscape canvas with one complete horizontal bottom segment and both ends visible.'
        :'Prefer a square canvas with one compact corner and both short attachment arms visible.',
    'Center the ONE complete asset on its OWN canvas, leaving at least 12 percent completely transparent empty gutter on ALL FOUR sides. No object, shadow or painted light touches the border. Preserve continuous Alpha and original native RGBA.',
    `Exclude entirely: ${['scenery, sky and distant subjects','architecture, characters, independent props and surrounding layers','complete platforms, backing slabs, scene compositions, text, UI, grid, atlas or comparison panels',...recipe.subjectBrief.exclusions].join('; ')}.`,
    sourceStyle(recipe,style),
    `Native RGBA PNG, minimum ${sourcePolicy.minimumWidth}x${sourcePolicy.minimumHeight}, maximum ${sourcePolicy.maximumWidth}x${sourcePolicy.maximumHeight}. Preserve original colors and native PNG. No post-generation Alpha cleanup, recoloring, sharpening or silhouette repair. One image only; no automatic retry.`,
    lowerBody?'FINAL CONTENT CHECK: one isolated lower boundary only, with the reference-matched body and explicitly designed lower attachments. Review palette, illumination, feature scale, orientation, body fit and actual recomposition independently. Technical PNG validation does not certify material semantics or human art acceptance.'
      :'FINAL CONTENT CHECK: one isolated requested boundary only, with design-specified cover/body substance and attachments. Review palette, illumination, feature scale, cover/body fit and actual recomposition independently. Technical PNG validation does not certify material semantics or human art acceptance.',
  ].join('\n\n');
}

export function compileTerrainEdgeSource(state,recipe,readBlob){
  exact(recipe,['planId','parents','stage','specSha256','styleSha256','capabilitiesSha256','referencePlans','inventoryRefs','assetId',
    'targetSha256','baseBatchSha256','materialPlanSha256','materialRawSha256','policySha256','edgeRole','subjectBrief',...(Object.hasOwn(recipe,'surfaceFamily')?['surfaceFamily']:[]),
    ...(Object.hasOwn(recipe,'coverageProfile')?['coverageProfile']:[]),...(Object.hasOwn(recipe,'nativeSizeProfile')?['nativeSizeProfile']:[]),
    ...(Object.hasOwn(recipe,'renderEnvelopeProfile')?['renderEnvelopeProfile']:[]),...(Object.hasOwn(recipe,'naturalSurfaceProfile')?['naturalSurfaceProfile']:[]),
    ...(Object.hasOwn(recipe,'sourceAppearance')?['sourceAppearance']:[]),...(Object.hasOwn(recipe,'topologyGuideProfile')?['topologyGuideProfile']:[]),...(Object.hasOwn(recipe,'lowerBodyProfile')?['lowerBodyProfile']:[]),
    ...(Object.hasOwn(recipe,'manufacturedMaterialProfile')?['manufacturedMaterialProfile']:[]),
    ...(Object.hasOwn(recipe,'gutterPolicy')?['gutterPolicy']:[])]);
  const sourceAppearance=Object.hasOwn(recipe,'sourceAppearance')?validateSourceAppearance(recipe.sourceAppearance):null;
  const policy=policyFor(recipe),engineered=isEngineered(policy),perimeter=isPerimeter(policy),native=isNativeSize(policy),cover=isReferenceDefinedCover(policy);
  const guided=Object.hasOwn(recipe,'topologyGuideProfile');
  check(!guided||cover&&[TERRAIN_EDGE_TOPOLOGY_PROFILE,TERRAIN_EDGE_TOPOLOGY_V2_PROFILE].includes(recipe.topologyGuideProfile),'TERRAIN_EDGE_TOPOLOGY_PROFILE');
  check(!Object.hasOwn(recipe,'lowerBodyProfile')||cover&&TERRAIN_BOTTOM_EDGE_ROLES.includes(recipe.edgeRole)&&recipe.lowerBodyProfile===TERRAIN_LOWER_BODY_PROFILE,'TERRAIN_EDGE_LOWER_BODY_PROFILE');
  id(recipe.planId);id(recipe.assetId);
  check(recipe.stage==='terrain-edge-source'&&recipe.policySha256===policy.sha256&&(perimeter?TERRAIN_PERIMETER_ROLES:TERRAIN_EDGE_ROLES).includes(recipe.edgeRole)
    &&Array.isArray(recipe.parents)&&recipe.parents.length<=1&&Array.isArray(recipe.referencePlans)&&recipe.referencePlans.length===1
    &&Array.isArray(recipe.inventoryRefs)&&recipe.inventoryRefs.length===0,'TERRAIN_EDGE_RECIPE');
  if(recipe.parents.length){const parent=state.plans.get(recipe.parents[0]);
    const terminalUnknown=parent?.status==='indeterminate'&&parent.terminal?.outcome==='indeterminate'&&!parent.result;
    check((terminalUnknown||parent?.status==='rejected-technical'&&parent.result?.technical.status==='fail')
      &&TERRAIN_EDGE_PLAN_FORMATS.includes(parent.plan.format)
      &&recipe.planId!==parent.plan.recipe.planId
      &&digest({...recipe,planId:parent.plan.recipe.planId,parents:parent.plan.recipe.parents})===digest(parent.plan.recipe),
      'TERRAIN_EDGE_RECOVERY_PARENT_PLAN');
  }
  for(const key of ['specSha256','styleSha256','capabilitiesSha256','targetSha256','baseBatchSha256','materialPlanSha256','materialRawSha256'])check(isDigest(recipe[key]),'TERRAIN_EDGE_BINDING');
  exact(recipe.subjectBrief,['content','exclusions']);text(recipe.subjectBrief.content,{limit:1200});
  check(Array.isArray(recipe.subjectBrief.exclusions)&&recipe.subjectBrief.exclusions.length<=16
    &&new Set(recipe.subjectBrief.exclusions).size===recipe.subjectBrief.exclusions.length,'TERRAIN_EDGE_BRIEF');
  recipe.subjectBrief.exclusions.forEach(value=>text(value,{limit:200}));
  const {batch,ref,material}=context(state,recipe,readBlob),spec=state.designs.get(recipe.specSha256),style=state.designs.get(recipe.styleSha256),cap=state.capabilities.get(recipe.capabilitiesSha256);
  check(recipe.specSha256===state.activeSpec&&recipe.styleSha256===state.activeStyle&&spec?.format==='ai_scene_spec_v3'&&style?.format==='ai_scene_style_v2'
    &&ref.plan.recipe.specSha256===recipe.specSha256&&ref.plan.recipe.styleSha256===recipe.styleSha256,'TERRAIN_EDGE_DESIGN');
  check(cap?.imageToImage&&cap.transparentBackground&&cap.maxInputImages>=(guided?3:2)&&cap.maxWidth>=256&&cap.maxHeight>=256,'TERRAIN_EDGE_CAPABILITY');
  check(!batch.planSha256s.some(sha=>state.plans.get(sha).plan.recipe.assetId===recipe.assetId),'TERRAIN_EDGE_ASSET_COLLISION');
  const maximumSourceSize=perimeter&&!native?2048:4096;
  const sourcePolicy={mode:'native-terrain-edge-source',minimumWidth:256,minimumHeight:256,maximumWidth:Math.min(maximumSourceSize,cap.maxWidth),maximumHeight:Math.min(maximumSourceSize,cap.maxHeight),
    ...(cover?{naturalSurfaceProfile:recipe.naturalSurfaceProfile}:{}),
    ...(native?{maximumPixels:policy.maximumSourcePixels,nativeSizeProfile:recipe.nativeSizeProfile,renderEnvelopeProfile:recipe.renderEnvelopeProfile}:{} )};
  const wall=recipe.edgeRole.endsWith('wall'),bottom=TERRAIN_BOTTOM_EDGE_ROLES.includes(recipe.edgeRole),promptBase=cover?referenceDefinedCoverPrompt(recipe,style,sourcePolicy):bottom?bottomPrompt(recipe,style,sourcePolicy,engineered):engineered?engineeredPrompt(recipe,style,sourcePolicy,wall):[
    'Generate ONE native transparent terrain edge asset for a pure 2D SIDE-VIEW hand-painted scene. Output only the single edge responsibility below; this is not a scene slice, a complete cliff or an atlas.',
    directions[recipe.edgeRole],`SINGLE-ASSET BRIEF: ${recipe.subjectBrief.content}`,
    'Image 1 is the accepted complete scene reference for palette, illumination, brushwork and broad rock/earth forms ONLY. Image 2 is the existing native terrain material to match its original colors, painted rock scale and soil-to-rock treatment. Neither image is an edit target. Do not reproduce their full layout or copy surrounding subjects.',
    'Use irregular broad ROCK/EARTH edge masses as the main silhouette, with restrained attached roots, moss or vegetation appropriate to the brief. Surface cover may wrap down locally around a corner, but must not become a uniform full-height green stripe. Do not rotate a horizontal grass cap, rotate the painting light, or mirror the other side.',
    'Keep a naturally jagged outer silhouette with genuine transparent recesses. Provide a compact, solid inward-facing attachment area for overlap with the matching terrain body, with coherent painted transitions instead of a straight decorative border or artificial dark outline. Keep the same horizontal and vertical material scale; do not stretch rocks into pillars.',
    wall?'Prefer a portrait canvas with one complete narrow vertical edge segment. Its upper and lower end regions must remain visible for later explicit crop/overlap planning; no seam compatibility is assumed from this request.'
      :'Prefer a square canvas with one compact corner. Preserve a readable thin lit soil/leaf surface, the attached uneven cover, and the supporting rock shoulder as one continuous painted connection.',
    'Center the ONE asset on its OWN canvas, leaving at least 12 percent completely transparent empty gutter on ALL FOUR sides. No object, shadow or glow touches the image border. Preserve real transparent openings and continuous Alpha. Inferred or previously hidden forms are design assumptions, not measured reconstruction.',
    `Exclude entirely: ${['sky, mountains and valley scenery','water, architecture, trees and independent foreground props','complete platforms, backing cliff slabs, scene compositions, characters, text, UI, grid, atlas or comparison panels',...recipe.subjectBrief.exclusions].join('; ')}.`,
    sourceStyle(recipe,style),
    `Native RGBA PNG, minimum ${sourcePolicy.minimumWidth}x${sourcePolicy.minimumHeight}, maximum ${sourcePolicy.maximumWidth}x${sourcePolicy.maximumHeight}. Preserve original colors and native PNG. No post-generation Alpha cleanup, recoloring, sharpening or silhouette repair. One image only; no automatic retry.`,
    'FINAL CONTENT CHECK: only the requested one side segment or one corner is present. Review material scale, light, connection and actual recomposition separately; a technical transparency pass does not prove the art is suitable.',
  ].join('\n\n');
  const nativePrompt=native?[promptBase.replace('leaving at least 12 percent completely transparent empty gutter','aiming for at least 12 percent completely transparent empty gutter'),
    'NATIVE SIZE ENVELOPE: at most 4096 pixels on either axis and at most 4,194,304 total pixels; both limits apply. Keep the complete subject inside real transparent gutter on all four sides. Twelve percent is the preferred framing target; actual nonempty margins are measured and independently reviewed, never silently reported as twelve percent.',
    'FIXED RENDER ENVELOPE: visible-alpha8-outward16-native-rgba-v1. After explicit native scale and anchors are measured, the visible contour with Alpha at least 8 must lie within 16 world units outward. Preserve every original RGBA sample including Alpha 1 through 255. Any weaker tail outside the declared render window may only be clipped by presentation geometry with later measured statistics, never by source Alpha cleanup. This request does not guess world anchors or native scale.'
  ].join('\n\n'):promptBase;
  const v2=recipe.topologyGuideProfile===TERRAIN_EDGE_TOPOLOGY_V2_PROFILE;
  const v2Base=v2?nativePrompt.replace('Prefer a portrait canvas with one complete vertical segment and both end regions visible.','Prefer a portrait canvas with one vertical boundary and two open joining cuts.')
    .replace('Prefer a landscape canvas with one complete horizontal bottom segment and both ends visible.','Prefer a landscape canvas with one lower boundary and two open joining cuts.')
    .replace('Prefer a square canvas with one compact corner and both short attachment arms visible.','Prefer a square canvas with one local corner and two open joining cuts.')
    .replace('Center the ONE complete asset on its OWN canvas, aiming for at least 12 percent completely transparent empty gutter on ALL FOUR sides.','Center the ONE boundary on its OWN canvas, aiming for at least 12 percent completely transparent gutter on ALL FOUR sides. At the two inward connections show a solid cross-section ending in an open cut; do not round it into a finished end cap.')
    .replace('Keep the complete subject inside real transparent gutter on all four sides.','Keep the boundary and its two visible joining cuts inside real transparent gutter on all four sides.'):nativePrompt;
  const prompt=v2?'IMAGE 3 is a neutral topology DIAGRAM. Gray is solid material, clear pixels are outside air, and white dashed bars on the diagram frame mark the TWO OPEN CONNECTION CUTS. Those marks are explanatory symbols, never paint, text or objects. Gray touching the diagram frame indicates continuation only; the final source must have a transparent gutter outside all painted pixels, including both open cut faces. Preserve the role orientation and solid/air relationship. Do not turn either cut into a finished platform end, detached object or rounded island. Do not infer the guide shape, color, straight edge, bars or material as visual style.\n\n'+v2Base:guided?nativePrompt+'\n\nIMAGE 3 is a transparent neutral occupancy diagram, not artwork. Gray means the interior solid side and transparency means exterior. Follow its orientation and inward attachment sides for this one role; the gray frame ends are diagram cuts, not complete closed platform ends. The reference and brief own material, light and style; do not copy the gray color, straight contours, geometry or framing. Keep genuine transparent output margins around the requested subject. The diagram does not certify semantics, joins or art acceptance.':nativePrompt;
  const guide=guided?resolveTerrainEdgeTopologyGuide(recipe.topologyGuideProfile,recipe.edgeRole):null;
  return seal({format:planFormat(policy),compiler:recipe.lowerBodyProfile?'scene-kit-reference-defined-natural-perimeter-lower-body-v1':v2?'scene-kit-reference-defined-natural-perimeter-topology-v2':guided?'scene-kit-reference-defined-natural-perimeter-topology-v1':cover?'scene-kit-isolated-native-size-reference-defined-natural-perimeter-v1':native?(engineered?'scene-kit-isolated-native-size-engineered-city-perimeter-v1':'scene-kit-isolated-native-size-terrain-perimeter-v1')
      :perimeter?(engineered?'scene-kit-isolated-engineered-city-perimeter-v1':'scene-kit-isolated-terrain-perimeter-v1')
      :(engineered?'scene-kit-isolated-engineered-city-edge-v1':'scene-kit-isolated-terrain-edge-v1'),recipe,qualityPolicy:policy,
    designReviews:ref.plan.designReviews,referenceEvidence:[{planSha256:ref.plan.sha256,rawSha256:ref.result.rawSha256,
      targetSha256:ref.reconstructionTarget.sha256,acceptedPacketSha256:ref.reconstructionTarget.acceptedPacketSha256,humanReceiptSha256:ref.reconstructionTarget.humanReceiptSha256}],
    materialEvidence:{planSha256:material.plan.sha256,rawSha256:material.result.rawSha256,technicalSha256:material.result.technical.sha256,
      technicalStatus:'pass',artAcceptance:material.plan.format==='ai_scene_coherent_rebind_v1'&&!guided?'not-assessed':material.status==='accepted'?'accepted':'not-assessed'},
    instanceBinding:{instanceId:null,subjectId:null,role:'terrain-edge',edgeRole:recipe.edgeRole,content:recipe.subjectBrief.content,observedEnvelope:null},
    target:{assetId:recipe.assetId,kind:'environment',alpha:'transparent',sourcePolicy},
    sourceScope:{profile:policy.profile,...(engineered?{surfaceFamily:recipe.surfaceFamily}:{}),...(perimeter?{coverageProfile:recipe.coverageProfile,
      sourceTransforms:'identity-only-no-rotation-or-mirroring',sourceToWorldScale:'pending-explicit-native-measurement'}:{}),parentRole:'main',edgeRole:recipe.edgeRole,subjectBrief:recipe.subjectBrief,
      ...(cover?{naturalSurfaceProfile:recipe.naturalSurfaceProfile,coverAndBody:policy.coverAndBody,attachments:policy.attachments}:{}),
      ...(native?{nativeSizeProfile:recipe.nativeSizeProfile,renderEnvelopeProfile:recipe.renderEnvelopeProfile}:{}),
      ...(recipe.manufacturedMaterialProfile?{manufacturedMaterialProfile:recipe.manufacturedMaterialProfile}:{}),
      ...(recipe.gutterPolicy?{gutterPolicy:recipe.gutterPolicy}:{}),
      ...(sourceAppearance?{sourceAppearance,styleRuleInheritance:'source-owned-only-no-scene-rules'}:{}),
      ...(guided?{topologyGuideProfile:recipe.topologyGuideProfile,topologyGuideSha256:guide.artifact.sha256,topologyAcceptance:'not-assessed'}:{}),
      ...(recipe.lowerBodyProfile?{lowerBodyProfile:recipe.lowerBodyProfile}:{}),
      referenceUsage:'style-material-light-only',sceneCoordinatesInPrompt:false,semanticIsolationProven:false,alphaCleanupAllowed:false},
    visualReviewChecklist:{requiredChecks:cover?['Only the requested single boundary; correct native orientation, no neighboring content or complete platform.',
      ...(bottom&&recipe.lowerBodyProfile?[ 'Body construction and lower termination match the accepted reference, original material and explicit brief; no invented upper cap.' ]:
        ['Surface substance, thickness and cover/body boundary match the accepted reference, original material and explicit brief; an uncovered design has no invented cap.']),
      'Attached details occur only where explicitly design-specified and reference-supported; original palette, illumination and equal feature scale remain coherent.',
      'Actual transparent gutter, native joining collars, body overlap, render envelope and displayed scale require independent measurement and recomposition review.']:bottom?['Only the requested single bottom segment or lower corner; no top lip, neighboring layer content or complete platform.',
      'Original palette, feature scale, painting treatment and original scene illumination remain coherent; orientation is native, never rotated or mirrored.',
      'Complete transparent four-side gutter, native inward joining collars and short attachment arms are visible and will be measured separately.',
      'Actual body/side/bottom overlap and final displayed scale require independent recomposition review.']:engineered?['Only the requested single side edge or top corner; no neighboring layer content.',
      recipe.manufacturedMaterialProfile?'The front-face substance, feature scale, original palette, painting treatment and illumination match the bound references and brief at the final displayed size.'
        :'Coherent original palette, concrete or panel scale, painting treatment and lighting at the final displayed size.',
      'Deliberate manufactured silhouette and continuous corner joint; no mirrored lighting or stretched panels.',
      'Actual body/lip overlap preserves solid support, aligned joints and bounded attached light appearance.']:['Only the requested single side edge or top corner; no neighboring layer content.',
      'Coherent original palette, broad rock scale, brushwork and lighting at the final displayed size.',
      'Natural side silhouette and continuous corner connection; not rotated turf or a uniform moss stripe.',
      'Actual body/cover overlap hides the straight cut without exposing body through outward recesses.'],automatedSemanticDetection:false,visualAcceptance:'not-assessed'},
    request:{format:cover?'ai_scene_image_request_v37':native?(engineered?'ai_scene_image_request_v36':'ai_scene_image_request_v35')
      :perimeter?(engineered?'ai_scene_image_request_v34':'ai_scene_image_request_v33'):(engineered?'ai_scene_image_request_v30':'ai_scene_image_request_v29'),task:'terrain-edge-source',prompt,images:[
      {role:'accepted-scene-style-material-light-reference',artifact:ref.result.technical.image},
      {role:'checked-native-terrain-material-not-art-certified',artifact:material.result.technical.image},...(guided?[{role:'neutral-perimeter-occupancy-guide',artifact:guide.artifact}]:[])],
      output:{format:'png',alpha:'transparent',sourcePolicy},maximumCalls:1}});
}

export function compileTerrainEdgeBatch(state,options){
  const replacement=Object.hasOwn(options,'coverageIntent');
  exact(options,['batchId','baseBatchSha256','planSha256s',...(replacement?['coverageIntent']:[])]);id(options.batchId);
  check(!replacement||options.coverageIntent==='explicit-subset-replacement','TERRAIN_EDGE_COVERAGE_INTENT');
  const base=state.batches.get(options.baseBatchSha256);
  check(baseFormats.includes(base?.format)&&Array.isArray(options.planSha256s)&&options.planSha256s.length>0&&options.planSha256s.length<=7
    &&new Set(options.planSha256s).size===options.planSha256s.length,'TERRAIN_EDGE_BATCH');
  const roles=new Set(),assets=new Set();let binding,policy;
  for(const sha of options.planSha256s){const entry=state.plans.get(sha),plan=entry?.plan;
    check(TERRAIN_EDGE_PLAN_FORMATS.includes(plan?.format)&&entry.status==='planned'&&plan.recipe.baseBatchSha256===base.sha256
      &&!roles.has(plan.recipe.edgeRole)&&!assets.has(plan.recipe.assetId),'TERRAIN_EDGE_BATCH');
    assertTerrainEdgeCurrent(state,plan);roles.add(plan.recipe.edgeRole);assets.add(plan.recipe.assetId);
    const currentPolicy=policyFor(plan.recipe);
    if(policy)check(policy.sha256===currentPolicy.sha256,'TERRAIN_EDGE_BATCH_FAMILY');else policy=currentPolicy;
    const current=[plan.recipe.referencePlans[0],plan.recipe.targetSha256,plan.recipe.materialPlanSha256,plan.recipe.materialRawSha256,
      plan.recipe.capabilitiesSha256,plan.recipe.manufacturedMaterialProfile??null,plan.recipe.gutterPolicy??null];
    if(binding)check(digest(binding)===digest(current),'TERRAIN_EDGE_BATCH_BINDING');else binding=current;
  }
  const engineered=isEngineered(policy),perimeter=isPerimeter(policy),native=isNativeSize(policy),cover=isReferenceDefinedCover(policy),sameRoles=expected=>roles.size===expected.length&&expected.every(role=>roles.has(role)),
    bottomOnly=sameRoles(TERRAIN_BOTTOM_EDGE_ROLES),full=sameRoles(TERRAIN_PERIMETER_ROLES);
  check(perimeter?replacement||bottomOnly||full:!replacement&&roles.size<=4,'TERRAIN_EDGE_BATCH_COVERAGE');
  const coverage=perimeter?{coverageProfile:TERRAIN_PERIMETER_COVERAGE_PROFILE,
    coverage:replacement?'explicit-subset-replacement':bottomOnly?'bottom-only-upgrade':'full-perimeter',
    expectedRoles:bottomOnly&&!replacement?TERRAIN_BOTTOM_EDGE_ROLES:TERRAIN_PERIMETER_ROLES,requestedRoles:[...roles],
    fullPerimeterComplete:full}:{};
  return seal({format:cover?'ai_scene_terrain_edge_batch_v7':native?(engineered?'ai_scene_terrain_edge_batch_v6':'ai_scene_terrain_edge_batch_v5')
      :perimeter?(engineered?'ai_scene_terrain_edge_batch_v4':'ai_scene_terrain_edge_batch_v3')
      :(engineered?'ai_scene_terrain_edge_batch_v2':'ai_scene_terrain_edge_batch_v1'),...options,...coverage,...(engineered?{surfaceFamily:'engineered-city'}:{}),
    ...(cover?{naturalSurfaceProfile:policy.naturalSurfaceProfile}:{}),
    ...(native?{nativeSizeProfile:policy.nativeSizeProfile,renderEnvelopeProfile:policy.requiredRenderEnvelopeProfile}:{}),referencePlanSha256:binding[0],targetSha256:binding[1],
    materialPlanSha256:binding[2],materialRawSha256:binding[3],policySha256:policy.sha256,
    maximumCalls:options.planSha256s.length,newImageRequests:options.planSha256s.length,automaticRetry:false,scope:'listed-terrain-edges-only'});
}

export function assessTerrainEdgeSource(plan,bytes){
  const cover=plan.format==='ai_scene_generation_plan_v37',native=['ai_scene_generation_plan_v35','ai_scene_generation_plan_v36','ai_scene_generation_plan_v37'].includes(plan.format),
    engineered=['ai_scene_generation_plan_v30','ai_scene_generation_plan_v34','ai_scene_generation_plan_v36'].includes(plan.format),
    perimeter=['ai_scene_generation_plan_v33','ai_scene_generation_plan_v34'].includes(plan.format)||native;
  const warnGutter=native&&plan.recipe.gutterPolicy===TERRAIN_EDGE_GUTTER_WARNING_PROFILE;
  const base=unseal(assessCoherentSource(plan,bytes,{measureVisibleBody:warnGutter})),issues=[...base.issues];
  if(base.rawSha256===plan.materialEvidence.rawSha256)issues.push('TERRAIN_EDGE_MATERIAL_REUSE');
  let nativeEvidence={};
  if(native){
    const image=base.image,bounds=base.contentBounds;
    if(image&&image.pixelSize.width*image.pixelSize.height>plan.target.sourcePolicy.maximumPixels)issues.push('TERRAIN_EDGE_NATIVE_SIZE_PIXELS');
    const actualPaddingPixels=image&&bounds?{left:bounds.x,right:image.pixelSize.width-bounds.x-bounds.width,
      top:bounds.y,bottom:image.pixelSize.height-bounds.y-bounds.height}:null;
    const touchesBorder=actualPaddingPixels&&Object.values(actualPaddingPixels).some(v=>v<1);
    // The base scan measures the outer two-pixel band. Max Alpha 1 there
    // already guarantees a two-pixel margin around the Alpha >= 8 body.
    const warn=touchesBorder&&warnGutter&&base.edgeMaximumAlpha===1&&base.hasVisibleBody;
    if(touchesBorder&&!warn)issues.push('TERRAIN_EDGE_NATIVE_GUTTER');
    nativeEvidence={nativeSizeProfile:plan.recipe.nativeSizeProfile,renderEnvelopeProfile:plan.recipe.renderEnvelopeProfile,
      ...(warnGutter?{gutterPolicy:plan.recipe.gutterPolicy,warnings:warn?['TERRAIN_EDGE_ALPHA_ONE_GUTTER']:[]}:{}),
      maximumPixels:plan.target.sourcePolicy.maximumPixels,actualPaddingPixels,
      preferredGutterSatisfied:actualPaddingPixels?actualPaddingPixels.left*100>=image.pixelSize.width*12&&actualPaddingPixels.right*100>=image.pixelSize.width*12
        &&actualPaddingPixels.top*100>=image.pixelSize.height*12&&actualPaddingPixels.bottom*100>=image.pixelSize.height*12:false,
      renderEnvelopeMeasurement:'not-assessed-pending-explicit-native-controls'};
  }
  return seal({...base,format:cover?'ai_scene_terrain_edge_source_qa_v7':native?(engineered?'ai_scene_terrain_edge_source_qa_v6':'ai_scene_terrain_edge_source_qa_v5')
      :perimeter?(engineered?'ai_scene_terrain_edge_source_qa_v4':'ai_scene_terrain_edge_source_qa_v3')
      :(engineered?'ai_scene_terrain_edge_source_qa_v2':'ai_scene_terrain_edge_source_qa_v1'),...(engineered?{surfaceFamily:'engineered-city'}:{}),
    ...(cover?{naturalSurfaceProfile:plan.recipe.naturalSurfaceProfile,coverAndBodyAcceptance:'not-assessed'}:{}),
    ...(perimeter?{coverageProfile:TERRAIN_PERIMETER_COVERAGE_PROFILE,sourceToWorldScale:'not-assessed'}:{}),...nativeEvidence,edgeRole:plan.recipe.edgeRole,issues,status:issues.length?'fail':'pass',
    scope:'technical-png-only-not-boundary-fit-or-art-acceptance',automaticSemanticDetection:false});
}
