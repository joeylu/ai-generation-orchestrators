import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {readFileSync,writeFileSync} from 'node:fs';
import * as flow from '../src/generation/index.mjs';
import {inspectPng,encodeRgbaPng} from '../src/png.mjs';
import {prepareTerrainEdgeComputeReview} from '../src/terrain-edge-pipeline.mjs';
import {reserveTerrainEdgeExchange,receiveTerrainEdgeExchange} from '../src/terrain-edge-exchange.mjs';
import {compileTerrainEdgeSource} from '../src/generation/terrain-edge-source.mjs';
import {transact} from '../src/generation/store.mjs';
import {replay} from '../src/generation/model.mjs';
import {setupCoherent,sourcePng} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';
import {hash} from '../src/generation/common.mjs';

test('neutral diagrams show role-specific solid interior and transparent exterior',()=>{
 const cases={'left-wall':[[180,128],[70,128]],'right-wall':[[70,128],[180,128]],'bottom-edge':[[128,70],[128,180]],
 'left-top-corner':[[180,180],[70,70]],'right-top-corner':[[70,180],[180,70]],
 'left-bottom-corner':[[180,70],[70,180]],'right-bottom-corner':[[70,70],[180,180]]};
 for(const [role,[inside,outside]] of Object.entries(cases)){const g=flow.terrainEdgeTopologyGuide(role),p=inspectPng(g.bytes,{includePixels:true});
  const a=([x,y])=>p.rgba[(y*p.width+x)*4+3];assert.equal(a(inside),255,role);assert.equal(a(outside),0,role);assert.equal(a([0,0]),0);assert.deepEqual(g,flow.terrainEdgeTopologyGuide(role));}
});

test('v2 diagrams explicitly mark exactly the two intended open connections',()=>{
 const cuts={'left-wall':['top','bottom'],'right-wall':['top','bottom'],'bottom-edge':['left','right'],
  'left-top-corner':['right','bottom'],'right-top-corner':['left','bottom'],
  'left-bottom-corner':['top','right'],'right-bottom-corner':['top','left']};
 const points={'left-wall':[[180,128],[70,128]],'right-wall':[[70,128],[180,128]],'bottom-edge':[[128,70],[128,180]],
  'left-top-corner':[[180,180],[70,70]],'right-top-corner':[[70,180],[180,70]],
  'left-bottom-corner':[[180,70],[70,180]],'right-bottom-corner':[[70,70],[180,180]]};
 for(const [role,ends] of Object.entries(cuts)){const a=flow.terrainEdgeTopologyGuideV2(role),p=inspectPng(a.bytes,{includePixels:true}),pixel=(x,y)=>p.rgba.subarray((y*256+x)*4,(y*256+x)*4+4);
  assert.equal(pixel(...points[role][0])[3],255);assert.equal(pixel(...points[role][1])[3],0);
  const white=(x,y)=>pixel(x,y)[0]===255&&pixel(x,y)[3]===255;
  const bars={top:Array.from({length:256},(_,n)=>white(n,0)).some(Boolean),bottom:Array.from({length:256},(_,n)=>white(n,255)).some(Boolean),
    left:Array.from({length:256},(_,n)=>white(0,n)).some(Boolean),right:Array.from({length:256},(_,n)=>white(255,n)).some(Boolean)};
  for(const [edge,found] of Object.entries(bars))assert.equal(found,ends.includes(edge),`${role} ${edge}`);
  assert.deepEqual(a,flow.terrainEdgeTopologyGuideV2(role));assert.notEqual(a.artifact.sha256,flow.terrainEdgeTopologyGuide(role).artifact.sha256);
 }
});

