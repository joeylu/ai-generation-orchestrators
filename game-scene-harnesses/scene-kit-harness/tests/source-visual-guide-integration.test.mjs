import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import * as flow from '../src/generation/index.mjs';
import * as pipeline from '../src/coherent-pipeline.mjs';
import {compileCoherentSource,assessCoherentSource,COHERENT_POLICY,verifyCoherentSourceVisualGuideInput} from '../src/generation/coherent-source.mjs';
import {applyRecord,replay} from '../src/generation/model.mjs';
import {transact} from '../src/generation/store.mjs';
import {SOURCE_VISUAL_GUIDE_PROFILE,SOURCE_VISUAL_GUIDE_ROLE,sourceVisualGuide} from '../src/generation/source-visual-guide.mjs';
import {hash,digest,jsonBytes,seal,unseal} from '../src/generation/common.mjs';
import {encodeRgbaPng} from '../src/png.mjs';
import {setupCoherent,sourcePng} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';

const rejects=(fn,code)=>assert.throws(fn,e=>e.errors?.some(issue=>issue.code===code));
const readJson=path=>JSON.parse(readFileSync(path,'utf8'));
const evidence=workflow=>Object.fromEntries(['events','blobs'].map(folder=>[folder,readdirSync(join(workflow,folder)).sort().map(name=>({name,sha256:hash(readFileSync(join(workflow,folder,name)))}))]));
const entries=workflow=>transact(workflow,store=>new Map([...replay(store).plans].map(([sha,entry])=>[sha,structuredClone(entry)])));
function options(f,scopes,batchId='guide.sources'){return {...f.options,batchId,sourceScopes:scopes};}
function sharedScopes(f){return transact(f.workflow,store=>{
  const state=replay(store),ref=state.plans.get(f.plan.sha256);
  return flow.createLayerSourceScopes(f.brief.requirements,[],flow.createVisualCoherence(state.designs.get(f.plan.recipe.specSha256),
    state.designs.get(f.plan.recipe.styleSha256),ref.reconstructionTarget,{sceneFamily:'engineered-city'}));
});}
function smallSource(alpha=true,seed=0){
  const width=320,height=256,rgba=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(!alpha||(x>=45&&x<275&&y>=40&&y<216))rgba.set([40+(x+seed)%130,75+(y+seed)%90,110,255],(y*width+x)*4);
  return encodeRgbaPng(width,height,rgba);
}
function complete(workflow,sha,bytes){const {request,...ticket}=flow.reservePlan(workflow,sha);flow.recordSubmission(workflow,ticket);assert.equal(flow.receiveResult(workflow,ticket,bytes).technical.status,'pass');}

