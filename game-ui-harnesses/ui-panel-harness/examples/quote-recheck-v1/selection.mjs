import assert from 'node:assert/strict';
import { QUOTE_RECHECK_SUITE } from './suite.mjs';
import { ORDINAL_STABILITY_SUITE } from '../ordinal-stability-v1/suite.mjs';

/** Select original regression cases without changing requests or expectations. */
export function selectQuoteRecheckSuite({ caseId, caseIds } = {}) {
  assert(!(caseId && caseIds), 'QUOTE_RECHECK_SELECTION_CONFLICT');
  if (caseId === undefined && caseIds === undefined) return structuredClone(QUOTE_RECHECK_SUITE);
  const ids = caseId !== undefined ? [caseId] : caseIds.split(',');
  assert(ids.length >= 1 && ids.length <= 3 && new Set(ids).size === ids.length, 'QUOTE_RECHECK_SELECTION_INVALID');
  const cases = ids.map(id => {
    assert(typeof id === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(id), 'QUOTE_RECHECK_SELECTION_INVALID');
    const item = [...QUOTE_RECHECK_SUITE.cases, ...ORDINAL_STABILITY_SUITE.cases].find(item => item.id === id);
    assert(item, 'QUOTE_RECHECK_CASE_UNKNOWN'); return structuredClone(item);
  });
  return { panelEvaluationSuiteVersion: '0.3',
    scope: 'Original selected requests and exact business expectations. One fresh attempt per case; no two-round or composition certification.', cases };
}
