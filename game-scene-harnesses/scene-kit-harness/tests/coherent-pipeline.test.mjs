import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import * as pipeline from '../src/coherent-pipeline.mjs';
import * as flow from '../src/generation/index.mjs';
import {coherentBrief,coherentAnalysis,sourcePng,referencePng,coherentSurfaceObservations} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';
import {hash,jsonBytes} from '../src/generation/common.mjs';
const rejects=(f,code)=>assert.throws(f,e=>e.errors?.some(v=>v.code===code));
function setup(t,theme){const parent=mkdtempSync(join(tmpdir(),'coherent-pipeline-'));t.after(()=>rmSync(parent,{recursive:true,force:true}));const root=join(parent,'project');
  pipeline.initCoherentPipeline(root,coherentBrief(theme),{purpose:'synthetic-simulation'});return {root,parent,workflow:join(root,'workflow')};}
function operator(calls){return {reviewDesign:async s=>({spec:decision('spec',s.design.specSha256),style:decision('style',s.design.styleSha256)}),
  approveCompute:async s=>{calls.push(s);return decision('compute.'+calls.length,s.targetSha256,'approve-compute');},
  reviewReference:async a=>decision('reference.art',a.packet.packetSha256),calibrateSurface:async()=>({observations:coherentSurfaceObservations()})};}
function adapter(calls){return {preflight:async()=>{},generate:async i=>{calls.push(i);assert(i.images.length>0);for(const image of i.images)assert.equal(hash(image.bytes),image.artifact.sha256);
  return i.request.task==='reference'?referencePng():sourcePng(i.request.output.alpha==='transparent',i.request.output.alpha==='opaque'?17:27);}};}
const planner=()=>({analyze:async({request})=>coherentAnalysis({sha256:request.planSha256},request.rawSha256,request.requirements)});
async function pendingReference(f){let s=pipeline.inspectCoherentPipeline(f.root);pipeline.reviewCoherentDesign(f.root,{spec:decision('spec',s.design.specSha256),style:decision('style',s.design.styleSha256)});
  s=pipeline.inspectCoherentPipeline(f.root);pipeline.authorizeCoherentStage(f.root,decision('ref.compute',s.reference.planSha256,'approve-compute'));
  await pipeline.runCoherentStage(f.root,adapter([]));return pipeline.inspectCoherentPipeline(f.root);}
