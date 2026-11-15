import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import * as flow from '../src/generation/index.mjs';
import {transact} from '../src/generation/store.mjs';
import {replay} from '../src/generation/model.mjs';
import {compileCoherentBatch} from '../src/generation/coherent-source.mjs';
import {coherentSceneFiles} from '../src/coherent-scene.mjs';
import {COHERENT_SAMPLING} from '../src/coherent-sampling.mjs';
import {encodeRgbaPng,inspectPng} from '../src/png.mjs';
import {hash,seal,unseal} from '../src/generation/common.mjs';
import {setupCoherent,sourcePng} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';

const rejects=fn=>assert.throws(fn,error=>Array.isArray(error.errors));
function receive(workflow,sha,bytes){
  const {request,...ticket}=flow.reservePlan(workflow,sha);
  flow.recordSubmission(workflow,ticket);return flow.receiveResult(workflow,ticket,bytes);
}
function narrowGutterPng(){
  const width=1024,height=512,rgba=Buffer.alloc(width*height*4);
  for(let y=48;y<472;y++)for(let x=24;x<1000;x++)rgba.set([40+x%130,75+y%90,115,255],(y*width+x)*4);
  rgba.set([11,37,241,0],0); // Hidden RGB is not visible gutter content.
  rgba.set([151,83,179,1],(250*width+1)*4); // One-bit native glow remains content.
  rgba.set([61,79,119,127],(49*width+25)*4);
  return encodeRgbaPng(width,height,rgba);
}
function setup(t){
  const f=setupCoherent(t),batch=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:flow.createLayerSourceScopes(f.brief.requirements)});
  flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('audit.sources.compute',batch.sha256,'approve-compute'));
  const raw=narrowGutterPng(),sourceSha=batch.planSha256s[2];
  for(const sha of batch.planSha256s){
    const plan=flow.getGenerationPlan(f.workflow,sha);
    const result=receive(f.workflow,sha,sha===sourceSha?raw:sourcePng(plan.target.alpha==='transparent',17));
    assert.equal(result.technical.status,'pass');
  }
  return {...f,batch,raw,sourceSha};
}
function candidate(f,batch){
  return transact(f.workflow,store=>{
    const state=replay(store),ref=state.plans.get(batch.referencePlanSha256),target=ref.reconstructionTarget;
    const sources=batch.planSha256s.map(sha=>{
      const entry=state.plans.get(sha),original=entry.kind==='coherent-canvas-gutter-preparation'?state.plans.get(entry.plan.sourcePlanSha256):null;
      return {...entry,raw:store.readBlob(entry.result.rawSha256),...(original?{preparation:{record:entry.plan,originalPlan:original.plan,
        originalResult:original.result,originalRaw:store.readBlob(entry.plan.originalRawSha256)}}:{})};
    });
    const composition=seal({format:'ai_scene_coherent_composition_v2',batchSha256:batch.sha256,targetSha256:target.sha256,
      sourceSampling:COHERENT_SAMPLING,transforms:[{instanceId:'landmark.actual',x:-24,y:9,scale:{numerator:2,denominator:1},tint:0xffffff,opacity:1}]});
    return coherentSceneFiles({candidateId:'canvas.gutter.audit',batch,sources,reference:{plan:ref.plan,target,raw:store.readBlob(ref.result.rawSha256)},
      spec:state.designs.get(ref.plan.recipe.specSha256),style:state.designs.get(ref.plan.recipe.styleSha256),composition});
  });
}

