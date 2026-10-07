/** Finite dependent driver. The caller owns the single-use dispatch claim and producer invocation. */
import assert from 'node:assert/strict';
import { EDIT_CHAIN_STEPS,EDIT_CHAIN_POLICY } from '../examples/edit-chain-v1/suite.mjs';
import { createWorkbenchModel } from '../src/workbench-model.mjs';
import { validatePanelBundle } from '../src/panel-bundle.mjs';
import { checkPanelEditProposal } from '../src/edit-planning.mjs';
import { validateCodexEditReceipt } from '../src/codex-planner.mjs';
import { buildCodexEditResponseSchema } from '../src/codex-edit-schema.mjs';
import { digestJson } from '../src/canonical.mjs';
import { applyPanelPatch } from '../src/patch.mjs';
import { initialPanelState,controlId } from '../src/compiler.mjs';
import { projectPanelEvent } from '../src/state.mjs';
import { checkChainEdit,findStressRow } from './edit-chain-contract.mjs';

export async function executeEditChain({source,core,invoke,save=async()=>{},verifyBeforeStep=async()=>{},firstContext,
  evidence='DRIVER_FIXTURE',onProgress=async()=>{}}) {
  assert(['DRIVER_FIXTURE','REAL_MODEL_OUTPUT'].includes(evidence));assert.equal(typeof invoke,'function');
  const trial=await validatePanelBundle(source,core),model=await createWorkbenchModel({catalog:trial.catalog,pool:null},core);
  await model.importPanel(trial);let values=trial.state,stopped=false,callbacks=0;
  const beforePanels=[],contexts=new Set(),report={editChainRunVersion:'0.1',status:'RUNNING',evidence,
    policy:EDIT_CHAIN_POLICY,steps:[],modelCalls:0,invocationCallbacks:0,automaticRetries:0,
    fullUndo:'NOT_RUN',nativeEngines:'NOT_RUN',humanVisualReview:'NOT_RUN'};
  try {
    for(const step of EDIT_CHAIN_STEPS) {
      const result={id:step.id,status:stopped?'NOT_RUN_DEPENDENCY_FAILED':'RUNNING',stage:null,checks:[],receipt:null,failureCode:null};
      report.steps.push(result);if(stopped)continue;
      try {
        result.stage='preflight';await verifyBeforeStep(step);
        const before=await model.exportPanel(values);beforePanels.push(before);
        const {context}=await model.prepareEdit(step.request),schema=await buildCodexEditResponseSchema({draft:true,context});
        assert.equal(context.baseSpecSha256,await digestJson(before.spec));assert(!contexts.has(context.sha256));contexts.add(context.sha256);
        if(step.id==='edit01'&&firstContext)assert.deepEqual(context,firstContext);
        result.contextSha256=context.sha256;result.beforePanelSha256=before.sha256;result.beforeSpecSha256=await digestJson(before.spec);
        await save(step,'before.panel.bundle.json',before);await save(step,'dispatch-context.json',context);
        await save(step,'dispatch-response-schema.json',schema);
        await save(step,'dispatch.json',{id:step.id,request:step.request,contextSha256:context.sha256,
          baseSpecSha256:context.baseSpecSha256,beforePanelSha256:before.sha256,responseSchemaSha256:await digestJson(schema),
          precedingResultSpecSha256:report.steps.length===1?await digestJson(trial.spec):report.steps.at(-2).resultSpecSha256,maxInvocations:1});
        result.stage='model';callbacks++;report.invocationCallbacks=callbacks;
        const actual=await invoke(context,step);result.receipt=actual.receipt??null;
        const checked=await checkPanelEditProposal(context,actual.proposal);assert.deepEqual(checked,actual.report);
        if(evidence==='REAL_MODEL_OUTPUT'){
          validateCodexEditReceipt(actual.receipt,{contextSha256:context.sha256,proposalSha256:checked.proposalSha256});
          assert.equal(actual.receipt.invocationCount,1);assert.equal(actual.receipt.automaticRetries,0);
        }
        assert.equal(checked.status,'READY_TO_APPLY');result.checks.push('production-proposal-and-context');
        await save(step,'accepted-edit-proposal.json',actual.proposal);
        result.stage='semantic';const candidate=await applyPanelPatch(before.spec,actual.proposal.patch);
        const semantic=await checkChainEdit(before.spec,candidate.spec,step);await save(step,'semantic-report.json',semantic);
        result.resultSpecSha256=semantic.afterSpecSha256;result.checks.push('only-requested-business-change');
        result.stage='apply';const after=await validatePanelBundle((await model.acceptEditProposal(actual.proposal,values)).panel,core);
        assert.deepEqual(after.spec,candidate.spec);
        const expectedValues=Object.fromEntries(after.spec.state.map(field=>[field.id,Object.hasOwn(values,field.id)?values[field.id]:field.initial]));
        assert.deepEqual(after.state,expectedValues);result.checks.push('all-surviving-live-values-and-new-defaults');
        const main=findStressRow(after.spec,step.id==='edit01'?'主音量':'总音量');
        assert.equal(after.state[main.bind],83);assert.equal(initialPanelState(after.spec)[main.bind],50);result.checks.push('trial83-default50-separated');
        const button=after.spec.sections.flatMap(section=>section.rows).find(row=>row.kind==='button');
        const reset=projectPanelEvent(after.spec,after.state,{type:'activate',id:controlId(after.spec.id,button.id),source:'keyboard'});
        const wantedReset={...after.state};for(const id of button.action.fields)wantedReset[id]=initialPanelState(after.spec)[id];
        assert.deepEqual(reset.state,wantedReset);result.checks.push('reset-exact-fields-and-preserved-outsiders');
        if(step.expectation==='disableMute'){
          const mute=findStressRow(after.spec,'静音'),blocked=projectPanelEvent(after.spec,after.state,
            {type:'change',id:controlId(after.spec.id,mute.id),value:!after.state[mute.bind],source:'mouse'});
          assert.deepEqual(blocked,{state:after.state,event:null});result.checks.push('disabled-mute-no-state-or-event-change');
        }
        const exported=await model.exportPanel(after.state),fresh=await createWorkbenchModel({catalog:after.catalog,pool:null},core);
        try{assert.deepEqual((await fresh.importPanel(exported)).panel,after);}finally{fresh.dispose();}
        result.checks.push('export-and-reopen');
        const undo=await createWorkbenchModel({catalog:before.catalog,pool:null},core);
        try{await undo.importPanel(before);await undo.prepareEdit(step.request);await undo.acceptEditProposal(actual.proposal,values);
          assert.deepEqual((await undo.undo()).panel,before);}finally{undo.dispose();}
        result.checks.push('one-step-undo');await save(step,'after.panel.bundle.json',after);
        result.bundleSha256=after.sha256;result.status=evidence==='DRIVER_FIXTURE'?'FIXTURE_PASS':'PASS_BEFORE_BROWSER';result.stage='complete';
        values=after.state;if(step.expectation==='add')values={...values,[findStressRow(after.spec,'音效音量').bind]:91};
      } catch(error) {
        result.status='FAIL';result.failureCode=error.code??(error.name==='AssertionError'?'EDIT_CHAIN_ASSERTION_FAILED':'EDIT_CHAIN_STEP_FAILED');
        if(error.receipt)result.receipt=error.receipt;if(error.diagnostic)result.diagnostic=error.diagnostic;
        stopped=true;
      }
      await save(step,'case-result.json',result);await onProgress({id:result.id,status:result.status,stage:result.stage,failureCode:result.failureCode});
    }
    if(!stopped){for(let i=beforePanels.length-1;i>=0;i--)assert.deepEqual((await model.undo()).panel,beforePanels[i]);report.fullUndo='PASS';}
    report.status=stopped?'FAIL':evidence==='DRIVER_FIXTURE'?'FIXTURE_PASS':'PASS_BEFORE_BROWSER';
    report.modelCalls=evidence==='DRIVER_FIXTURE'?0:callbacks;
    report.totals={steps:10,passed:report.steps.filter(step=>['FIXTURE_PASS','PASS_BEFORE_BROWSER'].includes(step.status)).length,
      notRun:report.steps.filter(step=>step.status==='NOT_RUN_DEPENDENCY_FAILED').length,invocationCallbacks:callbacks,
      reportedInvocations:report.steps.reduce((sum,step)=>sum+(step.receipt?.invocationCount??0),0),automaticRetries:0};
    report.retainedPanelSha256=stopped?(await model.exportPanel(values)).sha256:model.getSnapshot().panel.sha256;return report;
  } finally {model.dispose();}
}
