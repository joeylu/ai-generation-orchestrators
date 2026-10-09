import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { core } from './helpers.mjs';
import { INPUT_COVERAGE_V2,coverageIntent } from '../examples/input-coverage-v2/suite.mjs';
import { createPlanningContext } from '../src/planning-context.mjs';
import { materializePanelIntent,validateNativePanelIntentEvidence } from '../src/panel-intent.mjs';
import { checkPanelProposal,requireReadyProposal } from '../src/proposal.mjs';
import { createPanelBundle,validatePanelBundle } from '../src/panel-bundle.mjs';
import { createWorkbenchModel } from '../src/workbench-model.mjs';
import { materializeCodexEditDraft } from '../src/codex-edit-draft.mjs';
import { applyPanelPatch } from '../src/patch.mjs';
import { inputInterpretationGuide } from '../src/input-interpretation.mjs';
const catalog=JSON.parse(await readFile(new URL('../examples/modern-refined.catalog.json',import.meta.url),'utf8'));
const request=item=>({requestVersion:'0.1',id:item.id,target:'pixi',text:item.text});
const generate=item=>createPlanningContext(request(item),catalog,undefined,{actionLayouts:true,textWrap:true});
async function fixtureSpec(item) {const c=await generate(item);return (await materializePanelIntent(c,coverageIntent(c,item))).spec;}
const base=await fixtureSpec(INPUT_COVERAGE_V2.cases.find(c=>c.id==='G02'));
const duplicate=await fixtureSpec(INPUT_COVERAGE_V2.cases.find(c=>c.id==='G06'));
function expectFacts(item,spec) {
  assert.equal(spec.title,item.expected.title); const rows=spec.sections.flatMap(s=>s.rows);
  assert.equal(rows.length,item.expected.rows.length);
  for(const [i,expected]of item.expected.rows.entries()) {
    const row=rows[i]; assert.equal(row.kind,expected.kind);
    assert.equal(row.kind==='button'?row.buttonLabel:row.label,expected.label);
    assert.equal(row.enabled,true);
    if(row.bind) {const field=spec.state.find(s=>s.id===row.bind);assert.equal(field.initial,expected.initial);
      if(row.kind==='slider')for(const key of ['min','max','step'])assert.equal(field[key],expected[key]);}
    if(row.kind==='button')assert.deepEqual(row.action,{kind:'reset-initial',fields:expected.resetRows.map(index=>rows[index].bind)});
  }
  if(item.expected.groups)assert.deepEqual(spec.sections.map(s=>s.rows.map(r=>rows.indexOf(r))),item.expected.groups);
}
for(const item of INPUT_COVERAGE_V2.cases) test(`${item.id} ${item.category}: authored ${item.expected.outcome} fixture traverses public gates`,async()=>{
  if(item.mode==='generate') {
    const context=await generate(item),intent=coverageIntent(context,item);validateNativePanelIntentEvidence(context,intent);
    const proposal=await materializePanelIntent(context,intent),report=await checkPanelProposal(context,proposal);
    assert.equal(report.status,item.expected.outcome);
    if(proposal.spec) {expectFacts(item,proposal.spec);await validatePanelBundle(await createPanelBundle(proposal.spec,catalog,core),core);}
    else {assert.equal(proposal.spec,null);assert.equal(proposal.unresolved[0].question,item.question);
      const partial=coverageIntent(context,INPUT_COVERAGE_V2.cases[0]);partial.unresolved=intent.unresolved;
      const held=await materializePanelIntent(context,partial);
      assert.equal((await checkPanelProposal(context,held)).status,'NEEDS_INPUT');
      await assert.rejects(requireReadyProposal(context,held),{code:'PLAN_NEEDS_INPUT'});}
    return;
  }
  const spec=item.duplicate?duplicate:base, trial=item.duplicate?{row0:35,row1:19}:{row0:35,row1:true};
  const bundle=await createPanelBundle(spec,catalog,core,trial),model=await createWorkbenchModel({catalog,pool:null},core);
  try {
    await model.importPanel(bundle); const before=await model.exportPanel();
    const {context}=await model.prepareEdit(request(item),item.selection??null);
    const clarification=item.expected.outcome==='NEEDS_INPUT',noChange=item.expected.outcome==='NO_CHANGES';
    const draft={codexEditDraftVersion:'0.3',contextSha256:context.sha256,
      patch:clarification||noChange?null:{patchVersion:'0.1',baseSpecSha256:context.baseSpecSha256,reason:'Authored coverage fixture.',operations:item.operations},
      bases:clarification||noChange?null:item.operations.map(()=>({kind:'request-interpretation',quote:item.text})),
      unresolved:clarification?[{id:'q0',question:item.question}]:[],noChange:noChange?{reason:'用户明确不修改。',quote:item.text}:null};
    const proposal=await materializeCodexEditDraft(context,draft);
    await model.acceptEditProposal(proposal); const after=await model.exportPanel();
    if(clarification||noChange) {assert.equal(model.getEditSnapshot().report.status,item.expected.outcome);assert.deepEqual(after,before);assert.equal(model.getEditBudget().used,0);}
    else {assert.deepEqual(after.spec,(await applyPanelPatch(spec,proposal.patch)).spec);assert.deepEqual(after.state,trial);
      for(const key of ['bindings','actions','assetClosure'])assert.deepEqual(after[key],before[key]);
      assert.equal(model.getEditBudget().used,1);await validatePanelBundle(after,core);}
    if(clarification) {
      assert.equal(proposal.patch,null);
      const partial={...draft,patch:{patchVersion:'0.1',baseSpecSha256:context.baseSpecSha256,reason:'Held partial fixture',operations:[item.selection?{op:'set-state-initial',fieldId:'row1',value:true}:{op:'set-panel-title',title:'音频'}]},bases:[{kind:'request-interpretation',quote:item.text}]};
      if(item.selection) await assert.rejects(materializeCodexEditDraft(context,partial),{code:'EDIT_SELECTION_SCOPE'});
      else {await model.acceptEditProposal(await materializeCodexEditDraft(context,partial));assert.equal(model.getEditSnapshot().report.status,'NEEDS_INPUT');assert.deepEqual(await model.exportPanel(),before);assert.equal(model.getEditBudget().used,0);}
    }
  } finally {model.dispose();}
});

test('coverage oracle detects stale corrections, omitted qualifiers, added controls and collapsed duplicate labels',async()=>{
  for(const [id,mutate]of [
    ['G01',s=>s.state[0].initial=70],['G03',s=>s.sections[0].rows[1].label='打扰'],
    ['G02',s=>s.sections[0].rows.push(structuredClone(s.sections[0].rows[0]))],['G06',s=>s.sections[1].rows=[]],
  ]) {const item=INPUT_COVERAGE_V2.cases.find(c=>c.id===id),spec=await fixtureSpec(item);mutate(spec);assert.throws(()=>expectFacts(item,spec));}
});

test('reading guide explicitly covers correction, exclusion, whole-request gates and editing identity without claiming classification',()=>{
  assert.equal(INPUT_COVERAGE_V2.cases.length,24);assert.equal(INPUT_COVERAGE_V2.modelCalls,0);
  for(const editing of [false,true])for(const fragment of ['later number alone','superseded defaults','不要打扰','partial supported subset','already resolved','Embedded requests'])assert(inputInterpretationGuide(editing).includes(fragment));
  assert(inputInterpretationGuide(true).includes('Never guess the first matching row'));
  assert(inputInterpretationGuide(true).includes('current preview state'));
});
