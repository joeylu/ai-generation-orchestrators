import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {editorData} from '../src/panel/data.mjs';
import {actionConsumer,actionPlanningFiles,prepareActionPlan,verifyActionPlan,materializeActionRun,loadActionRun} from '../src/panel/action-model.mjs';
import {inventoryActionConfig,inventoryPlanningCatalog} from '../src/panel/inventory-intent.mjs';
import {inventoryIntentFixture} from '../src/panel/inventory-fixtures.mjs';
import {codexPlanningClient} from '../src/panel/planning-client.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),parent=join(root,'work/tests');
const baseConfig=JSON.parse(await readFile(new URL('../configs/action-presets.json',import.meta.url)));
const instructions=await readFile(new URL('../prompts/inventory-planner.md',import.meta.url),'utf8');
const pack={id:'inventory-offline-test'},manifestSha256='a'.repeat(64),aliases={version:'1.0',skins:{[pack.id]:['离线测试皮肤']}};
const items=[{slot:0,name:'灵药',quantity:7,icon:null},{slot:1,name:'星矿',quantity:36,icon:null},{slot:7,name:'干粮',quantity:24,icon:null}];

// The fake process returns only events. The public transport/conversion programs
// create dispatch, response, receipt, document hashes and conversion evidence.
function fakeTransport(intent){
  let calls=0;
  return {get calls(){return calls;},runProcess(executable,args,options){
    calls++;assert.equal(options.shell,false);
    for(const flag of ['--ignore-user-config','--ephemeral','features.shell_tool=false'])assert.ok(args.includes(flag));
    const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
    child.kill=()=>queueMicrotask(()=>child.emit('close',1));
    child.stdin=new Writable({write(chunk,encoding,next){next();},final(next){next();queueMicrotask(()=>{
      child.stdout.write([{type:'thread.started',thread_id:'11111111-1111-4111-8111-111111111111'},
        {type:'turn.started'},{type:'item.completed',item:{type:'agent_message',text:JSON.stringify(intent)}},
        {type:'turn.completed'}].map(event=>JSON.stringify(event)).join('\n')+'\n');child.emit('close',0);
    });}});return child;
  }};
}
async function fixture(orientation,run){
  await mkdir(parent,{recursive:true});const directory=await mkdtemp(join(parent,'inventory-ai-model-'));
  const executable=join(directory,process.platform==='win32'?'codex.exe':'codex');
  await writeFile(executable,'offline fixture only; never executed');
  try{
    const ctx={...await editorData(),orientation,grid:{columns:5,rows:4}};
    const config=inventoryActionConfig(baseConfig,ctx),catalog=inventoryPlanningCatalog(config);
    const consumer=actionConsumer(config,'inventory',pack,manifestSha256,aliases,orientation);
    const request={requestVersion:'0.1',id:'inventory-'+orientation,target:'pixi',text:'生成5列4行的仓库，标题远行背包。第1格灵药7个，第2格星矿36个，第8格干粮24个，默认选中第1格。'};
    const bundle=await prepareActionPlan({request,catalog,instructions,consumer});
    const intent=inventoryIntentFixture(bundle.plan.session,config,{title:'远行背包',sectionTitle:'行囊',label:'物品',items,selectedSlot:0,enabled:true});
    const api=await codexPlanningClient(),transport=fakeTransport(intent);
    const options={authorizationSha256:bundle.plan.sha256,outputRoot:join(directory,'runs'),writableRoot:root,executable,runProcess:transport.runProcess,checkRuntime:()=>({status:'PASS'})};
    await run({directory,ctx,config,consumer,bundle,intent,api,transport,options});
  }finally{
    const rel=relative(resolve(parent),resolve(directory));assert.ok(rel&&!rel.startsWith('..'+sep)&&!rel.includes(sep));
    await rm(directory,{recursive:true,force:true});
  }
}

