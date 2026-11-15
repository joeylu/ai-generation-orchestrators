import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import * as flow from '../src/generation/index.mjs';
import {proposeCoherentRebind,commitCoherentRebind} from '../src/generation/index.mjs';
import {hash,jsonBytes,seal,unseal} from '../src/generation/common.mjs';
import {setupCoherent,sourcePng,coherentSurfaceObservations} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';
import {prepareTerrainEdgeComputeReview,buildTerrainEdgeDelivery,verifyTerrainEdgeDelivery} from '../src/terrain-edge-pipeline.mjs';
import {coherentComputeSnapshot,exportCoherentComputeReview,coherentSurfaceInputs,prepareCoherentSurfaceReview,deliverCoherentPipeline,verifyCoherentDelivery} from '../src/coherent-pipeline.mjs';
import {COHERENT_POLICY} from '../src/generation/coherent-source.mjs';
import {nativeFixtures} from './helpers/terrain-edge-delivery.mjs';
import {inspectPng} from '../src/png.mjs';
import {spawn} from 'node:child_process';

// Ten roles simulate eight previously received sources plus two independent
// fresh plans. Every PNG and every review is a synthetic offline fixture.
const count=4;
const polygon=(x,y,w,h)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
function scene(t,change=false){
  const transformBrief=brief=>{
    const req=unseal(brief.requirements);
    brief.requirements=seal({...req,subjects:[...req.subjects,...Array.from({length:count},(_,i)=>({
      subjectId:`extra.${i}`,role:'scenery',layerId:'landmark',content:`Synthetic isolated scenery ${i} only`,
      count:{min:1,max:1},placementHint:'center'}))]});return brief;
  };
  const transformAnalysis=analysis=>{const body=unseal(analysis);
    if(change)body.instances.find(i=>i.instanceId==='landmark.actual').anchor.x+=1;
    body.instances.push(...Array.from({length:count},(_,i)=>({instanceId:`extra.${i}.actual`,subjectId:`extra.${i}`,
      layerId:'landmark',visibleEnvelope:polygon(20+i*30,20,20,20),anchor:{x:30+i*30,y:30},
      visibility:'visible',anchorEvidence:'observed',notes:'Synthetic independently observed envelope.'})));
    return seal(body);
  };
  const f=setupCoherent(t,undefined,undefined,{transformBrief,transformAnalysis});
  const batch=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:flow.createLayerSourceScopes(f.brief.requirements)});
  assert.equal(batch.planSha256s.length,10);return {...f,batch};
}
const targetOptions=(source,target,i)=>{const p=flow.getGenerationPlan(target.workflow,target.batch.planSha256s[i]);
  return {sourceWorkflow:source.workflow,sourcePlanSha256:source.batch.planSha256s[i],targetPlanSha256:p.sha256,
    targetSha256:p.recipe.targetSha256,scopeSha256:p.sourceScope.definition.sha256};};
const rejects=(action,code)=>assert.throws(action,e=>e.errors?.some(x=>x.code===code),code);

