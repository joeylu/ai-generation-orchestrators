import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {customActionConfig} from '../src/panel/custom-panel.mjs';
import {actionConsumer,prepareActionPlan,verifyActionPlan} from '../src/panel/action-model.mjs';
import {orientationInstructions} from '../src/panel/orientation.mjs';
const read=async path=>JSON.parse(await readFile(new URL(path,import.meta.url)));
const config=customActionConfig(await read('../configs/action-presets.json'));
const catalog=await read('../../ui-panel-harness/examples/modern-all-components.catalog.json');
const instructions=await readFile(new URL('../prompts/custom-panel-planner.md',import.meta.url),'utf8');

test('selected custom canvas permits bounded panel dimensions without delegating the ratio to the model',async()=>{
 for(const orientation of ['landscape','portrait']){
  const consumer=actionConsumer(config,'custom',{id:'fixture'},'a'.repeat(64),{version:'1.0',skins:{fixture:['当前皮肤']}},orientation);
  const bundle=await prepareActionPlan({request:{requestVersion:'0.1',id:'layout-policy',target:'pixi',text:'创建有两列分组的玩家资料面板。'},catalog,instructions,consumer});
  await verifyActionPlan(bundle,consumer,instructions);
  const directive=bundle.plan.instructions.split('Authoritative canvas selection: ')[1].split('Consumer constraints:')[0];
  assert.ok(directive.startsWith(orientation));
  assert.match(directive,/layout\.width and layout\.maxHeight/);
  assert.match(directive,/layout\.canvasWidth and layout\.canvasHeight null/);
  assert.match(directive,/Do not ask the user to confirm this ratio/);
  assert.doesNotMatch(directive,/native geometry fields null/);
  const changed=structuredClone(consumer);changed.orientation=orientation==='portrait'?'landscape':'portrait';
  await assert.rejects(()=>verifyActionPlan(bundle,changed,instructions),{code:'CONSUMER_CHANGED_REPLAN'});
 }
});

test('preset and legacy orientation instructions retain their previous geometry contract',()=>{
 assert.match(orientationInstructions('preset','portrait'),/native geometry fields null/);
 assert.equal(orientationInstructions('legacy',undefined),'legacy');
 assert.throws(()=>orientationInstructions('invalid','square'),/PANEL_ORIENTATION_INVALID/);
});
