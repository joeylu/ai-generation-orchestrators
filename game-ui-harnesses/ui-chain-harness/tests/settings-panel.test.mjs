import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {editorData} from '../src/panel/data.mjs';
import {settingsDocument} from '../src/panel/settings.mjs';
import {resourceClosure,validateDocument} from '../src/panel/document.mjs';
const ctx=await editorData();ctx.binding={sourceKind:'imported',sha256:'a'.repeat(64)};
const content=JSON.parse(await readFile(new URL('../configs/settings-content.json',import.meta.url))),layout=JSON.parse(await readFile(new URL('../configs/settings-layout.json',import.meta.url)));

test('tabs without scrolling size pages independently and reject lost groups or ambiguous selection',()=>{
  const fields=content.fields.slice(0,2),grouped={...content,fields,groups:fields.map((f,i)=>({id:'g'+i,title:'分组'+i,fieldIds:[f.id]})),tabsEnabled:true,tabs:fields.map((f,i)=>({id:'t'+i,label:'页'+i,initial:i===0,groupIds:['g'+i]}))};
  const context={...ctx,scrollInsets:{left:33,right:27,top:19,bottom:23}};
  const doc=settingsDocument(grouped,layout,'portrait',context);
  assert.equal(doc.nodes.find(n=>n.id==='settings-tabs').props.activeId,'t0');
  assert.equal(doc.nodes.filter(n=>n.recipeRef==='scroll-view@1.0.0').length,0);
  const tabs=doc.nodes.find(n=>n.id==='settings-tabs');
  // Both the outer plate and the retained inner content plate reserve their safe area.
  for(const id of tabs.slots.pages){const page=doc.nodes.find(n=>n.id===id);assert.equal(page.size.width,tabs.size.width-2*(33+27));assert.equal(page.size.height,tabs.size.height-ctx.profile.itemHeight-ctx.profile.geometry.labelGap-2*(19+23));}
  assert.throws(()=>settingsDocument(grouped,layout,'portrait',ctx),/Verified scroll insets/);
  for(const change of [c=>c.tabs[1].initial=true,c=>c.tabs[1].groupIds=['g0'],c=>c.tabs[1].id='t0']){
    const bad=structuredClone(grouped);change(bad);assert.throws(()=>settingsDocument(bad,layout,'portrait',context),{code:'panel.settings-tabs'});
  }
});

test('scroll settings keep title and footer outside a viewport sized from asymmetric skin insets',()=>{
  const scrolling={...content,overflow:'scroll'},context={...ctx,scrollInsets:{left:35,right:29,top:21,bottom:26}};
  for(const canvas of ['landscape','portrait']){
    const doc=settingsDocument(scrolling,layout,canvas,context),node=id=>doc.nodes.find(n=>n.id===id);
    assert.deepEqual(node('body').slots.children,['heading','settings-scroll','footer']);
    assert.deepEqual(node('settings-scroll').slots.content,['scroll-content']);
    assert.equal(node('scroll-content').size.width,node('settings-scroll').size.width-35-29-ctx.profile.geometry.scrollbarWidth-ctx.profile.geometry.scrollbarGap);
    assert.equal(node('settings').size.height,layout.orientations[canvas].height);
    assert.equal(node('music').props.checked,content.fields.find(f=>f.id==='music').value);
  }
  assert.throws(()=>settingsDocument(scrolling,layout,'portrait',ctx),/Verified scroll insets/);
});

test('group references cannot drop, duplicate or reorder authored fields',()=>{
  for(const ids of [[content.fields[0].id],content.fields.map(f=>f.id).reverse(),[...content.fields.map(f=>f.id),content.fields[0].id]]){
    assert.throws(()=>settingsDocument({...content,groups:[{id:'g',title:'组',fieldIds:ids}]},layout,'portrait',ctx),{code:'panel.settings-groups'});
  }
});
test('settings compile both orientations with real-skin binding and portable JSON',()=>{
  for(const canvas of ['landscape','portrait']){const doc=settingsDocument(content,layout,canvas,ctx);assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(doc)),ctx),doc);assert.equal(resourceClosure(doc,ctx).sourceKind,'imported');assert.equal(doc.nodes.filter(n=>n.recipeRef==='switch@1.0.0').length,2);assert.equal(doc.nodes.find(n=>n.id==='language').props.selectedId,'zh');assert.throws(()=>validateDocument(doc,{...ctx,binding:{...ctx.binding,sha256:'b'.repeat(64)}}),{code:'panel.binding'});}
});
test('settings reject overflowing content, duplicate ids and unsupported controls',()=>{
  const extra=structuredClone(content);extra.fields.push({...extra.fields[0],id:'extra'});const grown=settingsDocument(extra,layout,'portrait',ctx);assert.ok(grown.nodes.find(n=>n.id==='settings').size.height>layout.orientations.portrait.height);
  const fixed=structuredClone(layout);delete fixed.presentation;assert.throws(()=>settingsDocument(extra,fixed,'portrait',ctx),{code:'panel.overflow'});
  for(let i=0;i<12;i++)extra.fields.push({...extra.fields[0],id:'more'+i});assert.throws(()=>settingsDocument(extra,layout,'portrait',ctx),{code:'panel.canvas-capacity'});
  const dup=structuredClone(content);dup.fields[1].id=dup.fields[0].id;assert.throws(()=>settingsDocument(dup,layout,'landscape',ctx),{code:'panel.duplicate'});
  const invalid=structuredClone(content);invalid.fields[0].type='unknown';assert.throws(()=>settingsDocument(invalid,layout,'landscape',ctx),/Unsupported/);
});
