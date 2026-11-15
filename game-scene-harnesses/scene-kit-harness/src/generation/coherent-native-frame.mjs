import {assertCurrent} from './compiler.mjs';
import {assessCoherentSource} from './coherent-source.mjs';
import {createBackgroundBandPlacement} from '../background-band-placement.mjs';
import {resolveReferenceFeatureTargets} from '../reference-feature-layout.mjs';
import {check,digest,exact,hash,id,receipt as validateReceipt,seal,unseal} from './common.mjs';
import {isRegisteredLocalEdit} from './registered-layout-master.mjs';
import {reviewBandGuide} from './band-guide-review.mjs';
import {reviewBandFeatureRelations} from './band-feature-relation-review.mjs';

export const COHERENT_NATIVE_FRAME_FORMAT='ai_scene_coherent_native_frame_preparation_v1';

export function compileCoherentNativeFrameProposal(store,state,options){
  exact(options,['sourcePlanSha256','parentBatchSha256','positionWorld','sourceToWorld','observations']);
  const {sourcePlanSha256,parentBatchSha256,positionWorld,sourceToWorld,observations}=options;
  const entry=state.plans.get(sourcePlanSha256),plan=entry?.plan,band=plan?.recipe.sourceScope?.backgroundBand;
  const spec=plan?.recipe.sourceScope?.bandCompositionGuide?.spec;
  check(plan?.format==='ai_scene_generation_plan_v27'&&isRegisteredLocalEdit(spec)&&entry.status==='rejected-technical',
    'COHERENT_NATIVE_FRAME_SOURCE');
  assertCurrent(state,plan);
  const batch=state.batches.get(parentBatchSha256),target=state.plans.get(plan.recipe.referencePlans[0])?.reconstructionTarget;
  check(batch?.planSha256s.includes(plan.sha256)&&batch.targetSha256===target?.sha256&&plan.recipe.targetSha256===target.sha256,
    'COHERENT_NATIVE_FRAME_BATCH');
  const {result}=entry,raw=store.readBlob(result.rawSha256),oldQa=assessCoherentSource(plan,raw);
  check(oldQa.sha256===result.technical.sha256&&oldQa.issues.length===1&&oldQa.issues[0]==='REGISTERED_LOCAL_EDIT_SIZE',
    'COHERENT_NATIVE_FRAME_ORIGINAL_QA');
  const actual=oldQa.image.pixelSize,expected=spec.master.artifact.pixelSize;
  const widthDelta=Math.abs(actual.width-expected.width),heightDelta=Math.abs(actual.height-expected.height);
  check(widthDelta+heightDelta===1,'COHERENT_NATIVE_FRAME_DELTA');
  const technical=assessCoherentSource(plan,raw,{recalibrateNativeFrame:true});
  check(technical.status==='pass','COHERENT_NATIVE_FRAME_QA');
  const placement=createBackgroundBandPlacement({plan,raw,target,positionWorld,sourceToWorld});
  const prepared={placement,technical,rawSha256:hash(raw),observations};
  const {guide,relations}=reviewNativeFrameBands({plan,raw,prepared,observations});
  check(guide.status==='reviewed'&&relations.status==='reviewed','COHERENT_NATIVE_FRAME_FEATURES');
  const {referenceStructure,featureCorrection,featureSupplement}=plan.recipe.sourceScope;
  const structure=resolveReferenceFeatureTargets(referenceStructure,featureCorrection,featureSupplement).assets.find(asset=>asset.instanceId===plan.recipe.assetId);
  const scale=sourceToWorld.numerator/sourceToWorld.denominator;
  check(structure&&structure.features.length===observations.length,'COHERENT_NATIVE_FRAME_STRUCTURE');
  for(const feature of structure.features){
    const sample=observations.find(item=>item.featureId===feature.featureId);
    check(sample,'COHERENT_NATIVE_FRAME_STRUCTURE');
    const x=positionWorld.x+actual.width*scale*(sample.x[0]+sample.x[1])/2;
    const y=positionWorld.y+actual.height*scale*(sample.y[0]+sample.y[1])/2;
    check(Math.hypot(x-feature.target.x,y-feature.target.y)<=feature.toleranceWorld,'COHERENT_NATIVE_FRAME_STRUCTURE');
  }
  return seal({format:'ai_scene_coherent_native_frame_proposal_v1',...options,sourceResultSha256:result.sha256,
    originalTechnicalSha256:oldQa.sha256,originalRawSha256:hash(raw),backgroundBandSha256:digest(band),
    originalFrame:expected,actualFrame:actual,placement,technical,guide,relations,maximumNewImageCalls:0,
    originalPngModified:false,sourceArtAcceptance:'not-granted'});
}

export function reviewNativeFrameBands({plan,raw,prepared,observations}){
  check(digest(observations)===digest(prepared.observations),'COHERENT_NATIVE_FRAME_OBSERVATIONS');
  const {placement,technical}=prepared,{nativeFrame,positionWorld}=placement;
  const {master}=plan.recipe.sourceScope.bandCompositionGuide.spec;
  const scale=placement.sourceToWorld.numerator/placement.sourceToWorld.denominator;
  const originalScale=master.sourceToWorld.numerator/master.sourceToWorld.denominator;
  const frame={x:nativeFrame.width,y:nativeFrame.height};
  const baseline={x:master.artifact.pixelSize.width*originalScale,y:master.artifact.pixelSize.height*originalScale};
  const world={positionWorld,span:{x:frame.x*scale,y:frame.y*scale}};
  const relationScale={x:world.span.x/baseline.x,y:world.span.y/baseline.y};
  return {guide:reviewBandGuide({plan,technical,rawBytes:raw,observations,world}),
    relations:reviewBandFeatureRelations({plan,technical,rawBytes:raw,observations,relationScale})};
}

export function compileCoherentNativeFramePreparation(store,state,{preparationId,proposal,receipt}){
  id(preparationId);unseal(proposal);
  const {sourcePlanSha256,parentBatchSha256,positionWorld,sourceToWorld,observations}=proposal;
  const actual=compileCoherentNativeFrameProposal(store,state,{sourcePlanSha256,parentBatchSha256,positionWorld,sourceToWorld,observations});
  check(actual.sha256===proposal.sha256,'COHERENT_NATIVE_FRAME_PROPOSAL_CHANGED');
  validateReceipt(receipt,'review');check(receipt.decision==='accept'&&receipt.targetSha256===proposal.sha256,'COHERENT_NATIVE_FRAME_REVIEW');
  const p=state.plans.get(sourcePlanSha256).plan;
  return seal({format:COHERENT_NATIVE_FRAME_FORMAT,sourcePlanSha256,proposal,receipt,rawSha256:proposal.originalRawSha256,
    originalRawSha256:proposal.originalRawSha256,originalTechnicalSha256:proposal.originalTechnicalSha256,technical:proposal.technical,
    recipe:{...p.recipe,planId:preparationId,parents:[p.sha256]},designReviews:p.designReviews,referenceEvidence:p.referenceEvidence,
    instanceBinding:p.instanceBinding,sourceScope:p.sourceScope,target:p.target,qualityPolicy:p.qualityPolicy,visualReviewChecklist:p.visualReviewChecklist,
    request:{format:'ai_scene_no_generation_request_v1',maximumCalls:0},sourceArtAcceptance:'not-granted'});
}
