import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import * as flow from '../src/generation/index.mjs';
import {loadSceneKit,readMap} from '../src/kit.mjs';
import {compileMap} from '../src/compile.mjs';
import {exportScene,openSceneExport} from '../src/persistence.mjs';
import {assessCoherentSource,COHERENT_POLICY} from '../src/generation/coherent-source.mjs';
import {hash} from '../src/generation/common.mjs';
import {inspectPng,encodeRgbaPng} from '../src/png.mjs';
import {setupCoherent,sourcePng} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';
const rejects=(f,code)=>assert.throws(f,e=>e.errors?.some(v=>v.code===code));
function receiveBatch(f,batch){for(const sha of batch.planSha256s){const p=flow.getGenerationPlan(f.workflow,sha),entry=flow.inspectWorkflow(f.workflow).plans.find(e=>e.planSha256===sha);
  if(entry.received)continue;const {request,...ticket}=flow.reservePlan(f.workflow,sha);flow.recordSubmission(f.workflow,ticket);
  flow.receiveResult(f.workflow,ticket,sourcePng(p.target.alpha==='transparent',p.target.alpha==='opaque'?17:27));}}
test('coherent inventory follows reviewed subjects, produces one exact reference input, and preview is read-only',t=>{
  const f=setupCoherent(t),before=flow.inspectWorkflow(f.workflow),preview=flow.previewCoherentSources(f.workflow,f.options);
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);assert.equal(preview.plans.length,6);assert.equal(preview.batch.maximumCalls,6);
  for(const p of preview.plans){assert.equal(p.format,'ai_scene_generation_plan_v27');assert.equal(p.request.images.length,1);assert.equal(p.request.images[0].artifact.sha256,hash(f.raw));
    assert.equal(p.qualityPolicy.sha256,COHERENT_POLICY.sha256);assert.equal(p.qualityPolicy.pixelIdentityRequired,false);assert.match(p.request.prompt,/Desert sandstone city/);assert.doesNotMatch(p.request.prompt,/snow|forest ruins/i);
    if(p.instanceBinding.instanceId)assert(p.request.prompt.includes('Draw ONLY instance '+p.instanceBinding.instanceId));}
  const batch=flow.freezeCoherentSources(f.workflow,f.options);rejects(()=>flow.reservePlan(f.workflow,batch.planSha256s[0]),'AUTHORIZATION_REQUIRED');
});
test('continuous material planning excludes the complete-scene description that previously leaked unrelated subjects',t=>{
  const f=setupCoherent(t,'Desert sandstone city','Complete composition: unique-palace-marker, sky, valley, two cliffs and a floating platform.');
  const plan=flow.previewCoherentSources(f.workflow,f.options).plans.find(p=>p.instanceBinding.role==='material');
  assert.match(plan.request.prompt,/Desert sandstone city solid ground/);assert.match(plan.request.prompt,/material identity ONLY/);
  assert.doesNotMatch(plan.request.prompt,/unique-palace-marker|ONLY requested subject:/);
});

