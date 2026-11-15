import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import * as flow from '../src/generation/index.mjs';
import * as pipeline from '../src/terrain-edge-pipeline.mjs';
import {reserveTerrainEdgeExchange,receiveTerrainEdgeExchange,runTerrainEdgeExchange} from '../src/terrain-edge-exchange.mjs';
import {terrainEdgeCanvasGutterView,assessTerrainEdgeCanvasGutterPreparation} from '../src/generation/terrain-edge-canvas-gutter.mjs';
import {transact} from '../src/generation/store.mjs';
import {replay} from '../src/generation/model.mjs';
import {hash,digest,seal,unseal} from '../src/generation/common.mjs';
import {inspectPng,encodeRgbaPng} from '../src/png.mjs';
import {contextFor,loadSceneKit} from '../src/kit.mjs';
import {setupBottomDelivery,bottomSideControls,bottomFixture} from './helpers/terrain-bottom-delivery.mjs';
import {receiveEdgeFixture} from './helpers/terrain-edge-delivery.mjs';
import {setupCoherent,sourcePng} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';

const profiles={coverageProfile:'full-perimeter-v1',nativeSizeProfile:'bounded-native-4m-v1',
  renderEnvelopeProfile:'visible-alpha8-outward16-native-rgba-v1',naturalSurfaceProfile:'reference-defined-cover-v1'};
const json=path=>JSON.parse(readFileSync(path,'utf8'));
const rejects=(action,code)=>assert.throws(action,error=>error.errors?.some(issue=>!code||issue.code===code));
const cli=(...args)=>{
  const result=spawnSync(process.execPath,['scripts/terrain-edges.mjs',...args],{cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:180000});
  assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
};
function smallSourcePng(alpha,seed){
  const width=320,height=256,rgba=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(!alpha||(x>=35&&x<285&&y>=30&&y<226))
    rgba.set([40+(x+seed)%130,75+(y+seed)%90,110+seed%30,255],(y*width+x)*4);
  return encodeRgbaPng(width,height,rgba);
}
function setup(t,{delivery=false,deferBorderSource=false}={}){
  const f=delivery?setupBottomDelivery(t,{receiveSides:false}):setupCoherent(t);
  if(!delivery){
    f.base=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:flow.createLayerSourceScopes(f.brief.requirements)});
    flow.authorizeReferenceAssetBatch(f.workflow,f.base.sha256,decision('base.compute',f.base.sha256,'approve-compute'));
    for(const [index,sha]of f.base.planSha256s.entries())receiveEdgeFixture(f.workflow,sha,index===0?sourcePng(false,17)
      :smallSourcePng(flow.getGenerationPlan(f.workflow,sha).target.alpha==='transparent',index+17));
  }
  const bottom=bottomFixture(),raws=delivery?new Map([...f.raws,...bottom.raws])
    :new Map(flow.TERRAIN_PERIMETER_ROLES.map((role,index)=>[role,smallSourcePng(true,index+530)])),
    options={batchId:'gutter.full',baseBatchSha256:f.base.sha256,capabilitiesSha256:f.options.capabilitiesSha256,...profiles,
      items:flow.TERRAIN_PERIMETER_ROLES.map((role,index)=>({assetId:'gutter.full.'+index,role,
        content:'One complete design-specified natural edge with original palette and no independent objects.',exclusions:['Independent props']}))},
    batch=flow.freezeTerrainEdgeSources(f.workflow,options);
  flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('gutter.full.compute',batch.sha256,'approve-compute'));
  receiveEdgeFixture(f.workflow,batch.planSha256s[0],raws.get('left-wall'));
  const png=inspectPng(raws.get('right-wall'),{includePixels:true,allowHiddenRgb:true}),rgba=Buffer.from(png.rgba);
  rgba.set([29,47,61,1],(Math.floor(png.height/2)*png.width)*4);
  const originalRaw=encodeRgbaPng(png.width,png.height,rgba);
  const failed=deferBorderSource?null:receiveEdgeFixture(f.workflow,batch.planSha256s[1],originalRaw);
  if(failed)assert.deepEqual(failed.technical.issues,['TERRAIN_EDGE_NATIVE_GUTTER']);
  return {...f,bottom,raws,options,batch,originalRaw,failed};
}
const authorizations=(f)=>transact(f.workflow,store=>{const state=replay(store);return f.batch.planSha256s.slice(2).map(sha=>state.plans.get(sha).authorization);});

