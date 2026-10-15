import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {materialSkinFixture} from '../../fixtures/material-skin.mjs';
import {extendSkinMaterials} from '../../src/skins/materials.mjs';
import {verifySkinPackage} from '../../src/skins/package.mjs';
import {decodePng} from '../../src/skins/png.mjs';
import {startHarness} from './harness.mjs';
test('layered title materials retain tile density, aspect, clipping, text overrides and lifecycle',async()=>{
 const f=await materialSkinFixture(await mkdtemp(join(tmpdir(),'ui-chain-surface-render-'))),r=await extendSkinMaterials({...f,output:join(f.directory,'extended')}),v=await verifySkinPackage(r.packageDirectory);
 const packet={manifest:(await readFile(join(r.packageDirectory,'skin-pack.json'))).toString('base64'),manifestSha256:v.manifestSha256,bindings:v.pack.bindings,resources:Object.fromEntries([...v.resources].map(([k,b])=>[k,b.toString('base64')]))};
 const h=await startHarness({skinPack:packet});
 try{
  const initial=await h.page.evaluate(()=>{
   harness.clear();
   const title=harness.runtime.create({id:'material-title',recipeRef:'text@1.0.0',props:{text:'Settings',textStyleRef:'body',wrap:'none',overflow:'error',align:'center'},surfaceStyle:'title',size:{width:320,height:72}});
   harness.runtime.mount(title);title.root.position.set(40,40);harness.app.render();window.materialTitle=title;
   return {style:title.snapshot().surfaceStyle,tileScale:title.adapter.surface.layers[0].item.tileScale.x,accentRatio:title.adapter.surface.layers[1].item.width/title.adapter.surface.layers[1].item.height,textColor:title.adapter.text.style.fill,textY:title.adapter.text.y,textHeight:title.adapter.text.height,eventMode:title.adapter.surface.view.eventMode};
  });
  const {textY,textHeight,...appearance}=initial;assert.equal(textY,(72-textHeight)/2);assert(textY>=8);assert.deepEqual(appearance,{style:'title',tileScale:1,accentRatio:1,textColor:'#FFFFFF',eventMode:'none'});
  const png=decodePng(await h.page.screenshot()),pixel=(x,y)=>[...png.pixels.subarray((y*png.width+x)*4,(y*png.width+x)*4+3)];
  assert.deepEqual(pixel(41,41),[30,75,92]);assert.notDeepEqual(pixel(52,52),[30,75,92]);
  const resized=await h.page.evaluate(()=>{
   materialTitle.resize(640,72);harness.app.render();
   const s=materialTitle.adapter.surface;let rejected=false;try{materialTitle.resize(640,24);}catch{rejected=true;}
   return {tileScale:s.layers[0].item.tileScale.x,tileWidth:s.layers[0].item.width,accentWidth:s.layers[1].item.width,accentHeight:s.layers[1].item.height,rejected,size:materialTitle.size};
  });
  assert.deepEqual(resized,{tileScale:1,tileWidth:632,accentWidth:48,accentHeight:48,rejected:true,size:{width:640,height:72}});
  const explicit=await h.page.evaluate(()=>{
   const title=harness.runtime.create({id:'override-title',recipeRef:'text@1.0.0',props:{text:'Override',textStyleRef:'body',textColor:'#FF0000',overflow:'error'},surfaceStyle:'title',size:{width:320,height:72}});
   harness.runtime.mount(title);harness.runtime.flush();harness.app.render();const color=title.adapter.text.style.fill;title.dispose();return color;
  });assert.equal(explicit,'#FF0000');
  assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});

test('replacement title and section bands never expose the original base at edges or rounded corners',async()=>{
 const f=await materialSkinFixture(await mkdtemp(join(tmpdir(),'ui-chain-surface-replace-')));
 f.config.surfaceStyles.title.baseMode='replace';delete f.config.surfaceStyles.title.clipInsets;
 f.config.surfaceStyles.title.layers=[{assetId:'material.paper',mode:'tile'}];
 f.config.surfaceStyles.section=structuredClone(f.config.surfaceStyles.title);
 await writeFile(f.configPath,JSON.stringify(f.config));
 const r=await extendSkinMaterials({...f,output:join(f.directory,'extended')}),v=await verifySkinPackage(r.packageDirectory);
 const packet={manifest:(await readFile(join(r.packageDirectory,'skin-pack.json'))).toString('base64'),manifestSha256:v.manifestSha256,bindings:v.pack.bindings,resources:Object.fromEntries([...v.resources].map(([k,b])=>[k,b.toString('base64')]))};
 const h=await startHarness({skinPack:packet});
 try{
  const initial=await h.page.evaluate(()=>{
   harness.clear();window.replacementBands=[];
   for(const [i,key] of ['title','section'].entries()){
    const node=harness.runtime.create({id:'replacement-'+key,recipeRef:'text@1.0.0',props:{text:'Settings',textStyleRef:'body',wrap:'none',overflow:'error',align:'center'},surfaceStyle:key,size:{width:320,height:72}});
    harness.runtime.mount(node);node.root.position.set(40,40+i*100);replacementBands.push(node);
   }
   harness.app.render();return replacementBands.map(n=>({children:n.adapter.surface.view.children.length,tileWidth:n.adapter.surface.layers[0].item.width,tileX:n.adapter.surface.layers[0].item.x}));
  });
  assert.deepEqual(initial,[{children:2,tileWidth:320,tileX:0},{children:2,tileWidth:320,tileX:0}]);
  const png=decodePng(await h.page.screenshot()),pixel=(x,y)=>[...png.pixels.subarray((y*png.width+x)*4,(y*png.width+x)*4+3)],background=pixel(1,1);
  for(const y of [40,140]){
   assert.deepEqual(pixel(40,y),background);assert.deepEqual(pixel(359,y),background);
   assert.deepEqual(pixel(40,y+36),[90,150,130]);assert.deepEqual(pixel(359,y+36),[90,150,130]);
  }
  const resized=await h.page.evaluate(()=>{
   replacementBands[0].resize(640,72);harness.app.render();const s=replacementBands[0].adapter.surface;
   return {width:s.layers[0].item.width,scale:s.layers[0].item.tileScale.x};
  });assert.deepEqual(resized,{width:640,scale:1});
  assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});
