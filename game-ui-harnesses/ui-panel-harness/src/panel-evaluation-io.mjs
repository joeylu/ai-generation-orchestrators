/** Read and independently revalidate finite real-generation evidence before any preview or composition. */
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readJson } from './io.mjs';
import { canonicalJson, digestJson } from './canonical.mjs';
import { validatePanelBundle } from './panel-bundle.mjs';
import { validateCodexReceipt } from './codex-planner.mjs';
import { validateCodexDiagnostic } from './codex-diagnostics.mjs';
import { validatePlanningContext } from './planning-context.mjs';
import { checkPanelProposal } from './proposal.mjs';
import { evaluatePanelSemantics, evaluateRecipeHits } from './panel-evaluation.mjs';
const equal = (a, b) => { if (canonicalJson(a) !== canonicalJson(b)) throw new Error('EVALUATION_EVIDENCE_MISMATCH'); };
export async function readPanelEvaluationRun(input, core) {
  const directory = resolve(input), report = await readJson(resolve(directory, 'evaluation-report.json'));
  const plan = await readJson(resolve(directory, 'evaluation-plan.json')), suite = await readJson(resolve(directory, 'suite.json'));
  const { sha256, ...payload } = plan;
  if (sha256 !== await digestJson(payload) || report.planSha256 !== sha256 || plan.cases.length < 1 || plan.cases.length > 64
    || suite.cases.length !== plan.cases.length || report.cases.length !== plan.cases.length || plan.suiteSha256 !== await digestJson(suite)
    || new Set(plan.cases.map(item => item.id)).size !== plan.cases.length) throw new Error('EVALUATION_PLAN_MISMATCH');
  const cases = [], bundles = new Map();
  for (let i = 0; i < plan.cases.length; i++) {
    const item = plan.cases[i], expected = suite.cases[i];
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(item.id) || item.id !== expected.id || item.expectedSha256 !== await digestJson(expected.expected)) throw new Error('EVALUATION_CASE_MISMATCH');
    const output = resolve(directory, item.id), result = await readJson(resolve(output, 'case-result.json'));
    equal(result, report.cases[i]); equal(result.panelEvaluationCaseVersion, '0.1');
    equal(result.id, item.id); equal(result.title, item.title); equal(result.expectedSha256, item.expectedSha256);
    equal(result.contextSha256, item.contextSha256); equal(result.retrieval, item.retrieval);
    const names = (await readdir(output)).filter(name => /^codex-[a-f0-9-]{36}$/.test(name));
    if (names.length !== 1) throw new Error('EVALUATION_ATTEMPT_COUNT');
    const attempt = resolve(output, names[0]), context = await validatePlanningContext(await readJson(resolve(attempt, 'planning-context.json')));
    equal(context.sha256, item.contextSha256); equal(context.catalogSha256, plan.catalogSha256); equal(context.assetRetrieval.library, plan.library);
    equal(context.request, expected.request); equal(evaluateRecipeHits(context, expected.expected), item.retrieval);
    const receipt = validateCodexReceipt(await readJson(resolve(attempt, 'codex-receipt.json')), { contextSha256: item.contextSha256 }); equal(receipt, result.receipt);
    let semanticFailures = [];
    if (receipt.status !== 'FAILED') {
      const proposal = await readJson(resolve(attempt, 'proposal.json')), checked = await checkPanelProposal(context, proposal);
      equal(checked, await readJson(resolve(attempt, 'planning-report.json'))); equal(receipt.proposalSha256, checked.proposalSha256);
      equal(receipt.status, result.model); equal(result.unresolved, checked.unresolved);
      if (checked.status === 'READY_TO_COMPILE') {
        const semantic = evaluatePanelSemantics(proposal.spec, expected.expected);
        equal(semantic, await readJson(resolve(output, 'semantic-report.json'))); equal(semantic.status, result.semantic);
        semanticFailures = semantic.checks.filter(check => check.status === 'FAIL');
        if (result.compile === 'PASS') {
          const bundle = await validatePanelBundle(await readJson(resolve(output, 'panel.bundle.json')), core);
          equal(bundle.spec, proposal.spec); equal(bundle.sha256, result.bundleSha256); bundles.set(item.id, bundle);
        }
      }
    } else {
      equal(result.model, 'FAIL'); equal(result.semantic, 'NOT_RUN'); equal(result.compile, 'NOT_RUN');
      equal(result.unresolved, []); equal(result.bundleSha256, null);
      equal(receipt.failureCode, result.failureCode);
      if (result.diagnostic) equal(result.diagnostic, validateCodexDiagnostic(await readJson(resolve(attempt, 'codex-diagnostic.json')),
        { operation: 'plan', contextSha256: item.contextSha256, failureCode: receipt.failureCode }));
    }
    equal(result.status, result.model === 'READY_TO_COMPILE' && result.semantic === 'PASS' && result.compile === 'PASS' ? 'PASS_BEFORE_BROWSER' : 'FAIL');
    cases.push({ ...result, requestText: expected.request.text, semanticFailures, previewFile: bundles.has(item.id) ? `${item.id}.html` : null });
  }
  const totals = { cases: cases.length, recipeHits: cases.filter(item => item.retrieval.status === 'PASS').length,
    modelReady: cases.filter(item => item.model === 'READY_TO_COMPILE').length, semanticPass: cases.filter(item => item.semantic === 'PASS').length,
    compilePass: cases.filter(item => item.compile === 'PASS').length, invocationCount: cases.reduce((n, item) => n + item.receipt.invocationCount, 0), automaticRetries: 0 };
  for (const [key, value] of Object.entries(totals)) equal(report.totals[key], value);
  equal(report.status, cases.every(item => item.status === 'PASS_BEFORE_BROWSER') ? 'PASS_BEFORE_BROWSER' : 'FAIL');
  return { report, plan, suite, cases, bundles };
}