for(const orientation of ['landscape','portrait'])test('inventory AI '+orientation+' uses one offline transport and real conversion/load verification',async()=>fixture(orientation,async({ctx,config,consumer,bundle,api,transport,options})=>{
  await verifyActionPlan(bundle,consumer,instructions);
  assert.deepEqual(bundle.plan.session.responseSchema.properties.panelIntentVersion.enum,['0.13']);
  assert.equal(bundle.consumer.config.inventoryPlanning.programGrid.columns,5);
  assert.equal(bundle.consumer.config.inventoryPlanning.programGrid.rows,4);
  assert.equal(bundle.consumer.config.inventoryPlanning.version,'1.4');assert.equal(bundle.consumer.config.inventoryPlanning.layout.version,'1.5');assert.equal(bundle.consumer.config.inventoryPlanning.layout.surfaceLayer,'inset');assert.equal(bundle.consumer.config.inventoryPlanning.layout.frameScale,3);assert.equal(bundle.consumer.config.inventoryPlanning.layout.scrollMode,'fixed-cells-both-v1');
  const result=await api.runCodexPlanning(bundle.plan,options);
  assert.equal(transport.calls,1);assert.equal(result.receipt.invocationCount,1);assert.equal(result.receipt.automaticRetries,0);
  assert.equal((await materializeActionRun(result,{...bundle,ctx})).status,'COMPILED');
  const loaded=await loadActionRun(result.directory,{config,pack,manifestSha256,aliases,instructions,ctx});
  assert.equal(loaded.evidence.source,'model-response');assert.deepEqual(Object.keys(loaded.preset.documents),[orientation]);
  const inventory=loaded.preset.documents[orientation].nodes.find(node=>node.props.inventory)?.props;
  assert.equal(inventory.inventory.columns,5);assert.equal(inventory.inventory.rows,4);
  assert.equal(inventory.inventory.scrollMode,'fixed-cells-both-v1');assert.equal(inventory.inventory.cellSize,bundle.consumer.config.inventoryPlanning.programGrid.cellWidth);
  assert.deepEqual(inventory.items.map(item=>({slot:item.slotIndex,name:item.label,quantity:item.quantity})),items.map(({slot,name,quantity})=>({slot,name,quantity})));
  assert.equal(inventory.selectedId,inventory.items.find(item=>item.slotIndex===0).id);
  await assert.rejects(()=>api.runCodexPlanning(bundle.plan,options),/OUTPUT_EXISTS/);assert.equal(transport.calls,1);
  const raw=await readFile(join(result.directory,'response.txt'));await writeFile(join(result.directory,'response.txt'),Buffer.concat([raw,Buffer.from(' ')]));
  await assert.rejects(()=>loadActionRun(result.directory,{config,pack,manifestSha256,aliases,instructions,ctx}),{code:'ACTION_RECEIPT_INVALID'});
}));

test('inventory AI requires the exact authorization and frozen consumer before any dispatch',async()=>fixture('portrait',async({consumer,bundle,api,transport,options})=>{
  await assert.rejects(()=>api.runCodexPlanning(bundle.plan,{...options,authorizationSha256:null}),{code:'PLANNING_AUTHORIZATION_REQUIRED'});
  await assert.rejects(()=>api.runCodexPlanning({...bundle.plan,prompt:bundle.plan.prompt+'changed'},options),{code:'PLANNING_PLAN_CHANGED'});
  const changed=structuredClone(consumer);changed.config.inventoryPlanning.programGrid.columns=6;
  await assert.rejects(()=>verifyActionPlan(bundle,changed,instructions),{code:'CONSUMER_CHANGED_REPLAN'});
  assert.equal(transport.calls,0);
}));

test('frozen inventory 1.0 selects the exact legacy prompt and replays without changing scroll behavior',async()=>fixture('landscape',async({ctx,config,api,options})=>{
  const legacy=structuredClone(config),policy=legacy.inventoryPlanning;
  policy.version='1.0';policy.layout.version='1.1';delete policy.layout.scrollMode;delete policy.layout.surfaceLayer;delete policy.layout.frameScale;for(const key of ['slotFit','viewportFit','titleAlign']){delete policy.layout[key];delete policy.capabilities[key];}
  policy.capabilities.version='1.0';policy.capabilities.columns.maximum=10;policy.capabilities.rows.maximum=10;
  for(const key of ['maximumCells','maximumGridDimension','scrollMode','surfaceLayer','frameScale'])delete policy.capabilities[key];
  assert.equal(actionPlanningFiles('inventory',legacy).instructions,'prompts/inventory-planner-v1.md');assert.equal(actionPlanningFiles('inventory',config).instructions,'prompts/inventory-planner.md');
  const unknown=structuredClone(config);unknown.inventoryPlanning.version='future';assert.throws(()=>actionPlanningFiles('inventory',unknown));
  const legacyInstructions=await readFile(new URL('../prompts/inventory-planner-v1.md',import.meta.url),'utf8'),consumer=actionConsumer(legacy,'inventory',pack,manifestSha256,aliases,'landscape'),catalog=inventoryPlanningCatalog(legacy),request={requestVersion:'0.1',id:'legacy-inventory-offline',target:'pixi',text:'空仓库'};
  const bundle=await prepareActionPlan({request,catalog,instructions:legacyInstructions,consumer});await verifyActionPlan(bundle,consumer,legacyInstructions);await assert.rejects(()=>verifyActionPlan(bundle,consumer,instructions),{code:'CONSUMER_CHANGED_REPLAN'});
  const intent=inventoryIntentFixture(bundle.plan.session,legacy,{items:[],selectedSlot:null}),transport=fakeTransport(intent),result=await api.runCodexPlanning(bundle.plan,{...options,authorizationSha256:bundle.plan.sha256,runProcess:transport.runProcess});
  assert.equal(transport.calls,1);assert.equal((await materializeActionRun(result,{...bundle,ctx})).status,'COMPILED');
  const loaded=await loadActionRun(result.directory,{config:legacy,pack,manifestSha256,aliases,instructions:legacyInstructions,ctx}),list=loaded.preset.documents.landscape.nodes.find(node=>node.props.inventory);
  assert.equal(Object.hasOwn(list.props.inventory,'scrollMode'),false);assert.deepEqual(list.props.items,[]);
}));
