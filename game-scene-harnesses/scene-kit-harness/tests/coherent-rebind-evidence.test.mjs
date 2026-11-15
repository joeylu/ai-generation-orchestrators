import test from 'node:test';
import assert from 'node:assert/strict';
import fs,{writeFileSync,mkdtempSync,rmSync,readdirSync,readFileSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import * as flow from '../src/generation/index.mjs';
import {seal,unseal,jsonBytes} from '../src/generation/common.mjs';
import {exportCoherentRebindEvidence,proposeCoherentRebind} from '../src/generation/coherent-rebind-evidence.mjs';
import {commitCoherentRebind,recoverCoherentRebindBatch} from '../src/generation/index.mjs';
import {setupCoherent,sourcePng} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';

const rejects=(fn,code)=>assert.throws(fn,e=>e.errors?.some(x=>x.code===code));
function project(t,changed=false){
  const f=setupCoherent(t,undefined,undefined,changed?{transformAnalysis:a=>{
    const b=unseal(a);b.instances[1].anchor.x+=1;return seal(b);
  }}:{});
  const batch=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:flow.createLayerSourceScopes(f.brief.requirements)});
  return {...f,batch};
}
function independentProject(t,projectId,rules=[]){
  const f=setupCoherent(t,undefined,undefined,{transformBrief:b=>({...b,projectId,style:{...b.style,rules}})});
  const batch=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:flow.createLayerSourceScopes(f.brief.requirements)});
  return {...f,batch};
}
function receive(f,sha,raw){
  flow.authorizeReferenceAssetBatch(f.workflow,f.batch.sha256,decision('source.batch.compute',f.batch.sha256,'approve-compute'));
  const {request,...ticket}=flow.reservePlan(f.workflow,sha);flow.recordSubmission(f.workflow,ticket);return flow.receiveResult(f.workflow,ticket,raw);
}
function inputs(source,target){
  const targetPlan=flow.getGenerationPlan(target.workflow,target.batch.planSha256s[0]);
  return {sourceWorkflow:source.workflow,sourcePlanSha256:source.batch.planSha256s[0],targetPlanSha256:targetPlan.sha256,
    targetSha256:targetPlan.recipe.targetSha256,scopeSha256:targetPlan.sourceScope.definition.sha256};
}

