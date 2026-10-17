import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recoveryController} from '../src/studio/recovery.mjs';
import {studioServer} from '../src/studio/tasks.mjs';
test('recovery binds current state, consumes ticket and never retries automatically',async()=>{
 let state={id:'demo',recovery:'available',fingerprint:'one'},calls=0,finish;
 const controller=recoveryController([{id:'demo',directory:'fixed'}],async()=>[{...state}],async()=>{calls++;await new Promise(r=>finish=r);});
 let [task]=await controller.list();state.fingerprint='changed';
 await assert.rejects(()=>controller.start('demo',task.resumeToken),/STALE/);assert.equal(calls,0);
 [task]=await controller.list();await controller.start('demo',task.resumeToken);
 await assert.rejects(()=>controller.start('demo',task.resumeToken));assert.equal(calls,1);
 assert.equal((await controller.list())[0].resumeToken,null);
 finish();await new Promise(r=>setImmediate(r));
 assert.equal((await controller.list())[0].operation,'finished');assert.equal(calls,1);
 state.recovery='tools-changed';assert.equal((await controller.list())[0].resumeToken,null);
});
test('failed execution remains failed without automatic resubmission',async()=>{
 let calls=0;const c=recoveryController([{id:'a'}],async()=>[{id:'a',recovery:'available',fingerprint:'a'}],async()=>{calls++;throw Error('fixture failure');});
 const [task]=await c.list();await c.start('a',task.resumeToken);await new Promise(r=>setImmediate(r));
 assert.equal((await c.list())[0].operation,'failed');assert.equal(calls,1);
});
test('HTTP recovery requires exact same origin and token; GET does not execute',async()=>{
 let calls=0;let port;
 const server=studioServer({files:new Map()},0,async()=>[],async()=>{calls++;return {status:'started'};});
 // Server host policy is fixed at construction, reserve a port then construct tested server.
 await new Promise(r=>server.listen(0,'127.0.0.1',r));port=server.address().port;await new Promise(r=>server.close(r));
 const target=studioServer({files:new Map()},port,async()=>[],async(id,token)=>{if(token!=='ticket')throw Error('invalid');calls++;return {status:'started'};});
 await new Promise(r=>target.listen(port,'127.0.0.1',r));const base=`http://127.0.0.1:${port}`;
 try{
  assert.equal((await fetch(base+'/tasks/resume')).status,403);
  assert.equal((await fetch(base+'/tasks/resume',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal(calls,0);
  const post=token=>fetch(base+'/tasks/resume',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({id:'a',token})});
  assert.equal((await post('bad')).status,409);assert.equal(calls,0);
  assert.equal((await post('ticket')).status,202);assert.equal(calls,1);
 }finally{await new Promise(r=>target.close(r));}
});

test('generation HTTP distinguishes expired identity from other failures without leaking private errors',async()=>{
 const reserve=studioServer({files:new Map()},0,async()=>[]);
 await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 let requests=0;const target=studioServer({files:new Map()},port,async()=>[],null,null,{action:async(_,data)=>{requests++;throw Error(data.id==='old'?'GENERATION_UNKNOWN_PLAN':data.id==='recoverable'?'GENERATION_RECOVERABLE_IMAGE':'private-test-error');}});
 await new Promise(r=>target.listen(port,'127.0.0.1',r));const base=`http://127.0.0.1:${port}`;
 try{
  const post=id=>fetch(base+'/generation/supplement-prepare',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({id,sheetId:'S01'})});
  const old=await post('old');assert.equal(old.status,409);const expired=await old.json();assert.equal(expired.code,'GENERATION_STATE_EXPIRED');assert.match(expired.message,/未提交生成/);
  const failed=await post('current');assert.equal(failed.status,409);const generic=await failed.json();assert.equal(generic.code,undefined);assert.equal(JSON.stringify(generic).includes('private-test-error'),false);
  const recoverable=await post('recoverable');assert.equal(recoverable.status,409);const hint=await recoverable.json();assert.equal(hint.code,'GENERATION_RECOVERABLE_IMAGE');assert.match(hint.message,/先点击/);assert.match(hint.message,/未提交生成/);
  assert.equal(requests,3);
 }finally{await new Promise(r=>target.close(r));}
});
