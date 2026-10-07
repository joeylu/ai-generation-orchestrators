/** Explicit fixed-request oracle correction. No general label normalization. */
import { canonicalJson } from '../../src/canonical.mjs';
import { QUOTE_RECHECK_SUITE } from '../quote-recheck-v1/suite.mjs';

export const QUOTE_LABEL_CORRECTION = {
  version:'0.1', caseId:'quote-tabs-progress', rowIndex:4,
  requestQuote:'以及加载进度条0～1、初始0.2、百分比显示一位小数',
  labels:['加载进度','加载进度条'],
  reason:'The fixed request describes a loading progress bar without assigning its exact row label. Both names preserve that description. Exact titles, named tabs and every other business property remain unchanged.',
};

/** Entire alternate expectations, each checked by the unchanged exact evaluator.
 * Reject other input/suite versions instead of inferring aliases from a model. */
export function quoteRecheckExpectationVariants(item) {
  const original=QUOTE_RECHECK_SUITE.cases.find(value=>value.id===item.id);
  if (!original || canonicalJson(item)!==canonicalJson(original)) throw new Error('QUOTE_ORACLE_SOURCE_MISMATCH');
  const expectations=[structuredClone(original.expected)];
  if (item.id!==QUOTE_LABEL_CORRECTION.caseId) return expectations;
  if (!item.request.text.includes(QUOTE_LABEL_CORRECTION.requestQuote)) throw new Error('QUOTE_ORACLE_SOURCE_MISMATCH');
  const alternate=structuredClone(original.expected);
  if (alternate.rows[4].kind!=='progress' || alternate.rows[4].label!=='加载进度'
    || alternate.tabs.pages[1].rowLabels[1]!=='加载进度') throw new Error('QUOTE_ORACLE_SOURCE_MISMATCH');
  alternate.rows[4].label='加载进度条'; alternate.tabs.pages[1].rowLabels[1]='加载进度条';
  expectations.push(alternate);
  return expectations;
}
