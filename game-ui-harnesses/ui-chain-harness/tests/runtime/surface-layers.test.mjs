import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {materialSkinFixture} from '../../fixtures/material-skin.mjs';
import {extendSkinMaterials} from '../../src/skins/materials.mjs';
import {verifySkinPackage,hash} from '../../src/skins/package.mjs';
import {upgradeInventoryRegistry} from '../../src/runtime/inventory-policy.mjs';
import {startHarness} from './harness.mjs';
import {editorData} from '../../src/panel/data.mjs';
import {settingsSkinGeometry} from '../../src/panel/skin-geometry.mjs';
import {inventoryContentDocument,inventoryLayoutConfig,inventoryPanelConfig,inventoryPresetContext} from '../../src/panel/inventory-preset.mjs';
import {inventoryLayout} from '../../src/runtime/inventory-geometry.mjs';

async function packet(directory=process.env.UI_CHAIN_SURFACE_SKIN){
 if(!directory){const f=await materialSkinFixture(await mkdtemp(join(tmpdir(),'ui-layer-browser-')));directory=(await extendSkinMaterials({...f,output:join(f.directory,'decorated')})).packageDirectory;}
 const v=await verifySkinPackage(directory);return {pack:v.pack,skinPack:{manifest:(await readFile(join(directory,'skin-pack.json'))).toString('base64'),manifestSha256:v.manifestSha256,bindings:v.pack.bindings,resources:Object.fromEntries([...v.resources].map(([f,b])=>[f,b.toString('base64')]))}};
}

