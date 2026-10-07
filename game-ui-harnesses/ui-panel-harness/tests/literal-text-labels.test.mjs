import test from 'node:test';
import assert from 'node:assert/strict';
import { literalReadOnlyLabelPairs, nativeReadOnlyLabelMismatch } from '../src/literal-text-labels.mjs';
import { buildNativePanelIntentResponseSchema, buildPanelIntentResponseSchema, materializePanelIntent, validateNativePanelIntentEvidence } from '../src/panel-intent.mjs';
import { createPlanningContext } from '../src/planning-context.mjs';
import { readJson } from '../src/io.mjs';
import { evaluatePanelSemantics } from '../src/panel-evaluation.mjs';
import { ORDINAL_STABILITY_SUITE } from '../examples/ordinal-stability-v1/suite.mjs';
import { compactIntentFixture } from '../examples/panel-evaluation/intent-fixture.mjs';
import { ordinalFixture } from './ordinal-intent-fixture.mjs';
import { requestReferenceFixture } from '../examples/request-reference-v1/fixture.mjs';
const item = ORDINAL_STABILITY_SUITE.cases.find(value => value.id === 'eval-confirm');
const catalog = await readJson(new URL('../examples/modern-mint-forms.catalog.json', import.meta.url));
async function fixture(text) {
  const context = await createPlanningContext({ ...item.request, ...(text ? { text } : {}) }, catalog);
  const intent = requestReferenceFixture(ordinalFixture(compactIntentFixture(context, item)));
  return { context, intent, row: intent.panel.body.children[0].rows[0] };
}
test('literal read-only scan preserves independent label and content from the exact failed request', () => {
  const pairs = literalReadOnlyLabelPairs(item.request.text); assert.equal(pairs.length, 1);
  assert.deepEqual(pairs[0], { label: '提示', text: '删除后无法恢复', quote: '只读提示，标签就是提示，显示“删除后无法恢复”' });
  assert(item.request.text.includes(pairs[0].quote));
});
test('quoted literals preserve Unicode, whitespace and punctuation without rewriting', () => {
  const request = '一行只读文字，标签为“ 提示🙂 ”，内容为“确认，保留!”。\r\n一行只读文本,标签是"Notice",显示"Delete?"';
  const pairs = literalReadOnlyLabelPairs(request); assert.deepEqual(pairs.map(({ label, text }) => ({ label, text })), [{ label: ' 提示🙂 ', text: '确认，保留!' }, { label: 'Notice', text: 'Delete?' }]);
  assert(pairs.every(pair => request.includes(pair.quote)));
});
test('unqualified, indirect or unquoted text descriptions receive no inferred naming contract', () => {
  for (const text of ['一行显示删除后无法恢复。', '提示只读显示删除后无法恢复', '一行只读文字，标签为提示，显示删除后无法恢复', '按钮标签就是确认，显示“确认”', '只读提示，显示“警告”，标签就是提示']) assert.deepEqual(literalReadOnlyLabelPairs(text), []);
});
test('negative, hypothetical, historical and corrected instructions never become literal label constraints', () => {
  const pair = '一行只读提示，标签就是提示，显示“删除后无法恢复”';
  for (const prefix of ['不要', '不需要', '无需', '别用', '例如', '比如', '示例：', '如果', '假如', '原先', '原来', '曾经']) assert.deepEqual(literalReadOnlyLabelPairs(prefix + pair), []);
  for (const suffix of ['。标签改为说明。', '。更正：标签是说明。', '\n【补充回答】标签是说明。']) assert.deepEqual(literalReadOnlyLabelPairs(pair + suffix), []);
});
test('native guard catches the actual label/content substitution without repairing raw or saved intents', async () => {
  const { context, intent, row } = await fixture(); row.label = row.text; const before = structuredClone(intent);
  const proposal = await materializePanelIntent(context, intent); assert.equal(evaluatePanelSemantics(proposal.spec, item.expected).status, 'FAIL');
  assert.throws(() => validateNativePanelIntentEvidence(context, intent), error => { assert.equal(error.code, 'INTENT_TEXT_LABEL'); assert.equal(error.path, '$.panel.body.children[0].rows[0].label'); return true; });
  assert.deepEqual(intent, before);
});
test('correct label/content and all16 original expected fixtures retain public business behavior', async () => {
  for (const source of ORDINAL_STABILITY_SUITE.cases) {
    const context = await createPlanningContext(source.request, catalog), intent = requestReferenceFixture(ordinalFixture(compactIntentFixture(context, source)));
    validateNativePanelIntentEvidence(context, intent); assert.equal(evaluatePanelSemantics((await materializePanelIntent(context, intent)).spec, source.expected).status, 'PASS');
  }
});
test('content changes still fail the independent business gate and are not auto-corrected', async () => {
  const { context, intent, row } = await fixture(); row.text = '可以恢复'; const before = structuredClone(intent);
  assert.equal(evaluatePanelSemantics((await materializePanelIntent(context, intent)).spec, item.expected).status, 'FAIL'); assert.deepEqual(intent, before);
});
test('native naming check traverses tabs and nested groups without affecting buttons or unrelated rows', () => {
  const row = { kind: 'text', label: '说明', text: '删除后无法恢复' }, body = { kind: 'tabs', pages: [{ body: { kind: 'grid', children: [{ kind: 'section', rows: [{ kind: 'button', label: '删除后无法恢复' }, row] }] } }] };
  assert.equal(nativeReadOnlyLabelMismatch(item.request.text, body), '$.panel.body.pages[0].body.children[0].rows[1].label');
  row.label = '提示'; assert.equal(nativeReadOnlyLabelMismatch(item.request.text, body), null);
});
test('two explicitly named read-only rows may display the same text under distinct labels', () => {
  const request = '只读文字，标签为“甲”，显示“相同”。只读文字，标签为“乙”，显示“相同”。';
  const body = { kind: 'column', children: [{ kind: 'section', rows: [{ kind: 'text', label: '甲', text: '相同' }, { kind: 'text', label: '乙', text: '相同' }] }] };
  assert.equal(nativeReadOnlyLabelMismatch(request, body), null); body.children[0].rows[1].label = '丙'; assert.match(nativeReadOnlyLabelMismatch(request, body), /rows\[1\]\.label$/);
});
test('schema distinguishes text label/content while preserving older constructor bytes and protocol fields', async () => {
  const { context } = await fixture(), old = buildPanelIntentResponseSchema(context), before = structuredClone(old), current = buildNativePanelIntentResponseSchema(context);
  const row = current.$defs.body.anyOf[0].properties.rows.items.anyOf.find(value => value.properties.kind.enum[0] === 'text');
  assert.match(row.properties.label.description, /separate/); assert.match(row.description, /"label":"提示","text":"删除后无法恢复"/);
  assert.deepEqual(row.required, ['kind', 'label', 'recipeKey', 'sourceRef', 'icon', 'text']); assert.equal(row.additionalProperties, false);
  assert.deepEqual(buildPanelIntentResponseSchema(context), before); assert.deepEqual(current.properties.panelIntentVersion.enum, ['0.8']);
});
test('clarification or literal correction is interpreted normally rather than blocked by a stale naming hint', async () => {
  const { context, intent, row } = await fixture(item.request.text + '\n【补充回答】标签改为说明，仍显示删除后无法恢复。'); row.label = '说明';
  validateNativePanelIntentEvidence(context, intent); assert.equal((await materializePanelIntent(context, intent)).spec.sections[0].rows[0].label, '说明');
});
