import test from 'node:test';
import assert from 'node:assert/strict';
import {readJson} from '../src/io.mjs';
import {validatePanelSpec,validatePanelState} from '../src/spec.mjs';
import {createPlanningContext} from '../src/planning-context.mjs';
import {buildCommonGamePanelPrompt} from '../scripts/lib/common-game-panel-prompt.mjs';
import {inspectPanelStability,summarizeStabilitySamples} from '../scripts/lib/panel-stability-review.mjs';
import {PANEL_STABILITY_SUITE,PANEL_STABILITY_GROUPS} from '../examples/panel-stability-v1/suite.mjs';
const catalog=await readJson(new URL('../examples/modern-tab-headings.catalog.json',import.meta.url));catalog.themes=catalog.themes.filter(theme=>theme.id==='modern-mint-light');
const {records}=await readJson(new URL('./fixtures/panel-stability-reviewed-regressions-v1.json',import.meta.url));
test('32 interleaved cases contain eight exact-text triplicates and eight short variants',()=>{
  assert.equal(PANEL_STABILITY_SUITE.length,32);assert.equal(new Set(PANEL_STABILITY_SUITE.map(item=>item.id)).size,32);
  for(const group of PANEL_STABILITY_GROUPS){const cases=PANEL_STABILITY_SUITE.filter(item=>item.stability.purpose===group.purpose);
    assert.deepEqual(cases.map(item=>item.stability.round),[1,2,3,4]);assert.deepEqual(cases.slice(0,3).map(item=>item.request.text),Array(3).fill(group.request));
    assert.equal(cases[3].request.text,group.variant);assert.notEqual(group.variant,group.request);
  }
  for(const item of PANEL_STABILITY_SUITE){assert(item.request.text.length<=20);assert.equal(item.evaluation.explicit,null);assert.equal(item.request.id,item.id);}
});
test('repeated model prompts differ only in bound case IDs and request/context digests',async()=>{
  for(const group of PANEL_STABILITY_GROUPS){let reference;
    for(const item of PANEL_STABILITY_SUITE.filter(item=>item.stability.purpose===group.purpose).slice(0,3)){
      const context=await createPlanningContext(item.request,catalog);assert.equal(context.assetRetrieval,null);
      const prompt=buildCommonGamePanelPrompt(context),sent=JSON.parse(prompt.split('Complete validated task data:\n')[1]);
      assert.deepEqual(sent,{context});assert(!Object.hasOwn(context,'stability'));assert(!prompt.includes(item.fixturePurpose));
      const normalized=prompt.replaceAll(context.sha256,'CONTEXT_DIGEST').replaceAll(context.requestSha256,'REQUEST_DIGEST').replaceAll(item.id,'CASE_ID');
      if(reference)assert.equal(normalized,reference);else reference=normalized;
    }
  }
});
const expected={G02:['LOBBY_MAY_BE_MULTI_GAME_PORTAL'],G17:['TEST_TEXTURE_USED_AS_CHARACTER_ART'],G45:['MAIL_COPY_REFERENCES_UNAVAILABLE_ATTACHMENT_ACTION'],G49:['LOGIN_BYPASSES_FORM_VALIDATION'],G54:['CONFIRMATION_ACTION_BLOCKED_BY_MODAL'],S08:['CONFIRMATION_FLOATING_DIALOG_WITH_EXTERNAL_ACTION']};
for(const record of records)test(`${record.id}: known review observations reproduce the saved failure or distinguish its offline correction`,()=>{
  validatePanelSpec(record.spec);validatePanelState(record.spec,record.state);const before=structuredClone(record);
  const observation=inspectPanelStability(record.spec,record.state,record.purpose);
  assert.deepEqual(observation.flags.map(flag=>flag.code),expected[record.id]??[]);assert.deepEqual(record,before);
  assert.equal(observation.humanPurposeCopyAndVisualReview,'REQUIRED');
});
test('three technical successes containing a known defect are never presented as three accepted designs',()=>{
  const purpose='login',cases=PANEL_STABILITY_SUITE.filter(item=>item.stability.purpose===purpose),record=records.find(record=>record.id==='G49');
  const observations=cases.map(item=>({id:item.id,status:'PASS',outcome:'READY_TO_COMPILE',knownReview:inspectPanelStability(record.spec,record.state,purpose)}));
  const summary=summarizeStabilitySamples(cases,observations);
  assert.equal(summary.groups[0].repeatDeliveries,3);assert.equal(summary.groups[0].repeatKnownFlagCases,3);
  assert.equal(summary.populationReliability,'NOT_ESTABLISHED');assert.equal(summary.humanReview,'NOT_RECORDED');
  const partial=summarizeStabilitySamples(cases,[]);assert.equal(partial.groups[0].repeatDeliveries,0);
});
