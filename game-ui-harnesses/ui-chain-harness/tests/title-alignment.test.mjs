import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {editorData} from '../src/panel/data.mjs';
import {headingPresentation} from '../src/panel/headings.mjs';
import {customActionConfig} from '../src/panel/custom-panel.mjs';
import {customLayoutPolicy} from '../src/panel/custom-presentation.mjs';
import {actionFixture} from '../src/panel/action-fixtures.mjs';
import {actionPresetFromIntent} from '../src/panel/action-intent.mjs';
import {referencePresetList,referenceExample,referenceActionConfig,referenceSettingsPolicy} from '../src/panel/reference-presets.mjs';
import {settingsFromIntent} from '../src/panel/settings-intent.mjs';
import {settingsDocument} from '../src/panel/settings.mjs';
import {validateDocument} from '../src/panel/document.mjs';
const read=async p=>JSON.parse(await readFile(new URL(p,import.meta.url))),base=await read('../configs/action-presets.json'),layout=await read('../configs/settings-layout.json'),data=await editorData(),catalog=await read('../../ui-panel-harness/examples/modern-all-components.catalog.json');
const roles=data.usage.bindings.map(({role,assetId})=>({role,assetId})),assets=[...new Set(roles.map(r=>r.assetId))].map(assetId=>({assetId,width:512,height:256,density:1,stretch:'nine-slice',nineSlice:{left:10,right:10,top:10,bottom:10},contentInsets:{left:14,right:14,top:14,bottom:14},minSize:{width:29,height:29}}));
const ctx={...data,skinGeometry:{version:'1.0',scale:1,roles,assets,surfaceStyles:{title:{baseRole:'skin.surface.bar',insets:{left:30,right:108,top:14,bottom:14},layers:[]}}},panelInsets:{left:14,right:14,top:14,bottom:14},scrollInsets:{left:14,right:14,top:14,bottom:14}};
const heading=doc=>doc.nodes.find(n=>n.id==='heading');
const assertCentered=doc=>{const n=heading(doc);assert.equal(n.props.align,'center');assert.equal(n.surfaceTextInsets.left,n.surfaceTextInsets.right);assert(n.surfaceTextInsets.left>=108);assert(!doc.nodes.some(n=>n.surfaceStyle==='section'&&n.props.align==='center'));};

test('only explicit centered reference titles symmetrize their safe areas; default and section output stay frozen',()=>{
 const legacy=headingPresentation(ctx,'title',800,32,{reference:true}),before=structuredClone(legacy),center=headingPresentation(ctx,'title',800,32,{reference:true,centered:true});
 assert.deepEqual(legacy.surfaceTextInsets,{left:88,right:108,top:14,bottom:14});assert.deepEqual(center.surfaceTextInsets,{left:108,right:108,top:14,bottom:14});
 assert.equal(center.height,legacy.height);assert.deepEqual(headingPresentation(ctx,'title',800,32,{reference:true}),before);
 assert.deepEqual(headingPresentation(ctx,'section',800,32,{reference:true,centered:true}),headingPresentation(ctx,'section',800,32,{reference:true}));
 assert.deepEqual(headingPresentation(ctx,'title',800,32,{centered:true}),headingPresentation(ctx,'title',800,32));
});

test('all current reference presets and classic dialogs center the main title with symmetric ornament room',async()=>{
 assert.equal(base.presentation.titleAlign,'center');assert.equal(layout.presentation.titleAlign,'center');
 for(const {id}of referencePresetList()){
  const config=id==='sdk-settings'?base:referenceActionConfig(base,id),f=await actionFixture(referenceExample(id),catalog,config);
  const result=id==='sdk-settings'?await settingsFromIntent(f.session,f.intent,referenceSettingsPolicy(await read('../configs/settings-planning-policy.json')),layout,ctx):await actionPresetFromIntent(f.session,f.intent,config,id,ctx);
  for(const doc of Object.values(result.documents))assertCentered(doc);
 }
 for(const e of await read('../examples/action-presets.json')){
  const f=await actionFixture(e,catalog,base),result=await actionPresetFromIntent(f.session,f.intent,base,e.presetId,ctx);
  for(const doc of Object.values(result.documents))assertCentered(doc);
 }
});

test('tabbed settings center only their main title and retain section alignment and field values',async()=>{
 const content=await read('../configs/settings-content.json'),fields=content.fields.slice(0,2),grouped={...content,fields,groups:fields.map((f,i)=>({id:'g'+i,title:'分组'+i,fieldIds:[f.id]})),tabsEnabled:true,tabs:fields.map((f,i)=>({id:'t'+i,label:'标签'+i,initial:i===0,groupIds:['g'+i]}))};
 for(const canvas of ['landscape','portrait']){
  const doc=settingsDocument(grouped,layout,canvas,ctx);assertCentered(doc);
  for(const n of doc.nodes.filter(n=>n.surfaceStyle==='section'))assert.equal(n.props.align,'left');
  assert.equal(doc.nodes.find(n=>n.id===fields[0].id).props.checked,fields[0].value);
 }
});

test('custom title alignment is explicit, optional for frozen policies and respects authored left or right overrides',async()=>{
 const config=customActionConfig(base),e=(await read('../examples/custom-layout.json'))[0];assert.equal(config.presets.custom.layout.titleAlign,'center');
 const compile=async p=>{const f=await actionFixture(e,catalog,p);return actionPresetFromIntent(f.session,f.intent,p,'custom',ctx);};
 const centered=await compile(config);for(const doc of Object.values(centered.documents))assertCentered(doc);
 for(const align of ['left','right']){
  const authored=structuredClone(config);authored.presets.custom.layout.titleAlign=align;
  const result=await compile(authored);for(const doc of Object.values(result.documents)){assert.equal(heading(doc).props.align,align);assert.deepEqual(heading(doc).surfaceTextInsets,{left:88,right:108,top:14,bottom:14});}
 }
 const frozen=structuredClone(config);delete frozen.presets.custom.layout.titleAlign;frozen.presentation.titleAlign='left';
 const result=await compile(frozen);for(const doc of Object.values(result.documents))assert.equal(heading(doc).props.align,'left');
 const document=structuredClone(centered.documents.landscape);heading(document).props.align='right';assert.equal(heading(validateDocument(document,ctx)).props.align,'right');
 for(const titleAlign of ['middle',null,1])assert.throws(()=>customLayoutPolicy({layout:{...config.presets.custom.layout,titleAlign}}),{code:'panel.action-layout-policy'});
});
