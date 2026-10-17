// Offline transport fixtures: no CLI process, RPC server, login or model is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {encodePng} from '../src/skins/png.mjs';
import {createSkinCodexAdapter} from '../src/skin-generation/codex-adapter.mjs';
import {createCodexCliRelayAdapter,relayLaunchConfig} from '../../ui-reference-harness/web/adapters/codex-cli-relay.mjs';
import {relayHook} from '../../ui-reference-harness/web/adapters/codex-relay-hook.mjs';
import {RelayArguments} from '../../ui-reference-harness/web/adapters/codex-relay-arguments.mjs';
import {relayCode,relayHash,claimRelayJson,readRelayJson,loadRelayRequest} from '../../ui-reference-harness/web/adapters/codex-relay-contract.mjs';
import {verifyRelayAudit} from '../../ui-reference-harness/web/adapters/codex-relay-session.mjs';

const sessionId='00000000-0000-0000-0000-000000000001',permission=value=>value.hookSpecificOutput?.permissionDecision;
const png=()=>encodePng({width:8,height:8,pixels:Buffer.alloc(8*8*4,255)});
const event=(name,input,id)=>({hook_event_name:'PreToolUse',session_id:sessionId,tool_use_id:id,tool_name:name,tool_input:input});
function directory(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'chain-relay-transparency-'));t.after(()=>{assert.equal(path.dirname(root),os.tmpdir());assert.match(path.basename(root),/^chain-relay-transparency-/);fs.rmSync(root,{recursive:true,force:true});});return root;}
function argumentsRead(job,digest,request){
 assert.equal(permission(relayHook(job,digest,event('mcp__ui_reference_frozen__read_arguments',{},'arguments-1'))),'allow');
 const server=new RelayArguments(job,digest);server.handle({method:'notifications/initialized'});
 assert.deepEqual(server.handle({method:'tools/call',params:{name:'read_arguments',arguments:{}}}).structuredContent,request.arguments);
}
function transportFixture(t){
 const root=directory(t),home=path.join(root,'home'),workspace=path.join(root,'jobs'),image=png(),calls=[];fs.mkdirSync(home);fs.mkdirSync(workspace);
 const input={requestSha256:'a'.repeat(64),attemptSha256:'b'.repeat(64),prompt:'Frozen synthetic UI geometry.',images:[{bytes:image,sha256:relayHash(image),role:'style-reference'},{bytes:image,sha256:relayHash(image),role:'geometry-template'}]};
 const options={workspace,codexHome:home,command:async args=>{
  if(args[0]==='login')return {stdout:'',stderr:'Logged in using ChatGPT'};
  if(args[0]==='features')return {stdout:'image_generation stable true\nhooks stable true\ncode_mode_host stable true\n',stderr:''};
  if(args[0]==='exec')return {stdout:'--ignore-user-config --strict-config --json',stderr:''};
  assert.deepEqual(args,['debug','models','--bundled']);return {stdout:JSON.stringify({models:[{slug:'gpt-6-luna',supported_reasoning_levels:[{effort:'xhigh'}]}]}),stderr:''};
 },rpcFactory:(args,{cwd})=>({initialize:async()=>{},close(){},request:async method=>{
  assert.equal(method,'hooks/list');const file=path.join(cwd,'relay-request.json'),digest=fs.existsSync(file)?relayHash(fs.readFileSync(file)):'0'.repeat(64),config=relayLaunchConfig(cwd,digest);
  return {data:[{errors:[],hooks:[['preToolUse','hooks.PreToolUse'],['postToolUse','hooks.PostToolUse']].map(([eventName,field],index)=>({eventName,source:'sessionFlags',enabled:true,handlerType:'command',matcher:null,command:config[field][0].hooks[0][process.platform==='win32'?'command_windows':'command'],key:`flags:${eventName}:0:0`,currentHash:`sha256:${String(index).repeat(64)}`,trustStatus:args.some(arg=>arg.startsWith('hooks.state='))?'trusted':'untrusted'}))}]};
 }}),runner:async({args,cwd:job,prompt,onEvent})=>{
  calls.push({args,prompt});const request=readRelayJson(path.join(job,'relay-request.json')),digest=relayHash(fs.readFileSync(path.join(job,'relay-request.json')));
  onEvent({type:'thread.started',thread_id:sessionId});argumentsRead(job,digest,request);
  const imageEvent=event('image_genimagegen',request.arguments,'image-1');assert.equal(permission(relayHook(job,digest,imageEvent)),'allow');relayHook(job,digest,{...imageEvent,hook_event_name:'PostToolUse'});
  const imageDirectory=path.join(home,'generated_images',sessionId),logs=path.join(home,'sessions');fs.mkdirSync(imageDirectory,{recursive:true});fs.mkdirSync(logs);fs.writeFileSync(path.join(imageDirectory,'output.png'),image);
  fs.writeFileSync(path.join(logs,`synthetic-${sessionId}.jsonl`),[{type:'turn_context',payload:{model:'gpt-6-luna',effort:'xhigh',approval_policy:'never',sandbox_policy:{type:'read-only'}}},{type:'response_item',payload:{type:'custom_tool_call',name:'exec',input:relayCode}}].map(value=>JSON.stringify(value)).join('\n')+'\n');
  onEvent({type:'turn.completed'});return {exitCode:0};
 }};
 return {root,workspace,input,image,calls,options};
}

