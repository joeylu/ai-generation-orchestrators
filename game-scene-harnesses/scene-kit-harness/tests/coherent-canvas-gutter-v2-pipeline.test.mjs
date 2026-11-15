import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as pipeline from '../src/coherent-pipeline.mjs';
import * as flow from '../src/generation/index.mjs';
import {inspectPng,encodeRgbaPng} from '../src/png.mjs';
import {hash} from '../src/generation/common.mjs';
import {coherentBrief,coherentAnalysis,sourcePng,referencePng} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';
import {createCoherentComposition} from '../src/coherent-composition.mjs';

const profile={profile:'low-alpha-margin-v2'};
const rejects=(f,code)=>assert.throws(f,e=>e.errors?.some(v=>!code||v.code===code));
const json=path=>JSON.parse(readFileSync(path,'utf8'));
const cwd=fileURLToPath(new URL('..',import.meta.url));
const cli=(...args)=>spawnSync(process.execPath,['scripts/coherent.mjs',...args],{cwd,encoding:'utf8',timeout:180000});
function lowAlphaSourcePng(){
  const width=320,height=256,rgba=Buffer.alloc(width*height*4);
  for(let y=32;y<230;y++)for(let x=2;x<318;x++)rgba.set([40+x%130,75+y%90,115,(x+y)%5?255:8],(y*width+x)*4);
  rgba.set([11,37,241,0],0);rgba.set([151,83,179,7],(125*width)*4);rgba.set([97,45,131,1],(126*width+1)*4);
  return encodeRgbaPng(width,height,rgba);
}
function smallSourcePng(alpha=false,seed=0){
  const width=320,height=256,rgba=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(!alpha||(x>=45&&x<275&&y>=40&&y<216))rgba.set([40+(x+seed)%130,75+(y+seed)%90,110+seed%30,255],(y*width+x)*4);
  return encodeRgbaPng(width,height,rgba);
}
async function failedSource(t){
  const parent=mkdtempSync(join(tmpdir(),'coherent-canvas-gutter-v2-'));t.after(()=>rmSync(parent,{recursive:true,force:true}));
  const root=join(parent,'project'),workflow=join(root,'workflow'),brief=coherentBrief('Synthetic low-alpha canvas preparation');
  let status=pipeline.initCoherentPipeline(root,brief,{purpose:'synthetic-simulation'});
  pipeline.reviewCoherentDesign(root,{spec:decision('design.spec',status.design.specSha256),style:decision('design.style',status.design.styleSha256)});
  status=pipeline.inspectCoherentPipeline(root);pipeline.authorizeCoherentStage(root,decision('reference.compute',status.reference.planSha256,'approve-compute'));
  await pipeline.runCoherentStage(root,{preflight:async()=>{},generate:async()=>referencePng()});
  status=pipeline.inspectCoherentPipeline(root);
  const analysis=coherentAnalysis({sha256:status.reference.planSha256},status.reference.rawSha256,brief.requirements);
  const packet=pipeline.prepareCoherentReferenceReview(root,analysis,join(parent,'reference-review'));
  pipeline.reviewCoherentReference(root,analysis,decision('reference.accept',packet.packetSha256));
  status=pipeline.inspectCoherentPipeline(root);pipeline.authorizeCoherentStage(root,decision('sources.compute',status.batchSha256,'approve-compute'));
  const raw=lowAlphaSourcePng();
  for(const [index,source]of status.sources.slice(0,3).entries()){
    const {request,...ticket}=flow.reservePlan(workflow,source.planSha256);flow.recordSubmission(workflow,ticket);
    const result=flow.receiveResult(workflow,ticket,index===2?raw:index===0?sourcePng(false,20):smallSourcePng(false,20));
    assert.equal(result.technical.status,index===2?'fail':'pass');
    if(index===2)assert.deepEqual(result.technical.issues,['COHERENT_CLIPPED_SILHOUETTE']);
  }
  status=pipeline.inspectCoherentPipeline(root);assert.equal(status.stage,'attention-required');
  const source=status.sources.find(s=>s.technicalStatus==='fail');assert(source);return {parent,root,workflow,raw,source,status};
}

