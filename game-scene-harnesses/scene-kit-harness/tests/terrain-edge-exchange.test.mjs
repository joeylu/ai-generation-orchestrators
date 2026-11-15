import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import * as flow from '../src/generation/index.mjs';
import {inspectTerrainEdgeBatch,reserveTerrainEdgeExchange,receiveTerrainEdgeExchange,stopTerrainEdgeExchange} from '../src/terrain-edge-exchange.mjs';
import {setupCoherent,sourcePng} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';
import {digest,jsonBytes,seal,unseal} from '../src/generation/common.mjs';
const rejects=(fn,code)=>assert.throws(fn,error=>error.errors?.[0]?.code===code);
function fixture(t){
  const f=setupCoherent(t),base=flow.freezeCoherentSources(f.workflow,f.options);
  flow.authorizeReferenceAssetBatch(f.workflow,base.sha256,decision('base.compute',base.sha256,'approve-compute'));
  for(const [index,sha]of base.planSha256s.entries()){
    const plan=flow.getGenerationPlan(f.workflow,sha),{request,...ticket}=flow.reservePlan(f.workflow,sha);flow.recordSubmission(f.workflow,ticket);
    flow.receiveResult(f.workflow,ticket,sourcePng(plan.target.alpha==='transparent',index));
  }
  const batch=flow.freezeTerrainEdgeSources(f.workflow,{batchId:'edge.exchange',baseBatchSha256:base.sha256,capabilitiesSha256:f.options.capabilitiesSha256,
    items:['left-wall','left-top-corner'].map((role,index)=>({assetId:'edge.exchange.'+index,role,content:'Synthetic rock edge; no actual generated artwork.',exclusions:[]}))});
  return {...f,batch};
}
test('edge exchange reserves exactly one authorized source and stops on pending or unknown outcomes',t=>{
  const f=fixture(t),exchange=join(f.parent,'exchange'),next=join(f.parent,'next');
  rejects(()=>reserveTerrainEdgeExchange(f.workflow,f.batch.sha256,exchange),'TERRAIN_EDGE_NOT_AUTHORIZED');assert.equal(existsSync(exchange),false);
  flow.authorizeReferenceAssetBatch(f.workflow,f.batch.sha256,decision('edge.compute',f.batch.sha256,'approve-compute'));
  const before=flow.inspectWorkflow(f.workflow).eventCount,record=reserveTerrainEdgeExchange(f.workflow,f.batch.sha256,exchange);
  assert.equal(record.maximumCalls,1);assert.equal(record.automaticRetry,false);assert.equal(record.inputs.length,2);
  assert.equal(flow.inspectWorkflow(f.workflow).eventCount,before+2);assert.equal(record.ticket.requestSha256,digest(record.request));
  rejects(()=>reserveTerrainEdgeExchange(f.workflow,f.batch.sha256,next),'TERRAIN_EDGE_BATCH_STOPPED');assert.equal(existsSync(next),false);
  stopTerrainEdgeExchange(f.workflow,exchange);
  assert.equal(inspectTerrainEdgeBatch(f.workflow,f.batch.sha256).plans[0].status,'indeterminate');
  rejects(()=>reserveTerrainEdgeExchange(f.workflow,f.batch.sha256,next),'TERRAIN_EDGE_BATCH_STOPPED');assert.equal(existsSync(next),false);
});
test('native receipt is repeatable for the same bytes, preserves originals and blocks a technically failed batch',t=>{
  const f=fixture(t);flow.authorizeReferenceAssetBatch(f.workflow,f.batch.sha256,decision('edge.compute',f.batch.sha256,'approve-compute'));
  const directory=join(f.parent,'exchange'),record=reserveTerrainEdgeExchange(f.workflow,f.batch.sha256,directory),file=join(f.parent,'source.png'),raw=sourcePng(true,72);
  writeFileSync(file,raw);receiveTerrainEdgeExchange(f.workflow,directory,file);
  const before=flow.inspectWorkflow(f.workflow).eventCount;receiveTerrainEdgeExchange(f.workflow,directory,file);
  assert.equal(flow.inspectWorkflow(f.workflow).eventCount,before);assert.deepEqual(readFileSync(join(directory,'source-native.png')),raw);
  assert.equal(inspectTerrainEdgeBatch(f.workflow,f.batch.sha256).plans[0].status,'pending-visual-review');
  assert.equal(flow.getGenerationPlan(f.workflow,record.ticket.planSha256).visualReviewChecklist.visualAcceptance,'not-assessed');
  const second=join(f.parent,'second'),third=join(f.parent,'third');reserveTerrainEdgeExchange(f.workflow,f.batch.sha256,second);
  const bad=join(f.parent,'bad.png');writeFileSync(bad,sourcePng(false,92));receiveTerrainEdgeExchange(f.workflow,second,bad);
  rejects(()=>reserveTerrainEdgeExchange(f.workflow,f.batch.sha256,third),'TERRAIN_EDGE_BATCH_STOPPED');assert.equal(existsSync(third),false);
});
test('tampered exact prompt or input bytes are rejected before recording native receipt',t=>{
  const f=fixture(t);flow.authorizeReferenceAssetBatch(f.workflow,f.batch.sha256,decision('edge.compute',f.batch.sha256,'approve-compute'));
  const directory=join(f.parent,'exchange'),record=reserveTerrainEdgeExchange(f.workflow,f.batch.sha256,directory),file=join(f.parent,'source.png');writeFileSync(file,sourcePng(true,72));
  const body=unseal(record);writeFileSync(join(directory,'exchange.json'),jsonBytes(seal({...body,request:{...body.request,prompt:'Changed prompt'}})));
  const before=flow.inspectWorkflow(f.workflow).eventCount;
  rejects(()=>receiveTerrainEdgeExchange(f.workflow,directory,file),'TERRAIN_EDGE_EXCHANGE');assert.equal(flow.inspectWorkflow(f.workflow).eventCount,before);
  writeFileSync(join(directory,'exchange.json'),jsonBytes(record));writeFileSync(join(directory,'input-2.png'),sourcePng(false,81));
  rejects(()=>receiveTerrainEdgeExchange(f.workflow,directory,file),'TERRAIN_EDGE_EXCHANGE_INPUT');assert.equal(flow.inspectWorkflow(f.workflow).eventCount,before);
});