test('eight reviewed zero-call sources plus two new single-use attempts reach a checked mixed batch',{timeout:1200000},t=>{
  const old=scene(t),next=scene(t,true),sourceStateBefore=flow.inspectWorkflow(old.workflow);
  flow.authorizeReferenceAssetBatch(old.workflow,old.batch.sha256,decision('old.batch.compute',old.batch.sha256,'approve-compute'));
  const inputs=[],oldAttempts=[];
  for(let i=0;i<8;i++){
    const sha=old.batch.planSha256s[i],plan=flow.getGenerationPlan(old.workflow,sha),bytes=sourcePng(plan.target.alpha==='transparent',20+i);
    const {request,...ticket}=flow.reservePlan(old.workflow,sha);oldAttempts.push(ticket.attemptSha256);flow.recordSubmission(old.workflow,ticket);
    assert.equal(flow.receiveResult(old.workflow,ticket,bytes).technical.status,'pass');inputs.push(bytes);
  }
  const oldReceived=flow.inspectWorkflow(old.workflow),oldEvents=oldReceived.eventCount;
  assert(oldEvents>sourceStateBefore.eventCount);
  let parent=next.batch;
  for(let i=0;i<8;i++){
    const opts=targetOptions(old,next,i),candidate=proposeCoherentRebind(next.workflow,opts),proposal=candidate.proposal;
    assert.deepEqual(candidate.bytes,inputs[i]);assert.equal(proposal.generationCalls,0);
    assert.equal(proposal.review,'required');assert.equal(proposal.sourceVisualAcceptance,'not-transferred');
    const options={...opts,proposal,rebindId:`rebind.source.${i}`,parentBatchSha256:parent.sha256,batchId:`rebind.batch.${i}`};
    if(i===0){
      const before=flow.inspectWorkflow(next.workflow).eventCount;
      rejects(()=>commitCoherentRebind(next.workflow,{...options,receipt:decision('wrong.review','f'.repeat(64))}),'REBIND_REVIEW');
      assert.equal(flow.inspectWorkflow(next.workflow).eventCount,before);
    }
    if(i===1){
      assert.throws(()=>commitCoherentRebind(next.workflow,{...options,receipt:decision('rebind.review.0',proposal.sha256)}));
      assert.throws(()=>commitCoherentRebind(next.workflow,{...options,parentBatchSha256:next.batch.sha256,
        receipt:decision('stale.parent.review',proposal.sha256)}));
    }
    const out=commitCoherentRebind(next.workflow,{...options,receipt:{...decision(`rebind.review.${i}`,proposal.sha256),
      notes:'PRIVATE_REBIND_NOTE_SENTINEL'}});
    assert.equal(out.record.request.maximumCalls,0);assert.equal(out.record.rawSha256,hash(inputs[i]));
    assert.equal(out.batch.newImageRequests,0);parent=out.batch;
    if(i===0){
      const after=flow.inspectWorkflow(next.workflow).eventCount;
      assert.throws(()=>commitCoherentRebind(next.workflow,{...options,receipt:decision('repeat.review',proposal.sha256)}));
      assert.equal(flow.inspectWorkflow(next.workflow).eventCount,after);
    }
    assert.doesNotMatch(JSON.stringify({record:out.record,batch:out.batch}),/attemptSha|authorizationSha|workflowPath|ticket|transport|nonce/i);
  }
  assert.equal(parent.format,'ai_scene_coherent_source_batch_v3');
  assert.equal(parent.maximumCalls,2);
  // Reuse the historical synthetic project wrapper so the production compute
  // review path is exercised against this real mixed batch.
  const project=JSON.parse(readFileSync(join(next.root,'project.json'),'utf8'));
  writeFileSync(join(next.root,'coherent-project.json'),jsonBytes(seal({format:'ai_scene_coherent_project_v1',projectId:project.projectId,
    referenceProjectSha256:project.sha256,policySha256:COHERENT_POLICY.sha256})));
  writeFileSync(join(next.root,'coherent-policy.json'),jsonBytes(COHERENT_POLICY));
  const compute=coherentComputeSnapshot(next.root),computeDir=join(next.parent,'rebound-compute-review');
  assert.equal(compute.preparedSources.length,8);assert.equal(compute.maximumCalls,2);
  for(const item of compute.preparedSources){assert.equal(item.format,'ai_scene_coherent_rebind_compute_evidence_v1');
    assert(parent.planSha256s.includes(item.rebindSha256));assert.equal(item.request.maximumCalls,0);}
  assert.equal(exportCoherentComputeReview(next.root,computeDir).sha256,compute.sha256);
  for(const file of readdirSync(computeDir).filter(p=>p.endsWith('.json'))){const content=readFileSync(join(computeDir,file),'utf8');
    assert.doesNotMatch(content,/PRIVATE_REBIND_NOTE_SENTINEL|rebind\.review\.\d|"(?:receipt|notes|authorizationSha256|attemptSha256|workflowPath|ticket|transport|nonce)"/i,file);
    for(const attempt of oldAttempts)assert(!content.includes(attempt),`old attempt leaked into ${file}`);}
  const status=flow.inspectWorkflow(next.workflow);
  assert.equal(status.plans.filter(x=>x.stage==='coherent-source'&&x.reserved).length,0);
  const fresh=parent.planSha256s.slice(8);assert.equal(fresh.length,2);
  flow.authorizeReferenceAssetBatch(next.workflow,parent.sha256,decision('new.batch.compute',parent.sha256,'approve-compute'));
  for(const [i,sha] of fresh.entries()){
    const p=flow.getGenerationPlan(next.workflow,sha),{request,...ticket}=flow.reservePlan(next.workflow,sha);
    flow.recordSubmission(next.workflow,ticket);
    assert.equal(flow.receiveResult(next.workflow,ticket,sourcePng(true,60+i)).technical.status,'pass');
    assert.throws(()=>flow.reservePlan(next.workflow,sha));
  }
  const completed=flow.inspectWorkflow(next.workflow);
  assert.equal(completed.plans.filter(x=>x.stage==='coherent-source'&&x.reserved).length,2);
  assert.deepEqual(flow.inspectWorkflow(old.workflow),oldReceived);
  // A target-side art decision is separate from the rebind proposal. Freeze a
  // guided plan before it, then replay after the target's own result review.
  const materialSha=parent.planSha256s[0],material=flow.getGenerationResult(next.workflow,materialSha),guidedOptions={
    batchId:'rebind.guide.before.review',baseBatchSha256:parent.sha256,capabilitiesSha256:next.options.capabilitiesSha256,
    coverageProfile:'full-perimeter-v1',coverageIntent:'explicit-subset-replacement',nativeSizeProfile:'bounded-native-4m-v1',
    renderEnvelopeProfile:'visible-alpha8-outward16-native-rgba-v1',naturalSurfaceProfile:'reference-defined-cover-v1',
    topologyGuideProfile:flow.TERRAIN_EDGE_TOPOLOGY_PROFILE,
    items:[{assetId:'rebind.guide.left',role:'left-bottom-corner',content:'Synthetic lower corner.',exclusions:['Unrelated geometry']}]};
  const beforeBatch=flow.freezeTerrainEdgeSources(next.workflow,guidedOptions),beforePlan=flow.getGenerationPlan(next.workflow,beforeBatch.planSha256s[0]);
  assert.equal(beforePlan.materialEvidence.artAcceptance,'not-assessed');
  flow.reviewResult(next.workflow,materialSha,decision('target.material.independent.review',material.result.rawSha256));
  assert.deepEqual(flow.getGenerationPlan(next.workflow,beforePlan.sha256),beforePlan);
  const after=flow.previewTerrainEdgeSources(next.workflow,{...guidedOptions,batchId:'rebind.guide.after.review'}).plans[0];
  assert.equal(after.materialEvidence.artAcceptance,'accepted');assert.notEqual(after.sha256,beforePlan.sha256);
  assert.deepEqual(flow.getGenerationPlan(next.workflow,beforePlan.sha256),beforePlan);
  // Replaying the destination proves persisted source records and blobs remain
  // valid; it does not grant visual acceptance or pretend the sources were generated.
  assert.doesNotThrow(()=>flow.inspectWorkflow(next.workflow));
  const out=join(next.parent,'rebound-candidate');
  flow.buildCoherentCandidate(next.workflow,parent.sha256,'rebind.candidate',out);
  flow.verifyCoherentCandidate(next.workflow,parent.sha256,'rebind.candidate',out);
  const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]);
  for(const file of walk(out).filter(p=>p.endsWith('.json'))){
    const exported=readFileSync(file,'utf8');
    assert.doesNotMatch(exported,/"(?:authorizationSha256|nonce|workflowPath|ticket|transport)"/i,file);
    for(const attempt of oldAttempts)assert(!exported.includes(attempt),`old attempt leaked into ${file}`);
  }
  const surfaceInput=coherentSurfaceInputs(next.root);
  assert.equal(surfaceInput.batch.sha256,parent.sha256);assert.deepEqual(surfaceInput.material.raw,inputs[0]);
  const surfaceDir=join(next.parent,'rebound-surface-review');
  const surface=prepareCoherentSurfaceReview(next.root,coherentSurfaceObservations(),surfaceDir);
  assert.equal(surface.materialRawSha256,hash(inputs[0]));assert.equal(surface.generationCalls,0);
  assert.equal(surface.artAcceptance,'not-assessed');assert.deepEqual(readFileSync(join(surfaceDir,'material-native.png')),inputs[0]);
  const composition=JSON.parse(readFileSync(join(surfaceDir,'composition-profile.json'),'utf8'));
  const coherentDir=join(next.parent,'rebound-coherent-delivery');
  const delivery=deliverCoherentPipeline(next.root,coherentDir,{composition});
  assert.equal(delivery.finalHumanArtReview,'pending');assert.equal(delivery.generationCalls,0);
  assert.equal(verifyCoherentDelivery(next.root,coherentDir).status,'verified');
  const edgeOptions={batchId:'rebind.edge.preview',baseBatchSha256:parent.sha256,capabilitiesSha256:next.options.capabilitiesSha256,
    items:flow.TERRAIN_EDGE_ROLES.map((role,i)=>({assetId:`rebind.edge.${i}`,role,content:`Synthetic ${role} native edge.`,exclusions:['Independent props']}))};
  const preview=flow.previewTerrainEdgeSources(next.workflow,edgeOptions);
  assert.equal(preview.generationCalls,0);assert.equal(preview.executable,false);
  assert.doesNotMatch(JSON.stringify(preview),/"(?:attemptSha256|authorizationSha256|nonce|workflowPath|ticket|transport)"/i);
  const edges=flow.freezeTerrainEdgeSources(next.workflow,edgeOptions),beforeReview=flow.inspectWorkflow(next.workflow);
  const reviewDir=join(next.parent,'rebound-edge-compute-review');
  const review=prepareTerrainEdgeComputeReview(next.workflow,edges.sha256,reviewDir);
  assert.equal(review.generationCalls,0);assert.equal(review.maximumCalls,flow.TERRAIN_EDGE_ROLES.length);
  assert.equal(review.computeAuthorizationIncluded,false);assert.equal(review.existingAuthorizationsReused,false);
  assert.deepEqual(readFileSync(join(reviewDir,'input-2.png')),inputs[0]);
  assert.deepEqual(flow.inspectWorkflow(next.workflow),beforeReview);
  flow.authorizeReferenceAssetBatch(next.workflow,edges.sha256,decision('synthetic.edge.compute',edges.sha256,'approve-compute'));
  const native=nativeFixtures('autumn',255);
  for(const sha of edges.planSha256s){const p=flow.getGenerationPlan(next.workflow,sha),{request,...ticket}=flow.reservePlan(next.workflow,sha);
    flow.recordSubmission(next.workflow,ticket);
    assert.equal(flow.receiveResult(next.workflow,ticket,native.raws.get(p.recipe.edgeRole)).technical.status,'pass');}
  const edgeDelivery={workflow:next.workflow,baseKitRoot:join(coherentDir,'candidate/kit'),batchSha256:edges.sha256,
    controls:native.controls,output:join(next.parent,'rebound-edge-delivery')};
  const edgeReport=buildTerrainEdgeDelivery(edgeDelivery);
  assert.equal(edgeReport.generationCalls,0);assert.equal(edgeReport.finalHumanArtReview,'pending');
  assert.equal(verifyTerrainEdgeDelivery(edgeDelivery).status,'verified');
  // A subsequent generated source may be complete yet need a transparent
  // canvas expansion. This remains a zero-call, separately reviewed operation.
  const sourceSha=fresh[0],original=flow.getGenerationResult(next.workflow,sourceSha),
    beforeGutter=flow.inspectWorkflow(next.workflow),gutterPreview=flow.proposeCoherentCanvasGutterPreparation(next.workflow,sourceSha,parent.sha256);
  assert.equal(gutterPreview.proposal.format,'ai_scene_coherent_canvas_gutter_proposal_v1');
  assert.equal(gutterPreview.proposal.maximumNewImageCalls,0);assert.deepEqual(flow.inspectWorkflow(next.workflow),beforeGutter);
  const oldPng=inspectPng(original.bytes,{includePixels:true,allowHiddenRgb:true}),newPng=inspectPng(gutterPreview.bytes,{includePixels:true,allowHiddenRgb:true}),
    {x:dx,y:dy}=gutterPreview.proposal.contentOffset;
  for(let y=0;y<oldPng.height;y++)assert.deepEqual(newPng.rgba.subarray(((y+dy)*newPng.width+dx)*4,((y+dy)*newPng.width+dx+oldPng.width)*4),
    oldPng.rgba.subarray(y*oldPng.width*4,(y+1)*oldPng.width*4));
  const padded=flow.prepareAndAdoptCoherentCanvasGutterSource(next.workflow,{preparationId:'synthetic.gutter',proposal:gutterPreview.proposal,
    receipt:decision('synthetic.gutter.review',gutterPreview.proposal.sha256),parentBatchSha256:parent.sha256,batchId:'synthetic.gutter.batch'});
  assert.equal(padded.record.request.maximumCalls,0);assert.equal(padded.batch.format,'ai_scene_coherent_source_batch_v3');
  assert.equal(padded.batch.parentBatchSha256,parent.sha256);
  assert.deepEqual(padded.batch.planSha256s,parent.planSha256s.map(sha=>sha===sourceSha?padded.record.sha256:sha));
  assert.deepEqual(flow.getGenerationResult(next.workflow,sourceSha),original);
  assert.deepEqual(flow.getGenerationResult(next.workflow,padded.record.sha256).bytes,gutterPreview.bytes);
  assert.deepEqual(flow.getCoherentSourceBatch(next.workflow,padded.batch.sha256),padded.batch);
  assert.doesNotThrow(()=>flow.inspectWorkflow(next.workflow));
});

