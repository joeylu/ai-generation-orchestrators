import { snapshotJson } from './spec.mjs';
import { validatePanelRequest } from './planning-context.mjs';

/** Examples describe player tasks. They contain no invisible business defaults. */
export const beginnerExamples = Object.freeze([
  Object.freeze({ title: '声音设置', text: '做一个声音设置，让玩家调节音量、打开或关闭静音，还能恢复默认。' }),
  Object.freeze({ title: '角色命名', text: '做一个角色命名界面，让玩家输入角色名后确认，也能取消。' }),
  Object.freeze({ title: '加载界面', text: '做一个加载界面，显示加载进度和“正在加载”的提示。' }),
]);

/** Only explicit, complete suffix blocks become buttons; public question text stays single-line. */
export function questionPresentation(text) {
  const fallback = { prompt: text, choices: [] };
  if (typeof text !== 'string' || /[\p{Cc}\p{Cs}]/u.test(text)) return fallback;
  const start = text.search(/【(?:推荐回答|备选回答)：/u);
  if (start < 1 || !text.slice(0, start).trim()) return fallback;
  const suffix = text.slice(start), blocks = [...suffix.matchAll(/【(推荐回答|备选回答)：([^【】]+)】/gu)], choices = [];
  if (!blocks.length || blocks.map(block => block[0]).join('') !== suffix) return fallback;
  for (const match of blocks) {
    const value = match[2].trim(), recommended = match[1] === '推荐回答';
    if (!value || [...value].length > 160 || /[\p{Cc}\p{Cs}]/u.test(value)
        || choices.some(choice => choice.value === value || recommended && choice.recommended)) return fallback;
    choices.push({ value, recommended });
  }
  if (choices.length > 3) return fallback;
  return { prompt: text.slice(0, start), choices };
}

/** The UI supplies already verified edit questions; answers are task text, never compute approval. */
export function appendEditAnswers(requestInput, questionsInput, answersInput) {
  const request = snapshotJson(requestInput), questions = snapshotJson(questionsInput), answers = snapshotJson(answersInput);
  const fail = code => { throw Object.assign(new Error(code), { code }); };
  validatePanelRequest(request);
  if (!Array.isArray(questions) || !questions.length || questions.length > 64 || !Array.isArray(answers) || answers.length > 64) fail('CLARIFICATION_INPUT_INVALID');
  const ids = new Set();
  for (const question of questions) {
    if (!question || Object.keys(question).sort().join('|') !== 'id|question'
        || typeof question.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(question.id) || ids.has(question.id)
        || typeof question.question !== 'string' || !question.question.trim() || [...question.question].length > 500
        || /[\p{Cc}\p{Cs}]/u.test(question.question)) fail('CLARIFICATION_INPUT_INVALID');
    ids.add(question.id);
  }
  const values = new Map();
  for (const answer of answers) {
    if (!answer || Object.keys(answer).sort().join('|') !== 'questionId|text') fail('CLARIFICATION_INPUT_INVALID');
    if (!ids.has(answer.questionId)) fail('CLARIFICATION_ANSWER_UNKNOWN');
    if (values.has(answer.questionId)) fail('CLARIFICATION_ANSWER_DUPLICATE');
    if (typeof answer.text !== 'string' || !answer.text.trim() || [...answer.text].length > 2000
        || /[\p{Cc}\p{Cs}]/u.test(answer.text.replace(/[\r\n\t]/gu, ''))) fail('CLARIFICATION_ANSWER_TEXT');
    values.set(answer.questionId, answer.text);
  }
  if (values.size !== ids.size) fail('CLARIFICATION_ANSWER_MISSING');
  const supplement = questions.map((question, index) => `问题 ${index + 1}：${question.question}\n回答：${values.get(question.id)}`).join('\n\n');
  const clarified = { ...request, text: `${request.text}\n\n【补充回答】\n${supplement}` };
  try { return validatePanelRequest(clarified); }
  catch { fail('CLARIFICATION_REQUEST_TOO_LONG'); }
}

/** Display only adopted answers. The full immutable question remains in the planning context. */
export function clarificationDisplayText(originalText, questions, answers) {
  const values = new Map(answers.map(answer => [answer.questionId, answer.text]));
  return `${originalText}\n\n【补充回答】\n${questions.map((question, index) =>
    `问题 ${index + 1}：${questionPresentation(question.question).prompt}\n回答：${values.get(question.id)}`).join('\n\n')}`;
}

/** Summarize a validated, compiled PanelSpec, not a model's promises or live player state. */
export function summarizePanel(spec) {
  const rows = spec.sections.flatMap(section => section.rows), state = new Map(spec.state.map(field => [field.id, field]));
  const name = row => row.kind === 'button' ? row.buttonLabel : row.label || (row.kind === 'text' ? '文字提示' : '未命名控件');
  const fieldNames = new Map(rows.filter(row => row.bind).map(row => [row.bind, name(row)]));
  if (spec.tabs) fieldNames.set(spec.tabs.bind, '当前页面');
  const names = rows.map(name), shown = names.slice(0, 6).join('、');
  const overview = `包含${shown}${names.length > 6 ? `等 ${names.length} 项` : ''}。`;
  const details = [];
  if (spec.tabs) {
    const selected = spec.tabs.pages.find(page => page.id === state.get(spec.tabs.bind)?.initial);
    details.push(`页面：${spec.tabs.pages.map(page => page.label).join('、')}；默认打开${selected?.label ?? '未指定页面'}。`);
  }
  for (const row of rows) {
    const field = state.get(row.bind), label = name(row), disabled = row.enabled === false ? '（不可操作）' : '';
    if (row.kind === 'slider') details.push(`${label}${disabled}：${field.min}～${field.max}，每次变化 ${field.step}，默认 ${field.initial}。`);
    else if (row.kind === 'switch') details.push(`${label}${disabled}：默认${field.initial ? '开启' : '关闭'}。`);
    else if (row.kind === 'select') details.push(`${label}${disabled}：可选${field.options.map(option => option.label).join('、')}；默认${field.options.find(option => option.id === field.initial)?.label}。`);
    else if (row.kind === 'progress') details.push(`${label}：0～${field.max}，初始 ${field.initial}；${row.format.mode === 'percent' ? '显示百分比' : '显示数值'}，由游戏更新。`);
    else if (row.kind === 'input') {
      const initial = row.inputType === 'password' ? field.initial ? '已设置' : '为空' : field.initial ? `“${field.initial}”` : '为空';
      details.push(`${label}${disabled}：${row.validation.required ? '必填' : '选填'}，最少 ${row.validation.minLength}、最多 ${field.maxLength} 个字符；初始${initial}${row.readOnly ? '，只读' : ''}。`);
    } else if (row.kind === 'text') details.push(`${label}：${row.text}`);
    else if (row.kind === 'button') {
      const scope = row.action.fields?.map(id => fieldNames.get(id) ?? id).join('、');
      details.push(`${label}${disabled}：${row.action.kind === 'reset-initial' ? `恢复${scope}的默认值` : row.action.kind === 'submit' ? `校验并提交${scope}` : '通知游戏处理，预览中不执行游戏业务'}。`);
    }
  }
  return { overview, details };
}
