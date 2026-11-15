import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import * as flow from '../src/generation/index.mjs';
import {inspectReferenceLedProject} from '../src/reference-led-pipeline.mjs';
import {inspectPng,encodeRgbaPng} from '../src/png.mjs';
import {hash,seal,unseal,jsonBytes} from '../src/generation/common.mjs';
import {setupCoherent,sourcePng} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';

const rejects=(fn,code)=>assert.throws(fn,e=>e.errors?.some(v=>v.code===code));
function tailPng({edgeAlpha=3,nearBody=false,width=1024,height=512}={}){
  const rgba=Buffer.alloc(width*height*4);
  for(let y=90;y<height-62;y++)for(let x=100;x<width-100;x++)rgba.set([40+x%130,75+y%90,110,255],(y*width+x)*4);
  rgba.set([211,43,81,edgeAlpha],(256*width+width-1)*4);
  rgba.set([7,19,31,0],0); // Native hidden RGB is part of the original pixels.
  rgba.set([41,75,110,127],(91*width+101)*4);
  if(nearBody)rgba.set([51,81,111,16],(30*width+3)*4);
  return encodeRgbaPng(width,height,rgba);
}
function receive(workflow,sha,bytes){const {request,...ticket}=flow.reservePlan(workflow,sha);flow.recordSubmission(workflow,ticket);return flow.receiveResult(workflow,ticket,bytes);}
function setup(t,options={}){
  const f=setupCoherent(t),batch=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:flow.createLayerSourceScopes(f.brief.requirements)});
  flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('sources.compute',batch.sha256,'approve-compute'));
  receive(f.workflow,batch.planSha256s[0],sourcePng(false,7));receive(f.workflow,batch.planSha256s[1],sourcePng(false,17));
  const raw=tailPng(options),sourceSha=batch.planSha256s[2],result=receive(f.workflow,sourceSha,raw);
  assert.equal(result.technical.status,'fail');return {...f,batch,raw,sourceSha,sourceResult:result};
}
function apply(f,id='prepared.landmark',receiptId='prepare.accept'){
  const p=flow.proposeCoherentBorderPreparation(f.workflow,f.sourceSha);
  const record=flow.prepareCoherentBorderSource(f.workflow,{preparationId:id,proposal:p.proposal,receipt:decision(receiptId,p.proposal.sha256)});
  return {...p,record};
}
function preservePng(expected,actual){
  const a=inspectPng(expected,{includePixels:true,allowHiddenRgb:true}),b=inspectPng(actual,{includePixels:true,allowHiddenRgb:true});
  assert.equal(b.width,a.width+4);assert.equal(b.height,a.height+4);
  for(let y=0;y<a.height;y++)assert.deepEqual(b.rgba.subarray(((y+2)*b.width+2)*4,((y+2)*b.width+2+a.width)*4),a.rgba.subarray(y*a.width*4,(y+1)*a.width*4));
  for(let y=0;y<b.height;y++)for(let x=0;x<b.width;x++)if(x<2||y<2||x>=b.width-2||y>=b.height-2)assert.deepEqual(b.rgba.subarray((y*b.width+x)*4,(y*b.width+x)*4+4),Buffer.alloc(4));
}

test('low-alpha border proposal is read-only, pixel-exact and only exact human acceptance produces a separate max-zero source',t=>{
  const f=setup(t),before=flow.inspectWorkflow(f.workflow),p=flow.proposeCoherentBorderPreparation(f.workflow,f.sourceSha);
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);assert.equal(flow.proposeCoherentBorderPreparation(f.workflow,f.sourceSha).proposal.sha256,p.proposal.sha256);
  assert.equal(p.proposal.originalBorder.maximumAlpha,3);assert.equal(p.proposal.rule.paddingPixels,2);assert.equal(p.proposal.technical.status,'pass');
  assert.equal(p.proposal.maximumNewImageCalls,0);assert.equal(p.proposal.hiddenGeometry,'not-recovered');preservePng(f.raw,p.bytes);
  rejects(()=>flow.prepareCoherentBorderSource(f.workflow,{preparationId:'bad',proposal:p.proposal,receipt:decision('wrong','f'.repeat(64))}),'COHERENT_BORDER_APPROVAL');
  rejects(()=>flow.prepareCoherentBorderSource(f.workflow,{preparationId:'bad',proposal:p.proposal,receipt:decision('declined',p.proposal.sha256,'reject')}),'COHERENT_BORDER_APPROVAL');
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
  const {record}=apply(f),after=flow.inspectWorkflow(f.workflow),original=after.plans.find(p=>p.planSha256===f.sourceSha),prepared=after.plans.find(p=>p.planSha256===record.sha256);
  const originalPlan=flow.getGenerationPlan(f.workflow,f.sourceSha);
  assert.deepEqual(record.instanceBinding,originalPlan.instanceBinding);assert.deepEqual(record.sourceScope,originalPlan.sourceScope);assert.deepEqual(record.referenceEvidence,originalPlan.referenceEvidence);
  assert.equal(original.status,'rejected-technical');assert.equal(original.rawSha256,hash(f.raw));assert.equal(original.technicalStatus,'fail');
  assert.equal(prepared.status,'pending-visual-review');assert.equal(prepared.kind,'coherent-border-preparation');assert.equal(prepared.maximumCalls,0);assert.equal(prepared.reserved,false);
  assert.deepEqual(flow.getGenerationResult(f.workflow,f.sourceSha).result,f.sourceResult);assert.deepEqual(flow.getGenerationResult(f.workflow,f.sourceSha).bytes,f.raw);
  const derived=flow.getGenerationResult(f.workflow,record.sha256);assert.equal(derived.result.format,'ai_scene_coherent_border_result_v1');assert.equal(derived.result.maximumCalls,0);
  assert.equal(inspectReferenceLedProject(f.root).reference.status,'accepted');
  assert.equal(derived.result.technical.edgeMaximumAlpha,0);preservePng(f.raw,derived.bytes);
  const othersBefore=before.plans.filter(p=>f.batch.planSha256s.slice(3).includes(p.planSha256));
  assert.deepEqual(after.plans.filter(p=>f.batch.planSha256s.slice(3).includes(p.planSha256)),othersBefore);
  rejects(()=>flow.authorizePlan(f.workflow,record.sha256,decision('forbidden.compute',record.sha256,'approve-compute')),'AUTHORIZATION_STATE');
  rejects(()=>flow.reservePlan(f.workflow,record.sha256),'AUTHORIZATION_REQUIRED');
});

