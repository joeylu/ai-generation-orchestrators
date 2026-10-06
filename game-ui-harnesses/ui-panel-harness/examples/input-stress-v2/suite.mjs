/** Fresh recheck inputs. The frozen v1 inputs, expectations and FAIL stay intact. */
import { INPUT_STRESS_SUITE } from '../input-stress-v1/suite.mjs';
const ids = ['eval-graphics', 'eval-character', 'eval-inventory'];
export const INPUT_STRESS_RECHECK_SUITE = {
  panelEvaluationSuiteVersion: '0.3',
  scope: 'Three fresh single-attempt rechecks after ordinal transport and literal-name safeguards. Character title wording is explicit. This does not revise the failed v1 cohort or certify all16 compositions.',
  cases: ids.map(id => {
    const item = structuredClone(INPUT_STRESS_SUITE.cases.find(value => value.id === id));
    if (id === 'eval-character') item.request.text = item.request.text.replace('角色信息面板，两列grid', '生成角色信息面板，面板标题必须是“角色信息”。两列grid');
    return item;
  }),
};
