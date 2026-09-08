import test from 'node:test';
import assert from 'node:assert/strict';
import { HarnessError } from '../src/contract.ts';
import {
  analysisReport, createAnalysisSession, recordAnalysis, validateAnalysisSession,
  type AnalysisRecordInput, type AnalysisSessionInput,
} from '../src/analysis-session.ts';

const source = { reference: 'assets/reference-ui.png', sha256: 'a'.repeat(64) };
const plan = (): AnalysisSessionInput => ({ analysisVersion: '0.1', id: 'quest-panel', source, attemptBudget: 2 });
const unresolved = (): AnalysisRecordInput => ({ source, result: { status: 'Unresolved', reason: 'The supplied source does not show the lower panel.' } });
const supported = (): AnalysisRecordInput => ({ source, result: { status: 'Supported', summary: 'The visible action is a standard button.', componentType: 'Button' } });

function expectIssue(run: () => unknown, code: string, path?: string): void {
  assert.throws(run, (error: unknown) => error instanceof HarnessError && error.stage === 'contract'
    && error.issues.some(issue => issue.code === code && (path === undefined || issue.path === path)));
}

test('analysis ledger binds a source, derives NOT_RUN, and records an explicit unresolved retry', () => {
  const input = plan(); const created = createAnalysisSession(input);
  assert.deepEqual(analysisReport(created), {
    id: 'quest-panel', source, attemptBudget: 2, attemptsUsed: 0, attemptsRemaining: 2,
    status: 'NOT_RUN', canStartAnalysis: true, canReanalyze: false, attempts: [],
  });
  assert.notEqual(created, input); assert.deepEqual(input, plan());

  const retriable = recordAnalysis(created, unresolved());
  const report = analysisReport(retriable);
  assert.equal(report.status, 'Unresolved'); assert.equal(report.attemptsUsed, 1); assert.equal(report.attemptsRemaining, 1);
  assert.equal(report.canStartAnalysis, false); assert.equal(report.canReanalyze, true);
  assert.deepEqual(report.attempts[0], { attempt: 1, source, result: unresolved().result });

  const complete = recordAnalysis(retriable, supported());
  assert.deepEqual(analysisReport(complete), {
    id: 'quest-panel', source, attemptBudget: 2, attemptsUsed: 2, attemptsRemaining: 0,
    status: 'Supported', canStartAnalysis: false, canReanalyze: false,
    attempts: [
      { attempt: 1, source, result: unresolved().result },
      { attempt: 2, source, result: supported().result },
    ],
  });
});

test('recording is source-bound, immutable, and never creates renderable UI input', () => {
  const first = recordAnalysis(createAnalysisSession(plan()), supported());
  const before = structuredClone(first);
  const report = analysisReport(first);
  report.source.reference = 'assets/changed.png';
  if (report.attempts[0].result.status === 'Supported') report.attempts[0].result.summary = 'changed';
  assert.deepEqual(first, before);

  const mismatched = supported(); mismatched.source = { ...source, sha256: 'b'.repeat(64) };
  expectIssue(() => recordAnalysis(createAnalysisSession(plan()), mismatched), 'SOURCE_MISMATCH', '$record.source');
  expectIssue(() => recordAnalysis(first, supported()), 'REANALYSIS_NOT_ALLOWED');
  assert.equal('root' in first.attempts[0].result, false);
  assert.equal('layout' in first.attempts[0].result, false);
});

test('Composite and Custom-required are explicit, validated terminal classifications', () => {
  const composite = recordAnalysis(createAnalysisSession(plan()), {
    source,
    result: { status: 'Composite', summary: 'A panel contains one button and one progress bar.', componentTypes: ['Panel', 'Button', 'ProgressBar'] },
  });
  assert.equal(analysisReport(composite).status, 'Composite');
  expectIssue(() => recordAnalysis(composite, unresolved()), 'REANALYSIS_NOT_ALLOWED');

  const custom = recordAnalysis(createAnalysisSession(plan()), {
    source,
    result: { status: 'Custom-required', reason: 'The source needs a renderer outside the fixed v0.2 component set.' },
  });
  const report = analysisReport(custom);
  assert.equal(report.status, 'Custom-required'); assert.equal(report.canReanalyze, false);
  expectIssue(() => recordAnalysis(custom, unresolved()), 'REANALYSIS_NOT_ALLOWED');
});

test('strict records reject unknown result fields, fake statuses, unsupported types, and invalid budgets', () => {
  const cases: Array<[unknown, string, string?]> = [
    [{ ...plan(), extra: true }, 'UNSUPPORTED_FIELD', '$analysis.extra'],
    [{ ...plan(), source: { ...source, sha256: 'A'.repeat(64) } }, 'INVALID_SHA256', '$analysis.source.sha256'],
    [{ ...plan(), source: { ...source, reference: '../outside.png' } }, 'PATH_TRAVERSAL_FORBIDDEN', '$analysis.source.reference'],
    [{ ...plan(), attemptBudget: 0 }, 'INVALID_ATTEMPT_BUDGET', '$analysis.attemptBudget'],
  ];
  for (const [input, code, path] of cases) expectIssue(() => createAnalysisSession(input), code, path);

  const session = createAnalysisSession(plan());
  expectIssue(() => recordAnalysis(session, { source, result: { status: 'NOT_RUN' } }), 'NON_RECORDABLE_STATUS', '$record.result.status');
  expectIssue(() => recordAnalysis(session, { source, result: { status: 'Supported', summary: 'Known', componentType: 'Custom' } }), 'UNSUPPORTED_COMPONENT_TYPE', '$record.result.componentType');
  expectIssue(() => recordAnalysis(session, { source, result: { status: 'Composite', summary: 'Two things', componentTypes: ['Button'] } }), 'MIN_ITEMS_REQUIRED', '$record.result.componentTypes');
  expectIssue(() => recordAnalysis(session, { source, result: { status: 'Custom-required', reason: 'Requires a custom renderer', renderer: 'fake' } }), 'UNSUPPORTED_FIELD', '$record.result.renderer');
});

test('persisted ledgers reject budget bypasses and reanalysis after terminal states', () => {
  const unresolvedOnce = recordAnalysis(createAnalysisSession(plan()), unresolved());
  const exhausted = recordAnalysis(unresolvedOnce, unresolved());
  expectIssue(() => recordAnalysis(exhausted, supported()), 'ATTEMPT_BUDGET_EXHAUSTED');

  const terminal = recordAnalysis(createAnalysisSession(plan()), { source, result: { status: 'FAILED', reason: 'Caller could not complete analysis.' } });
  expectIssue(() => recordAnalysis(terminal, unresolved()), 'REANALYSIS_NOT_ALLOWED');

  const malformed: any = structuredClone(unresolvedOnce);
  malformed.attempts.push({ attempt: 2, source, result: { status: 'FAILED', reason: 'terminal' } });
  malformed.attempts.push({ attempt: 3, source, result: { status: 'Unresolved', reason: 'not legal after failure' } });
  expectIssue(() => validateAnalysisSession(malformed), 'ATTEMPT_BUDGET_EXHAUSTED');
  expectIssue(() => validateAnalysisSession(malformed), 'REANALYSIS_NOT_ALLOWED', '$analysis.attempts[1].result.status');
  malformed.attempts[1].attempt = 7;
  expectIssue(() => validateAnalysisSession(malformed), 'INVALID_ATTEMPT_NUMBER', '$analysis.attempts[1].attempt');
});
