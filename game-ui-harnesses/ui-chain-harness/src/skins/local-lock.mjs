// Single-machine process ownership, not a timed lease. Never steal a live/unknown owner.
import {open,unlink,lstat,readFile} from 'node:fs/promises';
import {join,resolve,parse} from 'node:path';
import {randomUUID} from 'node:crypto';
const error=code=>Object.assign(Error(code),{code});
async function readOwner(directory,name){
 if(!/^\.(run|processing)\.lock(?:\.reclaim)?$/.test(name))throw error('LOCAL_LOCK_UNKNOWN');
 const path=resolve(directory,name),base=parse(path).root;let current=base;
 for(const part of path.slice(base.length).split(/[\\/]/).filter(Boolean)){
  current=join(current,part);if((await lstat(current)).isSymbolicLink())throw error('LOCAL_LOCK_UNKNOWN');
 }
 const stat=await lstat(path);if(!stat.isFile()||stat.size<1||stat.size>4096)throw error('LOCAL_LOCK_UNKNOWN');
 return JSON.parse(await readFile(path,'utf8'));
}
export async function localLockState(directory,name='.run.lock'){
 let owner;
 try{owner=await readOwner(directory,name);}
 catch(e){if(e.code==='ENOENT')return {status:'free'};return {status:'unknown'};}
 if(owner.version!=='1.0'||!Number.isSafeInteger(owner.pid)||owner.pid<1||typeof owner.token!=='string'||!owner.token)return {status:'unknown'};
 try{process.kill(owner.pid,0);return {status:'busy',owner};}
 catch(e){return {status:e.code==='ESRCH'?'stale':'unknown',owner};}
}
export async function acquireLocalLock(directory,name='.run.lock'){
 const path=join(directory,name),guardName=name+'.reclaim';
 // A separate exclusive guard serializes stale-lock removal. Unknown/abandoned guards
 // require review; no recursive reclamation or age-based assumptions.
 if((await localLockState(directory,guardName)).status!=='free')throw error('LOCAL_LOCK_BUSY');
 async function create(){
  const handle=await open(path,'wx'),owner={version:'1.0',pid:process.pid,token:randomUUID()};
  try{await handle.writeFile(JSON.stringify(owner));await handle.sync();}
  catch(e){await handle.close();throw e;}
  let released=false;
  return async()=>{
   if(released)return;released=true;await handle.close();
   const current=await localLockState(directory,name);
   if(current.owner?.token===owner.token)await unlink(path);
  };
 }
 try{return await create();}catch(e){if(e.code!=='EEXIST')throw e;}
 const state=await localLockState(directory,name);
 if(state.status!=='stale')throw error(state.status==='unknown'?'LOCAL_LOCK_UNKNOWN':'LOCAL_LOCK_BUSY');
 let guard;
 try{guard=await open(join(directory,guardName),'wx');}catch(e){if(e.code==='EEXIST')throw error('LOCAL_LOCK_BUSY');throw e;}
 try{
  await guard.writeFile(JSON.stringify({version:'1.0',pid:process.pid,token:randomUUID()}));
  const current=await localLockState(directory,name);
  if(current.status==='stale'&&current.owner.token===state.owner.token)await unlink(path);
  else if(current.status!=='free')throw error(current.status==='unknown'?'LOCAL_LOCK_UNKNOWN':'LOCAL_LOCK_BUSY');
  try{return await create();}catch(e){if(e.code==='EEXIST')throw error('LOCAL_LOCK_BUSY');throw e;}
 }finally{await guard.close();await unlink(join(directory,guardName));}
}