test('v2 CLI review freezes exact read-only previews and rejects preview/receipt tampering atomically',{timeout:300000},async t=>{
  const f=await failedSource(t),out=join(f.parent,'canvas-review'),before=flow.inspectWorkflow(f.workflow),blobs=readdirSync(join(f.workflow,'blobs')).sort();
  rejects(()=>pipeline.exportCoherentCanvasGutterReview(f.root,f.source.planSha256,join(f.parent,'old-canvas')),'COHERENT_CANVAS_GUTTER_SOURCE');
  rejects(()=>pipeline.exportCoherentBorderReview(f.root,f.source.planSha256,join(f.parent,'old-border')),'COHERENT_BORDER_EDGE');
  const result=cli('canvas-review','--root',f.root,'--source',f.source.planSha256,'--out',out,'--profile',profile.profile);
  assert.equal(result.status,0,result.stderr);
  const review=JSON.parse(result.stdout),proposal=json(join(out,'proposal.json'));
  assert.equal(review.format,'ai_scene_coherent_canvas_gutter_review_v2');assert.equal(review.generationCalls,0);assert.equal(review.proposalSha256,proposal.sha256);
  assert.equal(pipeline.exportCoherentCanvasGutterReview(f.root,f.source.planSha256,out,profile).bundleSha256,review.bundleSha256);
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);assert.deepEqual(readdirSync(join(f.workflow,'blobs')).sort(),blobs);
  assert.deepEqual(readFileSync(join(out,'source-original.png')),f.raw);
  const native=inspectPng(f.raw,{includePixels:true,allowHiddenRgb:true}),previewBytes=readFileSync(join(out,'preview-padded.png'));
  const padded=inspectPng(previewBytes,{includePixels:true,allowHiddenRgb:true}),{x:dx,y:dy}=proposal.contentOffset;
  for(let y=0;y<native.height;y++)assert.deepEqual(padded.rgba.subarray(((y+dy)*padded.width+dx)*4,((y+dy)*padded.width+dx+native.width)*4),native.rgba.subarray(y*native.width*4,(y+1)*native.width*4));
  for(const name of ['preview-original-checkerboard.png','preview-padded-checkerboard.png'])assert.equal(inspectPng(readFileSync(join(out,name)),{pixelStats:true}).transparentPixels,0);
  const options={preparationId:'canvas.prepared',batchId:'canvas.prepared.batch'};
  rejects(()=>pipeline.applyCoherentCanvasGutterReview(f.root,out,decision('wrong','f'.repeat(64)),options),'COHERENT_CANVAS_GUTTER_APPROVAL_REQUIRED');
  rejects(()=>pipeline.applyCoherentCanvasGutterReview(f.root,out,decision('bundle.not.proposal',review.bundleSha256),options),'COHERENT_CANVAS_GUTTER_APPROVAL_REQUIRED');
  writeFileSync(join(out,'preview-padded.png'),Buffer.from('changed reviewed preview'));
  rejects(()=>pipeline.applyCoherentCanvasGutterReview(f.root,out,decision('altered.preview',proposal.sha256),options),'PROOF_BUNDLE_RECOMPILE_MISMATCH');
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);assert.deepEqual(readdirSync(join(f.workflow,'blobs')).sort(),blobs);
  writeFileSync(join(out,'preview-padded.png'),previewBytes);
  const applied=pipeline.applyCoherentCanvasGutterReview(f.root,out,decision('exact.preview.accept',proposal.sha256),options);
  assert.equal(applied.stage,'ready-to-generate-sources');assert.equal(flow.inspectWorkflow(f.workflow).eventCount,before.eventCount+2);
});

