import {check,digest,exact,hash,id,imageRef,seal,unseal} from './common.mjs';
import {validateBandFeatureRelations} from './band-feature-relations.mjs';

// Evaluates only explicit reviewer measurements; it does not detect features.
export function reviewBandFeatureRelations({plan,technical,rawBytes,observations,relationScale}) {
  unseal(plan);unseal(technical);
  const scope=plan.sourceScope?.definition;unseal(scope);
  const relations=validateBandFeatureRelations(scope.bandFeatureRelations),raw=imageRef(rawBytes,{allowHiddenRgb:true,allowCabx:true});
  check(plan.format==='ai_scene_generation_plan_v27'&&plan.recipe?.sourceScope?.sha256===scope.sha256
    &&plan.sourceScope.bandFeatureRelationsSha256===digest(relations)
    &&technical.format==='ai_scene_coherent_source_qa_v1'&&technical.planSha256===plan.sha256
    &&technical.rawSha256===raw.sha256&&technical.image?.sha256===raw.sha256
    &&technical.image?.byteLength===raw.byteLength&&digest(technical.image.pixelSize)===digest(raw.pixelSize), 'BAND_RELATION_REVIEW_BINDING');
  check(Array.isArray(observations)&&observations.length<=relations.features.length,'BAND_RELATION_OBSERVATIONS');
  const ids=new Set(relations.features.map(f=>f.featureId)),points=new Map();
  for(const o of observations){exact(o,['featureId','x','y']);id(o.featureId);check(ids.has(o.featureId)&&!points.has(o.featureId),'BAND_RELATION_OBSERVATIONS');
    for(const axis of ['x','y'])check(Array.isArray(o[axis])&&o[axis].length===2&&o[axis].every(Number.isFinite)&&o[axis][0]>=0&&o[axis][1]<=1&&o[axis][0]<=o[axis][1],'BAND_RELATION_OBSERVATION_RANGE');
    points.set(o.featureId,o);
  }
  const findings=relations.relations.map(r=>{
    const a=points.get(r.from),b=points.get(r.to);
    if(!a||!b)return {from:r.from,to:r.to,axis:r.axis,status:'missing'};
    const range=[b[r.axis][0]-a[r.axis][1],b[r.axis][1]-a[r.axis][0]].map(value=>value*(relationScale?.[r.axis]??1));
    const status=range[0]>=r.min&&range[1]<=r.max?'satisfied':range[1]<r.min||range[0]>r.max?'violated':'uncertain';
    return {from:r.from,to:r.to,axis:r.axis,observedDelta:range,requestedDelta:[r.min,r.max],status};
  });
  const missingFeatures=relations.features.filter(f=>!points.has(f.featureId)).map(f=>f.featureId);
  return seal({format:'ai_scene_band_feature_relation_review_v1',planSha256:plan.sha256,technicalSha256:technical.sha256,
    raw,relationsSha256:digest(relations),observationsSha256:digest(observations),...(relationScale?{recalibratedRelationScale:relationScale}:{}),findings,missingFeatures,
    status:technical.status==='pass'&&missingFeatures.length===0&&findings.every(f=>f.status==='satisfied')?'reviewed':'blocked',
    automaticImageUnderstanding:false,observationAccuracy:'not-verified',technicalStatus:technical.status,
    studioRecomposition:'not-assessed',humanArtAcceptance:'not-assessed',generationCalls:0});
}
export function assertBandFeatureRelations(inputs,report){unseal(report);const actual=reviewBandFeatureRelations(inputs);
  check(digest(actual)===digest(report),'BAND_RELATION_REVIEW_STALE');check(actual.status==='reviewed','BAND_RELATION_REVIEW_BLOCKED');return actual;}
