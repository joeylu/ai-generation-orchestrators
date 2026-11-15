import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {writeFileSync} from 'node:fs';
import {inspectPng,encodeRgbaPng} from '../src/png.mjs';
import * as flow from '../src/generation/index.mjs';
import {TERRAIN_EDGE_POLICY,ENGINEERED_CITY_TERRAIN_EDGE_POLICY,compileTerrainEdgeSource,compileTerrainEdgeBatch,
  assertTerrainEdgeCurrent,assessTerrainEdgeSource} from '../src/generation/terrain-edge-source.mjs';
import {hash,seal,unseal} from '../src/generation/common.mjs';
import {applyRecord,replay} from '../src/generation/model.mjs';
import {transact} from '../src/generation/store.mjs';
import {inspectReferenceLedProject} from '../src/reference-led-pipeline.mjs';
import {reserveTerrainEdgeExchange,receiveTerrainEdgeExchange} from '../src/terrain-edge-exchange.mjs';
import {setupCoherent,sourcePng} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';

const rejects=(fn,code)=>assert.throws(fn,error=>error.errors?.some(issue=>issue.code===code));
function fixture(){
  const d=n=>n.repeat(64),spec=d('a'),style=d('b'),cap=d('c'),ref=d('d'),target=d('e'),material=d('f'),raw=d('1'),base=d('2'),refRaw=d('3');
  const recipe={planId:'edge.fixture',parents:[],stage:'terrain-edge-source',specSha256:spec,styleSha256:style,capabilitiesSha256:cap,
    referencePlans:[ref],inventoryRefs:[],assetId:'edge.left',targetSha256:target,baseBatchSha256:base,materialPlanSha256:material,
    materialRawSha256:raw,policySha256:TERRAIN_EDGE_POLICY.sha256,edgeRole:'left-wall',
    subjectBrief:{content:'One compact warm painted edge.',exclusions:['Independent props']}};
  const state={activeSpec:spec,activeStyle:style,designs:new Map([[spec,{format:'ai_scene_spec_v3'}],
    [style,{format:'ai_scene_style_v2',name:'fixture style',rules:['Preserve local color.']}]]),
    capabilities:new Map([[cap,{imageToImage:true,transparentBackground:true,maxInputImages:2,maxWidth:2048,maxHeight:2048}]]),
    plans:new Map([[ref,{status:'accepted',plan:{sha256:ref,recipe:{specSha256:spec,styleSha256:style},designReviews:[]},
      result:{rawSha256:refRaw,technical:{image:{sha256:refRaw,byteLength:16,pixelSize:{width:1024,height:576}}}},
      reconstructionTarget:{sha256:target,acceptedPacketSha256:d('4'),humanReceiptSha256:d('5')}}],
    [material,{status:'pending-visual-review',plan:{sha256:material,format:'ai_scene_generation_plan_v27',recipe:{targetSha256:target},
      instanceBinding:{role:'material'},referenceEvidence:[{rawSha256:refRaw}]},result:{rawSha256:raw,
      technical:{status:'pass',sha256:d('6'),image:{sha256:raw,byteLength:24,pixelSize:{width:1024,height:512}}}}}]]),
    batches:new Map([[base,{format:'ai_scene_coherent_source_batch_v1',sha256:base,referencePlanSha256:ref,planSha256s:[material]}]])};
  return {state,recipe,options:{batchId:'edge.batch.fixture',baseBatchSha256:base}};
}
const cityRecipe=recipe=>({...recipe,surfaceFamily:'engineered-city',policySha256:ENGINEERED_CITY_TERRAIN_EDGE_POLICY.sha256,
  subjectBrief:{content:'One front concrete and metal-panel edge with a small attached cyan neon strip.',exclusions:['Independent props']}});

test('absent surface family preserves the frozen legacy policy, v29 plan and v1 batch bytes',()=>{
  const {state,recipe,options}=fixture(),plan=compileTerrainEdgeSource(state,recipe);
  state.plans.set(plan.sha256,{plan,status:'planned'});
  const batch=compileTerrainEdgeBatch(state,{...options,planSha256s:[plan.sha256]});
  assert.equal(TERRAIN_EDGE_POLICY.sha256,'334b58c85a5fc63255796e2defc0aa00e6486d5f61d4aa9e072a8ca6211fa836');
  assert.equal(plan.sha256,'08ba001991a0ab69e33da849f17731b68f6e54b2a1062257a00bc58c572bf57a');
  assert.equal(batch.sha256,'d6c51a9335bf0caff70ecb6a16c406c15cd0e8d0a22ef18ae3426a860bd99e26');
  assert.equal(Object.hasOwn(plan.recipe,'surfaceFamily'),false);assert.equal(Object.hasOwn(batch,'surfaceFamily'),false);
});

