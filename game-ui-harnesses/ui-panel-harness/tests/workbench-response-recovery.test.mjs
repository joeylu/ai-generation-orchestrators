import test from 'node:test';
import assert from 'node:assert/strict';
import {requestCodexProposal,requestCodexEditProposal} from '../src/workbench-codex-client.mjs';
const context={sha256:'a'.repeat(64)},encoder=new TextEncoder();
const methods=[['plan',requestCodexProposal],['edit',requestCodexEditProposal]];
function brokenBody(error,partial){
 let pulls=0;
 const body=new ReadableStream({pull(controller){
  if(partial&&++pulls===1)controller.enqueue(encoder.encode('{"protocol":"0.1","unfinished":'));
  else controller.error(error);
 }});
 return new Response(body,{headers:{'Content-Type':'application/json'}});
}
for(const [kind,request]of methods){
 for(const partial of [false,true])test(`${kind}: body-read network failure ${partial?'after a partial chunk':'before the first chunk'} is sanitized and never retried`,async()=>{
  let calls=0;const response=brokenBody(new TypeError('SECRET_PRIVATE_TRANSPORT_DETAILS'),partial);
  await assert.rejects(request(context,new AbortController().signal,async()=>{calls++;return response;}),
   error=>error.code==='CODEX_BRIDGE_NETWORK_FAILED'&&error.message==='CODEX_BRIDGE_NETWORK_FAILED');
  assert.equal(calls,1);assert.equal(response.body.locked,false);
 });
 for(const name of ['AbortError','TimeoutError'])test(`${kind}: ${name} while reading a partial response keeps its identity without retry`,async()=>{
  let calls=0;const response=brokenBody(new DOMException('Interrupted',name),true);
  await assert.rejects(request(context,new AbortController().signal,async()=>{calls++;return response;}),{name});
  assert.equal(calls,1);assert.equal(response.body.locked,false);
 });
 test(`${kind}: truncated JSON and response size limits keep their specific rejection codes`,async()=>{
  for(const [body,code]of [['{"protocol":','CODEX_BRIDGE_RESPONSE'],['x'.repeat(2*1024*1024+1),'CODEX_BRIDGE_RESPONSE_LIMIT']]){
   let calls=0;const response=new Response(body,{headers:{'Content-Type':'application/json'}});
   await assert.rejects(request(context,new AbortController().signal,async()=>{calls++;return response;}),{code});
   assert.equal(calls,1);assert.equal(response.body.locked,false);
  }
 });
}