test('canvas preview approval cannot transfer across sources, raw bytes or a newer batch',t=>{
  const f=setup(t),first=flow.proposeCoherentCanvasGutterPreparation(f.workflow,f.sourceSha,f.batch.sha256),before=flow.inspectWorkflow(f.workflow);
  const otherSha=f.batch.planSha256s[3],other=flow.proposeCoherentCanvasGutterPreparation(f.workflow,otherSha,f.batch.sha256);
  const transplanted=seal({...unseal(first.proposal),sourcePlanSha256:otherSha});
  rejects(()=>flow.prepareCoherentCanvasGutterSource(f.workflow,{preparationId:'audit.transplanted',proposal:transplanted,receipt:decision('audit.transplant.accept',transplanted.sha256)}));
  rejects(()=>flow.prepareCoherentCanvasGutterSource(f.workflow,{preparationId:'audit.wrong.source.receipt',proposal:other.proposal,receipt:decision('audit.wrong.source.accept',first.proposal.sha256)}));
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
  const rawPath=join(f.workflow,'blobs',hash(f.raw)+'.bin');
  try{
    writeFileSync(rawPath,sourcePng(true,23));
    rejects(()=>flow.proposeCoherentCanvasGutterPreparation(f.workflow,f.sourceSha,f.batch.sha256));
  }finally{writeFileSync(rawPath,f.raw);}
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
  const changedSha=f.batch.planSha256s.at(-1),changed=flow.getGenerationPlan(f.workflow,changedSha);
  const newer=flow.reviseCoherentSources(f.workflow,f.batch.sha256,{batchId:'audit.newer.batch',replacements:[{
    assetId:changed.recipe.assetId,planId:'audit.newer.foreground',intent:flow.LAYER_SOURCE_INTENT,sourceScope:changed.recipe.sourceScope}]});
  const current=flow.proposeCoherentCanvasGutterPreparation(f.workflow,f.sourceSha,newer.sha256);
  assert.notEqual(current.proposal.sha256,first.proposal.sha256);
  const state=flow.inspectWorkflow(f.workflow),blobs=readdirSync(join(f.workflow,'blobs')).sort();
  rejects(()=>flow.prepareCoherentCanvasGutterSource(f.workflow,{preparationId:'audit.historical.parent',proposal:first.proposal,
    receipt:decision('audit.historical.accept',first.proposal.sha256)}));
  rejects(()=>flow.prepareAndAdoptCoherentCanvasGutterSource(f.workflow,{preparationId:'audit.historical.combined',proposal:first.proposal,
    receipt:decision('audit.historical.combined.accept',first.proposal.sha256),parentBatchSha256:f.batch.sha256,batchId:'audit.historical.adoption'}));
  rejects(()=>flow.prepareAndAdoptCoherentCanvasGutterSource(f.workflow,{preparationId:'audit.stale.parent',proposal:first.proposal,
    receipt:decision('audit.stale.accept',first.proposal.sha256),parentBatchSha256:newer.sha256,batchId:'audit.stale.adoption'}));
  rejects(()=>flow.prepareCoherentCanvasGutterSource(f.workflow,{preparationId:'audit.old.receipt',proposal:current.proposal,
    receipt:decision('audit.old.preview.accept',first.proposal.sha256)}));
  assert.deepEqual(flow.inspectWorkflow(f.workflow),state);
  assert.deepEqual(readdirSync(join(f.workflow,'blobs')).sort(),blobs);
});

test('a prepared but unadopted canvas cannot replace a newer source-batch branch',t=>{
  const f=setup(t),preview=flow.proposeCoherentCanvasGutterPreparation(f.workflow,f.sourceSha,f.batch.sha256);
  const prepared=flow.prepareCoherentCanvasGutterSource(f.workflow,{preparationId:'audit.interrupted.preparation',proposal:preview.proposal,
    receipt:decision('audit.interrupted.accept',preview.proposal.sha256)});
  const changedSha=f.batch.planSha256s.at(-1),changed=flow.getGenerationPlan(f.workflow,changedSha);
  const newer=flow.reviseCoherentSources(f.workflow,f.batch.sha256,{batchId:'audit.intervening.batch',replacements:[{
    assetId:changed.recipe.assetId,planId:'audit.intervening.foreground',intent:flow.LAYER_SOURCE_INTENT,sourceScope:changed.recipe.sourceScope}]});
  const before=flow.inspectWorkflow(f.workflow);
  rejects(()=>transact(f.workflow,store=>compileCoherentBatch(replay(store),{batchId:'audit.stale.replay.batch',referencePlanSha256:f.batch.referencePlanSha256,
    parentBatchSha256:f.batch.sha256,planSha256s:f.batch.planSha256s.map(sha=>sha===f.sourceSha?prepared.sha256:sha)})));
  rejects(()=>flow.adoptCoherentPreparedSource(f.workflow,f.batch.sha256,prepared.sha256,'audit.stale.resume.batch'));
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
  assert.equal(flow.getCoherentSourceBatch(f.workflow,newer.sha256).sha256,newer.sha256);
  const fresh=flow.proposeCoherentCanvasGutterPreparation(f.workflow,f.sourceSha,newer.sha256);
  assert.notEqual(fresh.proposal.sha256,preview.proposal.sha256);
  const adopted=flow.prepareAndAdoptCoherentCanvasGutterSource(f.workflow,{preparationId:'audit.new.parent.preparation',proposal:fresh.proposal,
    receipt:decision('audit.new.parent.accept',fresh.proposal.sha256),parentBatchSha256:newer.sha256,batchId:'audit.new.parent.adoption'});
  assert.equal(adopted.record.sourcePlanSha256,f.sourceSha);
  assert.equal(adopted.batch.parentBatchSha256,newer.sha256);
  assert.notEqual(adopted.record.sha256,prepared.sha256,'a new parent requires its own preparation and exact preview acceptance');
});

