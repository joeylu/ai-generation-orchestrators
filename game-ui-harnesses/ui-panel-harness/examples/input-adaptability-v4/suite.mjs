import {INPUT_CAPABILITY_CASES} from '../input-adaptability-v3/suite.mjs';
const prior=structuredClone(INPUT_CAPABILITY_CASES[0]);
export const CLARIFICATION_CLOSEOUT_CASES=[{...prior,id:'F01',priorCaseId:'C01',category:'answered-real-name-clarification',request:{...prior.request,id:'F01',text:prior.request.text+
  '\n\n【补充回答】\n问题 1：输入框名称是“玩家名”还是“玩家名单”？原文“玩家名单行文字输入”中的“单行”可能是输入类型描述。请用引号明确完整名称。\n回答：输入框完整名称是“玩家名”。其他要求全部保持不变。'}}];
