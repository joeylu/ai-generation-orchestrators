import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {writeFileSync} from 'node:fs';
import * as flow from '../src/generation/index.mjs';
import {compileTerrainEdgeNativeSizeProposal,TERRAIN_EDGE_NATIVE_SIZE_RULE} from '../src/generation/terrain-edge-native-size.mjs';
import {assessTerrainEdgeSource,compileTerrainEdgeSource,TERRAIN_NATIVE_SIZE_PERIMETER_POLICY,ENGINEERED_CITY_TERRAIN_NATIVE_SIZE_PERIMETER_POLICY} from '../src/generation/terrain-edge-source.mjs';
import {reserveTerrainEdgeExchange,receiveTerrainEdgeExchange} from '../src/terrain-edge-exchange.mjs';
import {inspectPng,encodeRgbaPng,crc32} from '../src/png.mjs';
import {hash,seal,unseal} from '../src/generation/common.mjs';
import {transact} from '../src/generation/store.mjs';
import {replay} from '../src/generation/model.mjs';
import {setupCoherent,sourcePng} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';

const rejects=(action,code)=>assert.throws(action,error=>error.errors?.some(issue=>issue.code===code));
const receive=(root,sha,bytes)=>{const {request,...ticket}=flow.reservePlan(root,sha);flow.recordSubmission(root,ticket);return flow.receiveResult(root,ticket,bytes);};
function nativePng(width=2172,height=724,{edgeAlpha=0}={}){
  const rgba=Buffer.alloc(width*height*4);
  for(let y=114;y<height-82;y++)for(let x=74;x<width-68;x++)rgba.set([35+x%120,70+y%90,130,255],(y*width+x)*4);
  rgba.set([9,17,23,0],0);rgba[(140*width+180)*4+3]=119;
  if(edgeAlpha)rgba.set([15,23,35,edgeAlpha],(200*width)*4);
  return encodeRgbaPng(width,height,rgba);
}
function setup(t){
  const f=setupCoherent(t),base=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:flow.createLayerSourceScopes(f.brief.requirements)});
  flow.authorizeReferenceAssetBatch(f.workflow,base.sha256,decision('base.compute',base.sha256,'approve-compute'));
  for(const [index,sha]of base.planSha256s.entries()){
    const plan=flow.getGenerationPlan(f.workflow,sha);receive(f.workflow,sha,sourcePng(plan.target.alpha==='transparent',index+301));
  }
  const batch=flow.freezeTerrainEdgeSources(f.workflow,{batchId:'bottom.initial',baseBatchSha256:base.sha256,capabilitiesSha256:f.options.capabilitiesSha256,
    surfaceFamily:'engineered-city',coverageProfile:'full-perimeter-v1',items:flow.TERRAIN_BOTTOM_EDGE_ROLES.map((role,i)=>({
      assetId:'bottom.initial.'+i,role,content:'One native original-color lower panel termination with original scene light.',exclusions:['Independent props']}))});
  flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('bottom.initial.compute',batch.sha256,'approve-compute'));
  const raw=nativePng(),result=receive(f.workflow,batch.planSha256s[0],raw);
  assert.equal(result.technical.status,'fail');assert.deepEqual(result.technical.issues,['OUTPUT_SIZE']);return {...f,base,batch,raw,result};
}

