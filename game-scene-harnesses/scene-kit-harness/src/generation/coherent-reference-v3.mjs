import {compileCoherentReferenceV2,coherentReferencePromptV2} from './coherent-reference-v2.mjs';
import {REFERENCE_GUIDANCE_PROFILE} from '../reference-controls-v2.mjs';
import {COMPOSITION_GUIDANCE_PROFILE,validateCompositionGuide} from './composition-guide.mjs';
import {check,digest,exact,isDigest,seal,unseal} from './common.mjs';

export function compileCoherentReferenceV3(state,recipe,readBlob){
  exact(recipe,['planId','parents','stage','mode','specSha256','styleSha256','capabilitiesSha256','referencePlans','inventoryRefs','assetId','pixelPolicy','intent','referenceGuidanceProfile','compositionGuideSha256']);
  check(recipe.referenceGuidanceProfile===COMPOSITION_GUIDANCE_PROFILE,'COHERENT_REFERENCE_GUIDANCE_PROFILE');
  check(Array.isArray(recipe.parents)&&recipe.parents.length<=1,'PLAN_PARENT');
  if(recipe.parents.length){
    const parent=state.plans.get(recipe.parents[0]);
    check(['ai_scene_generation_plan_v28','ai_scene_generation_plan_v31','ai_scene_generation_plan_v32'].includes(parent?.plan.format)
      &&['failed','indeterminate','rejected-technical','rejected-visual'].includes(parent.status),'PLAN_PARENT');
  }
  check(typeof readBlob==='function','COMPOSITION_GUIDE_BLOB_REQUIRED');
  check(isDigest(recipe.compositionGuideSha256),'COMPOSITION_GUIDE_REQUIRED');
  const guide=state.compositionGuides?.get(recipe.compositionGuideSha256);
  check(guide?.sha256===recipe.compositionGuideSha256,'COMPOSITION_GUIDE_REQUIRED');
  validateCompositionGuide(state,guide,readBlob);
  check(recipe.specSha256===state.activeSpec,'COMPOSITION_GUIDE_ACTIVE_SPEC');
  const spec=state.designs.get(recipe.specSha256),style=state.designs.get(recipe.styleSha256);
  check(guide.specSha256===spec?.sha256&&guide.requirementsSha256===spec?.requirements.sha256,'COMPOSITION_GUIDE_BINDING');
  const {compositionGuideSha256,...baseRecipe}=recipe;
  const base=unseal(compileCoherentReferenceV2(state,{...baseRecipe,parents:[],referenceGuidanceProfile:REFERENCE_GUIDANCE_PROFILE})),cap=state.capabilities.get(recipe.capabilitiesSha256);
  check(base.request.images.length+1<=cap.maxInputImages,'COHERENT_COMPOSITION_CAPABILITY');
  return seal({...base,format:'ai_scene_generation_plan_v32',compiler:'scene-kit-coherent-reference-v3',recipe,
    compositionGuideEvidence:{compositionGuideSha256:guide.sha256,specSha256:guide.specSha256,requirementsSha256:guide.requirementsSha256,
      imageSha256:guide.image.sha256,receiptSha256:digest(guide.receipt),purpose:guide.purpose,pixelLocking:false},
    inputPolicy:{...base.inputPolicy,uploads:'style-images-and-explicit-accepted-soft-composition-guide',
      compositionGuideUsage:'relative-position-and-occlusion-only',compositionPixelLocking:false},
    request:{...base.request,format:'ai_scene_image_request_v32',prompt:coherentReferencePromptV2(spec,style,base.target,recipe.intent,{compositionGuide:true}),images:[
      ...base.request.images.slice(0,2),{role:'accepted-soft-composition-guide',artifact:guide.image},...base.request.images.slice(2)]}});
}
