import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {makeFreshDirectory,parseJson,readSelectedFile,writeFreshFile} from './files.mjs';
import * as flow from './generation/index.mjs';
import {assertTerrainEdgeRecoveryConfirmation} from './generation/terrain-edge-recovery.mjs';
import {check,digest,exact,hash,jsonBytes,seal,unseal} from './generation/common.mjs';
const sourceRoot=fileURLToPath(new URL('../',import.meta.url));

export function inspectTerrainEdgeBatch(workflow,batchSha256){
  const {batch,inspection:status}=flow.readTerrainEdgeWorkflowView(workflow,{batchSha256});
  const plans=batch.planSha256s.map(sha=>status.plans.find(plan=>plan.planSha256===sha));
  check(plans.every(Boolean),'TERRAIN_EDGE_BATCH');
  return {batch,plans,eventCount:status.eventCount,generationCalls:0};
}

// This materializes an external exchange only after an fsync'ed reservation.
// It never invokes an adapter. There is no loop or automatic next attempt.
export function reserveTerrainEdgeExchange(workflow,batchSha256,output){
  // One locked replay provides the batch, statuses, plans and checked input
  // bytes. The later reservation remains its own durable state transition.
  const view=flow.readTerrainEdgeWorkflowView(workflow,{batchSha256,includeCurrentInputs:true});
  const {batch}=view,plans=batch.planSha256s.map(sha=>view.inspection.plans.find(plan=>plan.planSha256===sha));
  check(plans.every(Boolean),'TERRAIN_EDGE_BATCH');
  const replacement=assertTerrainEdgeRecoveryConfirmation(batch,plans);
  check(!plans.some(plan=>['failed','indeterminate','rejected-technical','rejected-visual','reserved','submitted'].includes(plan.status)),
    'TERRAIN_EDGE_BATCH_STOPPED');
  const next=replacement??plans.find(plan=>plan.status==='authorized');check(next,'TERRAIN_EDGE_NOT_AUTHORIZED');
  const out=makeFreshDirectory(output,sourceRoot),{request,...ticket}=flow.reserveNextTerrainEdgePlan(workflow,batchSha256,next.planSha256);
  const plan=view.plans.find(item=>item.sha256===ticket.planSha256);
  check(plan&&digest(plan.request)===digest(request),'TERRAIN_EDGE_BATCH');
  const inputs=plan.request.images.map(image=>{const bytes=view.inputs.get(image.artifact.sha256);
    check(bytes?.length===image.artifact.byteLength,'IMAGE_REFERENCE');return {image,bytes};});
  writeFreshFile(join(out,'ticket.json'),jsonBytes(ticket),sourceRoot);
  flow.recordSubmission(workflow,ticket);
  const records=inputs.map(({image,bytes},index)=>{
    const path=`input-${index+1}.png`;writeFreshFile(join(out,path),bytes,sourceRoot);
    return {path,role:image.role,sha256:hash(bytes)};
  });
  const exchange=seal({format:'ai_scene_terrain_edge_exchange_v1',batchSha256:batch.sha256,ticket,request,inputs:records,
    transparentBackground:true,maximumCalls:1,automaticRetry:false});
  writeFreshFile(join(out,'prompt.txt'),Buffer.from(request.prompt),sourceRoot);
  writeFreshFile(join(out,'exchange.json'),jsonBytes(exchange),sourceRoot);
  return exchange;
}

function checkedExchange(workflow,directory){
  const exchange=parseJson(readSelectedFile(join(directory,'exchange.json'))),body=unseal(exchange);
  exact(body,['format','batchSha256','ticket','request','inputs','transparentBackground','maximumCalls','automaticRetry']);
  check(body.format==='ai_scene_terrain_edge_exchange_v1'&&body.transparentBackground===true&&body.maximumCalls===1&&body.automaticRetry===false,'TERRAIN_EDGE_EXCHANGE');
  // A request already submitted can finish after its source becomes stale.
  // Validate its immutable ticket and inputs without requiring current status;
  // otherwise the paid result or a terminal unknown could not be recorded.
  const ticket=parseJson(readSelectedFile(join(directory,'ticket.json')));
  check(digest(ticket)===digest(body.ticket),'TERRAIN_EDGE_EXCHANGE');
  const view=flow.readTerrainEdgeWorkflowView(workflow,{batchSha256:body.batchSha256,reservedInputPlanSha256:ticket.planSha256}),{batch}=view;
  check(digest(ticket)===digest(body.ticket)&&batch.planSha256s.includes(ticket.planSha256),'TERRAIN_EDGE_EXCHANGE');
  const plan=view.plans.find(item=>item.sha256===ticket.planSha256);check(plan,'TERRAIN_EDGE_EXCHANGE');
  check(digest(plan.request)===digest(body.request)&&digest(body.request)===ticket.requestSha256
    &&Array.isArray(body.inputs)&&body.inputs.length===plan.request.images.length,'TERRAIN_EDGE_EXCHANGE');
  body.inputs.forEach((input,index)=>{
    exact(input,['path','role','sha256']);check(input.path===`input-${index+1}.png`&&input.role===plan.request.images[index].role
      &&input.sha256===plan.request.images[index].artifact.sha256,'TERRAIN_EDGE_EXCHANGE');
    const expected=view.inputs.get(input.sha256);check(expected&&readSelectedFile(join(directory,input.path),16777216).equals(expected),'TERRAIN_EDGE_EXCHANGE_INPUT');
  });
  return {exchange,ticket,status:view.inspection.plans.find(item=>item.planSha256===ticket.planSha256)};
}