test('exact gutter review is read-only, resumes partial adoption and continues only the original five requests',{timeout:1200000},t=>{
  const f=setup(t),sourceSha=f.batch.planSha256s[1],before=flow.inspectWorkflow(f.workflow),
    original=flow.getGenerationResult(f.workflow,sourceSha),originalPlan=flow.getGenerationPlan(f.workflow,sourceSha),
    first=flow.getGenerationResult(f.workflow,f.batch.planSha256s[0]),authBefore=authorizations(f),
    originalRemaining=f.batch.planSha256s.slice(2).map(sha=>flow.getGenerationPlan(f.workflow,sha)),
    blobs=readdirSync(join(f.workflow,'blobs')).sort(),directory=join(f.parent,'gutter-exact-review'),
    review=cli('canvas-gutter-review','--workflow',f.workflow,'--plan',sourceSha,'--parent-batch',f.batch.sha256,'--out',directory),
    proposal=json(join(directory,'proposal.json'));
  assert.equal(review.generationCalls,0);assert.equal(review.adoptionGranted,false);assert.equal(review.proposalSha256,proposal.sha256);
  assert.equal(pipeline.exportTerrainEdgeCanvasGutterReview(f.workflow,sourceSha,f.batch.sha256,directory).bundleSha256,review.bundleSha256);
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);assert.deepEqual(readdirSync(join(f.workflow,'blobs')).sort(),blobs);
  assert.deepEqual(readFileSync(join(directory,'source-original.png')),f.originalRaw);
  assert.deepEqual(json(join(directory,'original-plan.json')),originalPlan);assert.deepEqual(json(join(directory,'original-result.json')),original.result);
  const preparedBytes=readFileSync(join(directory,'preview-padded.png')),
    receipt=decision('gutter.exact.accept',proposal.sha256),options={preparationId:'gutter.prepared',batchId:'gutter.continuation'};
  for(const target of [review.bundleSha256,original.result.rawSha256])
    rejects(()=>pipeline.applyTerrainEdgeCanvasGutterReview(f.workflow,directory,decision('wrong.target',target),options),'TERRAIN_EDGE_CANVAS_GUTTER_APPROVAL');
  for(const file of ['preview-padded.png','source-original.png','preview-padded-checkerboard.png','original-technical.json']){
    const path=join(directory,file),bytes=readFileSync(path);writeFileSync(path,Buffer.from('changed exact reviewed bytes'));
    rejects(()=>pipeline.applyTerrainEdgeCanvasGutterReview(f.workflow,directory,receipt,options),'PROOF_BUNDLE_RECOMPILE_MISMATCH');
    writeFileSync(path,bytes);
  }
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);assert.deepEqual(readdirSync(join(f.workflow,'blobs')).sort(),blobs);
  const partial=flow.prepareTerrainEdgeCanvasGutterSource(f.workflow,{preparationId:options.preparationId,proposal,receipt});
  assert.equal(partial.request.maximumCalls,0);assert.equal(flow.inspectWorkflow(f.workflow).eventCount,before.eventCount+1);
  const receiptPath=join(f.parent,'gutter-review-decision.json');writeFileSync(receiptPath,JSON.stringify(receipt));
  const applied=cli('canvas-gutter-apply','--workflow',f.workflow,'--review',directory,'--decision',receiptPath,
    '--preparation-id',options.preparationId,'--batch-id',options.batchId),after=flow.inspectWorkflow(f.workflow);
  assert.equal(applied.generationCalls,0);assert.equal(applied.record.sha256,partial.sha256);
  assert.equal(after.eventCount,before.eventCount+2);assert.equal(after.generationCalls,before.generationCalls);
  const batch=applied.batch;assert.equal(batch.remainingAuthorizedCalls,5);assert.equal(batch.maximumCalls,0);assert.equal(batch.newImageRequests,0);
  assert.deepEqual(batch.planSha256s,[f.batch.planSha256s[0],partial.sha256,...f.batch.planSha256s.slice(2)]);
  assert.deepEqual(batch.reusedAuthorizations.map(row=>row.authorizationSha256),authBefore.map(row=>row.sha256));
  assert.deepEqual(authorizations(f),authBefore);assert.deepEqual(flow.getGenerationPlan(f.workflow,sourceSha),originalPlan);
  assert.deepEqual(flow.getGenerationResult(f.workflow,sourceSha),original);assert.deepEqual(flow.getGenerationResult(f.workflow,f.batch.planSha256s[0]),first);
  assert.deepEqual(flow.getTerrainEdgeSourceBatch(f.workflow,f.batch.sha256),f.batch);
  const repeat=pipeline.applyTerrainEdgeCanvasGutterReview(f.workflow,directory,receipt,options);
  assert.equal(repeat.reusedVerifiedPreparation,true);assert.deepEqual(flow.inspectWorkflow(f.workflow),after);
  const mismatch=decision('different.receipt.id',proposal.sha256);
  rejects(()=>pipeline.applyTerrainEdgeCanvasGutterReview(f.workflow,directory,mismatch,options),'TERRAIN_EDGE_CANVAS_GUTTER_RESUME_MISMATCH');
  rejects(()=>flow.authorizePlan(f.workflow,partial.sha256,decision('no.prep.compute',partial.sha256,'approve-compute')),'AUTHORIZATION_STATE');
  rejects(()=>flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('no.child.compute',batch.sha256,'approve-compute')),'AUTHORIZATION_STATE');
  rejects(()=>flow.reservePlan(f.workflow,partial.sha256),'AUTHORIZATION_REQUIRED');
  rejects(()=>flow.readGenerationInput(f.workflow,partial.sha256,0));
  rejects(()=>reserveTerrainEdgeExchange(f.workflow,f.batch.sha256,join(f.parent,'original-remains-stopped')),'TERRAIN_EDGE_BATCH_STOPPED');
  rejects(()=>flow.getTerrainEdgeInputs(f.workflow,batch.sha256),'TERRAIN_EDGE_SOURCES_INCOMPLETE');
  const prepared=flow.getGenerationResult(f.workflow,partial.sha256);
  assert.deepEqual(prepared.bytes,preparedBytes);assert.notEqual(prepared.result.rawSha256,original.result.rawSha256);
  assert.equal(flow.recheckResult(f.workflow,partial.sha256,hash(preparedBytes)).sha256,partial.technical.sha256);
  assert.equal(assessTerrainEdgeCanvasGutterPreparation(partial,preparedBytes).sha256,partial.technical.sha256);
  const readView=flow.readCoherentWorkflowView(f.workflow,{includeCurrentInputs:true});
  assert(readView.plans.some(plan=>plan.sha256===partial.sha256));assert(readView.inputs.size>0);
  const edgeView=flow.readTerrainEdgeWorkflowView(f.workflow,{batchSha256:batch.sha256,includeCurrentInputs:true,includeResults:true});
  assert.deepEqual(edgeView.batch,batch);assert.equal(edgeView.plans.length,8);assert.equal(edgeView.inputs.size,2);
  assert(edgeView.plans.some(plan=>plan.sha256===partial.sha256));assert(edgeView.plans.some(plan=>plan.sha256===sourceSha));
  assert.deepEqual(edgeView.results.get(sourceSha),{...original,status:'rejected-technical'});
  assert.deepEqual(edgeView.results.get(partial.sha256).bytes,preparedBytes);
  assert.equal(edgeView.results.get(partial.sha256).result.technical.status,'pass');
  assert.deepEqual(new Set(edgeView.inputs.keys()),new Set(originalRemaining[0].request.images.map(image=>image.artifact.sha256)));
  const computeDirectory=join(f.parent,'remaining-exact-compute-review'),compute=pipeline.prepareTerrainEdgeComputeReview(f.workflow,batch.sha256,computeDirectory);
  assert.equal(compute.format,'ai_scene_terrain_edge_compute_review_v2');assert.equal(compute.maximumCalls,5);assert.equal(compute.newImageRequests,0);
  assert.equal(compute.generationCalls,0);assert.equal(compute.existingAuthorizationsReused,true);assert.equal(compute.preparedSources.length,1);assert.equal(compute.completedSources.length,1);
  assert.deepEqual(compute.plans.map(plan=>plan.planSha256),f.batch.planSha256s.slice(2));
  assert.equal(existsSync(join(computeDirectory,'prompt-2.txt')),false);
  assert.deepEqual(compute.plans.map(plan=>plan.authorizationSha256),authBefore.map(row=>row.sha256));
  for(const [index,plan]of originalRemaining.entries()){
    assert.deepEqual(flow.getGenerationPlan(f.workflow,plan.sha256),plan);
    assert.equal(readFileSync(join(computeDirectory,compute.plans[index].prompt),'utf8'),plan.request.prompt+'\n');
    const exchangeDirectory=join(f.parent,'original-exact-exchange-'+index),exchange=reserveTerrainEdgeExchange(f.workflow,batch.sha256,exchangeDirectory);
    assert.equal(exchange.ticket.planSha256,plan.sha256);assert.equal(exchange.ticket.requestSha256,digest(plan.request));assert.equal(exchange.maximumCalls,1);
    for(const [inputIndex,input]of exchange.inputs.entries())assert.deepEqual(readFileSync(join(exchangeDirectory,input.path)),flow.readGenerationInput(f.workflow,plan.sha256,inputIndex));
    const native=f.raws.get(plan.recipe.edgeRole),file=join(f.parent,'remaining-native-'+index+'.png');writeFileSync(file,native);
    receiveTerrainEdgeExchange(f.workflow,exchangeDirectory,file);
    assert.equal(flow.getGenerationResult(f.workflow,plan.sha256).result.technical.status,'pass');
  }
  const inputs=flow.getTerrainEdgeInputs(f.workflow,batch.sha256),item=inputs.sources[1],view=terrainEdgeCanvasGutterView(item),old=inspectPng(f.originalRaw,{includePixels:true,allowHiddenRgb:true});
  assert.equal(inputs.sources.length,7);assert.deepEqual(item.preparation.originalRaw,f.originalRaw);assert.deepEqual(item.preparation.originalResult,original.result);
  assert.deepEqual(item.preparation.originalPlan,originalPlan);assert.deepEqual(item.raw,preparedBytes);
  assert.equal(view.width,old.width);assert.equal(view.height,old.height);assert.deepEqual(view.rgba,old.rgba);
  const preparedBlob=join(f.workflow,'blobs',partial.rawSha256+'.bin');writeFileSync(preparedBlob,Buffer.from('changed prepared bytes'));
  rejects(()=>flow.inspectWorkflow(f.workflow));writeFileSync(preparedBlob,preparedBytes);
  assert.equal(flow.recheckResult(f.workflow,partial.sha256,hash(preparedBytes)).status,'pass');
});

