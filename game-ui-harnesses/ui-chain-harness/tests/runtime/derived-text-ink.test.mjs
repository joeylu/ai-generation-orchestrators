import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {materialSkinFixture} from '../../fixtures/material-skin.mjs';
import {verifySkinPackage,hash} from '../../src/skins/package.mjs';
import {startHarness} from './harness.mjs';

test('legacy missing-role inks stay unchanged until explicit layer scope, including Select and Dialog portals',async()=>{
 const fixture=await materialSkinFixture(await mkdtemp(join(tmpdir(),'ui-derived-ink-'))),v=await verifySkinPackage(fixture.packageDirectory);
 // An in-memory test double of a historic exporter, never a delivery manifest.
 const metadata=structuredClone(v.pack);delete metadata.theme.textColors;
 const bytes=Buffer.from(JSON.stringify(metadata)),packet={manifest:bytes.toString('base64'),manifestSha256:hash(bytes),bindings:metadata.bindings,resources:Object.fromEntries([...v.resources].map(([f,b])=>[f,b.toString('base64')]))};
 const original=await readFile(join(fixture.packageDirectory,'skin-pack.json'));
 const h=await startHarness({skinPack:packet,profile:metadata.theme});
 try{
  const legacy=await h.page.evaluate(()=>{
   harness.clear();const before=JSON.stringify(harness.skin.profile),button=harness.make('Button',{id:'legacy-button'});harness.runtime.flush();
   return {fill:button.adapter.view.labelView.style.fill,expected:harness.skin.profile.palette.text,inks:harness.skin.profile.textColors??null,before,rows:harness.runtime.textColors.refresh()};
  });assert.equal(legacy.fill,legacy.expected);assert.equal(legacy.inks,null);assert.deepEqual(legacy.rows,[]);
  await h.page.evaluate(()=>{
   harness.clear();const r=harness.runtime;
   window.newSelect=harness.make('Select',{id:'new-select',size:{width:280,height:48}},false);
   window.newButton=harness.make('Button',{id:'new-button',size:{width:280,height:48}},false);
   const body=r.create({id:'new-body',recipeRef:'container@1.0.0',props:{},size:{width:280,height:160},layout:{childrenMode:'flow',direction:'column',gap:16,padding:0}},{children:[newSelect,newButton]});
   const panel=r.create({id:'new-panel',recipeRef:'panel@1.0.0',surfaceLayer:'content',props:{title:'',contentPadding:{left:30,right:30,top:30,bottom:30}},size:{width:360,height:240},position:{x:20,y:20}},{content:[body]});r.mount(panel);r.flush();
  });
  const newRows=await h.page.evaluate(()=>harness.runtime.textColors.refresh());assert(newRows.some(e=>e.colorSource==='derived-role'));
  const q=await h.page.evaluate(()=>harness.point(newSelect));await h.page.mouse.click(q.x,q.y);await h.page.waitForFunction(()=>newSelect.adapter.view.expanded);
  const popup=await h.page.evaluate(()=>{harness.runtime.flush();return {logical:newSelect.parent.id,relocated:newSelect.adapter.view.view.parent!==newSelect.root,rows:harness.runtime.textColors.refresh(),profile:JSON.stringify(harness.skin.profile)};});
  assert(popup.relocated);assert(popup.rows.some(e=>e.role==='skin.item.normal'&&e.colorSource==='derived-role'));assert.equal(popup.profile,legacy.before);
  await h.page.evaluate(()=>{harness.clear();const r=harness.runtime;window.portalDialog=harness.make('Dialog',{id:'portal-dialog',size:{width:500,height:300},props:{modal:true,open:true}},false);
   const panel=r.create({id:'dialog-owner',recipeRef:'panel@1.0.0',surfaceLayer:'content',props:{title:'',contentPadding:{left:30,right:30,top:30,bottom:30}},size:{width:580,height:380}},{content:[portalDialog]});r.mount(panel);r.flush();});
  const dialog=await h.page.evaluate(()=>({logicalParent:portalDialog.parent.id,relocated:portalDialog.adapter.view.parent!==portalDialog.root,rows:harness.runtime.textColors.refresh()}));
  assert.equal(dialog.logicalParent,'dialog-owner');assert(dialog.relocated);assert(dialog.rows.some(e=>e.colorSource==='derived-role'&&e.role==='skin.surface.panel'));
  const explicit=await h.page.evaluate(()=>{harness.clear();const r=harness.runtime,button=harness.make('Button',{id:'explicit-button',props:{textColor:'#123456'},size:{width:280,height:48}},false);
   const panel=r.create({id:'explicit-panel',recipeRef:'panel@1.0.0',surfaceLayer:'content',props:{title:'',contentPadding:{left:30,right:30,top:30,bottom:30}},size:{width:360,height:160}},{content:[button]});r.mount(panel);r.flush();return harness.runtime.textColors.refresh().filter(e=>e.text===button.props.label);});
  assert(explicit.length);assert(explicit.every(e=>e.fill==='#123456'&&e.colorSource==='node-override'&&!e.fallbackStroke));assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
 assert((await readFile(join(fixture.packageDirectory,'skin-pack.json'))).equals(original));
});