test('foreground opt-in adds only canonical source Input2 and preserves old v1/v2 requests and read-only previews',t=>{
  const f=setupCoherent(t),plain=flow.createLayerSourceScopes(f.brief.requirements),shared=sharedScopes(f),before=evidence(f.workflow),guide=sourceVisualGuide(SOURCE_VISUAL_GUIDE_PROFILE);
  let finalOptions;
  for(const scopes of [plain,shared]){
    const old=flow.previewCoherentSources(f.workflow,options(f,scopes)),guidedScopes=flow.withSourceVisualGuideScopes(f.brief.requirements,scopes,['foreground']);
    assert.equal(guidedScopes.format,'ai_scene_layer_source_scopes_v3');
    if(scopes.visualCoherence)assert.deepEqual(guidedScopes.visualCoherence,scopes.visualCoherence);
    const next=flow.previewCoherentSources(f.workflow,options(f,guidedScopes));
    for(const [i,plan]of next.plans.entries()){
      if(plan.instanceBinding.role!=='foreground'){assert.deepEqual(plan,old.plans[i]);continue;}
      assert.equal(plan.format,'ai_scene_generation_plan_v27');assert.match(plan.compiler,/-shadow-guide-v1$/);
      assert.equal(plan.recipe.sourceScope.format,'ai_scene_layer_source_scope_v3');assert.equal(plan.request.images.length,2);
      assert.deepEqual(plan.request.images[0],{...old.plans[i].request.images[0],role:flow.SOURCE_GUIDED_REFERENCE_ROLE});assert.equal(plan.request.images[0].artifact.sha256,hash(f.raw));
      assert.deepEqual(plan.request.images[1],{role:SOURCE_VISUAL_GUIDE_ROLE,artifact:guide.artifact});
      assert.equal(plan.sourceScope.visualGuideEvidence.recipeSha256,guide.recipe.sha256);
      assert.match(plan.request.prompt,/FRONT, SIDE and TOP/);assert.match(plan.request.prompt,/Input 1 remains the accepted scene reference/);
      assert.match(plan.request.prompt,/not.*(?:override|output targets)|not output targets/);assert.match(plan.request.prompt,/never a post-generation/);
      assert(!Object.hasOwn(plan.recipe,'compositionGuideSha256'));assert(!Object.hasOwn(plan.recipe,'referenceGuidanceProfile'));
    }
    assert.deepEqual(flow.previewCoherentSources(f.workflow,options(f,scopes)),old);
    assert.deepEqual(evidence(f.workflow),before);finalOptions=options(f,guidedScopes);
  }
  const batch=flow.freezeCoherentSources(f.workflow,finalOptions),after=evidence(f.workflow);
  assert.equal(after.blobs.length,before.blobs.length+1);assert(after.blobs.some(item=>item.name===guide.artifact.sha256+'.bin'));
  for(const sha of batch.planSha256s.slice(-2)){
    assert.deepEqual(flow.readGenerationInput(f.workflow,sha,0),f.raw);assert.deepEqual(flow.readGenerationInput(f.workflow,sha,1),guide.bytes);
    rejects(()=>flow.reservePlan(f.workflow,sha),'AUTHORIZATION_REQUIRED');
  }
  const guidePath=join(f.workflow,'blobs',guide.artifact.sha256+'.bin');
  try{writeFileSync(guidePath,f.raw);rejects(()=>flow.inspectWorkflow(f.workflow),'BLOB_INTEGRITY');}
  finally{writeFileSync(guidePath,guide.bytes);}
  assert.equal(flow.getCoherentSourceBatch(f.workflow,batch.sha256).sha256,batch.sha256);
});

test('source guide scope rejects wrong roles, unknown profiles, opaque sources and insufficient image capacity',t=>{
  const f=setupCoherent(t),plain=flow.createLayerSourceScopes(f.brief.requirements),before=evidence(f.workflow);
  rejects(()=>flow.withSourceVisualGuideScopes(f.brief.requirements,plain,['sky']),'SOURCE_VISUAL_GUIDE_ROLE');
  rejects(()=>flow.withSourceVisualGuideScopes(f.brief.requirements,plain,['absent']),'SOURCE_VISUAL_GUIDE_SUBJECTS');
  rejects(()=>flow.withSourceVisualGuideScopes(f.brief.requirements,plain,[]),'SOURCE_VISUAL_GUIDE_SUBJECTS');
  const old=flow.previewCoherentSources(f.workflow,options(f,plain)),front=old.plans.at(-1),scope=flow.withSourceVisualGuide(front.recipe.sourceScope);
  assert.deepEqual(flow.withSourceVisualGuide(scope),scope);
  rejects(()=>flow.withSourceVisualGuide(old.plans[0].recipe.sourceScope),'SOURCE_VISUAL_GUIDE_ROLE');
  transact(f.workflow,store=>{
    const state=replay(store),compile=sourceScope=>compileCoherentSource(state,{...front.recipe,sourceScope},sha=>store.readBlob(sha));
    rejects(()=>compile(seal({...unseal(scope),visualGuideProfile:'unreviewed-guide'})),'SOURCE_VISUAL_GUIDE_PROFILE');
    rejects(()=>compile(seal({...unseal(scope),lightingProfile:'rim-light-only'})),'SOURCE_VISUAL_GUIDE_PROFILE');
    const material=old.plans[0],materialScope=seal({...unseal(material.recipe.sourceScope),format:'ai_scene_layer_source_scope_v3',
      lightingProfile:flow.SOURCE_SHADOW_LIGHTING_PROFILE,visualGuideProfile:SOURCE_VISUAL_GUIDE_PROFILE});
    rejects(()=>compileCoherentSource(state,{...material.recipe,sourceScope:materialScope},sha=>store.readBlob(sha)),'SOURCE_VISUAL_GUIDE_ROLE');
    const cap=state.capabilities.get(front.recipe.capabilitiesSha256);state.capabilities.set(front.recipe.capabilitiesSha256,{...cap,maxInputImages:1});
    rejects(()=>compile(scope),'SOURCE_VISUAL_GUIDE_CAPABILITY');
    state.capabilities.set(front.recipe.capabilitiesSha256,cap);
    const opaqueResult=assessCoherentSource(compile(scope),smallSource(false));
    assert.equal(opaqueResult.status,'fail');assert(opaqueResult.issues.includes('COHERENT_NO_TRANSPARENCY'));
  });
  assert.deepEqual(evidence(f.workflow),before);
});

