import assert from 'node:assert/strict';
import test from 'node:test';
import { catalog, copy, fixture, freeze } from './helpers.mjs';
import { digestJson } from '../src/canonical.mjs';
import { createPlanningContext, validatePanelRequest } from '../src/planning-context.mjs';
import { proposalTargets } from '../src/proposal.mjs';
import { createClarifiedRequest, PanelClarificationError } from '../src/index.mjs';

const requestText = '  帮我制作音频设置面板 😀\r\n保留原文、换行和制表符。\t ';
const panelRequest = text => ({ requestVersion: '0.1', id: 'audio-clarification', text, target: 'pixi' });
const questions = [
  { id: 'initial-volume', question: '音量初值应为多少？' },
  { id: 'audio-enabled', question: '声音默认开启吗？' },
];
const answerTexts = ['  初值 80。\r\n显示整数百分比 😀\t保留空格。  ', '开启。\n事件 audio.enabledChanged。'];

async function inputs(text = requestText) {
  const context = await createPlanningContext(panelRequest(text), catalog);
  const proposal = { proposalVersion: '0.1', contextSha256: context.sha256, spec: null, decisions: [], unresolved: copy(questions) };
  const clarification = {
    clarificationVersion: '0.1', contextSha256: context.sha256, proposalSha256: await digestJson(proposal),
    answers: questions.map(({ id }, index) => ({ questionId: id, text: answerTexts[index] })),
  };
  return { context, proposal, clarification };
}

const run = ({ context, proposal, clarification }) => createClarifiedRequest(context, proposal, clarification);
const rejectsCode = (promise, code) => assert.rejects(promise, error => error instanceof PanelClarificationError && error.code === code);
const supplement = (questionList, texts) => '\n\n【补充回答】\n' + questionList.map(({ question }, index) =>
  `问题 ${index + 1}：${question}\n回答：${texts[index]}`).join('\n\n');

test('clarification preserves the original request and multiline answers without adding digest metadata', async () => {
  const values = await inputs();
  const result = await run(values);
  assert.deepEqual(result, { ...values.context.request, text: requestText + supplement(questions, answerTexts) });
  assert.equal(result.text.slice(0, requestText.length), requestText);
  assert.equal(result.text.includes(values.context.sha256), false);
  assert.equal(result.text.includes(values.clarification.proposalSha256), false);
  assert.deepEqual(validatePanelRequest(result), result);
  assert.notEqual(result, values.context.request);
});

test('answers are appended in the original question order regardless of submitted order', async () => {
  const values = await inputs();
  values.clarification.answers.reverse();
  assert.equal((await run(values)).text, requestText + supplement(questions, answerTexts));
});

test('question-like delimiters and executable-looking answer text remain literal task data', async () => {
  const values = await inputs();
  const literal = '【补充回答】\n问题 1：保持为原文\n回答：globalThis.clarificationExecuted = true;\n<script>run()</script>';
  values.clarification.answers[0].text = literal;
  assert.equal((await run(values)).text, requestText + supplement(questions, [literal, answerTexts[1]]));
  assert.equal(Object.hasOwn(globalThis, 'clarificationExecuted'), false);
});

test('missing, extra, duplicate and unknown answers are rejected with stable codes', async () => {
  const cases = [
    [value => { value.answers.pop(); }, 'CLARIFICATION_ANSWER_MISSING'],
    [value => { value.answers = []; }, 'CLARIFICATION_ANSWER_MISSING'],
    [value => { value.answers.push({ questionId: 'unexpected', text: '不能添加额外问题。' }); }, 'CLARIFICATION_ANSWER_UNKNOWN'],
    [value => { value.answers.push(copy(value.answers[0])); }, 'CLARIFICATION_ANSWER_DUPLICATE'],
    [value => { value.answers[0].questionId = 'old-question'; }, 'CLARIFICATION_ANSWER_UNKNOWN'],
    [value => { value.answers[0].questionId = 1; }, 'CLARIFICATION_ANSWER_UNKNOWN'],
  ];
  for (const [mutate, code] of cases) {
    const values = await inputs();
    mutate(values.clarification);
    await rejectsCode(run(values), code);
  }
});

