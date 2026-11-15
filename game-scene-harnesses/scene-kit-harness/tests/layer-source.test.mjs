import test from 'node:test';import assert from 'node:assert/strict';
import {join} from 'node:path';import {readFileSync,writeFileSync,rmSync} from 'node:fs';
import * as flow from '../src/generation/index.mjs';import * as pipeline from '../src/coherent-pipeline.mjs';
import {LAYER_SOURCE_INTENT,LAYER_SOURCE_POLICY,createLayerSourceScopes,validateLayerSourceScopes} from '../src/generation/layer-source.mjs';
import {COHERENT_POLICY} from '../src/generation/coherent-source.mjs';
import {seal,unseal,hash,jsonBytes} from '../src/generation/common.mjs';
import {setupCoherent,coherentBrief,coherentAnalysis,sourcePng,referencePng} from './helpers/coherent.mjs';import {decision} from './helpers/generation.mjs';
const rejects=(f,code)=>assert.throws(f,e=>e.errors?.some(v=>v.code===code));
const front={subjectId:'foreground',content:'One low pile of loose sandstone rocks with a single sparse dry branch.',exclusions:['Neighboring town buildings'],parentRole:'foreground'};
function scoped(f,overrides=[front]){return {...f.options,batchId:'scoped.sources',sourceScopes:createLayerSourceScopes(f.brief.requirements,overrides)};}
const rect=(x,y)=>[{x,y},{x:x+20,y},{x:x+20,y:y+20},{x,y:y+20}];
function allRoles(t){return setupCoherent(t,'Warm canyon',undefined,{
 transformBrief:b=>({...b,requirements:seal({...unseal(b.requirements),subjects:[...b.requirements.subjects,...['backdrop','scenery','valley'].map(role=>({subjectId:role,role,layerId:'landmark',content:`One warm canyon ${role} group`,count:{min:1,max:1},placementHint:'center'}))]})}),
 transformAnalysis:a=>seal({...unseal(a),instances:[...a.instances,...['backdrop','scenery','valley'].map((role,i)=>({instanceId:role+'.actual',subjectId:role,layerId:'landmark',visibleEnvelope:rect(30+i*25,20),anchor:{x:40+i*25,y:30},visibility:'visible',anchorEvidence:'observed',notes:'Synthetic isolated group.'}))]})});}

test('layer scopes are complete, bounded, theme-independent data with explicit versus inherited content provenance',()=>{
 const brief=coherentBrief('Violet alien cave'),scopes=createLayerSourceScopes(brief.requirements,[{...front,content:'One violet crystalline framing cluster.'}]);
 assert.equal(scopes.subjects.length,brief.requirements.subjects.length);assert.equal(scopes.subjects.find(s=>s.role==='foreground').contentOrigin,'explicit-source-brief');assert.equal(scopes.subjects.find(s=>s.role==='sky').contentOrigin,'subject-description');assert.equal(scopes.subjects.find(s=>s.role==='landmark').parentRole,'far');validateLayerSourceScopes(brief.requirements,scopes);
 rejects(()=>createLayerSourceScopes(brief.requirements,[front,front]),'LAYER_SCOPE_OVERRIDE');rejects(()=>createLayerSourceScopes(brief.requirements,[{...front,subjectId:'absent'}]),'LAYER_SCOPE_UNKNOWN_SUBJECT');rejects(()=>createLayerSourceScopes(brief.requirements,[{...front,parentRole:'main'}]),'LAYER_SCOPE_PARENT');
 rejects(()=>createLayerSourceScopes(brief.requirements,[{...front,content:'E:/private/work'}]),'PRIVATE_OPERATIONAL_TEXT');rejects(()=>validateLayerSourceScopes(brief.requirements,{...scopes,subjects:[]}), 'RECORD_INTEGRITY');
 const missing=seal({...unseal(scopes),subjects:scopes.subjects.slice(1)});rejects(()=>validateLayerSourceScopes(brief.requirements,missing),'LAYER_SCOPE_COVERAGE');
 const weakened=seal({...unseal(scopes),subjects:scopes.subjects.map(s=>s.role==='foreground'?{...s,exclusions:[]}:s)});rejects(()=>validateLayerSourceScopes(brief.requirements,weakened),'LAYER_SCOPE_REQUIRED_EXCLUSIONS');
});

