import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as pipeline from '../src/coherent-pipeline.mjs';
import * as flow from '../src/generation/index.mjs';
import {inspectPng,encodeRgbaPng} from '../src/png.mjs';
import {hash,jsonBytes} from '../src/generation/common.mjs';
import {coherentBrief,coherentAnalysis,sourcePng,referencePng} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';
import {createCoherentComposition} from '../src/coherent-composition.mjs';

const rejects=(f,code)=>assert.throws(f,e=>e.errors?.some(v=>v.code===code));
function tailPng(){const image=inspectPng(sourcePng(true,9),{includePixels:true});
  image.rgba.set([211,87,119,0],0);
  image.rgba.set([161,73,119,3],(200*image.width+image.width-1)*4);
  image.rgba.set([161,73,119,2],(201*image.width+image.width-2)*4);
  return encodeRgbaPng(image.width,image.height,image.rgba);
}
async function failedSource(t){
  const parent=mkdtempSync(join(tmpdir(),'coherent-border-pipeline-'));t.after(()=>rmSync(parent,{recursive:true,force:true}));
  const root=join(parent,'project'),workflow=join(root,'workflow'),brief=coherentBrief('Synthetic autumn watermill');
  let status=pipeline.initCoherentPipeline(root,brief,{purpose:'synthetic-simulation'});
  pipeline.reviewCoherentDesign(root,{spec:decision('design.spec',status.design.specSha256),style:decision('design.style',status.design.styleSha256)});
  status=pipeline.inspectCoherentPipeline(root);pipeline.authorizeCoherentStage(root,decision('reference.compute',status.reference.planSha256,'approve-compute'));
  await pipeline.runCoherentStage(root,{preflight:async()=>{},generate:async()=>referencePng()});
  status=pipeline.inspectCoherentPipeline(root);
  const analysis=coherentAnalysis({sha256:status.reference.planSha256},status.reference.rawSha256,brief.requirements);
  const packet=pipeline.prepareCoherentReferenceReview(root,analysis,join(parent,'reference-review'));
  pipeline.reviewCoherentReference(root,analysis,decision('reference.accept',packet.packetSha256));
  status=pipeline.inspectCoherentPipeline(root);pipeline.authorizeCoherentStage(root,decision('sources.compute',status.batchSha256,'approve-compute'));
  const raw=tailPng();let calls=0;
  await pipeline.runCoherentStage(root,{preflight:async()=>{},generate:async()=>++calls===3?raw:sourcePng(false,20)});
  status=pipeline.inspectCoherentPipeline(root);assert.equal(status.stage,'attention-required');assert.equal(calls,3);
  const source=status.sources.find(s=>s.technicalStatus==='fail');assert(source);
  return {parent,root,workflow,raw,source,status};
}

