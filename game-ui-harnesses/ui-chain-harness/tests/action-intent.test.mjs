import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {editorData} from '../src/panel/data.mjs';
import {actionFixture} from '../src/panel/action-fixtures.mjs';
import {actionPresetFromIntent,applyPresetAction} from '../src/panel/action-intent.mjs';
const read=async p=>JSON.parse(await readFile(new URL(p,import.meta.url)));
const config=await read('../configs/action-presets.json'),examples=await read('../examples/action-presets.json');
const catalog=await read('../../ui-panel-harness/examples/modern-all-components.catalog.json'),ctx=await editorData();
const fixtures=await Promise.all(examples.map(e=>actionFixture(e,catalog,config)));
const convert=(i,intent=fixtures[i].intent)=>actionPresetFromIntent(fixtures[i].session,intent,config,examples[i].presetId,ctx);

test('explicit headings and legacy presentation remain available without changing content or behavior',async()=>{
  const modern=await convert(0),legacy=structuredClone(config);delete legacy.presentation;
  const old=await actionPresetFromIntent(fixtures[0].session,fixtures[0].intent,legacy,examples[0].presetId,ctx);
  assert.deepEqual(old.content,modern.content);assert.deepEqual(old.behavior,modern.behavior);
  assert.equal(old.documents.landscape.nodes.find(n=>n.id==='section-heading').props.text,examples[0].sectionTitle);
  assert.equal(old.documents.landscape.nodes.find(n=>n.id==='heading').props.align,'left');
  const show=structuredClone(config);show.presentation.sectionHeading='show';
  const shown=await actionPresetFromIntent(fixtures[0].session,fixtures[0].intent,show,examples[0].presetId,ctx);
  assert.equal(shown.documents.landscape.nodes.find(n=>n.id==='section-heading').props.text,examples[0].sectionTitle);
  const invalid=structuredClone(config);invalid.presentation.height='shrink';
  await assert.rejects(()=>actionPresetFromIntent(fixtures[0].session,fixtures[0].intent,invalid,examples[0].presetId,ctx),{code:'panel.presentation'});
});
test('native 0.12 maps text, input, checkbox and button with their semantics in both orientations',async()=>{
  for(let i=0;i<2;i++){
    const r=await convert(i);assert.deepEqual(await convert(i),r);
    for(const d of Object.values(r.documents)){
      assert.equal(d.nodes.some(n=>n.id==='section-heading'),false);
      assert.equal(d.nodes.find(n=>n.id==='heading').props.align,'left');
      assert.equal(r.content.sectionTitle,examples[i].sectionTitle);
      assert.equal(d.nodes.find(n=>n.id==='row0').props.text,examples[i].rows[0].text);
      assert.equal(d.nodes.some(n=>n.id==='row0-label'),false,'body-only text has a native identifying label but is not rendered twice');
      if(i===1){assert.equal(d.nodes.find(n=>n.id==='row1').props.maxLength,12);assert.equal(d.nodes.find(n=>n.id==='row2').props.checked,true);}
    }
  }
});
test('submit rejects invalid input, reset affects exact targets, and authored defaults stay immutable',async()=>{
  const {behavior}=await convert(1),before=structuredClone(behavior),state={row1:{value:''},row2:{checked:false}};
  assert.equal(applyPresetAction(behavior,'row4',state).errors.length,1);
  const valid=applyPresetAction(behavior,'row4',{row1:{value:'小林'},row2:{checked:false}});
  assert.equal(valid.event.action,'submit');assert.deepEqual(valid.event.values.row2,{checked:false});
  const reset=applyPresetAction(behavior,'row3',{row1:{value:'小林'},row2:{checked:false}});
  assert.deepEqual(reset.state,{row1:{value:''},row2:{checked:true}});assert.deepEqual(behavior,before);
  const confirmation=await convert(0);assert.equal(applyPresetAction(confirmation.behavior,'row1',{}).dismiss,true);
});
test('unsupported layout, action targets, variants and missing semantics are rejected before output',async()=>{
  for(const mutate of [i=>i.panel.body.kind='grid',i=>i.panel.body.children[0].rows[4].submitRows=[0],
    i=>i.panel.body.children[0].rows[4].submitRows=[1,1],i=>i.panel.body.children[0].rows[1].minLength=13,
    i=>i.panel.body.children[0].rows[3].recipeKey='settings.button.danger@0.1.0',i=>delete i.panel.body.children[0].rows[1].required]){
    const intent=structuredClone(fixtures[1].intent);mutate(intent);await assert.rejects(()=>convert(1,intent));
  }
});
