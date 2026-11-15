import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import * as flow from '../src/generation/index.mjs';
import {prepareTerrainEdgeComputeReview} from '../src/terrain-edge-pipeline.mjs';
import {reserveTerrainEdgeExchange,receiveTerrainEdgeExchange,stopTerrainEdgeExchange,runTerrainEdgeExchange} from '../src/terrain-edge-exchange.mjs';
import {compileTerrainEdgeRecoveryBatch,compileTerrainEdgeRecoveryPlan} from '../src/generation/terrain-edge-recovery.mjs';
import {transact} from '../src/generation/store.mjs';
import {replay} from '../src/generation/model.mjs';
import {digest,seal,unseal} from '../src/generation/common.mjs';
import {encodeRgbaPng} from '../src/png.mjs';
import {setupCoherent,sourcePng} from './helpers/coherent.mjs';
import {receiveEdgeFixture} from './helpers/terrain-edge-delivery.mjs';
import {decision} from './helpers/generation.mjs';

const rejects=(action,code)=>assert.throws(action,error=>error.errors?.some(issue=>!code||issue.code===code));
function native({background=false,weak=false,opaque=false}={}){
  const w=320,h=256,rgba=Buffer.alloc(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(background||opaque||x>=35&&x<285&&y>=30&&y<226)
    rgba.set([69+x%75,83+y%65,110,background?206:255],(y*w+x)*4);
  if(weak)rgba.set([29,47,61,1],128*w*4);
  return encodeRgbaPng(w,h,rgba);
}
function setup(t,{prepared=false,earlierUnused=false}={}){
  const f=setupCoherent(t),base=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:flow.createLayerSourceScopes(f.brief.requirements)});
  flow.authorizeReferenceAssetBatch(f.workflow,base.sha256,decision('base.compute',base.sha256,'approve-compute'));
  for(const [i,sha]of base.planSha256s.entries())receiveEdgeFixture(f.workflow,sha,i===0?sourcePng(false,17):native({opaque:flow.getGenerationPlan(f.workflow,sha).target.alpha!=='transparent'}));
  const original=flow.freezeTerrainEdgeSources(f.workflow,{batchId:'perimeter',baseBatchSha256:base.sha256,
    capabilitiesSha256:f.options.capabilitiesSha256,coverageProfile:'full-perimeter-v1',nativeSizeProfile:'bounded-native-4m-v1',
    renderEnvelopeProfile:'visible-alpha8-outward16-native-rgba-v1',naturalSurfaceProfile:'reference-defined-cover-v1',
    items:flow.TERRAIN_PERIMETER_ROLES.map((role,i)=>({assetId:'edge.'+i,role,content:'One design-specified natural edge.',exclusions:['Independent props']}))});
  flow.authorizeReferenceAssetBatch(f.workflow,original.sha256,decision('perimeter.compute',original.sha256,'approve-compute'));
  let parent=original;
  receiveEdgeFixture(f.workflow,original.planSha256s[0],native({weak:prepared}));
  if(prepared){
    const {proposal}=flow.proposeTerrainEdgeCanvasGutterPreparation(f.workflow,original.planSha256s[0],original.sha256);
    parent=flow.prepareAndAdoptTerrainEdgeCanvasGutterSource(f.workflow,{preparationId:'left.canvas',proposal,
      receipt:decision('left.canvas.accept',proposal.sha256),parentBatchSha256:original.sha256,batchId:'perimeter.canvas'}).batch;
  }
  for(const sha of original.planSha256s.slice(1,earlierUnused?3:4))receiveEdgeFixture(f.workflow,sha,native());
  const failed=receiveEdgeFixture(f.workflow,original.planSha256s[4],native({background:true}));
  assert.deepEqual(failed.technical.issues,['COHERENT_NO_TRANSPARENCY','COHERENT_CLIPPED_SILHOUETTE','TERRAIN_EDGE_NATIVE_GUTTER']);
  const options={parentBatchSha256:parent.sha256,failedPlanSha256:original.planSha256s[4],planId:'bottom.replacement',batchId:'perimeter.recovery'};
  return {...f,original,parentBatch:parent,failed,options};
}
const auths=f=>transact(f.workflow,store=>{const s=replay(store);return f.original.planSha256s.slice(5).map(sha=>s.plans.get(sha).authorization);});
const cli=(...args)=>{const r=spawnSync(process.execPath,['scripts/terrain-edges.mjs',...args],{cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:180000});
  assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);};