for(const outcome of ['receive','unknown'])test(`a submitted edge can record ${outcome} after its base material is rejected`,t=>{
  const f=fixture(t);flow.authorizeReferenceAssetBatch(f.workflow,f.batch.sha256,decision('edge.compute',f.batch.sha256,'approve-compute'));
  const directory=join(f.parent,'exchange'),record=reserveTerrainEdgeExchange(f.workflow,f.batch.sha256,directory),
    edge=flow.getGenerationPlan(f.workflow,record.ticket.planSha256),material=flow.getGenerationResult(f.workflow,edge.recipe.materialPlanSha256);
  flow.reviewResult(f.workflow,edge.recipe.materialPlanSha256,decision('material.reject',material.result.rawSha256,'reject'));
  const stale=flow.inspectWorkflow(f.workflow).plans.find(p=>p.planSha256===record.ticket.planSha256);
  assert.equal(stale.current,false);assert.equal(stale.status,'submitted');
  if(outcome==='receive'){
    const raw=sourcePng(true,83),file=join(f.parent,'returned.png');writeFileSync(file,raw);
    receiveTerrainEdgeExchange(f.workflow,directory,file);
    const result=flow.getGenerationResult(f.workflow,record.ticket.planSha256);
    assert.deepEqual(result.bytes,raw);assert.equal(result.result.attemptSha256,record.ticket.attemptSha256);
    assert.equal(inspectTerrainEdgeBatch(f.workflow,f.batch.sha256).plans[0].status,'pending-visual-review');
  }else{
    stopTerrainEdgeExchange(f.workflow,directory);
    assert.equal(inspectTerrainEdgeBatch(f.workflow,f.batch.sha256).plans[0].status,'indeterminate');
    assert.equal(existsSync(join(directory,'source-native.png')),false);
  }
  rejects(()=>flow.reservePlan(f.workflow,record.ticket.planSha256),'RESERVATION_STATE');
  assert.throws(()=>reserveTerrainEdgeExchange(f.workflow,f.batch.sha256,join(f.parent,'next')));
  assert.equal(existsSync(join(f.parent,'next')),false);
});

