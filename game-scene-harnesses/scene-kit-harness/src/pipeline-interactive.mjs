import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { check, jsonBytes } from './generation/common.mjs';
import { readSelectedFile, writeFreshFile } from './files.mjs';
import { getGenerationPlan, getGenerationResult } from './generation/index.mjs';
import { advanceScenePipeline, authorizePipelineStage, deliverScenePipeline, inspectScenePipeline,
  pipelinePlans, reviewPipelineDesign, reviewPipelineImage, runScenePipeline, verifyPipelineDelivery } from './pipeline.mjs';

const receipt = (targetSha256, decision, notes) => ({ decisionId: `operator.${randomUUID()}`, decision, targetSha256, notes });
// All decisions originate in the supplied human input channel. No --yes mode,
// synthetic acceptance, hidden compute or retry is provided by this entry.
export async function runInteractiveScenePipeline(root, output, { adapter, ask, show = () => {} }) {
  check(typeof ask === 'function' && typeof show === 'function', 'PIPELINE_HUMAN_INPUT_REQUIRED');
  let adapterReady = false;
  for (;;) {
    const status = advanceScenePipeline(root); show({ type: 'status', status });
    if (status.stage === 'awaiting-design-review') {
      const layered = Boolean(status.design.layerDesignSha256);
      show({ type: 'design', files: ['spec-draft.json', 'style-draft.json', ...(layered ? ['layers-draft.json'] : [])], design: status.design });
      if (await ask(layered ? '查看结构、画风及完整分层要求。接受草案并按这些分层要求规划请输入 accept；其他输入停止：'
        : '查看结构和画风草案。接受两份草案请输入 accept；其他输入停止：') !== 'accept') return status;
      reviewPipelineDesign(root, { spec: receipt(status.design.specSha256, 'accept', 'Operator accepted the displayed structure draft.'),
        style: receipt(status.design.styleSha256, 'accept', 'Operator accepted the displayed style draft.') }); continue;
    }
    if (['awaiting-reference-compute', 'awaiting-source-compute'].includes(status.stage)) {
      if (!adapterReady) { await adapter.preflight(); adapterReady = true; }
      const plans = pipelinePlans(root), batch = plans.batches.find(item => item.sha256 === status.activeSourceBatchSha256);
      const target = status.stage === 'awaiting-reference-compute' ? status.reference.planSha256 : batch.sha256;
      const snapshot = status.stage === 'awaiting-reference-compute' ? `frozen-reference-${target}.json` : `frozen-sources-${target}.json`;
      const snapshotPath = join(root, snapshot), bytes = jsonBytes(plans);
      if (existsSync(snapshotPath)) check(readSelectedFile(snapshotPath).equals(bytes), 'PIPELINE_SNAPSHOT_CHANGED');
      else writeFreshFile(snapshotPath, bytes, join(root, 'workflow'));
      show({ type: 'compute', targetSha256: target, maximumCalls: status.stage === 'awaiting-reference-compute' ? 1 : batch.maximumImageRequests, snapshot });
      if (await ask(`确认以上准确计划 ${target} 的单次计算请输入 approve；其他输入停止：`) !== 'approve') return status;
      authorizePipelineStage(root, receipt(target, 'approve-compute', 'Operator confirmed the displayed immutable plan or complete source batch.')); continue;
    }
    if (['ready-to-generate-reference', 'ready-to-generate-sources'].includes(status.stage)) {
      const next = await runScenePipeline(root, adapter, { onProgress: event => show({ type: 'progress', ...event }) });
      if (next.stage === 'attention-required') { show({ type: 'attention', status: next }); return next; }
      continue;
    }
    if (status.stage === 'awaiting-reference-review') {
      const ref = getGenerationResult(join(root, 'workflow'), status.reference.planSha256), path = join(root, `reference-review-${status.reference.rawSha256}.png`);
      const plan = getGenerationPlan(join(root, 'workflow'), status.reference.planSha256);
      const checklist = plan.visualReviewChecklist;
      if (checklist) {
        const checklistPath = join(root, `reference-layer-checklist-${status.reference.planSha256}.json`), bytes = jsonBytes(checklist);
        if (existsSync(checklistPath)) check(readSelectedFile(checklistPath).equals(bytes), 'PIPELINE_SNAPSHOT_CHANGED');
        else writeFreshFile(checklistPath, bytes, join(root, 'workflow'));
        show({ type: 'reference-layers', path: checklistPath, checklist });
      }
      // Re-entry can use the same verified image, never overwrite an altered preview.
      show({ type: 'reference', rawSha256: ref.result.rawSha256, bytes: ref.bytes, path });
      const answer = await ask(`${checklist ? '对照清单检查每层、前景和底部完整性。' : ''}查看原图后，接受 ${ref.result.rawSha256} 请输入 accept；拒绝请输入 reject；其他输入停止：`);
      if (!['accept', 'reject'].includes(answer)) return status;
      const next = reviewPipelineImage(root, status.reference.planSha256, receipt(ref.result.rawSha256, answer, 'Operator reviewed the exact reference PNG.'));
      if (answer === 'reject') return next; continue;
    }
    if (status.stage === 'ready-to-assemble') {
      const result = existsSync(output) ? verifyPipelineDelivery(root, output) : deliverScenePipeline(root, output); show({ type: 'delivery', result });
      return { ...inspectScenePipeline(root), delivery: result };
    }
    show({ type: 'attention', status }); return status;
  }
}