test('one-role recovery preserves prepared sources and unused exact authorizations; only a fresh plan can run first',{timeout:1200000},t=>{
  const f=setup(t,{prepared:true}),before=flow.inspectWorkflow(f.workflow),oldAuth=auths(f),
    originalPlan=flow.getGenerationPlan(f.workflow,f.options.failedPlanSha256),originalResult=flow.getGenerationResult(f.workflow,f.options.failedPlanSha256),
    path=join(f.parent,'options.json');writeFileSync(path,JSON.stringify(f.options));
  const preview=cli('recovery-preview','--workflow',f.workflow,'--options',path);
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);assert.equal(preview.generationCalls,0);assert.equal(preview.executable,false);
  assert.equal(digest(preview.plan.request),digest(originalPlan.request));assert.notEqual(preview.plan.sha256,originalPlan.sha256);
  assert.deepEqual(preview.plan.recipe.parents,[originalPlan.sha256]);
  const batch=cli('recovery-freeze','--workflow',f.workflow,'--options',path),after=flow.inspectWorkflow(f.workflow);
  assert.deepEqual(batch,preview.batch);assert.equal(after.eventCount,before.eventCount+2);assert.equal(after.generationCalls,before.generationCalls);
  assert.deepEqual(batch.planSha256s.slice(0,4),f.parentBatch.planSha256s.slice(0,4));assert.deepEqual(batch.preparationSha256s,f.parentBatch.preparationSha256s);
  assert.equal(batch.maximumCalls,1);assert.equal(batch.newImageRequests,1);assert.equal(batch.remainingPreviouslyAuthorizedCalls,2);
  assert.deepEqual(auths(f),oldAuth);assert.deepEqual(flow.getGenerationResult(f.workflow,originalPlan.sha256),originalResult);
  rejects(()=>flow.freezeTerrainEdgeRecovery(f.workflow,f.options),'TERRAIN_EDGE_RECOVERY_PARENT');
  rejects(()=>reserveTerrainEdgeExchange(f.workflow,batch.sha256,join(f.parent,'blocked')),'TERRAIN_EDGE_RECOVERY_CONFIRMATION_REQUIRED');
  assert.equal(existsSync(join(f.parent,'blocked')),false);
  rejects(()=>flow.reserveNextTerrainEdgePlan(f.workflow,batch.sha256,f.original.planSha256s[5]),'TERRAIN_EDGE_RECOVERY_CONFIRMATION_REQUIRED');
  rejects(()=>flow.reservePlan(f.workflow,batch.replacementPlanSha256),'AUTHORIZATION_REQUIRED');
  rejects(()=>flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('wrong.compute',f.parentBatch.sha256,'approve-compute')),'AUTHORIZATION_STATE');
  const report=prepareTerrainEdgeComputeReview(f.workflow,batch.sha256,join(f.parent,'review'));
  assert.equal(report.maximumCalls,1);assert.equal(report.plans.length,1);assert.equal(report.existingAuthorizedContinuations.length,2);
  assert.equal(report.completedSources.length,4);assert.equal(report.executionRemainingAfterFreshApproval,3);
  assert.equal(report.computeAuthorizationIncluded,false);assert.equal(report.artAcceptance,'not-transferred');
  assert.deepEqual(flow.inspectWorkflow(f.workflow),after);
  flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('replacement.compute',batch.sha256,'approve-compute'));
  assert.deepEqual(auths(f),oldAuth);
  rejects(()=>flow.reserveNextTerrainEdgePlan(f.workflow,batch.sha256,f.original.planSha256s[5]),'TERRAIN_EDGE_NEXT_CHANGED');
  assert.deepEqual(prepareTerrainEdgeComputeReview(f.workflow,batch.sha256,join(f.parent,'review')),report);
  rejects(()=>flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('duplicate.compute',batch.sha256,'approve-compute')),'AUTHORIZATION_STATE');
  const file=join(f.parent,'native.png');writeFileSync(file,native());
  for(const [index,sha]of batch.planSha256s.slice(4).entries()){
    const directory=join(f.parent,'exchange-'+index),exchange=reserveTerrainEdgeExchange(f.workflow,batch.sha256,directory);
    assert.equal(exchange.ticket.planSha256,sha);
    if(index===0)rejects(()=>reserveTerrainEdgeExchange(f.workflow,batch.sha256,join(f.parent,'while-active')),'TERRAIN_EDGE_BATCH_STOPPED');
    receiveTerrainEdgeExchange(f.workflow,directory,file);
  }
  const inputs=flow.getTerrainEdgeInputs(f.workflow,batch.sha256);assert.equal(inputs.sources.length,7);
  assert.equal(inputs.sources[0].preparation.originalResult.technical.status,'fail');
  assert.deepEqual(flow.getGenerationPlan(f.workflow,originalPlan.sha256),originalPlan);
  assert.deepEqual(flow.getGenerationResult(f.workflow,originalPlan.sha256),originalResult);assert.deepEqual(auths(f),oldAuth);
  rejects(()=>reserveTerrainEdgeExchange(f.workflow,batch.sha256,join(f.parent,'no-extra')),'TERRAIN_EDGE_NOT_AUTHORIZED');
});

