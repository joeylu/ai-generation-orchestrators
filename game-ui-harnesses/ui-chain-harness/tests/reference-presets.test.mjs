import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {templateList} from '../../ui-reference-harness/web/template-previews.mjs';
import {referencePresetList,referencePreset,referenceRequest,referenceExample,referenceActionConfig,referenceSettingsPolicy} from '../src/panel/reference-presets.mjs';
import {actionFixture} from '../src/panel/action-fixtures.mjs';
import {actionPresetFromIntent} from '../src/panel/action-intent.mjs';
import {settingsFromIntent} from '../src/panel/settings-intent.mjs';
import {editorData} from '../src/panel/data.mjs';
const read=async p=>JSON.parse(await readFile(new URL(p,import.meta.url)));
const base=await read('../configs/action-presets.json'),catalog=await read('../../ui-panel-harness/examples/modern-all-components.catalog.json'),ctx=await editorData();

test('Studio consumes exactly the eight selected ui-reference presets and pins their source',()=>{
 const list=referencePresetList();assert.deepEqual(list.map(p=>p.id),templateList.map(p=>p.id));assert.equal(list.length,8);assert.equal(new Set(list.map(p=>p.group)).size,5);
 for(const p of list){const request=referenceRequest(p.id,'按钮文字按需求替换');assert.equal(request.source.sourceSha256,referencePreset(p.id).sourceSha256);assert.match(request.text,/按钮文字按需求替换/);assert.ok(request.text.length<4000);}
 assert.throws(()=>referenceRequest('confirmation',''),/UNKNOWN/);
});

for(const {id} of referencePresetList())test(id+' default content compiles to both orientations without a model',async()=>{
 const config=id==='sdk-settings'?base:referenceActionConfig(base,id),example=referenceExample(id),fixture=await actionFixture(example,catalog,config);
 let result;
 if(id==='sdk-settings'){
  const policy=referenceSettingsPolicy(await read('../configs/settings-planning-policy.json')),layout=await read('../configs/settings-layout.json');
  result=await settingsFromIntent(fixture.session,fixture.intent,policy,layout,ctx);
  assert.equal(result.content.fields.filter(f=>f.type==='switch').length,3);assert.equal(result.content.fields.filter(f=>f.type==='select').length,1);
  const wrong=structuredClone(fixture.intent);wrong.panel.body.children[0].rows.pop();await assert.rejects(()=>settingsFromIntent(fixture.session,wrong,policy,layout,ctx));
 }else{
  result=await actionPresetFromIntent(fixture.session,fixture.intent,config,id,ctx);
  if(id==='sdk-loading'){assert.equal(result.behavior.actions.length,0);assert.equal(result.content.fields[0].value,60);assert.equal(result.documents.landscape.nodes.some(n=>n.id==='actions'),false);}
  if(id==='sdk-loading-failed'){assert.equal(result.behavior.actions.length,2);assert.equal(result.content.fields[0].value,40);}
  if(id==='sdk-pause-online')assert.equal(result.behavior.actions.length,1);
  if(id==='sdk-pause-local')assert.equal(result.behavior.actions.length,2);
  const wrong=structuredClone(fixture.intent);wrong.panel.body.children[0].rows.push({...fixture.intent.panel.body.children[0].rows.at(-1)});await assert.rejects(()=>actionPresetFromIntent(fixture.session,wrong,config,id,ctx));
 }
 for(const [orientation,d] of Object.entries(result.documents)){assert.equal(d.canvas,orientation);assert.ok(d.nodes.some(n=>n.recipeRef==='panel@1.0.0'));}
});
