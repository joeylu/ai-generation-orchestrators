import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import * as flow from '../src/generation/index.mjs';
import {dependencySource,compileSourceDependency} from '../src/generation/coherent-source-dependency.mjs';
import {assessCoherentSource} from '../src/generation/coherent-source.mjs';
import {hash,seal,unseal} from '../src/generation/common.mjs';
import {assertCurrent} from '../src/generation/compiler.mjs';
import {setupCoherent,sourcePng} from './helpers/coherent.mjs';
import {receiveEdgeFixture} from './helpers/terrain-edge-delivery.mjs';
import {decision} from './helpers/generation.mjs';

function fixture(t,changed=false){const f=setupCoherent(t,'Dependency synthetic',undefined,{transformAnalysis:a=>{if(!changed)return a;const v=unseal(a);return seal({...v,instances:v.instances.map(i=>i.instanceId==='landmark.actual'?{...i,anchor:{...i.anchor,x:i.anchor.x+1}}:i)});}}),scopes=flow.createLayerSourceScopes(f.brief.requirements),batch=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:scopes}),plans=batch.planSha256s.map(s=>flow.getGenerationPlan(f.workflow,s));
 const bridge=plans.find(p=>p.recipe.assetId==='landmark.actual'),target=plans.find(p=>p.recipe.assetId==='front.left');assert(bridge&&target);return {...f,referenceTarget:f.target,batch,bridge,target};}
