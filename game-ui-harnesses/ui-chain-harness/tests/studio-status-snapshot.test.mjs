import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import fsPromises from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pipelineController} from '../src/studio/pipeline.mjs';
import {hash} from '../src/skins/package.mjs';

const project='work/studio/projects/fixture';
const studioFiles=['index.html','studio.mjs','project.mjs','project-ui.mjs','tasks-ui.mjs','generation-ui.mjs','history-ui.mjs','pipeline-ui.mjs','panel-completion.mjs','confirm-ui.mjs','progress.mjs','progress-ui.mjs','studio.css','component-canvas.html','component-canvas.mjs','material-canvas.mjs','canvas-contrast.mjs','canvas-resolution.mjs','panel-size.html','panel-size.css','panel-copy.html','panel-copy.css'];
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function until(check){for(let i=0;i<200;i++){const value=await check();if(value)return value;await new Promise(r=>setTimeout(r,10));}throw Error('OFFLINE_STATUS_FIXTURE_TIMEOUT');}

async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'studio-status-snapshot-'));
 for(const sub of [project,'work/preview','work/run','scripts','src/studio'])await mkdir(join(root,sub),{recursive:true});
 for(const name of studioFiles)await writeFile(join(root,'src/studio',name),'offline fixture');
 const preview=Buffer.from('<h1>Offline status fixture</h1>');
 await writeFile(join(root,'work/preview/preview.html'),preview);
 await writeFile(join(root,'work/preview/report.json'),JSON.stringify({kind:'action-panel-preview',files:[{file:'preview.html',sha256:hash(preview)}]}));
 await writeFile(join(root,project,'project.json'),JSON.stringify({name:'Offline fixture'}));
 const panel={id:'panel',kind:'custom',status:'prepared',sha256:'immutable-plan',plan:'work/plan.json',inputs:project+'/panels/input',skinDirectory:'work/skin',skinVersion:'fixture-skin',orientation:'landscape',canvasSelection:true};
 await writeFile(join(root,'work/plan.json'),JSON.stringify({source:'offline-test-double',sha256:panel.sha256}));
 const save=job=>writeFile(join(root,project,'flow.json'),JSON.stringify({version:'1.0',panels:[job]}));await save(panel);
 return {root,panel,save,snapshot:{files:new Map([['catalog.json',Buffer.from('{"items":[]}')]]),items:[]},options:{verifyPanelSkin:async()=>({pack:{id:'offline-fixture'},manifestSha256:panel.skinVersion})}};
}

