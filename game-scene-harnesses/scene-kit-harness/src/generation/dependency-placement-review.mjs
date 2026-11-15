import {check,digest,hash,seal,unseal} from './common.mjs';

// This checks the actual compiled node and its deterministic crop/sampling
// evidence, not a claimed author transform. It does not assess visual contact.
export function reviewDependencyPlacement({dependentPlan,sourcePlan,sourceRaw,placementEvidence,compiled,maximumWorldError=1}){
  unseal(dependentPlan);unseal(sourcePlan);unseal(placementEvidence);
  const d=dependentPlan.recipe?.sourceDependency,e=dependentPlan.sourceDependencyEvidence;
  check(d?.format==='ai_scene_source_dependency_v1'&&d.sourcePlanSha256===sourcePlan.sha256
    &&e?.sourcePlanSha256===sourcePlan.sha256&&e.sourceRawSha256===hash(sourceRaw)
    &&placementEvidence.format==='ai_scene_coherent_asset_placement_v1'&&placementEvidence.sourceSha256===hash(sourceRaw),'DEPENDENCY_PLACEMENT_SOURCE');
  check(Number.isFinite(maximumWorldError)&&maximumWorldError>=0&&maximumWorldError<=2,'DEPENDENCY_PLACEMENT_TOLERANCE');
  const {contentSha256,...scene}=compiled??{};check(contentSha256===digest(scene)&&Array.isArray(scene.layers),'DEPENDENCY_PLACEMENT_SCENE');
  const nodes=scene.layers.flatMap(layer=>layer.nodes).filter(n=>n.nodeId==='visual/'+sourcePlan.recipe.assetId);
  check(nodes.length===1,'DEPENDENCY_PLACEMENT_NODE');const node=nodes[0],crop=placementEvidence.sourceCrop,out=placementEvidence.outputSize,margin=placementEvidence.transparentMarginPx;
  const targetNodes=scene.layers.flatMap(layer=>layer.nodes).filter(n=>n.nodeId==='visual/'+dependentPlan.recipe.assetId);
  check(targetNodes.length===1,'DEPENDENCY_PLACEMENT_NODE');const sourceLayer=scene.layers.find(l=>l.layerId===node.layerId),targetLayer=scene.layers.find(l=>l.layerId===targetNodes[0].layerId);
  check(sourceLayer&&targetLayer&&digest(sourceLayer.parallax)===digest(targetLayer.parallax),'DEPENDENCY_PLACEMENT_PARALLAX');
  check(node.assetId==='scene.'+sourcePlan.recipe.assetId&&node.source?.sha256===placementEvidence.derivedSha256
    &&node.renderStyle?.tint===0xffffff&&node.renderStyle?.opacity===1&&node.sourceToLogical?.numerator>0&&node.sourceToLogical?.denominator>0
    &&Number.isFinite(node.position?.x)&&Number.isFinite(node.position?.y)
    &&crop?.width>0&&crop?.height>0&&out?.width>2*margin&&out?.height>2*margin&&Number.isInteger(margin)&&margin>=0,'DEPENDENCY_PLACEMENT_NODE');
  const factor=node.sourceToLogical.numerator/node.sourceToLogical.denominator,s=d.placement.scale.numerator/d.placement.scale.denominator;
  check(Array.isArray(d.observations)&&Number.isFinite(s)&&s>0&&Number.isFinite(d.placement.x)&&Number.isFinite(d.placement.y),'DEPENDENCY_PLACEMENT_POINTS');const rows=d.observations.map(o=>{
    const p=o.native;check(p.x>=crop.x&&p.y>=crop.y&&p.x<=crop.x+crop.width&&p.y<=crop.y+crop.height,'DEPENDENCY_PLACEMENT_CROP');
    const expected={x:d.placement.x+p.x*s,y:d.placement.y+p.y*s};
    const actual={x:node.position.x+(margin+(p.x-crop.x)*(out.width-2*margin)/crop.width)*factor,
      y:node.position.y+(margin+(p.y-crop.y)*(out.height-2*margin)/crop.height)*factor};
    return {observationId:o.observationId,expected,actual,error:Math.hypot(actual.x-expected.x,actual.y-expected.y)};
  });
  check(rows.length>0,'DEPENDENCY_PLACEMENT_POINTS');
  return seal({format:'ai_scene_dependency_placement_review_v1',dependentPlanSha256:dependentPlan.sha256,sourcePlanSha256:sourcePlan.sha256,
    sourceRawSha256:hash(sourceRaw),placementEvidenceSha256:placementEvidence.sha256,compiledSha256:compiled.contentSha256,
    maximumWorldError,points:rows,status:rows.every(r=>r.error<=maximumWorldError)?'pass':'blocked',contact:'not-assessed'});
}
