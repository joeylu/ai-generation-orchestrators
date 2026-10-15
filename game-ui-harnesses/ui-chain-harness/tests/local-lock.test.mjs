import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {acquireLocalLock,localLockState} from '../src/skins/local-lock.mjs';
import {resumeTask} from '../src/skins/task-dag.mjs';
async function fixture(fn){const dir=await mkdtemp(join(tmpdir(),'ui-local-lock-'));try{await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}}
test('live locks block concurrent processes and malformed or legacy locks are never stolen',async()=>fixture(async dir=>{
 const release=await acquireLocalLock(dir);assert.equal((await localLockState(dir)).status,'busy');
 await assert.rejects(acquireLocalLock(dir),/LOCAL_LOCK_BUSY/);await release();await release();
 assert.equal((await localLockState(dir)).status,'free');
 for(const bytes of ['', '{}','{"pid":-1}']){await writeFile(join(dir,'.run.lock'),bytes);await assert.rejects(acquireLocalLock(dir),/LOCAL_LOCK_UNKNOWN/);assert.equal(await readFile(join(dir,'.run.lock'),'utf8'),bytes);}
}));
test('a killed DAG process resumes only unfinished nodes and stale lock reclamation has one winner',async()=>fixture(async dir=>{
 await mkdir(join(dir,'receipts'));
 const graph={version:'1.0',automaticProviderCalls:false,nodes:[{id:'a',kind:'source',dependsOn:[]},{id:'b',kind:'locate',dependsOn:['a']}]};
 await writeFile(join(dir,'request.json'),JSON.stringify({graph,inputs:[]}));
 const module=new URL('../src/skins/task-dag.mjs',import.meta.url).href;
 await writeFile(join(dir,'child.mjs'),`import {resumeTask} from ${JSON.stringify(module)};
await resumeTask(process.cwd(),{verify:async()=>{},assertTools:async()=>{},execute:async n=>{
 if(n.id==='b'){process.send('entered-b');await new Promise(()=>{});}return {outputs:{id:n.id},files:[]};}});`);
 const child=fork(join(dir,'child.mjs'),[],{cwd:dir,windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});
 try{
  await Promise.race([once(child,'message'),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('child timeout')),10000);timer.unref();})]);
  const before=await readFile(join(dir,'receipts/a.json'));
  const exited=once(child,'exit');child.kill();await exited;
  assert.equal((await localLockState(dir)).status,'stale');
  const locks=await Promise.allSettled(Array.from({length:6},()=>acquireLocalLock(dir)));
  const winners=locks.filter(x=>x.status==='fulfilled');assert.equal(winners.length,1);await winners[0].value();
  // Restore a stale owner record from the actual killed process, not an invented PID.
  await writeFile(join(dir,'.run.lock'),JSON.stringify({version:'1.0',pid:child.pid,token:'crash-fixture'}));
  const calls=[];
  const result=await resumeTask(dir,{verify:async()=>{},assertTools:async()=>{},execute:async n=>{calls.push(n.id);return {outputs:{id:n.id},files:[]};}});
  assert.equal(result.status,'awaiting-visual-review');assert.deepEqual(calls,['b']);assert.deepEqual(await readFile(join(dir,'receipts/a.json')),before);
  assert.equal((await localLockState(dir)).status,'free');
 }finally{if(child.exitCode===null)child.kill();}
}));
test('an unowned reclamation guard is conservative rather than deleting another process record',async()=>fixture(async dir=>{
 await writeFile(join(dir,'.run.lock.reclaim'),'');await assert.rejects(acquireLocalLock(dir),/LOCAL_LOCK_BUSY/);
}));
