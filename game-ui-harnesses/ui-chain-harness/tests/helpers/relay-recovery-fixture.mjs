// Synthetic local transcript/hook evidence only; never starts a CLI or model.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {requestFor} from '../../src/skin-generation/batch-runner.mjs';
import {hash,json} from '../../src/skins/package.mjs';
import {claimRelayJson,relayCode} from '../../../ui-reference-harness/web/adapters/codex-relay-contract.mjs';
import {relayHook} from '../../../ui-reference-harness/web/adapters/codex-relay-hook.mjs';
import {RelayArguments} from '../../../ui-reference-harness/web/adapters/codex-relay-arguments.mjs';

export async function relayRecoveryFixture({root,intake,node,bytes}){
 const relayRoot=resolve(root,'relay'),home=resolve(root,'home'),job=join(relayRoot,node.planSha256),sessionId='00000000-0000-0000-0000-000000000001';
 await mkdir(job,{recursive:true});const frozen=requestFor(intake,node),images=[];
 for(const [i,im] of frozen.images.entries()){const path=join(job,`reference-${i+1}.png`);await writeFile(path,im.bytes);images.push({path,sha256:im.sha256,role:im.role});}
 const request={kind:'ui_reference_codex_relay_request_v1',requestSha256:frozen.requestSha256,attemptSha256:node.planSha256,arguments:{prompt:frozen.prompt,num_last_images_to_include:2,transparent_background:true},images};
 claimRelayJson(job,'relay-request.json',request);const payloadSha256=hash(await readFile(join(job,'relay-request.json')));
 const event=(name,input,id)=>({hook_event_name:'PreToolUse',session_id:sessionId,tool_use_id:id,tool_name:name,tool_input:input});
 assert.equal(relayHook(job,payloadSha256,event('mcp__ui_reference_frozen__read_arguments',{},'args-1')).hookSpecificOutput.permissionDecision,'allow');
 const server=new RelayArguments(job,payloadSha256);server.handle({method:'notifications/initialized'});assert.deepEqual(server.handle({method:'tools/call',params:{name:'read_arguments',arguments:{}}}).structuredContent,request.arguments);
 const imageEvent=event('image_genimagegen',request.arguments,'image-1');assert.equal(relayHook(job,payloadSha256,imageEvent).hookSpecificOutput.permissionDecision,'allow');relayHook(job,payloadSha256,{...imageEvent,hook_event_name:'PostToolUse'});
 const imageDir=join(home,'generated_images',sessionId);await mkdir(imageDir,{recursive:true});const savedPath=join(imageDir,'result.png');await writeFile(savedPath,bytes);await writeFile(join(job,'original-output-1.png'),bytes);
 const entries=[{type:'turn_context',payload:{model:'gpt-6-luna',effort:'xhigh',approval_policy:'never',sandbox_policy:{type:'read-only'}}},{type:'response_item',payload:{type:'custom_tool_call',name:'exec',input:relayCode}},
  {type:'event_msg',payload:{type:'item_completed',item:{type:'Extension',kind:'image_gen.generation',id:'image-1',status:'completed',transparentBackground:true,savedPath,result:bytes.toString('base64')}}},
  {type:'event_msg',payload:{type:'task_complete',error:{message:'Connection failed: error sending request'}}}];
 await mkdir(join(home,'sessions'),{recursive:true});await writeFile(join(home,'sessions',`fixture-${sessionId}.jsonl`),entries.map(e=>JSON.stringify(e)).join('\n'));
 await writeFile(join(job,'dispatch.json'),json({attemptSha256:node.planSha256,requestSha256:frozen.requestSha256,payloadSha256,resumingSession:false,automaticResubmissions:0,model:'gpt-6-luna',effort:'xhigh'}));
 await writeFile(join(job,'session-result.json'),json({sessionId,completed:false,exitCode:1,automaticResubmissions:0}));
 return {relayRoot,home,job};
}
