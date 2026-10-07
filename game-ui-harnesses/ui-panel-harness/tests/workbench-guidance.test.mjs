import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { beginnerExamples, questionPresentation, appendEditAnswers, clarificationDisplayText, summarizePanel } from '../src/workbench-guidance.mjs';
import { createPlanningContext } from '../src/planning-context.mjs';
import { createClarifiedRequest } from '../src/clarification.mjs';
import { digestJson } from '../src/canonical.mjs';
import { materializePanelIntent } from '../src/panel-intent.mjs';
import { themeRequest, themeIntent } from '../examples/themes-v1/fixture.mjs';
import { applyPanelPatch } from '../src/patch.mjs';
import { CODEX_QUESTIONS_INSTRUCTION, buildCodexQuestionsResponseSchema } from '../src/codex-questions-schema.mjs';

const json = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const catalog = await json('../examples/modern-game-themes.catalog.json');
const theme = catalog.themes[0], context = await createPlanningContext(themeRequest(theme), catalog);
const { spec } = await materializePanelIntent(context, themeIntent(context, theme));
const request = { requestVersion: '0.1', id: 'panel-edit', target: 'pixi', text: '把声音默认值改一下。' };
const questions = [{ id: 'q0', question: '默认音量改为多少？【推荐回答：默认50】【备选回答：默认70】' },
  { id: 'q1', question: '保留静音默认关闭吗？' }];
const answers = [{ questionId: 'q1', text: '保留静音默认关闭。' }, { questionId: 'q0', text: '默认50' }];

test('question options require explicit bounded suffix blocks and never derive business values from keywords', () => {
  assert.deepEqual(questionPresentation(questions[0].question), { prompt: '默认音量改为多少？',
    choices: [{ value: '默认50', recommended: true }, { value: '默认70', recommended: false }] });
  const plain = '音量建议默认70，也可以50，你怎么选？';
  assert.deepEqual(questionPresentation(plain), { prompt: plain, choices: [] });
  for (const value of ['【推荐回答：50】', '初值？【推荐回答：】', '初值？【推荐回答：50】【推荐回答：70】',
    '初值？【推荐回答：50】【备选回答：50】', '初值？【推荐回答：50】然后解释',
    '初值？【备选回答：1】【备选回答：2】【备选回答：3】【备选回答：4】', `初值？【推荐回答：${'😀'.repeat(161)}】`,
    '初值？\n推荐回答：50', '初值？【推荐回答：有【嵌套】】']) {
    assert.deepEqual(questionPresentation(value), { prompt: value, choices: [] }, value);
  }
});

test('edit answers preserve every original character, question and custom answer, ordered by question ID', () => {
  const input = { ...request, text: '  修改🌿\r\n保留原文\t ' };
  const custom = [{ questionId: 'q1', text: ' 保留\r\n静音\t🌿 ' }, answers[1]];
  const result = appendEditAnswers(input, questions, custom);
  assert.deepEqual(result, { ...input, text: input.text + '\n\n【补充回答】\n问题 1：' + questions[0].question
    + '\n回答：默认50\n\n问题 2：' + questions[1].question + '\n回答： 保留\r\n静音\t🌿 ' });
  assert.equal(input.text, '  修改🌿\r\n保留原文\t ');
});

test('missing, duplicated, stale and invalid answers stay unapplied, with no truncation', () => {
  const rejects = (values, code) => assert.throws(() => appendEditAnswers(request, questions, values), error => error.code === code);
  rejects([answers[0]], 'CLARIFICATION_ANSWER_MISSING');
  rejects([answers[0], answers[0]], 'CLARIFICATION_ANSWER_DUPLICATE');
  rejects([{ questionId: 'old-question', text: '50' }], 'CLARIFICATION_ANSWER_UNKNOWN');
  for (const text of ['', ' ', 'a\u0000', '😀'.repeat(2001)]) rejects([{ ...answers[0], text }, answers[1]], 'CLARIFICATION_ANSWER_TEXT');
  assert.throws(() => appendEditAnswers({ ...request, text: 'a'.repeat(7990) }, questions, answers), error => error.code === 'CLARIFICATION_REQUEST_TOO_LONG');
  const accessor = { ...answers[0] }; Object.defineProperty(accessor, 'text', { enumerable: true, get() { throw Error('MUST_NOT_EVALUATE'); } });
  assert.throws(() => appendEditAnswers(request, questions, [accessor, answers[1]]));
});

