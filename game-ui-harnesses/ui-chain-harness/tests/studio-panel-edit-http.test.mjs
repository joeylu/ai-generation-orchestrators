import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {request} from 'node:http';
import {studioServer} from '../src/studio/tasks.mjs';

async function fixture(handler){
 const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const server=studioServer({files:new Map(),items:[]},port,async()=>[],undefined,undefined,undefined,undefined,undefined,undefined,handler);
 await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
 return {base:'http://127.0.0.1:'+port,close:()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);})};
}

test('size-copy HTTP writes require exact loopback origin and supported actions without compute paths',async()=>{
 const calls=[],env=await fixture(async(action,data)=>{calls.push({action,data});return {revisionId:'fixture'};});
 try{
  const send=(path,origin=env.base)=>fetch(env.base+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({artifactId:'fixture',variantKey:'custom-landscape'})});
  assert.equal((await send('/panel-edit/save','https://untrusted.example')).status,403);
  assert.equal((await send('/panel-edit/delete')).status,403);assert.equal((await send('/panel-edit/source')).status,403);
  assert.equal((await send('/panel-edit/load?other=1')).status,403);assert.equal(calls.length,0);
  assert.equal((await send('/panel-edit/load')).status,200);assert.deepEqual(calls,[{action:'load',data:{artifactId:'fixture',variantKey:'custom-landscape'}}]);
 }finally{await env.close();}
});

test('size-copy source accepts only the explicit artifact query and rejects unknown host',async()=>{
 const calls=[],env=await fixture(async(action,data)=>{calls.push({action,data});return {kind:'ui_panel_edit_source'};});
 try{
  assert.equal((await fetch(env.base+'/panel-edit/source?artifact=fixture')).status,200);
  assert.deepEqual(calls,[{action:'source',data:{artifactId:'fixture'}}]);
  assert.equal((await fetch(env.base+'/panel-edit/source?artifact=fixture&artifact=second')).status,403);
  const wrongHost=await new Promise((resolve,reject)=>{const req=request(env.base+'/panel-edit/source?artifact=fixture',{headers:{Host:'untrusted.example'}},response=>{response.resume();resolve(response.statusCode);});req.on('error',reject);req.end();});
  assert.equal(wrongHost,404);
  assert.equal(calls.length,1);
 }finally{await env.close();}
});

test('size-copy failures expose a safe identifier and keep raw process or filesystem diagnostics private',async()=>{
 const env=await fixture(async()=>{throw Error('C:\\private\\model?token=secret');});
 try{
  const response=await fetch(env.base+'/panel-edit/source?artifact=fixture'),value=await response.json();
  assert.equal(response.status,409);assert.equal(value.code,'PANEL_EDIT_FAILED');assert.doesNotMatch(JSON.stringify(value),/private|token|secret/);
 }finally{await env.close();}
});
