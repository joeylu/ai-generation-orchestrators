import test from 'node:test';
import assert from 'node:assert/strict';
import {readJson} from '../src/io.mjs';
import {createPlanningContext} from '../src/planning-context.mjs';
import {buildCommonGamePanelPrompt} from '../scripts/lib/common-game-panel-prompt.mjs';
import {assessStabilityFix} from '../scripts/lib/stability-fix-acceptance.mjs';
import {PANEL_STABILITY_SUITE} from '../examples/panel-stability-v1/suite.mjs';
import {PANEL_STABILITY_FIX_SUITE} from '../examples/panel-stability-fix-v1/suite.mjs';
const {records}=await readJson(new URL('./fixtures/panel-stability-reviewed-regressions-v1.json',import.meta.url));
const catalog=await readJson(new URL('../examples/modern-tab-headings.catalog.json',import.meta.url));
catalog.themes=catalog.themes.filter(theme=>theme.id==='modern-mint-light');

test('focused samples preserve the eight historical IDs, requests and three repeats plus variant per purpose',async()=>{
  assert.deepEqual(PANEL_STABILITY_FIX_SUITE.map(item=>item.id),['S05','S08','S13','S16','S21','S24','S29','S32']);
  for(const item of PANEL_STABILITY_FIX_SUITE){
    assert.deepEqual(item,PANEL_STABILITY_SUITE.find(source=>source.id===item.id));
    assert.notEqual(item,PANEL_STABILITY_SUITE.find(source=>source.id===item.id));
    assert(item.request.text.length<=20);assert.equal(item.evaluation.explicit,null);
  }
  for(const purpose of ['character-select','exit-confirmation']){
    const cases=PANEL_STABILITY_FIX_SUITE.filter(item=>item.stability.purpose===purpose);let reference;
    assert.deepEqual(cases.map(item=>item.stability.round),[1,2,3,4]);
    assert.equal(new Set(cases.slice(0,3).map(item=>item.request.text)).size,1);
    assert.notEqual(cases[3].request.text,cases[0].request.text);
    for(const item of cases.slice(0,3)){
      const context=await createPlanningContext(item.request,catalog);assert.equal(context.assetRetrieval,null);
      const prompt=buildCommonGamePanelPrompt(context);
      assert.deepEqual(JSON.parse(prompt.split('Complete validated task data:\n')[1]),{context});
      const normalized=prompt.replaceAll(context.sha256,'CONTEXT_DIGEST').replaceAll(context.requestSha256,'REQUEST_DIGEST').replaceAll(item.id,'CASE_ID');
      if(reference)assert.equal(normalized,reference);else reference=normalized;
    }
  }
});

const exitArgs=()=>{
  const record=structuredClone(records.find(record=>record.id==='S08-patched'));
  return {purpose:record.purpose,bundle:{spec:record.spec},browserStatus:'PASS',interactionReview:{purpose:record.purpose,flags:[],notes:[],stages:
    record.spec.sections.flatMap(section=>section.rows).filter(row=>row.kind==='button').map(row=>({rowId:row.id,visible:true,enabled:true,reachable:true,emitted:1,totalEmitted:1}))}};
};
test('original single-choice floating Dialog is not a focused success even after generic browser PASS',()=>{
  const record=records.find(record=>record.id==='S08');
  const result=assessStabilityFix({...exitArgs(),bundle:{spec:record.spec}});
  assert.equal(result.status,'FAIL');assert.equal(result.checks.find(check=>check.code==='TWO_DISTINCT_CHOICES_PRESENT').status,'FAIL');
});
test('two initially operable choices pass only the bounded checks, with visual and copy review still required',()=>{
  const result=assessStabilityFix(exitArgs());assert.equal(result.status,'PASS');assert.equal(result.humanCopyAndVisualReview,'REQUIRED');
});
for(const [name,mutate] of [
  ['blocked initial click',args=>{args.interactionReview.stages[0].emitted=0;}],
  ['additional unintended event',args=>{args.interactionReview.stages[0].totalEmitted=2;}],
  ['missing choice observation',args=>{args.interactionReview.stages.pop();}],
  ['unknown confirmation structure',args=>{args.interactionReview.notes.push('CONFIRM_CANCEL_PAIR_NOT_IDENTIFIED');}],
  ['shared event',args=>{const rows=args.bundle.spec.sections.flatMap(section=>section.rows).filter(row=>row.kind==='button');rows[1].event=rows[0].event;}],
])test(`technical PASS does not hide ${name}`,()=>{
  const args=exitArgs();mutate(args);assert.equal(assessStabilityFix(args).status,'FAIL');
});
test('failed or clarified cases with no delivery cannot disappear from focused acceptance',()=>{
  for(const purpose of ['character-select','exit-confirmation'])assert.equal(assessStabilityFix({purpose,browserStatus:'NOT_DELIVERED'}).status,'FAIL');
});
test('unprovided character artwork remains optional honest placeholders with a usable selection control',()=>{
  const spec=structuredClone(records.find(record=>record.id==='G17').spec);
  const args={purpose:'character-select',bundle:{spec},browserStatus:'PASS'};
  assert.equal(assessStabilityFix(args).status,'FAIL');
  for(const row of spec.sections.flatMap(section=>section.rows))if(row.kind==='image')row.source=null;
  assert.equal(assessStabilityFix(args).status,'PASS');
  for(const row of spec.sections.flatMap(section=>section.rows))if(['radio','list','select'].includes(row.kind))row.enabled=false;
  assert.equal(assessStabilityFix(args).status,'FAIL');
});
