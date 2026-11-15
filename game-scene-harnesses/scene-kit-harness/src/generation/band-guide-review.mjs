import {check,digest,exact,id,imageRef,seal,unseal} from './common.mjs';
import {bandCompositionGuide} from './band-composition-guide.mjs';
import {isRegisteredMasterSpec,describeRegisteredMasterGuide} from './registered-layout-master.mjs';

// Reviewer-supplied intervals are not feature detection.
export function reviewBandGuide({plan,technical,rawBytes,observations,referenceBytes,world}){
  unseal(plan);unseal(technical);const scope=plan.sourceScope?.definition;unseal(scope);
  check(plan.format==='ai_scene_generation_plan_v27'&&scope.bandCompositionGuide&&plan.recipe.sourceScope.sha256===scope.sha256
    &&scope.bandCompositionGuide.spec.referenceRawSha256===plan.referenceEvidence?.[0]?.rawSha256,'BAND_GUIDE_REVIEW_BINDING');
  const guide=isRegisteredMasterSpec(scope.bandCompositionGuide.spec)?describeRegisteredMasterGuide({band:scope.backgroundBand,role:plan.instanceBinding.role,...scope.bandCompositionGuide}):bandCompositionGuide({band:scope.backgroundBand,role:plan.instanceBinding.role,...scope.bandCompositionGuide,referenceBytes}),native=imageRef(rawBytes,{allowHiddenRgb:true,allowCabx:true});
  check(plan.sourceScope.backgroundBandGuideEvidence?.recipeSha256===guide.recipe.sha256&&plan.sourceScope.backgroundBandGuideEvidence?.rawSha256===guide.artifact.sha256
    &&technical.format==='ai_scene_coherent_source_qa_v1'&&technical.planSha256===plan.sha256&&technical.rawSha256===native.sha256
    &&technical.image?.sha256===native.sha256&&technical.image?.byteLength===native.byteLength&&digest(technical.image.pixelSize)===digest(native.pixelSize),'BAND_GUIDE_REVIEW_BINDING');
  const features=scope.bandCompositionGuide.spec.features;check(Array.isArray(observations)&&observations.length<=features.length,'BAND_GUIDE_OBSERVATIONS');
  const points=new Map(),ids=new Set(features.map(f=>f.featureId));for(const o of observations){exact(o,['featureId','x','y']);id(o.featureId);check(ids.has(o.featureId)&&!points.has(o.featureId),'BAND_GUIDE_OBSERVATIONS');
    for(const axis of ['x','y'])check(Array.isArray(o[axis])&&o[axis].length===2&&o[axis].every(Number.isFinite)&&o[axis][0]>=0&&o[axis][1]<=1&&o[axis][0]<=o[axis][1],'BAND_GUIDE_OBSERVATIONS');points.set(o.featureId,o);}
  const findings=features.map(f=>{const p=points.get(f.featureId);if(!p)return {featureId:f.featureId,status:'missing'};
    const axes=['x','y'].map(a=>{const v=world?p[a].map(n=>world.positionWorld[a]+n*world.span[a]):p[a],wanted=world?f.target[a]:f.native[a];return v[0]>=wanted[0]&&v[1]<=wanted[1]?'satisfied':v[1]<wanted[0]||v[0]>wanted[1]?'violated':'uncertain';});
    return {featureId:f.featureId,status:axes.includes('violated')?'violated':axes.includes('uncertain')?'uncertain':'satisfied'};});
  return seal({format:'ai_scene_band_guide_review_v1',planSha256:plan.sha256,technicalSha256:technical.sha256,raw:native,
    guideRecipeSha256:guide.recipe.sha256,observationsSha256:digest(observations),...(world?{recalibratedWorld:world}:{}),findings,
    status:technical.status==='pass'&&findings.every(x=>x.status==='satisfied')?'reviewed':'blocked',automaticImageUnderstanding:false,
    observationAccuracy:'not-verified',studioRecomposition:'not-assessed',humanArtAcceptance:'not-assessed',generationCalls:0});
}
export function assertBandGuide(inputs,report){unseal(report);const actual=reviewBandGuide(inputs);
  check(digest(actual)===digest(report),'BAND_GUIDE_REVIEW_STALE');check(actual.status==='reviewed','BAND_GUIDE_REVIEW_BLOCKED');return actual;}