test('source tampering, unknown results and caller-injected proof are not rebinding evidence',{timeout:600000},t=>{
  const old=scene(t),next=scene(t,true),sha=old.batch.planSha256s[0],opts=targetOptions(old,next,0);
  assert.throws(()=>proposeCoherentRebind(next.workflow,opts));
  flow.authorizeReferenceAssetBatch(old.workflow,old.batch.sha256,decision('source.compute',old.batch.sha256,'approve-compute'));
  const {request,...ticket}=flow.reservePlan(old.workflow,sha);flow.recordSubmission(old.workflow,ticket);
  flow.stopAttempt(old.workflow,ticket,'indeterminate');
  assert.throws(()=>proposeCoherentRebind(next.workflow,opts));
  assert.throws(()=>flow.reservePlan(old.workflow,sha));
  assert.throws(()=>proposeCoherentRebind(next.workflow,{...opts,evidence:{verified:true}}));
});

test('a sealed proposal cannot make changed source pixels or QA usable',{timeout:600000},t=>{
  const old=scene(t),next=scene(t,true),sha=old.batch.planSha256s[0],opts=targetOptions(old,next,0);
  flow.authorizeReferenceAssetBatch(old.workflow,old.batch.sha256,decision('tamper.compute',old.batch.sha256,'approve-compute'));
  const {request,...ticket}=flow.reservePlan(old.workflow,sha);flow.recordSubmission(old.workflow,ticket);
  const result=flow.receiveResult(old.workflow,ticket,sourcePng(false,17));assert.equal(result.technical.status,'pass');
  const candidate=proposeCoherentRebind(next.workflow,opts),proposal=candidate.proposal;
  assert.throws(()=>proposeCoherentRebind(next.workflow,{...opts,targetSha256:'0'.repeat(64)}));
  const sky=flow.getGenerationPlan(next.workflow,next.batch.planSha256s[1]);
  assert.throws(()=>proposeCoherentRebind(next.workflow,{...opts,targetPlanSha256:sky.sha256,scopeSha256:sky.sourceScope.definition.sha256}));
  const options={...opts,proposal,rebindId:'tamper.rebind',parentBatchSha256:next.batch.sha256,batchId:'tamper.batch',
    receipt:decision('tamper.review',proposal.sha256)};
  const before=flow.inspectWorkflow(next.workflow).eventCount;
  const changedProposal=seal({...unseal(proposal),rawSha256:'0'.repeat(64)});
  rejects(()=>commitCoherentRebind(next.workflow,{...options,proposal:changedProposal,
    receipt:decision('changed.proposal.review',changedProposal.sha256)}),'REBIND_PROPOSAL_CHANGED');
  rejects(()=>commitCoherentRebind(next.workflow,{...options,scopeSha256:'0'.repeat(64)}),'REBIND_TARGET_BINDING');
  assert.equal(flow.inspectWorkflow(next.workflow).eventCount,before);
  const blob=join(old.workflow,'blobs',result.rawSha256+'.bin'),saved=readFileSync(blob);
  try{writeFileSync(blob,Buffer.from('tampered'));assert.throws(()=>commitCoherentRebind(next.workflow,options));}
  finally{writeFileSync(blob,saved);}
  const eventDir=join(old.workflow,'events'),event=readdirSync(eventDir).map(n=>join(eventDir,n)).find(p=>{
    const r=JSON.parse(readFileSync(p));return r.record.format==='ai_scene_generation_result_v1'&&r.record.planSha256===sha;});
  assert(event);const original=readFileSync(event),changed=JSON.parse(original);changed.record.technical.status='fail';
  try{writeFileSync(event,JSON.stringify(changed));assert.throws(()=>commitCoherentRebind(next.workflow,options));}
  finally{writeFileSync(event,original);}
  assert.equal(proposeCoherentRebind(next.workflow,opts).proposal.sha256,proposal.sha256);
});

