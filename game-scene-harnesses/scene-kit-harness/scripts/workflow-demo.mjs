import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as workflow from '../src/generation/index.mjs';
import { loadSceneKit } from '../src/kit.mjs';
import { makeFreshDirectory, writeFreshFile } from '../src/files.mjs';
import { jsonBytes } from '../src/generation/common.mjs';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
try {
  if (process.argv.length !== 4 || process.argv[2] !== '--out') throw new Error('Use workflow-demo.mjs --out NEW_DIRECTORY');
  const output = makeFreshDirectory(process.argv[3], packageRoot), root = join(output, 'workflow');
  const fixtureRoot = join(packageRoot, 'tests/fixtures/synthetic'), kit = loadSceneKit(fixtureRoot);
  const fixture = name => JSON.parse(readFileSync(join(packageRoot, 'examples/synthetic-generation', `${name}.json`), 'utf8'));
  const decision = (decisionId, targetSha256, choice = 'accept') => ({ decisionId, targetSha256, decision: choice,
    notes: 'Synthetic provider/reviewer double. No human image acceptance and no actual generation.' });
  workflow.initWorkflow(root, { projectId: 'synthetic.exchange.demo', purpose: 'synthetic-simulation' });
  const spec = workflow.createDesignDraft(root, fixture('spec')), style = workflow.createDesignDraft(root, fixture('style'));
  const capabilities = workflow.createDesignDraft(root, fixture('capabilities'));
  workflow.reviewDesign(root, 'spec', decision('fixture.spec', spec.sha256));
  workflow.reviewDesign(root, 'style', decision('fixture.style', style.sha256));
  const reference = workflow.freezeReferencePlan(root, { planId: 'reference.r1', parents: [], capabilitiesSha256: capabilities.sha256,
    pixelSize: { width: 64, height: 64 }, intent: 'Synthetic exchange protocol demonstration.' });
  function reserve(plan) {
    workflow.authorizePlan(root, plan.sha256, decision(`compute.${plan.recipe.planId}`, plan.sha256, 'approve-compute'));
    const { request: _request, ...ticket } = workflow.reservePlan(root, plan.sha256); return ticket;
  }
  function complete(plan, assetId) {
    const ticket = reserve(plan); workflow.recordSubmission(root, ticket);
    const result = workflow.receiveResult(root, ticket, readFileSync(join(fixtureRoot, 'assets', `${assetId}.png`)));
    if (result.technical.status !== 'pass') throw new Error('Synthetic output failed technical reception');
    workflow.reviewResult(root, plan.sha256, decision(`review.${plan.recipe.planId}`, result.rawSha256));
  }
  complete(reference, 'terrain-000');
  const batch = workflow.freezeModuleBatch(root, kit, { batchId: 'modules.r1', referencePlanSha256: reference.sha256,
    capabilitiesSha256: capabilities.sha256, intent: 'Synthetic reusable module PNG exchange.' });
  const first = workflow.getGenerationPlan(root, batch.planSha256s[0]);
  workflow.stopAttempt(root, reserve(first), 'indeterminate');
  const revised = workflow.reviseGenerationPlan(root, first.sha256, { planId: 'modules.revised', capabilitiesSha256: capabilities.sha256, intent: 'Explicit synthetic new decision after an unknown outcome.' });
  const next = workflow.reviseModuleBatch(root, batch.sha256, { batchId: 'modules.r2', replacements: [{ assetId: first.recipe.assetId, planSha256: revised.sha256 }] });
  for (const sha256 of next.planSha256s) {
    const plan = workflow.getGenerationPlan(root, sha256); complete(plan, plan.recipe.assetId);
  }
  const status = workflow.inspectWorkflow(root), readiness = workflow.inspectModuleBatch(root, next.sha256);
  const report = { format: 'ai_scene_generation_demo_v1', purpose: 'synthetic-simulation', referencePlanSha256: reference.sha256,
    originalBatchSha256: batch.sha256, revisedBatchSha256: next.sha256, requiredTerrainRoles: 47,
    reviewedFixtureTerrainRoles: readiness.reviewedTerrainRoleCount, moduleCount: next.planSha256s.length,
    initialModuleImageRequests: batch.newImageRequests, explicitRevisionImageRequests: next.newImageRequests,
    reservedAttempts: status.plans.filter(plan => plan.reserved).length, receivedFixturePNGs: status.plans.filter(plan => plan.received).length,
    terminalUnknownAttempts: status.plans.filter(plan => plan.status === 'indeterminate').length,
    originalBatchStatus: workflow.inspectModuleBatch(root, batch.sha256).status, revisedBatchStatus: readiness.status,
    evidenceIssues: readiness.issues, coreProviderCalls: 0, actualMediaGenerationCalls: 0,
    humanVisualReview: 'not-run', packageAssembly: 'not-run', visualAcceptance: 'not-assessed' };
  writeFreshFile(join(output, 'demo-report.json'), jsonBytes(report), packageRoot);
  writeFreshFile(join(output, 'module-readiness.json'), jsonBytes(readiness), packageRoot);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: error.errors?.[0]?.code ?? 'DEMO_FAILED', message: 'Synthetic demo failed; partial evidence is retained; no automatic overwrite' }));
  process.exitCode = 1;
}
