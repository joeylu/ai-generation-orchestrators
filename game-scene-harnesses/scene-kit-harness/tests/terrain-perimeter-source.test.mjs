import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {writeFileSync} from 'node:fs';
import {encodeRgbaPng} from '../src/png.mjs';
import * as flow from '../src/generation/index.mjs';
import {TERRAIN_EDGE_POLICY,TERRAIN_PERIMETER_POLICY,ENGINEERED_CITY_TERRAIN_PERIMETER_POLICY,TERRAIN_PERIMETER_COVERAGE_PROFILE,
  TERRAIN_EDGE_ROLES,TERRAIN_BOTTOM_EDGE_ROLES,TERRAIN_PERIMETER_ROLES,compileTerrainEdgeSource,compileTerrainEdgeBatch,
  assertTerrainEdgeCurrent,assessTerrainEdgeSource} from '../src/generation/terrain-edge-source.mjs';
import {hash,seal,unseal} from '../src/generation/common.mjs';
import {applyRecord,replay} from '../src/generation/model.mjs';
import {transact} from '../src/generation/store.mjs';
import {inspectReferenceLedProject} from '../src/reference-led-pipeline.mjs';
import {reserveTerrainEdgeExchange,receiveTerrainEdgeExchange,stopTerrainEdgeExchange} from '../src/terrain-edge-exchange.mjs';
import {setupCoherent,sourcePng} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';

const rejects=(action,code)=>assert.throws(action,error=>error.errors?.some(issue=>issue.code===code));
function fixture(){
  const d=n=>n.repeat(64),spec=d('a'),style=d('b'),cap=d('c'),ref=d('d'),target=d('e'),material=d('f'),raw=d('1'),base=d('2'),refRaw=d('3'),
    recipe={planId:'edge.fixture',parents:[],stage:'terrain-edge-source',specSha256:spec,styleSha256:style,capabilitiesSha256:cap,
      referencePlans:[ref],inventoryRefs:[],assetId:'edge.left',targetSha256:target,baseBatchSha256:base,materialPlanSha256:material,
      materialRawSha256:raw,policySha256:TERRAIN_EDGE_POLICY.sha256,edgeRole:'left-wall',subjectBrief:{content:'One compact warm painted edge.',exclusions:['Independent props']}},
    state={activeSpec:spec,activeStyle:style,designs:new Map([[spec,{format:'ai_scene_spec_v3'}],
      [style,{format:'ai_scene_style_v2',name:'fixture style',rules:['Preserve local color.']}]]),
      capabilities:new Map([[cap,{imageToImage:true,transparentBackground:true,maxInputImages:2,maxWidth:2048,maxHeight:2048}]]),
      plans:new Map([[ref,{status:'accepted',plan:{sha256:ref,recipe:{specSha256:spec,styleSha256:style},designReviews:[]},
        result:{rawSha256:refRaw,technical:{image:{sha256:refRaw,byteLength:16,pixelSize:{width:1024,height:576}}}},
        reconstructionTarget:{sha256:target,acceptedPacketSha256:d('4'),humanReceiptSha256:d('5')}}],
      [material,{status:'pending-visual-review',plan:{sha256:material,format:'ai_scene_generation_plan_v27',recipe:{targetSha256:target},
        instanceBinding:{role:'material'},referenceEvidence:[{rawSha256:refRaw}]},result:{rawSha256:raw,
        technical:{status:'pass',sha256:d('6'),image:{sha256:raw,byteLength:24,pixelSize:{width:1024,height:512}}}}}]]),
      batches:new Map([[base,{format:'ai_scene_coherent_source_batch_v1',sha256:base,referencePlanSha256:ref,planSha256s:[material]}]])};
  return {state,recipe,options:{batchId:'perimeter.fixture',baseBatchSha256:base}};
}
function perimeterPlans(f,{city=false,roles=TERRAIN_PERIMETER_ROLES,prefix='perimeter'}={}){
  return roles.map((role,index)=>{
    const plan=compileTerrainEdgeSource(f.state,{...f.recipe,planId:prefix+'.'+index,assetId:prefix+'.'+index,edgeRole:role,
      coverageProfile:TERRAIN_PERIMETER_COVERAGE_PROFILE,policySha256:(city?ENGINEERED_CITY_TERRAIN_PERIMETER_POLICY:TERRAIN_PERIMETER_POLICY).sha256,
      ...(city?{surfaceFamily:'engineered-city'}:{})});
    f.state.plans.set(plan.sha256,{plan,status:'planned'});return plan;
  });
}
const items=(roles,prefix)=>roles.map((role,index)=>({assetId:prefix+'.'+index,role,
  content:'One original-color native exposed section; retain its original front-face material scale and illumination.',exclusions:['Independent props']}));
