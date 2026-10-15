import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {customActionConfig} from '../src/panel/custom-panel.mjs';
import {editorData} from '../src/panel/data.mjs';
import {actionFixture} from '../src/panel/action-fixtures.mjs';
import {actionPresetFromIntent} from '../src/panel/action-intent.mjs';
import {initialFieldState,applyPresetAction} from '../src/panel/action-behavior.mjs';
import {actionConsumer,prepareActionPlan,verifyActionPlan} from '../src/panel/action-model.mjs';
const read=async f=>JSON.parse(await readFile(new URL(f,import.meta.url)));
const base=await read('../configs/action-presets.json'),config=customActionConfig(base),[example]=await read('../examples/custom-panel.json'),catalog=await read('../../ui-panel-harness/examples/modern-all-components.catalog.json'),ctx=await editorData();
const fixture=await actionFixture(example,catalog,config);
const convert=(intent=fixture.intent,context=ctx)=>actionPresetFromIntent(fixture.session,intent,config,'custom',context);
test('custom planning freezes own request, policy and prompt without SDK template injection or compute',async()=>{
 const instructions=await readFile(new URL('../prompts/custom-panel-planner.md',import.meta.url),'utf8'),consumer=actionConsumer(config,'custom',{id:'fixture'},'a'.repeat(64),{version:'1.0',skins:{fixture:['当前皮肤']}});
 const request={requestVersion:'0.1',id:'custom-request',target:'pixi',text:'创建玩家资料，昵称输入和保存按钮。'};
 const bundle=await prepareActionPlan({request,catalog,instructions,consumer});await verifyActionPlan(bundle,consumer,instructions);
 assert.equal(bundle.plan.session.context.request.text,request.text);assert.equal(consumer.config.presets.custom.shape,undefined);
 const changed=structuredClone(consumer);changed.config.presets.custom.maxFields++;
 await assert.rejects(()=>verifyActionPlan(bundle,changed,instructions),{code:'CONSUMER_CHANGED_REPLAN'});
});
test('custom mixed controls retain semantics in two orientations without a preset shape',async()=>{
 const result=await convert();assert.equal(base.presets.custom,undefined);
 assert.equal(result.content.fields.length,7);assert.equal(result.content.actions.length,2);
 for(const doc of Object.values(result.documents)){
  assert(doc.nodes.some(n=>n.recipeRef==='scroll-view@1.0.0'));assert.equal(doc.nodes.find(n=>n.id==='row4').props.step,5);assert.equal(doc.nodes.find(n=>n.id==='row5').props.selectedId,'option0');assert.equal(doc.nodes.find(n=>n.id==='row6').props.value,60);assert.equal(doc.nodes.some(n=>n.id==='close'),false);
 }
});
test('custom controls preserve local state and reset exactly requested targets',async()=>{
 const {behavior}=await convert(),state=Object.fromEntries(behavior.fields.map(f=>[f.id,initialFieldState(f)]).filter(([,s])=>s));
 const changed=structuredClone(state);changed.row3.checked=false;changed.row4.value=80;changed.row5.selectedId='option1';
 const submitted=applyPresetAction(behavior,'row8',changed);assert.equal(submitted.event.values.row4.value,80);assert.equal(submitted.event.values.row5.selectedId,'option1');
 assert.deepEqual(applyPresetAction(behavior,'row7',changed).state,state);assert.equal(changed.row3.checked,false);
});
test('custom allows text-only and button-only requests without injecting controls',async()=>{
 for(const rows of [[example.rows[0]],[{...example.rows[8],action:'emit',submitRows:[]}]] ){
  const f=await actionFixture({...example,rows,overflow:'error'},catalog,config),r=await actionPresetFromIntent(f.session,f.intent,config,'custom',ctx);
  assert.equal(r.content.fields.length+r.content.actions.length,1);
 }
});
test('custom rejects empty panels, unsupported grouping, invalid options and ambiguous targets',async()=>{
 for(const mutate of [i=>i.panel.body.children[0].rows=[],i=>i.panel.body.children.push(structuredClone(i.panel.body.children[0])),i=>i.panel.body.children[0].rows[5].options[1].initial=true,i=>i.panel.body.children[0].rows[8].submitRows=[6],i=>i.panel.body.children[0].rows[4].suffix='分']){
  const i=structuredClone(fixture.intent);mutate(i);await assert.rejects(()=>convert(i));
 }
 const context={...ctx,binding:{sourceKind:'imported',sha256:'a'.repeat(64)}};await assert.rejects(()=>convert(fixture.intent,context),{code:'panel.action-scroll-insets'});
});