test('exact border preview is read-only and rejects wrong approval or altered PNG before workflow changes',{timeout:240000},async t=>{
  const f=await failedSource(t),out=join(f.parent,'border-review'),before=flow.inspectWorkflow(f.workflow);
  const review=pipeline.exportCoherentBorderReview(f.root,f.source.planSha256,out);
  assert.equal(review.generationCalls,0);assert.equal(review.proposalSha256,JSON.parse(readFileSync(join(out,'proposal.json'))).sha256);
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
  assert.equal(pipeline.exportCoherentBorderReview(f.root,f.source.planSha256,out).bundleSha256,review.bundleSha256);
  assert.deepEqual(readFileSync(join(out,'source-original.png')),f.raw);
  const original=inspectPng(f.raw,{includePixels:true,allowHiddenRgb:true}),previewBytes=readFileSync(join(out,'preview-padded.png')),
    preview=inspectPng(previewBytes,{includePixels:true,allowHiddenRgb:true});
  assert.equal(preview.width,original.width+4);assert.equal(preview.height,original.height+4);
  for(let y=0;y<original.height;y++)assert.deepEqual(preview.rgba.subarray(((y+2)*preview.width+2)*4,((y+2)*preview.width+2+original.width)*4),original.rgba.subarray(y*original.width*4,(y+1)*original.width*4));
  rejects(()=>pipeline.applyCoherentBorderReview(f.root,out,decision('wrong','f'.repeat(64)),{preparationId:'prepared.source',batchId:'prepared.batch'}),'COHERENT_BORDER_APPROVAL_REQUIRED');
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
  rejects(()=>pipeline.applyCoherentBorderReview(f.root,out,decision('invalid.batch',review.proposalSha256),{preparationId:'prepared.source',batchId:'INVALID'}),'WORKFLOW_ID');
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
  const originalBatch=flow.getCoherentSourceBatch(f.workflow,f.status.batchSha256);
  rejects(()=>pipeline.applyCoherentBorderReview(f.root,out,decision('duplicate.batch',review.proposalSha256),{preparationId:'prepared.source',batchId:originalBatch.batchId}),'COHERENT_BORDER_RESUME_MISMATCH');
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
  writeFileSync(join(out,'preview-padded.png'),Buffer.from('changed preview'));
  rejects(()=>pipeline.applyCoherentBorderReview(f.root,out,decision('accept',review.proposalSha256),{preparationId:'prepared.source',batchId:'prepared.batch'}),'PROOF_BUNDLE_RECOMPILE_MISMATCH');
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
  writeFileSync(join(out,'preview-padded.png'),previewBytes);
  assert.equal(pipeline.exportCoherentBorderReview(f.root,f.source.planSha256,out).bundleSha256,review.bundleSha256);
  const applied=pipeline.applyCoherentBorderReview(f.root,out,decision('accept.atomic',review.proposalSha256),{preparationId:'prepared.atomic',batchId:'prepared.atomic.batch'});
  assert.equal(applied.stage,'ready-to-generate-sources');assert.equal(flow.inspectWorkflow(f.workflow).eventCount,before.eventCount+2);
});