test('automatic native gutter delivery preserves original failure and preparation evidence and replays without changing source scale',{timeout:1200000},t=>{
  const f=setup(t,{delivery:true}),sourceSha=f.batch.planSha256s[1],original=flow.getGenerationResult(f.workflow,sourceSha),
    {proposal,bytes:preparedBytes}=flow.proposeTerrainEdgeCanvasGutterPreparation(f.workflow,sourceSha,f.batch.sha256),
    {record:partial,batch}=flow.autoPrepareTerrainEdgeCanvasGutterSource(f.workflow,sourceSha,f.batch.sha256),
    old=inspectPng(f.originalRaw,{includePixels:true,allowHiddenRgb:true});
  for(const sha of f.batch.planSha256s.slice(2))receiveEdgeFixture(f.workflow,sha,f.raws.get(flow.getGenerationPlan(f.workflow,sha).recipe.edgeRole));
  const delivery={...f.deliveryOptions,batchSha256:batch.sha256,
    controls:{...bottomSideControls(f),bottom:{...f.bottom.controls,nativeSizeProfile:profiles.nativeSizeProfile,renderEnvelopeProfile:profiles.renderEnvelopeProfile}},
    output:join(f.parent,'prepared-perimeter-delivery')},beforeDelivery=flow.inspectWorkflow(f.workflow),report=pipeline.buildTerrainEdgeDelivery(delivery);
  assert.equal(report.generationCalls,0);assert.equal(report.finalHumanArtReview,'pending');
  assert.equal(pipeline.verifyTerrainEdgeDelivery(delivery).reportSha256,report.sha256);
  assert.deepEqual(flow.inspectWorkflow(f.workflow),beforeDelivery);
  const candidate=join(delivery.output,'candidate'),readiness=json(join(candidate,'readiness.json')),
    row=readiness.sourceEvidence.find(source=>source.edgeRole==='right-wall'),kit=contextFor(loadSceneKit(join(candidate,'kit'))).kit;
  assert.equal(row.nativeCanvasGutterPreparation.automaticPolicy,'alpha-one-transparent-canvas-2px-v1');
  assert.equal(partial.proposal.sha256,proposal.sha256);
  assert(!Object.hasOwn(row.nativeCanvasGutterPreparation,'receiptSha256'));
  assert(!existsSync(join(candidate,'evidence/right-wall-canvas-gutter-receipt.json')));
  assert.deepEqual(kit.terrainEdges.right.wall.pixelSize,{width:old.width,height:old.height});
  assert.deepEqual(kit.terrainEdges.right.wall.scale,delivery.controls.right.wall.scale);
  assert.equal(kit.terrainEdges.right.wall.boundaryX,delivery.controls.right.wall.boundaryX);
  assert.deepEqual(kit.terrainEdges.right.wall.repeatY,delivery.controls.right.wall.repeatY);
  assert.deepEqual(readFileSync(join(candidate,'source/right-wall-original-native.png')),f.originalRaw);
  assert.deepEqual(readFileSync(join(candidate,'source/right-wall-native.png')),preparedBytes);
  assert.deepEqual(json(join(candidate,'evidence/right-wall-original-technical-qa.json')),original.result.technical);
  assert.deepEqual(json(join(candidate,'evidence/right-wall-canvas-gutter-preparation.json')),partial);
  const evidencePath=join(candidate,'source/right-wall-original-native.png'),evidenceBytes=readFileSync(evidencePath);writeFileSync(evidencePath,Buffer.from('changed original source evidence'));
  rejects(()=>pipeline.verifyTerrainEdgeDelivery(delivery),'PROOF_BUNDLE_RECOMPILE_MISMATCH');writeFileSync(evidencePath,evidenceBytes);
  assert.equal(pipeline.verifyTerrainEdgeDelivery(delivery).status,'verified');
});

