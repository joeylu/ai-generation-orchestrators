import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pipelineController} from '../src/studio/pipeline.mjs';
import {inventoryModelChoice,inventoryModelGrid,inventoryModelRequest} from '../src/panel/inventory-model-request.mjs';

test('AI inventory accepts a full brief and grid sizes independent of the old eight sample template',()=>{
  assert.equal(inventoryModelChoice.builder,'model-inventory');assert.equal(inventoryModelChoice.minimumCapacity,1);
  assert.deepEqual(inventoryModelGrid(),{columns:5,rows:4});assert.deepEqual(inventoryModelGrid(1,1),{columns:1,rows:1});
  for(const [columns,rows]of [[32,4],[4,32],[12,12],[1,32]])assert.deepEqual(inventoryModelGrid(columns,rows),{columns,rows});
  for(const [columns,rows]of [[1,undefined],[undefined,4],[0,4],[33,1],[12,13],[32,5],[2.5,4],['5',4]])assert.throws(()=>inventoryModelGrid(columns,rows),{code:'PANEL_INVENTORY_GRID'});
  const brief='旅行仓库，包含药水和木材，数量按我的说明显示。\n'+'保持物品名称完整。'.repeat(8),request=inventoryModelRequest(brief,{columns:6,rows:4});
  assert.ok(request.text.includes(brief));assert.ok(request.text.includes('6 列 × 4 行'));assert.ok(request.text.includes('item.icon 为 null'));assert.ok(request.text.includes('空位留后'));
  const empty=inventoryModelRequest('',{columns:5,rows:4});assert.ok(empty.text.includes('必须输出空仓库 items:[]'));assert.ok(empty.text.includes('只有用户明确请求示例物品'));assert.ok(empty.text.endsWith('创建所选默认格位的空仓库，不添加示例物品。'));
});

test('new Studio inventory preparation uses the model command and clarification retains its selected grid and immutable parent',async()=>{
  const root=await mkdtemp(join(tmpdir(),'studio-inventory-ai-')),dir='work/studio/projects/fixture',skinSha256='a'.repeat(64);
  try{
    for(const sub of [dir,'scripts'])await mkdir(join(root,sub),{recursive:true});
    await writeFile(join(root,dir,'project.json'),JSON.stringify({name:'Fixture'}));
    await writeFile(join(root,dir,'flow.json'),JSON.stringify({version:'1.0',panels:[]}));
    await writeFile(join(root,'scripts/action-model.mjs'),`import {readFile,writeFile} from 'node:fs/promises';import {dirname,join} from 'node:path';import {createHash} from 'node:crypto';
if(process.argv[2]!=='prepare')throw Error('UNEXPECTED_COMPUTE');const args=process.argv.slice(3),value=k=>args[args.indexOf(k)+1];if(value('--preset')!=='inventory')throw Error('WRONG_PRESET');
const request=JSON.parse(await readFile(value('--request'))),sha256=createHash('sha256').update(JSON.stringify({request,columns:value('--columns'),rows:value('--rows')})).digest('hex'),path=join(dirname(value('--request')),'fixture-model-plan.json');
await writeFile('work/prepared-inventory.json',JSON.stringify({request,columns:value('--columns'),rows:value('--rows'),orientation:value('--orientation')}));await writeFile(path,JSON.stringify({plan:{sha256,session:{context:{request}}},consumer:{skinSha256:'${skinSha256}'}}));console.log(JSON.stringify({status:'PREPARED',sha256,plan:path,modelCalls:0}));`);
    const pipeline=pipelineController(root,{resolve:()=>({directory:dir+'/batches/digest'})},{files:new Map(),items:[]},{
      resolveComponentSkin:async()=>({pack:{id:'fixture'},packDirectory:join(root,'work/skin'),manifestSha256:skinSha256}),
      verifyPanelSkin:async()=>({pack:{id:'fixture'},manifestSha256:skinSha256}),freezeContracts:async()=>null,
    });
    await assert.rejects(pipeline.action('panel-prepare',{id:'fixture',kind:'inventory',text:'',orientation:'portrait',columns:2,rows:0}),{code:'PANEL_INVENTORY_GRID'});
    for(const grid of [{columns:33,rows:1},{columns:12,rows:13},{columns:32,rows:5}])await assert.rejects(pipeline.action('panel-prepare',{id:'fixture',kind:'inventory',text:'',orientation:'portrait',...grid}),{code:'PANEL_INVENTORY_GRID'});
    const brief='为旅行游戏设计仓库，药水12瓶，木材30份。\n'+'保留完整文字。'.repeat(8);
    const job=await pipeline.action('panel-prepare',{id:'fixture',kind:'inventory',text:brief,orientation:'portrait',columns:6,rows:4});
    assert.equal(job.builder,'model-inventory');assert.equal(job.status,'prepared');assert.deepEqual(job.grid,{columns:6,rows:4});assert.equal(job.text,brief);assert.equal(job.runDirectory,undefined);
    const request=JSON.parse(await readFile(join(root,'work/prepared-inventory.json')));assert.equal(request.columns,'6');assert.equal(request.rows,'4');assert.equal(request.orientation,'portrait');assert.ok(request.request.text.includes(brief));
    await assert.rejects(pipeline.action('panel-start',{id:'fixture',panelId:job.id,confirmed:'stale'}),/PANEL_CONFIRMATION_REQUIRED/);
    job.status='needs-input';job.questions=[{question:'是否仅保留名称与数量？'}];await writeFile(join(root,dir,'flow.json'),JSON.stringify({version:'1.0',panels:[job]}));
    await assert.rejects(pipeline.action('panel-prepare',{id:'fixture',kind:'inventory',panelId:job.id,parentSha256:job.sha256,text:'保留',columns:5,rows:4}),/PANEL_CLARIFICATION_STALE/);
    const next=await pipeline.action('panel-prepare',{id:'fixture',kind:'inventory',panelId:job.id,parentSha256:job.sha256,text:'保留名称与数量'});
    assert.equal(next.id,job.id);assert.deepEqual(next.grid,job.grid);assert.equal(next.orientation,'portrait');assert.deepEqual(next.history,[job]);assert.equal(next.builder,'model-inventory');assert.notEqual(next.inputs,job.inputs);
    const followup=JSON.parse(await readFile(join(root,'work/prepared-inventory.json')));assert.ok(followup.request.text.includes(brief));assert.ok(followup.request.text.includes(job.questions[0].question));assert.ok(followup.request.text.includes('保留名称与数量'));
  }finally{await rm(root,{recursive:true,force:true});}
});
