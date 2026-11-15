import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import * as flow from '../src/generation/index.mjs';
import {compileCoherentSource} from '../src/generation/coherent-source.mjs';
import {transact} from '../src/generation/store.mjs';
import {replay} from '../src/generation/model.mjs';
import {LAYER_SOURCE_INTENT} from '../src/generation/layer-source.mjs';
import {seal,unseal,jsonBytes,hash,digest} from '../src/generation/common.mjs';
import {encodeRgbaPng} from '../src/png.mjs';
import {setupCoherent} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';

const rejects=(fn,code)=>assert.throws(fn,error=>error.errors?.some(issue=>issue.code===code));
function setup(t){
  const f=setupCoherent(t,'Synthetic industrial service deck');
  const batch=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:flow.createLayerSourceScopes(f.brief.requirements)});
  const left=flow.getGenerationPlan(f.workflow,batch.planSha256s.at(-2)),right=flow.getGenerationPlan(f.workflow,batch.planSha256s.at(-1));
  return {...f,batch,left,right};
}
function replacement(plan,tag){
  return {assetId:plan.recipe.assetId,planId:tag+'.'+plan.recipe.assetId,intent:LAYER_SOURCE_INTENT,
    sourceScope:seal({...unseal(plan.recipe.sourceScope),content:'One complete dark industrial fixture with sparse tiny indicators and visible shadow structure.',
      contentOrigin:'explicit-source-brief',exclusions:[...plan.recipe.sourceScope.exclusions,'Bright broad fixture panels']})};
}
const entries=workflow=>transact(workflow,store=>new Map([...replay(store).plans].map(([sha,entry])=>[sha,structuredClone(entry)])));
function files(workflow){
  return Object.fromEntries(['events','blobs'].map(folder=>[folder,readdirSync(join(workflow,folder)).sort().map(name=>({name,sha256:hash(readFileSync(join(workflow,folder,name)))}))]));
}
function fixturePng(){
  const width=320,height=256,rgba=Buffer.alloc(width*height*4);
  for(let y=40;y<216;y++)for(let x=45;x<275;x++)rgba.set([40+x%130,75+y%90,110,255],(y*width+x)*4);
  return encodeRgbaPng(width,height,rgba);
}

test('planned v4 scopes can be revised into new planned digests without changing old requests or other sources',t=>{
  const f=setup(t),before=entries(f.workflow),journal=files(f.workflow),oldRequests=new Map([...before].map(([sha,e])=>[sha,jsonBytes(e.plan.request)]));
  const revised=flow.reviseCoherentSources(f.workflow,f.batch.sha256,{batchId:'planned.scope.revision',
    replacements:[replacement(f.left,'planned.revision'),replacement(f.right,'planned.revision')]});
  assert.notEqual(revised.sha256,f.batch.sha256);assert.equal(revised.newImageRequests,2);
  assert.deepEqual(revised.planSha256s.slice(0,-2),f.batch.planSha256s.slice(0,-2));
  const after=entries(f.workflow);
  for(const [sha,entry]of before){assert.deepEqual(after.get(sha),entry);assert.deepEqual(jsonBytes(after.get(sha).plan.request),oldRequests.get(sha));}
  assert.deepEqual(files(f.workflow).events.slice(0,journal.events.length),journal.events);
  assert.deepEqual(files(f.workflow).blobs,journal.blobs);
  for(const [index,sha]of revised.planSha256s.slice(-2).entries()){
    const old=[f.left,f.right][index],entry=after.get(sha);
    assert.notEqual(sha,old.sha256);assert.equal(entry.status,'planned');assert(!Object.hasOwn(entry,'authorization'));assert(!Object.hasOwn(entry,'attempt'));
    assert.deepEqual(entry.plan.recipe.parents,[old.sha256]);assert.notDeepEqual(entry.plan.recipe.sourceScope,old.recipe.sourceScope);
    assert.notDeepEqual(entry.plan.request.prompt,old.request.prompt);assert.deepEqual(entry.plan.request.images,old.request.images);
    rejects(()=>flow.reservePlan(f.workflow,sha),'AUTHORIZATION_REQUIRED');
  }
});

