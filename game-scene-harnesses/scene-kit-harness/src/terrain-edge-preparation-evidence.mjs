import {check,hash,jsonBytes} from './generation/common.mjs';
import {TERRAIN_EDGE_CANVAS_GUTTER_FORMAT,terrainEdgeCanvasGutterView} from './generation/terrain-edge-canvas-gutter.mjs';
import {terrainEdgeRebindView} from './generation/terrain-edge-rebind.mjs';

export function terrainEdgeRebindEvidence(item,batch,files){if(!item.rebind)return null;
  terrainEdgeRebindView(item,batch);const r=item.rebind.record,role=r.recipe.edgeRole;
  files.set(`evidence/${role}-rebind.json`,jsonBytes(r));files.set(`source/${role}-original-native.png`,Buffer.from(item.rebind.originalRaw));
  return {format:r.format,sha256:r.sha256,proposalSha256:r.proposal.sha256,sourceEvidenceSha256:r.sourceEvidence.sha256,
    originalRawSha256:r.originalRawSha256,preparedRawSha256:r.rawSha256,originalQaStatus:'fail',nativeFrame:{...r.nativeFrame},
    controlsCoordinateSpace:'original-native-pixel-frame',allOriginalRgbaPreserved:true,maximumNewImageCalls:0,sourceArtAcceptance:'not-granted'};
}

// The original PNG and its failed QA are immutable lineage, independently of
// the prepared source's technical pass and later human artwork decisions.
// The immutable rebind child retains prior preparation identities as plan
// members. Its parent must independently list each as a preparation; accepting
// child membership alone would weaken the historical lineage requirement.
export function terrainEdgePreparationBound(batch,parentBatch,sha){
  if(batch.format!=='ai_scene_terrain_edge_rebind_batch_v1')return batch.preparationSha256s?.includes(sha)===true;
  return parentBatch?.sha256===batch.parentBatchSha256&&Array.isArray(parentBatch.preparationSha256s)
    &&parentBatch.preparationSha256s.includes(sha)&&parentBatch.planSha256s.includes(sha)&&batch.planSha256s.includes(sha);
}
export function terrainEdgeCanvasGutterEvidence(item,batch,files,parentBatch=null){
  if(item.preparation?.record.format!==TERRAIN_EDGE_CANVAS_GUTTER_FORMAT)return null;
  terrainEdgeCanvasGutterView(item);
  const {record,originalPlan,originalResult,originalRaw}=item.preparation,role=item.plan.recipe.edgeRole;
  check(terrainEdgePreparationBound(batch,parentBatch,record.sha256),'TERRAIN_EDGE_CANVAS_GUTTER_DELIVERY_BINDING');
  for(const [name,value]of [['canvas-gutter-preparation',record],['canvas-gutter-proposal',record.proposal],
    ...(record.receipt?[['canvas-gutter-receipt',record.receipt]]:[]),
    ['original-plan',originalPlan],['original-result',originalResult],['original-technical-qa',originalResult.technical]])
    files.set(`evidence/${role}-${name}.json`,jsonBytes(value));
  files.set(`source/${role}-original-native.png`,Buffer.from(originalRaw));
  return {format:record.format,sha256:record.sha256,proposalSha256:record.proposal.sha256,
    ...(record.receipt?{receiptSha256:hash(jsonBytes(record.receipt))}:{automaticPolicy:record.automaticPolicy}),
    originalPlanSha256:originalPlan.sha256,originalResultSha256:originalResult.sha256,originalTechnicalSha256:originalResult.technical.sha256,
    originalQaStatus:'fail',originalIssues:[...originalResult.technical.issues],originalRawSha256:hash(originalRaw),preparedRawSha256:hash(item.raw),
    originalPixelSize:{...record.proposal.originalPixelSize},preparedPixelSize:{...record.proposal.paddedPixelSize},nativeFrame:{...record.nativeFrame},
    controlsCoordinateSpace:'original-native-pixel-frame',worldScaleAndRepeatUnchanged:true,allOriginalRgbaPreserved:true,
    consumerView:'entire-original-rgba-footprint-excludes-only-new-zero-canvas',originalPngBytesUnchanged:true,
    maximumNewImageCalls:0,sourceArtAcceptance:'not-granted'};
}
