import * as flow from './generation/index.mjs';
import { check, hash, jsonBytes, seal } from './generation/common.mjs';
import { writeProofBundle, verifyProofBundle } from './terrain-proof/bundle.mjs';

export function inspectPaintSource(workflow, planSha256) {
  const plan = flow.getGenerationPlan(workflow, planSha256); check(['ai_scene_generation_plan_v25','ai_scene_generation_plan_v26'].includes(plan.format), 'PAINT_PLAN_REQUIRED');
  const entry = flow.inspectWorkflow(workflow).plans.find(p => p.planSha256 === planSha256);
  return { format: 'ai_scene_paint_source_status_v1', ...entry, sourceKind: 'opaque-paint-not-transparent-layer',
    sourceAcceptanceMeaning: 'paint-appearance-only', automaticRetry: false, derivedLayerArtAccepted: false };
}
function sourceProposal(workflow, options) {
  const plan = flow.previewPaintSourcePlan(workflow, options), { control: c, review } = flow.getPaintControls(workflow, options.paintControlsSha256);
  const guide = flow.readStandardWorkflowImage(workflow, c.guide), original = flow.readStandardWorkflowImage(workflow, c.originalReference);
  const alpha = flow.readStandardWorkflowImage(workflow, c.geometryAlpha);
  check(hash(guide) === plan.request.images[0].artifact.sha256 && hash(original) === plan.request.images[1].artifact.sha256, 'PAINT_CONTROL_ARTIFACTS');
  const files = new Map([['plan.json', jsonBytes(plan)], ['prompt.txt', Buffer.from(plan.request.prompt)],
    ['paint-guide.png', guide], ['reference-native.png', original], ['geometry-alpha.png', alpha],
    ['geometry-target.json', jsonBytes(c.geometry)], ['reviewed-source-design.json', jsonBytes(c.design)]]);
  const report = seal({ format: 'ai_scene_paint_source_compute_proposal_v1', planSha256: plan.sha256, controlsSha256: c.sha256,
    sourceDesignSha256: c.design.sha256, sourceDesignReviewSha256: review.sha256, targetSha256: c.targetSha256,
    maximumCalls: 1, executable: false, computeAuthorized: false, generationCalls: 0,
    fullReferenceBytesPreserved: true, newRealReferenceCrop: false, actualMaskApplicationIncluded: false });
  files.set('proposal.json', jsonBytes(report));
  files.set('README.md', Buffer.from('# 不透明绘制源：准确计算提案\n\n输入依次为已审几何引导和完整原图，原图原字节保留；只请求1张不透明PNG。提示尺寸是软引导，原生尺寸必须通过1%画幅误差及不缩小于局部画布的技术检查。不补框、重试或切换提供方。接收后仅审原图和未遮罩归一化外观，真实Alpha应用另绑准确新源批准；不代表已交付透明层或完整场景。\n'));
  const bundle = seal({ format: 'ai_scene_paint_source_compute_bundle_v1', planSha256: plan.sha256, reportSha256: report.sha256,
    artifacts: [...files].map(([path, bytes]) => ({ path, sha256: hash(bytes), byteLength: bytes.length })), generationCalls: 0 });
  files.set('proof-bundle.json', jsonBytes(bundle)); return { files, report, bundle };
}
export const buildPaintSourceProposal = (workflow, options, output) => writeProofBundle(output, workflow, sourceProposal(workflow, options));
export const verifyPaintSourceProposal = (workflow, options, output) => verifyProofBundle(output, sourceProposal(workflow, options));
function materialProposal(workflow,options) {
  const plan=flow.previewMaterialPaintPlan(workflow,options),{control:c,base,review}=flow.getMaterialPaintControls(workflow,options.materialControlsSha256);
  const names=['paint-guide.png','material-guide.png','reference-native.png'];
  const files=new Map([['plan.json',jsonBytes(plan)],['prompt.txt',Buffer.from(plan.request.prompt)],
    ['reviewed-material-design.json',jsonBytes(c.proposal)],['probe-definitions.json',jsonBytes(c.probeDefinitions)],
    ['geometry-alpha.png',flow.readStandardWorkflowImage(workflow,base.geometryAlpha)]]);
  plan.request.images.forEach((image,i)=>files.set(names[i],flow.readStandardWorkflowImage(workflow,image.artifact)));
  const report=seal({format:'ai_scene_material_paint_compute_proposal_v1',planSha256:plan.sha256,controlsSha256:c.sha256,
    designProposalSha256:c.proposal.sha256,designReviewSha256:review.sha256,maximumCalls:1,generationCalls:0,computeAuthorized:false,
    fullReferenceBytesPreserved:true,newRealReferenceCrop:false,actualMaskApplicationIncluded:false,
    coverageRequiredBeforeSourceAcceptance:true,coverageRequiredBeforeApplication:true,materialRecognitionAutomatic:false});
  files.set('proposal.json',jsonBytes(report));
  files.set('README.md',Buffer.from('# 材质对齐绘制源：准确计算提案\n\n三张输入依次为原几何/余量引导、已接受材质引导、未改动的完整参考。仅请求一张不透明绘制源，不代表透明资产。单独计算批准后才可派发一次；失败或未知停止，不自动重试。接收后先审未遮罩源的全部部件点、已知故障点和主体/木/雪/交界区域，全部通过后仍分别审来源外观与准确Alpha应用。引导是软约束，不保证改善；不更改Alpha或自动修图。\n'));
  const bundle=seal({format:'ai_scene_material_paint_compute_bundle_v1',planSha256:plan.sha256,reportSha256:report.sha256,
    artifacts:[...files].map(([path,b])=>({path,sha256:hash(b),byteLength:b.length})),generationCalls:0});
  files.set('proof-bundle.json',jsonBytes(bundle)); return {files,report,bundle};
}
export const buildMaterialPaintProposal=(workflow,options,output)=>writeProofBundle(output,workflow,materialProposal(workflow,options));
export const verifyMaterialPaintProposal=(workflow,options,output)=>verifyProofBundle(output,materialProposal(workflow,options));
export async function runPaintSource(workflow, planSha256, adapter) {
  check(adapter && typeof adapter.preflight === 'function' && typeof adapter.generate === 'function', 'PIPELINE_ADAPTER_REQUIRED');
  check(inspectPaintSource(workflow, planSha256).status === 'authorized', 'PIPELINE_NOT_AUTHORIZED');
  await adapter.preflight();
  const { request, ...ticket } = flow.reservePlan(workflow, planSha256); flow.recordSubmission(workflow, ticket);
  let bytes;
  try {
    bytes = await adapter.generate({ ...ticket, request,
      images: request.images.map((image, n) => ({ ...image, bytes: flow.readGenerationInput(workflow, planSha256, n) })) });
    check(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= 16777216, 'PIPELINE_ADAPTER_OUTPUT');
  } catch { flow.stopAttempt(workflow, ticket, 'indeterminate'); return inspectPaintSource(workflow, planSha256); }
  flow.receiveResult(workflow, ticket, bytes); return inspectPaintSource(workflow, planSha256);
}