test('an authorized unused source and a returned sibling both need fresh child-plan authorization',t=>{
  const f=setup(t);
  flow.authorizeReferenceAssetBatch(f.workflow,f.batch.sha256,decision('original.batch.compute',f.batch.sha256,'approve-compute'));
  const {request,...ticket}=flow.reservePlan(f.workflow,f.left.sha256);flow.recordSubmission(f.workflow,ticket);
  assert.equal(flow.receiveResult(f.workflow,ticket,fixturePng()).technical.status,'pass');
  const before=entries(f.workflow),journal=files(f.workflow);
  assert.equal(before.get(f.right.sha256).status,'authorized');assert(!Object.hasOwn(before.get(f.right.sha256),'attempt'));
  const revised=flow.reviseCoherentSources(f.workflow,f.batch.sha256,{batchId:'authorized.scope.revision',
    replacements:[replacement(f.left,'authorized.revision'),replacement(f.right,'authorized.revision')]});
  const children=revised.planSha256s.slice(-2),after=entries(f.workflow);
  for(const [sha,entry]of before)assert.deepEqual(after.get(sha),entry);
  assert.deepEqual(files(f.workflow).events.slice(0,journal.events.length),journal.events);assert.deepEqual(files(f.workflow).blobs,journal.blobs);
  for(const sha of children){assert.equal(after.get(sha).status,'planned');assert(!Object.hasOwn(after.get(sha),'authorization'));
    rejects(()=>flow.reservePlan(f.workflow,sha),'AUTHORIZATION_REQUIRED');}
  const unchanged=files(f.workflow);
  rejects(()=>flow.authorizeReferenceAssetBatch(f.workflow,revised.sha256,decision('old.batch.target',f.batch.sha256,'approve-compute')),'AUTHORIZATION_STATE');
  rejects(()=>flow.authorizePlan(f.workflow,children[1],decision('old.plan.target',f.right.sha256,'approve-compute')),'AUTHORIZATION_STATE');
  assert.deepEqual(files(f.workflow),unchanged);
  flow.authorizeReferenceAssetBatch(f.workflow,revised.sha256,decision('fresh.child.batch.compute',revised.sha256,'approve-compute'));
  const authorized=entries(f.workflow);
  for(const [sha,entry]of before)assert.deepEqual(authorized.get(sha),entry);
  for(const sha of children){const entry=authorized.get(sha);assert.equal(entry.status,'authorized');
    assert.equal(entry.authorization.receipt.targetSha256,revised.sha256);
    assert.notEqual(entry.authorization.sha256,before.get(f.right.sha256).authorization.sha256);}
  const fresh=flow.reservePlan(f.workflow,children[1]);
  assert.equal(fresh.planSha256,children[1]);assert.notEqual(fresh.requestSha256,digest(f.right.request));
  assert.deepEqual(flow.getGenerationPlan(f.workflow,f.right.sha256),f.right);
  assert.equal(entries(f.workflow).get(f.right.sha256).status,'authorized');
});

test('reserved and submitted sources cannot be treated as unsubmitted; mixed revisions leave no partial events or blobs',t=>{
  const f=setup(t);flow.authorizeReferenceAssetBatch(f.workflow,f.batch.sha256,decision('inflight.batch.compute',f.batch.sha256,'approve-compute'));
  const {request,...ticket}=flow.reservePlan(f.workflow,f.left.sha256);
  for(const status of ['reserved','submitted']){
    if(status==='submitted')flow.recordSubmission(f.workflow,ticket);
    const before=flow.inspectWorkflow(f.workflow),evidence=files(f.workflow);
    const replacements=[replacement(f.right,status+'.valid.first'),replacement(f.left,status+'.invalid.second')];
    rejects(()=>flow.reviseCoherentSources(f.workflow,f.batch.sha256,{batchId:status+'.blocked.revision',replacements}),'PLAN_PARENT');
    assert.deepEqual(flow.inspectWorkflow(f.workflow),before);assert.deepEqual(files(f.workflow),evidence);
  }
  flow.stopAttempt(f.workflow,ticket,'indeterminate');
  const terminal=flow.reviseCoherentSources(f.workflow,f.batch.sha256,{batchId:'terminal.explicit.revision',replacements:[replacement(f.left,'terminal.explicit')]});
  assert.equal(terminal.newImageRequests,1);assert.equal(entries(f.workflow).get(f.left.sha256).status,'indeterminate');
  rejects(()=>flow.reservePlan(f.workflow,terminal.planSha256s.at(-2)),'AUTHORIZATION_REQUIRED');
});

test('execution-field presence, even null, and zero-call preparations cannot use the unsubmitted v4 parent branch',t=>{
  const f=setup(t),before=flow.inspectWorkflow(f.workflow),evidence=files(f.workflow),change=replacement(f.right,'pure.eligibility');
  transact(f.workflow,store=>{
    const state=replay(store),source=state.plans.get(f.right.sha256),recipe={...source.plan.recipe,planId:change.planId,parents:[f.right.sha256],sourceScope:change.sourceScope};
    const compile=()=>compileCoherentSource(state,recipe,sha=>store.readBlob(sha));
    for(const status of ['planned','authorized']){
      state.plans.set(f.right.sha256,{...source,status});assert.equal(compile().recipe.parents[0],f.right.sha256);
      for(const field of ['attempt','submission','result','terminal']){
        state.plans.set(f.right.sha256,{...source,status,[field]:null});rejects(compile,'PLAN_PARENT');
      }
      for(const format of ['ai_scene_coherent_border_preparation_v1','ai_scene_coherent_canvas_gutter_preparation_v1']){
        state.plans.set(f.right.sha256,{...source,status,kind:'coherent-canvas-gutter-preparation',plan:seal({...unseal(source.plan),format,
          request:{format:'ai_scene_no_generation_request_v1',maximumCalls:0}})});rejects(compile,'PLAN_PARENT');
      }
    }
    for(const status of ['reserved','submitted','running']){state.plans.set(f.right.sha256,{...source,status});rejects(compile,'PLAN_PARENT');}
    state.plans.set(f.right.sha256,{...source,status:'authorized',plan:seal({...unseal(source.plan),recipe:{...source.plan.recipe,intent:''}})});
    rejects(compile,'PLAN_PARENT');
  });
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);assert.deepEqual(files(f.workflow),evidence);
});