test('v2 partial adoption replays, preserves failed history and unused authorization, and exports native assembly evidence',{timeout:360000},async t=>{
  const f=await failedSource(t),out=join(f.parent,'canvas-review'),before=flow.inspectWorkflow(f.workflow);
  const originalPlan=flow.getGenerationPlan(f.workflow,f.source.planSha256),originalResult=flow.getGenerationResult(f.workflow,f.source.planSha256);
  const review=pipeline.exportCoherentCanvasGutterReview(f.root,f.source.planSha256,out,profile);
  const remaining=before.plans.filter(p=>p.stage==='coherent-source'&&p.status==='authorized');assert.equal(remaining.length,3);
  const receipt=decision('canvas.preview.accept',review.proposalSha256),proposal=json(join(out,'proposal.json'));
  const preparation=flow.prepareCoherentCanvasGutterSource(f.workflow,{preparationId:'canvas.prepared',proposal,receipt});
  assert.equal(preparation.format,'ai_scene_coherent_canvas_gutter_preparation_v2');
  const partialEventCount=flow.inspectWorkflow(f.workflow).eventCount;
  const applied=pipeline.applyCoherentCanvasGutterReview(f.root,out,receipt,{preparationId:'canvas.prepared',batchId:'canvas.prepared.batch'});
  const reboundEvidence=flow.exportCoherentRebindEvidence(f.workflow,preparation.sha256);
  assert.equal(reboundEvidence.evidence.rawSha256,preparation.rawSha256);
  assert.equal(hash(reboundEvidence.bytes),preparation.rawSha256);
  assert.equal(flow.inspectWorkflow(f.workflow).eventCount,partialEventCount+1);assert.equal(applied.remainingSourceCalls,3);assert.equal(applied.maximumSourceCalls,5);
  const after=flow.inspectWorkflow(f.workflow),original=after.plans.find(p=>p.planSha256===f.source.planSha256);
  const repeat=pipeline.applyCoherentCanvasGutterReview(f.root,out,receipt,{preparationId:'canvas.prepared',batchId:'canvas.prepared.batch'});
  assert.equal(repeat.reusedVerifiedPreparation,true);assert.deepEqual(flow.inspectWorkflow(f.workflow),after);
  assert.equal(original.status,'rejected-technical');assert.equal(original.rawSha256,hash(f.raw));assert.equal(original.technicalStatus,'fail');
  assert.deepEqual(flow.getGenerationPlan(f.workflow,f.source.planSha256),originalPlan);assert.deepEqual(flow.getGenerationResult(f.workflow,f.source.planSha256),originalResult);
  for(const p of before.plans.filter(p=>p.planSha256!==f.source.planSha256))assert.deepEqual(after.plans.find(n=>n.planSha256===p.planSha256),p);
  const batch=flow.getCoherentSourceBatch(f.workflow,applied.batchSha256),parentBatch=flow.getCoherentSourceBatch(f.workflow,f.status.batchSha256);
  assert.deepEqual(batch.planSha256s,parentBatch.planSha256s.map(sha=>sha===f.source.planSha256?preparation.sha256:sha));
  const prep=after.plans.find(p=>p.planSha256===applied.preparationSha256);
  assert.equal(prep.maximumCalls,0);assert.equal(prep.received,true);assert.equal(prep.reserved,false);assert.equal(prep.status,'pending-visual-review');
  rejects(()=>flow.reservePlan(f.workflow,prep.planSha256));
  rejects(()=>flow.authorizePlan(f.workflow,prep.planSha256,decision('illegal.prepared.compute',prep.planSha256,'approve-compute')));
  assert.deepEqual(flow.inspectWorkflow(f.workflow),after);
  const preparedResult=flow.getGenerationResult(f.workflow,prep.planSha256);
  assert.equal(flow.recheckResult(f.workflow,prep.planSha256,preparedResult.result.rawSha256).status,'pass');
  const view=flow.readCoherentWorkflowView(f.workflow,{includeCurrentInputs:true});
  assert(view.plans.some(p=>p.sha256===preparation.sha256&&p.format==='ai_scene_coherent_canvas_gutter_preparation_v2'));assert(view.inputs.size>0);
  const snapshot=pipeline.coherentComputeSnapshot(f.root);
  assert.equal(snapshot.format,'ai_scene_coherent_compute_snapshot_v2');assert.equal(snapshot.preparedSources.length,1);
  assert.equal(snapshot.preparedSources[0].request.maximumCalls,0);assert.equal(snapshot.maximumCalls,5);assert.equal(snapshot.remainingCalls,3);
  assert.equal(snapshot.authorizationUsage,'existing-unsubmitted-authorizations-only');assert.deepEqual(snapshot.newAuthorizationRequiredPlanSha256s,[]);
  assert.deepEqual(snapshot.unusedAuthorizationPlanSha256s,remaining.map(p=>p.planSha256));
  pipeline.exportCoherentComputeReview(f.root,join(f.parent,'remaining-compute-review'));
  assert.equal(json(join(f.parent,'remaining-compute-review/prepared-source-1.json')).format,'ai_scene_coherent_canvas_gutter_preparation_v2');
  let calls=0;const generated=[];
  const complete=await pipeline.runCoherentStage(f.root,{preflight:async()=>{},generate:async i=>{calls++;generated.push(i.planSha256);return smallSourcePng(true,30+calls);}});
  assert.equal(complete.stage,'ready-to-deliver');assert.equal(calls,3);assert.deepEqual(generated,remaining.map(p=>p.planSha256));
  const composition=createCoherentComposition(flow.getCoherentSourceBatch(f.workflow,complete.batchSha256),flow.getReferenceReconstructionTarget(f.workflow,complete.reference.planSha256));
  const delivery=join(f.parent,'delivery'),report=pipeline.deliverCoherentPipeline(f.root,delivery,{composition});
  assert.equal(report.finalHumanArtReview,'pending');assert.equal(pipeline.verifyCoherentDelivery(f.root,delivery).status,'verified');
  const ready=json(join(delivery,'candidate/readiness.json')),row=ready.sourceEvidence.find(s=>s.preparationSha256===applied.preparationSha256);
  assert(row);assert.equal(row.originalTechnicalStatus,'fail');assert.equal(row.preparedTechnicalStatus,'pass');assert.equal(row.maximumNewImageCalls,0);
  assert.equal(row.artAcceptance,'not-assessed');assert.equal(ready.artAcceptance,'not-assessed');assert.equal(row.originalRawSha256,hash(f.raw));
  assert.deepEqual(readFileSync(join(delivery,'candidate/source/original/'+row.assetId+'.png')),f.raw);
  assert.equal(json(join(delivery,'candidate/evidence/'+row.assetId+'-original-result.json')).technical.status,'fail');
  assert.deepEqual(flow.getGenerationResult(f.workflow,f.source.planSha256).bytes,f.raw);
  const prepBlob=join(f.workflow,'blobs',preparation.rawSha256+'.bin');
  writeFileSync(prepBlob,Buffer.from('altered prepared source'));
  rejects(()=>flow.inspectWorkflow(f.workflow));writeFileSync(prepBlob,preparedResult.bytes);
  assert.equal(pipeline.verifyCoherentDelivery(f.root,delivery).status,'verified');
  writeFileSync(join(delivery,'candidate/source/original/'+row.assetId+'.png'),Buffer.from('changed native evidence'));
  rejects(()=>pipeline.verifyCoherentDelivery(f.root,delivery),'PROOF_BUNDLE_RECOMPILE_MISMATCH');
});
