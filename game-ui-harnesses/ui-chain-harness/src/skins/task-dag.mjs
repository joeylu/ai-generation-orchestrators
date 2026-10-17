import {readFile,writeFile,mkdir,link,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {hash,json,readSafe} from './package.mjs';
import {acquireLocalLock} from './local-lock.mjs';
export function validateDag(graph){
  if(graph.version!=='1.0'||graph.automaticProviderCalls!==false||!Array.isArray(graph.nodes)||!graph.nodes.length)throw Error('dag.invalid');
  const seen=new Set();
  for(const n of graph.nodes){
    if(!/^[a-z][a-z0-9-]*$/.test(n.id)||seen.has(n.id)||!['source','locate','metadata','content-insets','assemble','materials','consumer','postprocess'].includes(n.kind)||!Array.isArray(n.dependsOn)||new Set(n.dependsOn).size!==n.dependsOn.length||n.dependsOn.some(d=>!seen.has(d)))throw Error('dag.invalid-order-or-dependency');
    seen.add(n.id);
  }
  return graph;
}
export async function taskStatus(directory,verify){
  const requestBytes=await readSafe(directory,'request.json'),request=JSON.parse(requestBytes);
  validateDag(request.graph);await verify(request.inputs);
  const nodes=[],receipts=new Map();
  for(const n of request.graph.nodes){
    let bytes;try{bytes=await readSafe(directory,'receipts/'+n.id+'.json');}catch(e){if(e.code!=='ENOENT')throw e;}
    if(bytes){
      const r=JSON.parse(bytes),dependencies=Object.fromEntries(n.dependsOn.map(d=>[d,receipts.get(d)?.sha256]));
      if(r.node!==n.id||r.requestSha256!==hash(requestBytes)||n.dependsOn.some(d=>!receipts.has(d))||JSON.stringify(r.dependencies)!==JSON.stringify(dependencies))throw Error('dag.receipt-binding');
      await verify(r.files);receipts.set(n.id,{...r,sha256:hash(bytes)});nodes.push({id:n.id,status:'passed',outputs:r.outputs});
    }else nodes.push({id:n.id,status:n.dependsOn.every(d=>receipts.has(d))?'ready':'waiting'});
  }
  const attempts=[];
  try{for(const entry of await readdir(join(directory,'attempts'),{withFileTypes:true})){
    if(!entry.isDirectory())continue;
    const started=JSON.parse(await readSafe(directory,'attempts/'+entry.name+'/started.json'));
    let failure;try{failure=JSON.parse(await readSafe(directory,'attempts/'+entry.name+'/failure.json'));}catch(e){if(e.code!=='ENOENT')throw e;}
    attempts.push({directory:'attempts/'+entry.name,node:started.node,status:failure?'failed':receipts.has(started.node)?'node-completed':'incomplete',...(failure?{failure:{code:failure.code}}:{})});
  }}catch(e){if(e.code!=='ENOENT')throw e;}
  for(const n of nodes)if(n.status==='ready'&&attempts.some(a=>a.node===n.id))n.status=attempts.some(a=>a.node===n.id&&a.status==='failed')?'failed-retryable':'incomplete';
  return {status:receipts.size===request.graph.nodes.length?'awaiting-visual-review':nodes.some(n=>n.status==='failed-retryable')?'failed-retryable':nodes.some(n=>n.status==='incomplete')?'incomplete':'ready-to-resume',nodes,attempts,receipts,request,requestSha256:hash(requestBytes),productionReady:false,generation:'not-invoked'};
}
export async function resumeTask(directory,{verify,execute,assertTools,until}){
  const release=await acquireLocalLock(directory);
  try{
    await assertTools();const state=await taskStatus(directory,verify);
    if(until&&!state.request.graph.nodes.some(n=>n.id===until))throw Error('dag.unknown-stop');
    for(const n of state.request.graph.nodes){
      if(state.receipts.has(n.id)){if(until===n.id)break;continue;}
      if(!n.dependsOn.every(d=>state.receipts.has(d)))throw Error('dag.dependencies');
      const attempt=join(directory,'attempts',n.id+'-'+randomUUID());await mkdir(attempt,{recursive:true});
      await writeFile(join(attempt,'started.json'),json({node:n.id,status:'started',generation:'not-invoked'}),{flag:'wx'});
      try{
        await verify(state.request.inputs);await assertTools();
        const result=await execute(n,Object.fromEntries([...state.receipts].map(([id,r])=>[id,r.outputs])),state.request);
        await verify(result.files);await verify(state.request.inputs);await assertTools();
        const receipt={node:n.id,requestSha256:state.requestSha256,dependencies:Object.fromEntries(n.dependsOn.map(d=>[d,state.receipts.get(d).sha256])),...result};
        const bytes=json(receipt),temp=join(attempt,'receipt.json');await writeFile(temp,bytes,{flag:'wx'});
        await link(temp,join(directory,'receipts',n.id+'.json'));
        state.receipts.set(n.id,{...receipt,sha256:hash(Buffer.from(bytes))});
      }catch(e){await writeFile(join(attempt,'failure.json'),json({node:n.id,status:'failed',code:e.code??e.message}),{flag:'wx'});throw e;}
      if(until===n.id)break;
    }
    return taskStatus(directory,verify);
  }finally{await release();}
}