test('solid canvas contact, significant edge alpha, insufficient body margin, other QA and oversize reject padding',t=>{
  for(const edgeAlpha of [4,255]){const f=setup(t,{edgeAlpha});rejects(()=>flow.proposeCoherentBorderPreparation(f.workflow,f.sourceSha),'COHERENT_BORDER_EDGE');}
  const near=setup(t,{nearBody:true});rejects(()=>flow.proposeCoherentBorderPreparation(near.workflow,near.sourceSha),'COHERENT_BORDER_BODY_MARGIN');
  const size=setup(t,{width:4094});rejects(()=>flow.proposeCoherentBorderPreparation(size.workflow,size.sourceSha),'COHERENT_BORDER_SIZE');
  const f=setup(t);rejects(()=>flow.proposeCoherentBorderPreparation(f.workflow,f.batch.planSha256s[0]),'COHERENT_BORDER_SOURCE');
  const pending=f.batch.planSha256s[3];rejects(()=>flow.proposeCoherentBorderPreparation(f.workflow,pending),'COHERENT_BORDER_SOURCE');
  const {request,...ticket}=flow.reservePlan(f.workflow,pending);flow.recordSubmission(f.workflow,ticket);flow.stopAttempt(f.workflow,ticket,'indeterminate');
  rejects(()=>flow.proposeCoherentBorderPreparation(f.workflow,pending),'COHERENT_BORDER_SOURCE');
  const other=f.batch.planSha256s[4];receive(f.workflow,other,sourcePng(false,21));
  rejects(()=>flow.proposeCoherentBorderPreparation(f.workflow,other),'COHERENT_BORDER_SOURCE_QA');
});

test('proposal tampering and a second preparation for the same original are rejected without rewriting failure',t=>{
  const f=setup(t),p=flow.proposeCoherentBorderPreparation(f.workflow,f.sourceSha),body=unseal(p.proposal);
  const changed=seal({...body,paddedRgbaSha256:'f'.repeat(64)}),before=flow.inspectWorkflow(f.workflow);
  rejects(()=>flow.prepareCoherentBorderSource(f.workflow,{preparationId:'changed',proposal:changed,receipt:decision('changed.accept',changed.sha256)}),'COHERENT_BORDER_PROPOSAL_CHANGED');
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
  apply(f);const count=flow.inspectWorkflow(f.workflow).eventCount;
  rejects(()=>flow.prepareCoherentBorderSource(f.workflow,{preparationId:'second',proposal:p.proposal,receipt:decision('second.accept',p.proposal.sha256)}),'COHERENT_BORDER_EXISTS');
  assert.equal(flow.inspectWorkflow(f.workflow).eventCount,count);assert.equal(flow.getGenerationResult(f.workflow,f.sourceSha).status,'rejected-technical');
});

