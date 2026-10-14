import test from 'node:test';
import assert from 'node:assert/strict';
import {readJson} from '../src/io.mjs';
import {COMMON_GAME_PANEL_SUITE,COMMON_GAME_PANEL_CASES,commonGamePanelFixture} from '../examples/common-game-panels-v1/suite.mjs';
import {createPlanningContext} from '../src/planning-context.mjs';
import {materializePanelIntent} from '../src/panel-intent.mjs';
import {referenceIntent} from '../examples/input-adaptability-v1/suite.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {createPanelBundle,validatePanelBundle} from '../src/panel-bundle.mjs';
import {checkOpenDraft} from '../scripts/lib/open-draft-evaluation.mjs';
import {buildCommonGamePanelPrompt} from '../scripts/lib/common-game-panel-prompt.mjs';
const catalog=await readJson(new URL('../examples/modern-action-headings.catalog.json',import.meta.url)),core=await loadWorkspaceCore();
catalog.themes=catalog.themes.filter(t=>t.id==='modern-mint-light');
test('56 distinct common panel purposes and 8 short variations stay independent of fixture answers',()=>{
  assert.equal(COMMON_GAME_PANEL_CASES.length,56);assert.equal(COMMON_GAME_PANEL_SUITE.length,64);
  assert.equal(new Set(COMMON_GAME_PANEL_SUITE.map(item=>item.id)).size,64);
  assert.equal(new Set(COMMON_GAME_PANEL_CASES.map(item=>item.reference.title)).size,56);
  assert.equal(new Set(COMMON_GAME_PANEL_CASES.map(item=>item.category)).size,7);
  for(const item of COMMON_GAME_PANEL_SUITE){assert(item.request.text.length<=30);assert(!/recipe|schema|\b\d{3}×\d{3}\b|默认视觉|逻辑画布/.test(item.request.text));}
});
for(const item of COMMON_GAME_PANEL_SUITE)test(`${item.id} ${item.reference.title}: offline specimen compiles; never certifies model quality`,async()=>{
  const context=await createPlanningContext(item.request,catalog);
  const proposal=await materializePanelIntent(context,commonGamePanelFixture(context,item,referenceIntent));
  checkOpenDraft(item,{proposal,report:{status:'READY_TO_COMPILE'}});
  const bundle=await createPanelBundle(proposal.spec,catalog,core);
  assert.equal(bundle.compilerVersion,'0.33.0');assert.deepEqual(await validatePanelBundle(bundle,core),bundle);
  const prompt=buildCommonGamePanelPrompt(context);
  assert.deepEqual(JSON.parse(prompt.split('Complete validated task data:\n')[1]),{context});
  assert(prompt.includes('set width, maxHeight, canvasWidth and canvasHeight to null'));
  assert(prompt.includes('visible-v3'));assert.equal(context.request.text,item.request.text);
  assert(!prompt.includes('ONE_POSSIBLE_DRIVER_FIXTURE_NOT_EXPECTED_ANSWER'));
});
test('explicit short constraints still reject invented content and changed defaults',async()=>{
  for(const item of COMMON_GAME_PANEL_SUITE.filter(item=>item.evaluation.explicit)){
    const context=await createPlanningContext(item.request,catalog),proposal=await materializePanelIntent(context,commonGamePanelFixture(context,item,referenceIntent));
    const result={proposal,report:{status:'READY_TO_COMPILE'}},wrong=structuredClone(result);
    wrong.proposal.spec.sections[0].rows.push(structuredClone(wrong.proposal.spec.sections[0].rows[0]));
    assert.throws(()=>checkOpenDraft(item,wrong),/DRAFT_EXPLICIT_KINDS/);
  }
});
