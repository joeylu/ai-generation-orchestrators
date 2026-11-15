import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {parseJson,readSelectedFile} from './files.mjs';
import {check,digest,hash,id,jsonBytes,receipt as validateReceipt,seal,unseal} from './generation/common.mjs';
import * as flow from './generation/index.mjs';
import {writeProofBundle,verifyProofBundle} from './terrain-proof/bundle.mjs';

function reviewFiles(workflow,sourcePlanSha256,parentBatchSha256){
  const view=flow.readTerrainEdgeWorkflowView(workflow,{batchSha256:parentBatchSha256,includeResults:true}),parent=view.batch,state=view.inspection;
  check(!parent.planSha256s.some(sha=>{const p=state.plans.find(p=>p.planSha256===sha);return p.reserved&&!p.received;}),'TERRAIN_EDGE_CANVAS_GUTTER_REVIEW_STATE');
  const {proposal,bytes,previews}=flow.proposeTerrainEdgeCanvasGutterPreparation(workflow,sourcePlanSha256,parentBatchSha256),
    original=view.results.get(sourcePlanSha256),plan=view.plans.find(p=>p.sha256===sourcePlanSha256),
    context=seal({format:'ai_scene_terrain_edge_canvas_gutter_review_context_v1',parentBatchSha256,sourcePlanSha256,proposalSha256:proposal.sha256,generationCalls:0});
  const files=new Map([['proposal.json',jsonBytes(proposal)],['review-context.json',jsonBytes(context)],['source-original.png',original.bytes],
    ['preview-padded.png',bytes],['preview-original-checkerboard.png',previews.original],['preview-padded-checkerboard.png',previews.padded],
    ['original-plan.json',jsonBytes(plan)],['original-result.json',jsonBytes(original.result)],['original-technical.json',jsonBytes(original.result.technical)],
    ['parent-batch.json',jsonBytes(parent)]]);
  files.set('README.md',Buffer.from(['# 原生包边：准确 2px 透明补框预览','',
    '仅对原生包边唯一 TERRAIN_EDGE_NATIVE_GUTTER 失败准备。外2px仅允许Alpha1–7尾迹，Alpha≥8实体四边至少2px；原QA其他门保持。',
    '四边各追加2px全零RGBA。全部原RGBA，包括弱Alpha与隐藏RGB，按整数偏移完整复制；不缩放、不删Alpha、不调色、不恢复隐藏轮廓。',
    '原PNG、原失败QA及原尝试保持。采用后新增独立零调用准备记录，仍需独立美术审阅。',
    '原生控点、主体世界尺寸与周期仍使用整张原画布；消费视图只排除新增的零画布，不裁去任何原像素。',
    '请审阅此准确预览并接受proposal摘要；本包不授权、预留或调用图片。其他已授权未执行计划保持原摘要和一次授权。','',
    `提案 SHA-256：${proposal.sha256}`,`父批次：${parentBatchSha256}`,
    `原尺寸：${proposal.originalPixelSize.width}×${proposal.originalPixelSize.height}`,
    `补框尺寸：${proposal.paddedPixelSize.width}×${proposal.paddedPixelSize.height}`,
    '原生消费 frame：x=2,y=2，宽高等于原图。',''].join('\n')));
  const bundle=seal({format:'ai_scene_terrain_edge_canvas_gutter_review_bundle_v1',proposalSha256:proposal.sha256,contextSha256:context.sha256,
    artifacts:[...files].map(([path,bytes])=>({path,sha256:hash(bytes),byteLength:bytes.length})),generationCalls:0});
  files.set('proof-bundle.json',jsonBytes(bundle));return {files,bundle,proposal,context};
}
export function exportTerrainEdgeCanvasGutterReview(workflow,sourcePlanSha256,parentBatchSha256,output){
  const prepared=reviewFiles(workflow,sourcePlanSha256,parentBatchSha256);
  if(existsSync(output))verifyProofBundle(output,prepared);else writeProofBundle(output,workflow,prepared);
  return {format:'ai_scene_terrain_edge_canvas_gutter_review_v1',proposalSha256:prepared.proposal.sha256,bundleSha256:prepared.bundle.sha256,
    sourcePlanSha256,parentBatchSha256,proposal:prepared.proposal,generationCalls:0,adoptionGranted:false};
}
export function applyTerrainEdgeCanvasGutterReview(workflow,reviewDirectory,receipt,{preparationId,batchId}){
  validateReceipt(receipt,'review');id(preparationId);id(batchId);
  const supplied=parseJson(readSelectedFile(join(reviewDirectory,'proposal.json'))),context=parseJson(readSelectedFile(join(reviewDirectory,'review-context.json')));
  unseal(supplied);unseal(context);
  check(supplied.parentBatchSha256===context.parentBatchSha256&&supplied.sha256===context.proposalSha256,'TERRAIN_EDGE_CANVAS_GUTTER_REVIEW_BINDING');
  const prepared=reviewFiles(workflow,supplied.sourcePlanSha256,context.parentBatchSha256);verifyProofBundle(reviewDirectory,prepared);
  check(receipt.decision==='accept'&&receipt.targetSha256===prepared.proposal.sha256,'TERRAIN_EDGE_CANVAS_GUTTER_APPROVAL');
  const view=flow.readTerrainEdgeWorkflowView(workflow,{batchSha256:context.parentBatchSha256}),state=view.inspection,existing=state.plans.find(p=>p.planId===preparationId),
    batches=view.batches,
    parent=batches.find(b=>b.sha256===context.parentBatchSha256),latest=batches.findLast(b=>b.referencePlanSha256===parent.referencePlanSha256&&b.baseBatchSha256===parent.baseBatchSha256);
  let record;
  if(existing){record=flow.getGenerationPlan(workflow,existing.planSha256);
    check(record.format==='ai_scene_terrain_edge_canvas_gutter_preparation_v1'&&record.sourcePlanSha256===supplied.sourcePlanSha256
      &&record.proposal.sha256===prepared.proposal.sha256&&digest(record.receipt)===digest(receipt),'TERRAIN_EDGE_CANVAS_GUTTER_RESUME_MISMATCH');}
  const adopted=batches.find(b=>b.batchId===batchId);
  if(adopted){check(record&&adopted.format==='ai_scene_terrain_edge_canvas_gutter_batch_v1'&&adopted.parentBatchSha256===parent.sha256
      &&adopted.planSha256s.includes(record.sha256)&&latest.sha256===adopted.sha256,'TERRAIN_EDGE_CANVAS_GUTTER_RESUME_MISMATCH');
    return {record,batch:adopted,reusedVerifiedPreparation:true,generationCalls:0};}
  check(latest.sha256===parent.sha256,'TERRAIN_EDGE_CANVAS_GUTTER_PARENT_STALE');
  if(!record)return {...flow.prepareAndAdoptTerrainEdgeCanvasGutterSource(workflow,{preparationId,proposal:prepared.proposal,receipt,parentBatchSha256:parent.sha256,batchId}),generationCalls:0};
  return {record,batch:flow.adoptTerrainEdgeCanvasGutterSource(workflow,parent.sha256,record.sha256,batchId),generationCalls:0};
}