const dependency=sha=>({format:'ai_scene_source_dependency_v1',sourcePlanSha256:sha,placement:{x:10,y:20,scale:{numerator:1,denominator:2}},observations:[{observationId:'bridge.end',native:{x:200,y:200}}]});
const revise=(f,dep,batchId='dependency.new')=>flow.reviseCoherentSources(f.workflow,f.batch.sha256,{batchId,replacements:[{assetId:'front.left',planId:batchId+'.front',intent:'isolated-layer-v4',sourceDependency:dep}]});
test('two input dependency binds the received source and needs fresh authorization',{timeout:120000},t=>{
 const f=fixture(t),old=flow.getGenerationPlan(f.workflow,f.target.sha256),dep=dependency(f.bridge.sha256),before=flow.inspectWorkflow(f.workflow);
 assert.throws(()=>revise(f,dep));assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
 flow.authorizeReferenceAssetBatch(f.workflow,f.batch.sha256,decision('initial.compute',f.batch.sha256,'approve-compute'));
 const raw=sourcePng(true,23),received=receiveEdgeFixture(f.workflow,f.bridge.sha256,raw);assert.equal(received.technical.status,'pass');assert.throws(()=>revise(f,dep));
 const review=flow.reviewResult(f.workflow,f.bridge.sha256,decision('source.accept',hash(raw),'accept'));
 const revised=revise(f,dep),newSha=revised.planSha256s.find(s=>!f.batch.planSha256s.includes(s)),plan=flow.getGenerationPlan(f.workflow,newSha);
 assert.equal(plan.request.images.length,2);assert.equal(plan.request.images[0].artifact.sha256,hash(f.raw));assert.equal(plan.request.images[1].artifact.sha256,hash(raw));
 assert.equal(plan.sourceDependencyEvidence.sourcePlanSha256,f.bridge.sha256);assert.equal(plan.sourceDependencyEvidence.sourceRawSha256,hash(raw));assert.equal(plan.sourceDependencyEvidence.sourceReviewSha256,review.sha256);
 const sourceEntry={plan:f.bridge,result:flow.getGenerationResult(f.workflow,f.bridge.sha256).result,review,status:'accepted'},current={activeSpec:plan.recipe.specSha256,activeStyle:plan.recipe.styleSha256,plans:new Map([[f.bridge.sha256,sourceEntry],[f.plan.sha256,{status:'accepted',reconstructionTarget:f.referenceTarget,result:{rawSha256:hash(f.raw)}}]])};
 assertCurrent(current,plan);const changedReview=seal({...unseal(review),receipt:{...review.receipt,notes:'A different accepted review'}}),stale={...current,plans:new Map(current.plans)};stale.plans.set(f.bridge.sha256,{...sourceEntry,review:changedReview});assert.throws(()=>assertCurrent(stale,plan));
 assert.deepEqual(flow.readGenerationInput(f.workflow,newSha,0),f.raw);assert.deepEqual(flow.readGenerationInput(f.workflow,newSha,1),raw);
 assert.deepEqual(flow.getGenerationPlan(f.workflow,f.target.sha256),old);assert.notEqual(newSha,f.target.sha256);assert.throws(()=>flow.reservePlan(f.workflow,newSha));
 flow.authorizeReferenceAssetBatch(f.workflow,revised.sha256,decision('fresh.compute',revised.sha256,'approve-compute'));
 const {request,...ticket}=flow.reservePlan(f.workflow,newSha);assert.equal(ticket.planSha256,newSha);assert.equal(request.maximumCalls,1);assert.throws(()=>flow.reservePlan(f.workflow,newSha));
 const file=join(f.workflow,'blobs',hash(raw)+'.bin'),saved=readFileSync(file);try{writeFileSync(file,Buffer.from('tampered'));assert.throws(()=>flow.readGenerationInput(f.workflow,newSha,1));}finally{writeFileSync(file,saved);}
 const eventDir=join(f.workflow,'events'),event=readdirSync(eventDir).map(n=>join(eventDir,n)).find(p=>JSON.parse(readFileSync(p)).record.sha256===review.sha256),original=readFileSync(event),changed=JSON.parse(original);changed.record.receipt.targetSha256='0'.repeat(64);
 try{writeFileSync(event,JSON.stringify(changed));assert.throws(()=>flow.readGenerationInput(f.workflow,newSha,1));}finally{writeFileSync(event,original);}
});
test('dependency rejects wrong reference, failed QA and insufficient two-image capability',{timeout:120000},t=>{
 const f=fixture(t);flow.authorizeReferenceAssetBatch(f.workflow,f.batch.sha256,decision('second.compute',f.batch.sha256,'approve-compute'));const raw=sourcePng(true,31);receiveEdgeFixture(f.workflow,f.bridge.sha256,raw);
 const review=flow.reviewResult(f.workflow,f.bridge.sha256,decision('source.second.accept',hash(raw),'accept'));
 const result=flow.getGenerationResult(f.workflow,f.bridge.sha256).result,recipe={...f.target.recipe,parents:[f.target.sha256],sourceDependency:dependency(f.bridge.sha256)},entry={plan:f.bridge,result,review,status:'accepted'},state={plans:new Map([[f.bridge.sha256,entry],[f.target.sha256,{plan:f.target,status:'planned'}]]),capabilities:new Map([[recipe.capabilitiesSha256,{imageToImage:true,maxInputImages:2}]])};
 assert.equal(dependencySource(state,recipe),entry);
 const other=structuredClone(f.bridge);other.recipe.referencePlans[0]='0'.repeat(64);assert.throws(()=>dependencySource({...state,plans:new Map([[f.bridge.sha256,{...entry,plan:other}]])},recipe));
 const failed=structuredClone(result);failed.technical.status='fail';assert.throws(()=>dependencySource({...state,plans:new Map([[f.bridge.sha256,{...entry,result:failed}]])},recipe));
 for(const changed of [{...review,planSha256:'0'.repeat(64)},{...review,technicalSha256:'0'.repeat(64)},{...review,receipt:{...review.receipt,targetSha256:'0'.repeat(64)}},{...review,receipt:{...review.receipt,decision:'reject'}}])
   assert.throws(()=>dependencySource({...state,plans:new Map([[f.bridge.sha256,{...entry,review:changed}]])},recipe));
 assert.throws(()=>compileSourceDependency(f.target,recipe,{...state,capabilities:new Map([[recipe.capabilitiesSha256,{imageToImage:true,maxInputImages:1}]])},()=>raw,assessCoherentSource),e=>e.errors?.some(x=>x.code==='SOURCE_DEPENDENCY_CAPABILITY'));
 const altered=sourcePng(true,32);assert.throws(()=>compileSourceDependency(f.target,recipe,state,()=>altered,assessCoherentSource),e=>e.errors?.some(x=>x.code==='SOURCE_DEPENDENCY_QA'));
});
test('pending and explicitly rejected sources cannot be bound',{timeout:120000},t=>{
 const f=fixture(t);flow.authorizeReferenceAssetBatch(f.workflow,f.batch.sha256,decision('reject.initial',f.batch.sha256,'approve-compute'));
 const raw=sourcePng(true,27),result=receiveEdgeFixture(f.workflow,f.bridge.sha256,raw);assert.equal(result.technical.status,'pass');
 assert.throws(()=>revise(f,dependency(f.bridge.sha256),'pending.dependency'));flow.reviewResult(f.workflow,f.bridge.sha256,decision('reject.bridge',hash(raw),'reject'));
 const before=flow.inspectWorkflow(f.workflow);assert.throws(()=>revise(f,dependency(f.bridge.sha256),'reject.dependency'));
 const state=flow.inspectWorkflow(f.workflow);assert.deepEqual(state,before);assert.equal(state.plans.find(p=>p.planSha256===f.bridge.sha256).status,'rejected-visual');
});
function frozenDependency(t){const f=fixture(t);flow.authorizeReferenceAssetBatch(f.workflow,f.batch.sha256,decision('stale.initial',f.batch.sha256,'approve-compute'));const raw=sourcePng(true,19);receiveEdgeFixture(f.workflow,f.bridge.sha256,raw);flow.reviewResult(f.workflow,f.bridge.sha256,decision('stale.accept',hash(raw),'accept'));
 const dep=dependency(f.bridge.sha256),batch=revise(f,dep,'stale.first'),sha=batch.planSha256s.find(s=>!f.batch.planSha256s.includes(s));return {...f,raw,dep,batch,sha};}
