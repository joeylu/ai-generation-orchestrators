import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pipelineController} from '../src/studio/pipeline.mjs';
import {receivedSourcesRevision} from '../src/studio/component-batch.mjs';

test('a confirmed replacement source starts a new deterministic task instead of resuming the frozen bad atlas',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-replaced-source-')),project='work/studio/projects/fixture',task='work/skin-tasks/old';
 try{
  for(const dir of [project,task+'/input','scripts','configs'])await mkdir(join(root,dir),{recursive:true});
  await writeFile(join(root,project,'project.json'),JSON.stringify({name:'Fixture'}));
  await writeFile(join(root,'configs/studio-metadata-profile.json'),'{}');
  const oldNodes=['S01','S02','S03','S04','S05'].map((sheetId,i)=>({sheetId,status:'received',planSha256:String(i+1).repeat(64),rawSha256:'a'.repeat(64)}));
  const oldBytes=Buffer.from(JSON.stringify({nodes:oldNodes}));await writeFile(join(root,task,'input/batch-intake.json'),oldBytes);
  const nodes=oldNodes.map(n=>n.sheetId==='S05'?{...n,planSha256:'b'.repeat(64),rawSha256:'c'.repeat(64)}:n),batchSha256='d'.repeat(64);
  const initial={version:'1.0',phase:'processing-failed',panels:[],taskDirectory:task,localRecovery:{batchSha256,automaticStarts:3,failure:{retryable:false}}};
  const flowFile=join(root,project,'flow.json');await writeFile(flowFile,JSON.stringify(initial));
  await writeFile(join(root,'scripts/skin-task.mjs'),`import {appendFile} from 'node:fs/promises';await appendFile('work/commands.txt',process.argv[2]+'\\n');console.log(JSON.stringify({directory:'work/skin-tasks/replacement'}));`);
  const generation={resolve:()=>({directory:project+'/batches/'+batchSha256,batchSha256}),action:async()=>({nodes})};
  const inspectTasks=async()=>[{status:'failed-retryable',toolsMatch:true,nodes:[{id:'postprocess',status:'failed-retryable'}],attempts:[{node:'postprocess',status:'failed',failure:{code:'skin.material-atlas'}}]}];
  const pipeline=pipelineController(root,generation,{files:new Map(),items:[]},{inspectTasks});
  assert.equal((await pipeline.processAutomatically('fixture')).status,'started');
  let flow;for(let i=0;i<100;i++){await new Promise(resolve=>setTimeout(resolve,20));flow=JSON.parse(await readFile(flowFile));if(flow.phase!=='processing')break;}
  assert.equal(flow.phase,'components-ready');assert.equal(flow.taskDirectory,'work/skin-tasks/replacement');
  assert.equal(flow.processingSourcesRevision,receivedSourcesRevision({nodes}));
  assert.equal(flow.localRecovery.automaticStarts,1);
  assert.equal(await readFile(join(root,'work/commands.txt'),'utf8'),'create\nresume\n');
  assert.deepEqual(await readFile(join(root,task,'input/batch-intake.json')),oldBytes);
  await writeFile(flowFile,JSON.stringify(initial));nodes.splice(0,nodes.length,...oldNodes);
  assert.equal((await pipeline.processAutomatically('fixture')).status,'stopped');
  assert.equal(await readFile(join(root,'work/commands.txt'),'utf8'),'create\nresume\n');
 }finally{await rm(root,{recursive:true,force:true});}
});

