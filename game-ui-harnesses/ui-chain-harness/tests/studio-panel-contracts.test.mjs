import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pipelineController} from '../src/studio/pipeline.mjs';

for(const kind of ['settings','custom'])test(kind+' panel passes the same frozen contracts through prepare, run and preview without resubmission',async()=>{
 const root=await mkdtemp(join(tmpdir(),'panel-contract-route-')),dir='work/studio/projects/fixture';
 try{
  for(const path of [dir+'/panels/old','scripts'])await mkdir(join(root,path),{recursive:true});
  const parent={id:'panel',kind,status:'needs-input',sha256:'old',plan:'work/old.json',inputs:dir+'/panels/old',skinDirectory:'work/skin',skinVersion:'skin-sha',contractsDirectory:'work/old-contracts',orientation:'landscape',text:'原始需求'};
  await writeFile(join(root,dir,'project.json'),JSON.stringify({name:'Fixture'}));
  await writeFile(join(root,dir,'flow.json'),JSON.stringify({version:'1.0',panels:[parent]}));
  await writeFile(join(root,'work/old.json'),JSON.stringify({plan:{sha256:'old',session:{context:{request:{text:'原始需求'}}}},consumer:{skinSha256:'skin-sha'}}));
  const model=kind==='settings'?'settings-model.mjs':'action-model.mjs',preview=kind==='settings'?'settings-preview.mjs':'action-preview.mjs';
  await writeFile(join(root,'scripts',model),String.raw`import {appendFile,writeFile} from 'node:fs/promises';
const args=process.argv.slice(3),contracts=args[args.indexOf('--contracts')+1];if(!args.includes('--contracts'))throw Error('CONTRACTS_MISSING');
await appendFile('work/calls.jsonl',JSON.stringify({stage:process.argv[2],contracts})+'\n');
if(process.argv[2]==='prepare'){await writeFile('work/new.json','{}');console.log(JSON.stringify({sha256:'new-plan',plan:'work/new.json'}));}
else console.log(JSON.stringify({status:'COMPILED',directory:'work/model-run'}));`);
  await writeFile(join(root,'scripts',preview),String.raw`import {appendFile} from 'node:fs/promises';
const args=process.argv.slice(2);if(!args.includes('--contracts'))throw Error('CONTRACTS_MISSING');
await appendFile('work/calls.jsonl',JSON.stringify({stage:'preview',contracts:args[args.indexOf('--contracts')+1]})+'\n');
console.error(JSON.stringify({code:'PREVIEW_TEST_STOP'}));process.exit(1);`);
  const pipeline=pipelineController(root,{resolve:()=>({directory:dir+'/batches/digest'})},{files:new Map(),items:[]},{
   verifyPanelSkin:async()=>({pack:{id:'fixture'},manifestSha256:'skin-sha'}),
   freezeContracts:async input=>{assert.equal(input.sourceDirectory,join(root,parent.contractsDirectory));await mkdir(input.directory);return input.directory;},
  });
  const panel=await pipeline.action('panel-prepare',{id:'project',panelId:parent.id,parentSha256:'old',kind,text:'补充回答'});
  assert.ok(panel.contractsDirectory.startsWith(dir+'/panels/'));assert.notEqual(panel.contractsDirectory,parent.contractsDirectory);
  const calls=async()=>JSON.parse('['+(await readFile(join(root,'work/calls.jsonl'),'utf8')).trim().split('\n').join(',')+']');
  assert.deepEqual((await calls()).map(c=>c.stage),['prepare']);
  await assert.rejects(pipeline.action('panel-start',{id:'project',panelId:panel.id,confirmed:'wrong'}),/CONFIRMATION_REQUIRED/);
  await pipeline.action('panel-start',{id:'project',panelId:panel.id,confirmed:panel.sha256});
  let finished;for(let i=0;i<200;i++){finished=JSON.parse(await readFile(join(root,dir,'flow.json')));if(finished.panels[0].status==='failed-no-retry')break;await new Promise(r=>setTimeout(r,20));}
  assert.equal(finished.panels[0].status,'failed-no-retry');
  const records=await calls();assert.deepEqual(records.map(c=>c.stage),['prepare','run','preview']);
  for(const c of records)assert.equal(c.contracts,join(root,panel.contractsDirectory));
  await assert.rejects(pipeline.action('panel-start',{id:'project',panelId:panel.id,confirmed:panel.sha256}),/CONFIRMATION_REQUIRED/);
  assert.equal((await calls()).length,3);
 }finally{await rm(root,{recursive:true,force:true});}
});
