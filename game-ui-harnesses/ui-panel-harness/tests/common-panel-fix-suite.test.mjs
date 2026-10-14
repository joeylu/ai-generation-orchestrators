import test from 'node:test';
import assert from 'node:assert/strict';
import {readJson} from '../src/io.mjs';
import {createPlanningContext} from '../src/planning-context.mjs';
import {materializePanelIntent} from '../src/panel-intent.mjs';
import {createPanelBundle} from '../src/panel-bundle.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {COMMON_GAME_PANEL_SUITE,commonGamePanelFixture} from '../examples/common-game-panels-v1/suite.mjs';
import {COMMON_GAME_PANEL_FIX_SUITE,PREVIOUS_FAILURE_IDS,LAYOUT_REVIEW_IDS,CONTENT_REVIEW_IDS,EXPLICIT_REGRESSION_IDS} from '../examples/common-game-panels-fix-v1/suite.mjs';
import {referenceIntent} from '../examples/input-adaptability-v1/suite.mjs';
import {checkOpenDraft} from '../scripts/lib/open-draft-evaluation.mjs';
import {buildCommonGamePanelPrompt} from '../scripts/lib/common-game-panel-prompt.mjs';
const catalog=await readJson(new URL('../examples/modern-tab-headings.catalog.json',import.meta.url)),core=await loadWorkspaceCore();
test('37-case follow-up preserves all original short requests and covers every selected issue without overlap',()=>{
  assert.equal(COMMON_GAME_PANEL_FIX_SUITE.length,37);assert.equal(PREVIOUS_FAILURE_IDS.length,23);assert.equal(LAYOUT_REVIEW_IDS.length,8);assert.equal(CONTENT_REVIEW_IDS.length,5);assert.equal(EXPLICIT_REGRESSION_IDS.length,1);
  assert.equal(new Set([...PREVIOUS_FAILURE_IDS,...LAYOUT_REVIEW_IDS,...CONTENT_REVIEW_IDS,...EXPLICIT_REGRESSION_IDS]).size,37);
  for(const item of COMMON_GAME_PANEL_FIX_SUITE){assert.deepEqual(item.request,COMMON_GAME_PANEL_SUITE.find(x=>x.id===item.id).request);assert(item.request.text.length<=20);}
});
for(const item of COMMON_GAME_PANEL_FIX_SUITE)test(`${item.id}: new pinned theme and prompt compile with a fixture; no model quality claim`,async()=>{
  const context=await createPlanningContext(item.request,catalog),intent=commonGamePanelFixture(context,item,referenceIntent);
  const proposal=await materializePanelIntent(context,intent);checkOpenDraft(item,{proposal,report:{status:'READY_TO_COMPILE'}});
  const bundle=await createPanelBundle(proposal.spec,catalog,core);assert.equal(bundle.compilerVersion,'0.34.0');
  const prompt=buildCommonGamePanelPrompt(context);assert(prompt.includes('visible-v4'));assert(prompt.includes('Keep detail views read-only'));
  assert.equal(JSON.parse(prompt.split('Complete validated task data:\n')[1]).context.request.text,item.request.text);
});