test('answer text rejects blanks, controls, lone surrogates, non-text and more than 2000 Unicode characters', async () => {
  for (const text of ['', ' \t\r\n ', 'bad\u0000text', '\u000b', 'bad\u007ftext', 'bad\u0085text', 'bad\uD800text', '\uDC00', null, 1, '中'.repeat(2001), '😀'.repeat(2001)]) {
    const values = await inputs();
    values.clarification.answers[0].text = text;
    await rejectsCode(run(values), 'CLARIFICATION_ANSWER_TEXT');
  }
  const values = await inputs();
  values.clarification.answers[0].text = '😀'.repeat(2000);
  assert.equal((await run(values)).text, requestText + supplement(questions, ['😀'.repeat(2000), answerTexts[1]]));
});

test('strict clarification and answer fields reject unsupported shape, version and bindings', async () => {
  const cases = [
    value => { value.userApproved = true; },
    value => { delete value.answers; },
    value => { value.clarificationVersion = '0.2'; },
    value => { value.contextSha256 = '0'.repeat(63); },
    value => { value.proposalSha256 = 'A'.repeat(64); },
    value => { value.proposalSha256 += '\n'; },
    value => { value.answers = {}; },
    value => { value.answers = Array.from({ length: 65 }, () => copy(value.answers[0])); },
    value => { value.answers[0].approved = true; },
    value => { delete value.answers[0].text; },
    value => { value.answers[0] = null; },
  ];
  for (const mutate of cases) {
    const values = await inputs();
    mutate(values.clarification);
    await rejectsCode(run(values), 'CLARIFICATION_INPUT_INVALID');
  }
  const values = await inputs();
  for (const clarification of [null, [], 'answers']) {
    await rejectsCode(run({ ...values, clarification }), 'CLARIFICATION_INPUT_INVALID');
  }
});

test('answers cannot cross contexts or a changed proposal under the same context', async () => {
  const old = await inputs();
  const current = await inputs(requestText + '\n补充一个新要求。');
  await rejectsCode(run({ ...current, clarification: old.clarification }), 'CLARIFICATION_CONTEXT_MISMATCH');
  await rejectsCode(run({ ...current, proposal: old.proposal }), 'CLARIFICATION_PROPOSAL_INVALID');
  const changed = copy(old.proposal);
  changed.unresolved[0].question = '新的音量问题：初值是否为零？';
  await rejectsCode(run({ ...old, proposal: changed }), 'CLARIFICATION_PROPOSAL_MISMATCH');
  const digestMismatch = copy(old.clarification);
  digestMismatch.proposalSha256 = '0'.repeat(64);
  await rejectsCode(run({ ...old, clarification: digestMismatch }), 'CLARIFICATION_PROPOSAL_MISMATCH');
});

test('context and proposal are revalidated even when caller supplies matching outer digests', async () => {
  const values = await inputs();
  values.context.request.text += 'changed without a valid context';
  const { sha256: ignored, ...payload } = values.context;
  values.context.sha256 = await digestJson(payload);
  values.proposal.contextSha256 = values.context.sha256;
  values.clarification.contextSha256 = values.context.sha256;
  values.clarification.proposalSha256 = await digestJson(values.proposal);
  await rejectsCode(run(values), 'CLARIFICATION_CONTEXT_INVALID');
  const badProposal = await inputs();
  badProposal.proposal.unresolved[0].question = '';
  badProposal.clarification.proposalSha256 = await digestJson(badProposal.proposal);
  await rejectsCode(run(badProposal), 'CLARIFICATION_PROPOSAL_INVALID');
});

