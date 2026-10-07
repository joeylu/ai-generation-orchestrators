import test from 'node:test';
import assert from 'node:assert/strict';
import { INPUT_STRESS_SUITE, EDIT_STRESS_STEPS } from '../examples/input-stress-v1/suite.mjs';
import { inputStressFixture } from '../scripts/input-stress-fixtures.mjs';
import { checkStressEdit, findStressRow, stressFixturePatch, stressFixtureProposal } from '../scripts/input-stress-contract.mjs';
import { readJson } from '../src/io.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { createPanelBundle, validatePanelBundle } from '../src/panel-bundle.mjs';
import { createWorkbenchModel } from '../src/workbench-model.mjs';
import { createPlanningContext } from '../src/planning-context.mjs';
import { applyPanelPatch } from '../src/patch.mjs';
import { evaluateRecipeHits, evaluatePanelSemantics } from '../src/panel-evaluation.mjs';
import { initialPanelState } from '../src/compiler.mjs';
const core = await loadWorkspaceCore();
const catalog = await readJson(new URL('../examples/modern-mint-forms.catalog.json', import.meta.url));

test('16 new requests retrieve every required recipe and compile independent expectation fixtures, zero models', async () => {
  assert.equal(INPUT_STRESS_SUITE.cases.length, 16);
  for (const item of INPUT_STRESS_SUITE.cases) {
    const context = await createPlanningContext(item.request, catalog);
    assert.equal(evaluateRecipeHits(context, item.expected).status, 'PASS', item.id);
    const spec = inputStressFixture(item);
    assert.equal(evaluatePanelSemantics(spec, item.expected).status, 'PASS', item.id);
    await validatePanelBundle(await createPanelBundle(spec, catalog, core), core);
  }
});
test('eight driver fixture edits preserve trial values, clear deleted dependencies, export/reopen and undo each step', async () => {
  const source = await createPanelBundle(inputStressFixture(INPUT_STRESS_SUITE.cases[0]), catalog, core);
  const model = await createWorkbenchModel({ catalog, pool: null }, core);
  await model.importPanel(source);
  let values = { ...source.state, [findStressRow(source.spec, '主音量').bind]: 83, [findStressRow(source.spec, '静音').bind]: true };
  for (const step of EDIT_STRESS_STEPS) {
    const before = model.getSnapshot();
    const { context } = await model.prepareEdit(step.request), patch = await stressFixturePatch(before.panel.spec, step);
    const proposal = stressFixtureProposal(context, patch);
    const next = await model.acceptEditProposal(proposal, values);
    await checkStressEdit(before.panel.spec, next.panel.spec, step);
    const main = findStressRow(next.panel.spec, step.expectation === 'default50' ? '主音量' : '总音量');
    assert.equal(next.panel.state[main.bind], 83);
    assert.equal(initialPanelState(next.panel.spec)[main.bind], 50);
    const reopened = await model.exportPanel(next.panel.state);
    await validatePanelBundle(reopened, core);
    const fresh = await createWorkbenchModel({ catalog, pool: null }, core);
    assert.deepEqual((await fresh.importPanel(reopened)).panel, next.panel); fresh.dispose();
    const undoModel = await createWorkbenchModel({ catalog, pool: null }, core);
    await undoModel.importPanel(before.panel);
    const prepared = await undoModel.prepareEdit(step.request);
    assert.deepEqual(prepared.context, context);
    await undoModel.acceptEditProposal(proposal, values);
    assert.deepEqual((await undoModel.undo()).panel.state, values);
    assert.deepEqual(undoModel.getSnapshot().panel.spec, before.panel.spec); undoModel.dispose();
    values = next.panel.state;
    if (step.expectation === 'add') values = { ...values, [findStressRow(next.panel.spec, '音效音量').bind]: 91 };
  }
  assert.equal(model.getSnapshot().history.length, 8);
  assert.equal(model.getSnapshot().panel.spec.state.length, 1);
  for (let i = 0; i < 8; i++) await model.undo();
  assert.deepEqual(model.getSnapshot().panel.spec, source.spec);
  assert.equal(model.getSnapshot().panel.state[findStressRow(source.spec, '主音量').bind], 83);
  model.dispose();
});
test('edit oracle rejects valid but unrequested title, row enabled, reset scope and lost bindings', async () => {
  const before = inputStressFixture(INPUT_STRESS_SUITE.cases[0]), step = EDIT_STRESS_STEPS[0];
  const after = (await applyPanelPatch(before, await stressFixturePatch(before, step))).spec;
  const wrongs = [spec => { spec.title = 'unexpected'; }, spec => { spec.sections[0].rows[0].enabled = false; },
    spec => { spec.sections[0].rows.at(-1).action.fields = [spec.state[0].id]; }, spec => { spec.sections[0].rows[0].event = 'panel.other'; }];
  for (const mutate of wrongs) { const copy = structuredClone(after); mutate(copy); await assert.rejects(checkStressEdit(before, copy, step)); }
});
test('inline corrections have independently fixed final expected values', () => {
  assert.equal(INPUT_STRESS_SUITE.cases[0].expected.rows[0].initial, 65);
  assert.equal(INPUT_STRESS_SUITE.cases.find(item => item.id === 'eval-shop').expected.rows[1].initial, 750);
  assert.equal(EDIT_STRESS_STEPS.length, 8);
});