test('suggested question text remains compatible with digest-bound generation clarification', async () => {
  const proposal = { proposalVersion: context.planningContextVersion, contextSha256: context.sha256, spec: null, decisions: [], unresolved: questions };
  const result = await createClarifiedRequest(context, proposal, { clarificationVersion: '0.1', contextSha256: context.sha256,
    proposalSha256: await digestJson(proposal), answers });
  assert.equal(result.text, appendEditAnswers(context.request, questions, answers).text);
  assert.deepEqual(buildCodexQuestionsResponseSchema().items.required, ['id', 'question']);
  assert(CODEX_QUESTIONS_INSTRUCTION.includes('unselected recommendation/alternative lines are not business evidence'));
});

test('compiled summary describes page defaults, all control types and exact reset/submit scope', () => {
  const summary = summarizePanel(spec);
  assert.equal(summary.overview, '包含主音量、静音、画质、提示、恢复默认、角色名等 9 项。');
  assert.deepEqual(summary.details, [
    '页面：设置、角色；默认打开设置。',
    '主音量：0～100，每次变化 1，默认 70。', '静音：默认关闭。', '画质：可选低、中、高；默认中。',
    '提示：本地预览', '恢复默认：恢复主音量、静音、画质的默认值。', '角色名：必填，最少 2、最多 12 个字符；初始为空。',
    '确认：校验并提交角色名。', '取消：通知游戏处理，预览中不执行游戏业务。', '加载进度：0～100，初始 25；显示百分比，由游戏更新。',
  ]);
});

test('summary follows actual spec edits and does not expose a password default', async () => {
  const changed = await applyPanelPatch(spec, { patchVersion: '0.1', baseSpecSha256: await digestJson(spec), reason: 'Summary regression fixture.',
    operations: [{ op: 'set-state-initial', fieldId: 'row0', value: 50 }, { op: 'set-button-action', rowId: 'row4', action: { kind: 'reset-initial', fields: ['row0'] } }] });
  assert(summarizePanel(changed.spec).details.includes('主音量：0～100，每次变化 1，默认 50。'));
  assert(summarizePanel(changed.spec).details.includes('恢复默认：恢复主音量的默认值。'));
  const privateSpec = structuredClone(spec); privateSpec.sections[1].rows[0].inputType = 'password'; privateSpec.state.find(field => field.id === 'row5').initial = 'secret';
  assert.equal(JSON.stringify(summarizePanel(privateSpec)).includes('secret'), false);
});

test('beginner examples ask for player actions without guessing ranges or hidden defaults', () => {
  assert.equal(beginnerExamples.length, 3);
  for (const example of beginnerExamples) { assert(example.text.includes('界面') || example.text.includes('设置')); assert.equal(/[0-9]|默认\d/u.test(example.text), false); }
});

test('display omits unselected suggestions while retaining exact original text, prompt and adopted answers', () => {
  const displayed = clarificationDisplayText(request.text, questions, answers);
  assert.equal(displayed, request.text + '\n\n【补充回答】\n问题 1：默认音量改为多少？\n回答：默认50\n\n问题 2：保留静音默认关闭吗？\n回答：保留静音默认关闭。');
  assert.equal(displayed.includes('备选回答'), false);
  assert(appendEditAnswers(request, questions, answers).text.includes('【备选回答：默认70】'));
});