test('competing batch reservations cannot reserve two plans and another batch remains independent',{timeout:240000},async t=>{
  const f=fixture(t),edge=flow.getGenerationPlan(f.workflow,f.batch.planSha256s[0]);
  const other=flow.freezeTerrainEdgeSources(f.workflow,{batchId:'edge.other',baseBatchSha256:edge.recipe.baseBatchSha256,
    capabilitiesSha256:f.options.capabilitiesSha256,items:[{assetId:'other.edge',role:'right-wall',content:'Synthetic independent rock edge.',exclusions:[]}]});
  flow.authorizeReferenceAssetBatch(f.workflow,f.batch.sha256,decision('edge.compute',f.batch.sha256,'approve-compute'));
  flow.authorizeReferenceAssetBatch(f.workflow,other.sha256,decision('other.compute',other.sha256,'approve-compute'));
  const moduleUrl=pathToFileURL(join(process.cwd(),'src/generation/index.mjs')).href;
  const code=`import {reserveNextTerrainEdgePlan} from ${JSON.stringify(moduleUrl)};try{const x=reserveNextTerrainEdgePlan(process.argv[1],process.argv[2],process.argv[3]);process.stdout.write(JSON.stringify({ok:true,planSha256:x.planSha256}));}catch(e){process.stdout.write(JSON.stringify({ok:false,code:e.errors?.[0]?.code}));}`;
  const worker=()=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--input-type=module','-e',code,f.workflow,f.batch.sha256,f.batch.planSha256s[0]]);let out='',err='';
    child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);child.on('error',reject);child.on('close',code=>{try{assert.equal(code,0,err);resolve(JSON.parse(out));}catch(e){reject(e);}});});
  const results=await Promise.all([worker(),worker()]);assert.equal(results.filter(x=>x.ok).length,1);
  assert(['WORKFLOW_BUSY','TERRAIN_EDGE_BATCH_STOPPED'].includes(results.find(x=>!x.ok).code));
  const reserved=flow.inspectWorkflow(f.workflow).plans.filter(p=>f.batch.planSha256s.includes(p.planSha256)&&p.status==='reserved');
  assert.equal(reserved.length,1);rejects(()=>flow.reserveNextTerrainEdgePlan(f.workflow,f.batch.sha256,f.batch.planSha256s[0]),'TERRAIN_EDGE_BATCH_STOPPED');
  const independent=flow.reserveNextTerrainEdgePlan(f.workflow,other.sha256,other.planSha256s[0]);assert.equal(independent.planSha256,other.planSha256s[0]);
  assert.equal(flow.inspectWorkflow(f.workflow).plans.filter(p=>p.status==='reserved'&&[...f.batch.planSha256s,...other.planSha256s].includes(p.planSha256)).length,2);
});

test('an outdated expected next plan never reserves its successor',{timeout:240000},t=>{
  const f=fixture(t);flow.authorizeReferenceAssetBatch(f.workflow,f.batch.sha256,decision('edge.compute',f.batch.sha256,'approve-compute'));
  const old=f.batch.planSha256s[0],{request,...ticket}=flow.reserveNextTerrainEdgePlan(f.workflow,f.batch.sha256,old);
  flow.recordSubmission(f.workflow,ticket);assert.equal(flow.receiveResult(f.workflow,ticket,sourcePng(true,88)).technical.status,'pass');
  const before=flow.inspectWorkflow(f.workflow),next=before.plans.find(p=>p.planSha256===f.batch.planSha256s[1]);
  assert.equal(next.status,'authorized');rejects(()=>flow.reserveNextTerrainEdgePlan(f.workflow,f.batch.sha256,old),'TERRAIN_EDGE_NEXT_CHANGED');
  const after=flow.inspectWorkflow(f.workflow);assert.equal(after.eventCount,before.eventCount);
  assert.equal(after.plans.find(p=>p.planSha256===next.planSha256).status,'authorized');
  assert.equal(after.plans.find(p=>p.planSha256===next.planSha256).reserved,false);
});
