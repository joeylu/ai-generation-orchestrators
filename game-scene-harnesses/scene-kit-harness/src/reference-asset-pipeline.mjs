import { join } from 'node:path';
import { check, hash, jsonBytes, seal } from './generation/common.mjs';
import * as flow from './generation/index.mjs';
import { inspectReferenceLedProject } from './reference-led-pipeline.mjs';
import { referenceInstanceContext } from './reference-decomposition.mjs';
import { referenceAssetGuide } from './generation/reference-asset.mjs';
import { REFERENCE_LAYER_EDIT_MODE, REFERENCE_LAYER_SINGLE_INPUT_MODE } from './generation/reference-asset-edit.mjs';
import { REFERENCE_LAYER_REGION_MODE } from './generation/reference-region.mjs';
import { referenceAssetProofFiles } from './reference-asset-proof.mjs';
import { writeProofBundle, verifyProofBundle } from './terrain-proof/bundle.mjs';

function source(root) {
  const status = inspectReferenceLedProject(root), workflow = join(root, 'workflow');
  check(status.reference?.status === 'accepted', 'REFERENCE_ASSET_ACCEPTED_TARGET');
  const sha = status.reference.planSha256, reference = flow.getGenerationPlan(workflow, sha), target = flow.getReferenceReconstructionTarget(workflow, sha);
  const { bytes } = flow.getGenerationResult(workflow, sha);
  return { status, workflow, reference, target, bytes };
}
function optionsAt(root, options) {
  check(options && Object.keys(options).length === (Object.hasOwn(options, 'mode') ? 3 : 2)
    && (!Object.hasOwn(options, 'mode') || [REFERENCE_LAYER_EDIT_MODE, REFERENCE_LAYER_SINGLE_INPUT_MODE, REFERENCE_LAYER_REGION_MODE].includes(options.mode))
    && typeof options.batchId === 'string' && Array.isArray(options.assets), 'REFERENCE_ASSET_OPTIONS');
  const s = source(root);
  return { ...s, options: { ...options, referencePlanSha256: s.reference.sha256, targetSha256: s.target.sha256,
    capabilitiesSha256: s.reference.recipe.capabilitiesSha256 } };
}
function proposal(root, options) {
  const s = optionsAt(root, options), report = flow.previewReferenceAssets(s.workflow, s.options);
  const files = new Map([['proposal.json', jsonBytes(report)], ['options.json', jsonBytes(options)],
    ['reference-native.png', s.bytes], ['reconstruction-target.json', jsonBytes(s.target)]]);
  for (const plan of report.plans) {
    const prefix = `assets/${plan.recipe.assetId}`, context = referenceInstanceContext(s.target, s.bytes, plan.recipe.assetId);
    const guide = options.mode ? null : referenceAssetGuide(s.target, context.instance);
    const region = options.mode === REFERENCE_LAYER_REGION_MODE;
    const single = options.mode === REFERENCE_LAYER_SINGLE_INPUT_MODE || region;
    check(hash(context.bytes) === plan.instanceBinding.contextSha256
      && (single || hash(context.bytes) === plan.request.images[1].artifact.sha256)
      && (!guide || hash(guide.bytes) === plan.request.images[2].artifact.sha256), 'REFERENCE_ASSET_INPUT');
    files.set(`${prefix}/plan.json`, jsonBytes(plan)); files.set(`${prefix}/prompt.txt`, Buffer.from(plan.request.prompt));
    files.set(`${prefix}/${single ? 'context-review-only' : 'context-native'}.png`, context.bytes);
    if (guide) files.set(`${prefix}/placement-guide.png`, guide.bytes);
    if (region) {
      const bytes = flow.readRegionGuideImage(s.workflow, plan.recipe.regionControlsSha256);
      check(hash(bytes) === plan.request.images[1].artifact.sha256, 'REFERENCE_ASSET_INPUT');
      files.set(`${prefix}/region-guide.png`, bytes);
    }
    files.set(`${prefix}/placement.json`, jsonBytes(plan.placement));
  }
  files.set('README.md', Buffer.from(options.mode === REFERENCE_LAYER_REGION_MODE ? '# 已审同画幅区域指示：准确素材提案\n\n' +
    `目标${s.target.sha256}；${report.plans.length}项，每项最多1次。本提案没有计算授权。\n\n` +
    report.plans.map(p => `- ${p.recipe.assetId}：[准确标注图](assets/${p.recipe.assetId}/region-guide.png) · [完整提示](assets/${p.recipe.assetId}/prompt.txt) · 控制审阅包${p.regionControlEvidence.packetSha256}`).join('\n') +
    '\n\n工具只接收原始确认整图与已审同画幅标注。局部仅供人查看，不传给工具。绿色粗区/K点是主体定位，红色R区/表沿是排除主地形示例；不是精细Alpha或像素硬锁。提示与已接受设计一致，仍可能失败。保留原位、比例和声明裁边；框外未知，不自动补框、修Alpha、摆放修正或加tint。失败/未知停止、不重试，技术通过后仍独立审美术与还原。\n'
    : options.mode === REFERENCE_LAYER_SINGLE_INPUT_MODE ? '# 单整图输入编辑对照提案\n\n' +
    `目标${s.target.sha256}；${report.plans.length}项，每项最多1次。只传准确整图作为编辑目标，局部图仅保存在本审阅包，不传给图片工具。\n\n` +
    report.plans.map(p => `- ${p.recipe.assetId}：[仅审阅的局部](assets/${p.recipe.assetId}/context-review-only.png) · [完整提示](assets/${p.recipe.assetId}/prompt.txt)；原有裁边：${p.recipe.clippedEdges.join('、') || '无'}`).join('\n') +
    '\n\n该模式用来对照局部图片输入的影响；不保证改善，不锁像素。保持原画布比例、位置、尺度、外观和已声明裁边，其他层透明；不补框外或遮挡部分，不改变PNG/透明/尺寸/边距QA，不自动补框、修Alpha、居中或加tint。失败/未知停止、不重试。本提案未授权计算，未使用CPU模型，不代表美术接受。\n'
    : options.mode ? '# 原画布编辑式可见单层提案\n\n' +
    `目标${s.target.sha256}；${report.plans.length}项，每项最多1次。本提案不授权计算，不使用CPU分割。\n\n` +
    report.plans.map(p => `- ${p.recipe.assetId}：[定位局部](assets/${p.recipe.assetId}/context-native.png) · [完整提示](assets/${p.recipe.assetId}/prompt.txt)；原有裁边：${p.recipe.clippedEdges.join('、') || '无'}`).join('\n') +
    '\n\n输入1为确认整图的编辑目标，输入2仅定位实例；不传位置图，不改用局部画框。保持原画布比例、主体位置、大小、外观和已声明原有裁边，其他层透明；不补全框外，不要求完整独立模块。未声明边仍须2px透明。位置/轮廓为软引导，技术通过后仍审实际还原。保留原生PNG，不自动补框、修Alpha、缩放居中或加tint。失败/未知停止，无重试。\n'
    : '# 受约束资产生图提案\n\n' +
    `目标${s.target.sha256}；${report.plans.length}项，每项最多1张。这里未授权或派发生图，主体按已接受图重新生成，不使用CPU分割作为前置条件。\n\n` +
    report.plans.map(p => `- ${p.recipe.assetId}: [原像素上下文](assets/${p.recipe.assetId}/context-native.png) · [粗位置图](assets/${p.recipe.assetId}/placement-guide.png) · [完整提示](assets/${p.recipe.assetId}/prompt.txt)`).join('\n') +
    '\n\n每项输入依次为准确整图、局部上下文、灰度位置图。位置图仅提示原参考窗与粗包络，不是精细mask或像素硬锁。画框外部分是新推定；保留原生PNG，技术接收后仍须独立审阅外观、位置、轮廓与补全部分。禁止自动居中、按Alpha边界另缩放或烘焙tint补救。失败/未知停止、不重试，本提案不构成完整资产包。\n'));
  const bundle = seal({ format: 'ai_scene_reference_asset_proposal_bundle_v1', targetSha256: s.target.sha256, reportSha256: report.sha256,
    artifacts: [...files].map(([path, bytes]) => ({ path, sha256: hash(bytes), byteLength: bytes.length })), generationCalls: 0, assetPackage: false });
  files.set('proof-bundle.json', jsonBytes(bundle)); return { workflow: s.workflow, files, report, bundle };
}
export const buildReferenceAssetProposal = (root, options, output) => { const p = proposal(root, options); return writeProofBundle(output, p.workflow, p); };
export const verifyReferenceAssetProposal = (root, options, output) => verifyProofBundle(output, proposal(root, options));
export const freezeReferenceAssetProject = (root, options) => { const s = optionsAt(root, options); return flow.freezeReferenceAssets(s.workflow, s.options); };
export function inspectReferenceAssetProject(root, batchSha256) {
  const s = source(root), batch = flow.getReferenceAssetBatch(s.workflow, batchSha256), state = flow.inspectWorkflow(s.workflow);
  check(batch.targetSha256 === s.target.sha256 && batch.referencePlanSha256 === s.reference.sha256, 'REFERENCE_ASSET_TARGET_STALE');
  return { format: 'ai_scene_reference_asset_status_v1', batchSha256, targetSha256: s.target.sha256, maximumCalls: batch.maximumCalls,
    assets: batch.planSha256s.map(sha => state.plans.find(p => p.planSha256 === sha)), automaticRetry: false, assetPackage: false };
}
export function authorizeReferenceAssetProject(root, batchSha256, decision) {
  const s = source(root); inspectReferenceAssetProject(root, batchSha256);
  flow.authorizeReferenceAssetBatch(s.workflow, batchSha256, decision); return inspectReferenceAssetProject(root, batchSha256);
}
function assetProof(root, batchSha256) {
  const s = source(root), status = inspectReferenceAssetProject(root, batchSha256);
  const received = status.assets.filter(p => ['pending-visual-review', 'accepted'].includes(p.status) && p.technicalStatus === 'pass');
  check(received.length > 0, 'RESULT_REQUIRED');
  const sources = received.map(p => ({ plan: flow.getGenerationPlan(s.workflow, p.planSha256), bytes: flow.getGenerationResult(s.workflow, p.planSha256).bytes }));
  return { workflow: s.workflow, prepared: referenceAssetProofFiles(s.target, s.bytes, sources) };
}
export function buildReferenceAssetProof(root, batchSha256, output) {
  const p = assetProof(root, batchSha256); return writeProofBundle(output, p.workflow, p.prepared);
}
export function verifyReferenceAssetProof(root, batchSha256, output) {
  const p = assetProof(root, batchSha256); return verifyProofBundle(output, p.prepared);
}
export async function runReferenceAssetProject(root, batchSha256, adapter) {
  check(adapter && typeof adapter.preflight === 'function' && typeof adapter.generate === 'function', 'PIPELINE_ADAPTER_REQUIRED');
  const s = source(root), before = inspectReferenceAssetProject(root, batchSha256);
  check(before.assets.some(p => p.status === 'authorized'), 'PIPELINE_NOT_AUTHORIZED');
  await adapter.preflight();
  for (const item of before.assets) {
    if (['pending-visual-review', 'accepted'].includes(item.status) && item.technicalStatus === 'pass') continue;
    if (item.status !== 'authorized') break;
    const { request, ...ticket } = flow.reservePlan(s.workflow, item.planSha256); flow.recordSubmission(s.workflow, ticket);
    let bytes;
    try {
      bytes = await adapter.generate({ ...ticket, request, images: request.images.map((i, n) => ({ ...i, bytes: flow.readGenerationInput(s.workflow, item.planSha256, n) })) });
      check(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= 16777216, 'PIPELINE_ADAPTER_OUTPUT');
    } catch { flow.stopAttempt(s.workflow, ticket, 'indeterminate'); break; }
    const result = flow.receiveResult(s.workflow, ticket, bytes);
    if (result.technical.status !== 'pass') break;
  }
  return inspectReferenceAssetProject(root, batchSha256);
}
