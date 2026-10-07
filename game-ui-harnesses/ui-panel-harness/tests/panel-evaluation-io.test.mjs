import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, cp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { harnessRoot, readJson, writeNewJson } from '../src/io.mjs';
import { digestJson } from '../src/canonical.mjs';
import { createPlanningContext } from '../src/planning-context.mjs';
import { createAssetRetrieval } from '../src/asset-retrieval.mjs';
import { materializePanelIntent } from '../src/panel-intent.mjs';
import { checkPanelProposal } from '../src/proposal.mjs';
import { createPanelBundle } from '../src/panel-bundle.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { readPanelEvaluationRun } from '../src/panel-evaluation-io.mjs';
import { evaluatePanelSemantics, evaluateRecipeHits } from '../src/panel-evaluation.mjs';
import { PANEL_EVALUATION_SUITE } from '../examples/panel-evaluation/suite.mjs';
import { compactIntentFixture } from '../examples/panel-evaluation/intent-fixture.mjs';

// Synthetic on-disk evidence only. No CLI process, provider request or real run is used.
const core = await loadWorkspaceCore(), catalog = await readJson(new URL('../examples/modern-mint-layout.catalog.json', import.meta.url));
await mkdir(join(harnessRoot, '.tmp'), { recursive: true });
const work = await mkdtemp(join(harnessRoot, '.tmp', 'evaluation-evidence-'));
async function fixture() {
  const directory = join(work, 'source'); await mkdir(directory);
  const item = PANEL_EVALUATION_SUITE.cases[0], suite = { ...PANEL_EVALUATION_SUITE, cases: [item] };
  const library = { id: 'fixture-assets', sha256: 'a'.repeat(64) };
  const context = await createPlanningContext(item.request, catalog,
    createAssetRetrieval(item.request.text, { assetLibraryVersion: '0.1', ...library, records: [] }));
  const proposal = await materializePanelIntent(context, compactIntentFixture(context, item)), planning = await checkPanelProposal(context, proposal);
  const bundle = await createPanelBundle(proposal.spec, catalog, core), semantic = evaluatePanelSemantics(proposal.spec, item.expected);
  const planCase = { id: item.id, title: item.title, contextFile: `${item.id}.context.json`, contextSha256: context.sha256,
    expectedSha256: await digestJson(item.expected), retrieval: evaluateRecipeHits(context, item.expected) };
  const planPayload = { panelEvaluationPlanVersion: '0.1', suiteSha256: await digestJson(suite), catalogSha256: context.catalogSha256,
    library, cases: [planCase] }, plan = { ...planPayload, sha256: await digestJson(planPayload) };
  const receipt = { codexPlanningReceiptVersion: '0.1', model: 'gpt-6-luna', effort: 'xhigh', contextSha256: context.sha256,
    proposalSha256: planning.proposalSha256, status: 'READY_TO_COMPILE', failureCode: null,
    invocationCount: 1, automaticRetries: 0, elapsedMs: 0, usage: null };
  const result = { panelEvaluationCaseVersion: '0.1', ...planCase, model: 'READY_TO_COMPILE', semantic: 'PASS', compile: 'PASS',
    status: 'PASS_BEFORE_BROWSER', receipt, unresolved: [], diagnostic: null, failureCode: null, bundleSha256: bundle.sha256 };
  delete result.contextFile;
  const report = { panelEvaluationReportVersion: '0.1', planSha256: plan.sha256, status: 'PASS_BEFORE_BROWSER', cases: [result],
    totals: { cases: 1, recipeHits: 1, modelReady: 1, semanticPass: 1, compilePass: 1, invocationCount: 1, automaticRetries: 0 } };
  for (const [name, value] of Object.entries({ 'evaluation-plan.json': plan, 'suite.json': suite, 'evaluation-report.json': report })) await writeNewJson(directory, name, value);
  const output = join(directory, item.id), attempt = join(output, 'codex-11111111-1111-1111-1111-111111111111'); await mkdir(attempt, { recursive: true });
  for (const [name, value] of Object.entries({ 'case-result.json': result, 'semantic-report.json': semantic, 'panel.bundle.json': bundle })) await writeNewJson(output, name, value);
  for (const [name, value] of Object.entries({ 'planning-context.json': context, 'proposal.json': proposal, 'planning-report.json': planning, 'codex-receipt.json': receipt })) await writeNewJson(attempt, name, value);
  return directory;
}

test('evidence reader replays proposals, semantic gates and bundles and rejects forged aggregate/case facts', async () => {
  const directory = await fixture(), accepted = await readPanelEvaluationRun(directory, core);
  assert.equal(accepted.bundles.size, 1); assert.equal(accepted.report.status, 'PASS_BEFORE_BROWSER');
  const changes = [
    report => { report.totals.invocationCount = 0; },
    report => { report.status = 'FAIL'; },
    report => { report.cases[0].id = 'wrong'; },
    report => { report.cases[0].expectedSha256 = 'b'.repeat(64); },
    report => { report.cases[0].retrieval.status = 'MISS'; },
    report => { report.cases[0].receipt.status = 'FAILED'; report.cases[0].receipt.failureCode = 'CODEX_OUTPUT_INVALID'; report.cases[0].receipt.proposalSha256 = null; },
  ];
  for (const [i, mutate] of changes.entries()) {
    const copy = join(work, `tampered${i}`); await cp(directory, copy, { recursive: true });
    const report = await readJson(join(copy, 'evaluation-report.json')); mutate(report);
    await writeFile(join(copy, 'evaluation-report.json'), JSON.stringify(report));
    await writeFile(join(copy, 'eval-audio/case-result.json'), JSON.stringify(report.cases[0]));
    if (i === 5) await writeFile(join(copy, 'eval-audio/codex-11111111-1111-1111-1111-111111111111/codex-receipt.json'), JSON.stringify(report.cases[0].receipt));
    await assert.rejects(readPanelEvaluationRun(copy, core));
  }
  const copy = join(work, 'duplicate-attempt'); await cp(directory, copy, { recursive: true });
  await mkdir(join(copy, 'eval-audio/codex-22222222-2222-2222-2222-222222222222'));
  await assert.rejects(readPanelEvaluationRun(copy, core), /EVALUATION_ATTEMPT_COUNT/);
});