test('first-batch foregrounds use single-asset content and style input without scene coordinates, paired descriptions or a failed parent',t=>{
 const f=setupCoherent(t),legacy=flow.previewCoherentSources(f.workflow,f.options),before=flow.inspectWorkflow(f.workflow),proposal=flow.previewCoherentSources(f.workflow,scoped(f));
 assert.equal(proposal.plans.length,legacy.plans.length);assert.deepEqual(flow.inspectWorkflow(f.workflow),before);assert.deepEqual(flow.previewCoherentSources(f.workflow,f.options),legacy);
 const fronts=proposal.plans.filter(p=>p.instanceBinding.role==='foreground');assert.equal(fronts.length,2);
 for(const p of fronts){assert.equal(p.recipe.intent,LAYER_SOURCE_INTENT);assert.deepEqual(p.recipe.parents,[]);assert.equal(p.compiler,'scene-kit-isolated-layer-source-v4');assert.match(p.request.prompt,/SINGLE-ASSET BRIEF: One low pile/);assert.match(p.request.prompt,/STYLE|brushwork/);assert.doesNotMatch(p.request.prompt,/Desert sandstone city framing rocks|observed reference envelope|Draw ONLY instance/);assert(!p.request.prompt.includes(JSON.stringify(p.instanceBinding.observedEnvelope)));assert.equal(p.request.images[0].artifact.sha256,hash(f.raw));assert.equal(p.sourceScope.parentRole,'foreground');assert.equal(p.sourceScope.semanticIsolationProven,false);assert.equal(p.sourceScope.alphaCleanupAllowed,false);assert.equal(p.visualReviewChecklist.automatedSemanticDetection,false);}
});

test('all source roles receive distinct responsibilities; landmarks retain own foundations while foregrounds exclude main walls',t=>{
 const f=allRoles(t),proposal=flow.previewCoherentSources(f.workflow,scoped(f));assert.equal(proposal.plans.length,9);
 const roles=new Map(proposal.plans.map(p=>[p.instanceBinding.role,p]));assert.equal(roles.size,8);for(const p of proposal.plans){assert.equal(p.sourceScope.profile,LAYER_SOURCE_INTENT);assert.equal(p.request.images.length,1);assert.equal(p.sourceScope.sceneCoordinatesInPrompt,false);assert.equal(p.request.maximumCalls,1);assert.equal(p.qualityPolicy.sha256,COHERENT_POLICY.sha256);}
 assert.match(roles.get('landmark').request.prompt,/own attached foundation/);assert.match(roles.get('foreground').request.prompt,/backing terrain slab/);assert.equal(roles.get('platform').sourceScope.parentRole,'main');assert.equal(roles.get('sky').target.alpha,'opaque');assert.equal(roles.get('material').target.alpha,'opaque');assert.match(roles.get('valley').request.prompt,/dry valley stays dry/);assert.match(roles.get('material').request.prompt,/MATERIAL FIELD/);
 assert.doesNotMatch(roles.get('material').request.prompt,/Center the one group/);assert.doesNotMatch(roles.get('sky').request.prompt,/12 percent/);
});

test('scopes cannot change roles, source identities or required exclusions, or be silently applied to another accepted design',t=>{
 const f=setupCoherent(t),options=scoped(f),p=flow.previewCoherentSources(f.workflow,options).plans.at(-1),scope=p.recipe.sourceScope;
 const altered=seal({...unseal(options.sourceScopes),requirementsSha256:'0'.repeat(64)});rejects(()=>flow.previewCoherentSources(f.workflow,{...options,sourceScopes:altered}),'LAYER_SCOPE_BINDING');
 assert.equal(scope.requirementsSha256,f.brief.requirements.sha256);assert.equal(scope.policySha256,LAYER_SOURCE_POLICY.sha256);
 const wrong=seal({...unseal(options.sourceScopes),subjects:options.sourceScopes.subjects.map(r=>r.subjectId==='foreground'?{...r,role:'platform'}:r)});rejects(()=>flow.previewCoherentSources(f.workflow,{...options,sourceScopes:wrong}),'LAYER_SCOPE_COVERAGE');
});

