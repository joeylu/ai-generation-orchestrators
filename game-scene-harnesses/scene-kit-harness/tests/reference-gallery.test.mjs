import test from 'node:test';
import assert from 'node:assert/strict';
import {setupCoherent,sourcePng} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';
import {galleryRaster,galleryBrief,galleryAnalysis,galleryOverrides,galleryObservations,galleryParts} from './helpers/reference-gallery.mjs';
import {createLayerSourceScopes} from '../src/generation/layer-source.mjs';
import {checkReferenceObservationCoverage,assertReferenceObservationCoverage} from '../src/generation/reference-observation-coverage.mjs';
import * as flow from '../src/generation/index.mjs';
import {hash} from '../src/generation/common.mjs';

test('continuous-floor gallery preserves backing and interleaved sources without injecting a canyon or platform',t=>{
 const f=setupCoherent(t,'Synthetic gallery',undefined,{referenceBytes:galleryRaster().png,transformBrief:galleryBrief,transformAnalysis:galleryAnalysis});
 const scopes=createLayerSourceScopes(f.brief.requirements,galleryOverrides),input={...galleryObservations,referenceBytes:f.raw,requirements:f.brief.requirements,sourceScopes:scopes};
 const report=checkReferenceObservationCoverage(input);assert.equal(report.status,'pass');assert.equal(report.semanticCorrectness,'not-assessed');
 const missing={...input,assignments:input.assignments.filter(a=>a.observationId!=='garden.lower')};
 assert.equal(checkReferenceObservationCoverage(missing).status,'fail');assert.throws(()=>assertReferenceObservationCoverage(missing,report));
 const before=flow.inspectWorkflow(f.workflow),options={...f.options,sourceScopes:scopes},preview=flow.previewCoherentSources(f.workflow,options);
 assert.deepEqual(flow.inspectWorkflow(f.workflow),before);assert.equal(preview.plans.length,7);
 assert.deepEqual(preview.plans.map(p=>p.recipe.assetId).sort(),['coherent.material','sky.actual',...galleryParts.map(p=>p.id+'.actual')].sort());
 assert(!preview.plans.some(p=>p.instanceBinding.role==='platform'));assert.equal(f.target.surfaces.length,1);
 const batch=flow.freezeCoherentSources(f.workflow,options);
 for(const part of galleryParts){const plan=preview.plans.find(p=>p.recipe.assetId===part.id+'.actual');assert(plan);
  assert(batch.planSha256s.includes(plan.sha256));assert.deepEqual(flow.getGenerationPlan(f.workflow,plan.sha256),plan);
  assert(plan.request.prompt.includes(part.content));assert.deepEqual(plan.recipe.sourceScope.subjectIds,[part.id]);
  for(const exclusion of part.exclusions)assert(plan.request.prompt.includes(exclusion));
  assert.equal(plan.recipe.sourceScope.framingProfile,'complete-silhouette-v1');
  assert.throws(()=>flow.reservePlan(f.workflow,plan.sha256),e=>e.errors?.some(x=>x.code==='AUTHORIZATION_REQUIRED'));
 }
 assert(flow.inspectWorkflow(f.workflow).plans.filter(p=>p.stage==='coherent-source').every(p=>!p.reserved&&!p.received));
});

