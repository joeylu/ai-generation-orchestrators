import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as pipeline from '../src/coherent-pipeline.mjs';
import * as flow from '../src/generation/index.mjs';
import {coherentBrief,coherentAnalysis,referencePng,sourcePng} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';
import {seal,hash,unseal} from '../src/generation/common.mjs';

function pending(){
  const root=join(mkdtempSync(join(tmpdir(),'scene-observed-design-')),'project'),brief=coherentBrief();
  let state=pipeline.initCoherentPipeline(root,brief,{purpose:'synthetic-simulation'});
  pipeline.reviewCoherentDesign(root,{spec:decision('spec',state.design.specSha256),style:decision('style',state.design.styleSha256)});
  state=pipeline.inspectCoherentPipeline(root);const original=state.reference.planSha256,workflow=join(root,'workflow');
  pipeline.authorizeCoherentStage(root,decision('compute',original,'approve-compute'));
  const {request,...ticket}=flow.reservePlan(workflow,original);flow.recordSubmission(workflow,ticket);
  const raw=referencePng();flow.receiveResult(workflow,ticket,raw);
  const req=unseal(brief.requirements);req.subjects.push({subjectId:'observed-tree',role:'scenery',layerId:'landmark',content:'One observed tree',count:{min:1,max:1},placementHint:'left'});
  const input={revisionId:'observed.r1',requirements:req,sourceScopes:[]};
  return {root,workflow,input,raw,original};
}
test('same-project observed decomposition preserves attempts and bytes and requires a new reference review',()=>{
  const f=pending(),before=flow.inspectWorkflow(f.workflow),originalFiles=['coherent-project.json','project.json','spec-draft.json','source-scopes.json'].map(n=>[n,readFileSync(join(f.root,n))]);
  const proposal=pipeline.previewObservedReferenceDesign(f.root,f.input);
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
  const state=pipeline.adoptObservedCoherentReferenceDesign(f.root,f.input,decision('observed.spec',proposal.spec.sha256));
  assert.equal(state.projectId,before.projectId);assert.equal(state.stage,'awaiting-reference-review');assert.equal(state.batchSha256,null);
  assert.equal(state.reference.maximumCalls,0);assert.equal(state.reference.reserved,false);assert.equal(state.reference.rawSha256,hash(f.raw));
  const old=flow.inspectWorkflow(f.workflow).plans.find(p=>p.planSha256===f.original);
  assert.equal(old.current,false);assert.equal(old.reserved,true);assert.equal(old.status,'pending-visual-review');
  for(const[n,b]of originalFiles)assert.deepEqual(readFileSync(join(f.root,n)),b);
  assert.throws(()=>pipeline.adoptObservedCoherentReferenceDesign(f.root,f.input,decision('again',proposal.spec.sha256)));
  const plan=flow.getGenerationPlan(f.workflow,state.reference.planSha256),analysis=unseal(coherentAnalysis(plan,hash(f.raw),proposal.spec.requirements));
  analysis.instances.push({instanceId:'tree.actual',subjectId:'observed-tree',layerId:'landmark',visibleEnvelope:[{x:1,y:1},{x:30,y:1},{x:30,y:70},{x:1,y:70}],anchor:{x:15,y:35},visibility:'visible',anchorEvidence:'observed',notes:'Synthetic newly observed tree.'});
  const observed=seal(analysis),packet=pipeline.prepareCoherentReferenceReview(f.root,observed,join(f.root,'review'));
  const reviewed=pipeline.reviewCoherentReference(f.root,observed,decision('observed.review',packet.packetSha256),{deferObservationCoverage:true});
  assert.equal(reviewed.stage,'source-batch-needed');assert.throws(()=>pipeline.advanceCoherentPipeline(f.root));
  const path=join(f.root,'observed-reference-design.json'),saved=readFileSync(path);
  // A forged provenance digest with a valid outer seal must still fail journal binding.
  const forged=unseal(JSON.parse(saved));forged.rawSha256='f'.repeat(64);writeFileSync(path,JSON.stringify(seal(forged)));assert.throws(()=>pipeline.inspectCoherentPipeline(f.root));writeFileSync(path,saved);
});
test('wrong decision and changed standards fail before journal writes',()=>{
  const f=pending(),before=flow.inspectWorkflow(f.workflow);
  assert.throws(()=>pipeline.adoptObservedCoherentReferenceDesign(f.root,f.input,decision('wrong','f'.repeat(64))));
  const changed=structuredClone(f.input);changed.requirements.standards[0].requirement='Relaxed';
  assert.throws(()=>pipeline.previewObservedReferenceDesign(f.root,changed));
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
});