test('all current sources deterministically become a complete editable kit without historical art, masks or fake art acceptance',{timeout:180000},t=>{
  const f=setupCoherent(t),batch=flow.freezeCoherentSources(f.workflow,f.options);
  flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('sources.compute',batch.sha256,'approve-compute'));receiveBatch(f,batch);
  const out=join(f.parent,'candidate');flow.buildCoherentCandidate(f.workflow,batch.sha256,'coherent.delivery',out);flow.verifyCoherentCandidate(f.workflow,batch.sha256,'coherent.delivery',out);
  const handle=loadSceneKit(join(out,'kit')),map=readMap(handle),scene=compileMap(handle,map);
  assert(scene.counts.terrainNodes>0);assert.equal(map.assemblyInstances.length,1);assert.equal(map.instances.length,4);assert.equal(map.layers.length,5);
  assert.equal(map.instances.find(i=>i.instanceId==='landmark.actual').layerId,'landmark');
  const report=JSON.parse(readFileSync(join(out,'readiness.json')));assert.equal(report.allSourcesFromSameReference,true);assert.equal(report.referenceFallbackPixels,0);assert.equal(report.artAcceptance,'not-assessed');
  for(const s of report.sourceEvidence)assert.equal(s.artAcceptance,'not-assessed');
  const exported=join(f.parent,'export');exportScene(handle,map,exported);assert.equal(openSceneExport(exported).compiled.contentSha256,scene.contentSha256);
});
test('failed or unknown source cannot assemble; a fresh revision reuses only untouched/completed originals',t=>{
  const f=setupCoherent(t),batch=flow.freezeCoherentSources(f.workflow,f.options);flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('sources.compute',batch.sha256,'approve-compute'));
  const first=batch.planSha256s[0],second=batch.planSha256s[1];let e=flow.reservePlan(f.workflow,first),{request,...ticket}=e;flow.recordSubmission(f.workflow,ticket);flow.receiveResult(f.workflow,ticket,sourcePng(false,17));
  e=flow.reservePlan(f.workflow,second);({request,...ticket}=e);flow.recordSubmission(f.workflow,ticket);flow.stopAttempt(f.workflow,ticket,'indeterminate');
  rejects(()=>flow.buildCoherentCandidate(f.workflow,batch.sha256,'bad.delivery',join(f.parent,'bad')),'COHERENT_SOURCES_INCOMPLETE');
  rejects(()=>flow.reservePlan(f.workflow,second),'RESERVATION_STATE');
  const revision=flow.reviseCoherentSources(f.workflow,batch.sha256,{batchId:'coherent.sources.r2',replacements:[{assetId:flow.getGenerationPlan(f.workflow,second).recipe.assetId,planId:'coherent.revised.sky'}]});
  assert.equal(revision.newImageRequests,1);assert.equal(revision.planSha256s[0],first);assert.notEqual(revision.planSha256s[1],second);
  rejects(()=>flow.reservePlan(f.workflow,revision.planSha256s[1]),'AUTHORIZATION_REQUIRED');
  flow.authorizeReferenceAssetBatch(f.workflow,revision.sha256,decision('revised.compute',revision.sha256,'approve-compute'));receiveBatch(f,revision);
  assert.equal(flow.inspectWorkflow(f.workflow).plans.find(p=>p.planSha256===second).status,'indeterminate');
});
test('opaque replacement, reuse of complete reference and changed active style cannot be promoted through coherent policy',t=>{
  const f=setupCoherent(t),preview=flow.previewCoherentSources(f.workflow,f.options),transparent=preview.plans.find(p=>p.target.alpha==='transparent');
  assert(assessCoherentSource(transparent,sourcePng(false,19)).issues.includes('COHERENT_NO_TRANSPARENCY'));
  assert(assessCoherentSource(transparent,f.raw).issues.includes('COHERENT_REFERENCE_REUSE'));
  const batch=flow.freezeCoherentSources(f.workflow,f.options),style=flow.createDesignDraft(f.workflow,{format:'ai_scene_style_v2',styleId:'changed.style',mode:'preset',name:'Changed',rules:['Different style.'],anchors:[]});
  flow.reviewDesign(f.workflow,'style',decision('changed.style.accept',style.sha256));
  rejects(()=>flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('stale.compute',batch.sha256,'approve-compute')),'PLAN_STALE');
});
test('one-bit native edge speckle is diagnostic without rewriting; real clipped silhouettes still fail',t=>{
  const f=setupCoherent(t),p=flow.previewCoherentSources(f.workflow,f.options).plans.find(p=>p.target.alpha==='transparent'),image=inspectPng(sourcePng(true,22),{includePixels:true});
  image.rgba.set([80,90,100,1],0);const bytes=encodeRgbaPng(image.width,image.height,image.rgba),before=Buffer.from(bytes),qa=assessCoherentSource(p,bytes);
  assert.equal(qa.status,'pass');assert.equal(qa.edgeMaximumAlpha,1);assert.equal(qa.sourcePngModified,false);assert.deepEqual(bytes,before);
  image.rgba[3]=2;assert(assessCoherentSource(p,encodeRgbaPng(image.width,image.height,image.rgba)).issues.includes('COHERENT_CLIPPED_SILHOUETTE'));
});