test('prepared batch preserves existing received and unused authorized plans, and supports later source revision and another preparation',t=>{
  const f=setup(t),a=apply(f),before=flow.inspectWorkflow(f.workflow),batch=flow.adoptCoherentPreparedSource(f.workflow,f.batch.sha256,a.record.sha256,'prepared.batch');
  assert.equal(batch.format,'ai_scene_coherent_source_batch_v2');assert.equal(batch.newImageRequests,0);assert.equal(batch.maximumCalls,f.batch.maximumCalls-1);
  assert.deepEqual(batch.preparedPlanSha256s,[a.record.sha256]);assert.deepEqual(batch.planSha256s,f.batch.planSha256s.map(s=>s===f.sourceSha?a.record.sha256:s));
  assert.deepEqual(flow.inspectWorkflow(f.workflow).plans,before.plans);assert.equal(flow.getCoherentSourceBatch(f.workflow,batch.sha256).sha256,batch.sha256);
  rejects(()=>flow.adoptCoherentPreparedSource(f.workflow,batch.sha256,a.record.sha256,'wrong.parent'),'COHERENT_BORDER_BATCH');
  const next=f.batch.planSha256s[3];receive(f.workflow,next,tailPng());
  const revised=flow.reviseCoherentSources(f.workflow,batch.sha256,{batchId:'prepared.revision',replacements:[{assetId:flow.getGenerationPlan(f.workflow,next).recipe.assetId,planId:'new.platform'}]});
  assert.equal(revised.format,'ai_scene_coherent_source_batch_v2');assert.equal(revised.newImageRequests,1);assert(revised.planSha256s.includes(a.record.sha256));
  // A second independently approved preparation can also be adopted from v2.
  const p=flow.proposeCoherentBorderPreparation(f.workflow,next),record=flow.prepareCoherentBorderSource(f.workflow,{preparationId:'prepared.second',proposal:p.proposal,receipt:decision('second.source.accept',p.proposal.sha256)});
  const second=flow.adoptCoherentPreparedSource(f.workflow,batch.sha256,record.sha256,'second.prepared.batch');
  assert.equal(second.maximumCalls,f.batch.maximumCalls-2);assert.deepEqual(second.preparedPlanSha256s,[a.record.sha256,record.sha256]);
});

test('replay independently rejects a forged preparation and requires original pixels',t=>{
  const f=setup(t);apply(f);const events=join(f.workflow,'events'),path=join(events,readdirSync(events).sort().at(-1)),event=JSON.parse(readFileSync(path));
  const eventBody=unseal(event),recordBody=unseal(eventBody.record);
  const forged=seal({...recordBody,originalRawSha256:'f'.repeat(64)});
  writeFileSync(path,jsonBytes(seal({...eventBody,record:forged})));
  rejects(()=>flow.inspectWorkflow(f.workflow),'COHERENT_BORDER_REPLAY');
  const missing=setup(t);apply(missing);unlinkSync(join(missing.workflow,'blobs',hash(missing.raw)+'.bin'));
  rejects(()=>flow.inspectWorkflow(missing.workflow),'BLOB_MISSING');
});

test('combined preparation and adoption validates every identifier before writing blobs or events',t=>{
  const f=setup(t),p=flow.proposeCoherentBorderPreparation(f.workflow,f.sourceSha),before=flow.inspectWorkflow(f.workflow),blobs=readdirSync(join(f.workflow,'blobs')).sort();
  const options={preparationId:'combined.prepared',proposal:p.proposal,receipt:decision('combined.accept',p.proposal.sha256),parentBatchSha256:f.batch.sha256,batchId:'combined.batch'};
  rejects(()=>flow.prepareAndAdoptCoherentBorderSource(f.workflow,{...options,batchId:'INVALID/ID'}),'WORKFLOW_ID');
  rejects(()=>flow.prepareAndAdoptCoherentBorderSource(f.workflow,{...options,batchId:f.batch.batchId}),'REVISION_ID_EXISTS');
  rejects(()=>flow.prepareAndAdoptCoherentBorderSource(f.workflow,{...options,parentBatchSha256:'f'.repeat(64)}),'COHERENT_BORDER_BATCH');
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);assert.deepEqual(readdirSync(join(f.workflow,'blobs')).sort(),blobs);
  const {record,batch}=flow.prepareAndAdoptCoherentBorderSource(f.workflow,options);
  assert.equal(batch.format,'ai_scene_coherent_source_batch_v2');assert(batch.planSha256s.includes(record.sha256));
  const after=flow.inspectWorkflow(f.workflow);assert.equal(after.eventCount,before.eventCount+2);assert.equal(after.plans.find(p=>p.planSha256===f.sourceSha).status,'rejected-technical');
});

test('a visually rejected prepared asset can freeze a new v4 generation revision with fresh lineage and no inherited compute',t=>{
  const f=setup(t),a=apply(f),batch=flow.adoptCoherentPreparedSource(f.workflow,f.batch.sha256,a.record.sha256,'prepared.batch');
  flow.reviewResult(f.workflow,a.record.sha256,decision('prepared.art.reject',a.record.rawSha256,'reject'));
  const revised=flow.reviseCoherentSources(f.workflow,batch.sha256,{batchId:'prepared.asset.revision',replacements:[{assetId:a.record.recipe.assetId,planId:'landmark.new.v4'}]});
  const plan=flow.getGenerationPlan(f.workflow,revised.planSha256s[2]),status=flow.inspectWorkflow(f.workflow).plans.find(p=>p.planSha256===plan.sha256);
  assert.equal(plan.format,'ai_scene_generation_plan_v27');assert.equal(plan.recipe.intent,'isolated-layer-v4');assert.deepEqual(plan.recipe.parents,[a.record.sha256]);
  assert.equal(status.status,'planned');assert.equal(status.reserved,false);assert.equal(status.received,false);
  assert.equal(flow.getGenerationResult(f.workflow,f.sourceSha).status,'rejected-technical');assert.equal(flow.getGenerationResult(f.workflow,a.record.sha256).status,'rejected-visual');
});
