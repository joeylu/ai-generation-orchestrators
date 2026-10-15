import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pipelineController} from '../src/studio/pipeline.mjs';
test('project workspace blocks processing incomplete batches and rejects invalid panel requests without compute',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-pipeline-'));
 try{
  const dir='work/studio/projects/fixture';await mkdir(join(root,dir),{recursive:true});await writeFile(join(root,dir,'project.json'),JSON.stringify({name:'Fixture'}));
  const generation={resolve(id){assert.equal(id,'known');return {directory:dir+'/batches/digest'};},async action(action){assert.equal(action,'status');return {nodes:[{status:'indeterminate'}]};}};
  const pipeline=pipelineController(root,generation,{files:new Map(),items:[]});
  assert.equal((await pipeline.action('status',{id:'known'})).name,'Fixture');
  await assert.rejects(pipeline.action('process',{id:'known'}),/BATCH_NOT_RECEIVED/);
  assert.equal((await pipeline.action('status',{id:'known'})).busy,false);
  await assert.rejects(pipeline.action('panel-prepare',{id:'known',kind:'unsupported',text:'x'}),/REQUEST_INVALID/);
  await assert.rejects(pipeline.action('panel-prepare',{id:'known',kind:'custom',text:'  '}),/REQUEST_INVALID/);
  await assert.rejects(pipeline.action('panel-start',{id:'known',panelId:'missing',confirmed:'fake'}),/CONFIRMATION_REQUIRED/);
  assert.equal((await pipeline.action('status',{id:'known'})).busy,false);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('workspace refuses out-of-work paths even if an internal registration is corrupt',async()=>{
 const pipeline=pipelineController(process.cwd(),{resolve:()=>({directory:'../outside/batches/digest'})},{files:new Map(),items:[]});
 await assert.rejects(pipeline.action('status',{id:'x'}),/PIPELINE_PATH/);
});
test('received batches actually launch the fixed deterministic CLI and persist its directory before resume',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-command-'));
 try{
  const dir='work/studio/projects/fixture';
  for(const sub of [dir,'scripts','configs'])await mkdir(join(root,sub),{recursive:true});
  await writeFile(join(root,dir,'project.json'),JSON.stringify({name:'Fixture'}));
  await writeFile(join(root,'configs/studio-metadata-profile.json'),'{}');
  await writeFile(join(root,'scripts/skin-task.mjs'),`import {readFile,appendFile} from 'node:fs/promises';
const action=process.argv[2];
if(action==='resume'){const f=JSON.parse(await readFile('work/studio/projects/fixture/flow.json'));if(f.taskDirectory!=='work/skin-tasks/fixture')throw Error('DIRECTORY_NOT_SAVED');}
await appendFile('work/commands.txt',action+'\\n');console.log(JSON.stringify({directory:'work/skin-tasks/fixture'}));`);
  const pipeline=pipelineController(root,{resolve:()=>({directory:dir+'/batches/digest',batchSha256:'digest'}),action:async()=>({nodes:Array.from({length:4},()=>({status:'received'}))})},{files:new Map(),items:[]});
  assert.equal((await pipeline.action('process',{id:'x'})).status,'started');
  let flow;
  for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,30));flow=JSON.parse(await readFile(join(root,dir,'flow.json')));if(flow.phase!=='processing')break;}
  assert.equal(flow.phase,'components-ready');assert.equal(await readFile(join(root,'work/commands.txt'),'utf8'),'create\nresume\n');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('clarification revises the same legacy panel, pins its skin and retains immutable attempts',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-clarify-')),dir='work/studio/projects/fixture',skinVersion='a'.repeat(64);
 try{
  for(const sub of [dir+'/panels/original','scripts'])await mkdir(join(root,sub),{recursive:true});
  await writeFile(join(root,dir,'project.json'),JSON.stringify({name:'Fixture'}));
  const original={id:'original',kind:'settings',status:'needs-input',sha256:'old-plan',inputs:dir+'/panels/original',plan:'work/old-plan.json',skinDirectory:'work/frozen-skin',skinVersion,orientation:'portrait',text:'原始设置需求',questions:[{question:'是否接受程序布局？'}],runDirectory:'work/old-run'};
  const request=JSON.stringify({requestVersion:'0.1',text:'原始设置需求及固定约束'});
  await writeFile(join(root,original.inputs,'request.json'),request);
  await writeFile(join(root,original.plan),JSON.stringify({plan:{sha256:original.sha256,session:{context:{request:JSON.parse(request)}}},consumer:{skinSha256:skinVersion}}));
  const save=()=>writeFile(join(root,dir,'flow.json'),JSON.stringify({version:'1.0',panels:[original]}));await save();
  await writeFile(join(root,'scripts/settings-model.mjs'),`import {readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
if(process.argv[2]!=='prepare')throw Error('NO_COMPUTE');const args=process.argv.slice(3);if(args.includes('--preset'))throw Error('LEGACY_PRESET_CHANGED');if(args[args.indexOf('--orientation')+1]!=='portrait')throw Error('ORIENTATION_NOT_BOUND');
const request=await readFile(args[args.indexOf('--request')+1]);await writeFile('work/prepared-request.json',request);console.log(JSON.stringify({sha256:createHash('sha256').update(request).digest('hex'),plan:'work/new-plan.json'}));`);
  const options={verifyPanelSkin:async path=>{assert.equal(path,join(root,'work/frozen-skin'));return {pack:{id:'fixture'},manifestSha256:skinVersion};}};
  const pipeline=pipelineController(root,{resolve:()=>({directory:dir+'/batches/digest'})},{files:new Map(),items:[]},options);
  const data={id:'project',panelId:'original',parentSha256:'old-plan',kind:'settings',text:'接受程序布局，标题改为偏好设置'};
  for(const change of [{panelId:'missing'},{parentSha256:'stale'},{kind:'custom'},{text:' '}])await assert.rejects(pipeline.action('panel-prepare',{...data,...change}));
  const next=await pipeline.action('panel-prepare',data),flow=JSON.parse(await readFile(join(root,dir,'flow.json'))),prepared=JSON.parse(await readFile(join(root,'work/prepared-request.json')));
  assert.equal(next.id,original.id);assert.equal(next.revision,2);assert.equal(next.orientation,'portrait');assert.equal(next.skinVersion,skinVersion);assert.equal(flow.panels.length,1);assert.deepEqual(next.history,[original]);assert.notEqual(next.inputs,original.inputs);assert.equal(next.status,'prepared');assert.equal(next.questions,undefined);
  for(const text of ['原始设置需求及固定约束','是否接受程序布局？',data.text])assert.ok(prepared.text.includes(text));
  assert.equal(await readFile(join(root,original.inputs,'request.json'),'utf8'),request);
  await assert.rejects(pipeline.action('panel-prepare',data),/CLARIFICATION_STALE/);
  await assert.rejects(pipeline.action('panel-start',{id:'project',panelId:original.id,confirmed:original.sha256}),/CONFIRMATION_REQUIRED/);
  await save();const changed=pipelineController(root,{resolve:()=>({directory:dir+'/batches/digest'})},{files:new Map(),items:[]},{verifyPanelSkin:async()=>({pack:{id:'fixture'},manifestSha256:'changed'})});
  await assert.rejects(changed.action('panel-prepare',data),/SKIN_CHANGED/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('panel recycle bin persists, restores without compute and blocks stale or running actions',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-trash-')),dir='work/studio/projects/fixture';
 try{
  await mkdir(join(root,dir),{recursive:true});await writeFile(join(root,dir,'project.json'),JSON.stringify({name:'Fixture'}));
  const panels=['ready','prepared','needs-input','failed-no-retry','running'].map(status=>({id:status,status,kind:'settings',sha256:status+'-sha',text:'保留需求'}));
  await writeFile(join(root,dir,'flow.json'),JSON.stringify({version:'1.0',panels}));await writeFile(join(root,dir,'original.txt'),'immutable source');
  const make=()=>pipelineController(root,{resolve:()=>({directory:dir+'/batches/digest'}),action:async()=>({nodes:[]})},{files:new Map(),items:[]}),pipeline=make();
  for(const original of panels.filter(p=>p.status!=='running')){
   const data={id:'project',panelId:original.id,expectedSha256:original.sha256};
   await assert.rejects(pipeline.action('panel-delete',{...data,expectedSha256:'stale'}),/PANEL_CHANGED/);
   assert.equal((await pipeline.action('panel-delete',data)).status,'deleted');
   const deleted=(await make().action('status',{id:'project'})).panels.find(p=>p.id===original.id);assert.ok(deleted.deletedAt);assert.equal(deleted.status,original.status);
   assert.equal((await pipeline.action('panel-delete',data)).status,'deleted');
   await assert.rejects(pipeline.action('panel-start',{id:'project',panelId:original.id,confirmed:original.sha256}),/CONFIRMATION_REQUIRED/);
   if(original.status==='needs-input')await assert.rejects(pipeline.action('panel-prepare',{id:'project',panelId:original.id,parentSha256:original.sha256,kind:'settings',text:'接受',orientation:'portrait'}),/CLARIFICATION_STALE/);
   assert.equal((await make().action('panel-restore',data)).status,'restored');
   const restored=JSON.parse(await readFile(join(root,dir,'flow.json'))).panels.find(p=>p.id===original.id);assert.deepEqual(restored,original);
  }
  await assert.rejects(pipeline.action('panel-delete',{id:'project',panelId:'running',expectedSha256:'running-sha'}),/PANEL_RUNNING/);
  await assert.rejects(pipeline.action('panel-delete',{id:'project',panelId:'missing',expectedSha256:'x'}),/PANEL_NOT_FOUND/);
  assert.equal(await readFile(join(root,dir,'original.txt'),'utf8'),'immutable source');
 }finally{await rm(root,{recursive:true,force:true});}
});
