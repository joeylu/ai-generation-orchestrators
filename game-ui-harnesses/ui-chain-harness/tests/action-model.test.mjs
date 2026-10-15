import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {actionConsumer,prepareActionPlan,verifyActionPlan,loadActionRun,materializeActionRun,actionPlanningFiles} from '../src/panel/action-model.mjs';
import {actionFixture} from '../src/panel/action-fixtures.mjs';
import {actionPresetFromIntent} from '../src/panel/action-intent.mjs';
import {editorData} from '../src/panel/data.mjs';
import {hash,json} from '../src/skins/package.mjs';
const read=async p=>JSON.parse(await readFile(new URL(p,import.meta.url)));
const config=await read('../configs/action-presets.json'),examples=await read('../examples/action-presets.json'),catalog=await read('../../ui-panel-harness/examples/modern-all-components.catalog.json');
const instructions=await readFile(new URL('../prompts/action-planner.md',import.meta.url),'utf8');
const pack={id:'test-fixture'},manifestSha256='a'.repeat(64),aliases={version:'1.0',skins:{'test-fixture':['测试皮肤']}},ctx=await editorData();
test('both action plans are deterministic and bind request, preset, skin and prompt without transport',async()=>{
  for(const example of examples){
    const consumer=actionConsumer(config,example.presetId,pack,manifestSha256,aliases);
    const input={request:{requestVersion:'0.1',id:example.id,target:'pixi',text:example.request},catalog,instructions,consumer};
    const bundle=await prepareActionPlan(input);assert.deepEqual(bundle,await prepareActionPlan(input));
    await verifyActionPlan(bundle,consumer,instructions);
    const sorted=v=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v;
    await verifyActionPlan(sorted(bundle),consumer,instructions);
    await assert.rejects(()=>verifyActionPlan(bundle,{...consumer,skinSha256:'b'.repeat(64)},instructions),{code:'CONSUMER_CHANGED_REPLAN'});
    await assert.rejects(()=>verifyActionPlan(bundle,consumer,instructions+'changed'),{code:'CONSUMER_CHANGED_REPLAN'});
    await assert.rejects(()=>verifyActionPlan({...bundle,plan:{...bundle.plan,prompt:'changed'}},consumer,instructions),{code:'PLANNING_PLAN_CHANGED'});
  }
  assert.throws(()=>actionConsumer(config,'unknown',pack,manifestSha256,aliases),{code:'ACTION_PRESET_UNKNOWN'});
});
test('preview accepts verified fixture evidence but rejects changed raw response and stale behavior',async()=>{
  // Test-only transport evidence. No provider or model is called.
  const parent=new URL('../work/tests/',import.meta.url);await mkdir(parent,{recursive:true});
  const dir=await mkdtemp(join(fileURLToPath(parent),'action-model-'));
  const example=examples[1],consumer=actionConsumer(config,'form',pack,manifestSha256,aliases);
  const bundle=await prepareActionPlan({request:{requestVersion:'0.1',id:example.id,target:'pixi',text:example.request},catalog,instructions,consumer});
  const {intent}=await actionFixture(example,catalog,config),preset=await actionPresetFromIntent(bundle.plan.session,intent,config,'form',ctx);
  const raw=json(intent),write=(name,value)=>writeFile(join(dir,name),typeof value==='string'?value:json(value));
  await write('plan.json',bundle.plan);await write('intent.json',intent);await write('response.txt',raw);await write('preset.json',preset);
  await write('receipt.json',{status:'RESPONSE_RECEIVED',planSha256:bundle.plan.sha256,contextSha256:bundle.plan.session.context.sha256,responseSha256:hash(Buffer.from(raw)),invocationCount:1,automaticRetries:0});
  await write('conversion.json',{status:'COMPILED',files:[{file:'preset.json',sha256:hash(Buffer.from(json(preset)))}]});
  const options={config,pack,manifestSha256,aliases,instructions,ctx};
  assert.deepEqual((await loadActionRun(dir,options)).preset,preset);
  await write('response.txt',raw+' ');await assert.rejects(()=>loadActionRun(dir,options),{code:'ACTION_RECEIPT_INVALID'});
  await write('response.txt',raw);await write('preset.json',{...preset,behavior:{}});
  await assert.rejects(()=>loadActionRun(dir,options),{code:'ACTION_ARTIFACT_CHANGED'});
});