test('typed city edge plans preserve manufactured geometry, source purity and bounded local neon',()=>{
  const {state,recipe,options}=fixture(),plans=flow.TERRAIN_EDGE_ROLES.map((role,index)=>compileTerrainEdgeSource(state,
    {...cityRecipe(recipe),planId:'city.edge.'+index,assetId:'city.edge.'+index,edgeRole:role}));
  for(const plan of plans){
    assert.equal(plan.format,'ai_scene_generation_plan_v30');assert.equal(plan.request.format,'ai_scene_image_request_v30');
    assert.equal(plan.recipe.surfaceFamily,'engineered-city');assert.equal(plan.sourceScope.surfaceFamily,'engineered-city');
    assert.equal(plan.qualityPolicy.sha256,ENGINEERED_CITY_TERRAIN_EDGE_POLICY.sha256);
    assert.match(plan.request.prompt,/front-facing concrete|front-facing.*panel/i);assert.match(plan.request.prompt,/clean manufactured corners/i);
    assert.match(plan.request.prompt,/deliberate straight industrial geometry/i);
    assert.match(plan.request.prompt,/not dynamic illumination/);assert.match(plan.request.prompt,/12 percent completely transparent/);
    assert.match(plan.request.prompt,/do not.*mirror/i);assert.match(plan.request.prompt,/not a complete platform|complete platforms/i);
    assert.doesNotMatch(plan.request.prompt,/\b(?:rock|soil|moss|roots|cliff|grass|leaf)\b/i);
    assert.equal(plan.request.maximumCalls,1);assert.equal(plan.request.images.length,2);assert.equal(plan.target.alpha,'transparent');
    assert.equal(plan.sourceScope.semanticIsolationProven,false);assert.equal(plan.sourceScope.alphaCleanupAllowed,false);
    state.plans.set(plan.sha256,{plan,status:'planned'});assertTerrainEdgeCurrent(state,plan);
  }
  const batch=compileTerrainEdgeBatch(state,{...options,planSha256s:plans.map(p=>p.sha256)});
  assert.equal(batch.format,'ai_scene_terrain_edge_batch_v2');assert.equal(batch.surfaceFamily,'engineered-city');
  assert.equal(batch.policySha256,ENGINEERED_CITY_TERRAIN_EDGE_POLICY.sha256);assert.equal(batch.maximumCalls,4);
  assert.equal(assessTerrainEdgeSource(plans[0],sourcePng(true,91)).format,'ai_scene_terrain_edge_source_qa_v2');
  assert.equal(assessTerrainEdgeSource(plans[0],sourcePng(false,91)).status,'fail');
  const pixels=inspectPng(sourcePng(true,92),{includePixels:true});pixels.rgba.set([23,147,211,2],0);
  const tail=encodeRgbaPng(pixels.width,pixels.height,pixels.rgba),qa=assessTerrainEdgeSource(plans[0],tail);
  assert.equal(qa.status,'fail');assert(qa.issues.includes('COHERENT_CLIPPED_SILHOUETTE'));assert.equal(qa.edgeMaximumAlpha,2);
  assert.equal(qa.rawSha256,hash(tail));assert.equal(inspectPng(tail,{includePixels:true}).rgba[3],2);
});

test('unknown families, family-policy tampering, mixed batches and stale material/reference bindings fail',()=>{
  const {state,recipe,options}=fixture(),city=cityRecipe(recipe),plan=compileTerrainEdgeSource(state,city);
  rejects(()=>compileTerrainEdgeSource(state,{...city,surfaceFamily:'industrial-ish'}),'TERRAIN_EDGE_SURFACE_FAMILY');
  rejects(()=>compileTerrainEdgeSource(state,{...city,policySha256:TERRAIN_EDGE_POLICY.sha256}),'TERRAIN_EDGE_RECIPE');
  rejects(()=>compileTerrainEdgeSource(state,{...recipe,policySha256:ENGINEERED_CITY_TERRAIN_EDGE_POLICY.sha256}),'TERRAIN_EDGE_RECIPE');
  rejects(()=>compileTerrainEdgeSource(state,{...city,neonCleanup:true}),'WORKFLOW_SHAPE');
  rejects(()=>assertTerrainEdgeCurrent(state,{...plan,recipe:{...plan.recipe,surfaceFamily:'natural'}}),'TERRAIN_EDGE_SURFACE_FAMILY');
  rejects(()=>assertTerrainEdgeCurrent(state,{...plan,format:'ai_scene_generation_plan_v29'}),'TERRAIN_EDGE_POLICY');
  rejects(()=>assertTerrainEdgeCurrent(state,{...plan,materialEvidence:{...plan.materialEvidence,rawSha256:'0'.repeat(64)}}),'TERRAIN_EDGE_MATERIAL');
  const natural=compileTerrainEdgeSource(state,{...recipe,edgeRole:'right-wall',assetId:'edge.right',planId:'edge.natural'});
  for(const p of [plan,natural])state.plans.set(p.sha256,{plan:p,status:'planned'});
  rejects(()=>compileTerrainEdgeBatch(state,{...options,planSha256s:[plan.sha256,natural.sha256]}),'TERRAIN_EDGE_BATCH_FAMILY');
  const material=state.plans.get(recipe.materialPlanSha256);material.result.rawSha256='0'.repeat(64);
  rejects(()=>assertTerrainEdgeCurrent(state,plan),'TERRAIN_EDGE_MATERIAL');material.result.rawSha256=recipe.materialRawSha256;
  state.plans.get(recipe.referencePlans[0]).result.rawSha256='7'.repeat(64);
  rejects(()=>assertTerrainEdgeCurrent(state,plan),'TERRAIN_EDGE_MATERIAL');
});