test('fresh generic project drives design/reference/planner/source batch/delivery with only two exact compute decisions',{timeout:240000},async t=>{
  const f=setup(t,'Warm desert sandstone citadel'),calls=[],approvals=[];
  const result=await pipeline.driveCoherentPipeline(f.root,{imageAdapter:adapter(calls),planner:planner(),operator:operator(approvals),delivery:join(f.parent,'delivery')});
  assert.equal(result.stage,'ready-to-deliver');assert.equal(calls.length,7);assert.equal(approvals.length,2);assert.equal(approvals[0].plans.length,1);assert.equal(approvals[1].plans.length,6);
  assert(approvals[1].plans.every(p=>p.recipe.intent==='isolated-layer-v4'&&p.sourceScope.sceneCoordinatesInPrompt===false));
  assert.equal(calls[0].images.length,2);assert(calls[0].request.prompt.includes('NOT literal snow'));assert(calls.slice(1).every(c=>c.images.length===1));
  assert.equal(result.delivery.finalHumanArtReview,'pending');assert.equal(result.delivery.productionKit,false);
  const verified=pipeline.verifyCoherentDelivery(f.root,join(f.parent,'delivery'));assert.equal(verified.status,'verified');
  assert.equal(pipeline.inspectCoherentPipeline(f.root).finalReviewPolicy,undefined);
  const legacyReview=pipeline.reviewCoherentDelivery(f.root,join(f.parent,'delivery'),decision('legacy.art',result.delivery.sha256));
  assert.equal(legacyReview.finalReviewPolicy,undefined);
  const readiness=JSON.parse(readFileSync(join(f.parent,'delivery/candidate/readiness.json')));assert(readiness.sourceEvidence.every(s=>s.parentRole&&s.scopeSha256&&s.semanticIsolation==='not-assessed'));
  assert.equal(readiness.sourceSampling,'display-density-2x-v1');
  assert.equal(JSON.parse(readFileSync(join(f.parent,'delivery/composition-profile.json'))).format,'ai_scene_coherent_composition_v4');
  const oldCalls=calls.length;await pipeline.driveCoherentPipeline(f.root,{imageAdapter:adapter(calls),planner:planner(),operator:operator(approvals),delivery:join(f.parent,'delivery')});assert.equal(calls.length,oldCalls);
  const image=join(f.parent,'delivery/reference-vs-reconstruction.png');assert(existsSync(image));writeFileSync(image,referencePng());
  rejects(()=>pipeline.verifyCoherentDelivery(f.root,join(f.parent,'delivery')),'COHERENT_DELIVERY_RENDER');
});
test('one analysis ID reuses a verified successful result and never re-invokes a planner after unknown outcome',async t=>{
  const f=setup(t);await pendingReference(f);let calls=0;
  const p={analyze:async input=>{calls++;return planner().analyze(input);}};
  const a=await pipeline.analyzeCoherentReference(f.root,'first',p),b=await pipeline.analyzeCoherentReference(f.root,'first',p);
  assert(a.analysis);assert.equal(b.reusedVerifiedAnalysis,true);assert.equal(calls,1);
  let unknown=0;const bad={analyze:async()=>{unknown++;throw Error('synthetic lost analysis');}};
  assert.equal((await pipeline.analyzeCoherentReference(f.root,'unknown',bad)).status,'analysis-attention-required');
  assert.equal((await pipeline.analyzeCoherentReference(f.root,'unknown',bad)).status,'analysis-attention-required');assert.equal(unknown,1);
  assert.equal(pipeline.inspectCoherentPipeline(f.root).stage,'awaiting-reference-review');
});
test('external session exchange preserves one reservation, exact prompt/images, native PNG and repeat reception identity',async t=>{
  const f=setup(t);let s=pipeline.inspectCoherentPipeline(f.root);pipeline.reviewCoherentDesign(f.root,{spec:decision('spec',s.design.specSha256),style:decision('style',s.design.styleSha256)});
  const out=join(f.parent,'exchange');rejects(()=>pipeline.reserveCoherentExchange(f.root,out),'PIPELINE_NOT_AUTHORIZED');
  s=pipeline.inspectCoherentPipeline(f.root);pipeline.authorizeCoherentStage(f.root,decision('compute',s.reference.planSha256,'approve-compute'));
  const exchange=pipeline.reserveCoherentExchange(f.root,out);assert.equal(exchange.maximumCalls,1);assert.equal(exchange.inputs.length,2);
  assert.equal(flow.inspectWorkflow(f.workflow).plans[0].status,'submitted');const file=join(f.parent,'native.png');writeFileSync(file,referencePng());
  pipeline.receiveCoherentExchange(f.root,out,file);const before=flow.inspectWorkflow(f.workflow).eventCount;
  pipeline.receiveCoherentExchange(f.root,out,file);assert.equal(flow.inspectWorkflow(f.workflow).eventCount,before);
  assert.deepEqual(readFileSync(join(out,'source-native.png')),referencePng());writeFileSync(file,sourcePng());
  rejects(()=>pipeline.receiveCoherentExchange(f.root,out,file),'COHERENT_EXCHANGE_RESULT');
});
test('source failure stops the unified runner and never retries or borrows old sources',async t=>{
  const f=setup(t),calls=[];let count=0;
  const double=adapter(calls);const imageAdapter={preflight:double.preflight,generate:async input=>{count++;if(count===3)throw Error('synthetic unknown source');return double.generate(input);}};
  const result=await pipeline.driveCoherentPipeline(f.root,{imageAdapter,planner:planner(),operator:operator([])});
  assert.equal(result.stage,'attention-required');assert.equal(result.sources[1].status,'indeterminate');
  await assert.rejects(pipeline.runCoherentStage(f.root,imageAdapter));assert.equal(count,3);assert(!existsSync(join(f.root,'delivery')));
});
test('compute review is idempotent/read-only, replays all inputs and refuses altered review files',t=>{
  const f=setup(t);let s=pipeline.inspectCoherentPipeline(f.root);pipeline.reviewCoherentDesign(f.root,{spec:decision('spec',s.design.specSha256),style:decision('style',s.design.styleSha256)});
  const out=join(f.parent,'compute-review'),before=flow.inspectWorkflow(f.workflow);
  const first=pipeline.exportCoherentComputeReview(f.root,out),second=pipeline.exportCoherentComputeReview(f.root,out);assert.equal(first.sha256,second.sha256);
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);writeFileSync(join(out,'prompt-1.txt'),'changed prompt');
  rejects(()=>pipeline.exportCoherentComputeReview(f.root,out),'PROOF_BUNDLE_RECOMPILE_MISMATCH');
});
test('the coherent CLI exposes a single driver and rejects implicit yes/unsupported commands without touching workflows',()=>{
  const root=fileURLToPath(new URL('..',import.meta.url)),help=spawnSync(process.execPath,['scripts/coherent.mjs','--help'],{cwd:root,encoding:'utf8'});
  assert.equal(help.status,0);assert.match(help.stdout,/continue --root/);assert.match(help.stdout,/capture/);
  for(const args of [['advance','--root','absent','--yes','true'],['capture','--root','absent'],['arbitrary-run','--root','absent']]){
    const p=spawnSync(process.execPath,['scripts/coherent.mjs',...args],{cwd:root,encoding:'utf8'});assert.equal(p.status,1);assert.equal(JSON.parse(p.stderr).code,'COHERENT_ARGUMENTS');}
});