test('late decomposition starts from a settled batch, gates fresh planning and rebinds unchanged local sources without compute', {timeout:120000},()=>{
  const f=pending(),oldPlan=flow.getGenerationPlan(f.workflow,f.original);
  const originalAnalysis=coherentAnalysis(oldPlan,hash(f.raw),coherentBrief().requirements);
  const reviewed=pipeline.prepareCoherentReferenceReview(f.root,originalAnalysis,join(f.root,'original-review'));
  const planned=pipeline.reviewCoherentReference(f.root,originalAnalysis,decision('original.review',reviewed.packetSha256));
  const input={...f.input,parentBatchSha256:planned.batchSha256};
  assert.throws(()=>pipeline.previewObservedReferenceDesign(f.root,input));
  pipeline.authorizeCoherentStage(f.root,decision('original.sources',planned.batchSha256,'approve-compute'));
  const oldBatch=flow.getCoherentSourceBatch(f.workflow,planned.batchSha256);
  for(const [index,sha] of oldBatch.planSha256s.entries()){
    const {request,...ticket}=flow.reservePlan(f.workflow,sha);flow.recordSubmission(f.workflow,ticket);
    flow.receiveResult(f.workflow,ticket,sourcePng(request.output.alpha==='transparent',index+1));
  }
  const proposal=pipeline.previewObservedReferenceDesign(f.root,input);
  const adopted=pipeline.adoptObservedCoherentReferenceDesign(f.root,input,decision('late.spec',proposal.spec.sha256));
  assert.equal(adopted.reference.rawSha256,hash(f.raw));assert.equal(adopted.reference.maximumCalls,0);
  const plan=flow.getGenerationPlan(f.workflow,adopted.reference.planSha256);
  const layout=unseal(coherentAnalysis(plan,hash(f.raw),proposal.spec.requirements));
  layout.instances.push({instanceId:'tree.actual',subjectId:'observed-tree',layerId:'landmark',visibleEnvelope:[{x:1,y:1},{x:30,y:1},{x:30,y:70},{x:1,y:70}],anchor:{x:15,y:35},visibility:'visible',anchorEvidence:'observed',notes:'Synthetic newly observed tree.'});
  const analysis=seal(layout),packet=pipeline.prepareCoherentReferenceReview(f.root,analysis,join(f.root,'late-review'));
  const receipt=decision('late.reference',packet.packetSha256);
  assert.throws(()=>pipeline.reviewCoherentReference(f.root,analysis,receipt));
  pipeline.reviewCoherentReference(f.root,analysis,receipt,{deferObservationCoverage:true});
  assert.throws(()=>pipeline.advanceCoherentPipeline(f.root));
  const tree=proposal.sourceScopes.subjects.find(s=>s.subjectId==='observed-tree');
  const observation={observationId:'tree.visible',description:tree.content,layerId:tree.layerId,parentRole:tree.parentRole};
  assert.equal(pipeline.checkCoherentObservationCoverage(f.root,{requiredObservationIds:['tree.visible'],observations:[observation],
    assignments:[{observationId:'tree.visible',subjectId:tree.subjectId,scopeQuote:tree.content}]}).status,'pass');
  const next=pipeline.advanceCoherentPipeline(f.root);
  assert.equal(next.stage,'awaiting-source-compute');
  assert.throws(()=>pipeline.previewLateCoherentSourceReuse(f.root,'tree.actual'));
  const reuse=pipeline.previewLateCoherentSourceReuse(f.root,'sky.actual');
  const rebound=pipeline.adoptLateCoherentSourceReuse(f.root,'sky.actual',{proposal:reuse,
    receipt:decision('late.sky.accept',reuse.sha256),rebindId:'late.sky.reuse',batchId:'late.with.sky'});
  assert.equal(rebound.record.request.maximumCalls,0);
  assert.equal(flow.getGenerationResult(f.workflow,rebound.record.sha256).result.rawSha256,reuse.rawSha256);
  assert.deepEqual(flow.getCoherentSourceBatch(f.workflow,planned.batchSha256),oldBatch);
});