test('opt-in guide is independently frozen, replayed, exported and submitted exactly once',{timeout:600000},t=>{
 const f=setupCoherent(t),base=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:flow.createLayerSourceScopes(f.brief.requirements)});
 flow.authorizeReferenceAssetBatch(f.workflow,base.sha256,decision('topology.base',base.sha256,'approve-compute'));
 for(const [i,sha] of base.planSha256s.entries()){const p=flow.getGenerationPlan(f.workflow,sha),{request,...ticket}=flow.reservePlan(f.workflow,sha);flow.recordSubmission(f.workflow,ticket);flow.receiveResult(f.workflow,ticket,sourcePng(p.target.alpha==='transparent',i+11));}
 const options={batchId:'topology.one',baseBatchSha256:base.sha256,capabilitiesSha256:f.options.capabilitiesSha256,coverageProfile:'full-perimeter-v1',nativeSizeProfile:'bounded-native-4m-v1',renderEnvelopeProfile:'visible-alpha8-outward16-native-rgba-v1',naturalSurfaceProfile:'reference-defined-cover-v1',items:flow.TERRAIN_PERIMETER_ROLES.map((role,i)=>({assetId:'test.edge.'+i,role,content:'One isolated boundary.',exclusions:['Scenery']}))};
 const legacy=flow.previewTerrainEdgeSources(f.workflow,options),guided=flow.previewTerrainEdgeSources(f.workflow,{...options,topologyGuideProfile:flow.TERRAIN_EDGE_TOPOLOGY_PROFILE});
 assert.equal(hash(Buffer.from(legacy.plans[0].request.prompt)),'12d0c5f3cd5e9cd3ea60e70b6aecc934d56d0b02ec8dd1b4ff996b9177054f29');
 assert.equal(legacy.plans[0].request.images.length,2);assert.equal(guided.plans[0].request.images.length,3);
 assert.deepEqual(flow.previewTerrainEdgeSources(f.workflow,options),legacy);assert.notEqual(guided.plans[0].sha256,legacy.plans[0].sha256);
 transact(f.workflow,store=>{const state=replay(store),cap=state.capabilities.get(options.capabilitiesSha256);state.capabilities.set(options.capabilitiesSha256,{...cap,maxInputImages:2});
  assert.throws(()=>compileTerrainEdgeSource(state,guided.plans[0].recipe,sha=>store.readBlob(sha)),e=>e.errors?.some(x=>x.code==='TERRAIN_EDGE_CAPABILITY'));
  state.capabilities.set(options.capabilitiesSha256,{...cap,maxInputImages:3});assert.deepEqual(compileTerrainEdgeSource(state,guided.plans[0].recipe,sha=>store.readBlob(sha)),guided.plans[0]);});
 const batch=flow.freezeTerrainEdgeSources(f.workflow,{...options,topologyGuideProfile:flow.TERRAIN_EDGE_TOPOLOGY_PROFILE});assert.equal(batch.sha256,guided.batch.sha256);
 const plan=flow.getGenerationPlan(f.workflow,batch.planSha256s[0]),guide=flow.terrainEdgeTopologyGuide('left-wall');
 assert.deepEqual(flow.readGenerationInput(f.workflow,plan.sha256,2),guide.bytes);
 prepareTerrainEdgeComputeReview(f.workflow,batch.sha256,join(f.parent,'edge-review'));
 assert.deepEqual(readFileSync(join(f.parent,'edge-review','guide-1.png')),guide.bytes);
 for(const [i,role] of flow.TERRAIN_PERIMETER_ROLES.entries())assert.deepEqual(readFileSync(join(f.parent,'edge-review',`guide-${i+1}.png`)),flow.terrainEdgeTopologyGuide(role).bytes);
 flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('topology.compute',batch.sha256,'approve-compute'));
 const e=reserveTerrainEdgeExchange(f.workflow,batch.sha256,join(f.parent,'exchange'));assert.equal(e.inputs.length,3);
 const decoded=inspectPng(sourcePng(true,55),{includePixels:true});decoded.rgba[3]=1;const raw=encodeRgbaPng(decoded.width,decoded.height,decoded.rgba),png=join(f.parent,'returned.png');writeFileSync(png,raw);receiveTerrainEdgeExchange(f.workflow,join(f.parent,'exchange'),png);
 assert.throws(()=>flow.reservePlan(f.workflow,plan.sha256));
 const proposed=flow.proposeTerrainEdgeCanvasGutterPreparation(f.workflow,plan.sha256,batch.sha256);
 const adopted=flow.prepareAndAdoptTerrainEdgeCanvasGutterSource(f.workflow,{preparationId:'topology.gutter',proposal:proposed.proposal,receipt:decision('topology.gutter.review',proposed.proposal.sha256),parentBatchSha256:batch.sha256,batchId:'topology.continue'});
 assert.equal(adopted.batch.remainingAuthorizedCalls,6);assert.equal(adopted.batch.reusedAuthorizations.length,6);
 const continuation=prepareTerrainEdgeComputeReview(f.workflow,adopted.batch.sha256,join(f.parent,'continued-review'));assert.equal(continuation.maximumCalls,6);
 for(let i=1;i<7;i++)assert.deepEqual(readFileSync(join(f.parent,'continued-review',`guide-${i+1}.png`)),flow.terrainEdgeTopologyGuide(flow.TERRAIN_PERIMETER_ROLES[i]).bytes);
 const v2=flow.previewTerrainEdgeSources(f.workflow,{...options,batchId:'topology.v2',topologyGuideProfile:flow.TERRAIN_EDGE_TOPOLOGY_V2_PROFILE});
 for(const [i,p] of v2.plans.entries()){
  assert.equal(p.compiler,'scene-kit-reference-defined-natural-perimeter-topology-v2');assert.equal(p.request.images.length,3);
  assert.equal(p.request.images[2].artifact.sha256,flow.terrainEdgeTopologyGuideV2(flow.TERRAIN_PERIMETER_ROLES[i]).artifact.sha256);
  assert.match(p.request.prompt,/white dashed bars/);assert.doesNotMatch(p.request.prompt,/ONE complete asset|both short attachment arms visible/);
 }
 transact(f.workflow,store=>{const state=replay(store),cap=state.capabilities.get(options.capabilitiesSha256);state.capabilities.set(options.capabilitiesSha256,{...cap,maxInputImages:2});
  assert.throws(()=>compileTerrainEdgeSource(state,v2.plans[0].recipe,sha=>store.readBlob(sha)),e=>e.errors?.some(x=>x.code==='TERRAIN_EDGE_CAPABILITY'));
  state.capabilities.set(options.capabilitiesSha256,{...cap,maxInputImages:3});assert.deepEqual(compileTerrainEdgeSource(state,v2.plans[0].recipe,sha=>store.readBlob(sha)),v2.plans[0]);});
 const b2=flow.freezeTerrainEdgeSources(f.workflow,{...options,batchId:'topology.v2',topologyGuideProfile:flow.TERRAIN_EDGE_TOPOLOGY_V2_PROFILE});
 assert.equal(b2.sha256,v2.batch.sha256);assert.deepEqual(flow.getGenerationPlan(f.workflow,plan.sha256),plan);
 const lowerOptions={...options,batchId:'topology.lower',topologyGuideProfile:flow.TERRAIN_EDGE_TOPOLOGY_V2_PROFILE,lowerBodyProfile:flow.TERRAIN_LOWER_BODY_PROFILE};
 const baselineOptions={...lowerOptions};delete baselineOptions.lowerBodyProfile;
 const sameBatchBaseline=flow.previewTerrainEdgeSources(f.workflow,baselineOptions);
 const lower=flow.previewTerrainEdgeSources(f.workflow,lowerOptions);
 for(const [i,p] of lower.plans.entries()){
  const role=flow.TERRAIN_PERIMETER_ROLES[i];assert.deepEqual(p.request.images,v2.plans[i].request.images);
  if(flow.TERRAIN_BOTTOM_EDGE_ROLES.includes(role)){
   assert.match(p.request.prompt,/REFERENCE-DEFINED LOWER-BODY CONTRACT/);
   assert.doesNotMatch(p.request.prompt,/Preserve their cover-to-body transition and supporting front face/);
   assert.match(p.request.prompt,/No playable upper surface/);
   assert.notEqual(p.sha256,sameBatchBaseline.plans[i].sha256);
  }else {
   assert.equal(p.request.prompt,v2.plans[i].request.prompt);
   assert.deepEqual(p,sameBatchBaseline.plans[i]);
  }
 }
 transact(f.workflow,store=>{const state=replay(store),upper=sameBatchBaseline.plans.find(p=>p.recipe.edgeRole==='left-wall');
  assert.throws(()=>compileTerrainEdgeSource(state,{...upper.recipe,lowerBodyProfile:flow.TERRAIN_LOWER_BODY_PROFILE},sha=>store.readBlob(sha)),
   e=>e.errors?.some(x=>x.code==='TERRAIN_EDGE_LOWER_BODY_PROFILE'));});
 assert.throws(()=>flow.previewTerrainEdgeSources(f.workflow,{...lowerOptions,lowerBodyProfile:'unknown'}));
 const withoutGuide={...lowerOptions};delete withoutGuide.topologyGuideProfile;
 const lowerUnguided=flow.previewTerrainEdgeSources(f.workflow,withoutGuide);
 assert.equal(lowerUnguided.plans[0].request.images.length,2);
 assert.match(lowerUnguided.plans.find(p=>p.recipe.edgeRole==='bottom-edge').request.prompt,/REFERENCE-DEFINED LOWER-BODY CONTRACT/);
 const withoutCover={...lowerOptions};delete withoutCover.naturalSurfaceProfile;
 assert.throws(()=>flow.previewTerrainEdgeSources(f.workflow,withoutCover));
 const lowerBatch=flow.freezeTerrainEdgeSources(f.workflow,lowerOptions);
 assert.equal(lowerBatch.sha256,lower.batch.sha256);
 for(const [i,sha] of lowerBatch.planSha256s.entries())assert.deepEqual(flow.getGenerationPlan(f.workflow,sha),lower.plans[i]);
 assert.deepEqual(flow.getGenerationPlan(f.workflow,b2.planSha256s[0]),v2.plans[0]);
 prepareTerrainEdgeComputeReview(f.workflow,b2.sha256,join(f.parent,'v2-review'));
 for(let i=0;i<7;i++)assert.deepEqual(readFileSync(join(f.parent,'v2-review',`guide-${i+1}.png`)),flow.terrainEdgeTopologyGuideV2(flow.TERRAIN_PERIMETER_ROLES[i]).bytes);
 flow.authorizeReferenceAssetBatch(f.workflow,b2.sha256,decision('topology.v2.compute',b2.sha256,'approve-compute'));
 const e2=reserveTerrainEdgeExchange(f.workflow,b2.sha256,join(f.parent,'v2-exchange'));assert.equal(e2.inputs.length,3);
 receiveTerrainEdgeExchange(f.workflow,join(f.parent,'v2-exchange'),png);assert.throws(()=>flow.reservePlan(f.workflow,b2.planSha256s[0]));
 const blobV2=join(f.workflow,'blobs',v2.plans[0].request.images[2].artifact.sha256+'.bin'),savedV2=readFileSync(blobV2);writeFileSync(blobV2,Buffer.from('tampered'));
 assert.throws(()=>flow.inspectWorkflow(f.workflow));writeFileSync(blobV2,savedV2);
 const blob=join(f.workflow,'blobs',guide.artifact.sha256+'.bin');writeFileSync(blob,Buffer.from('tampered'));
 assert.throws(()=>flow.inspectWorkflow(f.workflow));
});
