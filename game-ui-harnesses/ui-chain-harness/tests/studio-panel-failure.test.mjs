import test from 'node:test';
import assert from 'node:assert/strict';
import {panelFailure} from '../src/studio/panel-failure.mjs';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pipelineController} from '../src/studio/pipeline.mjs';

test('Studio explains rejected geometry, skin and unsupported semantics without suggesting automatic retry',()=>{
 for(const [code,text] of [['panel.canvas-capacity','画布'],['panel.overflow','画布'],['skin.minimum','九宫格'],['skin.text','文字'],['panel.action-grouping','结构'],['CONSUMER_CHANGED_REPLAN','重新准备'],['inventory.geometry','所选行列'],['panel.inventory-icon','AI仓库方案']]){
  const failure=panelFailure(Error(code));assert.equal(failure.code,code);assert.ok(failure.message.includes(text));assert.match(failure.message,/未自动重试/);
  if(code.includes('inventory'))assert.doesNotMatch(failure.message,/固定 10 列|未.*调用模型/);
 }
});

test('Studio never publishes raw diagnostic paths or process output as a check identifier',()=>{
 const failure=panelFailure(Error('private process output C:\\Users\\fixture?token=secret'));
 assert.equal(failure.code,'PANEL_OPERATION_FAILED');assert.doesNotMatch(failure.message,/fixture|token|secret/);
});

test('a rejected custom layout keeps its diagnostic and stops after the single authorized invocation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-layout-failure-')),dir='work/studio/projects/fixture';
 try{
  for(const sub of [dir,'scripts'])await mkdir(join(root,sub),{recursive:true});
  const panel={id:'panel',kind:'custom',status:'prepared',sha256:'immutable-plan',plan:'work/plan.json',inputs:dir+'/panels/input',skinDirectory:'work/skin',skinVersion:'skin-version',orientation:'landscape',canvasSelection:true};
  await writeFile(join(root,dir,'flow.json'),JSON.stringify({version:'1.0',panels:[panel]}));
  await writeFile(join(root,'scripts/action-model.mjs'),`import {appendFile} from 'node:fs/promises';
await appendFile('work/invocations.txt','one\\n');console.error(JSON.stringify({status:'FAILED',code:'panel.action-layout-width'}));process.exitCode=1;`);
  const pipeline=pipelineController(root,{resolve:()=>({directory:dir+'/batches/digest'})},{files:new Map(),items:[]},{verifyPanelSkin:async()=>({pack:{id:'fixture'},manifestSha256:'skin-version'})});
  assert.equal((await pipeline.action('panel-start',{id:'project',panelId:'panel',confirmed:'immutable-plan'})).status,'started');
  let result;
  for(let i=0;i<100;i++){
   await new Promise(r=>setTimeout(r,25));result=JSON.parse(await readFile(join(root,dir,'flow.json'))).panels[0];
   if(result.status==='failed-no-retry')break;
  }
  assert.equal(result.status,'failed-no-retry');assert.equal(result.code,'panel.action-layout-width');
  assert.match(result.message,/安全范围/);assert.match(result.message,/未自动重试/);assert.equal(result.artifact,undefined);
  assert.equal(await readFile(join(root,'work/invocations.txt'),'utf8'),'one\n');
  await assert.rejects(()=>pipeline.action('panel-start',{id:'project',panelId:'panel',confirmed:'immutable-plan'}));
 }finally{await rm(root,{recursive:true,force:true});}
});
