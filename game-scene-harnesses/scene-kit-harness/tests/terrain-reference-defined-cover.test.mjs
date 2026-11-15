import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import * as edge from '../src/generation/terrain-edge-source.mjs';
import * as flow from '../src/generation/index.mjs';
import {digest,hash,seal,unseal} from '../src/generation/common.mjs';
import {sourcePng} from './helpers/coherent.mjs';
import {TERRAIN_EDGE_POLICY} from '../src/generation/terrain-edge-source.mjs';
import {transact} from '../src/generation/store.mjs';
import {applyRecord,replay} from '../src/generation/model.mjs';
import {inspectReferenceLedProject} from '../src/reference-led-pipeline.mjs';
import {reserveTerrainEdgeExchange,receiveTerrainEdgeExchange,stopTerrainEdgeExchange} from '../src/terrain-edge-exchange.mjs';
import {prepareTerrainEdgeComputeReview,buildTerrainEdgeDelivery,verifyTerrainEdgeDelivery} from '../src/terrain-edge-pipeline.mjs';
import {loadSceneKit,contextFor} from '../src/kit.mjs';
import {inspectPng,encodeRgbaPng} from '../src/png.mjs';
import {setupBottomDelivery,bottomSideControls,bottomFixture} from './helpers/terrain-bottom-delivery.mjs';
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


function legacyEvidence(){
  const rows=[],raw=sourcePng(true,503);
  for(const [native,perimeter,city]of [[false,false,false],[false,false,true],[false,true,false],[false,true,true],[true,true,false],[true,true,true]]){
    const f=fixture(),policy=native?(city?edge.ENGINEERED_CITY_TERRAIN_NATIVE_SIZE_PERIMETER_POLICY:edge.TERRAIN_NATIVE_SIZE_PERIMETER_POLICY)
      :perimeter?(city?edge.ENGINEERED_CITY_TERRAIN_PERIMETER_POLICY:edge.TERRAIN_PERIMETER_POLICY)
      :(city?edge.ENGINEERED_CITY_TERRAIN_EDGE_POLICY:edge.TERRAIN_EDGE_POLICY);
    const plans=(perimeter?edge.TERRAIN_PERIMETER_ROLES:edge.TERRAIN_EDGE_ROLES).map((role,i)=>{
      const plan=edge.compileTerrainEdgeSource(f.state,{...f.recipe,planId:'legacy.'+i,assetId:'legacy.'+i,edgeRole:role,policySha256:policy.sha256,
        ...(city?{surfaceFamily:'engineered-city'}:{}),...(perimeter?{coverageProfile:'full-perimeter-v1'}:{}),
        ...(native?{nativeSizeProfile:'bounded-native-4m-v1',renderEnvelopeProfile:'visible-alpha8-outward16-native-rgba-v1'}:{})});
      f.state.plans.set(plan.sha256,{plan,status:'planned'});return plan;
    });
    const batch=edge.compileTerrainEdgeBatch(f.state,{...f.options,planSha256s:plans.map(p=>p.sha256)});
    rows.push({format:plans[0].format,plans:digest(plans),requests:digest(plans.map(p=>p.request)),
      qa:digest(plans.map(p=>edge.assessTerrainEdgeSource(p,raw))),batch:batch.sha256,policy:policy.sha256});
  }
  return rows;
}