test('approved preparation resumes only original unused plans and delivers separate original-failure/prepared evidence',{timeout:300000},async t=>{
  const f=await failedSource(t),out=join(f.parent,'border-review'),before=flow.inspectWorkflow(f.workflow),review=pipeline.exportCoherentBorderReview(f.root,f.source.planSha256,out);
  const remaining=before.plans.filter(p=>p.stage==='coherent-source'&&p.status==='authorized');assert.equal(remaining.length,3);
  const receipt=decision('border.accept',review.proposalSha256),proposal=JSON.parse(readFileSync(join(out,'proposal.json')));
  flow.prepareCoherentBorderSource(f.workflow,{preparationId:'prepared.source',proposal,receipt});
  const partialEventCount=flow.inspectWorkflow(f.workflow).eventCount;
  const applied=pipeline.applyCoherentBorderReview(f.root,out,receipt,{preparationId:'prepared.source',batchId:'prepared.batch'});
  assert.equal(flow.inspectWorkflow(f.workflow).eventCount,partialEventCount+1,'resume only appends the adoption, not a second preparation');
  assert.equal(applied.stage,'ready-to-generate-sources');assert.equal(applied.remainingSourceCalls,3);assert.equal(applied.sources.length,6);assert.equal(applied.maximumSourceCalls,5);
  const after=flow.inspectWorkflow(f.workflow),old=after.plans.find(p=>p.planSha256===f.source.planSha256);
  const repeat=pipeline.applyCoherentBorderReview(f.root,out,receipt,{preparationId:'prepared.source',batchId:'prepared.batch'});
  assert.equal(repeat.reusedVerifiedPreparation,true);assert.deepEqual(flow.inspectWorkflow(f.workflow),after);
  assert.equal(old.status,'rejected-technical');assert.equal(old.rawSha256,hash(f.raw));
  for(const p of remaining)assert.deepEqual(after.plans.find(n=>n.planSha256===p.planSha256),p);
  const prep=after.plans.find(p=>p.planSha256===applied.preparationSha256);assert.equal(prep.maximumCalls,0);assert.equal(prep.received,true);assert.equal(prep.reserved,false);
  const snapshot=pipeline.coherentComputeSnapshot(f.root);assert.equal(snapshot.format,'ai_scene_coherent_compute_snapshot_v2');assert.equal(snapshot.preparedSources.length,1);
  assert.equal(snapshot.preparedSources[0].request.maximumCalls,0);assert.equal(snapshot.maximumCalls,5);assert.equal(snapshot.remainingCalls,3);
  assert.equal(snapshot.authorizationUsage,'existing-unsubmitted-authorizations-only');assert.deepEqual(snapshot.newAuthorizationRequiredPlanSha256s,[]);
  assert.deepEqual(snapshot.unusedAuthorizationPlanSha256s,remaining.map(p=>p.planSha256));
  pipeline.exportCoherentComputeReview(f.root,join(f.parent,'remaining-compute-review'));
  assert.equal(JSON.parse(readFileSync(join(f.parent,'remaining-compute-review/prepared-source-1.json'))).request.maximumCalls,0);
  let calls=0;const generated=[];
  const complete=await pipeline.runCoherentStage(f.root,{preflight:async()=>{},generate:async i=>{calls++;generated.push(i.planSha256);return sourcePng(true,30+calls);}});
  assert.equal(complete.stage,'ready-to-deliver');assert.equal(calls,3);assert.deepEqual(generated,remaining.map(p=>p.planSha256));
  const composition=createCoherentComposition(flow.getCoherentSourceBatch(f.workflow,complete.batchSha256),flow.getReferenceReconstructionTarget(f.workflow,complete.reference.planSha256));
  const delivery=join(f.parent,'delivery'),report=pipeline.deliverCoherentPipeline(f.root,delivery,{composition});
  assert.equal(report.finalHumanArtReview,'pending');assert.equal(pipeline.verifyCoherentDelivery(f.root,delivery).status,'verified');
  const ready=JSON.parse(readFileSync(join(delivery,'candidate/readiness.json'))),row=ready.sourceEvidence.find(s=>s.preparationSha256===applied.preparationSha256);
  assert(row);assert.equal(row.originalTechnicalStatus,'fail');assert.equal(row.preparedTechnicalStatus,'pass');assert.equal(row.maximumNewImageCalls,0);
  assert.equal(row.originalRawSha256,hash(f.raw));assert.equal(ready.sourcePreparations.originalPngsAndFailuresPreserved,true);
  assert.deepEqual(readFileSync(join(delivery,'candidate/source/original/'+row.assetId+'.png')),f.raw);
  assert.equal(JSON.parse(readFileSync(join(delivery,'candidate/evidence/'+row.assetId+'-original-result.json'))).technical.status,'fail');
  const failedNow=flow.inspectWorkflow(f.workflow).plans.find(p=>p.planSha256===f.source.planSha256);assert.equal(failedNow.status,'rejected-technical');
  const preserved=join(delivery,'candidate/source/original/'+row.assetId+'.png');writeFileSync(preserved,Buffer.from('altered original evidence'));
  rejects(()=>pipeline.verifyCoherentDelivery(f.root,delivery),'PROOF_BUNDLE_RECOMPILE_MISMATCH');
  const revised=pipeline.reviseCoherentStage(f.root,{batchId:'prepared.revision',replacements:[{assetId:'front.left',planId:'front.left.revised',intent:'isolated-layer-v4'}]});
  assert.equal(revised.stage,'awaiting-source-compute');
  const nextSnapshot=pipeline.coherentComputeSnapshot(f.root);
  assert.equal(nextSnapshot.authorizationUsage,'new-digest-bound-authorization-required');assert.equal(nextSnapshot.newAuthorizationRequiredPlanSha256s.length,1);
  assert.equal(nextSnapshot.preparedSources.length,1);assert.equal(nextSnapshot.remainingCalls,1);assert.deepEqual(nextSnapshot.unusedAuthorizationPlanSha256s,[]);
  await assert.rejects(pipeline.runCoherentStage(f.root,{preflight:async()=>{},generate:async()=>{calls++;return sourcePng(true);}}));
  assert.equal(calls,3,'a new plan never borrows an already used authorization');
});

test('CLI lists explicit zero-generation review/apply commands and rejects incomplete application',()=>{
  const cwd=fileURLToPath(new URL('..',import.meta.url));
  const help=spawnSync(process.execPath,['scripts/coherent.mjs','--help'],{cwd,encoding:'utf8'});assert.equal(help.status,0);
  assert.match(help.stdout,/border-review --root PROJECT --source PLAN_SHA256/);assert.match(help.stdout,/border-apply/);
  const bad=spawnSync(process.execPath,['scripts/coherent.mjs','border-apply','--root','missing','--review','missing'],{cwd,encoding:'utf8'});
  assert.equal(bad.status,1);assert.equal(JSON.parse(bad.stderr).code,'COHERENT_ARGUMENTS');
});