test('failed replacement stops original continuations and never reuses its authorization',{timeout:1200000},t=>{
  const f=setup(t,{earlierUnused:true}),batch=flow.freezeTerrainEdgeRecovery(f.workflow,f.options),oldAuth=auths(f);
  flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('new.compute',batch.sha256,'approve-compute'));
  const directory=join(f.parent,'exchange'),file=join(f.parent,'failed.png');writeFileSync(file,native({background:true}));
  const exchange=reserveTerrainEdgeExchange(f.workflow,batch.sha256,directory);
  assert.equal(exchange.ticket.planSha256,batch.replacementPlanSha256);
  receiveTerrainEdgeExchange(f.workflow,directory,file);
  const before=flow.inspectWorkflow(f.workflow);
  rejects(()=>reserveTerrainEdgeExchange(f.workflow,batch.sha256,join(f.parent,'must-stop')),'TERRAIN_EDGE_BATCH_STOPPED');
  rejects(()=>flow.reservePlan(f.workflow,batch.replacementPlanSha256),'RESERVATION_STATE');
  rejects(()=>flow.getTerrainEdgeInputs(f.workflow,batch.sha256),'TERRAIN_EDGE_SOURCES_INCOMPLETE');
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);assert.deepEqual(auths(f),oldAuth);
});