// Captured before adding the optional contract. Hashes bind every role and all
// original policy, plan, request, QA and batch documents, including city variants.
const legacyExpected=[
  {
    "format": "ai_scene_generation_plan_v29",
    "plans": "6465a6c925545ad662d6425a0fac113c01a9573847034ae68614826e2cf19c7d",
    "requests": "5aa33580667a9675eb0dabc9e0575d223b89fbbeb7e96a294b2a43db69ad6857",
    "qa": "02f40fe788670c47410061f8b72e070f53abb768fef073d716730a0cfccbcdf0",
    "batch": "95d98b6ef500a6aec7c177be55e059e60ab7337e4fff29fe89856793719a9aeb",
    "policy": "334b58c85a5fc63255796e2defc0aa00e6486d5f61d4aa9e072a8ca6211fa836"
  },
  {
    "format": "ai_scene_generation_plan_v30",
    "plans": "28c8b37377d42223adb47eabcc28b7a89b4ae91d206363bb6daf4e417cc8e909",
    "requests": "6edc20504726e1937d234fccba220243713f2e39fe8202ebe021024d79075d20",
    "qa": "08dfd75eb3d326df44471f499c5074f1acb17b2a2aed6e5708a549a2eacb17e5",
    "batch": "8c540e3f6e8abaade5da1888bf37efa4aa4a31cf576921fb29f597453a4f6489",
    "policy": "27486b55e42d0130899f2f0ddfa078bc2576303016c2b970aaceba1d79630e45"
  },
  {
    "format": "ai_scene_generation_plan_v33",
    "plans": "95c898fe8bc61e899e3c8067894e5f570c2f554946961e4efa85d2d7eef9b751",
    "requests": "a9fac50a0dd95272c76860fa839ade9e80a7f37c5b3ea95731f1147badeb02d1",
    "qa": "e807589be3f33def95ad0886df651aefc2ceed4954205d1cc2cc9777df20b247",
    "batch": "279473cce55eff6c020e8f6813647fae5850b76a9db8358d446cbc2e4ada6290",
    "policy": "6a8b1d60780079ac4bfd1bb15f73a23fb238d3d2148cb64e175e39ced94b8732"
  },
  {
    "format": "ai_scene_generation_plan_v34",
    "plans": "7e72233947c3d6d2089cc60e9d4e2842a7047c66c28be98aaa950f4191cf4d9f",
    "requests": "e0bd24ca1c82793924f8d5034b184a661688485d75b1ed47bb42dd4b930ef4e4",
    "qa": "74b75c8c0f91fa5321fae83e11a636a7db8cb5d94edba7f89323fb1604e2f60d",
    "batch": "d8cbed36e2a78e50a3d7743d5219a0c29b0c3c749a4292139b7a8d9ff948e3d8",
    "policy": "a0f157315f8180d51b6873e31255d02c30d6f9ce328b09f8cc2c5ef10ccc5c4f"
  },
  {
    "format": "ai_scene_generation_plan_v35",
    "plans": "08929e13434cf124ecd6568965f9392370ce442e4551df3063cfa48638c5035d",
    "requests": "753a40706a8213161cd942f3e9ab92c8f18127f4a7e1e1838c9679c9f36a5f6b",
    "qa": "8cebc94e135f1255e0bdae8424d48f7aef82d1105501a90f46e38c28cbfda716",
    "batch": "16474548c2adac1d4a2837c9222ed586165d4d2b770effebe4729bec44c5559c",
    "policy": "4fe9b7b9e8fe0f62a6188529716fbf8542dc33d902e069f42a38363be76bccb4"
  },
  {
    "format": "ai_scene_generation_plan_v36",
    "plans": "1c06f7e62d1dc6b702aaf31f202c7db21c29880030deaac0c8a285b53425bd11",
    "requests": "5bf29f0a9da052669256864a8e8edeafe9791b971e4ec62263ba52e86575fe3e",
    "qa": "c70c69283ccb29d9c77315b8a141cfe21ae7cadc5c4b7f92b21af9ef86cbe43b",
    "batch": "e80e26c4be8fdf6d3f6e63907ca88e0bad1e0ec05028328f72208156f17b1b2e",
    "policy": "9066d0c6e0450a75cd1b6a4aee2e701c588665bb046a15f51ed2fb0bd62d681a"
  }
];
test('legacy v29/v30/v33/v34/v35/v36 plans, requests, policies, batches and QA remain byte-identical',()=>{assert.deepEqual(legacyEvidence(),legacyExpected);});

const profiles={coverageProfile:'full-perimeter-v1',nativeSizeProfile:'bounded-native-4m-v1',
  renderEnvelopeProfile:'visible-alpha8-outward16-native-rgba-v1',naturalSurfaceProfile:'reference-defined-cover-v1'};
