import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,lstat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {INPUT_ADAPTABILITY_CASES,referenceIntent} from '../examples/input-adaptability-v1/suite.mjs';
import {prepareAdaptability,verifyAdaptability,editReference} from '../scripts/input-adaptability.mjs';
import {businessFacts,checkAdaptabilityResult} from '../scripts/lib/input-adaptability-oracle.mjs';
import {readJson,harnessRoot} from '../src/io.mjs';
import {materializePanelIntent} from '../src/panel-intent.mjs';
import {materializeCodexEditDraft} from '../src/codex-edit-draft.mjs';
import {createWorkbenchModel} from '../src/workbench-model.mjs';
import {imageAssetPool} from '../examples/image-slots-v1/assets.mjs';
import {loadWorkspaceCore} from '../src/component-adapter.mjs';
import {checkPanelProposal} from '../src/proposal.mjs';
import {checkPanelEditProposal} from '../src/edit-planning.mjs';

const scratch=await mkdtemp(resolve(harnessRoot,'.tmp','input-adaptability-'));
const prepared=join(scratch,'prepared'),plan=await prepareAdaptability(prepared),core=await loadWorkspaceCore();
const catalog=await readJson(resolve(harnessRoot,'examples/modern-all-components.catalog.json'));
const pool=await imageAssetPool();

test('finite plan freezes 16 generations and 8 independent edits, including seven specific clarification cases',async()=>{
  assert.equal(plan.cases.length,24);assert.equal(plan.cases.filter(item=>item.operation==='generate').length,16);
  assert.equal(plan.cases.filter(item=>item.expectedOutcome==='NEEDS_INPUT').length,7);
  assert.equal(plan.driverSimulation.realModelCalls,0);assert.equal(plan.policy.automaticRetries,0);assert.equal(plan.policy.concurrency,1);
  assert.equal((await verifyAdaptability(prepared,{checkLogin:false})).sha256,plan.sha256);
  await assert.rejects(lstat(join(prepared,'dispatch-claim.json')),{code:'ENOENT'});
});

for(const item of INPUT_ADAPTABILITY_CASES)test(`${item.id}: public validators and workbench enforce independent authored expectation`,async()=>{
  const model=await createWorkbenchModel({catalog,pool},core);
  try{
    const context=await readJson(join(prepared,item.id+'.context.json'));
    const expected=await readJson(join(prepared,item.id+'.expectation.json'));
    let proposal,report,before,after;
    if(item.operation==='generate'){
      assert.deepEqual((await model.prepare(item.request)).context,context);
      proposal=await materializePanelIntent(context,referenceIntent(context,item));report=await checkPanelProposal(context,proposal);
      await model.acceptProposal(proposal);after=model.getSnapshot().panel;
    }else{
      before=await readJson(join(prepared,item.id+'.source.panel.bundle.json'));await model.importPanel(before);
      assert.deepEqual((await model.prepareEdit(item.request,item.selection??null)).context,context);
      proposal=await materializeCodexEditDraft(context,editReference(context,item));report=await checkPanelEditProposal(context,proposal);
      await model.acceptEditProposal(proposal);after=await model.exportPanel();
    }
    checkAdaptabilityResult(item,{proposal,report},{expectedSpec:expected.expectedSpec,before,after});
    if(item.clarification){
      assert.throws(()=>checkAdaptabilityResult(item,{proposal:{...proposal,unresolved:[{id:'q0',question:'天气怎样？'}]},report},{before,after}),/ADAPT_QUESTION_UNRELATED/);
      assert.throws(()=>checkAdaptabilityResult(item,{proposal:{...proposal,[item.operation==='edit'?'patch':'spec']:{}},report},{before,after}),/ADAPT_PARTIAL_RESULT/);
      if(before){assert.equal(model.getEditBudget().used,0);assert.deepEqual(after,before);}
    }else if(item.operation==='generate'){
      const mutated=structuredClone(proposal.spec),row=mutated.sections.flatMap(section=>section.rows).find(row=>row.bind);
      if(row){const field=mutated.state.find(field=>field.id===row.bind);field.initial=field.type==='boolean'?!field.initial:field.type==='enum'?field.options.find(option=>option.id!==field.initial).id:field.type==='number'?field.min:field.initial+'x';
        assert.throws(()=>checkAdaptabilityResult(item,{proposal:{...proposal,spec:mutated},report},{expectedSpec:expected.expectedSpec,after}),/ADAPT_BUSINESS_FACTS/);}
      const omitted=structuredClone(proposal.spec);omitted.sections[0].rows.pop();
      assert.throws(()=>checkAdaptabilityResult(item,{proposal:{...proposal,spec:omitted},report},{expectedSpec:expected.expectedSpec,after}),/ADAPT_BUSINESS_FACTS/);
    }else{
      const extra=structuredClone(after);extra.spec.title='越界标题';
      assert.throws(()=>checkAdaptabilityResult(item,{proposal,report},{expectedSpec:expected.expectedSpec,before,after:extra}),/ADAPT_EDIT_SCOPE_OR_FACTS/);
      const live=structuredClone(after);const field=Object.keys(live.state)[0];live.state[field]=typeof live.state[field]==='boolean'?!live.state[field]:'changed';
      assert.throws(()=>checkAdaptabilityResult(item,{proposal,report},{expectedSpec:expected.expectedSpec,before,after:live}),/ADAPT_LIVE_STATE_CHANGED/);
      await model.undo();assert.deepEqual(await model.exportPanel(),before);
    }
  }finally{model.dispose();}
});