test('canvas expansion keeps native alpha content, derived pixels and enlarged world placement unchanged',{timeout:180000},t=>{
  const f=setup(t),originalPlan=flow.getGenerationPlan(f.workflow,f.sourceSha),originalResult=flow.getGenerationResult(f.workflow,f.sourceSha);
  const baseline=candidate(f,f.batch),preview=flow.proposeCoherentCanvasGutterPreparation(f.workflow,f.sourceSha,f.batch.sha256);
  const {record,batch}=flow.prepareAndAdoptCoherentCanvasGutterSource(f.workflow,{preparationId:'audit.prepared.landmark',proposal:preview.proposal,
    receipt:decision('audit.exact.preview.accept',preview.proposal.sha256),parentBatchSha256:f.batch.sha256,batchId:'audit.prepared.batch'});
  const prepared=flow.getGenerationResult(f.workflow,record.sha256),a=originalResult.result.technical.contentBounds,b=prepared.result.technical.contentBounds;
  const native=inspectPng(f.raw,{includePixels:true,allowHiddenRgb:true}),expanded=inspectPng(prepared.bytes,{includePixels:true,allowHiddenRgb:true});
  assert.equal(b.width,a.width);assert.equal(b.height,a.height);
  assert(b.x>a.x&&b.y>a.y);const dx=b.x-a.x,dy=b.y-a.y;
  for(let y=0;y<native.height;y++)assert.deepEqual(expanded.rgba.subarray(((y+dy)*expanded.width+dx)*4,((y+dy)*expanded.width+dx+native.width)*4),native.rgba.subarray(y*native.width*4,(y+1)*native.width*4));
  assert.deepEqual([...expanded.rgba.subarray((dy*expanded.width+dx)*4,(dy*expanded.width+dx)*4+4)],[11,37,241,0]);
  assert.deepEqual([...expanded.rgba.subarray(((250+dy)*expanded.width+1+dx)*4,((250+dy)*expanded.width+1+dx)*4+4)],[151,83,179,1]);
  const after=candidate(f,batch),asset='scene.'+originalPlan.recipe.assetId;
  assert.deepEqual(after.files.get('kit/assets/'+asset+'.png'),baseline.files.get('kit/assets/'+asset+'.png'));
  const catalog=files=>JSON.parse(files.get('kit/catalog.json')).modules.find(m=>m.assetId===asset);
  assert.deepEqual(catalog(after.files),catalog(baseline.files));
  const map=files=>JSON.parse(files.get('kit/maps/default.scene.json')).instances.find(i=>i.instanceId===originalPlan.recipe.assetId);
  assert.deepEqual(map(after.files),map(baseline.files));
  const placement=files=>JSON.parse(files.get('evidence/'+originalPlan.recipe.assetId+'-placement.json'));
  const left=placement(baseline.files),right=placement(after.files);
  for(const key of ['outputSize','observedEnvelope','sourceSampling','displayTransform'])assert.deepEqual(right[key],left[key]);
  assert.deepEqual(right.sourceCrop,{...left.sourceCrop,x:left.sourceCrop.x+dx,y:left.sourceCrop.y+dy});
  assert.deepEqual(flow.getGenerationPlan(f.workflow,f.sourceSha),originalPlan);
  assert.deepEqual(flow.getGenerationResult(f.workflow,f.sourceSha),originalResult);
  assert.equal(flow.recheckResult(f.workflow,record.sha256,record.rawSha256).status,'pass');
  const evidence=after.report.sourceEvidence.find(s=>s.preparationSha256===record.sha256);
  assert.equal(evidence.originalTechnicalStatus,'pass');assert.equal(evidence.artAcceptance,'not-assessed');
  assert.equal(after.report.artAcceptance,'not-assessed');assert.equal(after.report.sourcePreparations.hiddenGeometryRestored,false);
  assert.deepEqual(after.files.get('source/original/'+originalPlan.recipe.assetId+'.png'),f.raw);
  flow.reviewResult(f.workflow,f.sourceSha,decision('audit.original.later.accept',originalResult.result.rawSha256));
  assert.equal(flow.inspectWorkflow(f.workflow).plans.find(p=>p.planSha256===f.sourceSha).status,'accepted');
  assert.deepEqual(flow.getGenerationPlan(f.workflow,record.sha256),record);
  assert.equal(flow.recheckResult(f.workflow,record.sha256,record.rawSha256).status,'pass');
  assert.equal(candidate(f,batch).bundle.sha256,after.bundle.sha256,'later original-art acceptance does not rewrite preparation history or transfer to its art review');
});