test('reviewed identity size envelope preserves failed request, exact PNG/RGBA and original remaining two authorizations',{timeout:240000},t=>{
  const f=setup(t),sha=f.batch.planSha256s[0],before=flow.inspectWorkflow(f.workflow),original=flow.getGenerationResult(f.workflow,sha),
    originalPlan=flow.getGenerationPlan(f.workflow,sha),proposal=flow.proposeTerrainEdgeNativeSizePreparation(f.workflow,sha,f.batch.sha256);
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
  assert.equal(flow.proposeTerrainEdgeNativeSizePreparation(f.workflow,sha,f.batch.sha256).proposal.sha256,proposal.proposal.sha256);
  const p=proposal.proposal;assert.deepEqual(proposal.bytes,f.raw);assert.equal(p.originalRawSha256,hash(f.raw));
  assert.equal(p.originalRgbaSha256,hash(inspectPng(f.raw,{includePixels:true,allowHiddenRgb:true}).rgba));
  assert.equal(p.originalTechnicalSha256,original.result.technical.sha256);assert.equal(p.originalTechnical.status,'fail');
  assert.deepEqual(p.actualPixelSize,{width:2172,height:724});assert.deepEqual(p.actualPaddingPixels,{left:74,right:68,top:114,bottom:82});
  assert.deepEqual(p.actualPaddingRatios.left,{numerator:74,denominator:2172});assert.equal(p.originalPromptGutterSatisfied,false);
  assert.match(p.requiredHumanChecks.join(' '),/does not meet/);assert.match(p.requiredHumanChecks.join(' '),/no rescaling, crop, padding or alpha repair/);
  assert.equal(p.technical.status,'pass');assert.equal(p.technical.originalQaStatus,'fail');assert.equal(p.maximumNewImageCalls,0);
  assert.equal(p.technical.nativeSizeProfile,'bounded-native-4m-v1');assert.equal(p.technical.sourceToWorldScale,'not-assessed');
  assert.equal(p.requiredRenderEnvelopeProfile,'visible-alpha8-outward16-native-rgba-v1');
  assert.equal(p.rule.renderEnvelope.visibleAlphaThreshold,8);assert.equal(p.rule.renderEnvelope.maximumVisibleOutwardWorld,16);
  assert.equal(p.technical.renderEnvelopeMeasurement,'not-assessed-pending-explicit-native-controls');
  assert.equal(hash(proposal.previews.original),p.diagnosticPreviews.originalSha256);
  const args={preparationId:'bottom.size.accepted',proposal:p,parentBatchSha256:f.batch.sha256,batchId:'bottom.size.continuation',
    receipt:decision('bottom.size.accept',p.sha256)};
  rejects(()=>flow.prepareAndAdoptTerrainEdgeNativeSizeSource(f.workflow,{...args,receipt:decision('wrong.target',original.result.rawSha256)}),'TERRAIN_EDGE_NATIVE_SIZE_APPROVAL');
  const changed=seal({...unseal(p),actualPaddingPixels:{...p.actualPaddingPixels,left:75}});
  rejects(()=>flow.prepareAndAdoptTerrainEdgeNativeSizeSource(f.workflow,{...args,proposal:changed,receipt:decision('wrong.preview',changed.sha256)}),'TERRAIN_EDGE_NATIVE_SIZE_PROPOSAL_CHANGED');
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
  const authorizationBefore=transact(f.workflow,store=>{const state=replay(store);return f.batch.planSha256s.slice(1).map(s=>state.plans.get(s).authorization);});
  const {record,batch}=flow.prepareAndAdoptTerrainEdgeNativeSizeSource(f.workflow,args);
  assert.equal(record.format,'ai_scene_terrain_edge_native_size_preparation_v1');assert.equal(record.request.maximumCalls,0);
  assert.equal(record.renderEnvelopeProfile,p.requiredRenderEnvelopeProfile);
  assert.deepEqual(record.target,originalPlan.target,'the failed 2048 request is retained rather than rewritten');
  assert.equal(record.rawSha256,original.result.rawSha256);assert.equal(record.originalRawSha256,record.rawSha256);
  assert.equal(record.sourceArtAcceptance,'not-granted');assert.equal(record.receipt.targetSha256,p.sha256);
  assert.equal(batch.format,'ai_scene_terrain_edge_prepared_batch_v1');assert.equal(batch.maximumCalls,0);assert.equal(batch.newImageRequests,0);
  assert.equal(batch.remainingAuthorizedCalls,2);assert.equal(batch.parentBatchSha256,f.batch.sha256);
  assert.deepEqual(batch.planSha256s,[record.sha256,...f.batch.planSha256s.slice(1)]);
  assert.deepEqual(flow.getGenerationResult(f.workflow,sha),original);assert.deepEqual(flow.getGenerationPlan(f.workflow,sha),originalPlan);
  assert.deepEqual(flow.getTerrainEdgeSourceBatch(f.workflow,f.batch.sha256),f.batch);
  const authorizationAfter=transact(f.workflow,store=>{const state=replay(store);return f.batch.planSha256s.slice(1).map(s=>state.plans.get(s).authorization);});
  assert.deepEqual(authorizationAfter,authorizationBefore);
  assert.deepEqual(batch.reusedAuthorizations.map(a=>a.authorizationSha256),authorizationBefore.map(a=>a.sha256));
  rejects(()=>flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('never.authorize.child',batch.sha256,'approve-compute')),'AUTHORIZATION_STATE');
  rejects(()=>flow.reservePlan(f.workflow,record.sha256),'AUTHORIZATION_REQUIRED');rejects(()=>flow.reservePlan(f.workflow,sha),'RESERVATION_STATE');
  rejects(()=>reserveTerrainEdgeExchange(f.workflow,f.batch.sha256,join(f.root,'old-batch-stays-stopped')),'TERRAIN_EDGE_BATCH_STOPPED');
  rejects(()=>flow.getTerrainEdgeInputs(f.workflow,batch.sha256),'TERRAIN_EDGE_SOURCES_INCOMPLETE');
  for(const [index,remaining]of f.batch.planSha256s.slice(1).entries()){
    const dir=join(f.root,'remaining-'+index),exchange=reserveTerrainEdgeExchange(f.workflow,batch.sha256,dir);
    assert.equal(exchange.ticket.planSha256,remaining);assert.equal(exchange.maximumCalls,1);
    const raw=sourcePng(true,index+340),file=join(f.root,'remaining-'+index+'.png');writeFileSync(file,raw);receiveTerrainEdgeExchange(f.workflow,dir,file);
  }
  const inputs=flow.getTerrainEdgeInputs(f.workflow,batch.sha256),prepared=inputs.sources[0];
  assert.equal(inputs.sources.length,3);assert.deepEqual(prepared.raw,prepared.preparation.originalRaw);
  assert.deepEqual(prepared.preparation.originalResult,original.result);assert.deepEqual(prepared.preparation.originalPlan,originalPlan);
  assert.equal(prepared.preparation.record.sha256,record.sha256);assert.equal(prepared.status,'pending-visual-review');
  assert.equal(flow.recheckResult(f.workflow,record.sha256,record.rawSha256).sha256,record.technical.sha256);
  assert.deepEqual(flow.getGenerationResult(f.workflow,sha),original);assert.deepEqual(proposal.bytes,f.raw);
  rejects(()=>flow.prepareAndAdoptTerrainEdgeNativeSizeSource(f.workflow,{...args,preparationId:'duplicate.size',batchId:'duplicate.batch'}),'TERRAIN_EDGE_NATIVE_SIZE_PARENT_STALE');
  const future=flow.freezeTerrainEdgeSources(f.workflow,{batchId:'future.native.full',baseBatchSha256:f.base.sha256,capabilitiesSha256:f.options.capabilitiesSha256,
    surfaceFamily:'engineered-city',coverageProfile:'full-perimeter-v1',nativeSizeProfile:'bounded-native-4m-v1',
    renderEnvelopeProfile:'visible-alpha8-outward16-native-rgba-v1',items:flow.TERRAIN_PERIMETER_ROLES.map((role,i)=>({
      assetId:'future.native.'+i,role,content:'One complete native edge with unchanged source color and light.',exclusions:['Independent props']}))});
  assert.equal(future.format,'ai_scene_terrain_edge_batch_v6');assert.equal(future.maximumCalls,7);assert.equal(future.fullPerimeterComplete,true);
  assert.equal(future.nativeSizeProfile,'bounded-native-4m-v1');assert.equal(future.renderEnvelopeProfile,'visible-alpha8-outward16-native-rgba-v1');
  for(const s of future.planSha256s){const p=flow.getGenerationPlan(f.workflow,s);assert.equal(p.format,'ai_scene_generation_plan_v36');
    assert.equal(p.target.sourcePolicy.maximumWidth,4096);assert.equal(p.target.sourcePolicy.maximumHeight,4096);assert.equal(p.target.sourcePolicy.maximumPixels,4194304);
    assert.equal(p.qualityPolicy.requiredRenderEnvelopeProfile,p.recipe.renderEnvelopeProfile);}
  rejects(()=>flow.reservePlan(f.workflow,future.planSha256s[4]),'AUTHORIZATION_REQUIRED');
  flow.authorizeReferenceAssetBatch(f.workflow,future.sha256,decision('future.native.compute',future.sha256,'approve-compute'));
  const futureResult=receive(f.workflow,future.planSha256s[4],f.raw);assert.equal(futureResult.technical.status,'pass');
  assert.equal(futureResult.technical.format,'ai_scene_terrain_edge_source_qa_v6');assert.equal(futureResult.technical.preferredGutterSatisfied,false);
  assert.equal(flow.recheckResult(f.workflow,future.planSha256s[4],hash(f.raw)).sha256,futureResult.technical.sha256);
});

