import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {materialSkinFixture} from '../../fixtures/material-skin.mjs';
import {verifySkinPackage} from '../../src/skins/package.mjs';
import {editorData} from '../../src/panel/data.mjs';
import {settingsSkinGeometry} from '../../src/panel/skin-geometry.mjs';
import {startHarness} from './harness.mjs';

test('only explicitly marked reference documents balance automatic CJK closes and resize from the full box',async()=>{
 const fixture=await materialSkinFixture(await mkdtemp(join(tmpdir(),'ui-reference-cjk-'))),verified=await verifySkinPackage(fixture.packageDirectory),pack=verified.pack;
 const skinPack={manifest:(await readFile(join(fixture.packageDirectory,'skin-pack.json'))).toString('base64'),manifestSha256:verified.manifestSha256,bindings:pack.bindings,resources:Object.fromEntries([...verified.resources].map(([f,b])=>[f,b.toString('base64')]))};
 const ctx={...await editorData(),...settingsSkinGeometry(pack),profile:pack.theme,binding:{sourceKind:pack.sourceKind,sha256:verified.manifestSha256}},h=await startHarness({skinPack,profile:pack.theme});
 const n=(id,recipeRef,size,props={},slots={},extra={})=>({id,name:id,recipeRef,size,props,slots,...extra});
 const doc={kind:'ui_panel_document',version:'0.3',id:'reference-cjk',revision:0,title:'Closing punctuation',canvas:'landscape',bindings:ctx.binding,rootId:'artboard',nodes:[
  n('artboard','container@1.0.0',{width:1280,height:720},{},{children:['frame']},{layout:{childrenMode:'free',padding:0}}),
  n('frame','panel@1.0.0',{width:600,height:300},{title:'',contentPadding:{left:24,right:24,top:24,bottom:24}},{content:['body']},{position:{x:20,y:20},surfaceLayer:'frame',surfaceScale:3}),
  n('body','container@1.0.0',{width:500,height:200},{},{children:['heading','copy']},{layout:{childrenMode:'flow',direction:'column',gap:12,padding:0}}),
  n('heading','text@1.0.0',{width:500,height:72},{text:'A',textStyleRef:'body',overflow:'error'},{},{surfaceStyle:'title',surfaceBand:'reference-v1'}),
  n('copy','text@1.0.0',{width:216,height:56},{text:'树影覆盖小径。前方传来鸟鸣。',textStyleRef:'body',wrap:'word',overflow:'error'}),
 ]};
 try{
  const states=[];
  for(const mode of ['reference','no-scale','no-band','legacy','authored-newline']){
   const input=structuredClone(doc);
   if(mode==='no-scale'||mode==='legacy')delete input.nodes[1].surfaceScale;
   if(mode==='no-band'||mode==='legacy')delete input.nodes[3].surfaceBand;
   if(mode==='authored-newline')input.nodes[4].props.text='树影覆盖小径。前方传来鸟鸣\n。';
   states.push(await h.page.evaluate(({input,ctx,mode})=>{
    window.flowScene?.dispose();harness.clear();window.flowScene=harness.compilePanel(input,ctx);flowScene.runtime.flush();
    const handle=flowScene.runtime.handles.get('copy'),t=handle.adapter.text,before=handle.snapshot();
    const result={mode,wrapWidth:t.style.wordWrapWidth,text:t.text,fontSize:t.style.fontSize,height:t.height,size:{...handle.size},document:JSON.parse(JSON.stringify(flowScene.document)),before};
    handle.resize(300,56);result.wide=t.style.wordWrapWidth;handle.resize(216,56);result.restored=t.style.wordWrapWidth;
    return result;
   },{input,ctx,mode}));
   const state=states.at(-1);
   assert.equal(state.text,input.nodes[4].props.text);assert.equal(state.fontSize,pack.theme.fontSize);assert(state.height<=56);assert.deepEqual(state.size,{width:216,height:56});assert.deepEqual(state.document.nodes.find(n=>n.id==='copy').props,state.before.props);assert.equal(state.wide,300);
   assert.equal(state.wrapWidth,mode==='reference'?207:216);assert.equal(state.restored,state.wrapWidth);
  }
  const legacy=await h.page.evaluate(()=>{
   flowScene.dispose();harness.clear();
   const definition={id:'old-copy',recipeRef:'text@1.0.0',props:{text:'树影覆盖小径。前方传来鸟鸣。',textStyleRef:'body',wrap:'word',overflow:'error'},size:{width:216,height:56}};
   const old=harness.runtime.create(definition);harness.runtime.mount(old);harness.runtime.flush();
   const a=harness.app.renderer.extract.canvas(old.adapter.text).toDataURL();old.resize(300,56);old.resize(216,56);harness.runtime.flush();
   return {before:a,after:harness.app.renderer.extract.canvas(old.adapter.text).toDataURL(),wrapWidth:old.adapter.text.style.wordWrapWidth,snapshot:old.snapshot()};
  });
  assert.equal(legacy.before,legacy.after);assert.equal(legacy.wrapWidth,216);assert.equal(legacy.snapshot.surfaceBand,undefined);assert.deepEqual(h.errors,[]);
 }finally{await h.page.evaluate(()=>window.flowScene?.dispose()).catch(()=>{});await h.close();}
});
