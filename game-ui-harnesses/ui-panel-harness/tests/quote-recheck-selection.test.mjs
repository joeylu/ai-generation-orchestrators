import test from 'node:test';
import assert from 'node:assert/strict';
import { selectQuoteRecheckSuite } from '../examples/quote-recheck-v1/selection.mjs';
import { QUOTE_RECHECK_SUITE } from '../examples/quote-recheck-v1/suite.mjs';
import { ORDINAL_STABILITY_SUITE } from '../examples/ordinal-stability-v1/suite.mjs';

test('default and existing single selections preserve their original requests and expectations', () => {
  assert.deepEqual(selectQuoteRecheckSuite(), QUOTE_RECHECK_SUITE);
  for (const caseId of ['eval-confirm', 'quote-clarified-audio']) {
    const item = [...QUOTE_RECHECK_SUITE.cases, ...ORDINAL_STABILITY_SUITE.cases].find(item => item.id === caseId);
    assert.deepEqual(selectQuoteRecheckSuite({ caseId }).cases, [item]);
  }
});

test('the two failed cases are selected from the original16 without aliases or rewritten input', () => {
  const selected = selectQuoteRecheckSuite({ caseIds: 'eval-quest,eval-graphics' });
  assert.deepEqual(selected.cases, ['eval-quest', 'eval-graphics'].map(id => ORDINAL_STABILITY_SUITE.cases.find(item => item.id === id)));
  selected.cases[0].expected.title = 'changed';
  assert.equal(ORDINAL_STABILITY_SUITE.cases.find(item => item.id === 'eval-quest').expected.title, '任务详情');
});

test('conflicts, unknown, duplicate, empty and oversized selections fail before any preparation', () => {
  for (const input of [{ caseId: 'eval-quest', caseIds: 'eval-graphics' }, { caseIds: '' }, { caseId: '' },
    { caseIds: 'eval-quest,eval-quest' }, { caseIds: 'eval-quest,' }, { caseIds: 'eval-quest, eval-graphics' },
    { caseIds: 'eval-quest,eval-graphics,eval-audio,eval-controls' }, { caseId: 'new-request' }]) {
    assert.throws(() => selectQuoteRecheckSuite(input));
  }
});