const receive=(root,sha,bytes)=>{const {request,...ticket}=flow.reservePlan(root,sha);flow.recordSubmission(root,ticket);return flow.receiveResult(root,ticket,bytes);};

test('full-perimeter profiles version all seven roles while native bottom prompts preserve orientation, source purity and unmeasured scale',()=>{
  assert.deepEqual(TERRAIN_EDGE_ROLES,['left-wall','right-wall','left-top-corner','right-top-corner']);
  assert.deepEqual(TERRAIN_BOTTOM_EDGE_ROLES,['bottom-edge','left-bottom-corner','right-bottom-corner']);
  for(const city of [false,true]){
    const f=fixture(),plans=perimeterPlans(f,{city});
    for(const plan of plans){
      assert.equal(plan.format,city?'ai_scene_generation_plan_v34':'ai_scene_generation_plan_v33');
      assert.equal(plan.request.format,city?'ai_scene_image_request_v34':'ai_scene_image_request_v33');
      assert.equal(plan.request.images.length,2);assert.equal(plan.request.maximumCalls,1);assert.equal(plan.target.alpha,'transparent');
      assert.equal(plan.recipe.coverageProfile,'full-perimeter-v1');assert.equal(plan.sourceScope.sourceToWorldScale,'pending-explicit-native-measurement');
      assert.equal(plan.sourceScope.sourceTransforms,'identity-only-no-rotation-or-mirroring');
      assert.equal(plan.sourceScope.semanticIsolationProven,false);assert.equal(plan.sourceScope.alphaCleanupAllowed,false);
      assert.equal(plan.qualityPolicy.maximumCallsPerPlan,1);assert.equal(plan.qualityPolicy.automaticRetry,false);assertTerrainEdgeCurrent(f.state,plan);
      if(TERRAIN_BOTTOM_EDGE_ROLES.includes(plan.recipe.edgeRole)){
        assert.match(plan.request.prompt,/Image 1.*COMPLETE scene/);assert.match(plan.request.prompt,/Image 2.*COMPLETE native solid-section/);
        assert.match(plan.request.prompt,/Do not rotate, flip or mirror a top lip/);assert.match(plan.request.prompt,/SAME original scene illumination/);
        assert.match(plan.request.prompt,/at least 12 percent completely transparent.*ALL FOUR/);assert.match(plan.request.prompt,/explicitly measured AFTER reception/);
        assert.match(plan.request.prompt,/No post-generation Alpha cleanup, recoloring/);
        assert.match(plan.request.prompt,city?/deliberate clean manufactured corners/:/broad irregular rock or earth/);
        assert.equal(plan.visualReviewChecklist.automatedSemanticDetection,false);
      }
    }
    assert.match(plans.find(p=>p.recipe.edgeRole==='bottom-edge').request.prompt,/empty exterior is BELOW.*ABOVE/);
    assert.match(plans.find(p=>p.recipe.edgeRole==='left-bottom-corner').request.prompt,/extends RIGHT.*UP.*LEFT/);
    assert.match(plans.find(p=>p.recipe.edgeRole==='right-bottom-corner').request.prompt,/extends LEFT.*UP.*RIGHT/);
  }
});

