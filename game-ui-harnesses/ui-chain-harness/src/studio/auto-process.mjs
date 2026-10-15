// Only deterministic processing. Generation/recovery/supplement endpoints are never called here.
import {writeFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {readSafe} from '../skins/package.mjs';
import {localRecoveryPolicy} from './local-recovery.mjs';
export function automaticProcessing(root,generation,pipeline,{policy=localRecoveryPolicy,schedule=setTimeout,cancel=clearTimeout}={}){
 const active=new Set(),timers=new Map(),busyChecks=new Map();let closed=false;
 const later=(id,ms)=>{
  if(closed||timers.has(id))return;
  const timer=schedule(()=>{timers.delete(id);pipeline.recoveryPending?.(id,false);return auto(id).catch(()=>{if(!closed)console.error('A saved local task needs review.');});},ms);
  timer?.unref?.();timers.set(id,timer);pipeline.recoveryPending?.(id,true);
 };
 const unsubscribe=pipeline.onProcessed?.((id,state)=>{if(state.phase==='processing'||state.retryable)later(id,policy.retryDelayMs);});
 const auto=async id=>{
  if(closed||active.has(id))return;active.add(id);
  if(timers.has(id)){cancel(timers.get(id));timers.delete(id);pipeline.recoveryPending?.(id,false);}
  try{
  const plan=generation.resolve(id),dir=dirname(dirname(join(root,plan.directory)));
  let project;try{project=JSON.parse(await readSafe(dir,'project.json'));}catch{return;}
  if(project.automaticProcessing!==true)return;
  const state=await generation.action('status',{id});
  if(state.nodes.length!==4||state.nodes.some(n=>n.status!=='received'))return;
  const claim=join(dir,'auto-process.json');
  try{await writeFile(claim,JSON.stringify({version:'1.0',batchSha256:plan.batchSha256,claimedAt:new Date().toISOString()}),{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}
  // This file binds the original automatic handoff, not a permanent "already tried" flag.
  const binding=JSON.parse(await readSafe(dir,'auto-process.json'));
  if(binding.version!=='1.0'||binding.batchSha256!==plan.batchSha256)throw Error('LOCAL_BATCH_CHANGED');
  if(closed)return;
  const result=await pipeline.processAutomatically(id);
  if(result.status==='busy'){
   const count=(busyChecks.get(id)??0)+1;busyChecks.set(id,count);
   if(count<policy.maxBusyChecks)later(id,policy.busyDelayMs);
  }else busyChecks.delete(id);
  }finally{active.delete(id);}
 };
 auto.close=()=>{closed=true;unsubscribe?.();for(const [id,timer] of timers){cancel(timer);pipeline.recoveryPending?.(id,false);}timers.clear();};
 return auto;
}