test('new scoped batches still require their own digest approval and retain unknown outcomes and unchanged sources',t=>{
 const f=setupCoherent(t),legacy=flow.freezeCoherentSources(f.workflow,f.options);flow.authorizeReferenceAssetBatch(f.workflow,legacy.sha256,decision('legacy.compute',legacy.sha256,'approve-compute'));
 const batch=flow.freezeCoherentSources(f.workflow,scoped(f));rejects(()=>flow.reservePlan(f.workflow,batch.planSha256s[0]),'AUTHORIZATION_REQUIRED');flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('scoped.compute',batch.sha256,'approve-compute'));
 const first=batch.planSha256s[0],prior=flow.getGenerationPlan(f.workflow,first),{request,...ticket}=flow.reservePlan(f.workflow,first);flow.recordSubmission(f.workflow,ticket);flow.stopAttempt(f.workflow,ticket,'indeterminate');rejects(()=>flow.reservePlan(f.workflow,first),'RESERVATION_STATE');
 const unchanged=flow.inspectWorkflow(f.workflow);for(const [change,code]of [[{subjectIds:['foreground']},'LAYER_SCOPE_BINDING'],[{parentRole:'foreground'},'LAYER_SCOPE_PARENT'],[{exclusions:[]},'LAYER_SCOPE_REQUIRED_EXCLUSIONS']]){
  const sourceScope=seal({...unseal(prior.recipe.sourceScope),...change});rejects(()=>flow.reviseCoherentSources(f.workflow,batch.sha256,{batchId:'invalid.revision',replacements:[{assetId:prior.recipe.assetId,planId:'invalid.replacement',intent:LAYER_SOURCE_INTENT,sourceScope}]}),code);assert.deepEqual(flow.inspectWorkflow(f.workflow),unchanged);
 }
 const revision=flow.reviseCoherentSources(f.workflow,batch.sha256,{batchId:'scoped.revision',replacements:[{assetId:prior.recipe.assetId,planId:'scoped.replacement'}]});assert.deepEqual(revision.planSha256s.slice(1),batch.planSha256s.slice(1));const next=flow.getGenerationPlan(f.workflow,revision.planSha256s[0]);assert.deepEqual(next.recipe.sourceScope,prior.recipe.sourceScope);assert.equal(next.recipe.intent,LAYER_SOURCE_INTENT);rejects(()=>flow.reservePlan(f.workflow,next.sha256),'AUTHORIZATION_REQUIRED');assert.equal(flow.inspectWorkflow(f.workflow).plans.find(p=>p.planSha256===first).status,'indeterminate');
});

test('a scoped alternative can replace a received foreground without inventing a rejected art decision',t=>{
 const f=setupCoherent(t),batch=flow.freezeCoherentSources(f.workflow,scoped(f));flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('scoped.compute',batch.sha256,'approve-compute'));const sha=batch.planSha256s.at(-1),old=flow.getGenerationPlan(f.workflow,sha),{request,...ticket}=flow.reservePlan(f.workflow,sha);flow.recordSubmission(f.workflow,ticket);flow.receiveResult(f.workflow,ticket,sourcePng(true,18));
 const before=flow.inspectWorkflow(f.workflow).plans.find(p=>p.planSha256===sha),revision=flow.reviseCoherentSources(f.workflow,batch.sha256,{batchId:'scoped.alternative',replacements:[{assetId:old.recipe.assetId,planId:'scoped.alternative.front',intent:LAYER_SOURCE_INTENT,sourceScope:old.recipe.sourceScope}]});
 assert.equal(revision.newImageRequests,1);assert.deepEqual(flow.inspectWorkflow(f.workflow).plans.find(p=>p.planSha256===sha),before);assert.equal(before.status,'pending-visual-review');
});

test('fresh pipeline defaults to scoped planning, binds its draft, and keeps legacy project profiles unchanged',t=>{
 const f=setupCoherent(t),profilePath=join(f.root,'coherent-project.json'),ref=JSON.parse(readFileSync(join(f.root,'project.json')));
 // Synthetic historical v1 metadata; no attempt or human-decision records are changed.
 writeFileSync(profilePath,jsonBytes(seal({format:'ai_scene_coherent_project_v1',projectId:ref.projectId,referenceProjectSha256:ref.sha256,policySha256:COHERENT_POLICY.sha256})));writeFileSync(join(f.root,'coherent-policy.json'),jsonBytes(COHERENT_POLICY));
 const legacy=pipeline.advanceCoherentPipeline(f.root);assert.equal(legacy.stage,'awaiting-source-compute');for(const sha of flow.getCoherentSourceBatch(f.workflow,legacy.batchSha256).planSha256s)assert.equal(flow.getGenerationPlan(f.workflow,sha).recipe.intent,'');
 const fresh=join(f.parent,'fresh');const status=pipeline.initCoherentPipeline(fresh,{...coherentBrief('Coral reef cave'),sourceScopes:[{...front,content:'One isolated coral framing cluster.'}]},{purpose:'synthetic-simulation'});assert.equal(status.sourcePlanning.profile,LAYER_SOURCE_INTENT);assert.equal(status.stage,'awaiting-design-review');assert.deepEqual(flow.inspectWorkflow(join(fresh,'workflow')).plans,[]);assert.equal(JSON.parse(readFileSync(join(fresh,'coherent-project.json'))).format,'ai_scene_coherent_project_v4');
 const path=join(fresh,'source-scopes.json'),record=JSON.parse(readFileSync(path));writeFileSync(path,jsonBytes(seal({...unseal(record),subjects:record.subjects.map(s=>s.role==='foreground'?{...s,content:'changed'}:s)})));rejects(()=>pipeline.inspectCoherentPipeline(fresh),'COHERENT_PROJECT');rmSync(path);assert.throws(()=>pipeline.inspectCoherentPipeline(fresh));
});