test('expectation and plan modifications plus consumed plans are rejected before dispatch',async()=>{
  const path=join(prepared,'G01.expectation.json'),bytes=await readFile(path);
  await writeFile(path,Buffer.concat([bytes,Buffer.from(' ')]));
  await assert.rejects(verifyAdaptability(prepared,{checkLogin:false}),/ADAPT_FILE_CHANGED/);
  await writeFile(path,bytes);await verifyAdaptability(prepared,{checkLogin:false});
  const planPath=join(prepared,'input-adaptability-plan.json'),planBytes=await readFile(planPath);
  const altered=JSON.parse(planBytes);altered.policy.maxInvocations=25;await writeFile(planPath,JSON.stringify(altered));
  await assert.rejects(verifyAdaptability(prepared,{checkLogin:false}),/ADAPT_PLAN_DIGEST/);
  await writeFile(planPath,planBytes);
  await writeFile(join(prepared,'dispatch-claim.json'),'{}',{flag:'wx'});
  await assert.rejects(verifyAdaptability(prepared,{checkLogin:false}));
});

test('generation oracle retains negative labels, choice order and reset scope',async()=>{
  const item=INPUT_ADAPTABILITY_CASES.find(item=>item.id==='G08'),context=await readJson(join(prepared,'G08.context.json'));
  const proposal=await materializePanelIntent(context,referenceIntent(context,item)),expectedSpec=proposal.spec,report=await checkPanelProposal(context,proposal);
  for(const mutate of [spec=>spec.sections[0].rows[0].label='打扰 ✓',spec=>spec.state.find(field=>field.options).options.reverse(),spec=>spec.sections[0].rows[0].kind='switch']){
    const spec=structuredClone(expectedSpec);mutate(spec);assert.throws(()=>checkAdaptabilityResult(item,{proposal:{...proposal,spec},report},{expectedSpec}),/ADAPT_BUSINESS_FACTS/);
  }
  const resetItem=INPUT_ADAPTABILITY_CASES.find(item=>item.id==='G11'),resetContext=await readJson(join(prepared,'G11.context.json'));
  const resetProposal=await materializePanelIntent(resetContext,referenceIntent(resetContext,resetItem)),facts=businessFacts(resetProposal.spec);
  assert.deepEqual(facts.rows.at(-1).action.fields,['提示','画质','背包']);
  const changed=structuredClone(resetProposal.spec);changed.sections[0].rows.at(-1).action.fields.pop();
  const resetReport=await checkPanelProposal(resetContext,resetProposal);
  assert.throws(()=>checkAdaptabilityResult(resetItem,{proposal:{...resetProposal,spec:changed},report:resetReport},{expectedSpec:resetProposal.spec}),/ADAPT_BUSINESS_FACTS/);
});