export function receiveTerrainEdgeExchange(workflow,directory,pngFile,{autoWeakGutter=false}={}){
  const {exchange,ticket,status}=checkedExchange(workflow,directory),bytes=readSelectedFile(pngFile,16777216);
  check(status,'TERRAIN_EDGE_EXCHANGE');
  let result;
  if(status.received){result=flow.getGenerationResult(workflow,ticket.planSha256).result;
    check(result.attemptSha256===ticket.attemptSha256&&result.rawSha256===hash(bytes),'TERRAIN_EDGE_EXCHANGE_RESULT');
  }else result=flow.receiveResult(workflow,ticket,bytes);
  for(const [path,data]of [['source-native.png',bytes],['technical.json',jsonBytes(result.technical)]]){
    const file=join(directory,path);
    if(existsSync(file))check(readSelectedFile(file,16777216).equals(data),'TERRAIN_EDGE_EXCHANGE_RESULT');
    else writeFreshFile(file,data,sourceRoot);
  }
  if(autoWeakGutter&&result.technical.status==='fail'){
    const prepared=flow.autoPrepareTerrainEdgeCanvasGutterSource(workflow,ticket.planSha256,exchange.batchSha256);
    if(prepared)return {...inspectTerrainEdgeBatch(workflow,prepared.batch.sha256),automaticGutter:{
      policy:prepared.record.automaticPolicy,originalPlanSha256:ticket.planSha256,originalRawSha256:result.rawSha256,
      originalTechnicalSha256:result.technical.sha256,preparedPlanSha256:prepared.record.sha256,
      preparedRawSha256:prepared.record.rawSha256,continuationBatchSha256:prepared.batch.sha256}};
  }
  return inspectTerrainEdgeBatch(workflow,exchange.batchSha256);
}

export function stopTerrainEdgeExchange(workflow,directory){
  const {exchange,ticket}=checkedExchange(workflow,directory);flow.stopAttempt(workflow,ticket,'indeterminate');
  return inspectTerrainEdgeBatch(workflow,exchange.batchSha256);
}

// This optional driver dispatches one already-authorized request. A persisted
// return file allows deterministic reception if local validation is interrupted.
export async function runTerrainEdgeExchange(workflow,batchSha256,directory,adapter,{autoWeakGutter=false}={}){
  check(typeof adapter?.preflight==='function'&&typeof adapter.generate==='function','TERRAIN_EDGE_ADAPTER_REQUIRED');
  await adapter.preflight();
  const exchange=reserveTerrainEdgeExchange(workflow,batchSha256,directory);
  const {ticket,request}=exchange;
  let bytes;
  try{
    const images=request.images.map((image,index)=>{
      const input=exchange.inputs[index],data=readSelectedFile(join(directory,input.path),16777216);
      check(data.length===image.artifact.byteLength&&hash(data)===image.artifact.sha256,'TERRAIN_EDGE_EXCHANGE_INPUT');
      return {...image,bytes:data};
    });
    bytes=await adapter.generate({...ticket,request,images});
    check(bytes instanceof Uint8Array&&bytes.byteLength>0&&bytes.byteLength<=16777216,'TERRAIN_EDGE_ADAPTER_OUTPUT');
  }catch{
    const stopped=stopTerrainEdgeExchange(workflow,directory);
    return {planSha256:ticket.planSha256,status:'indeterminate',eventCount:stopped.eventCount,automaticRetry:false};
  }
  const file=join(directory,'adapter-return.png');
  writeFreshFile(file,bytes,sourceRoot);
  const result=receiveTerrainEdgeExchange(workflow,directory,file,{autoWeakGutter});
  const prepared=result.automaticGutter;
  const received=result.plans.find(plan=>plan.planSha256===(prepared?.preparedPlanSha256??ticket.planSha256));
  return {planSha256:ticket.planSha256,status:received.status,technicalStatus:received.technicalStatus,
    rawSha256:prepared?.originalRawSha256??received.rawSha256,eventCount:result.eventCount,automaticRetry:false,
    ...(received.warnings?.length?{warnings:received.warnings}:{}),
    ...(prepared?{automaticGutter:prepared}:{})};
}