function prepareRebindCompetition(t){
  const old=scene(t),next=scene(t,true),sha=old.batch.planSha256s[0],opts=targetOptions(old,next,0);
  flow.authorizeReferenceAssetBatch(old.workflow,old.batch.sha256,decision('race.source.compute',old.batch.sha256,'approve-compute'));
  const {request,...ticket}=flow.reservePlan(old.workflow,sha);flow.recordSubmission(old.workflow,ticket);
  assert.equal(flow.receiveResult(old.workflow,ticket,sourcePng(false,17)).technical.status,'pass');
  const proposal=proposeCoherentRebind(next.workflow,opts).proposal;
  return {next,options:{...opts,proposal,rebindId:'race.rebind',parentBatchSha256:next.batch.sha256,
    batchId:'race.batch',receipt:decision('race.review',proposal.sha256)}};
}

test('a target reserved after the rebind proposal rejects commit without appending events',{timeout:600000},t=>{
  const {next,options}=prepareRebindCompetition(t);
  flow.authorizeReferenceAssetBatch(next.workflow,next.batch.sha256,decision('race.target.compute',next.batch.sha256,'approve-compute'));
  flow.reservePlan(next.workflow,options.targetPlanSha256);
  const before=flow.inspectWorkflow(next.workflow);
  rejects(()=>commitCoherentRebind(next.workflow,options),'REBIND_TARGET_STATE');
  assert.deepEqual(flow.inspectWorkflow(next.workflow),before);
});