// Keep these fixtures serial: the load-window case temporarily patches the
// builtin read binding and always restores it in finally before the next test.
for(const window of ['asynchronous enrichment','the initial flow read'])test('one status snapshot never calls a normally completed panel interrupted across '+window,{concurrency:false},async()=>{
 const f=await fixture(),entered=deferred(),resumeStatus=deferred();let blockNext=true,pending,restoreRead;
 try{
  // This local double owns its fixture receipt and waits for an explicit test
  // barrier. It never imports a provider, model SDK, network or real plan.
  await writeFile(join(f.root,'scripts/action-model.mjs'),`import {appendFile,writeFile,access} from 'node:fs/promises';
if(process.argv[2]!=='run'||process.argv[process.argv.indexOf('--authorize')+1]!=='immutable-plan')throw Error('FIXTURE_AUTHORIZATION');
await appendFile('work/invocations.txt','once\\n');await writeFile('work/run/receipt.json',JSON.stringify({source:'offline-test-double',invocationCount:1,automaticRetries:0}));
while(true){try{await access('work/release-command');break;}catch(e){if(e.code!=='ENOENT')throw e;await new Promise(r=>setTimeout(r,10));}}
console.log(JSON.stringify({status:'COMPILED',directory:'work/run'}));`);
  await writeFile(join(f.root,'scripts/action-preview.mjs'),`if(process.argv.includes('--generate'))throw Error('NO_GENERATION');console.log('work/preview');`);
  const generation={resolve:()=>({directory:project+'/batches/digest'}),async action(action){assert.equal(action,'status');if(window==='asynchronous enrichment'&&blockNext){blockNext=false;entered.resolve();await resumeStatus.promise;}return {nodes:[]};}},pipeline=pipelineController(f.root,generation,f.snapshot,f.options);
  assert.equal((await pipeline.action('panel-start',{id:'project',panelId:f.panel.id,confirmed:f.panel.sha256})).status,'started');
  if(window==='the initial flow read'){
   const realRead=fsPromises.readFile,flowFile=join(f.root,project,'flow.json');
   // Hold actual bytes read from the running flow until the real controller
   // finishes its fixture job. Later reads still see the new committed file.
   fsPromises.readFile=async(...args)=>{const bytes=await realRead(...args);if(blockNext&&resolve(String(args[0]))===flowFile){blockNext=false;entered.resolve();await resumeStatus.promise;}return bytes;};
   syncBuiltinESMExports();restoreRead=()=>{fsPromises.readFile=realRead;syncBuiltinESMExports();};
  }
  pending=pipeline.action('status',{id:'project'});await entered.promise;
  const protectedFiles=['work/plan.json','work/preview/preview.html','work/preview/report.json'];const original=await Promise.all(protectedFiles.map(path=>readFile(join(f.root,path))));
  await writeFile(join(f.root,'work/release-command'),'release');
  // A second real controller read sees the verified publication and the local
  // owner released while the first request still holds its earlier flow.
  const completed=await until(async()=>{const status=await pipeline.action('status',{id:'project'});return !status.busy&&status.panels[0].status==='ready'?status:null;});
  assert.equal(completed.panels[0].artifact.id,'panel-panel');
  assert.equal(await readFile(join(f.root,'work/invocations.txt'),'utf8'),'once\n');const receipt=await readFile(join(f.root,'work/run/receipt.json'));
  resumeStatus.resolve();const captured=await pending;
  assert.deepEqual({busy:captured.busy,status:captured.panels[0].status},{busy:true,status:'running'});
  const next=await pipeline.action('status',{id:'project'});assert.equal(next.busy,false);assert.equal(next.panels[0].status,'ready');assert.equal(next.panels[0].artifact.id,'panel-panel');
  assert.deepEqual(await readFile(join(f.root,'work/run/receipt.json')),receipt);assert.equal(await readFile(join(f.root,'work/invocations.txt'),'utf8'),'once\n');
  for(let i=0;i<protectedFiles.length;i++)assert.deepEqual(await readFile(join(f.root,protectedFiles[i])),original[i]);
 }finally{resumeStatus.resolve();await pending?.catch(()=>{});restoreRead?.();await rm(f.root,{recursive:true,force:true});}
});

test('a true orphan stays interrupted and existing terminal panel states survive a read without compute or writes',{concurrency:false},async()=>{
 const f=await fixture();
 try{
  const generation={resolve:()=>({directory:project+'/batches/digest'}),async action(action){assert.equal(action,'status');return {nodes:[]};}};
  const orphan={...f.panel,status:'running',stage:'planning'};await f.save(orphan);const before=await readFile(join(f.root,project,'flow.json'));
  const controller=()=>pipelineController(f.root,generation,f.snapshot,f.options),status=await controller().action('status',{id:'project'});assert.equal(status.busy,false);assert.equal(status.panels[0].status,'interrupted-no-retry');assert.deepEqual(await readFile(join(f.root,project,'flow.json')),before);
  for(const terminal of ['ready','needs-input','failed-no-retry']){
   const job={...f.panel,status:terminal,...(terminal==='ready'?{artifact:{id:'panel-panel',name:'Offline panel',type:'panel',directory:'work/preview'}}:{})};await f.save(job);const bytes=await readFile(join(f.root,project,'flow.json')),result=await controller().action('status',{id:'project'});assert.equal(result.panels[0].status,terminal);assert.equal(result.busy,false);assert.deepEqual(await readFile(join(f.root,project,'flow.json')),bytes);
  }
  await assert.rejects(readFile(join(f.root,'work/invocations.txt')),{code:'ENOENT'});
 }finally{await rm(f.root,{recursive:true,force:true});}
});
