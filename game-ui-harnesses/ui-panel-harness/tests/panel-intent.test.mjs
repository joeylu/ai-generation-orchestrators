import test from 'node:test';
import assert from 'node:assert/strict';
import { PANEL_EVALUATION_SUITE as suite } from '../examples/panel-evaluation/suite.mjs';
import { PANEL_COMBINATION_SUITE } from '../examples/panel-evaluation/combinations.mjs';
import { intentFixture, embeddedIntentFixture, compactIntentFixture } from '../examples/panel-evaluation/intent-fixture.mjs';
import { materializePanelIntent, buildPanelIntentResponseSchema } from '../src/panel-intent.mjs';
import { createPlanningContext } from '../src/planning-context.mjs';
import { evaluatePanelSemantics } from '../src/panel-evaluation.mjs';
import { checkPanelProposal } from '../src/proposal.mjs';
import { createPanelBundle, validatePanelBundle } from '../src/panel-bundle.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { readJson } from '../src/io.mjs';
const catalog = await readJson(new URL('../examples/modern-mint-layout.catalog.json', import.meta.url)), core = await loadWorkspaceCore();
test('native intent materialization preserves all 16 explicit contracts and compiles without model calls', async () => {
  for (const item of suite.cases) {
    const context = await createPlanningContext(item.request, catalog), proposal = await materializePanelIntent(context, intentFixture(context, item));
    assert.equal((await checkPanelProposal(context, proposal)).status, 'READY_TO_COMPILE');
    assert.equal(evaluatePanelSemantics(proposal.spec, item.expected).status, 'PASS', item.id);
    await validatePanelBundle(await createPanelBundle(proposal.spec, catalog, core), core);
    assert.deepEqual(await materializePanelIntent(context, embeddedIntentFixture(context, item)), proposal);
    const compact = await materializePanelIntent(context, compactIntentFixture(context, item));
    assert.deepEqual(compact.spec, proposal.spec);
    for (const row of proposal.spec.sections.flatMap(s => s.rows).filter(r => r.bind)) assert.equal(row.bind, row.id);
  }
});
test('intent rejects absent facts, foreign recipes, duplicate IDs, invalid resets and non-exact evidence', async () => {
  const item = suite.cases[0], context = await createPlanningContext(item.request, catalog), original = intentFixture(context, item);
  for (const mutate of [i => { delete i.panel.sections[0].rows[0].initial; }, i => { i.panel.sections[0].rows[0].recipeKey = 'foreign@1'; },
    i => { i.panel.sections[0].rows[0].sourceQuote = 'not present'; }, i => { i.panel.sections[0].rows[1].id = 'row0'; },
    i => { i.panel.sections[0].rows[2].resetRows = ['row2']; }, i => { i.panel.sections[0].rows[0].initial = 101; },
    i => { i.panel.layout.body = { kind: 'column', children: [{ kind: 'section', sectionId: 'missing' }] }; },
    i => { i.panel.panelSurface = 'foreign'; }]) {
    const intent = structuredClone(original); mutate(intent); await assert.rejects(materializePanelIntent(context, intent));
  }
  const repeated = await createPlanningContext({ ...item.request, text: `${item.request.text} 主音量 主音量` }, catalog), intent = intentFixture(repeated, item);
  intent.panel.sections[0].rows[0].sourceQuote = '主音量'; await assert.rejects(materializePanelIntent(repeated, intent), { code: 'INTENT_QUOTE' });
});
test('intent cannot invent missing facts and native schema has strict shapes, exact pins and recursive body', async () => {
  const context = await createPlanningContext(suite.cases[0].request, catalog), schema = buildPanelIntentResponseSchema(context);
  assert(!schema.properties.proposalJson); assert.deepEqual(schema.properties.contextSha256.enum, [context.sha256]);
  assert.deepEqual(schema.properties.panel.anyOf[1].properties.id.enum, [context.request.id]);
  assert.equal(schema.$defs.body.anyOf[0].properties.id.enum.length, 32);
  for (const row of schema.$defs.body.anyOf[0].properties.rows.items.anyOf) assert.deepEqual(row.properties.id.enum, Array.from({ length: 128 }, (_, i) => `row${i}`));
  const visit = value => { if (!value || typeof value !== 'object') return;
    if (value.type === 'object') { assert.equal(value.additionalProperties, false); assert.deepEqual([...value.required].sort(), Object.keys(value.properties).sort()); }
    if (value.$ref) assert(['#/$defs/body', '#/$defs/container'].includes(value.$ref));
    Object.values(value).forEach(child => Array.isArray(child) ? child.forEach(visit) : visit(child)); };
  visit(schema);
  const proposal = await materializePanelIntent(context, { panelIntentVersion: '0.1', contextSha256: context.sha256, panel: null, unresolved: [{ id: 'range', question: '音量的范围是多少？' }] });
  assert.equal((await checkPanelProposal(context, proposal)).status, 'NEEDS_INPUT');
  await assert.rejects(materializePanelIntent(context, { panelIntentVersion: '0.1', contextSha256: context.sha256, panel: null, unresolved: [] }));
});

test('six mixed fixtures preserve explicit groups, nested layout and local reset dependencies', async () => {
  for (const item of PANEL_COMBINATION_SUITE.cases) {
    const context = await createPlanningContext(item.request, catalog), proposal = await materializePanelIntent(context, compactIntentFixture(context, item));
    assert.equal(evaluatePanelSemantics(proposal.spec, item.expected).status, 'PASS');
    await validatePanelBundle(await createPanelBundle(proposal.spec, catalog, core), core);
    const wrong = structuredClone(proposal.spec); wrong.sections[0].rows.push(wrong.sections[1].rows.shift());
    assert.equal(evaluatePanelSemantics(wrong, item.expected).status, 'FAIL');
  }
});
