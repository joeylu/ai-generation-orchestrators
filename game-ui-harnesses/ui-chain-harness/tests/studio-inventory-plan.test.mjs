import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareInventoryPlan,verifyInventoryPlan,inventoryTitle,inventoryGrid} from '../src/studio/inventory-plan.mjs';
import {pipelineController} from '../src/studio/pipeline.mjs';
import {hash,json} from '../src/skins/package.mjs';

const configBytes=await readFile(new URL('../configs/inventory-panel.json',import.meta.url));
test('inventory dimensions use a compact default and never accept fractional or insufficient capacities',()=>{
  const config={version:'1.1',columns:5,rows:4,items:Array.from({length:8},()=>({}))};
  assert.deepEqual(inventoryGrid(undefined,undefined,config),{columns:5,rows:4});
  assert.deepEqual(inventoryGrid(6,4,config),{columns:6,rows:4});
  for(const dimensions of [[undefined,4],[5,undefined],[0,4],[11,4],[2.5,4],['5',4],[2,3]])assert.throws(()=>inventoryGrid(...dimensions,config),{code:'PANEL_INVENTORY_GRID'});
});
async function fixture(run){
  const root=await mkdtemp(join(tmpdir(),'inventory-plan-')),directory=join(root,'work/plan'),contractsDirectory=join(directory,'contracts'),skinSha256='a'.repeat(64),orientation='portrait';
  try{
    await mkdir(contractsDirectory,{recursive:true});await mkdir(join(root,'configs'));
    await writeFile(join(root,'configs/inventory-panel.json'),configBytes);
    for(const key of ['registry','usage','template'])await writeFile(join(contractsDirectory,key+'.json'),JSON.stringify({kind:key,immutable:true}));
    await run({root,directory,contractsDirectory,skinSha256,orientation,title:'本地仓库'});
  }finally{await rm(root,{recursive:true,force:true});}
}
test('inventory plans freeze config, selected ratio, skin and exact contract bytes without a model plan',()=>fixture(async input=>{
  const prepared=await prepareInventoryPlan(input),params={...input,planFile:prepared.plan,sha256:prepared.sha256};
  const plan=await verifyInventoryPlan(params);
  assert.equal(plan.title,input.title);assert.equal(plan.orientation,'portrait');assert.equal(plan.builder,'deterministic-inventory');assert.equal(plan.skinSha256,input.skinSha256);assert.equal(plan.version,'1.1');assert.equal(plan.columns,5);assert.equal(plan.rows,4);
  assert.equal(await readFile(plan.configFile,'utf8'),configBytes.toString());
  const bytes=await readFile(prepared.plan,'utf8');assert.equal(bytes.includes(input.root),false);assert.equal(bytes.includes('session'),false);
  await writeFile(join(input.root,'configs/inventory-panel.json'),'changed current config');
  assert.deepEqual(await verifyInventoryPlan(params),plan);
  for(const patch of [{orientation:'landscape'},{skinSha256:'b'.repeat(64)},{sha256:'b'.repeat(64)}])await assert.rejects(verifyInventoryPlan({...params,...patch}),{code:'PANEL_INVENTORY_PLAN_CHANGED'});
  await writeFile(plan.configFile,'{}');await assert.rejects(verifyInventoryPlan(params),{code:'PANEL_INVENTORY_PLAN_CHANGED'});
}));
test('inventory plan rejects mutated frozen contracts and title/digest tampering',()=>fixture(async input=>{
  const prepared=await prepareInventoryPlan(input),params={...input,planFile:prepared.plan,sha256:prepared.sha256};
  const bytes=await readFile(prepared.plan,'utf8'),saved=JSON.parse(bytes);
  for(const patch of [{title:'悄悄替换'},{columns:6},{rows:6}]){await writeFile(prepared.plan,JSON.stringify({...saved,...patch}));await assert.rejects(verifyInventoryPlan(params),{code:'PANEL_INVENTORY_PLAN_CHANGED'});}
  await writeFile(prepared.plan,bytes);await writeFile(join(input.contractsDirectory,'registry.json'),'changed registry');
  await assert.rejects(verifyInventoryPlan(params),{code:'PANEL_INVENTORY_PLAN_CHANGED'});
}));
test('chosen grid is frozen and legacy plans retain their original ten-by-ten config',()=>fixture(async input=>{
  const prepared=await prepareInventoryPlan({...input,columns:6,rows:4}),params={...input,planFile:prepared.plan,sha256:prepared.sha256};
  const chosen=await verifyInventoryPlan(params);assert.equal(chosen.columns,6);assert.equal(chosen.rows,4);
  const config=JSON.parse(configBytes);config.version='1.0';config.columns=10;config.rows=10;config.gap=4;
  for(const key of ['appearance','samplePlacement','cellTarget'])delete config[key];
  config.orientations={landscape:{width:1232,height:672,details:'right'},portrait:{width:672,height:1232,details:'below'}};
  const slots=[0,1,7,12,27,48,76,99];config.items.forEach((item,index)=>item.slotIndex=slots[index]);
  const frozen=json(config),{configFile,columns,rows,...oldPlan}=chosen;oldPlan.version='1.0';oldPlan.configSha256=hash(frozen);
  const sha256=hash(json(oldPlan));await writeFile(configFile,frozen);await writeFile(prepared.plan,json({...oldPlan,sha256}));
  const restored=await verifyInventoryPlan({...params,sha256});assert.equal(restored.columns,10);assert.equal(restored.rows,10);assert.equal(restored.version,'1.0');
  assert.deepEqual(JSON.parse(await readFile(restored.configFile)).items.map(item=>item.slotIndex),slots);
  assert.throws(()=>inventoryGrid(5,4,config),{code:'PANEL_INVENTORY_GRID'});
}));
test('inventory title is literal bounded display copy, never an open-ended model request',()=>{
  assert.equal(inventoryTitle('  '),'仓库（示例）');assert.equal(inventoryTitle('  玩家仓库  '),'玩家仓库');assert.equal(inventoryTitle('<仓库>'),'<仓库>');
  for(const value of [null,42,'x'.repeat(41),'仓库\n拖换'])assert.throws(()=>inventoryTitle(value),{code:'PANEL_INVENTORY_TITLE'});
});
test('Studio retains already prepared deterministic inventory plans and rejects stale or changed legacy starts',()=>fixture(async input=>{
  const dir='work/studio/projects/fixture';await mkdir(join(input.root,dir),{recursive:true});
  const prepared=await prepareInventoryPlan(input),job={id:'legacy',kind:'inventory',builder:'deterministic-inventory',status:'prepared',sha256:prepared.sha256,plan:'work/plan/inventory-plan.json',inputs:'work/plan',contractsDirectory:'work/plan/contracts',orientation:input.orientation,skinVersion:input.skinSha256,skinDirectory:'work/frozen-skin'};
  await writeFile(join(input.root,dir,'project.json'),JSON.stringify({name:'Fixture'}));await writeFile(join(input.root,dir,'flow.json'),JSON.stringify({version:'1.0',panels:[job]}));
  const pipeline=pipelineController(input.root,{resolve:()=>({directory:dir+'/batches/digest'})},{files:new Map(),items:[]},{
    resolveComponentSkin:async()=>({pack:{id:'fixture'},packDirectory:join(input.root,'work/skin'),manifestSha256:input.skinSha256}),
    freezeContracts:async({directory})=>{await mkdir(directory);for(const key of ['registry','usage','template'])await writeFile(join(directory,key+'.json'),'{}');return directory;},
    verifyPanelSkin:async()=>({pack:{id:'fixture'},manifestSha256:input.skinSha256}),
  });
  assert.equal(job.runDirectory,undefined);assert.match(job.plan,/inventory-plan\.json$/);
  await assert.rejects(pipeline.action('panel-start',{id:'x',panelId:job.id,confirmed:'stale'}),/PANEL_CONFIRMATION_REQUIRED/);
  await writeFile(join(input.root,job.inputs,'inventory-config.json'),'{}');
  await assert.rejects(pipeline.action('panel-start',{id:'x',panelId:job.id,confirmed:job.sha256}),{code:'PANEL_INVENTORY_PLAN_CHANGED'});
  const flow=JSON.parse(await readFile(join(input.root,dir,'flow.json')));assert.equal(flow.panels[0].status,'prepared');
}));