test('new batches require bottom-three or full-seven by default and identify explicit replacement subsets without certifying full coverage',()=>{
  for(const city of [false,true]){
    const f=fixture(),plans=perimeterPlans(f,{city}),full=compileTerrainEdgeBatch(f.state,{...f.options,planSha256s:plans.map(p=>p.sha256)}),
      bottom=compileTerrainEdgeBatch(f.state,{...f.options,planSha256s:plans.slice(4).map(p=>p.sha256)});
    assert.equal(full.format,city?'ai_scene_terrain_edge_batch_v4':'ai_scene_terrain_edge_batch_v3');
    assert.equal(full.coverage,'full-perimeter');assert.equal(full.fullPerimeterComplete,true);assert.equal(full.maximumCalls,7);
    assert.deepEqual(full.expectedRoles,TERRAIN_PERIMETER_ROLES);assert.deepEqual(full.requestedRoles,TERRAIN_PERIMETER_ROLES);
    assert.equal(bottom.coverage,'bottom-only-upgrade');assert.equal(bottom.fullPerimeterComplete,false);assert.equal(bottom.maximumCalls,3);
    assert.deepEqual(bottom.expectedRoles,TERRAIN_BOTTOM_EDGE_ROLES);assert.deepEqual(bottom.requestedRoles,TERRAIN_BOTTOM_EDGE_ROLES);
    for(const subset of [plans.slice(0,4),plans.slice(4,5),[plans[0],plans[4],plans[5]]])
      rejects(()=>compileTerrainEdgeBatch(f.state,{...f.options,planSha256s:subset.map(p=>p.sha256)}),'TERRAIN_EDGE_BATCH_COVERAGE');
    const replacement=compileTerrainEdgeBatch(f.state,{...f.options,planSha256s:[plans[4].sha256],coverageIntent:'explicit-subset-replacement'});
    assert.equal(replacement.coverage,'explicit-subset-replacement');assert.equal(replacement.coverageIntent,'explicit-subset-replacement');
    assert.equal(replacement.fullPerimeterComplete,false);assert.equal(replacement.newImageRequests,1);assert.deepEqual(replacement.requestedRoles,['bottom-edge']);
    rejects(()=>compileTerrainEdgeBatch(f.state,{...f.options,planSha256s:[plans[4].sha256],coverageIntent:'automatic-retry'}),'TERRAIN_EDGE_COVERAGE_INTENT');
  }
  const f=fixture(),plan=perimeterPlans(f)[4];
  rejects(()=>compileTerrainEdgeSource(f.state,{...plan.recipe,coverageProfile:'maybe-bottom'}),'TERRAIN_EDGE_COVERAGE_PROFILE');
  rejects(()=>compileTerrainEdgeSource(f.state,{...f.recipe,edgeRole:'bottom-edge'}),'TERRAIN_EDGE_RECIPE');
  rejects(()=>compileTerrainEdgeSource(f.state,{...plan.recipe,policySha256:TERRAIN_EDGE_POLICY.sha256}),'TERRAIN_EDGE_RECIPE');
  rejects(()=>assertTerrainEdgeCurrent(f.state,{...plan,format:'ai_scene_generation_plan_v29'}),'TERRAIN_EDGE_POLICY');
  const legacy=compileTerrainEdgeSource(f.state,{...f.recipe,planId:'legacy.left',assetId:'legacy.left'});f.state.plans.set(legacy.sha256,{plan:legacy,status:'planned'});
  rejects(()=>compileTerrainEdgeBatch(f.state,{...f.options,planSha256s:[legacy.sha256,plan.sha256],coverageIntent:'explicit-subset-replacement'}),'TERRAIN_EDGE_BATCH_FAMILY');
});

test('bottom QA is versioned technical evidence and preserves the existing transparency, reuse and terminal-attempt gates',()=>{
  for(const city of [false,true]){
    const f=fixture(),plan=perimeterPlans(f,{city,roles:TERRAIN_BOTTOM_EDGE_ROLES})[0],raw=sourcePng(true,201),qa=assessTerrainEdgeSource(plan,raw);
    assert.equal(qa.format,city?'ai_scene_terrain_edge_source_qa_v4':'ai_scene_terrain_edge_source_qa_v3');
    assert.equal(qa.coverageProfile,'full-perimeter-v1');assert.equal(qa.sourceToWorldScale,'not-assessed');assert.equal(qa.status,'pass');
    assert.equal(qa.rawSha256,hash(raw));assert.equal(qa.semanticArtAcceptance,'not-assessed');assert.equal(qa.automaticSemanticDetection,false);
    assert.equal(assessTerrainEdgeSource(plan,sourcePng(false,201)).status,'fail');
    const reused=assessTerrainEdgeSource({...plan,materialEvidence:{...plan.materialEvidence,rawSha256:hash(raw)}},raw);
    assert(reused.issues.includes('TERRAIN_EDGE_MATERIAL_REUSE'));assert.equal(reused.status,'fail');
  }
});

