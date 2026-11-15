import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as workflow from '../src/generation/index.mjs';
import { makeFreshDirectory, writeFreshFile } from '../src/files.mjs';
import { jsonBytes } from '../src/generation/common.mjs';
import { syntheticTerrainMaterial } from './terrain-fixture.mjs';

const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
try {
  if (process.argv.length !== 4 || process.argv[2] !== '--out') throw new Error('Use --out NEW_DIRECTORY');
  const output = makeFreshDirectory(process.argv[3], sourceRoot), root = join(output, 'workflow');
  workflow.initWorkflow(root, { projectId: 'synthetic.terrain.proof', purpose: 'synthetic-simulation', compiler: 'scene-kit-native-reference-v2' });
  const read = name => JSON.parse(readFileSync(join(sourceRoot, 'examples/synthetic-generation', `${name}.json`)));
  const spec = workflow.createDesignDraft(root, read('spec')), style = workflow.createDesignDraft(root, read('style'));
  const capabilities = workflow.createDesignDraft(root, read('capabilities'));
  const decision = (decisionId, targetSha256, choice = 'accept') => ({ decisionId, decision: choice, targetSha256,
    notes: 'Synthetic provider/reviewer double; no real generation or human art acceptance.' });
  workflow.reviewDesign(root, 'spec', decision('fixture.spec', spec.sha256));
  workflow.reviewDesign(root, 'style', decision('fixture.style', style.sha256));
  function receive(plan, bytes) {
    workflow.authorizePlan(root, plan.sha256, decision(`compute.${plan.recipe.planId}`, plan.sha256, 'approve-compute'));
    const { request: _request, ...ticket } = workflow.reservePlan(root, plan.sha256);
    workflow.recordSubmission(root, ticket); return workflow.receiveResult(root, ticket, bytes);
  }
  const reference = workflow.freezeReferencePlan(root, { planId: 'reference.fixture', parents: [], capabilitiesSha256: capabilities.sha256,
    pixelSize: { width: 64, height: 64 }, intent: 'Synthetic reference fixture.' });
  const referenceResult = receive(reference, readFileSync(join(sourceRoot, 'tests/fixtures/synthetic/assets/terrain-000.png')));
  workflow.reviewResult(root, reference.sha256, decision('fixture.reference', referenceResult.rawSha256));
  const plan = workflow.freezeTerrainMaterialPlan(root, { planId: 'terrain.fixture', parents: [], referencePlanSha256: reference.sha256,
    capabilitiesSha256: capabilities.sha256, intent: 'Synthetic material derivation fixture, not artwork.' });
  const result = receive(plan, syntheticTerrainMaterial());
  if (result.technical.status !== 'pass') throw new Error('Synthetic material failed');
  const bundle = workflow.buildTerrainProofBundle(root, plan.sha256, join(output, 'proof'));
  const verification = workflow.verifyTerrainProofBundle(root, plan.sha256, join(output, 'proof'));
  const report = { format: 'ai_scene_terrain_proof_demo_v1', purpose: 'synthetic-simulation', planSha256: plan.sha256,
    rawSha256: result.rawSha256, bundleSha256: bundle.sha256, verifiedFiles: verification.verifiedFiles,
    proofLayouts: 3, derivedCardinalTiles: 16, actualMediaGenerationCalls: 0, coreProviderCalls: 0,
    humanVisualReview: 'not-run', productionKit: false, visualAcceptance: 'not-assessed' };
  writeFreshFile(join(output, 'demo-report.json'), jsonBytes(report), sourceRoot);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: error.errors?.[0]?.code ?? 'DEMO_FAILED',
    message: 'Synthetic terrain proof failed; preserve partial evidence; never overwrite or automatically generate' }));
  process.exitCode = 1;
}
