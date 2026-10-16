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
import {startHarness} from './harness.mjs';

test('reference settings put labels before right-aligned native switches while frozen settings keep their order and interactions',async()=>{
 const fixture=await materialSkinFixture(await mkdtemp(join(tmpdir(),'ui-reference-switch-'))),extended=await extendSkinMaterials({...fixture,output:join(fixture.directory,'extended')}),verified=await verifySkinPackage(extended.packageDirectory),pack=verified.pack;
 const skinPack={manifest:(await readFile(join(extended.packageDirectory,'skin-pack.json'))).toString('base64'),manifestSha256:verified.manifestSha256,bindings:pack.bindings,resources:Object.fromEntries([...verified.resources].map(([f,b])=>[f,b.toString('base64')]))};
 const ctx={...await editorData(),...settingsSkinGeometry(pack),profile:pack.theme,binding:{sourceKind:pack.sourceKind,sha256:verified.manifestSha256}},layout=JSON.parse(await readFile(new URL('../../configs/settings-layout.json',import.meta.url))),content=JSON.parse(await readFile(new URL('../../configs/settings-content.json',import.meta.url))),h=await startHarness({skinPack,profile:pack.theme});
 try{
  for(const version of ['2.0','3.0']){
   const config=structuredClone(layout);config.presentation.version=version;const doc=settingsDocument({...content,fields:content.fields.slice(0,2)},config,'landscape',ctx);
   const before=await h.page.evaluate(({doc,ctx})=>{
    window.switchScene?.dispose();harness.clear();window.switchScene=harness.compilePanel(doc,ctx);switchScene.runtime.setMode('play');switchScene.runtime.flush();window.switchHandle=[...switchScene.runtime.handles.values()].find(h=>h.recipe.type==='Switch');
    const v=switchHandle.adapter.view.activeView;return {width:switchHandle.size.width,trackX:v.children[0].x,trackWidth:v.children[0].width,textX:v.children[2].x,text:v.children[2].text,checked:switchHandle.readState().checked,document:JSON.parse(JSON.stringify(switchScene.document))};
   },{doc,ctx});
   if(version==='3.0'){assert.equal(before.textX,0);assert.equal(before.trackX+before.trackWidth,before.width);}else{assert.equal(before.trackX,0);assert(before.textX>=before.trackWidth);}
   assert.equal(before.text,content.fields[0].label);assert.deepEqual(before.document,doc);
   const clickTrack=async()=>{const q=await h.page.evaluate(()=>{const v=switchHandle.adapter.view.activeView.children[0],b=v.getBounds(),c=harness.app.canvas.getBoundingClientRect();return {x:c.left+(b.x+b.width/2)*c.width/harness.app.screen.width,y:c.top+(b.y+b.height/2)*c.height/harness.app.screen.height};});await h.page.mouse.click(q.x,q.y);};
   await clickTrack();assert.equal(await h.page.evaluate(()=>switchHandle.readState().checked),!before.checked);
   const resized=await h.page.evaluate(()=>{
    // A settings flow owns its child width. Use a free node in the same
    // compiled runtime to exercise the adapter's independent resize path.
    const previous=switchHandle,r=switchScene.runtime;switchHandle=r.create({id:'resized-switch',recipeRef:'switch@1.0.0',props:{...previous.props},size:{...previous.size}});switchHandle.setState(previous.readState());r.mount(switchHandle);switchHandle.root.position.set(30,650);
    switchHandle.resize(switchHandle.size.width-32,switchHandle.size.height);r.flush();const v=switchHandle.adapter.view.activeView;return {width:switchHandle.size.width,trackX:v.children[0].x,trackWidth:v.children[0].width,textX:v.children[2].x};
   });
   if(version==='3.0'){assert.equal(resized.textX,0);assert.equal(resized.trackX+resized.trackWidth,resized.width);assert.equal(resized.trackX,before.trackX-32);}else assert.equal(resized.trackX,0);
   await clickTrack();assert.equal(await h.page.evaluate(()=>switchHandle.readState().checked),before.checked);
   await h.page.evaluate(()=>switchHandle.setEnabled(false));await clickTrack();assert.equal(await h.page.evaluate(()=>switchHandle.readState().checked),before.checked);
   await h.page.evaluate(()=>{switchHandle.setEnabled(true);switchScene.runtime.setMode('edit');});await clickTrack();assert.equal(await h.page.evaluate(()=>switchHandle.readState().checked),before.checked);
   assert.deepEqual(await h.page.evaluate(()=>JSON.parse(JSON.stringify(switchScene.document))),doc);
  }
  assert.deepEqual(h.errors,[]);
 }finally{await h.page.evaluate(()=>window.switchScene?.dispose()).catch(()=>{});await h.close();}
});