test('new perimeter requests and PNG QA share the 2048-side delivery limit while legacy 4096 capability remains unchanged',()=>{
  const f=fixture(),cap=f.state.capabilities.get(f.recipe.capabilitiesSha256);
  f.state.capabilities.set(f.recipe.capabilitiesSha256,{...cap,maxWidth:4096,maxHeight:4096});
  const plans=[...perimeterPlans(f,{roles:TERRAIN_BOTTOM_EDGE_ROLES,prefix:'natural.limit'}),
    ...perimeterPlans(f,{city:true,roles:TERRAIN_BOTTOM_EDGE_ROLES,prefix:'city.limit'})],legacy=compileTerrainEdgeSource(f.state,f.recipe);
  assert.equal(legacy.target.sourcePolicy.maximumWidth,4096);assert.equal(legacy.target.sourcePolicy.maximumHeight,4096);
  for(const plan of plans){assert.equal(plan.target.sourcePolicy.maximumWidth,2048);assert.equal(plan.target.sourcePolicy.maximumHeight,2048);
    assert.match(plan.request.prompt,/maximum 2048x2048/);}
  for(const [width,height]of [[2049,512],[512,2049]]){
    const rgba=Buffer.alloc(width*height*4);
    for(let y=32;y<height-32;y++)for(let x=32;x<width-32;x++)rgba.set([40+x%130,75+y%90,110,255],(y*width+x)*4);
    const bytes=encodeRgbaPng(width,height,rgba);
    assert.equal(assessTerrainEdgeSource(legacy,bytes).status,'pass','historical edge plans keep their existing source-size contract');
    for(const plan of plans){const qa=assessTerrainEdgeSource(plan,bytes);assert.equal(qa.status,'fail');assert(qa.issues.includes('OUTPUT_SIZE'));}
  }
});