test('a clipped foreground may plan a bounded framing-v2 revision without altering the old request, QA or completed sources',t=>{
  const f=setupCoherent(t),batch=flow.freezeCoherentSources(f.workflow,f.options);
  flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('first.batch',batch.sha256,'approve-compute'));
  const failed=batch.planSha256s.at(-1),old=flow.getGenerationPlan(f.workflow,failed),oldBytes=JSON.stringify(old);
  const clipped=inspectPng(sourcePng(true,27),{includePixels:true});clipped.rgba.set([140,70,20,254],(clipped.width-1)*4);
  const clippedBytes=encodeRgbaPng(clipped.width,clipped.height,clipped.rgba);
  for(const sha of batch.planSha256s){const p=flow.getGenerationPlan(f.workflow,sha),{request,...ticket}=flow.reservePlan(f.workflow,sha);flow.recordSubmission(f.workflow,ticket);
    flow.receiveResult(f.workflow,ticket,sha===failed?clippedBytes:sourcePng(p.target.alpha==='transparent',17));}
  assert.equal(flow.inspectWorkflow(f.workflow).plans.find(p=>p.planSha256===failed).status,'rejected-technical');
  const revision=flow.reviseCoherentSources(f.workflow,batch.sha256,{batchId:'framing.revision',replacements:[{assetId:old.recipe.assetId,planId:'framing.foreground.r2',intent:'complete-framing-v2'}]});
  assert.equal(revision.newImageRequests,1);assert.deepEqual(revision.planSha256s.slice(0,-1),batch.planSha256s.slice(0,-1));
  const next=flow.getGenerationPlan(f.workflow,revision.planSha256s.at(-1));assert.match(next.request.prompt,/^SOURCE FRAMING V2:/);assert.match(next.request.prompt,/12 percent/);
  assert.deepEqual(next.request.images,old.request.images);assert.deepEqual(next.qualityPolicy,old.qualityPolicy);assert.equal(JSON.stringify(flow.getGenerationPlan(f.workflow,failed)),oldBytes);
  assert(assessCoherentSource(next,clippedBytes).issues.includes('COHERENT_CLIPPED_SILHOUETTE'));
  rejects(()=>flow.reservePlan(f.workflow,next.sha256),'AUTHORIZATION_REQUIRED');
  flow.authorizeReferenceAssetBatch(f.workflow,revision.sha256,decision('framing.compute',revision.sha256,'approve-compute'));
  const {request,...ticket}=flow.reservePlan(f.workflow,next.sha256);flow.recordSubmission(f.workflow,ticket);flow.receiveResult(f.workflow,ticket,sourcePng(true,22));
  const state=flow.inspectWorkflow(f.workflow);assert.equal(state.plans.find(p=>p.planSha256===failed).status,'rejected-technical');assert.equal(state.plans.find(p=>p.planSha256===next.sha256).status,'pending-visual-review');
});