async function completedFixture(t){
 const root=await mkdtemp(join(tmpdir(),'studio-completed-replacement-')),project='work/studio/projects/fixture',task='work/skin-tasks/old',replacement='work/skin-tasks/replacement',batchSha256='d'.repeat(64);
 t.after(()=>rm(root,{recursive:true,force:true}));
 for(const dir of [project,task+'/input',replacement,'scripts','configs'])await mkdir(join(root,dir),{recursive:true});
 await writeFile(join(root,project,'project.json'),JSON.stringify({name:'Fixture'}));await writeFile(join(root,'configs/studio-metadata-profile.json'),'{}');
 const oldNodes=['S01','S02','S03','S04','S05'].map((sheetId,i)=>({sheetId,status:'received',inspection:sheetId==='S05'?'rejected':'pixel-gates-passed-awaiting-visual-review',planSha256:String(i+1).repeat(64),rawSha256:'a'.repeat(64)}));
 const oldBytes=Buffer.from(JSON.stringify({nodes:oldNodes}));await writeFile(join(root,task,'input/batch-intake.json'),oldBytes);
 const nodes=oldNodes.map(n=>n.sheetId==='S05'?{...n,inspection:'pixel-gates-passed-awaiting-visual-review',planSha256:'b'.repeat(64),rawSha256:'c'.repeat(64)}:n);
 const oldRevision=receivedSourcesRevision({nodes:oldNodes}),revision=receivedSourcesRevision({nodes});
 const componentRuntime={file:'work/upgrades/old.json',sha256:'e'.repeat(64)},componentMotion={style:'refined',skinSha256:'f'.repeat(64)};
 const panels=[{id:'frozen-panel',status:'ready',skinDirectory:'work/old-skin',skinVersion:'f'.repeat(64),sha256:'9'.repeat(64)}];
 const initial={version:'1.0',phase:'components-ready',panels,taskDirectory:task,processingSourcesRevision:oldRevision,componentRuntime,componentMotion,localRecovery:{batchSha256,sourceRevision:oldRevision,automaticStarts:1,failure:null}};
 const flowFile=join(root,project,'flow.json');await writeFile(flowFile,JSON.stringify(initial));
 const delivery=Buffer.from('immutable old package and runtime selection');await writeFile(join(root,task,'delivery.bin'),delivery);
 await writeFile(join(root,'scripts/skin-task.mjs'),`import {readFile,writeFile,appendFile} from 'node:fs/promises';
const action=process.argv[2];await appendFile('work/commands.txt',action+'\\n');
if(action==='create')console.log(JSON.stringify({directory:${JSON.stringify(replacement)}}));
else {
 const flow=JSON.parse(await readFile(${JSON.stringify(project+'/flow.json')}));
 if(flow.taskDirectory!==${JSON.stringify(task)}||flow.pendingComponentBuild?.taskDirectory!==${JSON.stringify(replacement)}||JSON.stringify(flow.componentRuntime)!==${JSON.stringify(JSON.stringify(componentRuntime))}||JSON.stringify(flow.componentMotion)!==${JSON.stringify(JSON.stringify(componentMotion))}||JSON.stringify(flow.panels)!==${JSON.stringify(JSON.stringify(panels))})throw Error('OLD_SELECTION_CHANGED_BEFORE_CHECK');
 await writeFile('work/resume-started','ready');
 for(let i=0;;i++){try{await readFile('work/release-resume');break;}catch{if(i>1000)throw Error('FIXTURE_TIMEOUT');await new Promise(r=>setTimeout(r,10));}}
 const mode=await readFile('work/mode.txt','utf8');
 if(mode==='fail'){console.error(JSON.stringify({code:'metadata.slices-override-required: surface.panel'}));process.exitCode=1;}
 else {await writeFile('work/replacement-completed','ready');console.log(JSON.stringify({status:'awaiting-visual-review',directory:${JSON.stringify(replacement)}}));}
}`);
 const generation={resolve:()=>({directory:project+'/batches/'+batchSha256,batchSha256}),action:async()=>({nodes})};
 const inspectTasks=async(_root,tasks)=>tasks.map(({directory})=>directory===task?{status:'awaiting-visual-review',toolsMatch:false}:{status:'failed-retryable',toolsMatch:true,nodes:[{id:'postprocess',status:'failed-retryable'}],attempts:[{node:'postprocess',status:'failed',failure:{code:'metadata.slices-override-required: surface.panel'}}]});
 const pipeline=()=>pipelineController(root,generation,{files:new Map(),items:[]},{inspectTasks});
 const wait=async predicate=>{for(let i=0;i<300;i++){const flow=JSON.parse(await readFile(flowFile));if(await predicate(flow))return flow;await new Promise(r=>setTimeout(r,10));}throw Error('FLOW_TIMEOUT');};
 return {root,task,replacement,flowFile,initial,revision,oldBytes,delivery,pipeline,wait};
}