test('typed city materials cannot silently fall back to legacy natural edge prompts',()=>{
  const {state,recipe}=fixture(),material=state.plans.get(recipe.materialPlanSha256);
  material.plan.sourceScope={definition:{visualCoherence:{sceneFamily:'engineered-city'}}};
  rejects(()=>compileTerrainEdgeSource(state,recipe),'TERRAIN_EDGE_SURFACE_FAMILY');
  assert.equal(compileTerrainEdgeSource(state,cityRecipe(recipe)).format,'ai_scene_generation_plan_v30');
});

test('city v30 plans and v2 batch replay, reserve and receive through the existing checked exchange',{timeout:240000},t=>{
  const f=setupCoherent(t),base=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:flow.createLayerSourceScopes(f.brief.requirements)});
  flow.authorizeReferenceAssetBatch(f.workflow,base.sha256,decision('city.base.compute',base.sha256,'approve-compute'));
  for(const [index,sha]of base.planSha256s.entries()){
    const plan=flow.getGenerationPlan(f.workflow,sha),{request,...ticket}=flow.reservePlan(f.workflow,sha);flow.recordSubmission(f.workflow,ticket);
    flow.receiveResult(f.workflow,ticket,sourcePng(plan.target.alpha==='transparent',index+110));
  }
  const options={batchId:'city.edges',baseBatchSha256:base.sha256,capabilitiesSha256:f.options.capabilitiesSha256,surfaceFamily:'engineered-city',
    items:[{assetId:'city.edge.left',role:'left-wall',content:'One clean concrete and metal-panel edge with bounded attached cyan neon.',exclusions:['Independent props']}]};
  const before=flow.inspectWorkflow(f.workflow),preview=flow.previewTerrainEdgeSources(f.workflow,options);
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);assert.equal(preview.generationCalls,0);assert.equal(preview.executable,false);
  for(const extra of [{...options,surfaceFamily:null},{...options,surfaceFamily:'natural'},{...options,cleanupAlpha:true}]){
    assert.throws(()=>flow.freezeTerrainEdgeSources(f.workflow,extra));assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
  }
  const batch=flow.freezeTerrainEdgeSources(f.workflow,options);assert.equal(batch.sha256,preview.batch.sha256);
  assert.deepEqual(flow.getTerrainEdgeSourceBatch(f.workflow,batch.sha256),batch);
  assert.equal(inspectReferenceLedProject(f.root).reference.status,'accepted');
  rejects(()=>flow.reservePlan(f.workflow,batch.planSha256s[0]),'AUTHORIZATION_REQUIRED');
  transact(f.workflow,store=>{
    const state=replay(store),bad=seal({...unseal(batch),surfaceFamily:'natural'});
    rejects(()=>applyRecord(store,state,bad),'TERRAIN_EDGE_BATCH_REPLAY');
  });
  flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('city.edge.compute',batch.sha256,'approve-compute'));
  const exchangeDir=join(f.root,'city-exchange'),exchange=reserveTerrainEdgeExchange(f.workflow,batch.sha256,exchangeDir);
  assert.equal(exchange.request.format,'ai_scene_image_request_v30');assert.equal(exchange.maximumCalls,1);
  assert.equal(exchange.inputs[0].sha256,hash(f.raw));
  const raw=sourcePng(true,141),file=join(f.root,'city-synthetic.png');writeFileSync(file,raw);
  const result=receiveTerrainEdgeExchange(f.workflow,exchangeDir,file),entry=flow.getGenerationResult(f.workflow,batch.planSha256s[0]);
  assert.equal(result.plans[0].status,'pending-visual-review');assert.equal(entry.result.technical.format,'ai_scene_terrain_edge_source_qa_v2');
  assert.equal(entry.result.technical.status,'pass');assert.equal(entry.result.technical.surfaceFamily,'engineered-city');
  assert.deepEqual(entry.bytes,raw);assert.equal(flow.getTerrainEdgeInputs(f.workflow,batch.sha256).sources.length,1);
  assert.equal(flow.recheckResult(f.workflow,batch.planSha256s[0],hash(raw)).sha256,entry.result.technical.sha256);
  rejects(()=>flow.reservePlan(f.workflow,batch.planSha256s[0]),'RESERVATION_STATE');
  rejects(()=>flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('city.edge.reuse',batch.sha256,'approve-compute')),'AUTHORIZATION_STATE');
});