test('replacing one received gallery source preserves neighboring results and carries reviewed responsibility to the reserved request',t=>{
 const f=setupCoherent(t,'Synthetic gallery revision',undefined,{referenceBytes:galleryRaster().png,transformBrief:galleryBrief,transformAnalysis:galleryAnalysis});
 const scopes=createLayerSourceScopes(f.brief.requirements,galleryOverrides);
 const batch=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:scopes});
 flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('gallery.original.compute',batch.sha256,'approve-compute'));
 for(const [index,sha]of batch.planSha256s.entries()){
  const {request,...ticket}=flow.reservePlan(f.workflow,sha);flow.recordSubmission(f.workflow,ticket);
  // Synthetic color patches exercise receipt integrity, never semantic/art acceptance.
  assert.equal(flow.receiveResult(f.workflow,ticket,sourcePng(request.output.alpha==='transparent',index)).technical.status,'pass');
 }
 const before=flow.readCoherentWorkflowView(f.workflow),old=before.plans.find(p=>p.recipe.assetId==='outside.actual');
 const addition='Retain connected exposed soil behind the rear sill; its unseen joins are inferred, not measured. No gallery masonry belongs to this source.';
 const excluded='The near column foot and the rear sill stones remain separately editable gallery parts';
 const revisedScopes=createLayerSourceScopes(f.brief.requirements,galleryOverrides.map(o=>o.subjectId==='outside'?{...o,content:o.content+' '+addition,exclusions:[...o.exclusions,excluded]}:o));
 const coverage=checkReferenceObservationCoverage({...galleryObservations,referenceBytes:f.raw,requirements:f.brief.requirements,sourceScopes:revisedScopes});
 assert.equal(coverage.status,'pass');assert.equal(coverage.semanticCorrectness,'not-assessed');
 const proposal=flow.previewCoherentSources(f.workflow,{...f.options,sourceScopes:revisedScopes});
 const reviewed=proposal.plans.find(p=>p.recipe.assetId==='outside.actual');
 const revised=flow.reviseCoherentSources(f.workflow,batch.sha256,{batchId:'gallery.outside.revision',replacements:[{
  assetId:old.recipe.assetId,planId:'gallery.outside.revised',intent:'isolated-layer-v4',sourceScope:reviewed.recipe.sourceScope
 }]});
 const childSha=revised.planSha256s.find(sha=>!batch.planSha256s.includes(sha));
 assert.equal(revised.newImageRequests,1);assert(childSha);
 assert.deepEqual(revised.planSha256s.filter(sha=>sha!==childSha),batch.planSha256s.filter(sha=>sha!==old.sha256));
 const child=flow.getGenerationPlan(f.workflow,childSha);
 assert.deepEqual(child.recipe.parents,[old.sha256]);assert.deepEqual(child.recipe.sourceScope,reviewed.recipe.sourceScope);
 assert.equal(child.request.prompt,reviewed.request.prompt);assert(child.request.prompt.includes(addition));assert(child.request.prompt.includes(excluded));
 assert(child.request.prompt.includes('continuous lower garden ground visible through both openings'));
 assert.deepEqual(child.request.images,old.request.images);
 assert.throws(()=>flow.reservePlan(f.workflow,childSha),e=>e.errors?.some(x=>x.code==='AUTHORIZATION_REQUIRED'));
 assert.throws(()=>flow.authorizeReferenceAssetBatch(f.workflow,revised.sha256,decision('gallery.wrong.target',batch.sha256,'approve-compute')),e=>e.errors?.some(x=>x.code==='AUTHORIZATION_STATE'));
 flow.authorizeReferenceAssetBatch(f.workflow,revised.sha256,decision('gallery.revised.compute',revised.sha256,'approve-compute'));
 const {request,...ticket}=flow.reservePlan(f.workflow,childSha);
 assert.deepEqual(request,child.request);assert.equal(hash(flow.readGenerationInput(f.workflow,childSha,0)),hash(f.raw));
 flow.recordSubmission(f.workflow,ticket);assert.equal(flow.receiveResult(f.workflow,ticket,sourcePng(true,29)).technical.status,'pass');
 const after=flow.readCoherentWorkflowView(f.workflow);
 for(const plan of before.plans)assert.deepEqual(after.plans.find(p=>p.sha256===plan.sha256),plan);
 for(const entry of before.inspection.plans.filter(p=>p.received)){
  const current=after.inspection.plans.find(p=>p.planSha256===entry.planSha256);
  assert.equal(current.rawSha256,entry.rawSha256);assert.equal(current.technicalStatus,entry.technicalStatus);assert.equal(current.status,entry.status);
 }
 assert.equal(after.inspection.plans.find(p=>p.planSha256===childSha).status,'pending-visual-review');
});