test('a completed checked skin uses the new confirmed S05 only after its separate candidate passes, preserving old runtime, motion and panel bindings in history',async t=>{
 const f=await completedFixture(t);await writeFile(join(f.root,'work/mode.txt'),'pass');
 assert.equal((await f.pipeline().processAutomatically('fixture')).status,'started');
 const pending=await f.wait(flow=>Boolean(flow.pendingComponentBuild));
 assert.equal(pending.taskDirectory,f.initial.taskDirectory);assert.deepEqual(pending.componentRuntime,f.initial.componentRuntime);assert.deepEqual(pending.componentMotion,f.initial.componentMotion);
 assert.equal(pending.processingSourcesRevision,f.initial.processingSourcesRevision);assert.deepEqual(pending.panels,f.initial.panels);
 await writeFile(join(f.root,'work/release-resume'),'ready');
 const flow=await f.wait(flow=>flow.phase==='components-ready');
 assert.equal(flow.taskDirectory,f.replacement);assert.equal(flow.processingSourcesRevision,f.revision);assert.equal(flow.pendingComponentBuild,undefined);
 assert.equal(flow.componentRuntime,undefined);assert.equal(flow.componentMotion,undefined);assert.deepEqual(flow.panels,f.initial.panels);
 assert.deepEqual(flow.componentHistory,[{taskDirectory:f.task,processingSourcesRevision:f.initial.processingSourcesRevision,componentRuntime:f.initial.componentRuntime,componentMotion:f.initial.componentMotion}]);
 assert.deepEqual(await readFile(join(f.root,f.task,'input/batch-intake.json')),f.oldBytes);assert.deepEqual(await readFile(join(f.root,f.task,'delivery.bin')),f.delivery);
 assert.equal(await readFile(join(f.root,'work/commands.txt'),'utf8'),'create\nresume\n');
});

test('a failed replacement retains the previous usable component selection, and manual restart resumes the pending candidate instead of generating or discarding the old package',async t=>{
 const f=await completedFixture(t);await writeFile(join(f.root,'work/mode.txt'),'fail');await writeFile(join(f.root,'work/release-resume'),'ready');
 assert.equal((await f.pipeline().processAutomatically('fixture')).status,'started');
 const failed=await f.wait(flow=>flow.phase==='processing-failed');
 assert.equal(failed.errorCode,'LOCAL_QUALITY_CHECK');assert.equal(failed.taskDirectory,f.task);assert.equal(failed.pendingComponentBuild.taskDirectory,f.replacement);
 assert.deepEqual(failed.componentRuntime,f.initial.componentRuntime);assert.deepEqual(failed.componentMotion,f.initial.componentMotion);assert.deepEqual(failed.panels,f.initial.panels);assert.equal(failed.componentHistory,undefined);
 assert.equal((await f.pipeline().processAutomatically('fixture')).status,'stopped');assert.equal(await readFile(join(f.root,'work/commands.txt'),'utf8'),'create\nresume\n');
 await writeFile(join(f.root,'work/mode.txt'),'pass');
 assert.equal((await f.pipeline().action('process',{id:'fixture',allowCandidate:true})).status,'started');
 const completed=await f.wait(flow=>flow.phase==='components-ready');assert.equal(completed.taskDirectory,f.replacement);assert.deepEqual(completed.panels,f.initial.panels);
 assert.equal(await readFile(join(f.root,'work/commands.txt'),'utf8'),'create\nresume\nresume\n');assert.deepEqual(await readFile(join(f.root,f.task,'delivery.bin')),f.delivery);
});

test('restart promotes an already checked pending replacement without rerunning a completed DAG or creating another task',async t=>{
 const f=await completedFixture(t),flow={...f.initial,phase:'processing',pendingComponentBuild:{taskDirectory:f.replacement,sourceRevision:f.revision},localRecovery:{...f.initial.localRecovery,sourceRevision:f.revision}};
 await writeFile(f.flowFile,JSON.stringify(flow));
 const generation={resolve:()=>({directory:'work/studio/projects/fixture/batches/'+flow.localRecovery.batchSha256,batchSha256:flow.localRecovery.batchSha256}),action:async()=>({nodes:['S01','S02','S03','S04','S05'].map((sheetId,i)=>({sheetId,status:'received',planSha256:sheetId==='S05'?'b'.repeat(64):String(i+1).repeat(64),rawSha256:sheetId==='S05'?'c'.repeat(64):'a'.repeat(64)}))})};
 const pipeline=pipelineController(f.root,generation,{files:new Map(),items:[]},{inspectTasks:async()=>[{status:'awaiting-visual-review',toolsMatch:false}]});
 assert.equal((await pipeline.processAutomatically('fixture')).status,'started');
 const completed=await f.wait(flow=>flow.phase==='components-ready');assert.equal(completed.taskDirectory,f.replacement);assert.equal(completed.componentHistory.length,1);
 await assert.rejects(()=>readFile(join(f.root,'work/commands.txt')),error=>error.code==='ENOENT');assert.deepEqual(await readFile(join(f.root,f.task,'delivery.bin')),f.delivery);
});