test('Reference relay stays opaque by default while explicit transparent mode is frozen through the same transport and audit',async t=>{
 for(const transparency of [undefined,true]){
  const f=transportFixture(t),adapter=createCodexCliRelayAdapter({...f.options,...(transparency===undefined?{}:{transparentBackground:transparency})});
  assert.deepEqual(await adapter.generate(f.input),f.image);assert.equal(f.calls.length,1);
  const job=path.join(f.workspace,f.input.attemptSha256),expected=transparency??false;
  assert.equal(readRelayJson(path.join(job,'relay-request.json')).arguments.transparent_background,expected);
  assert.equal(readRelayJson(path.join(job,'image-call.json')).transparentBackground,expected);
  assert.equal(readRelayJson(path.join(job,'image-call-audit.json')).transparentBackground,expected);
  assert(f.calls[0].prompt.includes(`transparent_background=${expected}`));
  await assert.rejects(()=>adapter.generate(f.input),/ALREADY_DISPATCHED/);assert.equal(f.calls.length,1);
 }
});
test('relay transparency requires a boolean and cannot be changed in tool parameters or committed call evidence',t=>{
 for(const value of [null,0,1,'true',{}])assert.throws(()=>createCodexCliRelayAdapter({transparentBackground:value}),/BOOLEAN_REQUIRED/);
 for(const transparent_background of [false,true]){
  const job=directory(t),file=path.join(job,'reference-1.png'),bytes=png();fs.writeFileSync(file,bytes);
  const request={kind:'ui_reference_codex_relay_request_v1',requestSha256:'a'.repeat(64),attemptSha256:'b'.repeat(64),arguments:{prompt:'Synthetic frozen image arguments.',num_last_images_to_include:1,transparent_background},images:[{path:file,sha256:relayHash(bytes),role:'style-reference'}]};
  claimRelayJson(job,'relay-request.json',request);const digest=relayHash(fs.readFileSync(path.join(job,'relay-request.json')));assert.deepEqual(loadRelayRequest(job,digest).arguments,request.arguments);argumentsRead(job,digest,request);
  const imageEvent=event('image_genimagegen',request.arguments,'image-1');
  assert.equal(permission(relayHook(job,digest,{...imageEvent,tool_input:{...request.arguments,transparent_background:!transparent_background}})),'deny');assert.equal(fs.existsSync(path.join(job,'image-call.json')),false);
  assert.equal(permission(relayHook(job,digest,imageEvent)),'allow');assert.equal(permission(relayHook(job,digest,imageEvent)),'deny');relayHook(job,digest,{...imageEvent,hook_event_name:'PostToolUse'});
  const entries=[{type:'response_item',payload:{type:'custom_tool_call',name:'exec',input:relayCode}}];assert.equal(verifyRelayAudit(job,request,digest,sessionId,entries).transparentBackground,transparent_background);
  const evidence=readRelayJson(path.join(job,'image-call.json'));evidence.transparentBackground=!transparent_background;fs.writeFileSync(path.join(job,'image-call.json'),JSON.stringify(evidence));
  assert.throws(()=>verifyRelayAudit(job,request,digest,sessionId,entries),/AUDIT_FAILED/);
 }
});
test('Chain forces the transparent contract and uses one fresh plan attempt without a reused reference session',async t=>{
 const f=transportFixture(t),adapter=createSkinCodexAdapter({...f.options,transparentBackground:false}),request={...f.input,planSha256:f.input.attemptSha256,output:{format:'png',transparentBackground:true},sessionKey:'c'.repeat(64)};
 await assert.rejects(()=>adapter.generate({...request,output:{format:'png',transparentBackground:false}}),/SKIN_REQUEST_INVALID/);assert.equal(f.calls.length,0);
 assert.deepEqual(await adapter.generate(request),f.image);const job=path.join(f.workspace,request.planSha256);
 assert.equal(readRelayJson(path.join(job,'relay-request.json')).arguments.transparent_background,true);assert.equal(readRelayJson(path.join(job,'image-call-audit.json')).transparentBackground,true);
 assert.equal(f.calls.length,1);assert(!f.calls[0].args.includes('resume'));assert.equal(fs.existsSync(path.join(f.workspace,'relay-sessions')),false);
});
