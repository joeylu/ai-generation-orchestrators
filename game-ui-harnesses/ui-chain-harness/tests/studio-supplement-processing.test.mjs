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