test('Codex exchange opt-in only continues past Alpha=1 with the exact unused calls',{timeout:300000},async t=>{
  const f=setup(t,{deferBorderSource:true}),originalSha=f.batch.planSha256s[1],authBefore=authorizations(f),
    dir=join(f.parent,'auto-weak-exchange');
  let calls=0;
  const received=await runTerrainEdgeExchange(f.workflow,f.batch.sha256,dir,{
    async preflight(){},async generate(ticket){assert.equal(ticket.planSha256,originalSha);calls++;return f.originalRaw;},
  },{autoWeakGutter:true});
  assert.equal(calls,1);assert.equal(received.technicalStatus,'pass');assert.equal(received.rawSha256,hash(f.originalRaw));
  const auto=received.automaticGutter,child=flow.getTerrainEdgeSourceBatch(f.workflow,auto.continuationBatchSha256);
  assert.equal(child.maximumCalls,0);assert.equal(child.remainingAuthorizedCalls,5);
  assert.deepEqual(child.planSha256s,[f.batch.planSha256s[0],auto.preparedPlanSha256,...f.batch.planSha256s.slice(2)]);
  assert.deepEqual(authorizations(f),authBefore);
  assert.deepEqual(readFileSync(join(dir,'source-native.png')),f.originalRaw);
  assert.deepEqual(json(join(dir,'technical.json')).issues,['TERRAIN_EDGE_NATIVE_GUTTER']);
  const record=flow.getGenerationPlan(f.workflow,auto.preparedPlanSha256);
  assert.equal(record.automaticPolicy,'alpha-one-transparent-canvas-2px-v1');
  assert.equal(record.sourceArtAcceptance,'not-granted');assert(!Object.hasOwn(record,'receipt'));
  const before=flow.inspectWorkflow(f.workflow);
  assert.equal(flow.autoPrepareTerrainEdgeCanvasGutterSource(f.workflow,originalSha,f.batch.sha256).batch.sha256,child.sha256);
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);

  const stronger=inspectPng(f.raws.get('left-top-corner'),{includePixels:true});
  stronger.rgba[3]=2;
  const stopped=await runTerrainEdgeExchange(f.workflow,child.sha256,join(f.parent,'stronger-edge'),{
    async preflight(){},async generate(){calls++;return encodeRgbaPng(stronger.width,stronger.height,stronger.rgba);},
  },{autoWeakGutter:true});
  assert.equal(calls,2);assert.equal(stopped.technicalStatus,'fail');
  assert(!Object.hasOwn(stopped,'automaticGutter'));
  rejects(()=>reserveTerrainEdgeExchange(f.workflow,child.sha256,join(f.parent,'blocked-after-alpha2')),'TERRAIN_EDGE_BATCH_STOPPED');
});