test('model replay reproduces guide pixels and rejects swapped roles, order, digests and actual input bytes',t=>{
  const f=setupCoherent(t),scopes=flow.withSourceVisualGuideScopes(f.brief.requirements,flow.createLayerSourceScopes(f.brief.requirements),['foreground']);
  const plan=flow.previewCoherentSources(f.workflow,options(f,scopes)).plans.at(-1),guide=sourceVisualGuide(SOURCE_VISUAL_GUIDE_PROFILE),before=evidence(f.workflow);
  transact(f.workflow,store=>{
    const state=replay(store),validStore={...store,readBlob:sha=>sha===guide.artifact.sha256?guide.bytes:store.readBlob(sha)};
    const apply=record=>applyRecord(validStore,{...state,plans:new Map(state.plans),ids:new Set(state.ids)},record);
    const changed=images=>seal({...unseal(plan),request:{...plan.request,images}});
    rejects(()=>apply(changed([...plan.request.images].reverse())),'PLAN_RECOMPILE_MISMATCH');
    rejects(()=>apply(changed([plan.request.images[0],{...plan.request.images[1],role:'accepted-scene-style-material-light-reference'}])),'PLAN_RECOMPILE_MISMATCH');
    rejects(()=>apply(changed([plan.request.images[0],{...plan.request.images[1],artifact:plan.request.images[0].artifact}])),'PLAN_RECOMPILE_MISMATCH');
    const altered=Buffer.from(guide.bytes);altered[altered.length-1]^=1;
    const incorrectStore={...store,readBlob:sha=>sha===guide.artifact.sha256?altered:store.readBlob(sha)};
    rejects(()=>applyRecord(incorrectStore,{...state,plans:new Map(state.plans),ids:new Set(state.ids)},plan),'SOURCE_VISUAL_GUIDE_REPLAY');
    rejects(()=>verifyCoherentSourceVisualGuideInput(seal({...unseal(plan),target:{...plan.target,alpha:'opaque'}}),validStore.readBlob),'SOURCE_VISUAL_GUIDE_INPUT');
    apply(plan);
  });
  assert.deepEqual(evidence(f.workflow),before);
});

