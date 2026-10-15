import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pipelineController} from '../src/studio/pipeline.mjs';
import {automaticProcessing} from '../src/studio/auto-process.mjs';
import {localFailure,automaticRecoveryDecision} from '../src/studio/local-recovery.mjs';
import {acquireLocalLock,localLockState} from '../src/skins/local-lock.mjs';
const policy={maxAutomaticStarts:3,retryDelayMs:5,busyDelayMs:5,maxBusyChecks:3};
async function fixture(fn){
 const root=await mkdtemp(join(tmpdir(),'ui-local-recovery-')),dir=join(root,'work/project');let auto;
 try{
  for(const path of ['work/project','work/skin-tasks/fixture','configs','scripts'])await mkdir(join(root,path),{recursive:true});
  await writeFile(join(dir,'project.json'),JSON.stringify({name:'fixture',automaticProcessing:true}));
  await writeFile(join(root,'configs/studio-metadata-profile.json'),'{}');
  const flow={version:'1.0',panels:[],phase:'processing',taskDirectory:'work/skin-tasks/fixture',localRecovery:{batchSha256:'digest',automaticStarts:1}};
  await writeFile(join(dir,'flow.json'),JSON.stringify(flow));
  await writeFile(join(dir,'auto-process.json'),JSON.stringify({version:'1.0',batchSha256:'digest'}));
  const generation={resolve:()=>({directory:'work/project/batches/digest',batchSha256:'digest'}),action:async action=>{assert.equal(action,'status','automatic recovery must never submit generation');return {nodes:Array.from({length:4},()=>({status:'received'}))};}};
  const makePipeline=(inspectTasks=async()=>[{status:'incomplete',toolsMatch:true}])=>pipelineController(root,generation,{files:new Map(),items:[]},{inspectTasks,policy});
  const readFlow=async()=>JSON.parse(await readFile(join(dir,'flow.json')));
  const wait=async predicate=>{for(let i=0;i<300;i++){const f=await readFlow();if(predicate(f)&&(await localLockState(dir,'.processing.lock')).status==='free')return f;await new Promise(r=>setTimeout(r,20));}throw Error('flow timeout');};
  const createAuto=pipeline=>(auto=automaticProcessing(root,generation,pipeline,{policy}));
  await fn({root,dir,flow,generation,makePipeline,readFlow,wait,createAuto});
 }finally{auto?.close();await rm(root,{recursive:true,force:true});}
}
async function script(root,failure){await writeFile(join(root,'scripts/skin-task.mjs'),`
import {appendFile,readFile} from 'node:fs/promises';
if(process.argv[2]!=='resume')throw Error('must reuse existing task');
await appendFile('work/calls.txt','resume\\n');
const calls=(await readFile('work/calls.txt','utf8')).trim().split('\\n').length;
${failure}
console.log(JSON.stringify({status:'awaiting-visual-review'}));`);}
test('only explicit transient local errors retry; quality and integrity failures dominate nested transient details',()=>{
 for(const code of ['EBUSY','ETIMEDOUT','LOCAL_COMMAND_TIMEOUT'])assert.equal(localFailure({detail:{code}}).retryable,true);
 for(const code of ['PIPELINE_COMMAND_FAILED','ENOENT','EACCES','LOCAL_LOCK_UNKNOWN','task.check-failed','task.tools-changed-create-new-task','dag.receipt-binding'])assert.equal(localFailure({code}).retryable,false);
 assert.equal(localFailure({code:'EBUSY',detail:{message:'task.artifact-changed'}}).retryable,false);
 assert.equal(automaticRecoveryDecision({phase:'processing-failed'},'a'),'stopped');
 assert.equal(automaticRecoveryDecision({phase:'processing',localRecovery:{batchSha256:'b'}},'a'),'batch-changed');
});
test('restart reuses saved task and old automatic claim; transient error resumes once, without any model call',async()=>fixture(async f=>{
 await script(f.root,`if(calls===1){console.error(JSON.stringify({status:'failed',code:'EBUSY'}));process.exit(1);}`);
 const pipeline=f.makePipeline(),auto=f.createAuto(pipeline);
 await Promise.all([auto('id'),auto('id'),auto('id')]);
 const flow=await f.wait(x=>x.phase==='components-ready');auto.close();
 assert.equal(flow.localRecovery.automaticStarts,3);assert.equal(await readFile(join(f.root,'work/calls.txt'),'utf8'),'resume\nresume\n');
 assert.equal(flow.taskDirectory,'work/skin-tasks/fixture');assert.equal(flow.localRecovery.failure,null);
}));
test('persistent transient error stops at durable budget and does not reset on Studio restart',async()=>fixture(async f=>{
 await script(f.root,`console.error(JSON.stringify({status:'failed',code:'ETIMEDOUT'}));process.exit(1);`);
 const auto=f.createAuto(f.makePipeline());await auto('id');
 const flow=await f.wait(x=>x.errorCode==='LOCAL_RECOVERY_LIMIT');auto.close();
 assert.equal(flow.localRecovery.automaticStarts,3);
 const before=await readFile(join(f.root,'work/calls.txt'),'utf8');await f.createAuto(f.makePipeline())('id');
 assert.equal(await readFile(join(f.root,'work/calls.txt'),'utf8'),before);
}));
test('quality rejection is persisted with a useful reason and never automatically retried',async()=>fixture(async f=>{
 await script(f.root,`console.error(JSON.stringify({status:'failed',message:'task.check-failed'}));process.exit(1);`);
 const auto=f.createAuto(f.makePipeline());await auto('id');
 const flow=await f.wait(x=>x.phase==='processing-failed');await auto('id');auto.close();
 assert.equal(flow.errorCode,'LOCAL_QUALITY_CHECK');assert.equal(flow.localRecovery.failure.retryable,false);
 assert.equal(await readFile(join(f.root,'work/calls.txt'),'utf8'),'resume\n');
}));
test('specific slicing failure reaches the web flow without raw logs or automatic retry',async()=>fixture(async f=>{
 await script(f.root,`console.error(JSON.stringify({status:'failed',code:'metadata.slices-override-required: item.selected'}));process.exit(1);`);
 const auto=f.createAuto(f.makePipeline());await auto('id');
 const flow=await f.wait(x=>x.phase==='processing-failed');await auto('id');auto.close();
 assert.equal(flow.errorCode,'LOCAL_QUALITY_CHECK');assert.match(flow.message,/item.selected/);assert.match(flow.message,/无需重新生成/);
 assert.equal(flow.localRecovery.failure.retryable,false);assert.equal(await readFile(join(f.root,'work/calls.txt'),'utf8'),'resume\n');
 assert.equal(localFailure({code:'metadata.slices-override-required: C:/private.png'}).message.includes('C:/private'),false);
 assert.equal(localFailure({code:'metadata.slices-override-required: item.selected',cause:{code:'task.artifact-changed'}}).code,'LOCAL_EVIDENCE_CHANGED');
}));
test('changed tools and invalid evidence stop; completed old packages remain untouched',async()=>fixture(async f=>{
 for(const [task,code] of [[{status:'incomplete',toolsMatch:false},'LOCAL_TOOLS_CHANGED'],[{status:'invalid'},'LOCAL_EVIDENCE_CHANGED']]){
  const pipeline=f.makePipeline(async()=>[task]);assert.equal((await pipeline.processAutomatically('id')).status,'stopped');assert.equal((await f.readFlow()).errorCode,code);
 }
 const before=await readFile(join(f.dir,'flow.json'));
 assert.equal((await f.makePipeline(async()=>[{status:'awaiting-visual-review',toolsMatch:false}]).processAutomatically('id')).status,'complete');
 assert.deepEqual(await readFile(join(f.dir,'flow.json')),before);
 await assert.rejects(readFile(join(f.root,'work/calls.txt')),{code:'ENOENT'});
}));
test('active task or another Studio owns processing; waiting consumes no automatic start',async()=>fixture(async f=>{
 const pipeline=f.makePipeline(),before=await readFile(join(f.dir,'flow.json'));
 for(const [directory,name] of [[f.dir,'.processing.lock'],[join(f.root,'work/skin-tasks/fixture'),'.run.lock']]){
  const release=await acquireLocalLock(directory,name);
  try{assert.equal((await pipeline.processAutomatically('id')).status,'busy');assert.deepEqual(await readFile(join(f.dir,'flow.json')),before);}finally{await release();}
 }
}));
test('restart cannot bypass a quality failure committed before the flow summary was saved',async()=>fixture(async f=>{
 const task={status:'failed-retryable',toolsMatch:true,nodes:[{id:'locate',status:'failed-retryable'}],attempts:[{node:'locate',status:'failed',failure:{code:'task.check-failed'}}]};
 assert.equal((await f.makePipeline(async()=>[task]).processAutomatically('id')).status,'stopped');
 assert.equal((await f.readFlow()).errorCode,'LOCAL_QUALITY_CHECK');
 await assert.rejects(readFile(join(f.root,'work/calls.txt')),{code:'ENOENT'});
}));
test('local busy checks are bounded and closing the coordinator cancels pending timers',async()=>fixture(async f=>{
 const timers=new Map();let count=0,key=0;
 const auto=automaticProcessing(f.root,f.generation,{processAutomatically:async()=>{count++;return {status:'busy'};}},{policy,schedule:fn=>{timers.set(++key,fn);return key;},cancel:id=>timers.delete(id)});
 await auto('id');while(timers.size){const [id,fn]=timers.entries().next().value;timers.delete(id);await fn();await new Promise(r=>setImmediate(r));}
 assert.equal(count,3);auto.close();assert.equal(timers.size,0);await auto('id');assert.equal(count,3);
}));
