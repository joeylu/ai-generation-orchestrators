import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNativePanelIntentResponseSchema, buildPanelIntentResponseSchema, materializePanelIntent } from '../src/panel-intent.mjs';
import { createPlanningContext } from '../src/planning-context.mjs';
import { readJson } from '../src/io.mjs';
import { evaluatePanelSemantics } from '../src/panel-evaluation.mjs';
import { ORDINAL_STABILITY_SUITE } from '../examples/ordinal-stability-v1/suite.mjs';
import { compactIntentFixture } from '../examples/panel-evaluation/intent-fixture.mjs';
import { ordinalFixture } from './ordinal-intent-fixture.mjs';
import { requestReferenceFixture } from '../examples/request-reference-v1/fixture.mjs';

const catalog = await readJson(new URL('../examples/modern-mint-forms.catalog.json', import.meta.url));
const quest = ORDINAL_STABILITY_SUITE.cases.find(item => item.id === 'eval-quest');
async function fixture(request = quest.request) {
  const context = await createPlanningContext(request, catalog);
  return { context, intent: requestReferenceFixture(ordinalFixture(compactIntentFixture(context, quest))) };
}

test('the real task-name-as-panel-title failure remains a business failure even when the section title is correct', async () => {
  const { context, intent } = await fixture();
  intent.panel.title = '森林巡逻'; intent.panel.body.children[0].title = '任务详情';
  const original = structuredClone(intent), proposal = await materializePanelIntent(context, intent);
  const report = evaluatePanelSemantics(proposal.spec, quest.expected);
  assert.equal(report.status, 'FAIL');
  assert.equal(proposal.spec.title, '森林巡逻');
  assert.equal(proposal.spec.sections[0].rows[0].text, '森林巡逻');
  assert.deepEqual(intent, original, 'public lowering never repairs an incorrectly interpreted title');
});

test('the correct overall title and independently named read-only contents pass the original exact expectations', async () => {
  const { context, intent } = await fixture(), proposal = await materializePanelIntent(context, intent);
  assert.equal(proposal.spec.title, '任务详情');
  assert.deepEqual(proposal.spec.sections[0].rows.filter(row => row.kind === 'text').map(({ label, text }) => ({ label, text })), [
    { label: '任务名称', text: '森林巡逻' }, { label: '任务目标', text: '找到三处营地' }, { label: '奖励', text: '金币 200' },
  ]);
  assert.equal(evaluatePanelSemantics(proposal.spec, quest.expected).status, 'PASS');
});

test('title reading guidance does not force a title, infer one from field values or change the saved schema', async () => {
  for (const text of [quest.request.text, '角色信息，姓名为小明。标题明确为人物卡片。', '标题采用任务名称的值森林巡逻。', '原来标题是任务详情，更正为森林巡逻。']) {
    const { context } = await fixture({ ...quest.request, text });
    const before = structuredClone(buildPanelIntentResponseSchema(context)), schema = buildNativePanelIntentResponseSchema(context);
    const title = schema.properties.panel.anyOf[1].properties.title;
    assert.equal(title.type, 'string'); assert.equal(Object.hasOwn(title, 'enum'), false);
    assert.match(title.description, /explicit later title corrections/);
    assert.deepEqual(buildPanelIntentResponseSchema(context), before);
    assert.equal(before.properties.panel.anyOf[1].properties.title.description, undefined);
  }
});