test('a READY_TO_COMPILE proposal cannot be used for clarification', async () => {
  const values = await inputs();
  const spec = copy(fixture);
  spec.provenance = { kind: 'programmatic-fixture', description: 'Deterministic test fixture.', assumptions: [] };
  values.proposal.spec = spec;
  values.proposal.unresolved = [];
  values.proposal.decisions = proposalTargets(spec).map(target => ({ target, basis: {
    kind: 'request-interpretation', start: 0, end: requestText.length, quote: requestText,
  } }));
  values.clarification.answers = [];
  values.clarification.proposalSha256 = await digestJson(values.proposal);
  await rejectsCode(run(values), 'CLARIFICATION_NOT_NEEDED');
});

test('all inputs are isolated before the first await', async () => {
  const values = await inputs();
  const expected = await run(copy(values));
  const pending = run(values);
  values.context.request.text = 'Changed request';
  values.context.catalog.themes[0].tokens.accent = '#000000';
  values.proposal.unresolved[0].question = 'Changed question';
  values.proposal.contextSha256 = '0'.repeat(64);
  values.clarification.contextSha256 = '0'.repeat(64);
  values.clarification.proposalSha256 = '0'.repeat(64);
  values.clarification.answers[0].text = 'Changed answer';
  values.clarification.answers.push({ questionId: 'unexpected', text: 'Changed list' });
  assert.deepEqual(await pending, expected);
});

test('getters, symbol hooks, toJSON methods and cycles are rejected without executing input code', async () => {
  let calls = 0;
  const shapes = [
    input => { Object.defineProperty(input, 'hiddenInput', { enumerable: true, get() { calls += 1; return 1; } }); },
    input => { input[Symbol.toPrimitive] = () => { calls += 1; return 'value'; }; },
    input => { input.toJSON = () => { calls += 1; return {}; }; },
    input => { input.cycle = input; },
  ];
  for (const [key, code] of [['context', 'CLARIFICATION_CONTEXT_INVALID'], ['proposal', 'CLARIFICATION_PROPOSAL_INVALID'], ['clarification', 'CLARIFICATION_INPUT_INVALID']]) {
    for (const mutate of shapes) {
      const values = await inputs();
      mutate(values[key]);
      await rejectsCode(run(values), code);
    }
  }
  const nested = await inputs();
  Object.defineProperty(nested.clarification.answers[0], 'text', { enumerable: true, get() { calls += 1; return 'answer'; } });
  await rejectsCode(run(nested), 'CLARIFICATION_INPUT_INVALID');
  assert.equal(calls, 0);
});

test('the complete request respects the 8000 Unicode character limit without truncating', async () => {
  const suffix = supplement(questions, answerTexts);
  const allowed = '文'.repeat(8000 - [...suffix].length);
  const values = await inputs(allowed);
  const result = await run(values);
  assert.equal([...result.text].length, 8000);
  assert.equal(result.text, allowed + suffix);
  const tooLong = await inputs(allowed + '😀');
  await rejectsCode(run(tooLong), 'CLARIFICATION_REQUEST_TOO_LONG');
  assert.equal(tooLong.context.request.text, allowed + '😀');
  assert.deepEqual(tooLong.clarification.answers.map(answer => answer.text), answerTexts);
});

test('success and error paths preserve frozen inputs and do not expose mutable aliases', async () => {
  const valid = await inputs();
  const before = copy(valid);
  freeze(valid);
  const result = await run(valid);
  result.text = 'Changed output';
  assert.deepEqual(valid, before);
  for (const [mutate, code] of [
    [value => { value.context.request.text += 'invalid'; }, 'CLARIFICATION_CONTEXT_INVALID'],
    [value => { value.proposal.unresolved[0].question = ''; }, 'CLARIFICATION_PROPOSAL_INVALID'],
    [value => { value.clarification.answers.pop(); }, 'CLARIFICATION_ANSWER_MISSING'],
    [value => { value.clarification.answers[0].text = ''; }, 'CLARIFICATION_ANSWER_TEXT'],
  ]) {
    const invalid = await inputs();
    mutate(invalid);
    const snapshot = copy(invalid);
    freeze(invalid);
    await rejectsCode(run(invalid), code);
    assert.deepEqual(invalid, snapshot);
  }
});
