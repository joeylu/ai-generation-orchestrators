import {check,digest,exact,imageRef,unseal} from './common.mjs';
import {assertBandFeatureRelations} from './band-feature-relation-review.mjs';
import {assertBandGuide} from './band-guide-review.mjs';
import {validateBackgroundBandPlacement} from '../background-band-placement.mjs';
import {COHERENT_NATIVE_FRAME_FORMAT,reviewNativeFrameBands} from './coherent-native-frame.mjs';

function checkNativeFrameReport(source,row,key){
  check(source.reviewPlan?.sha256===source.plan.sourcePlanSha256&&source.result.technical.sha256===source.plan.proposal.technical.sha256,
    'COHERENT_NATIVE_FRAME_REVIEW_BINDING');
  const actual=reviewNativeFrameBands({plan:source.reviewPlan,raw:source.raw,prepared:source.plan.proposal,observations:row.observations})[key];
  unseal(row.report);
  check(actual.status==='reviewed'&&actual.sha256===row.report.sha256,'COHERENT_NATIVE_FRAME_REVIEW_STALE');
}

// The caller must resolve sources and reviewPlan from the replayed workflow;
// observations and reports are reviewer data, never provenance by themselves.
export function assertCandidateBandRelationReviews(sources,reviews){
  const required=sources.filter(s=>s.plan.sourceScope?.definition?.bandFeatureRelations);
  check(reviews===null||Array.isArray(reviews),'BAND_RELATION_GATE_INPUT');
  const rows=reviews??[];check(rows.length===required.length,'BAND_RELATION_GATE_REQUIRED');
  const seen=new Set();for(const row of rows){exact(row,['planSha256','observations','report']);
    check(!seen.has(row.planSha256),'BAND_RELATION_GATE_DUPLICATE');seen.add(row.planSha256);
    const source=required.find(s=>s.plan.sha256===row.planSha256);check(source,'BAND_RELATION_GATE_SOURCE');
    if(source.plan.format===COHERENT_NATIVE_FRAME_FORMAT){checkNativeFrameReport(source,row,'relations');continue;}
    const p=source.reviewPlan??source.plan;
    check(p.format==='ai_scene_generation_plan_v27'&&(p.sha256===source.plan.sha256
      ||source.plan.format==='ai_scene_coherent_rebind_v1'&&source.plan.targetPlanSha256===p.sha256),'BAND_RELATION_GATE_PLAN');
    assertBandFeatureRelations({plan:p,technical:source.result.technical,rawBytes:source.raw,observations:row.observations},row.report);
  }
  return required.length?rows:null;
}
export function assertCandidateBandGuideReviews(sources,reviews,referenceBytes){
  const required=sources.filter(s=>s.plan.sourceScope?.definition?.bandCompositionGuide);
  check(reviews===null||Array.isArray(reviews),'BAND_GUIDE_GATE_INPUT');const rows=reviews??[];
  check(rows.length===required.length,'BAND_GUIDE_GATE_REQUIRED');const seen=new Set();
  for(const row of rows){exact(row,['planSha256','observations','report']);check(!seen.has(row.planSha256),'BAND_GUIDE_GATE_DUPLICATE');seen.add(row.planSha256);
    const source=required.find(s=>s.plan.sha256===row.planSha256);check(source,'BAND_GUIDE_GATE_SOURCE');const p=source.reviewPlan??source.plan;
    if(source.plan.format===COHERENT_NATIVE_FRAME_FORMAT){checkNativeFrameReport(source,row,'guide');continue;}
    check(p.format==='ai_scene_generation_plan_v27'&&(p.sha256===source.plan.sha256||source.plan.format==='ai_scene_coherent_rebind_v1'&&source.plan.targetPlanSha256===p.sha256),'BAND_GUIDE_GATE_PLAN');
    assertBandGuide({plan:p,technical:source.result.technical,rawBytes:source.raw,observations:row.observations,referenceBytes},row.report);
  }return required.length?rows:null;
}
export function assertBandReviewObservationsAgree(relations,guides){
  for(const guide of guides??[]){const relation=(relations??[]).find(r=>r.planSha256===guide.planSha256);check(relation,'BAND_GUIDE_RELATION_REQUIRED');
    const normalized=rows=>[...rows].sort((a,b)=>a.featureId.localeCompare(b.featureId));
    check(digest(normalized(guide.observations))===digest(normalized(relation.observations)),'BAND_GUIDE_OBSERVATIONS_DIFFER');
  }
}
// Evaluate the same observed native intervals under the exact authored
// placement; the guide's abstract feasibility witness is not a placement.
export function assertBandGuideWorldPlacement(sources,guides,composition,target){
  for(const review of guides??[]){const source=sources.find(s=>s.plan.sha256===review.planSha256);check(source,'BAND_GUIDE_WORLD_SOURCE');
    check(Array.isArray(composition?.bandPlacements),'BAND_GUIDE_WORLD_PLACEMENT');
    const matches=composition.bandPlacements.filter(p=>p.instanceId===source.plan.recipe.assetId);check(matches.length===1,'BAND_GUIDE_WORLD_PLACEMENT');
    const placement=matches[0];validateBackgroundBandPlacement(placement,{plan:source.plan,raw:source.raw,target});
    if(source.plan.format===COHERENT_NATIVE_FRAME_FORMAT){
      const reviewed=source.plan.proposal.placement;
      check(digest(placement.positionWorld)===digest(reviewed.positionWorld)&&digest(placement.sourceToWorld)===digest(reviewed.sourceToWorld),
        'COHERENT_NATIVE_FRAME_PLACEMENT_STALE');
    }
    const {width,height}=imageRef(source.raw,{allowCabx:true,allowHiddenRgb:true}).pixelSize,scale=placement.sourceToWorld.numerator/placement.sourceToWorld.denominator,
      features=source.plan.sourceScope.definition.bandCompositionGuide.spec.features,observations=new Map(review.observations.map(o=>[o.featureId,o]));
    for(const f of features){const point=observations.get(f.featureId);check(point,'BAND_GUIDE_WORLD_MISSING');
      for(const [axis,size]of [['x',width],['y',height]]){const world=point[axis].map(v=>placement.positionWorld[axis]+v*size*scale),wanted=f.target[axis];
        check(world[0]>=wanted[0]&&world[1]<=wanted[1],'BAND_GUIDE_WORLD_MISMATCH');}
    }
  }
}