function coverPlans(f,content='One native exposed material boundary, with no separate covering or attachments.'){
  return edge.TERRAIN_PERIMETER_ROLES.map((role,index)=>{
    const plan=edge.compileTerrainEdgeSource(f.state,{...f.recipe,...profiles,planId:'cover.'+index,assetId:'cover.'+index,
      edgeRole:role,policySha256:edge.TERRAIN_REFERENCE_DEFINED_COVER_POLICY.sha256,subjectBrief:{content,exclusions:['Independent props']}});
    f.state.plans.set(plan.sha256,{plan,status:'planned'});return plan;
  });
}
test('reference-defined natural cover expresses snow, desert and uncovered rock across all seven roles without preset growth or light',()=>{
  assert.equal(flow.TERRAIN_REFERENCE_DEFINED_COVER_PROFILE,profiles.naturalSurfaceProfile);
  assert.deepEqual(flow.TERRAIN_REFERENCE_DEFINED_COVER_POLICY,edge.TERRAIN_REFERENCE_DEFINED_COVER_POLICY);
  for(const content of ['Snow cover above blue ice body; attached icicles only on the designated corner.',
    'Desert sand cover above dry sandstone body; retain only the design-specified local mineral projections.',
    'Bare rock body continues through an uncovered upper boundary; no separate cap and no attachments.']){
    const f=fixture(),plans=coverPlans(f,content);
    for(const plan of plans){
      assert.equal(plan.format,'ai_scene_generation_plan_v37');assert.equal(plan.request.format,'ai_scene_image_request_v37');
      assert.equal(plan.qualityPolicy.format,'ai_scene_terrain_edge_source_policy_v7');
      for(const field of [plan.recipe,plan.sourceScope,plan.target.sourcePolicy])assert.equal(field.naturalSurfaceProfile,profiles.naturalSurfaceProfile);
      assert.equal(plan.sourceScope.semanticIsolationProven,false);assert.equal(plan.sourceScope.alphaCleanupAllowed,false);
      assert.equal(plan.sourceScope.sourceTransforms,'identity-only-no-rotation-or-mirroring');
      assert.equal(plan.request.maximumCalls,1);assert.equal(plan.request.images.length,2);
      assert.equal(plan.request.images[0].artifact.sha256,plan.referenceEvidence[0].rawSha256);
      assert.equal(plan.request.images[1].artifact.sha256,plan.materialEvidence.rawSha256);
      assert.match(plan.request.prompt,new RegExp(content.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
      assert.match(plan.request.prompt,/accepted reference, original native material and explicit subject brief/);
      assert.match(plan.request.prompt,/Include attached details ONLY when specified/);
      assert.match(plan.request.prompt,/no separate covering.*without inventing a cap/);
      assert.doesNotMatch(plan.request.prompt,/leaf|soil|grass|moss|vegetation|roots|manufactured|concrete|metal-panel|neon/i);
      assert.match(plan.request.prompt,/visible-alpha8-outward16-native-rgba-v1/);
      assert.match(plan.request.prompt,/maximum of|at most 4,194,304 total pixels/);
      edge.assertTerrainEdgeCurrent(f.state,plan);
      const qa=edge.assessTerrainEdgeSource(plan,sourcePng(true,504));assert.equal(qa.status,'pass');
      assert.equal(qa.format,'ai_scene_terrain_edge_source_qa_v7');assert.equal(qa.naturalSurfaceProfile,profiles.naturalSurfaceProfile);
      assert.equal(qa.coverAndBodyAcceptance,'not-assessed');assert.equal(qa.automaticSemanticDetection,false);
      assert.equal(qa.maximumPixels,4194304);assert.equal(qa.renderEnvelopeMeasurement,'not-assessed-pending-explicit-native-controls');
      assert.equal(edge.assessTerrainEdgeSource(plan,sourcePng(false,504)).status,'fail');
      assert(edge.assessTerrainEdgeSource({...plan,materialEvidence:{...plan.materialEvidence,rawSha256:hash(sourcePng(true,504))}},sourcePng(true,504)).issues.includes('TERRAIN_EDGE_MATERIAL_REUSE'));
    }
    const batch=edge.compileTerrainEdgeBatch(f.state,{...f.options,planSha256s:plans.map(p=>p.sha256)});
    assert.equal(batch.format,'ai_scene_terrain_edge_batch_v7');assert.equal(batch.naturalSurfaceProfile,profiles.naturalSurfaceProfile);
    assert.equal(batch.maximumCalls,7);assert.equal(batch.fullPerimeterComplete,true);assert.deepEqual(batch.expectedRoles,edge.TERRAIN_PERIMETER_ROLES);
  }
});

test('new cover profile refuses illegal combinations, mixed batches and incomplete coverage without changing legacy policies',()=>{
  const f=fixture(),plans=coverPlans(f),recipe=plans[0].recipe,options={...f.options,planSha256s:plans.map(p=>p.sha256)};
  for(const change of [{naturalSurfaceProfile:'snow-only'},{naturalSurfaceProfile:null},{naturalSurfaceProfile:''},{surfaceFamily:'engineered-city'}])
    rejects(()=>edge.compileTerrainEdgeSource(f.state,{...recipe,...change}),'TERRAIN_EDGE_NATURAL_SURFACE_PROFILE');
  const {nativeSizeProfile,renderEnvelopeProfile,coverageProfile,naturalSurfaceProfile,...base}=recipe;
  rejects(()=>edge.compileTerrainEdgeSource(f.state,{...base,naturalSurfaceProfile}),'TERRAIN_EDGE_NATURAL_SURFACE_PROFILE');
  rejects(()=>edge.compileTerrainEdgeSource(f.state,{...base,naturalSurfaceProfile,coverageProfile}),'TERRAIN_EDGE_NATURAL_SURFACE_PROFILE');
  rejects(()=>edge.compileTerrainEdgeSource(f.state,{...recipe,renderEnvelopeProfile:'arbitrary-clipping'}),'TERRAIN_EDGE_RENDER_ENVELOPE_PROFILE');
  rejects(()=>edge.compileTerrainEdgeSource(f.state,{...recipe,policySha256:edge.TERRAIN_NATIVE_SIZE_PERIMETER_POLICY.sha256}),'TERRAIN_EDGE_RECIPE');
  rejects(()=>edge.assertTerrainEdgeCurrent(f.state,{...plans[0],format:'ai_scene_generation_plan_v35'}),'TERRAIN_EDGE_POLICY');
  rejects(()=>edge.compileTerrainEdgeBatch(f.state,{...options,planSha256s:plans.slice(0,4).map(p=>p.sha256)}),'TERRAIN_EDGE_BATCH_COVERAGE');
  const old=edge.compileTerrainEdgeSource(f.state,{...base,planId:'old.native',assetId:'old.native',coverageProfile,nativeSizeProfile,renderEnvelopeProfile,
    policySha256:edge.TERRAIN_NATIVE_SIZE_PERIMETER_POLICY.sha256});f.state.plans.set(old.sha256,{plan:old,status:'planned'});
  rejects(()=>edge.compileTerrainEdgeBatch(f.state,{...options,planSha256s:[old.sha256,...plans.slice(1).map(p=>p.sha256)]}),'TERRAIN_EDGE_BATCH_FAMILY');
  // Existing explicit upgrade and replacement rules remain available; they do
  // not advertise a complete perimeter when fewer than seven roles are listed.
  const bottom=edge.compileTerrainEdgeBatch(f.state,{...options,planSha256s:plans.slice(4).map(p=>p.sha256)});
  assert.equal(bottom.coverage,'bottom-only-upgrade');assert.equal(bottom.fullPerimeterComplete,false);
  const replacement=edge.compileTerrainEdgeBatch(f.state,{...options,planSha256s:[plans[4].sha256],coverageIntent:'explicit-subset-replacement'});
  assert.equal(replacement.coverage,'explicit-subset-replacement');assert.equal(replacement.maximumCalls,1);
});

const cli=(args)=>{
  const result=spawnSync(process.execPath,['scripts/terrain-edges.mjs',...args],{cwd:new URL('../',import.meta.url),encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
};
test('new natural cover replays through SDK, CLI, project validation, single-use exchange and native v2 perimeter derivation',{timeout:1200000},t=>{
  const f=setupBottomDelivery(t,{receiveSides:false}),bottom=bottomFixture(),raws=new Map([...f.raws,...bottom.raws]),
    options={batchId:'reference.cover.full',baseBatchSha256:f.base.sha256,capabilitiesSha256:f.options.capabilitiesSha256,...profiles,
      items:flow.TERRAIN_PERIMETER_ROLES.map((role,i)=>({assetId:'reference.cover.'+i,role,
        content:'One design-specified natural material boundary; no separate cover or attachments.',exclusions:['Independent props']}))},
    optionsPath=join(f.parent,'reference-cover-options.json');
  writeFileSync(optionsPath,JSON.stringify(options));
  const before=flow.inspectWorkflow(f.workflow),preview=cli(['preview','--workflow',f.workflow,'--options',optionsPath]);
  assert.equal(preview.generationCalls,0);assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
  for(const change of [{surfaceFamily:'engineered-city'},{naturalSurfaceProfile:'automatic'},{nativeSizeProfile:undefined,renderEnvelopeProfile:undefined}]){
    const changed=JSON.parse(JSON.stringify({...options,...change}));
    rejects(()=>flow.freezeTerrainEdgeSources(f.workflow,changed),'TERRAIN_EDGE_NATURAL_SURFACE_PROFILE');
    assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
  }
  const batch=cli(['freeze','--workflow',f.workflow,'--options',optionsPath]);assert.equal(batch.sha256,preview.batch.sha256);
  assert.deepEqual(cli(['inspect','--workflow',f.workflow,'--batch',batch.sha256]).batch,batch);
  assert.equal(inspectReferenceLedProject(f.root).reference.status,'accepted');
  const review=prepareTerrainEdgeComputeReview(f.workflow,batch.sha256,join(f.parent,'cover-compute-review'));
  assert.equal(review.naturalSurfaceProfile,profiles.naturalSurfaceProfile);assert.equal(review.maximumCalls,7);assert.equal(review.generationCalls,0);
  for(const sha of batch.planSha256s)rejects(()=>flow.reservePlan(f.workflow,sha),'AUTHORIZATION_REQUIRED');
  rejects(()=>flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('wrong.compute',f.batch.sha256,'approve-compute')),'AUTHORIZATION_STATE');
  const decisionPath=join(f.parent,'cover-compute-decision.json');writeFileSync(decisionPath,JSON.stringify(decision('cover.compute',batch.sha256,'approve-compute')));
  cli(['authorize','--workflow',f.workflow,'--batch',batch.sha256,'--decision',decisionPath]);
  for(const [i,sha]of batch.planSha256s.entries()){
    const plan=flow.getGenerationPlan(f.workflow,sha),directory=join(f.parent,'cover-exchange-'+i),
      exchange=i===0?cli(['reserve','--workflow',f.workflow,'--batch',batch.sha256,'--out',directory]):reserveTerrainEdgeExchange(f.workflow,batch.sha256,directory);
    assert.equal(exchange.request.format,'ai_scene_image_request_v37');assert.equal(exchange.ticket.planSha256,sha);
    assert.equal(exchange.ticket.requestSha256,digest(plan.request));assert.equal(exchange.maximumCalls,1);
    for(const [index,input]of exchange.inputs.entries())assert.deepEqual(readFileSync(join(directory,input.path)),flow.readGenerationInput(f.workflow,sha,index));
    const raw=raws.get(plan.recipe.edgeRole),file=join(f.parent,'cover-source-'+i+'.png');writeFileSync(file,raw);
    if(i===0)cli(['receive','--workflow',f.workflow,'--exchange',directory,'--file',file]);else receiveTerrainEdgeExchange(f.workflow,directory,file);
    const result=flow.getGenerationResult(f.workflow,sha);assert.equal(result.result.technical.format,'ai_scene_terrain_edge_source_qa_v7');
    assert.deepEqual(result.bytes,raw);assert.equal(flow.recheckResult(f.workflow,sha,hash(raw)).sha256,result.result.technical.sha256);
    rejects(()=>flow.reservePlan(f.workflow,sha),'RESERVATION_STATE');
  }
  const inputs=flow.getTerrainEdgeInputs(f.workflow,batch.sha256);assert.equal(inputs.sources.length,7);
  const stateBeforeDelivery=flow.inspectWorkflow(f.workflow),delivery={...f.deliveryOptions,batchSha256:batch.sha256,
    controls:{...bottomSideControls(f),bottom:{...bottom.controls,nativeSizeProfile:profiles.nativeSizeProfile,renderEnvelopeProfile:profiles.renderEnvelopeProfile}},
    output:join(f.parent,'reference-cover-delivery')};
  const missing={...delivery,controls:structuredClone(delivery.controls),output:join(f.parent,'missing-native-cover-envelope')};
  delete missing.controls.bottom.nativeSizeProfile;delete missing.controls.bottom.renderEnvelopeProfile;
  rejects(()=>buildTerrainEdgeDelivery(missing),'TERRAIN_BOTTOM_NATIVE_SIZE_PROFILE');assert.equal(existsSync(missing.output),false);
  const report=buildTerrainEdgeDelivery(delivery),context=contextFor(loadSceneKit(join(delivery.output,'candidate/kit')));
  assert.equal(context.kit.terrainBottomEdges.format,'ai_scene_terrain_bottom_edges_v2');assert.equal(report.generationCalls,0);
  assert.equal(report.finalHumanArtReview,'pending');assert.equal(verifyTerrainEdgeDelivery(delivery).reportSha256,report.sha256);
  assert.deepEqual(flow.inspectWorkflow(f.workflow),stateBeforeDelivery);
  for(const source of inputs.sources)assert.deepEqual(readFileSync(join(delivery.output,'candidate/source/'+source.plan.recipe.edgeRole+'-native.png')),source.raw);
  // Replay compares the compiled request and all input bindings; relabeling a
  // frozen request to the legacy version cannot preserve its authorization.
  transact(f.workflow,store=>{
    const state=replay(store),plan=inputs.sources[0].plan;
    const changed=seal({...unseal(plan),request:{...plan.request,format:'ai_scene_image_request_v35'}});
    rejects(()=>applyRecord(store,state,changed),'PLAN_RECOMPILE_MISMATCH');
  });
  const next=flow.freezeTerrainEdgeSources(f.workflow,{...options,batchId:'reference.cover.next',
    items:options.items.map((item,i)=>({...item,assetId:'reference.cover.next.'+i}))});
  rejects(()=>flow.authorizeReferenceAssetBatch(f.workflow,next.sha256,decision('reuse.cover.compute',batch.sha256,'approve-compute')),'AUTHORIZATION_STATE');
  flow.authorizeReferenceAssetBatch(f.workflow,next.sha256,decision('cover.next.compute',next.sha256,'approve-compute'));
  const unknownDirectory=join(f.parent,'cover-terminal-unknown'),unknown=reserveTerrainEdgeExchange(f.workflow,next.sha256,unknownDirectory);
  stopTerrainEdgeExchange(f.workflow,unknownDirectory);
  assert.equal(flow.inspectWorkflow(f.workflow).plans.find(plan=>plan.planSha256===unknown.ticket.planSha256).status,'indeterminate');
  rejects(()=>flow.reservePlan(f.workflow,unknown.ticket.planSha256),'RESERVATION_STATE');
  rejects(()=>reserveTerrainEdgeExchange(f.workflow,next.sha256,join(f.parent,'never-retry-cover')),'TERRAIN_EDGE_BATCH_STOPPED');
  assert.deepEqual(flow.getTerrainEdgeInputs(f.workflow,batch.sha256).batch,batch);
});

test('new native QA retains the four-million-pixel and real four-side gutter gates',()=>{
  const f=fixture();f.state.capabilities.get(f.recipe.capabilitiesSha256).maxWidth=4096;f.state.capabilities.get(f.recipe.capabilitiesSha256).maxHeight=4096;
  const plan=coverPlans(f)[4];assert.equal(plan.target.sourcePolicy.maximumWidth,4096);
  const rgba=Buffer.alloc(3000*1500*4);
  for(let y=40;y<1460;y++)for(let x=40;x<2960;x++)rgba.set([50+x%80,80+y%40,120,255],(y*3000+x)*4);
  assert(edge.assessTerrainEdgeSource(plan,encodeRgbaPng(3000,1500,rgba)).issues.includes('TERRAIN_EDGE_NATIVE_SIZE_PIXELS'));
  const bytes=sourcePng(true,501),png=inspectPng(bytes,{includePixels:true}),touch=Buffer.from(png.rgba);touch.set([30,40,50,1],(140*png.width)*4);
  assert(edge.assessTerrainEdgeSource(plan,encodeRgbaPng(png.width,png.height,touch)).issues.includes('TERRAIN_EDGE_NATIVE_GUTTER'));
});
