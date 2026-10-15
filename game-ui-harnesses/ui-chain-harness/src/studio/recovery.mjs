import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
const exec=promisify(execFile);
export function recoveryController(entries,inspect,run){
 const tickets=new Map(),operations=new Map();let busy=false;
 async function list(){
  const tasks=await inspect();
  return tasks.map(task=>{
   let ticket=tickets.get(task.id);
   if(task.recovery!=='available'||busy){tickets.delete(task.id);ticket=null;}
   else if(!ticket||ticket.fingerprint!==task.fingerprint){ticket={token:randomUUID(),fingerprint:task.fingerprint};tickets.set(task.id,ticket);}
   const {fingerprint,...publicTask}=task;
   return {...publicTask,resumeToken:ticket?.token??null,operation:operations.get(task.id)??null};
  });
 }
 async function start(id,token){
  const entry=entries.find(e=>e.id===id),ticket=tickets.get(id);
  if(busy||!entry||!ticket||ticket.token!==token)throw Error('RECOVERY_NOT_AVAILABLE');
  // Reserve before awaiting revalidation; no duplicate submissions across tabs.
  busy=true;tickets.delete(id);
  try{
   const current=(await inspect()).find(t=>t.id===id);
   if(current?.recovery!=='available'||current.fingerprint!==ticket.fingerprint)throw Error('RECOVERY_STALE');
   operations.set(id,'running');
   Promise.resolve().then(()=>run(entry)).then(()=>operations.set(id,'finished'),()=>operations.set(id,'failed')).finally(()=>{busy=false;});
   return {status:'started'};
  }catch(e){busy=false;throw e;}
 }
 return {list,start};
}
export function cliRecovery(root){
 return async entry=>{
  // Only fixed deterministic resume command, no shell or browser-supplied paths.
  await exec(process.execPath,[join(root,'scripts/skin-task.mjs'),'resume','--directory',entry.directory],{cwd:root,windowsHide:true,maxBuffer:8*1024*1024,timeout:300000});
 };
}
