import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import * as pipeline from '../src/coherent-pipeline.mjs';
import * as flow from '../src/generation/index.mjs';
import {hash} from '../src/generation/common.mjs';
import {coherentBrief,coherentAnalysis,referencePng,sourcePng} from './helpers/coherent.mjs';
import {receiveEdgeFixture} from './helpers/terrain-edge-delivery.mjs';
import {decision} from './helpers/generation.mjs';
const cli=fileURLToPath(new URL('../scripts/coherent.mjs',import.meta.url));
const dep=sha=>({format:'ai_scene_source_dependency_v1',sourcePlanSha256:sha,placement:{x:10,y:20,scale:{numerator:1,denominator:2}},observations:[{observationId:'bridge.end',native:{x:200,y:200}}]});
function fixture(t,sourceReview='accept',targetState='planned'){
 const parent=mkdtempSync(join(tmpdir(),'scene-dependency-stage-'));t.after(()=>rmSync(parent,{recursive:true,force:true}));const root=join(parent,'project'),workflow=join(root,'workflow'),brief=coherentBrief('Stage dependency synthetic');
 const initial=pipeline.initCoherentPipeline(root,brief,{purpose:'synthetic-simulation'});pipeline.reviewCoherentDesign(root,{spec:decision('stage.spec',initial.design.specSha256),style:decision('stage.style',initial.design.styleSha256)});
 const s=pipeline.inspectCoherentPipeline(root),reference=flow.getGenerationPlan(workflow,s.reference.planSha256);pipeline.authorizeCoherentStage(root,decision('stage.reference.compute',reference.sha256,'approve-compute'));
 const {request,...ticket}=flow.reservePlan(workflow,reference.sha256);flow.recordSubmission(workflow,ticket);const raw=referencePng();flow.receiveResult(workflow,ticket,raw);
 const analysis=coherentAnalysis(reference,hash(raw),brief.requirements),packet=pipeline.prepareCoherentReferenceReview(root,analysis,join(parent,'ref-review'));
 const state=pipeline.reviewCoherentReference(root,analysis,decision('stage.reference.accept',packet.packetSha256)),batch=flow.getCoherentSourceBatch(workflow,state.batchSha256),plans=batch.planSha256s.map(s=>flow.getGenerationPlan(workflow,s)),bridge=plans.find(p=>p.recipe.assetId==='landmark.actual'),target=plans.find(p=>p.recipe.assetId==='front.left');
 flow.authorizePlan(workflow,bridge.sha256,decision('stage.bridge.compute',bridge.sha256,'approve-compute'));const png=sourcePng(true,39);receiveEdgeFixture(workflow,bridge.sha256,png);
 if(sourceReview!=='pending')flow.reviewResult(workflow,bridge.sha256,decision('stage.bridge.review',hash(png),sourceReview));
 if(targetState!=='planned'){flow.authorizePlan(workflow,target.sha256,decision('stage.target.compute',target.sha256,'approve-compute'));if(targetState!=='authorized'){
   const {request,...tkt}=flow.reservePlan(workflow,target.sha256);if(targetState==='unknown'){flow.recordSubmission(workflow,tkt);flow.stopAttempt(workflow,tkt,'indeterminate');}}}
 const options={batchId:'stage.new',expectedBatchSha256:batch.sha256,allowUnsubmittedDependency:true,replacements:[{assetId:'front.left',planId:'stage.new.front',intent:'isolated-layer-v4',sourceDependency:dep(bridge.sha256)}]};
 return {parent,root,workflow,batch,bridge,target,png,options};
}
test('CLI allows an explicitly opted-in planned dependency revision while others remain unfinished',{timeout:120000},t=>{
 const f=fixture(t),initial=flow.inspectWorkflow(f.workflow);assert.equal(initial.plans.find(x=>x.planSha256===f.target.sha256).status,'planned');
 const input=join(f.parent,'options.json');writeFileSync(input,JSON.stringify(f.options));const call=spawnSync(process.execPath,[cli,'revise','--root',f.root,'--options',input],{encoding:'utf8'});assert.equal(call.status,0,call.stderr);
 const status=JSON.parse(call.stdout);assert.notEqual(status.batchSha256,f.batch.sha256);const batch=flow.getCoherentSourceBatch(f.workflow,status.batchSha256),newSha=batch.planSha256s.find(s=>!f.batch.planSha256s.includes(s)),newPlan=flow.getGenerationPlan(f.workflow,newSha);
 assert.equal(newPlan.recipe.sourceDependency.sourcePlanSha256,f.bridge.sha256);assert.deepEqual(flow.readGenerationInput(f.workflow,newSha,1),f.png);assert.throws(()=>flow.reservePlan(f.workflow,newSha));
 const before=flow.inspectWorkflow(f.workflow);assert.equal(before.plans.find(x=>x.planSha256===f.target.sha256).status,'planned');assert.equal(before.plans.find(x=>x.planSha256===newSha).status,'planned');
 flow.authorizePlan(f.workflow,newSha,decision('stage.new.compute',newSha,'approve-compute'));assert.equal(flow.reservePlan(f.workflow,newSha).planSha256,newSha);assert.throws(()=>flow.reservePlan(f.workflow,newSha));
});
test('API rejects absent opt-in, wrong batch, or ordinary revisions without mutation',{timeout:120000},t=>{
 const f=fixture(t),before=flow.inspectWorkflow(f.workflow),noOpt={...f.options};delete noOpt.allowUnsubmittedDependency;delete noOpt.expectedBatchSha256;
 assert.throws(()=>pipeline.reviseCoherentStage(f.root,noOpt));assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
 assert.throws(()=>pipeline.reviseCoherentStage(f.root,{...f.options,expectedBatchSha256:'0'.repeat(64)}));assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
 const ordinary={...f.options,replacements:[{assetId:'front.left',planId:'stage.normal.front',intent:'isolated-layer-v4'}]};assert.throws(()=>pipeline.reviseCoherentStage(f.root,ordinary));assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
});
for(const state of ['authorized','reserved','unknown'])test(`API refuses opted-in dependency revision of ${state} target without mutation`,{timeout:120000},t=>{
 const f=fixture(t,'accept',state),before=flow.inspectWorkflow(f.workflow);assert.throws(()=>pipeline.reviseCoherentStage(f.root,f.options));assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
});
for(const status of ['pending','reject'])test(`API refuses ${status} dependency source without mutation`,{timeout:120000},t=>{
 const f=fixture(t,status),before=flow.inspectWorkflow(f.workflow);assert.throws(()=>pipeline.reviseCoherentStage(f.root,f.options));assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
});
for(const status of ['reserved','unknown','failed'])test(`API refuses another ${status} source without mutation`,{timeout:120000},t=>{
 const f=fixture(t),other=f.batch.planSha256s.map(s=>flow.getGenerationPlan(f.workflow,s)).find(p=>p.recipe.assetId==='front.right');
 flow.authorizePlan(f.workflow,other.sha256,decision('stage.other.compute',other.sha256,'approve-compute'));if(status!=='authorized'){
   const {request,...ticket}=flow.reservePlan(f.workflow,other.sha256);if(status==='unknown'||status==='failed'){flow.recordSubmission(f.workflow,ticket);flow.stopAttempt(f.workflow,ticket,status==='unknown'?'indeterminate':'failed');}}
 const before=flow.inspectWorkflow(f.workflow);assert.throws(()=>pipeline.reviseCoherentStage(f.root,f.options));assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
});
test('an unrelated authorized but unsubmitted source remains untouched',{timeout:120000},t=>{
 const f=fixture(t),other=f.batch.planSha256s.map(s=>flow.getGenerationPlan(f.workflow,s)).find(p=>p.recipe.assetId==='front.right');
 flow.authorizePlan(f.workflow,other.sha256,decision('stage.other.unsubmitted',other.sha256,'approve-compute'));
 const result=pipeline.reviseCoherentStage(f.root,f.options),view=flow.inspectWorkflow(f.workflow);assert.notEqual(result.batchSha256,f.batch.sha256);
 assert.equal(view.plans.find(p=>p.planSha256===other.sha256).status,'authorized');
});
test('an unrelated technically received source awaiting review remains untouched',{timeout:120000},t=>{
 const f=fixture(t),other=f.batch.planSha256s.map(s=>flow.getGenerationPlan(f.workflow,s)).find(p=>p.recipe.assetId==='front.right');
 flow.authorizePlan(f.workflow,other.sha256,decision('stage.other.pending',other.sha256,'approve-compute'));receiveEdgeFixture(f.workflow,other.sha256,sourcePng(true,41));
 const result=pipeline.reviseCoherentStage(f.root,f.options),view=flow.inspectWorkflow(f.workflow);assert.notEqual(result.batchSha256,f.batch.sha256);
 assert.equal(view.plans.find(p=>p.planSha256===other.sha256).status,'pending-visual-review');
});