test('gutter SDK atomic adoption rejects stale parents and changed exact proposals without partial records',{timeout:300000},t=>{
  const f=setup(t),sha=f.batch.planSha256s[1],before=flow.inspectWorkflow(f.workflow),p=flow.proposeTerrainEdgeCanvasGutterPreparation(f.workflow,sha,f.batch.sha256).proposal,
    args={preparationId:'gutter.atomic',proposal:p,receipt:decision('gutter.atomic.accept',p.sha256),parentBatchSha256:f.batch.sha256,batchId:'gutter.atomic.child'},
    changed=seal({...unseal(p),nativeFrame:{...p.nativeFrame,width:p.nativeFrame.width-1}});
  rejects(()=>flow.prepareAndAdoptTerrainEdgeCanvasGutterSource(f.workflow,{...args,proposal:changed,receipt:decision('changed.approval',changed.sha256)}),'TERRAIN_EDGE_CANVAS_GUTTER_PROPOSAL_CHANGED');
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
  flow.freezeTerrainEdgeSources(f.workflow,{...f.options,batchId:'gutter.newer',items:f.options.items.map((item,index)=>({...item,assetId:'gutter.newer.'+index}))});
  const withNewer=flow.inspectWorkflow(f.workflow);
  rejects(()=>flow.prepareAndAdoptTerrainEdgeCanvasGutterSource(f.workflow,args),'TERRAIN_EDGE_CANVAS_GUTTER_PARENT_STALE');
  assert.deepEqual(flow.inspectWorkflow(f.workflow),withNewer);
});