test('size envelope refuses non-size failures, missing real gutter, dimensions above 4096 and pixels above four million',{timeout:240000},t=>{
  const f=setup(t);
  transact(f.workflow,store=>{
    const state=replay(store),sha=f.batch.planSha256s[0],source=state.plans.get(sha),
      proposalFor=bytes=>{
        const technical=assessTerrainEdgeSource(source.plan,bytes),rawSha256=hash(bytes),entry={...source,result:seal({...unseal(source.result),rawSha256,technical})},
          next={...state,plans:new Map([...state.plans,[sha,entry]])},view={...store,readBlob:hash=>hash===rawSha256?Buffer.from(bytes):store.readBlob(hash)};
        return compileTerrainEdgeNativeSizeProposal(view,next,sha,f.batch.sha256);
      };
    rejects(()=>proposalFor(nativePng(2172,724,{edgeAlpha:2})),'TERRAIN_EDGE_NATIVE_SIZE_ORIGINAL_QA');
    rejects(()=>proposalFor(nativePng(2172,724,{edgeAlpha:1})),'TERRAIN_EDGE_NATIVE_SIZE_GUTTER');
    const oversize=Buffer.from(nativePng(4096,724));oversize.writeUInt32BE(4097,16);oversize.writeUInt32BE(crc32(oversize.subarray(12,29)),29);
    rejects(()=>proposalFor(oversize),'TERRAIN_EDGE_NATIVE_SIZE_ORIGINAL_QA');
    rejects(()=>proposalFor(nativePng(3000,1500)),'TERRAIN_EDGE_NATIVE_SIZE_ENVELOPE');
    rejects(()=>proposalFor(sourcePng(true,350)),'TERRAIN_EDGE_NATIVE_SIZE_SOURCE');
    for(const city of [false,true]){
      const {surfaceFamily:_surfaceFamily,...recipe}=source.plan.recipe,
        next={...recipe,planId:city?'future.city':'future.natural',assetId:city?'future.city':'future.natural',
          nativeSizeProfile:'bounded-native-4m-v1',renderEnvelopeProfile:'visible-alpha8-outward16-native-rgba-v1',
          policySha256:(city?ENGINEERED_CITY_TERRAIN_NATIVE_SIZE_PERIMETER_POLICY:TERRAIN_NATIVE_SIZE_PERIMETER_POLICY).sha256,
          ...(city?{surfaceFamily:'engineered-city'}:{})},plan=compileTerrainEdgeSource(state,next);
      assert.equal(plan.format,city?'ai_scene_generation_plan_v36':'ai_scene_generation_plan_v35');
      const qa=assessTerrainEdgeSource(plan,f.raw);assert.equal(qa.status,'pass');assert.equal(qa.preferredGutterSatisfied,false);
      assert.equal(qa.renderEnvelopeProfile,'visible-alpha8-outward16-native-rgba-v1');
      assert(assessTerrainEdgeSource(plan,nativePng(3000,1500)).issues.includes('TERRAIN_EDGE_NATIVE_SIZE_PIXELS'));
      assert(assessTerrainEdgeSource(plan,nativePng(2172,724,{edgeAlpha:1})).issues.includes('TERRAIN_EDGE_NATIVE_GUTTER'));
      rejects(()=>compileTerrainEdgeSource(state,{...next,renderEnvelopeProfile:'arbitrary-render-window'}),'TERRAIN_EDGE_RENDER_ENVELOPE_PROFILE');
    }
  });
  assert.equal(TERRAIN_EDGE_NATIVE_SIZE_RULE.maximumPixels,4194304);assert.equal(TERRAIN_EDGE_NATIVE_SIZE_RULE.newImageCalls,0);
});