test('an unknown outcome requires an exact terminal binding and a separately authorized replacement',{timeout:1200000},async t=>{
  const f=setup(t),before=flow.inspectWorkflow(f.workflow);
  rejects(()=>flow.previewTerrainEdgeRecovery(f.workflow,{...f.options,failedPlanSha256:f.original.planSha256s[0]}),'TERRAIN_EDGE_RECOVERY_KNOWN_FAILURE');
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
  const proposal=flow.previewTerrainEdgeRecovery(f.workflow,f.options);
  transact(f.workflow,store=>{const state=replay(store),p=seal({...unseal(proposal.plan),request:{...proposal.plan.request,prompt:'changed prompt'}});
    state.plans.set(p.sha256,{plan:p,status:'planned'});
    rejects(()=>compileTerrainEdgeRecoveryBatch(state,{parentBatchSha256:f.parentBatch.sha256,failedPlanSha256:f.options.failedPlanSha256,
      replacementPlanSha256:p.sha256,batchId:'changed.request'}),'TERRAIN_EDGE_RECOVERY_REPLACEMENT');
    const active=state.plans.get(f.original.planSha256s[5]);active.attempt={};active.status='submitted';
    rejects(()=>compileTerrainEdgeRecoveryPlan(state,f.options,sha=>store.readBlob(sha)),'TERRAIN_EDGE_RECOVERY_ACTIVE');
  });
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
  // Simulate a durable plan-only freeze interruption in the synthetic store.
  transact(f.workflow,store=>store.append(proposal.plan));
  assert.equal(flow.inspectWorkflow(f.workflow).eventCount,before.eventCount+1);
  const batch=flow.freezeTerrainEdgeRecovery(f.workflow,f.options);
  assert.equal(flow.inspectWorkflow(f.workflow).eventCount,before.eventCount+2);
  flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('new.compute',batch.sha256,'approve-compute'));
  const directory=join(f.parent,'unknown'),exchange=reserveTerrainEdgeExchange(f.workflow,batch.sha256,directory);
  const next={...f.options,parentBatchSha256:batch.sha256,failedPlanSha256:batch.replacementPlanSha256,planId:'next',batchId:'next'};
  rejects(()=>flow.previewTerrainEdgeRecovery(f.workflow,next),'TERRAIN_EDGE_RECOVERY_KNOWN_FAILURE');
  rejects(()=>flow.previewTerrainEdgeRecovery(f.workflow,{...next,terminalSha256:'0'.repeat(64)}),'TERRAIN_EDGE_RECOVERY_UNKNOWN_TERMINAL');
  stopTerrainEdgeExchange(f.workflow,directory);
  rejects(()=>flow.previewTerrainEdgeRecovery(f.workflow,next),'TERRAIN_EDGE_RECOVERY_KNOWN_FAILURE');
  rejects(()=>reserveTerrainEdgeExchange(f.workflow,batch.sha256,join(f.parent,'unknown-stop')),'TERRAIN_EDGE_BATCH_STOPPED');
  const terminal=transact(f.workflow,store=>replay(store).plans.get(exchange.ticket.planSha256).terminal);
  const stopped=flow.inspectWorkflow(f.workflow),oldAuth=auths(f);
  rejects(()=>flow.previewTerrainEdgeRecovery(f.workflow,{...next,terminalSha256:exchange.ticket.attemptSha256}),'TERRAIN_EDGE_RECOVERY_UNKNOWN_TERMINAL');
  const options={...next,terminalSha256:terminal.sha256};
  const planned=flow.previewTerrainEdgeRecovery(f.workflow,options);
  assert.deepEqual(flow.inspectWorkflow(f.workflow),stopped);
  assert.equal(planned.batch.terminalAttemptSha256,exchange.ticket.attemptSha256);
  assert.equal(planned.plan.request.maximumCalls,1);
  assert.notEqual(planned.plan.sha256,exchange.ticket.planSha256);
  assert.equal(digest(planned.plan.request),exchange.ticket.requestSha256);
  const replacement=flow.freezeTerrainEdgeRecovery(f.workflow,options);
  assert.deepEqual(replacement,planned.batch);
  const reviewDir=join(f.parent,'unknown-review'),report=prepareTerrainEdgeComputeReview(f.workflow,replacement.sha256,reviewDir);
  assert.equal(report.maximumCalls,1);
  assert.equal(report.predecessorOutcome,'indeterminate');
  assert.equal(report.completedSources.length,4);
  assert.deepEqual(report.existingAuthorizedContinuations.map(row=>row.authorizationSha256),oldAuth.map(record=>record.sha256));
  assert.deepEqual(JSON.parse(readFileSync(join(reviewDir,'predecessor-terminal.json'))),terminal);
  assert(!existsSync(join(reviewDir,'failed-source-native.png')));
  const beforeApproval=flow.inspectWorkflow(f.workflow);
  rejects(()=>reserveTerrainEdgeExchange(f.workflow,replacement.sha256,join(f.parent,'no-new-approval')),'TERRAIN_EDGE_RECOVERY_CONFIRMATION_REQUIRED');
  rejects(()=>flow.reservePlan(f.workflow,f.original.planSha256s[5]),'TERRAIN_EDGE_RECOVERY_CONFIRMATION_REQUIRED');
  assert.deepEqual(flow.inspectWorkflow(f.workflow),beforeApproval);
  flow.authorizeReferenceAssetBatch(f.workflow,replacement.sha256,decision('unknown.replacement.compute',replacement.sha256,'approve-compute'));
  rejects(()=>flow.reservePlan(f.workflow,f.original.planSha256s[5]),'TERRAIN_EDGE_RECOVERY_CONFIRMATION_REQUIRED');
  const fresh=join(f.parent,'new-exchange'),raw=native(),dispatches=[];
  const received=await runTerrainEdgeExchange(f.workflow,replacement.sha256,fresh,{
    async preflight(){assert.equal(flow.inspectWorkflow(f.workflow).plans.find(p=>p.planSha256===planned.plan.sha256).status,'authorized');},
    async generate(input){
      dispatches.push(input);
      assert.deepEqual(flow.getPendingGenerationTicket(f.workflow,input.planSha256),{
        planSha256:input.planSha256,attemptSha256:input.attemptSha256,requestSha256:input.requestSha256});
      assert.equal(flow.inspectWorkflow(f.workflow).plans.find(p=>p.planSha256===input.planSha256).status,'submitted');
      assert(input.images.every((image,index)=>image.bytes.equals(flow.readGenerationInput(f.workflow,input.planSha256,index))));
      return raw;
    },
  });
  assert.equal(dispatches.length,1);
  assert.equal(received.planSha256,replacement.replacementPlanSha256);
  assert.equal(received.technicalStatus,'pass');
  assert.notEqual(dispatches[0].attemptSha256,terminal.attemptSha256);
  assert.deepEqual(readFileSync(join(fresh,'adapter-return.png')),raw);
  const resumed=await runTerrainEdgeExchange(f.workflow,replacement.sha256,join(f.parent,'resume-original'),{
    async preflight(){},
    async generate(input){dispatches.push(input);throw new Error('synthetic connection loss');},
  });
  assert.equal(resumed.planSha256,f.original.planSha256s[5]);
  assert.equal(resumed.status,'indeterminate');
  assert.equal(dispatches.length,2);
  rejects(()=>reserveTerrainEdgeExchange(f.workflow,replacement.sha256,join(f.parent,'stop-again')),'TERRAIN_EDGE_BATCH_STOPPED');
  assert.deepEqual(auths(f),oldAuth);
  assert.deepEqual(transact(f.workflow,store=>replay(store).plans.get(exchange.ticket.planSha256).terminal),terminal);
});
