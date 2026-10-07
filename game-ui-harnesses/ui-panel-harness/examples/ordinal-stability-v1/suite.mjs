/** Fresh two-round cohort. Original failed v1 and three-case rechecks remain unchanged. */
import { INPUT_STRESS_SUITE } from '../input-stress-v1/suite.mjs';
import { INPUT_STRESS_RECHECK_SUITE } from '../input-stress-v2/suite.mjs';
export const ORDINAL_STABILITY_SUITE = {
  panelEvaluationSuiteVersion: '0.3',
  scope: 'All16 fresh cohort, repeated independently twice only after the first cohort passes. Fixed explicit business expectations; not arbitrary-input reliability certification.',
  cases: INPUT_STRESS_SUITE.cases.map(source => {
    const item = structuredClone(source);
    if (item.id === 'eval-character') item.request = structuredClone(INPUT_STRESS_RECHECK_SUITE.cases.find(value => value.id === item.id).request);
    return item;
  }),
};