test('orientation is frozen in the model plan and compiles only selected document',async()=>{const example=examples[1],input={request:{requestVersion:'0.1',id:example.id,target:'pixi',text:example.request},catalog,instructions};const consumers=['landscape','portrait'].map(o=>actionConsumer(config,'form',pack,manifestSha256,aliases,o));const plans=await Promise.all(consumers.map(consumer=>prepareActionPlan({...input,consumer})));assert.notEqual(plans[0].plan.sha256,plans[1].plan.sha256);for(let i=0;i<2;i++){await verifyActionPlan(plans[i],consumers[i],instructions);assert.ok(plans[i].plan.instructions.includes('Authoritative canvas selection: '+consumers[i].orientation));const fixture=await actionFixture(example,catalog,config),result=await actionPresetFromIntent(fixture.session,fixture.intent,config,'form',{...ctx,orientation:consumers[i].orientation});assert.deepEqual(Object.keys(result.documents),[consumers[i].orientation]);}await assert.rejects(()=>verifyActionPlan(plans[0],consumers[1],instructions),{code:'CONSUMER_CHANGED_REPLAN'});});

test('inventory planning selects its own prompt and catalog without replacing other preset inputs',()=>{
  const normal=actionPlanningFiles('form');assert.equal(normal.instructions,'prompts/action-planner.md');
  for(const preset of ['confirmation','sdk-shop','unknown'])assert.deepEqual(actionPlanningFiles(preset),normal);
  assert.equal(actionPlanningFiles('custom').catalog,normal.catalog);assert.equal(actionPlanningFiles('custom').instructions,'prompts/custom-panel-planner.md');
  assert.notEqual(actionPlanningFiles('inventory').catalog,normal.catalog);assert.equal(actionPlanningFiles('inventory').instructions,'prompts/inventory-planner.md');
  assert.equal(actionPlanningFiles('inventory',{inventoryPlanning:{version:'1.0'}}).instructions,'prompts/inventory-planner-v1.md');
  assert.equal(actionPlanningFiles('inventory',{inventoryPlanning:{version:'1.1'}}).instructions,'prompts/inventory-planner.md');
  for(const version of [undefined,'future','1.2'])assert.throws(()=>actionPlanningFiles('inventory',{inventoryPlanning:{version}}),{code:'CONSUMER_CHANGED_REPLAN'});
});

test('the conversion producer cannot publish a passed result without actual transport evidence',async()=>{
  const parent=new URL('../work/tests/',import.meta.url);await mkdir(parent,{recursive:true});
  const directory=await mkdtemp(join(fileURLToPath(parent),'action-no-receipt-')),example=examples[1],consumer=actionConsumer(config,'form',pack,manifestSha256,aliases,'landscape');
  const {plan}=await prepareActionPlan({request:{requestVersion:'0.1',id:example.id,target:'pixi',text:example.request},catalog,instructions,consumer});
  const {intent}=await actionFixture(example,catalog,config);
  await writeFile(join(directory,'plan.json'),json(plan),{flag:'wx'});
  await assert.rejects(materializeActionRun({directory,intent,receipt:{status:'RESPONSE_RECEIVED'}},{plan,consumer,config,ctx}),{code:'ENOENT'});
  assert.equal(JSON.parse(await readFile(join(directory,'conversion.json'))).status,'REJECTED');
  await assert.rejects(readFile(join(directory,'preset.json')),{code:'ENOENT'});
});