test('source-scope prompt comparisons are read-only, preserve reference bytes and detect modified preview files',t=>{
 const f=setupCoherent(t),ref=JSON.parse(readFileSync(join(f.root,'project.json')));writeFileSync(join(f.root,'coherent-project.json'),jsonBytes(seal({format:'ai_scene_coherent_project_v1',projectId:ref.projectId,referenceProjectSha256:ref.sha256,policySha256:COHERENT_POLICY.sha256})));writeFileSync(join(f.root,'coherent-policy.json'),jsonBytes(COHERENT_POLICY));
 const before=flow.inspectWorkflow(f.workflow),out=join(f.parent,'scope-review'),review=pipeline.prepareCoherentSourceScopeReview(f.root,out,[front]);assert.equal(review.generationCalls,0);assert.equal(review.frozen,false);assert.equal(review.sources.length,6);assert.deepEqual(readFileSync(join(out,'input-reference.png')),f.raw);assert.deepEqual(flow.inspectWorkflow(f.workflow),before);assert.equal(pipeline.prepareCoherentSourceScopeReview(f.root,out,[front]).sha256,review.sha256);
 const p=review.sources.find(s=>s.role==='foreground');assert.doesNotMatch(readFileSync(join(out,p.afterPrompt),'utf8'),/observed reference envelope/);assert.match(readFileSync(join(out,p.beforePrompt),'utf8'),/observed reference envelope/);writeFileSync(join(out,p.afterPrompt),'changed');rejects(()=>pipeline.prepareCoherentSourceScopeReview(f.root,out,[front]),'PROOF_BUNDLE_RECOMPILE_MISMATCH');assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
});

test('the default driver freezes scoped first sources and exports their full duties before source compute',{timeout:60000},async t=>{
 const f=setupCoherent(t),root=join(f.parent,'new-driver');pipeline.initCoherentPipeline(root,{...coherentBrief('Violet mesa'),sourceScopes:[{...front,content:'One low violet mineral cluster.'}]},{purpose:'synthetic-simulation'});let generated=0;
 const status=await pipeline.driveCoherentPipeline(root,{imageAdapter:{preflight:async()=>{},generate:async()=>{generated++;return referencePng();}},planner:{analyze:async({request})=>coherentAnalysis({sha256:request.planSha256},request.rawSha256,request.requirements)},operator:{
  reviewDesign:async s=>({spec:decision('design.spec',s.design.specSha256),style:decision('design.style',s.design.styleSha256)}),
  approveCompute:async snapshot=>snapshot.plans[0].request.task==='reference'?decision('reference.compute',snapshot.targetSha256,'approve-compute'):null,
  reviewReference:async analyzed=>decision('reference.art',analyzed.packet.packetSha256),
 }});assert.equal(status.stage,'awaiting-source-compute');assert.equal(generated,1);const before=flow.inspectWorkflow(join(root,'workflow')),out=join(f.parent,'source-compute-review'),snapshot=pipeline.exportCoherentComputeReview(root,out),review=JSON.parse(readFileSync(join(out,'source-scope-review.json')));assert(snapshot.plans.every(p=>p.recipe.intent===LAYER_SOURCE_INTENT));assert.equal(review.sources.length,snapshot.plans.length);assert.equal(review.targetSha256,snapshot.targetSha256);assert(review.sources.every(s=>s.layoutUsage==='assembly-only-not-image-prompt'));assert.equal(pipeline.exportCoherentComputeReview(root,out).sha256,snapshot.sha256);assert.deepEqual(flow.inspectWorkflow(join(root,'workflow')),before);rejects(()=>flow.reservePlan(join(root,'workflow'),snapshot.plans[0].sha256),'AUTHORIZATION_REQUIRED');
});