function replaceDependency(f){const next=structuredClone(f.dep);next.placement.x+=1;const status=flow.inspectWorkflow(f.workflow).plans.find(p=>p.planSha256===f.sha).status;const batch=flow.reviseCoherentSources(f.workflow,f.batch.sha256,{batchId:'stale.replacement',...(status==='planned'?{allowUnsubmittedDependency:true,expectedBatchSha256:f.batch.sha256}:{}),replacements:[{assetId:'front.left',planId:'stale.replacement.front',intent:'isolated-layer-v4',sourceDependency:next}]});
 return {batch,sha:batch.planSha256s.find(s=>!f.batch.planSha256s.includes(s))};}
const stale=fn=>assert.throws(fn,e=>e.errors?.some(x=>x.code==='SOURCE_DEPENDENCY_BATCH_STALE'));
test('replaced pending dependency cannot be authorized or read; current replacement can',{timeout:120000},t=>{
 const f=frozenDependency(t);assert.deepEqual(flow.readGenerationInput(f.workflow,f.sha,1),f.raw);const replacement=replaceDependency(f);
 stale(()=>flow.readGenerationInput(f.workflow,f.sha,0));stale(()=>flow.readGenerationInput(f.workflow,f.sha,1));
 stale(()=>flow.authorizePlan(f.workflow,f.sha,decision('stale.old.single',f.sha,'approve-compute')));
 stale(()=>flow.authorizeReferenceAssetBatch(f.workflow,f.batch.sha256,decision('stale.old.batch',f.batch.sha256,'approve-compute')));
 assert.deepEqual(flow.readGenerationInput(f.workflow,replacement.sha,1),f.raw);flow.authorizePlan(f.workflow,replacement.sha,decision('stale.new.single',replacement.sha,'approve-compute'));
 assert.equal(flow.reservePlan(f.workflow,replacement.sha).planSha256,replacement.sha);
});
test('replaced previously authorized dependency cannot be reserved',{timeout:120000},t=>{
 const f=frozenDependency(t);flow.authorizePlan(f.workflow,f.sha,decision('stale.authorized',f.sha,'approve-compute'));const replacement=replaceDependency(f);
 stale(()=>flow.reservePlan(f.workflow,f.sha));stale(()=>flow.readGenerationInput(f.workflow,f.sha,1));
 assert.deepEqual(flow.readGenerationInput(f.workflow,replacement.sha,1),f.raw);
});
test('replacing the upstream source alone cannot leave a dangling dependent',{timeout:120000},t=>{
 const f=frozenDependency(t);assert.deepEqual(flow.readGenerationInput(f.workflow,f.sha,1),f.raw);
 const before=flow.inspectWorkflow(f.workflow);assert.throws(()=>flow.reviseCoherentSources(f.workflow,f.batch.sha256,{batchId:'stale.source',replacements:[{assetId:'landmark.actual',planId:'stale.source.bridge',intent:'isolated-layer-v4'}]}),e=>e.errors?.some(x=>x.code==='SOURCE_DEPENDENCY_BATCH'));
 assert.deepEqual(flow.inspectWorkflow(f.workflow),before);assert.deepEqual(flow.readGenerationInput(f.workflow,f.sha,1),f.raw);
});
test('an indeterminate parent cannot silently be revised into a dependency attempt',{timeout:120000},t=>{
 const f=fixture(t);flow.authorizeReferenceAssetBatch(f.workflow,f.batch.sha256,decision('unknown.initial',f.batch.sha256,'approve-compute'));
 const raw=sourcePng(true,29);receiveEdgeFixture(f.workflow,f.bridge.sha256,raw);flow.reviewResult(f.workflow,f.bridge.sha256,decision('unknown.source.accept',hash(raw),'accept'));
 const {request,...ticket}=flow.reservePlan(f.workflow,f.target.sha256);flow.recordSubmission(f.workflow,ticket);flow.stopAttempt(f.workflow,ticket,'indeterminate');
 const before=flow.inspectWorkflow(f.workflow);assert.throws(()=>revise(f,dependency(f.bridge.sha256),'unknown.dependency'),e=>e.errors?.some(x=>x.code==='SOURCE_DEPENDENCY_UNKNOWN_PARENT'));
 assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
});
test('checked-rebind source requires an exact target review before dependent two-input use',{timeout:120000},t=>{
 const source=fixture(t),target=fixture(t,true),raw=sourcePng(true,35);
 flow.authorizeReferenceAssetBatch(source.workflow,source.batch.sha256,decision('rebind.source.compute',source.batch.sha256,'approve-compute'));receiveEdgeFixture(source.workflow,source.bridge.sha256,raw);
 flow.reviewResult(source.workflow,source.bridge.sha256,decision('rebind.source.accept',hash(raw),'accept'));
 const opt={sourceWorkflow:source.workflow,sourcePlanSha256:source.bridge.sha256,targetPlanSha256:target.bridge.sha256,targetSha256:target.bridge.recipe.targetSha256,scopeSha256:target.bridge.sourceScope.definition.sha256};
 const proposal=flow.proposeCoherentRebind(target.workflow,opt).proposal,applied=flow.commitCoherentRebind(target.workflow,{...opt,proposal,rebindId:'dependency.bridge.rebind',parentBatchSha256:target.batch.sha256,batchId:'dependency.rebound',receipt:decision('rebind.proposal.accept',proposal.sha256)}),sourceSha=applied.record.sha256,dep=dependency(sourceSha);
 const opts={batchId:'dependency.rebound.use',allowUnsubmittedDependency:true,expectedBatchSha256:applied.batch.sha256,replacements:[{assetId:'front.left',planId:'dependency.rebound.front',intent:'isolated-layer-v4',sourceDependency:dep}]};
 assert.throws(()=>flow.reviseCoherentSources(target.workflow,applied.batch.sha256,opts));
 const review=flow.reviewResult(target.workflow,sourceSha,decision('rebind.target.accept',hash(raw),'accept'));
 const batch=flow.reviseCoherentSources(target.workflow,applied.batch.sha256,opts),sha=batch.planSha256s.find(s=>!applied.batch.planSha256s.includes(s)),plan=flow.getGenerationPlan(target.workflow,sha);
 assert.equal(plan.sourceDependencyEvidence.sourceReviewSha256,review.sha256);assert.equal(plan.sourceDependencyEvidence.sourceTargetPlanSha256,target.bridge.sha256);
 assert.equal(plan.sourceDependencyEvidence.sourceRebindEvidenceSha256,applied.record.sourceEvidence.sha256);assert.equal(plan.sourceDependencyEvidence.sourceRebindProposalSha256,proposal.sha256);
 assert.deepEqual(flow.readGenerationInput(target.workflow,sha,0),target.raw);assert.deepEqual(flow.readGenerationInput(target.workflow,sha,1),raw);assert.throws(()=>flow.reservePlan(target.workflow,sha));
 const view=flow.readCoherentWorkflowView(target.workflow,{includeCurrentInputs:true});assert.deepEqual(view.inputs.get(hash(target.raw)),target.raw);assert.deepEqual(view.inputs.get(hash(raw)),raw);
 const viewPlan=view.plans.find(p=>p.sha256===sha);assert.equal(viewPlan.request.images[0].artifact.sha256,hash(target.raw));assert.equal(viewPlan.request.images[1].artifact.sha256,hash(raw));
 flow.authorizePlan(target.workflow,sha,decision('rebind.target.new.compute',sha,'approve-compute'));assert.equal(flow.reservePlan(target.workflow,sha).planSha256,sha);assert.throws(()=>flow.reservePlan(target.workflow,sha));
 const entry={kind:'coherent-rebind',status:'accepted',plan:applied.record,review,result:flow.getGenerationResult(target.workflow,sourceSha).result},state={plans:new Map([[sourceSha,entry],[target.bridge.sha256,{plan:target.bridge}]])};
 const mismatch=structuredClone(entry.result);mismatch.technical.planSha256='0'.repeat(64);assert.throws(()=>dependencySource({...state,plans:new Map([[sourceSha,{...entry,result:mismatch}],[target.bridge.sha256,{plan:target.bridge}]])},plan.recipe));
 const forged=structuredClone(applied.record);forged.sourceEvidence.rawSha256='0'.repeat(64);assert.throws(()=>dependencySource({...state,plans:new Map([[sourceSha,{...entry,plan:forged}],[target.bridge.sha256,{plan:target.bridge}]])},plan.recipe));
 const badReview={...review,technicalSha256:'0'.repeat(64)};assert.throws(()=>dependencySource({...state,plans:new Map([[sourceSha,{...entry,review:badReview}],[target.bridge.sha256,{plan:target.bridge}]])},plan.recipe));
});
test('appearance dependency binds checked rebind and exact review without spatial semantics',{timeout:120000},t=>{
 const source=fixture(t),target=fixture(t,true),raw=sourcePng(true,35);
 flow.authorizeReferenceAssetBatch(source.workflow,source.batch.sha256,decision('appearance.source.compute',source.batch.sha256,'approve-compute'));receiveEdgeFixture(source.workflow,source.bridge.sha256,raw);
 flow.reviewResult(source.workflow,source.bridge.sha256,decision('appearance.source.accept',hash(raw),'accept'));
 const opt={sourceWorkflow:source.workflow,sourcePlanSha256:source.bridge.sha256,targetPlanSha256:target.bridge.sha256,targetSha256:target.bridge.recipe.targetSha256,scopeSha256:target.bridge.sourceScope.definition.sha256};
 const proposal=flow.proposeCoherentRebind(target.workflow,opt).proposal,applied=flow.commitCoherentRebind(target.workflow,{...opt,proposal,rebindId:'appearance.bridge.rebind',parentBatchSha256:target.batch.sha256,batchId:'appearance.rebound',receipt:decision('appearance.proposal.accept',proposal.sha256)}),sourceSha=applied.record.sha256;
 const dep={format:'ai_scene_source_appearance_dependency_v1',sourcePlanSha256:sourceSha},opts={batchId:'appearance.rebound.use',allowUnsubmittedDependency:true,expectedBatchSha256:applied.batch.sha256,replacements:[{assetId:'front.left',planId:'appearance.rebound.front',intent:'isolated-layer-v4',sourceDependency:dep}]};
 assert.throws(()=>flow.reviseCoherentSources(target.workflow,applied.batch.sha256,opts));
 const review=flow.reviewResult(target.workflow,sourceSha,decision('appearance.target.accept',hash(raw),'accept'));
 const batch=flow.reviseCoherentSources(target.workflow,applied.batch.sha256,opts),sha=batch.planSha256s.find(s=>!applied.batch.planSha256s.includes(s)),plan=flow.getGenerationPlan(target.workflow,sha);
 assert.equal(plan.sourceDependencyEvidence.sourceReviewSha256,review.sha256);assert.equal(plan.request.images[1].role,'verified-independent-source-appearance-reference');
 assert.match(plan.request.prompt,/only as a reference for painted material/);assert.doesNotMatch(plan.request.prompt,/spatial reference only|independent occluder asset/);
 assert.deepEqual(flow.readGenerationInput(target.workflow,sha,0),target.raw);assert.deepEqual(flow.readGenerationInput(target.workflow,sha,1),raw);
 assert.throws(()=>flow.reservePlan(target.workflow,sha));flow.authorizePlan(target.workflow,sha,decision('appearance.new.compute',sha,'approve-compute'));assert.equal(flow.reservePlan(target.workflow,sha).planSha256,sha);assert.throws(()=>flow.reservePlan(target.workflow,sha));
 const invalid={...dep,placement:{x:0,y:0}};assert.throws(()=>dependencySource({plans:new Map()}, {...plan.recipe,sourceDependency:invalid}));
});
test('appearance v2 leaves atmosphere to the brief while preserving the frozen v1 plan',{timeout:120000},t=>{
 const f=fixture(t),raw=sourcePng(true,43);flow.authorizePlan(f.workflow,f.bridge.sha256,decision('appearance.versions.compute',f.bridge.sha256,'approve-compute'));
 receiveEdgeFixture(f.workflow,f.bridge.sha256,raw);const sourceReview=flow.reviewResult(f.workflow,f.bridge.sha256,decision('appearance.versions.review',hash(raw),'accept'));
 const make=(batch,format,name)=>flow.reviseCoherentSources(f.workflow,batch.sha256,{batchId:name,allowUnsubmittedDependency:true,expectedBatchSha256:batch.sha256,
   replacements:[{assetId:'front.left',planId:name+'.front',intent:'isolated-layer-v4',sourceDependency:{format,sourcePlanSha256:f.bridge.sha256}}]});
 const v1Batch=make(f.batch,'ai_scene_source_appearance_dependency_v1','appearance.version.one'),v1Sha=v1Batch.planSha256s.find(x=>!f.batch.planSha256s.includes(x)),v1=flow.getGenerationPlan(f.workflow,v1Sha);
 assert.equal(v1.sha256,'86d9202b3cbf7cab9ad48ea9c9d0eaecc8b37028988c31a8b926d0773234dd44');assert.equal(hash(v1.request.prompt),'76775e1662b60962332740bd9b171676eb2ebc6e72972b9b53b7c3b3d8ee54e8');
 assert.match(v1.request.prompt,/Do not add fog, haze, glow or a composited background\./);assert.match(v1.compiler,/-source-appearance-dependency-v1$/);
 const v2Batch=make(v1Batch,'ai_scene_source_appearance_dependency_v2','appearance.version.two'),v2Sha=v2Batch.planSha256s.find(x=>!v1Batch.planSha256s.includes(x)),v2=flow.getGenerationPlan(f.workflow,v2Sha);
 assert.deepEqual(flow.getGenerationPlan(f.workflow,v1Sha),v1);assert.equal(v2.request.images[1].role,'verified-independent-source-appearance-reference');
 assert.match(v2.compiler,/-source-appearance-dependency-v2$/);assert.match(v2.request.prompt,/brief owns the output subject and any atmosphere or glow constraints/);
 assert.doesNotMatch(v2.request.prompt,/Do not add fog, haze, glow/);assert.deepEqual(flow.readGenerationInput(f.workflow,v2Sha,1),raw);
 const sourceEntry={plan:f.bridge,result:flow.getGenerationResult(f.workflow,f.bridge.sha256).result,review:sourceReview,status:'accepted'},state={plans:new Map([[f.bridge.sha256,sourceEntry],[v1Sha,{status:'planned'}]]),capabilities:new Map([[v2.recipe.capabilitiesSha256,{imageToImage:true,maxInputImages:2}]])};
 assert.throws(()=>compileSourceDependency(v2,v2.recipe,state,()=>raw,assessCoherentSource),e=>e.errors?.some(x=>x.code==='SOURCE_DEPENDENCY_CAPABILITY'));
 const oneInput={...v2,request:{...v2.request,images:v2.request.images.slice(0,1)}};
 assert.throws(()=>compileSourceDependency(oneInput,v2.recipe,{...state,capabilities:new Map([[v2.recipe.capabilitiesSha256,{imageToImage:true,maxInputImages:1}]])},()=>raw,assessCoherentSource),e=>e.errors?.some(x=>x.code==='SOURCE_DEPENDENCY_CAPABILITY'));
 assert.throws(()=>flow.readGenerationInput(f.workflow,v1Sha,1),e=>e.errors?.some(x=>x.code==='SOURCE_DEPENDENCY_BATCH_STALE'));
 assert.throws(()=>flow.reservePlan(f.workflow,v2Sha));flow.authorizePlan(f.workflow,v2Sha,decision('appearance.version.two.compute',v2Sha,'approve-compute'));assert.equal(flow.reservePlan(f.workflow,v2Sha).planSha256,v2Sha);assert.throws(()=>flow.reservePlan(f.workflow,v2Sha));
});