test('explicit layered PNG surfaces preserve text, native input, popup ownership, scrolling and derived texture lifetime',async()=>{
 const p=await packet(),h=await startHarness({width:1280,height:900,skinPack:p.skinPack,profile:p.pack.theme});
 try{
  for(const layer of ['frame','content','inset']){
   const state=await h.page.evaluate(layer=>{
    harness.clear();const role=layer==='frame'?'skin.surface.panel':'skin.surface.content',pad={left:40,right:40,top:40,bottom:40};
    window.layerNode=harness.make('Panel',{surfaceLayer:layer,size:{width:540,height:300},props:{title:'',contentPadding:pad}});
    harness.runtime.flush();const a=layerNode.adapter,l=a.layer,e=harness.runtime.textColors.refresh().find(e=>e.text==='面板内容');
    return {layer:layerNode.snapshot().surfaceLayer,role:l.info.baseRole,textRole:e?.role,material:Boolean(l.material),derived:Boolean(l.derivedTexture),outline:Boolean(l.outline),sample:l.info.sample,color:e?.fill,expected:harness.skin.profile.textColors?.[role],baseEvent:l.view.eventMode};
   },layer);
   assert.equal(state.layer,layer);assert.equal(state.role,layer==='frame'?'skin.surface.panel':'skin.surface.content');assert.equal(state.textRole,state.role);assert.equal(state.material,layer==='frame');assert.equal(state.derived,layer==='inset');assert.equal(state.outline,layer==='inset');assert.equal(state.baseEvent,'none');if(state.expected)assert.equal(state.color,state.expected);
   if(layer==='inset'){assert(state.sample.width>=2&&state.sample.height>=2);const lifetime=await h.page.evaluate(()=>{const a=layerNode.adapter.layer,t=a.derivedTexture,source=t.source;layerNode.resize(520,280);const reused=a.derivedTexture===t;layerNode.dispose();return {reused,destroyed:t.destroyed,sourceAlive:!source.destroyed,skinAlive:harness.skin.texture('skin.surface.content').source===source};});assert.deepEqual(lifetime,{reused:true,destroyed:true,sourceAlive:true,skinAlive:true});}
  }
  const heading=await h.page.evaluate(()=>{harness.clear();const insets={left:80,right:40,top:12,bottom:12},n=harness.runtime.create({id:'safe-heading',recipeRef:'text@1.0.0',surfaceStyle:'title',surfaceTextInsets:insets,props:{text:'Safe heading',textStyleRef:'body',overflow:'error'},size:{width:600,height:64}});harness.runtime.mount(n);insets.left=0;const first=n.adapter.text.x;n.resize(580,64);return {first,after:n.adapter.text.x,snapshot:n.snapshot().surfaceTextInsets};});
  assert.equal(heading.first,80);assert.equal(heading.after,80);assert.equal(heading.snapshot.left,80);
  const multiplier=await h.page.evaluate(()=>{
   harness.clear();const r=harness.runtime,child=r.create({id:'multiplier-child',recipeRef:'text@1.0.0',props:{text:'Body',textStyleRef:'body'},size:{width:200,height:30}}),input={id:'bad-multiplier',recipeRef:'panel@1.0.0',surfaceLayer:'content',props:{title:'',pixelsPerUnitMultiplier:2,contentPadding:{left:40,right:40,top:40,bottom:40}},size:{width:400,height:240}},before=JSON.stringify(input),count=r.handles.size;
   let code;try{r.create(input,{content:[child]});}catch(e){code=e.code;}
   const unchanged=before===JSON.stringify(input)&&r.handles.size===count&&child.parent===null;
   const good=r.create({...input,id:'good-multiplier',props:{...input.props,pixelsPerUnitMultiplier:1}},{content:[child]});r.mount(good);const explicit=good.snapshot().props.pixelsPerUnitMultiplier;good.dispose();
   const oldChild=r.create({id:'old-multiplier-child',recipeRef:'text@1.0.0',props:{text:'Body',textStyleRef:'body'},size:{width:200,height:30}}),legacy={...input,id:'old-multiplier'};delete legacy.surfaceLayer;const old=r.create(legacy,{content:[oldChild]});r.mount(old);return {code,unchanged,explicit,legacy:old.snapshot().props.pixelsPerUnitMultiplier};
  });
  assert.deepEqual(multiplier,{code:'skin.surface-style',unchanged:true,explicit:1,legacy:2});
  // A semantic content panel does not cover descendants or take their events.
  await h.page.evaluate(()=>{
   harness.clear();const r=harness.runtime;
   window.layerInput=harness.make('Input',{id:'layer-input',size:{width:300,height:48}},false);
   window.layerSelect=harness.make('Select',{id:'layer-select',size:{width:300,height:48}},false);
   window.layerButton=harness.make('Button',{id:'layer-button',size:{width:300,height:48}},false);
   const body=r.create({id:'layer-body',recipeRef:'container@1.0.0',props:{},size:{width:320,height:240},layout:{childrenMode:'flow',direction:'column',gap:16,padding:0}},{children:[layerInput,layerSelect,layerButton]});
   const panel=r.create({id:'layer-panel',recipeRef:'panel@1.0.0',surfaceLayer:'content',props:{title:'',contentPadding:{left:30,right:30,top:30,bottom:30}},size:{width:400,height:330},position:{x:20,y:20}},{content:[body]});r.mount(panel);panel.root.position.set(20,20);r.flush();
  });
  const click=async name=>{const q=await h.page.evaluate(name=>harness.point(window[name]),name);await h.page.mouse.click(q.x,q.y);};
  await click('layerInput');const input=h.page.locator('input');await input.fill('layered-input');await input.press('Enter');assert.equal(await h.page.evaluate(()=>layerInput.readState().value),'layered-input');
  await click('layerSelect');await h.page.waitForFunction(()=>layerSelect.adapter.view.expanded);
  const popup=await h.page.evaluate(()=>{const a=layerSelect.adapter.view,b=a.scrollBox.items.at(-1).getBounds();return {x:b.x+b.width/2,y:b.y+b.height/2,id:layerSelect.props.options.at(-1).id};});await h.page.mouse.click(popup.x,popup.y);assert.equal(await h.page.evaluate(()=>layerSelect.readState().selectedId),popup.id);
  await click('layerButton');assert(await h.page.evaluate(()=>harness.events.some(e=>e.nodeId==='layer-button'&&e.event==='activate')));
  for(const type of ['Dialog','ScrollView','Tabs','List']){
   const detail=await h.page.evaluate(type=>{harness.clear();window.layerNode=harness.make(type,{surfaceLayer:type==='Dialog'?'frame':'content',size:{width:600,height:type==='Dialog'?360:320}});harness.runtime.flush();const a=layerNode.adapter;return {layer:layerNode.snapshot().surfaceLayer,role:(a.layer??a.view.layerSurface)?.info.baseRole,material:Boolean((a.layer??a.view.layerSurface)?.material),outer:a.outerBackground?true:false,inner:a.background?true:false};},type);
   assert.equal(detail.role,type==='Dialog'?'skin.surface.panel':'skin.surface.content');if(type==='Dialog')assert(detail.material);if(type==='Tabs')assert.equal(detail.inner,false);
   if(type==='ScrollView'){
    const q=await h.page.evaluate(()=>{const b=layerNode.adapter.box.getBounds();return {x:b.x+30,y:b.y+30};});await h.page.mouse.move(q.x,q.y);await h.page.mouse.wheel(0,120);await h.page.waitForFunction(()=>layerNode.adapter.box.scrollY<0);
   }
   await h.page.evaluate(type=>layerNode.resize(type==='ScrollView'?620:580,layerNode.size.height),type);
  }
  // UV frames use logical source coordinates at density two as well as scale two.
  const densityPacket=await packet(null);
  for(const mode of ['scale','density']){
   const variant=structuredClone(densityPacket.skinPack),metadata=JSON.parse(Buffer.from(variant.manifest,'base64'));
   if(mode==='scale')metadata.scale=2;else metadata.assets.find(a=>a.assetId===metadata.roles.find(r=>r.role==='skin.surface.content').assetId).density=2;
   const bytes=Buffer.from(JSON.stringify(metadata));variant.manifest=bytes.toString('base64');variant.manifestSha256=hash(bytes);
   const proof=await h.page.evaluate(async packet=>{
    harness.clear();const skin=await harness.loadPack(packet),texture=skin.texture('skin.surface.content');
    const r=harness.runtimeForSkin(skin),text=r.create({id:'density-text',recipeRef:'text@1.0.0',props:{text:'Body',textStyleRef:'body'},size:{width:180,height:30}}),panel=r.create({id:'density-panel',recipeRef:'panel@1.0.0',surfaceLayer:'inset',props:{title:'',contentPadding:{left:20,right:20,top:20,bottom:20}},size:{width:300,height:180}},{content:[text]});r.mount(panel);
    const l=panel.adapter.layer,s=l.info.sample,f=l.derivedTexture.frame,result={frame:{x:f.x,y:f.y,width:f.width,height:f.height},sample:s,sourceFrame:{width:texture.frame.width,height:texture.frame.height}};r.dispose();skin.dispose();return result;
   },variant);
   assert(Math.abs(proof.frame.x-proof.sample.x/proof.sample.sourceWidth*proof.sourceFrame.width)<1e-6);assert(Math.abs(proof.frame.width-proof.sample.width/proof.sample.sourceWidth*proof.sourceFrame.width)<1e-6);
  }
  assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});

test('layer slot create and parent/child resize fail atomically before taking ownership or clipping, with valid dynamic content preserved',async()=>{
 const p=await packet(),h=await startHarness({skinPack:p.skinPack,profile:p.pack.theme});
 try{
  const result=await h.page.evaluate(()=>{
   harness.clear();const r=harness.runtime,child=r.create({id:'slot-child',recipeRef:'text@1.0.0',props:{text:'Body',textStyleRef:'body'},size:{width:350,height:48}}),input={id:'slot-panel',recipeRef:'panel@1.0.0',surfaceLayer:'content',props:{title:'',contentPadding:{left:40,right:40,top:40,bottom:40}},size:{width:400,height:200}},before=JSON.stringify(input),count=r.handles.size;
   let createCode;try{r.create(input,{content:[child]});}catch(e){createCode=e.code;}
   const untouched=JSON.stringify(input)===before&&r.handles.size===count&&child.parent===null;
   const parent=r.create({...input,size:{width:500,height:240}},{content:[child]});r.mount(parent);const authored=JSON.stringify(parent.snapshot()),initial={...parent.size};
   let parentCode;try{parent.resize(400,200);}catch(e){parentCode=e.code;}
   const parentAtomic=JSON.stringify(parent.snapshot())===authored&&JSON.stringify(parent.size)===JSON.stringify(initial);
   child.resize(300,48);parent.resize(400,200);const after=JSON.stringify(child.snapshot());let childCode;try{child.resize(350,48);}catch(e){childCode=e.code;}
   const childAtomic=JSON.stringify(child.snapshot())===after&&child.size.width===300;parent.dispose();
   const row=r.create({id:'slot-row',recipeRef:'text@1.0.0',props:{text:'Flow body',textStyleRef:'body'},size:{width:200,height:48}}),body=r.create({id:'slot-dynamic',recipeRef:'container@1.0.0',props:{},size:{width:200,height:24},sizing:{heightMode:'content'},layout:{childrenMode:'flow',direction:'column',gap:0,padding:0}},{children:[row]}),dynamic=r.create({...input,id:'dynamic-panel'},{content:[body]});r.mount(dynamic);
   return {createCode,untouched,parentCode,parentAtomic,childCode,childAtomic,dynamicHeight:body.size.height,dynamicAuthored:body.snapshot().size.height};
  });
  assert.deepEqual(result,{createCode:'panel.slot-bounds',untouched:true,parentCode:'panel.slot-bounds',parentAtomic:true,childCode:'panel.slot-bounds',childAtomic:true,dynamicHeight:48,dynamicAuthored:24});assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});

test('actual pixel default inventory gap bars drag to the final cell in both orientations and preserve selection export and fixed cells',async()=>{
 const p=await packet(),base={...await editorData(),...settingsSkinGeometry(p.pack),profile:p.pack.theme,binding:{sourceKind:p.pack.sourceKind,sha256:p.skinPack.manifestSha256}},layout=inventoryLayoutConfig(inventoryPanelConfig),h=await startHarness({width:1280,height:900,skinPack:p.skinPack,profile:p.pack.theme});
 try{
  for(const orientation of ['landscape','portrait']){
   const ctx=inventoryPresetContext({...base,orientation}),props={itemRecipeRef:'button@1.0.0',selection:'single',selectedId:'first',items:[{id:'first',label:'初始物品',enabled:true,slotIndex:0,quantity:1,description:'说明',icon:null},{id:'last',label:'末格物品',enabled:true,slotIndex:19,quantity:9999,description:'完整详情。'.repeat(80),icon:null}],inventory:{columns:5,rows:4,gap:10,details:orientation==='landscape'?'right':'below',appearance:'slots',cellSize:88,initialSlot:0,scrollMode:'fixed-cells-both-v1'}},document=inventoryContentDocument(ctx,{title:'仓库面板',sectionTitle:'仓库面板',label:'仓库',props},layout);
   const initial=await h.page.evaluate(({document,ctx})=>{
    window.gapInventory?.dispose();harness.clear();const board=ctx.canvases.presets[document.canvas];harness.app.renderer.resize(board.width,board.height);harness.app.canvas.style.width=board.width+'px';harness.app.canvas.style.height=board.height+'px';window.gapInventory=harness.compilePanel(document,ctx);gapInventory.runtime.setMode('play');gapInventory.runtime.flush();window.gapNode=gapInventory.runtime.handles.get('inventory-grid');const a=gapNode.adapter;return {bars:{x:a.scrollbars.roots.x.visible,y:a.scrollbars.roots.y.visible},chrome:a.scrollbars.geometry,grid:a.geometry.grid,cell:a.geometry.cell.width,snapshot:gapNode.snapshot()};
   },{document,ctx});
   const axis=orientation==='landscape'?'y':'x';assert.equal(initial.bars[axis],true);assert.equal(initial.bars[axis==='x'?'y':'x'],false);assert.equal(initial.chrome[axis].placement,'gap');assert.equal(initial.cell,88);assert.equal(initial.chrome.viewport.width,initial.grid.width);assert.equal(initial.chrome.viewport.height,initial.grid.height);
   const coordinates=await h.page.evaluate(axis=>{const bar=gapNode.adapter.scrollbars.bars[axis],thumb=bar.slider1.getBounds(),end=bar.bg.toGlobal({x:bar.bg.width/2,y:bar.bg.height-bar.slider1.height/2}),r=harness.app.canvas.getBoundingClientRect(),sx=r.width/harness.app.screen.width,sy=r.height/harness.app.screen.height;return {start:{x:r.x+(thumb.x+thumb.width/2)*sx,y:r.y+(thumb.y+thumb.height/2)*sy},end:{x:r.x+end.x*sx,y:r.y+end.y*sy}};},axis);
   await h.page.mouse.move(coordinates.start.x,coordinates.start.y);await h.page.mouse.down();await h.page.mouse.move(coordinates.end.x,coordinates.end.y,{steps:12});await h.page.mouse.up();
   await h.page.waitForFunction(axis=>{const a=gapNode.adapter;return Math.abs(a.gridBox[axis==='x'?'scrollX':'scrollY']+a.scrollbars.geometry.range[axis])<1;},axis);
   const cellPoint=await h.page.evaluate(()=>{const b=gapNode.adapter.cells[19].button.getBounds(),r=harness.app.canvas.getBoundingClientRect();return {x:r.x+(b.x+b.width/2)*r.width/harness.app.screen.width,y:r.y+(b.y+b.height/2)*r.height/harness.app.screen.height};});await h.page.mouse.click(cellPoint.x,cellPoint.y);await h.page.waitForFunction(()=>gapNode.readState().selectedId==='last');
   const detail=await h.page.evaluate(()=>{const a=gapNode.adapter;return {text:a.detailDescription.text,width:a.detailDescription.width,safe:a.geometry.details.contentWidth,contentHeight:a.detailsBox.contentHeight,viewportHeight:a.detailsBox.height,detailLayer:a.detailSurface.info.layer};});
   assert.equal(detail.text,'完整详情。'.repeat(80));assert(detail.width<=detail.safe);assert(detail.contentHeight>detail.viewportHeight);assert.equal(detail.detailLayer,'inset');
   const detailPoint=await h.page.evaluate(()=>{const b=gapNode.adapter.detailsBox.getBounds(),r=harness.app.canvas.getBoundingClientRect();return {x:r.x+(b.x+30)*r.width/harness.app.screen.width,y:r.y+(b.y+30)*r.height/harness.app.screen.height};});await h.page.mouse.move(detailPoint.x,detailPoint.y);await h.page.mouse.wheel(0,10000);await h.page.waitForFunction(()=>gapNode.adapter.detailsBox.scrollY<0);
   assert.deepEqual(await h.page.evaluate(()=>gapNode.snapshot()),initial.snapshot);assert.deepEqual(await h.page.evaluate(()=>JSON.parse(JSON.stringify(gapInventory.document))),document);
   if(process.env.UI_CHAIN_INVENTORY_EVIDENCE)await h.page.screenshot({path:join(process.env.UI_CHAIN_INVENTORY_EVIDENCE,'inventory-gap-'+orientation+'.png')});
  }
  await h.page.evaluate(()=>gapInventory.dispose());assert.equal(await h.page.evaluate(()=>harness.liveScrollBoxes()),0);assert.deepEqual(h.errors,[]);
 }finally{await h.page.evaluate(()=>window.gapInventory?.dispose()).catch(()=>{});await h.close();}
});

test('inventory bars appear only for real resized ranges, cancel on edit, and disappear with clamped offsets without touching authoring',async()=>{
 const p=await packet(),h=await startHarness({width:390,height:844,skinPack:p.skinPack,profile:p.pack.theme}),registry=upgradeInventoryRegistry(h.data.registry);
 try{
  await h.page.evaluate(registry=>{
   harness.clear();harness.runtime.registry.recipes.splice(0,harness.runtime.registry.recipes.length,...registry.recipes);
   const r=harness.runtime,make=(id,columns,rows)=>r.create({id,recipeRef:'list@1.0.0',surfaceLayer:'content',props:{items:[],selectedId:null,itemRecipeRef:'button@1.0.0',selection:'single',inventory:{columns,rows,cellSize:88,gap:10,details:'below',appearance:'slots',scrollMode:'fixed-cells-both-v1'}},size:{width:370,height:650}});
   const one=make('one-cell',1,1);r.mount(one);window.oneCell=one;
  },registry);
  assert.deepEqual(await h.page.evaluate(()=>({x:oneCell.adapter.scrollbars.roots.x.visible,y:oneCell.adapter.scrollbars.roots.y.visible,cell:oneCell.adapter.geometry.cell.width})),{x:false,y:false,cell:88});
  await h.page.evaluate(()=>{oneCell.dispose();window.resizedInventory=harness.runtime.create({id:'resize-inventory',recipeRef:'list@1.0.0',surfaceLayer:'content',props:{items:[],selectedId:null,itemRecipeRef:'button@1.0.0',selection:'single',inventory:{columns:3,rows:3,cellSize:88,gap:10,details:'below',appearance:'slots',scrollMode:'fixed-cells-both-v1'}},size:{width:370,height:650}});harness.runtime.mount(resizedInventory);resizedInventory.resize(300,650);});
  const before=await h.page.evaluate(()=>({snapshot:resizedInventory.snapshot(),x:resizedInventory.adapter.scrollbars.roots.x.visible,y:resizedInventory.adapter.scrollbars.roots.y.visible}));assert.equal(before.x,true);assert.equal(before.y,false);
  const q=await h.page.evaluate(()=>{const bar=resizedInventory.adapter.scrollbars.bars.x,b=bar.slider1.getBounds(),end=bar.bg.toGlobal({x:bar.bg.width/2,y:bar.bg.height-bar.slider1.height/2});return {x:b.x+b.width/2,y:b.y+b.height/2,end};});
  await h.page.mouse.move(q.x,q.y);await h.page.mouse.down();await h.page.mouse.move(q.end.x,q.end.y,{steps:6});
  const cancelled=await h.page.evaluate(()=>{const bar=resizedInventory.adapter.scrollbars.bars.x;harness.runtime.setMode('edit');return {dragging:Boolean(bar.dragging),snapshot:resizedInventory.snapshot(),offset:resizedInventory.adapter.gridBox.scrollX};});await h.page.mouse.up();assert.equal(cancelled.dragging,false);assert.deepEqual(cancelled.snapshot,before.snapshot);assert(cancelled.offset<0);
  const expanded=await h.page.evaluate(()=>{harness.runtime.setMode('play');resizedInventory.resize(370,650);const a=resizedInventory.adapter;return {x:a.scrollbars.roots.x.visible,y:a.scrollbars.roots.y.visible,offset:a.gridBox.scrollX,cell:a.geometry.cell.width};});assert.deepEqual(expanded,{x:false,y:false,offset:0,cell:88});
  await h.page.evaluate(()=>resizedInventory.dispose());assert.equal(await h.page.evaluate(()=>harness.liveScrollBoxes()),0);assert.deepEqual(h.errors,[]);
 }finally{await h.close();}
});

test('explicit new inventory surfaces restore PNG cells and content plates while old slots remain unchanged',async()=>{
 const p=await packet(),h=await startHarness({width:390,height:844,skinPack:p.skinPack,profile:p.pack.theme});
 try{
  // Keep the full-size canvas from adding inline-baseline page overflow. Page
  // scrolling would shift screenshot clipping by a pixel after wheel gestures.
  await h.page.addStyleTag({content:'canvas{display:block}body{overflow:hidden}'});
  const data={...h.data,registry:upgradeInventoryRegistry(h.data.registry)};
  let legacyPixels;
  for(const surfaceLayer of [undefined,'content',undefined]){
   const probeProps={items:[{id:'last',label:'Last',enabled:true,slotIndex:143,quantity:9999,description:'Detail',icon:null}],selectedId:null,selection:'single',itemRecipeRef:'button@1.0.0',inventory:{columns:12,rows:12,gap:10,details:'below',appearance:'slots',scrollMode:'fixed-cells-both-v1'}},cellSize=Math.max(80,inventoryLayout(p.pack.theme,probeProps,370,650,p.pack,{surfaceLayer}).cell.minimum);
   const result=await h.page.evaluate(({data,surfaceLayer,cellSize})=>{
    window.inventoryLayer?.dispose();harness.clear();const r=harness.runtimeForSkin(harness.skin);r.registry.recipes.splice(0,r.registry.recipes.length,...data.registry.recipes);
    const n=r.create({id:'surface-inventory',recipeRef:'list@1.0.0',surfaceLayer,props:{items:[{id:'last',label:'Last',enabled:true,slotIndex:143,quantity:9999,description:'Detail '.repeat(100),icon:null}],itemRecipeRef:'button@1.0.0',selection:'single',selectedId:null,inventory:{columns:12,rows:12,gap:10,details:'below',appearance:'slots',cellSize,scrollMode:'fixed-cells-both-v1'}},size:{width:370,height:650}});r.mount(n);window.inventoryLayer=r;window.inventoryNode=n;return {cell:n.adapter.geometry.cell.width,plates:Boolean(n.adapter.gridSurface&&n.adapter.detailSurface),skinRoles:n.adapter.cells[0].button.skinRoles,grid:n.adapter.geometry.grid};
   },{data,surfaceLayer,cellSize});
   assert.equal(result.cell,cellSize);assert.equal(result.plates,Boolean(surfaceLayer));assert.equal(Boolean(result.skinRoles),Boolean(surfaceLayer));
   const q=await h.page.evaluate(()=>{const a=inventoryNode.adapter,p=a.gridBox.toGlobal({x:30,y:30});return {x:p.x,y:p.y};});await h.page.mouse.move(q.x,q.y);await h.page.mouse.wheel(10000,10000);await h.page.waitForFunction(()=>{const a=inventoryNode.adapter,g=a.geometry.grid;return Math.abs(a.gridBox.scrollX-(a.gridBox.width-g.contentWidth))<1&&Math.abs(a.gridBox.scrollY-(a.gridBox.height-g.contentHeight))<1;});
   const b=await h.page.evaluate(()=>{harness.app.render();const b=inventoryNode.adapter.cells[143].button.getBounds();return {x:b.x+b.width/2,y:b.y+b.height/2};});await h.page.mouse.click(b.x,b.y);await h.page.waitForFunction(()=>inventoryNode.readState().selectedId==='last');
   if(!surfaceLayer){await h.page.mouse.move(1,800);await h.page.evaluate(async()=>{inventoryLayer.flush();await new Promise(requestAnimationFrame);inventoryLayer.flush();});const pixels=await h.page.locator('canvas').screenshot();if(process.env.UI_CHAIN_INVENTORY_EVIDENCE)await writeFile(join(process.env.UI_CHAIN_INVENTORY_EVIDENCE,legacyPixels?'legacy-after-layer.png':'legacy-before-layer.png'),pixels);if(legacyPixels)assert.equal(hash(pixels),hash(legacyPixels),'legacy pixels must not change after enhanced-layer rendering');else legacyPixels=pixels;assert.equal(await h.page.evaluate(()=>inventoryNode.adapter.scrollbars),null);}
   if(process.env.UI_CHAIN_INVENTORY_EVIDENCE)await h.page.screenshot({path:join(process.env.UI_CHAIN_INVENTORY_EVIDENCE,surfaceLayer?'inventory-layered.png':'inventory-legacy.png')});
  }
  await h.page.evaluate(()=>inventoryLayer.dispose());assert.equal(await h.page.evaluate(()=>harness.liveScrollBoxes()),0);assert.deepEqual(h.errors,[]);
 }finally{await h.page.evaluate(()=>window.inventoryLayer?.dispose()).catch(()=>{});await h.close();}
});

test('current inventory compiler produces a layered, skinned, portable authoring document that renders at a phone viewport',async()=>{
 const p=await packet(),ctx=inventoryPresetContext({...await editorData(),...settingsSkinGeometry(p.pack),profile:p.pack.theme,binding:{sourceKind:p.pack.sourceKind,sha256:p.skinPack.manifestSha256},orientation:'portrait'}),layout=inventoryLayoutConfig(inventoryPanelConfig);
 const props={itemRecipeRef:'button@1.0.0',selection:'single',selectedId:'last',items:[{id:'last',label:'末格物品',enabled:true,slotIndex:143,quantity:9999,description:'完整的物品说明，保持独立滚动和来源。'.repeat(12),icon:null}],inventory:{columns:12,rows:12,gap:10,details:'below',appearance:'slots',cellSize:80,initialSlot:143,scrollMode:'fixed-cells-both-v1'}};
 delete props.inventory.cellSize;props.inventory.cellSize=Math.max(80,inventoryLayout(p.pack.theme,props,600,650,p.pack,{surfaceLayer:'content'}).cell.minimum);
 const document=inventoryContentDocument(ctx,{title:'物品仓库',sectionTitle:'珍藏物品',label:'珍藏物品',props},layout);
 assert.equal(document.nodes.find(n=>n.id==='inventory-grid').surfaceLayer,'inset');assert.equal(document.nodes.find(n=>n.id==='inventory-surface').surfaceLayer,'frame');assert.equal(document.nodes.find(n=>n.id==='inventory-surface').surfaceScale,3);const heading=document.nodes.find(n=>n.id==='inventory-heading');assert.equal(heading.surfaceStyle,'title');assert.equal(heading.surfaceBand,'reference-v1');assert(heading.surfaceFontSize>=24);
 const legacy=inventoryContentDocument(ctx,{title:'物品仓库',sectionTitle:'珍藏物品',label:'珍藏物品',props},inventoryLayoutConfig(inventoryPanelConfig,{reference:false}));assert.equal(legacy.nodes.find(n=>n.id==='inventory-grid').surfaceLayer,'content');assert.equal(legacy.nodes.find(n=>n.id==='inventory-surface').surfaceScale,undefined);assert.equal(legacy.nodes.find(n=>n.id==='inventory-heading').surfaceBand,undefined);assert.equal(legacy.nodes.find(n=>n.id==='inventory-heading').surfaceFontSize,undefined);
 const h=await startHarness({width:390,height:844,skinPack:p.skinPack,profile:p.pack.theme});
 try{
  const rendered=await h.page.evaluate(({document,ctx})=>{harness.clear();harness.app.renderer.resize(720,1280);harness.app.canvas.style.width='390px';harness.app.canvas.style.height=(1280*390/720)+'px';const scene=harness.compilePanel(document,ctx);window.compilerInventory=scene;scene.runtime.setMode('play');scene.runtime.flush();const grid=scene.runtime.handles.get('inventory-grid'),a=grid.adapter;return {selected:grid.readState().selectedId,cell:a.geometry.cell.width,plates:Boolean(a.gridSurface&&a.detailSurface),detailLayer:a.detailSurface.info.layer,title:scene.runtime.handles.get('inventory-heading').adapter.surface.style.baseRole,frameScale:scene.runtime.handles.get('inventory-surface').snapshot().surfaceScale,heading:scene.runtime.handles.get('inventory-heading').snapshot(),doc:scene.document};},{document,ctx});
  assert.equal(rendered.selected,'last');assert.equal(rendered.cell,props.inventory.cellSize);assert(rendered.plates);assert.equal(rendered.detailLayer,'inset');assert.equal(rendered.title,'skin.surface.bar');assert.equal(rendered.frameScale,3);assert.equal(rendered.heading.surfaceBand,'reference-v1');assert.equal(rendered.heading.surfaceFontSize,heading.surfaceFontSize);assert.deepEqual(rendered.doc,document);
  if(process.env.UI_CHAIN_INVENTORY_EVIDENCE)await h.page.screenshot({path:join(process.env.UI_CHAIN_INVENTORY_EVIDENCE,'inventory-compiler.png')});
  await h.page.evaluate(()=>compilerInventory.dispose());assert.deepEqual(h.errors,[]);
 }finally{await h.page.evaluate(()=>window.compilerInventory?.dispose()).catch(()=>{});await h.close();}
});
