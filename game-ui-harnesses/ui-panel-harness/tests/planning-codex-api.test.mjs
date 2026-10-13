import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {preparePlanning} from 'ai-ui-panel-harness/planning/v1';
import {prepareCodexPlanning,runCodexPlanning} from 'ai-ui-panel-harness/planning/codex/v1';
import {harnessRoot} from '../src/io.mjs';
const catalog=JSON.parse(await readFile(new URL('../examples/modern-mint-layout.catalog.json',import.meta.url)));
const session=await preparePlanning({request:{requestVersion:'0.1',id:'sample',target:'pixi',text:'音乐开关默认开启。'},catalog});
await mkdir(join(harnessRoot,'.tmp'),{recursive:true});
const root=await mkdtemp(join(harnessRoot,'.tmp','native-planning-'));
const executable=join(root,process.platform==='win32'?'codex.exe':'codex');await writeFile(executable,'fixture only');
const plan=await prepareCodexPlanning(session,'Return intent only.');
function fake(fail=false){
  let calls=0;
  const runProcess=(exe,args,options)=>{
    calls++;assert.equal(options.shell,false);assert(args.includes('--ignore-user-config'));assert(args.includes('--ephemeral'));assert(args.includes('features.shell_tool=false'));
    const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>queueMicrotask(()=>child.emit('close',1));
    child.stdin=new Writable({write(chunk,enc,cb){cb();},final(cb){cb();queueMicrotask(()=>{
      const events=[{type:'thread.started',thread_id:'11111111-1111-1111-1111-111111111111'},{type:'turn.started'},
        ...(fail?[{type:'turn.failed',error:{message:'network connection error'}}]:[{type:'item.completed',item:{type:'agent_message',text:'{"panel":null,"unresolved":[]}' }},{type:'turn.completed'}])];
      child.stdout.write(events.map(e=>JSON.stringify(e)).join('\n')+'\n');child.emit('close',0);
    });}});return child;
  };return {runProcess,get calls(){return calls;}};
}
const options=(name,f)=>({authorizationSha256:plan.sha256,outputRoot:join(root,name),writableRoot:root,executable,runProcess:f.runProcess,checkRuntime:()=>({status:'PASS'})});
test('public optional transport preserves raw response, invokes once and blocks repeated dispatch',async()=>{
  const f=fake(),o=options('success',f);const result=await runCodexPlanning(plan,o);
  assert.equal(f.calls,1);assert.equal(result.receipt.status,'RESPONSE_RECEIVED');assert.equal(result.receipt.automaticRetries,0);
  assert.equal(await readFile(join(result.directory,'response.txt'),'utf8'),'{"panel":null,"unresolved":[]}');
  // Transport receipt is deliberately not semantic acceptance or legacy compilation.
  await assert.rejects(()=>runCodexPlanning(plan,o),/OUTPUT_EXISTS/);assert.equal(f.calls,1);
});
test('changed plan, absent authorization and preflight failure submit nothing; interrupted turn is terminal',async()=>{
  const f=fake(true),o=options('failure',f);
  await assert.rejects(()=>runCodexPlanning({...plan,prompt:'changed'},o),{code:'PLANNING_PLAN_CHANGED'});
  await assert.rejects(()=>runCodexPlanning(plan,{...o,authorizationSha256:null}),{code:'PLANNING_AUTHORIZATION_REQUIRED'});
  await assert.rejects(()=>runCodexPlanning(plan,{...o,checkRuntime:()=>({status:'FAIL',code:'NOT_LOGGED_IN'})}),{code:'NOT_LOGGED_IN'});
  assert.equal(f.calls,0);await assert.rejects(()=>runCodexPlanning(plan,o));assert.equal(f.calls,1);
  await assert.rejects(()=>runCodexPlanning(plan,o),/OUTPUT_EXISTS/);assert.equal(f.calls,1);
  const receipt=JSON.parse(await readFile(join(o.outputRoot,'intent-'+plan.sha256,'receipt.json')));assert.equal(receipt.status,'FAILED');assert.equal(receipt.invocationCount,1);
});