test('two processes competing to rebind the same target append exactly one record and batch',{timeout:600000},async t=>{
  const {next,options}=prepareRebindCompetition(t),before=flow.inspectWorkflow(next.workflow).eventCount;
  // Distinct source locks let both workers contend at the shared destination;
  // the synthetic copy has the same verified source evidence and bytes.
  const secondSource=join(next.parent,'cloned-source-workflow');
  cpSync(options.sourceWorkflow,secondSource,{recursive:true,errorOnExist:true,force:false});
  const moduleUrl=new URL('../src/generation/index.mjs',import.meta.url).href;
  const code=`import {commitCoherentRebind} from ${JSON.stringify(moduleUrl)};
    try { const result=commitCoherentRebind(process.argv[1],JSON.parse(process.argv[2]));
      process.stdout.write(JSON.stringify({ok:true,record:result.record.sha256,batch:result.batch.sha256}));
    } catch(e) { process.stdout.write(JSON.stringify({ok:false,code:e.errors?.[0]?.code})); }`;
  const worker=workerOptions=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--input-type=module','-e',code,next.workflow,JSON.stringify(workerOptions)]);let out='',err='';
    child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);child.on('error',reject);
    child.on('close',exitCode=>{try{assert.equal(exitCode,0,err);resolve(JSON.parse(out));}catch(e){reject(e);}});
  });
  const results=await Promise.all([worker(options),worker({...options,sourceWorkflow:secondSource})]);
  assert.equal(results.filter(x=>x.ok).length,1);
  assert(['WORKFLOW_BUSY','REBIND_TARGET_STATE','REBIND_PARENT_STALE'].includes(results.find(x=>!x.ok).code));
  const after=flow.inspectWorkflow(next.workflow),winner=results.find(x=>x.ok);
  assert.equal(after.eventCount,before+2);
  assert.equal(flow.getGenerationPlan(next.workflow,winner.record).format,'ai_scene_coherent_rebind_v1');
  const batch=flow.getCoherentSourceBatch(next.workflow,winner.batch);
  assert.equal(batch.parentBatchSha256,next.batch.sha256);
  assert.equal(batch.planSha256s.filter(x=>x===winner.record).length,1);
});
