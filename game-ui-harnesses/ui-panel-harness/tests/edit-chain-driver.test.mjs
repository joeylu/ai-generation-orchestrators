import test from 'node:test';
import assert from 'node:assert/strict';
import { readJson } from '../src/io.mjs';
import { loadWorkspaceCore } from '../src/component-adapter.mjs';
import { createPanelBundle } from '../src/panel-bundle.mjs';
import { inputStressFixture } from '../scripts/input-stress-fixtures.mjs';
import { INPUT_STRESS_SUITE } from '../examples/input-stress-v1/suite.mjs';
import { EDIT_CHAIN_STEPS } from '../examples/edit-chain-v1/suite.mjs';
import { executeEditChain } from '../scripts/edit-chain-driver.mjs';
import { chainFixturePatch,stressFixtureProposal,checkChainEdit,findStressRow } from '../scripts/edit-chain-contract.mjs';
import { checkPanelEditProposal } from '../src/edit-planning.mjs';
import { applyPanelPatch } from '../src/patch.mjs';
import { digestJson } from '../src/canonical.mjs';
const core=await loadWorkspaceCore(),catalog=await readJson(new URL('../examples/modern-mint-forms.catalog.json',import.meta.url));
async function source(){const spec=inputStressFixture(INPUT_STRESS_SUITE.cases[0]);
  return createPanelBundle(spec,catalog,core,{...Object.fromEntries(spec.state.map(field=>[field.id,field.initial])),
    [findStressRow(spec,'主音量').bind]:83,[findStressRow(spec,'静音').bind]:true});}
async function fixture(context,step){const proposal=stressFixtureProposal(context,await chainFixturePatch(context.spec,step));
  return{proposal,report:await checkPanelEditProposal(context,proposal),receipt:null};}

test('10 dependent edits bind fresh contexts, retain every live field, clear dependencies and undo the whole chain',async()=>{
  const initial=await source(),contexts=[],saved=new Map();
  const report=await executeEditChain({source:initial,core,invoke:async(context,step)=>{contexts.push(context);return fixture(context,step);},
    save:async(step,name,value)=>saved.set(step.id+'/'+name,structuredClone(value))});
  assert.equal(report.status,'FIXTURE_PASS');assert.equal(report.modelCalls,0);assert.equal(report.invocationCallbacks,10);
  assert.equal(report.totals.passed,10);assert.equal(report.fullUndo,'PASS');assert.equal(report.retainedPanelSha256,initial.sha256);
  assert.equal(new Set(contexts.map(context=>context.sha256)).size,10);
  for(let i=1;i<10;i++)assert.deepEqual(contexts[i].spec,saved.get(EDIT_CHAIN_STEPS[i-1].id+'/after.panel.bundle.json').spec);
  const disabled=saved.get('edit05/after.panel.bundle.json'),enabled=saved.get('edit06/after.panel.bundle.json');
  assert.equal(findStressRow(disabled.spec,'静音').enabled,false);assert.equal(findStressRow(enabled.spec,'静音').enabled,true);
  assert.deepEqual(disabled.state,enabled.state);assert.equal(saved.get('edit10/after.panel.bundle.json').spec.state.length,1);
});

test('a valid but unrequested semantic drift never publishes the candidate and stops all later calls',async()=>{
  const saved=new Map();let calls=0;
  const report=await executeEditChain({source:await source(),core,save:async(step,name,value)=>saved.set(step.id+'/'+name,value),
    invoke:async(context,step)=>{calls++;const actual=await fixture(context,step);
      if(step.id==='edit03'){actual.proposal.patch.operations.push({op:'set-panel-title',title:'不应改变'});
        actual.proposal.decisions.push({operationIndex:actual.proposal.patch.operations.length-1,basis:{kind:'request-interpretation',start:0,end:context.request.text.length,quote:context.request.text}});
        actual.report=await checkPanelEditProposal(context,actual.proposal);}
      return actual;}});
  assert.equal(calls,3);assert.equal(report.status,'FAIL');assert.equal(report.steps[2].stage,'semantic');
  assert.equal(report.totals.notRun,7);assert(!saved.has('edit03/after.panel.bundle.json'));
  assert.equal(report.retainedPanelSha256,saved.get('edit03/before.panel.bundle.json').sha256);
});