test('fresh replay exports only neutral source projection and binds a new target without accepting or computing', {timeout:240000}, t=>{
  const a=project(t),b=project(t,true),raw=sourcePng(false,17),sha=a.batch.planSha256s[0];receive(a,sha,raw);
  const oldStatus=flow.inspectWorkflow(a.workflow),newStatus=flow.inspectWorkflow(b.workflow);
  const x=exportCoherentRebindEvidence(a.workflow,sha),options=inputs(a,b),candidate=proposeCoherentRebind(b.workflow,options),p=candidate.proposal;
  assert.deepEqual(candidate.evidence,x.evidence);assert.deepEqual(candidate.bytes,raw);
  assert.deepEqual(x.bytes,raw);assert.notEqual(p.source.targetSha256,p.target.targetSha256);
  assert.equal(p.newTechnical.status,'pass');assert.equal(p.review,'required');assert.equal(p.generationCalls,0);
  assert.equal(p.sourceVisualAcceptance,'not-transferred');assert.equal(p.finalArtAcceptance,'not-assessed');
  assert.match(p.provenance,/do-not-attest/);
  assert.doesNotMatch(JSON.stringify({evidence:x.evidence,proposal:p}),/attempt|authori[sz]|providerPath|workflowPath|ticket|transport|nonce/i);
  assert.deepEqual(flow.inspectWorkflow(a.workflow),oldStatus);assert.deepEqual(flow.inspectWorkflow(b.workflow),newStatus);
  rejects(()=>proposeCoherentRebind(b.workflow,{...options,bytes:Buffer.from('tampered')}),'WORKFLOW_SHAPE');
  rejects(()=>proposeCoherentRebind(b.workflow,{...options,targetSha256:'0'.repeat(64)}),'REBIND_TARGET_BINDING');
  rejects(()=>proposeCoherentRebind(b.workflow,{...options,scopeSha256:'0'.repeat(64)}),'REBIND_TARGET_BINDING');
  const sky=flow.getGenerationPlan(b.workflow,b.batch.planSha256s[1]);
  rejects(()=>proposeCoherentRebind(b.workflow,{...options,targetPlanSha256:sky.sha256,scopeSha256:sky.sourceScope.definition.sha256}),'REBIND_TARGET_BINDING');
  const sameTarget=project(t);
  rejects(()=>proposeCoherentRebind(sameTarget.workflow,inputs(a,sameTarget)),'REBIND_TARGET_BINDING');
  const injected=seal({...unseal(x.evidence),source:{...x.evidence.source,role:'sky'},attempt:'secret'});
  rejects(()=>proposeCoherentRebind(b.workflow,{...options,evidence:injected}),'WORKFLOW_SHAPE');
  writeFileSync(join(a.workflow,'blobs',x.evidence.rawSha256+'.bin'),Buffer.from('changed'));
  rejects(()=>exportCoherentRebindEvidence(a.workflow,sha),'BLOB_INTEGRITY');
});
test('unreceived and technically rejected source cannot be exported', {timeout:240000},t=>{
  const f=project(t),sha=f.batch.planSha256s[0];rejects(()=>exportCoherentRebindEvidence(f.workflow,sha),'REBIND_SOURCE_STATE');
  receive(f,sha,Buffer.from('not a PNG'));
  rejects(()=>exportCoherentRebindEvidence(f.workflow,sha),'REBIND_SOURCE_STATE');
});
test('indeterminate source cannot be exported', {timeout:240000},t=>{
  const f=project(t),sha=f.batch.planSha256s[0];
  flow.authorizeReferenceAssetBatch(f.workflow,f.batch.sha256,decision('unknown.batch.compute',f.batch.sha256,'approve-compute'));
  const {request,...ticket}=flow.reservePlan(f.workflow,sha);flow.recordSubmission(f.workflow,ticket);flow.stopAttempt(f.workflow,ticket,'indeterminate');
  rejects(()=>exportCoherentRebindEvidence(f.workflow,sha),'REBIND_SOURCE_STATE');
});
test('distinct project style IDs can match only exact style content', {timeout:240000},t=>{
  const a=independentProject(t,'source.project',['First rule','Second rule']);
  receive(a,a.batch.planSha256s[0],sourcePng(false,17));
  const b=independentProject(t,'target.project',['First rule','Second rule']);
  const p=proposeCoherentRebind(b.workflow,inputs(a,b)).proposal;
  assert.notEqual(p.source.styleSha256,p.target.styleSha256);assert.equal(p.source.styleContentSha256,p.target.styleContentSha256);
  const reordered=independentProject(t,'reordered.project',['Second rule','First rule']);
  rejects(()=>proposeCoherentRebind(reordered.workflow,inputs(a,reordered)),'REBIND_TARGET_BINDING');
  const changed=independentProject(t,'changed.project',['First rule','Second rule changed']);
  rejects(()=>proposeCoherentRebind(changed.workflow,inputs(a,changed)),'REBIND_TARGET_BINDING');
});
test('custom style anchor bytes are part of content identity', {timeout:240000},t=>{
  const dir=mkdtempSync(join(tmpdir(),'rebind-anchor-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const first=join(dir,'first.png'),second=join(dir,'second.png');writeFileSync(first,sourcePng(false,37));writeFileSync(second,sourcePng(false,38));
  const custom=(projectId,anchorPath)=>{
    const f=setupCoherent(t,undefined,undefined,{transformBrief:b=>({...b,projectId,style:{mode:'custom',preset:null,name:'Synthetic custom',rules:['Same style'],anchorPath}})});
    const batch=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:flow.createLayerSourceScopes(f.brief.requirements)});return {...f,batch};
  };
  const a=custom('anchor.source',first),b=custom('anchor.target',first),c=custom('anchor.changed',second);
  receive(a,a.batch.planSha256s[0],sourcePng(false,17));
  assert.equal(proposeCoherentRebind(b.workflow,inputs(a,b)).proposal.newTechnical.status,'pass');
  rejects(()=>proposeCoherentRebind(c.workflow,inputs(a,c)),'REBIND_TARGET_BINDING');
});
test('adopted v1 canvas preparation rebinds only after replaying original and padded sources',{timeout:240000},t=>{
  const a=project(t),b=project(t,true),sourceSha=a.batch.planSha256s[2],raw=sourcePng(true,17);receive(a,sourceSha,raw);
  const preview=flow.proposeCoherentCanvasGutterPreparation(a.workflow,sourceSha,a.batch.sha256);
  assert.equal(preview.proposal.format,'ai_scene_coherent_canvas_gutter_proposal_v1');
  const record=flow.prepareCoherentCanvasGutterSource(a.workflow,{preparationId:'gutter.selected',proposal:preview.proposal,
    receipt:decision('gutter.exact.accept',preview.proposal.sha256)});
  rejects(()=>exportCoherentRebindEvidence(a.workflow,record.sha256),'REBIND_SOURCE_PREPARATION');
  const batch=flow.adoptCoherentPreparedSource(a.workflow,a.batch.sha256,record.sha256,'gutter.adopted');
  assert(batch.planSha256s.includes(record.sha256));
  const x=exportCoherentRebindEvidence(a.workflow,record.sha256),target=flow.getGenerationPlan(b.workflow,b.batch.planSha256s[2]);
  assert.equal(x.evidence.source.planSha256,record.sha256);assert.equal(x.evidence.source.assetId,target.recipe.assetId);
  assert.equal(x.evidence.rawSha256,record.rawSha256);assert.deepEqual(x.bytes,preview.bytes);
  assert.equal(x.evidence.technicalSha256,record.technical.sha256);assert.equal(x.evidence.visualAcceptance,'not-transferred');
  assert.doesNotMatch(JSON.stringify(x.evidence),/receipt|attempt|authori[sz]|providerPath|workflowPath|ticket|transport|nonce/i);
  const options={sourceWorkflow:a.workflow,sourcePlanSha256:record.sha256,targetPlanSha256:target.sha256,
    targetSha256:target.recipe.targetSha256,scopeSha256:target.sourceScope.definition.sha256};
  const {proposal}=proposeCoherentRebind(b.workflow,options);assert.equal(proposal.newTechnical.status,'pass');
  assert.equal(proposal.sourceVisualAcceptance,'not-transferred');assert.equal(proposal.finalArtAcceptance,'not-assessed');
  rejects(()=>proposeCoherentRebind(b.workflow,{...options,scopeSha256:'0'.repeat(64)}),'REBIND_TARGET_BINDING');
  const wrong=flow.getGenerationPlan(b.workflow,b.batch.planSha256s[3]);
  rejects(()=>proposeCoherentRebind(b.workflow,{...options,targetPlanSha256:wrong.sha256,scopeSha256:wrong.sourceScope.definition.sha256}),'REBIND_TARGET_BINDING');
  rejects(()=>commitCoherentRebind(b.workflow,{...options,proposal,receipt:decision('incorrect',sourceSha),rebindId:'gutter.rebind',
    parentBatchSha256:b.batch.sha256,batchId:'gutter.rebind.batch'}),'REBIND_REVIEW');
  const savedOriginal=readFileSync(join(a.workflow,'blobs',record.originalRawSha256+'.bin'));
  writeFileSync(join(a.workflow,'blobs',record.originalRawSha256+'.bin'),Buffer.from('changed original'));
  rejects(()=>proposeCoherentRebind(b.workflow,options),'BLOB_INTEGRITY');writeFileSync(join(a.workflow,'blobs',record.originalRawSha256+'.bin'),savedOriginal);
  const savedPadded=readFileSync(join(a.workflow,'blobs',record.rawSha256+'.bin'));
  writeFileSync(join(a.workflow,'blobs',record.rawSha256+'.bin'),Buffer.from('changed padded'));
  rejects(()=>exportCoherentRebindEvidence(a.workflow,record.sha256),'BLOB_INTEGRITY');writeFileSync(join(a.workflow,'blobs',record.rawSha256+'.bin'),savedPadded);
  const paths=readdirSync(join(a.workflow,'events')).sort().map(n=>join(a.workflow,'events',n)),saved=paths.map(path=>readFileSync(path));
  const altered=paths.findIndex(path=>JSON.parse(readFileSync(path)).record.sha256===record.sha256);assert(altered>=0);
  try{
    let prior=altered?JSON.parse(saved[altered-1]).sha256:JSON.parse(readFileSync(join(a.workflow,'workflow.json'))).sha256;
    for(let n=altered;n<paths.length;n++){
      const body=unseal(JSON.parse(saved[n]));body.previousSha256=prior;
      if(n===altered){const rec=unseal(body.record);rec.technical=seal({...unseal(rec.technical),status:'fail'});body.record=seal(rec);}
      const event=seal(body);writeFileSync(paths[n],jsonBytes(event));prior=event.sha256;
    }
    rejects(()=>exportCoherentRebindEvidence(a.workflow,record.sha256),'COHERENT_CANVAS_GUTTER_REPLAY');
  }finally{paths.forEach((path,n)=>writeFileSync(path,saved[n]));}
  const bound=commitCoherentRebind(b.workflow,{...options,proposal,receipt:decision('new.role.accept',proposal.sha256),rebindId:'gutter.rebind',
    parentBatchSha256:b.batch.sha256,batchId:'gutter.rebind.batch'});
  assert.equal(bound.batch.format,'ai_scene_coherent_source_batch_v3');assert.equal(bound.record.request.maximumCalls,0);
  assert.equal(bound.record.sourceEvidence.source.planSha256,record.sha256);assert.equal(bound.record.proposal.finalArtAcceptance,'not-assessed');
});
test('only an intact journal missing its second event can recover the originally bound batch', {timeout:240000},t=>{
  const a=project(t),b=project(t,true),sha=a.batch.planSha256s[0],raw=sourcePng(false,17);receive(a,sha,raw);
  const base=inputs(a,b),{proposal}=proposeCoherentRebind(b.workflow,base),before=flow.inspectWorkflow(b.workflow);
  const opts={...base,proposal,receipt:decision('rebind.accept',proposal.sha256),rebindId:'rebind.recovery',parentBatchSha256:b.batch.sha256,batchId:'rebind.batch'};
  const missing=join(b.workflow,'events',String(before.eventCount+2).padStart(6,'0')+'.json'),original=fs.openSync;
  try{fs.openSync=function(path,...args){if(String(path)===missing)throw Error('simulated missing batch event');return original.call(this,path,...args);};syncBuiltinESMExports();
    rejects(()=>commitCoherentRebind(b.workflow,opts),'WORKFLOW_WRITE_FAILED');
  }finally{fs.openSync=original;syncBuiltinESMExports();}
  const after=flow.inspectWorkflow(b.workflow);assert.equal(after.eventCount,before.eventCount+1);
  const row=after.plans.find(p=>p.kind==='coherent-rebind');assert(row);
  const recovery={sourceWorkflow:a.workflow,sourcePlanSha256:sha,rebindSha256:row.planSha256,parentBatchSha256:b.batch.sha256,batchId:'rebind.batch'};
  rejects(()=>recoverCoherentRebindBatch(b.workflow,{...recovery,batchId:'different.batch'}),'REBIND_RECOVERY');
  writeFileSync(join(a.workflow,'blobs',proposal.rawSha256+'.bin'),Buffer.from('changed'));
  rejects(()=>recoverCoherentRebindBatch(b.workflow,recovery),'BLOB_INTEGRITY');
  writeFileSync(join(a.workflow,'blobs',proposal.rawSha256+'.bin'),raw);
  flow.reviewResult(b.workflow,row.planSha256,decision('new.source.review',proposal.rawSha256));
  const batch=recoverCoherentRebindBatch(b.workflow,recovery);assert.equal(batch.format,'ai_scene_coherent_source_batch_v3');
  assert.equal(flow.inspectWorkflow(b.workflow).eventCount,before.eventCount+3);
  rejects(()=>recoverCoherentRebindBatch(b.workflow,recovery),'REBIND_PARENT_STALE');
});
test('partial second journal event is retained and is not auto-repaired', {timeout:240000},t=>{
  const a=project(t),b=project(t,true),sha=a.batch.planSha256s[0],raw=sourcePng(false,17);receive(a,sha,raw);
  const base=inputs(a,b),{proposal}=proposeCoherentRebind(b.workflow,base),before=flow.inspectWorkflow(b.workflow);
  const opts={...base,proposal,receipt:decision('partial.accept',proposal.sha256),rebindId:'rebind.partial',parentBatchSha256:b.batch.sha256,batchId:'partial.batch'};
  const partial=join(b.workflow,'events',String(before.eventCount+2).padStart(6,'0')+'.json'),open=fs.openSync,write=fs.writeFileSync;let fd;
  try{
    fs.openSync=function(path,...args){const d=open.call(this,path,...args);if(String(path)===partial)fd=d;return d;};
    fs.writeFileSync=function(path,data,...args){if(path===fd){write.call(this,path,Buffer.from('{'));throw Error('simulated partial batch event');}return write.call(this,path,data,...args);};
    syncBuiltinESMExports();rejects(()=>commitCoherentRebind(b.workflow,opts),'WORKFLOW_WRITE_FAILED');
  }finally{fs.openSync=open;fs.writeFileSync=write;syncBuiltinESMExports();}
  assert.equal(fs.readFileSync(partial,'utf8'),'{');
  assert.throws(()=>flow.inspectWorkflow(b.workflow));
  assert.throws(()=>recoverCoherentRebindBatch(b.workflow,{sourceWorkflow:a.workflow,sourcePlanSha256:sha,
    rebindSha256:'0'.repeat(64),parentBatchSha256:b.batch.sha256,batchId:'partial.batch'}));
  assert.equal(fs.readFileSync(partial,'utf8'),'{');
});
