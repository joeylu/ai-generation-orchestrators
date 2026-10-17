import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {materialSkinFixture} from '../../fixtures/material-skin.mjs';
import {extendSkinMaterials} from '../../src/skins/materials.mjs';
import {verifySkinPackage} from '../../src/skins/package.mjs';
import {editorData} from '../../src/panel/data.mjs';
import {settingsSkinGeometry} from '../../src/panel/skin-geometry.mjs';
import {settingsDocument} from '../../src/panel/settings.mjs';
import {customActionConfig} from '../../src/panel/custom-panel.mjs';
import {actionFixture} from '../../src/panel/action-fixtures.mjs';
import {actionPresetFromIntent} from '../../src/panel/action-intent.mjs';
import {startHarness} from './harness.mjs';

test('new Panel, Dialog, custom and tabbed headings visibly center while explicit authored alignment survives compilation',async()=>{
 const read=async p=>JSON.parse(await readFile(new URL(p,import.meta.url))),fixture=await materialSkinFixture(await mkdtemp(join(tmpdir(),'ui-title-center-'))),extended=await extendSkinMaterials({...fixture,output:join(fixture.directory,'extended')}),verified=await verifySkinPackage(extended.packageDirectory),pack=verified.pack;
 const skinPack={manifest:(await readFile(join(extended.packageDirectory,'skin-pack.json'))).toString('base64'),manifestSha256:verified.manifestSha256,bindings:pack.bindings,resources:Object.fromEntries([...verified.resources].map(([f,b])=>[f,b.toString('base64')]))};
 const ctx={...await editorData(),...settingsSkinGeometry(pack),profile:pack.theme,binding:{sourceKind:pack.sourceKind,sha256:verified.manifestSha256}},base=await read('../../configs/action-presets.json'),layout=await read('../../configs/settings-layout.json'),content=await read('../../configs/settings-content.json'),catalog=await read('../../../ui-panel-harness/examples/modern-all-components.catalog.json'),docs=[];
 for(const e of await read('../../examples/action-presets.json')){const f=await actionFixture(e,catalog,base),result=await actionPresetFromIntent(f.session,f.intent,base,e.presetId,ctx);docs.push(...Object.values(result.documents));}
 const custom=customActionConfig(base),example=(await read('../../examples/custom-panel.json'))[0],f=await actionFixture(example,catalog,custom),result=await actionPresetFromIntent(f.session,f.intent,custom,'custom',ctx);docs.push(...Object.values(result.documents));
 const fields=content.fields.slice(0,2),tabbed={...content,fields,groups:fields.map((f,i)=>({id:'g'+i,title:'分组'+i,fieldIds:[f.id]})),tabsEnabled:true,tabs:fields.map((f,i)=>({id:'t'+i,label:'标签'+i,initial:i===0,groupIds:['g'+i]}))};
 for(const canvas of ['landscape','portrait'])docs.push(settingsDocument({...content,fields},layout,canvas,ctx),settingsDocument(tabbed,layout,canvas,ctx));
 const h=await startHarness({skinPack,profile:pack.theme});
 try{
  for(const doc of docs){
   const state=await h.page.evaluate(({doc,ctx})=>{
    window.centerScene?.dispose();harness.clear();window.centerScene=harness.compilePanel(doc,ctx);centerScene.runtime.flush();
    const n=centerScene.runtime.handles.get('heading'),text=n.adapter.text;harness.app.render();
    return {align:n.props.align,offset:text.x+text.width/2-n.size.width/2,insets:n.snapshot().surfaceTextInsets,text:text.text,document:JSON.parse(JSON.stringify(centerScene.document))};
   },{doc,ctx});
   assert.equal(state.align,'center');assert(Math.abs(state.offset)<.01);assert.equal(state.insets.left,state.insets.right);assert.equal(state.text,doc.title);assert.deepEqual(state.document,doc);
  }
  const authored=structuredClone(docs.at(-1));authored.nodes.find(n=>n.id==='heading').props.align='right';
  const state=await h.page.evaluate(({doc,ctx})=>{
   centerScene.dispose();harness.clear();window.centerScene=harness.compilePanel(doc,ctx);centerScene.runtime.flush();const n=centerScene.runtime.handles.get('heading'),text=n.adapter.text;
   return {align:n.props.align,right:text.x+text.width,expected:n.size.width-n.snapshot().surfaceTextInsets.right,document:JSON.parse(JSON.stringify(centerScene.document))};
  },{doc:authored,ctx});
  assert.equal(state.align,'right');assert(Math.abs(state.right-state.expected)<.01);assert.deepEqual(state.document,authored);assert.deepEqual(h.errors,[]);
 }finally{await h.page.evaluate(()=>window.centerScene?.dispose()).catch(()=>{});await h.close();}
});
