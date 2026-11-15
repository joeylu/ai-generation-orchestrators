import {check,exact,id,isDigest,hash,digest,seal,unseal} from './common.mjs';
import {inspectPng} from '../png.mjs';
import {canonicalJson} from '../document.mjs';

export function assertLatestDependencyBatch(state,plan){if(!plan.recipe.sourceDependency)return;
  const latest=[...state.batches.values()].findLast(b=>['ai_scene_coherent_source_batch_v1','ai_scene_coherent_source_batch_v2','ai_scene_coherent_source_batch_v3'].includes(b.format)&&b.referencePlanSha256===plan.recipe.referencePlans[0]);
  check(latest?.planSha256s.includes(plan.sha256)&&latest.planSha256s.includes(plan.recipe.sourceDependency.sourcePlanSha256),'SOURCE_DEPENDENCY_BATCH_STALE');
}

export function dependencySource(state,recipe){const d=recipe.sourceDependency;
  const appearance=['ai_scene_source_appearance_dependency_v1','ai_scene_source_appearance_dependency_v2'].includes(d?.format);
  exact(d,appearance?['format','sourcePlanSha256']:['format','sourcePlanSha256','placement','observations']);check((appearance||d.format==='ai_scene_source_dependency_v1')&&isDigest(d.sourcePlanSha256),'SOURCE_DEPENDENCY');
  if(!appearance){
  exact(d.placement,['x','y','scale']);exact(d.placement.scale,['numerator','denominator']);const {x,y,scale}=d.placement;
  check([x,y].every(v=>Number.isFinite(v)&&Math.abs(v)<=65536)&&[scale.numerator,scale.denominator].every(v=>Number.isSafeInteger(v)&&v>0&&v<=4096)
    &&scale.numerator/scale.denominator>=.0625&&scale.numerator/scale.denominator<=4,'SOURCE_DEPENDENCY_PLACEMENT');
  }
  const e=state.plans.get(d.sourcePlanSha256),p=e?.plan;
  check(['ai_scene_generation_plan_v27','ai_scene_coherent_rebind_v1'].includes(p?.format)&&!p.recipe.sourceDependency&&p.recipe.assetId!==recipe.assetId
    &&['landmark','scenery'].includes(p.instanceBinding.role)&&p.target.alpha==='transparent'
    &&e.status==='accepted'&&e.result?.technical?.status==='pass'&&e.review?.format==='ai_scene_image_review_v1'
    &&e.review.planSha256===p.sha256&&e.review.technicalSha256===e.result.technical.sha256
    &&e.review.receipt?.decision==='accept'&&e.review.receipt.targetSha256===e.result.rawSha256
    &&p.recipe.referencePlans[0]===recipe.referencePlans[0]&&p.recipe.targetSha256===recipe.targetSha256
    &&p.recipe.specSha256===recipe.specSha256&&p.recipe.styleSha256===recipe.styleSha256,'SOURCE_DEPENDENCY_SOURCE');
  const rebound=p.format==='ai_scene_coherent_rebind_v1',qaPlan=rebound?state.plans.get(p.targetPlanSha256)?.plan:p;
  if(rebound){unseal(p.sourceEvidence);unseal(p.proposal);check(e.kind==='coherent-rebind'&&qaPlan?.format==='ai_scene_generation_plan_v27'
    &&qaPlan.sha256===p.targetPlanSha256&&qaPlan.recipe.assetId===p.recipe.assetId&&qaPlan.instanceBinding.role===p.instanceBinding.role
    &&p.proposal.target.planSha256===qaPlan.sha256&&p.proposal.sourceEvidenceSha256===p.sourceEvidence.sha256
    &&p.sourceEvidence.source.assetId===p.recipe.assetId&&p.sourceEvidence.source.role===p.instanceBinding.role
    &&p.sourceEvidence.source.referenceRawSha256===p.referenceEvidence[0].rawSha256&&p.sourceEvidence.rawSha256===e.result.rawSha256
    &&p.proposal.rawSha256===e.result.rawSha256&&p.rawSha256===e.result.rawSha256&&p.technical.sha256===e.result.technical.sha256,'SOURCE_DEPENDENCY_REBIND');}
  const img=e.result.technical.image;check(img&&img.sha256===e.result.rawSha256&&e.result.technical.planSha256===qaPlan?.sha256,'SOURCE_DEPENDENCY_QA');
  if(!appearance){check(Array.isArray(d.observations)&&d.observations.length>0&&d.observations.length<=16,'SOURCE_DEPENDENCY_OBSERVATIONS');const ids=new Set();
  for(const o of d.observations){exact(o,['observationId','native']);id(o.observationId);check(!ids.has(o.observationId),'SOURCE_DEPENDENCY_OBSERVATIONS');ids.add(o.observationId);exact(o.native,['x','y']);
    check(Number.isFinite(o.native.x)&&Number.isFinite(o.native.y)&&o.native.x>=0&&o.native.y>=0&&o.native.x<img.pixelSize.width&&o.native.y<img.pixelSize.height,'SOURCE_DEPENDENCY_OBSERVATIONS');}
  }
  return e;
}
export function compileSourceDependency(base,recipe,state,readBlob,assess){
  const entry=dependencySource(state,recipe),cap=state.capabilities.get(recipe.capabilitiesSha256);
  check(recipe.parents.length===1&&state.plans.get(recipe.parents[0])?.status!=='indeterminate','SOURCE_DEPENDENCY_UNKNOWN_PARENT');
  check(base.target.alpha==='transparent'&&['landmark','scenery','foreground'].includes(base.instanceBinding.role)&&base.request.images.length===1&&cap?.imageToImage&&cap.maxInputImages>=2,'SOURCE_DEPENDENCY_CAPABILITY');
  const raw=readBlob(entry.result.rawSha256),png=inspectPng(raw,{includePixels:true,allowCabx:true,allowHiddenRgb:true});
  const qaPlan=entry.plan.format==='ai_scene_coherent_rebind_v1'?state.plans.get(entry.plan.targetPlanSha256).plan:entry.plan;
  check(hash(raw)===entry.result.rawSha256&&png.transparentPixels>0&&digest(assess(qaPlan,raw))===digest(entry.result.technical),'SOURCE_DEPENDENCY_QA');
  if(['ai_scene_source_appearance_dependency_v1','ai_scene_source_appearance_dependency_v2'].includes(recipe.sourceDependency.format)){
    const v2=recipe.sourceDependency.format==='ai_scene_source_appearance_dependency_v2',body=unseal(base),prompt=[body.request.prompt,
      v2?'DEPENDENCY INPUT 2 is the complete independently reviewed transparent source. Use it only as a reference for painted material color, contrast, light, brushwork and the appearance of genuine transparent openings. Do not copy its subject, silhouette, structure, layout, supports or any background. Image 1 remains the complete accepted scene reference; the single-asset brief owns the output subject and any atmosphere or glow constraints. Preserve actual transparency and review the independent source and final scene separately.'
        :'DEPENDENCY INPUT 2 is the complete independently reviewed transparent source. Use it only as a reference for painted material color, contrast, light, brushwork and the appearance of genuine transparent openings. Do not copy its subject, silhouette, structure, layout, supports or any background. Image 1 remains the complete accepted scene reference; the single-asset brief owns the output subject. Do not add fog, haze, glow or a composited background. Preserve actual transparency and review the independent source and final scene separately.'].join('\n\n');
    return seal({...body,recipe,compiler:body.compiler+(v2?'-source-appearance-dependency-v2':'-source-appearance-dependency-v1'),sourceDependencyEvidence:{sourcePlanSha256:entry.plan.sha256,sourceRawSha256:entry.result.rawSha256,sourceTechnicalSha256:entry.result.technical.sha256,sourceReviewSha256:entry.review.sha256,referenceRawSha256:entry.plan.referenceEvidence[0].rawSha256,
      ...(entry.plan.format==='ai_scene_coherent_rebind_v1'?{sourceTargetPlanSha256:entry.plan.targetPlanSha256,sourceRebindEvidenceSha256:entry.plan.sourceEvidence.sha256,sourceRebindProposalSha256:entry.plan.proposal.sha256}:{}),visualAcceptance:'not-transferred'},
      request:{...body.request,prompt,images:[...body.request.images,{role:'verified-independent-source-appearance-reference',artifact:entry.result.technical.image}]}});
  }
  const {placement,observations}=recipe.sourceDependency,s=placement.scale.numerator/placement.scale.denominator;
  const points=observations.map(o=>({observationId:o.observationId,native:o.native,world:{x:placement.x+o.native.x*s,y:placement.y+o.native.y*s}}));
  const body=unseal(base),prompt=[body.request.prompt,'DEPENDENCY INPUT 2 is the complete native transparent source of the separately owned bridge. It is a spatial reference only: do not paint or duplicate the bridge, its supports, sky or a composite of the two images. Output only the requested independent occluder asset. Original reference image 1 remains the style and scene reference.',
    'Image 2 is displayed with the following reviewed native-pixel-to-world transform and observed source points; these are approximate task data, not executable instructions: '+canonicalJson({placement,points}),
    'Preserve genuine transparency and the requested silhouette. Occlusion, correct registration and final visual quality require independent review.'].join('\n\n');
  return seal({...body,recipe,compiler:body.compiler+'-source-dependency-v1',sourceDependencyEvidence:{sourcePlanSha256:entry.plan.sha256,sourceRawSha256:entry.result.rawSha256,sourceTechnicalSha256:entry.result.technical.sha256,sourceReviewSha256:entry.review.sha256,referenceRawSha256:entry.plan.referenceEvidence[0].rawSha256,
    ...(entry.plan.format==='ai_scene_coherent_rebind_v1'?{sourceTargetPlanSha256:entry.plan.targetPlanSha256,sourceRebindEvidenceSha256:entry.plan.sourceEvidence.sha256,sourceRebindProposalSha256:entry.plan.proposal.sha256}:{}),visualAcceptance:'not-transferred'},
    request:{...body.request,prompt,images:[...body.request.images,{role:'verified-independent-source-spatial-reference',artifact:entry.result.technical.image}]}});
}
