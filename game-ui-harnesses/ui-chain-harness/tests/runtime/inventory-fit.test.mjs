import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {materialSkinFixture} from '../../fixtures/material-skin.mjs';
import {verifySkinPackage,hash} from '../../src/skins/package.mjs';
import {encodePng,decodePng} from '../../src/skins/png.mjs';
import {startHarness} from './harness.mjs';
import {editorData} from '../../src/panel/data.mjs';
import {settingsSkinGeometry} from '../../src/panel/skin-geometry.mjs';
import {inventoryContentDocument,inventoryLayoutConfig,inventoryPresetContext} from '../../src/panel/inventory-preset.mjs';
import {inventoryMinimum} from '../../src/runtime/inventory-geometry.mjs';
import {upgradeInventoryRegistry} from '../../src/runtime/inventory-policy.mjs';
async function packet(){
 const real=process.env.UI_CHAIN_SLOT_SKIN,directory=real??(await materialSkinFixture(await mkdtemp(join(tmpdir(),'ui-slot-fit-')))).packageDirectory,v=await verifySkinPackage(directory),pack=structuredClone(v.pack),resources=new Map(v.resources);
 if(!real)for(const role of ['skin.item.normal','skin.item.selected']){
  const id=pack.roles.find(r=>r.role===role).assetId,a=pack.assets.find(a=>a.assetId===id),image={width:a.width,height:a.height,pixels:Buffer.alloc(a.width*a.height*4)};
  for(let y=0;y<image.height;y++)for(let x=17;x<image.width-18;x++)image.pixels.set([70,120,155,x<24||x>=image.width-24||y<3||y>=image.height-7?1:255],(y*image.width+x)*4);
  const bytes=encodePng(image);Object.assign(a,{sha256:hash(bytes),bytes:bytes.length,density:4,nineSlice:{left:12,right:12,top:8,bottom:7},minSize:{width:25,height:16},contentInsets:{left:0,right:0,top:0,bottom:0}});resources.set(a.file,bytes);
 }
 const bytes=real?await readFile(join(directory,'skin-pack.json')):Buffer.from(JSON.stringify(pack));
 return {pack,real:Boolean(real),skinPack:{manifest:bytes.toString('base64'),manifestSha256:hash(bytes),bindings:pack.bindings,resources:Object.fromEntries([...resources].map(([f,b])=>[f,b.toString('base64')]))}};
}
const alphaBounds=(bytes,threshold=128)=>{const im=decodePng(bytes);let x=im.width,y=im.height,r=0,b=0;for(let yy=0;yy<im.height;yy++)for(let xx=0;xx<im.width;xx++)if(im.pixels[(yy*im.width+xx)*4+3]>=threshold){x=Math.min(x,xx);y=Math.min(y,yy);r=Math.max(r,xx+1);b=Math.max(b,yy+1);}return {width:r-x,height:b-y,ratio:(r-x)/(b-y)};};
test('visible-square inventory preserves source pixels, aligns states, fits complete rows and survives mobile selection resize and JSON reopen',async()=>{
 const p=await packet(),h=await startHarness({skinPack:p.skinPack,profile:p.pack.theme,width:1440,height:1000}),ctxBase={...await editorData(),...settingsSkinGeometry(p.pack),profile:p.pack.theme,binding:{sourceKind:p.pack.sourceKind,sha256:p.skinPack.manifestSha256}},evidence={realVerifiedPackage:p.real,skinSha256:p.skinPack.manifestSha256,measurements:[],modelCalls:0};
 try{
  const measure=async normalized=>h.page.evaluate(async normalized=>{const result={};for(const state of ['normal','selected']){const v=normalized?harness.skin.inventorySlotView('skin.item.'+state,88,88):harness.skin.view('skin.item.'+state,88,88);try{result[state]=await harness.app.renderer.extract.base64({target:v,format:'png'});}finally{v.destroy();}}return result;},normalized),before=await measure(false),normalized=await measure(true);
  for(const state of ['normal','selected']){
   const prior=alphaBounds(Buffer.from(before[state].split(',')[1],'base64')),bytes=Buffer.from(normalized[state].split(',')[1],'base64'),current=alphaBounds(bytes);assert(Math.abs(current.width-current.height)<=2,JSON.stringify({state,prior,current}));assert(Math.abs(current.ratio-1)<Math.abs(prior.ratio-1));evidence.measurements.push({state,prior,current});
   if(process.env.UI_CHAIN_SLOT_EVIDENCE){await mkdir(process.env.UI_CHAIN_SLOT_EVIDENCE,{recursive:true});await writeFile(join(process.env.UI_CHAIN_SLOT_EVIDENCE,state+'.png'),bytes);}
  }
  const fit=await h.page.evaluate(()=>harness.skin.runtimeInventorySlotFit);assert.equal(fit.status,'normalized');evidence.crop=fit;
  for(const orientation of ['landscape','portrait']){
   const ctx=inventoryPresetContext({...ctxBase,orientation}),props={itemRecipeRef:'button@1.0.0',selection:'single',selectedId:'first',items:[{id:'first',label:'First',enabled:true,slotIndex:0,quantity:1,description:'Description',icon:null},{id:'last',label:'Last',enabled:true,slotIndex:19,quantity:9999,description:'Last item',icon:null}],inventory:{columns:5,rows:4,gap:10,details:orientation==='landscape'?'right':'below',appearance:'slots',cellSize:88,initialSlot:0,scrollMode:'fixed-cells-both-v1'}},doc=inventoryContentDocument(ctx,{title:'Inventory',props},inventoryLayoutConfig());
   const initial=await h.page.evaluate(({doc,ctx})=>{window.fitScene?.dispose();harness.clear();const board=ctx.canvases.presets[doc.canvas];harness.app.renderer.resize(board.width,board.height);harness.app.canvas.style.width=board.width+'px';harness.app.canvas.style.height=board.height+'px';window.fitScene=harness.compilePanel(doc,ctx);fitScene.runtime.setMode('play');fitScene.runtime.flush();window.fitNode=fitScene.runtime.handles.get('inventory-grid');const a=fitNode.adapter;return {snapshot:fitNode.snapshot(),geometry:a.geometry,viewport:{width:a.gridBox.width,height:a.gridBox.height},diagnostic:a.slotFit,title:fitScene.runtime.handles.get('inventory-heading').snapshot()};},{doc,ctx});
   for(const side of ['width','height'])assert(Math.abs((initial.viewport[side]+10)/98-Math.round((initial.viewport[side]+10)/98))<1e-8);
   assert.equal(initial.title.props.align,'center');assert.equal(initial.diagnostic.status,'normalized');assert.equal(initial.snapshot.props.inventory.slotFit,'visible-square-v1');assert.equal(initial.snapshot.props.inventory.viewportFit,'whole-slots-v1');
   const inspectCells=()=>h.page.evaluate(()=>{const a=fitNode.adapter,o=a.gridBox.toGlobal({x:0,y:0}),v={x:o.x,y:o.y,width:a.gridBox.width,height:a.gridBox.height};return a.cells.map(c=>{const b=c.view.getBounds();return {index:c.slotIndex,width:Math.max(0,Math.min(b.x+b.width,v.x+v.width)-Math.max(b.x,v.x)),height:Math.max(0,Math.min(b.y+b.height,v.y+v.height)-Math.max(b.y,v.y))};}).filter(c=>c.width>.1&&c.height>.1);});
   for(const c of await inspectCells()){assert(Math.abs(c.width-88)<.01);assert(Math.abs(c.height-88)<.01);}
   for(const mobile of [false,true]){
    if(mobile){await h.page.setViewportSize({width:390,height:844});const scale=await h.page.evaluate(()=>{const a=harness.app; a.canvas.style.width='390px';a.canvas.style.height=(a.screen.height*390/a.screen.width)+'px';const r=a.canvas.getBoundingClientRect();return {x:r.width/a.screen.width,y:r.height/a.screen.height};});assert(Math.abs(scale.x-scale.y)<.0001);evidence[orientation+'MobileScale']=scale;}
    await h.page.evaluate(()=>{const a=fitNode.adapter;a.gridBox.scrollX=-a.scrollbars.geometry.range.x;a.gridBox.scrollY=-a.scrollbars.geometry.range.y;a.gridBox.update();harness.app.render();});
    for(const c of await inspectCells()){assert(Math.abs(c.width-88)<.01);assert(Math.abs(c.height-88)<.01);}
    const point=await h.page.evaluate(()=>{const b=fitNode.adapter.cells[19].view.getBounds(),r=harness.app.canvas.getBoundingClientRect();return {x:r.x+(b.x+b.width/2)*r.width/harness.app.screen.width,y:r.y+(b.y+b.height/2)*r.height/harness.app.screen.height};});await h.page.mouse.click(point.x,point.y);await h.page.waitForFunction(()=>fitNode.readState().selectedId==='last');
    assert.deepEqual(await h.page.evaluate(()=>fitNode.snapshot()),initial.snapshot);
    if(process.env.UI_CHAIN_SLOT_EVIDENCE)await h.page.screenshot({path:join(process.env.UI_CHAIN_SLOT_EVIDENCE,orientation+(mobile?'-mobile':'-desktop')+'.png'),fullPage:true});
   }
   const reopen=await h.page.evaluate(({doc,ctx})=>{fitScene.dispose();harness.clear();window.fitScene=harness.compilePanel(JSON.parse(JSON.stringify(doc)),ctx);fitScene.runtime.flush();window.fitNode=fitScene.runtime.handles.get('inventory-grid');const a=fitNode.adapter;const before=JSON.stringify(fitNode.snapshot());let code;try{fitNode.resize(10,10);}catch(e){code=e.code;}return {state:fitNode.readState(),snapshot:fitNode.snapshot(),atomic:before===JSON.stringify(fitNode.snapshot()),code,fit:a.slotFit};},{doc,ctx});assert.equal(reopen.state.selectedId,'first');assert.equal(reopen.atomic,true);assert(reopen.code);assert.deepEqual(reopen.snapshot,initial.snapshot);evidence[orientation]={initial,reopen};
   await h.page.setViewportSize({width:1440,height:1000});
  }
  assert.deepEqual(await measure(false),before,'derived inventory views must not change legacy role pixels');assert.deepEqual(h.errors,[]);
  if(process.env.UI_CHAIN_SLOT_EVIDENCE)await writeFile(join(process.env.UI_CHAIN_SLOT_EVIDENCE,'report.json'),JSON.stringify(evidence,null,2));
 }finally{await h.page.evaluate(()=>window.fitScene?.dispose()).catch(()=>{});await h.close();}
});
test('unsuitable transparent margins stay renderable with an explicit diagnostic and unchanged original role pixels',async()=>{
 const p=await packet(),variant=structuredClone(p.skinPack),pack=JSON.parse(Buffer.from(variant.manifest,'base64'));
 for(const role of ['skin.item.normal','skin.item.selected'])pack.assets.find(a=>a.assetId===pack.roles.find(r=>r.role===role).assetId).nineSlice.left=1;
 const bytes=Buffer.from(JSON.stringify(pack));variant.manifest=bytes.toString('base64');variant.manifestSha256=hash(bytes);
 const h=await startHarness({skinPack:variant,profile:pack.theme});
 try{
  const result=await h.page.evaluate(async()=>{const skin=harness.skin,original=skin.view('skin.item.normal',88,88),candidate=skin.inventorySlotView('skin.item.normal',88,88);try{return {diagnostic:skin.runtimeInventorySlotFit,original:await harness.app.renderer.extract.base64({target:original,format:'png'}),candidate:await harness.app.renderer.extract.base64({target:candidate,format:'png'})};}finally{original.destroy();candidate.destroy();}});
  assert.equal(result.diagnostic.status,'unavailable');assert.equal(result.diagnostic.reason,'transparent-margin-crosses-slice');assert.equal(result.candidate,result.original);assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});
test('whole-slot runtime accepts its rail-aware minimum and rejects subminimum resize atomically without growing outside the node',async()=>{
 const p=await packet(),h=await startHarness({skinPack:p.skinPack,profile:p.pack.theme,width:1280,height:1000});
 try{
  const registry=upgradeInventoryRegistry(h.data.registry);await h.page.evaluate(registry=>{harness.runtime.registry.recipes.splice(0,harness.runtime.registry.recipes.length,...registry.recipes);},registry);
  for(const details of ['right','below'])for(const [columns,rows]of [[1,1],[1,2],[2,1],[2,2]]){
   const props={items:[],selectedId:null,itemRecipeRef:'button@1.0.0',selection:'single',inventory:{columns,rows,gap:10,details,appearance:'slots',cellSize:256,scrollMode:'fixed-cells-both-v1',slotFit:'visible-square-v1',viewportFit:'whole-slots-v1'}},minimum=inventoryMinimum(p.pack.theme,props,p.pack,{surfaceLayer:'inset'});
   const r=await h.page.evaluate(({props,minimum})=>{const node=harness.runtime.create({id:'minimum-fit',recipeRef:'list@1.0.0',surfaceLayer:'inset',props,size:minimum}),before=JSON.stringify(node.snapshot()),a=node.adapter,geometry=a.geometry,viewport={width:a.gridBox.width,height:a.gridBox.height};let code;try{node.resize(minimum.width-1,minimum.height);}catch(e){code=e.code;}const atomic=before===JSON.stringify(node.snapshot());node.dispose();return {geometry,viewport,atomic,code};},{props,minimum});
   assert(r.atomic);assert.equal(r.code,'inventory.geometry');for(const box of [r.geometry.grid.surface,r.geometry.details]){assert(box.x>=-.01);assert(box.y>=-.01);assert(box.x+box.width<=minimum.width+.01);assert(box.y+box.height<=minimum.height+.01);}for(const side of ['width','height'])assert.equal(r.viewport[side],256);
  }
  assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});
