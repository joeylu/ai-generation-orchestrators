import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {classifyCodexFailure,codexFailureReader} from '../src/skin-generation/codex-diagnostics.mjs';
import {relayCode} from '../../ui-reference-harness/web/adapters/codex-relay-contract.mjs';
const planSha256='a'.repeat(64),requestSha256='b'.repeat(64),sessionId='00000000-0000-0000-0000-000000000001';
const image={toolUseId:'image-one',sessionId,attemptSha256:planSha256,requestSha256};
const session={sessionId,exitCode:0,completed:true,failure:null,automaticResubmissions:0};
function transcript(){return [
 {type:'response_item',payload:{type:'custom_tool_call',name:'exec',input:relayCode,call_id:'call-one'}},
 {type:'event_msg',timestamp:'2026-10-14T11:49:42.782Z',payload:{type:'item_completed',item:{type:'Extension',kind:'image_gen.generation',id:'image-one',status:'failed',failure:null}}},
 {type:'response_item',payload:{type:'custom_tool_call_output',call_id:'call-one',output:[{type:'input_text',text:'Script error:\nimage generation failed: connection failed: error sending request https://private.invalid/?token=secret C:\\Users\\Private\\file'}]}}
];}
test('successful CLI exit with failed image tool yields a safe connection diagnosis, not ambiguous images',()=>{
 const d=classifyCodexFailure({entries:transcript(),image,session,outputCount:0});
 assert.equal(d.code,'image-request-connection-failed');assert.equal(d.finishedAt,'2026-10-14T11:49:42.782Z');assert.match(d.detail,/不会自动重投/);
 assert.doesNotMatch(JSON.stringify(d),/private|secret|Users|https|call-one/);
});
test('returned PNGs take priority over tool failure and direct user to recovery',()=>{
 for(const outputCount of [1,2])assert.equal(classifyCodexFailure({entries:transcript(),image,session,outputCount}).code,'returned-image-needs-check');
});
test('prompt text, unrelated outputs and non-exact calls cannot become a connection diagnosis',()=>{
 const es=transcript();es[2].payload.call_id='unrelated';es.push({type:'response_item',payload:{type:'message',content:'connection failed: error sending request'}});
 assert.equal(classifyCodexFailure({entries:es,image,session,outputCount:0}).code,'image-tool-failed');
 es[2].payload.call_id='call-one';es[0].payload.input='unapproved program';
 assert.equal(classifyCodexFailure({entries:es,image,session,outputCount:0}).code,'image-tool-failed');
});
test('unknown failures, zero results and session failure remain distinct and do not claim success',()=>{
 assert.equal(classifyCodexFailure({entries:[],session,outputCount:0}).code,'image-output-missing');
 assert.equal(classifyCodexFailure({entries:[],session:{...session,exitCode:1},outputCount:0}).code,'session-not-completed');
 assert.equal(classifyCodexFailure({entries:transcript(),image:{toolUseId:'wrong'},session,outputCount:0}).code,'image-output-missing');
});
test('protocol session connection errors are recognized without treating arbitrary model text as an error',()=>{
 const end={type:'event_msg',timestamp:'2026-10-14T11:59:23Z',payload:{type:'task_complete',error:{message:'Connection failed: error sending request'}}};
 const d=classifyCodexFailure({entries:[end],session:{...session,completed:false,exitCode:1},outputCount:0});assert.equal(d.code,'model-request-connection-failed');assert.equal(d.finishedAt,end.timestamp);
});
async function fixture(t,overrides={}){
 const root=await mkdtemp(join(tmpdir(),'chain-diagnostic-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const relayRoot=join(root,'relay'),home=join(root,'home'),job=join(relayRoot,planSha256);
 await mkdir(job,{recursive:true});await mkdir(join(home,'sessions'),{recursive:true});
 const files=[['dispatch.json',{attemptSha256:planSha256,requestSha256,resumingSession:false,automaticResubmissions:0,...overrides}],['session-result.json',session],['image-call.json',image]];
 for(const [name,value]of files)await writeFile(join(job,name),JSON.stringify(value));
 await writeFile(join(home,'sessions','fixture-'+sessionId+'.jsonl'),transcript().map(e=>JSON.stringify(e)).join('\n'));
 return {job,read:codexFailureReader({relayRoot,home}),query:{planSha256,requestSha256,status:'indeterminate',outcomeRecorded:true}};
}
test('historical diagnosis reads bound evidence without editing records and ignores running or received states',async t=>{
 const f=await fixture(t),before=await readFile(join(f.job,'session-result.json'));
 assert.equal((await f.read(f.query)).code,'image-request-connection-failed');
 assert.deepEqual(await readFile(join(f.job,'session-result.json')),before);
 assert.equal(await f.read({...f.query,outcomeRecorded:false}),undefined);
 assert.equal(await f.read({...f.query,status:'received'}),undefined);
 assert.equal(await f.read({...f.query,planSha256:'../outside'}),undefined);
});
test('mismatched or missing optional diagnostics never break status or misattribute an error',async t=>{
 const f=await fixture(t,{requestSha256:'c'.repeat(64)});assert.equal(await f.read(f.query),undefined);
 assert.equal(await f.read({...f.query,planSha256:'d'.repeat(64)}),undefined);
});
test('retained raw output is surfaced even if the original session image directory is no longer available',async t=>{
 const f=await fixture(t);await writeFile(join(f.job,'original-output-1.png'),'unverified fixture bytes');
 assert.equal((await f.read(f.query)).code,'returned-image-needs-check');
});