test('new guided revisions preserve originals and require fresh authorization before exact two-input exchange',{timeout:180000},t=>{
  const f=setupCoherent(t),scopes=flow.createLayerSourceScopes(f.brief.requirements),batch=flow.freezeCoherentSources(f.workflow,options(f,scopes,'original.sources'));
  flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('original.compute',batch.sha256,'approve-compute'));
  for(const [i,sha]of batch.planSha256s.slice(0,-1).entries()){
    const plan=flow.getGenerationPlan(f.workflow,sha);complete(f.workflow,sha,i===0?sourcePng(false,13):smallSource(plan.target.alpha==='transparent',i));
  }
  const old=entries(f.workflow),before=evidence(f.workflow),parents=batch.planSha256s.slice(-2).map(sha=>flow.getGenerationPlan(f.workflow,sha));
  const replacements=parents.map((plan,i)=>({assetId:plan.recipe.assetId,planId:'guided.revision.'+i,intent:flow.LAYER_SOURCE_INTENT,sourceScope:flow.withSourceVisualGuide(plan.recipe.sourceScope)}));
  rejects(()=>flow.reviseCoherentSources(f.workflow,batch.sha256,{batchId:'invalid.guided.revision',replacements:[{...replacements[0],planId:parents[0].recipe.planId}]}),'REVISION_ID_EXISTS');
  assert.deepEqual(evidence(f.workflow),before,'failed dry application never materializes a guide blob');
  const revised=flow.reviseCoherentSources(f.workflow,batch.sha256,{batchId:'guided.revision',replacements}),next=entries(f.workflow);
  for(const [sha,entry]of old)assert.deepEqual(next.get(sha),entry);
  assert.deepEqual(revised.planSha256s.slice(0,-2),batch.planSha256s.slice(0,-2));assert.equal(revised.newImageRequests,2);
  const children=revised.planSha256s.slice(-2);
  for(const sha of children){assert.equal(next.get(sha).status,'planned');assert(!Object.hasOwn(next.get(sha),'authorization'));rejects(()=>flow.reservePlan(f.workflow,sha),'AUTHORIZATION_REQUIRED');}
  rejects(()=>flow.authorizeReferenceAssetBatch(f.workflow,revised.sha256,decision('wrong.old.target',batch.sha256,'approve-compute')),'AUTHORIZATION_STATE');
  // Only synthetic historical project metadata, without altering journal or artwork.
  const referenceProject=readJson(join(f.root,'project.json'));
  writeFileSync(join(f.root,'coherent-project.json'),jsonBytes(seal({format:'ai_scene_coherent_project_v1',projectId:referenceProject.projectId,
    referenceProjectSha256:referenceProject.sha256,policySha256:COHERENT_POLICY.sha256})));
  writeFileSync(join(f.root,'coherent-policy.json'),jsonBytes(COHERENT_POLICY));
  const out=join(f.parent,'guided-compute-review'),review=pipeline.exportCoherentComputeReview(f.root,out),guide=sourceVisualGuide(SOURCE_VISUAL_GUIDE_PROFILE);
  assert.equal(review.remainingCalls,2);
  for(const index of [5,6]){assert.deepEqual(readFileSync(join(out,`input-${index}-1.png`)),f.raw);assert.deepEqual(readFileSync(join(out,`input-${index}-2.png`)),guide.bytes);}
  const snapshotBefore=flow.inspectWorkflow(f.workflow);assert.equal(pipeline.exportCoherentComputeReview(f.root,out).sha256,review.sha256);assert.deepEqual(flow.inspectWorkflow(f.workflow),snapshotBefore);
  flow.authorizeReferenceAssetBatch(f.workflow,revised.sha256,decision('new.guided.compute',revised.sha256,'approve-compute'));
  const exchange=pipeline.reserveCoherentExchange(f.root,join(f.parent,'guided-exchange'));
  assert.equal(exchange.ticket.planSha256,children[0]);assert.equal(exchange.request.images.length,2);assert.equal(exchange.inputs.length,2);
  assert.deepEqual(exchange.inputs.map(row=>row.role),[flow.SOURCE_GUIDED_REFERENCE_ROLE,SOURCE_VISUAL_GUIDE_ROLE]);
  assert.deepEqual(readFileSync(join(f.parent,'guided-exchange/input-1.png')),f.raw);assert.deepEqual(readFileSync(join(f.parent,'guided-exchange/input-2.png')),guide.bytes);
  assert.equal(exchange.ticket.requestSha256,digest(flow.getGenerationPlan(f.workflow,children[0]).request));
  const final=entries(f.workflow);for(const [sha,entry]of old)assert.deepEqual(final.get(sha),entry);
});