test('isolated foreground v3 uses an explicit asset brief and style-only image without scene envelope or paired subject leakage',t=>{
  const f=setupCoherent(t),batch=flow.freezeCoherentSources(f.workflow,f.options);
  flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('source.first',batch.sha256,'approve-compute'));
  const sha=batch.planSha256s.at(-1),old=flow.getGenerationPlan(f.workflow,sha),oldText=JSON.stringify(old);
  const {request,...ticket}=flow.reservePlan(f.workflow,sha);flow.recordSubmission(f.workflow,ticket);flow.stopAttempt(f.workflow,ticket,'indeterminate');
  const subjectBrief={content:'One shallow pile of loose dark sandstone rocks with a sparse dry branch.',exclusions:['Main cliff wall','Continuous playable platform','Background city']};
  const next=flow.reviseCoherentSources(f.workflow,batch.sha256,{batchId:'isolated.foreground.r3',replacements:[{
    assetId:old.recipe.assetId,planId:'isolated.foreground.right.r3',intent:'isolated-foreground-v3',subjectBrief}]});
  const p=flow.getGenerationPlan(f.workflow,next.planSha256s.at(-1));
  assert.equal(next.newImageRequests,1);assert.equal(p.compiler,'scene-kit-coherent-isolated-foreground-v3');
  assert.match(p.request.prompt,/ENTIRE output subject is: One shallow pile/);
  assert.match(p.request.prompt,/STYLE-ONLY/);assert.match(p.request.prompt,/wrong source, even if the PNG is transparent/);
  assert.doesNotMatch(p.request.prompt,/observed reference envelope|Draw ONLY instance|ONLY requested subject|Desert sandstone city framing rocks/);
  assert(!p.request.prompt.includes(JSON.stringify(old.instanceBinding.observedEnvelope)));
  assert.equal(p.request.images[0].role,'accepted-scene-style-only-reference');assert.deepEqual(p.request.images[0].artifact,old.request.images[0].artifact);
  assert.equal(p.sourceScope.alphaCleanupAllowed,false);assert.equal(p.sourceScope.semanticIsolationProven,false);
  assert.equal(p.visualReviewChecklist.automatedSemanticDetection,false);
  assert.equal(JSON.stringify(flow.getGenerationPlan(f.workflow,sha)),oldText);
  rejects(()=>flow.reservePlan(f.workflow,p.sha256),'AUTHORIZATION_REQUIRED');
});

test('isolated foreground alternatives keep technically received predecessor reviews unchanged and need fresh compute',t=>{
  const f=setupCoherent(t),batch=flow.freezeCoherentSources(f.workflow,f.options);
  flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('initial.source.compute',batch.sha256,'approve-compute'));
  const priorSha=batch.planSha256s.at(-1),prior=flow.getGenerationPlan(f.workflow,priorSha);
  const {request,...ticket}=flow.reservePlan(f.workflow,priorSha);flow.recordSubmission(f.workflow,ticket);
  flow.receiveResult(f.workflow,ticket,sourcePng(true,27));
  const previous=flow.inspectWorkflow(f.workflow).plans.find(p=>p.planSha256===priorSha);
  assert.equal(previous.status,'pending-visual-review');
  rejects(()=>flow.reviseCoherentSources(f.workflow,batch.sha256,{batchId:'old.mode.alternative',replacements:[{
    assetId:prior.recipe.assetId,planId:'old.mode.alternative.plan',intent:'complete-framing-v2'}]}),'PLAN_PARENT');
  const revised=flow.reviseCoherentSources(f.workflow,batch.sha256,{batchId:'new.isolated.alternative',replacements:[{
    assetId:prior.recipe.assetId,planId:'new.isolated.alternative.plan',intent:'isolated-foreground-v3',
    subjectBrief:{content:'One low loose-rock decoration with dry branches.',exclusions:['Playable cliff wall','Continuous platform cap']}}]});
  assert.equal(revised.newImageRequests,1);assert.deepEqual(revised.planSha256s.slice(0,-1),batch.planSha256s.slice(0,-1));
  const next=flow.getGenerationPlan(f.workflow,revised.planSha256s.at(-1));
  assert.equal(next.sourceScope.predecessorArtDecisionUnchanged,true);
  assert.deepEqual(flow.inspectWorkflow(f.workflow).plans.find(p=>p.planSha256===priorSha),previous);
  rejects(()=>flow.reservePlan(f.workflow,next.sha256),'AUTHORIZATION_REQUIRED');
});