test('an indeterminate invocation is terminal and is never resubmitted',async()=>{
  let calls=0;const report=await executeEditChain({source:await source(),core,invoke:async()=>{calls++;const error=new Error('private detail');error.code='TRANSPORT_UNKNOWN';throw error;}});
  assert.equal(calls,1);assert.equal(report.status,'FAIL');assert.equal(report.steps[0].failureCode,'TRANSPORT_UNKNOWN');
  assert.equal(report.steps[0].receipt,null);assert.equal(report.totals.notRun,9);assert.equal(report.automaticRetries,0);
  assert(!JSON.stringify(report).includes('private detail'));
});

test('stale context and base digests from a previous step are rejected before a new result is applied',async()=>{
  let old,calls=0;const report=await executeEditChain({source:await source(),core,invoke:async(context,step)=>{
    calls++;if(old)return old;old=await fixture(context,step);return old;}});
  assert.equal(calls,2);assert.equal(report.totals.passed,1);assert.equal(report.steps[1].status,'FAIL');assert.equal(report.totals.notRun,8);
});

test('preflight failure before a dependent step causes zero additional invocation callbacks',async()=>{
  let calls=0;const report=await executeEditChain({source:await source(),core,verifyBeforeStep:async(step)=>{
    if(step.id==='edit02')throw Object.assign(new Error('changed source'),{code:'PIN_CHANGED'});},invoke:async(context,step)=>{calls++;return fixture(context,step);}});
  assert.equal(calls,1);assert.equal(report.steps[1].stage,'preflight');assert.equal(report.steps[1].failureCode,'PIN_CHANGED');assert.equal(report.totals.notRun,8);
});

test('disable/enable assertions reject valid changes to state, events and reset scope',async()=>{
  const initial=await source();let spec=initial.spec;
  for(const step of EDIT_CHAIN_STEPS.slice(0,4))spec=(await applyPanelPatch(spec,await chainFixturePatch(spec,step))).spec;
  const beforeSha=await digestJson(spec),step=EDIT_CHAIN_STEPS[4],after=(await applyPanelPatch(spec,await chainFixturePatch(spec,step))).spec;
  assert.equal((await checkChainEdit(spec,after,step)).status,'PASS');
  for(const mutate of [value=>{value.state.find(field=>field.id===findStressRow(value,'静音').bind).initial=true;},
    value=>{findStressRow(value,'静音').event='panel.changed';},
    value=>{value.sections[0].rows.find(row=>row.kind==='button').action.fields.pop();}]){
    const wrong=structuredClone(after);mutate(wrong);await assert.rejects(checkChainEdit(spec,wrong,step));}
  assert.equal(await digestJson(spec),beforeSha);
});

test('a later failed call retains the added slider live91 even though its authoring default is40',async()=>{
  const saved=new Map();const report=await executeEditChain({source:await source(),core,
    save:async(step,name,value)=>saved.set(step.id+'/'+name,value),invoke:async(context,step)=>{
      if(step.id==='edit04')throw Object.assign(new Error('lost response'),{code:'TRANSPORT_UNKNOWN'});return fixture(context,step);}});
  const before=saved.get('edit04/before.panel.bundle.json'),row=findStressRow(before.spec,'音效音量');
  assert.equal(before.state[row.bind],91);assert.equal(before.spec.state.find(field=>field.id===row.bind).initial,40);
  assert.equal(report.retainedPanelSha256,before.sha256);assert.equal(report.totals.notRun,6);assert.equal(report.invocationCallbacks,4);
});