test('bottom-only upgrade and full-perimeter workflows replay with fresh exact authorization, checked exchange and immutable previous side results',{timeout:240000},t=>{
  const f=setupCoherent(t),base=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:flow.createLayerSourceScopes(f.brief.requirements)});
  flow.authorizeReferenceAssetBatch(f.workflow,base.sha256,decision('base.compute',base.sha256,'approve-compute'));
  for(const [index,sha]of base.planSha256s.entries()){
    const plan=flow.getGenerationPlan(f.workflow,sha);receive(f.workflow,sha,sourcePng(plan.target.alpha==='transparent',index+210));
  }
  const common={baseBatchSha256:base.sha256,capabilitiesSha256:f.options.capabilitiesSha256,surfaceFamily:'engineered-city'},
    old=flow.freezeTerrainEdgeSources(f.workflow,{...common,batchId:'legacy.sides',items:items(TERRAIN_EDGE_ROLES,'legacy.side')});
  flow.authorizeReferenceAssetBatch(f.workflow,old.sha256,decision('legacy.sides.compute',old.sha256,'approve-compute'));
  for(const [index,sha]of old.planSha256s.entries())receive(f.workflow,sha,sourcePng(true,index+230));
  const previous=old.planSha256s.map(sha=>flow.getGenerationResult(f.workflow,sha)),options={...common,batchId:'bottom.upgrade',coverageProfile:'full-perimeter-v1',
      items:items(TERRAIN_BOTTOM_EDGE_ROLES,'bottom.native')},before=flow.inspectWorkflow(f.workflow),preview=flow.previewTerrainEdgeSources(f.workflow,options);
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);assert.equal(preview.generationCalls,0);assert.equal(preview.executable,false);
  for(const value of [{...options,items:items(TERRAIN_EDGE_ROLES,'incomplete.four')},{...options,coverageProfile:'legacy'},
    {...options,items:items(TERRAIN_BOTTOM_EDGE_ROLES.slice(0,1),'incomplete.one')}]){
    assert.throws(()=>flow.freezeTerrainEdgeSources(f.workflow,value));assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
  }
  const batch=flow.freezeTerrainEdgeSources(f.workflow,options);assert.equal(batch.sha256,preview.batch.sha256);
  assert.equal(flow.inspectWorkflow(f.workflow).eventCount,before.eventCount+4);
  assert.deepEqual(flow.getTerrainEdgeSourceBatch(f.workflow,batch.sha256),batch);assert.equal(inspectReferenceLedProject(f.root).reference.status,'accepted');
  for(const sha of batch.planSha256s)rejects(()=>flow.reservePlan(f.workflow,sha),'AUTHORIZATION_REQUIRED');
  rejects(()=>flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('old.authorization',old.sha256,'approve-compute')),'AUTHORIZATION_STATE');
  flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('bottom.fresh.compute',batch.sha256,'approve-compute'));
  const material=flow.getGenerationResult(f.workflow,base.planSha256s[0]);
  for(const [index,sha]of batch.planSha256s.entries()){
    assert.deepEqual(flow.readGenerationInput(f.workflow,sha,0),f.raw);assert.deepEqual(flow.readGenerationInput(f.workflow,sha,1),material.bytes);
    const dir=join(f.root,'bottom-exchange-'+index),exchange=reserveTerrainEdgeExchange(f.workflow,batch.sha256,dir);
    assert.equal(exchange.request.format,'ai_scene_image_request_v34');assert.equal(exchange.inputs.length,2);assert.equal(exchange.maximumCalls,1);
    const raw=sourcePng(true,index+240),file=join(f.root,'bottom-native-'+index+'.png');writeFileSync(file,raw);
    receiveTerrainEdgeExchange(f.workflow,dir,file);const result=flow.getGenerationResult(f.workflow,sha);
    assert.deepEqual(result.bytes,raw);assert.equal(result.result.technical.status,'pass');assert.equal(result.result.technical.format,'ai_scene_terrain_edge_source_qa_v4');
    assert.equal(flow.recheckResult(f.workflow,sha,hash(raw)).sha256,result.result.technical.sha256);rejects(()=>flow.reservePlan(f.workflow,sha),'RESERVATION_STATE');
  }
  assert.equal(flow.getTerrainEdgeInputs(f.workflow,batch.sha256).sources.length,3);
  assert.deepEqual(old.planSha256s.map(sha=>flow.getGenerationResult(f.workflow,sha)),previous);
  rejects(()=>flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('bottom.repeat',batch.sha256,'approve-compute')),'AUTHORIZATION_STATE');
  const replacement=flow.freezeTerrainEdgeSources(f.workflow,{...common,batchId:'bottom.replacement',coverageProfile:'full-perimeter-v1',
    coverageIntent:'explicit-subset-replacement',items:items(['bottom-edge'],'bottom.replacement')});
  rejects(()=>flow.reservePlan(f.workflow,replacement.planSha256s[0]),'AUTHORIZATION_REQUIRED');
  flow.authorizeReferenceAssetBatch(f.workflow,replacement.sha256,decision('replacement.compute',replacement.sha256,'approve-compute'));
  const unknownDir=join(f.root,'unknown-bottom'),unknown=reserveTerrainEdgeExchange(f.workflow,replacement.sha256,unknownDir);stopTerrainEdgeExchange(f.workflow,unknownDir);
  rejects(()=>flow.reservePlan(f.workflow,unknown.ticket.planSha256),'RESERVATION_STATE');
  rejects(()=>reserveTerrainEdgeExchange(f.workflow,replacement.sha256,join(f.root,'never-retry')),'TERRAIN_EDGE_BATCH_STOPPED');
  const full=flow.freezeTerrainEdgeSources(f.workflow,{...common,batchId:'future.full',coverageProfile:'full-perimeter-v1',items:items(TERRAIN_PERIMETER_ROLES,'future.full')});
  assert.equal(full.maximumCalls,7);assert.equal(full.fullPerimeterComplete,true);assert.equal(full.coverage,'full-perimeter');
  assert.deepEqual(flow.getTerrainEdgeSourceBatch(f.workflow,full.sha256),full);
  transact(f.workflow,store=>{
    const state=replay(store),tampered=seal({...unseal(full),fullPerimeterComplete:false});
    rejects(()=>applyRecord(store,state,tampered),'TERRAIN_EDGE_BATCH_REPLAY');
  });
  for(const sha of full.planSha256s)rejects(()=>flow.reservePlan(f.workflow,sha),'AUTHORIZATION_REQUIRED');
});
