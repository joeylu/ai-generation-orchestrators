import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {startHarness} from './harness.mjs';
import {upgradeInventoryRegistry} from '../../src/runtime/inventory-policy.mjs';

const makeFixture=({data,columns,rows})=>{
  window.inventoryScrollFixture?.scene.dispose();harness.clear();
  const registry=data.registry,capacity=columns*rows,ctx={registry,usage:data.usage,template:data.template,profile:harness.skin.profile,canvases:{presets:{portrait:{width:360,height:640}}},binding:{sourceKind:'fixture',sha256:'a'.repeat(64)}};
  const item=(slot)=>({id:'item'+slot,label:slot?'末格物品':'初始物品',enabled:true,slotIndex:slot,quantity:9999,description:'完整详情用于独立滚动验证。'.repeat(40),icon:null});
  const props={itemRecipeRef:'button@1.0.0',selection:'single',selectedId:'item0',items:[item(0),item(capacity-1)],inventory:{columns,rows,gap:10,details:'below',appearance:'slots',cellSize:80,initialSlot:0,scrollMode:'fixed-cells-both-v1'}};
  const document={kind:'ui_panel_document',version:'0.3',id:'inventory-scroll',revision:0,title:'双轴仓库',canvas:'portrait',bindings:ctx.binding,rootId:'board',nodes:[
   {id:'board',name:'board',recipeRef:'container@1.0.0',props:{},size:{width:360,height:640},slots:{children:['inventory']},layout:{childrenMode:'free',padding:0}},
   {id:'inventory',name:'inventory',recipeRef:'list@1.0.0',props,size:{width:340,height:600},position:{x:10,y:10},slots:{}}
  ]};
  const scene=harness.compilePanel(document,ctx);scene.runtime.setMode('play');scene.runtime.flush();
  window.inventoryScrollFixture={scene,document,ctx,grid:scene.runtime.handles.get('inventory'),live:()=>harness.liveScrollBoxes()};
  return {capacity,geometry:window.inventoryScrollFixture.grid.adapter.geometry};
 };

test('390px runtime preserves 12×12 and 32×4 fixed cells, independent scrolling, selection, zoom, state and exports',async()=>{
 const h=await startHarness({width:390,height:844});
 try{
  h.data.registry=upgradeInventoryRegistry(h.data.registry);
  const inspect=()=>h.page.evaluate(()=>{const f=inventoryScrollFixture,a=f.grid.adapter;return {x:a.gridBox.scrollX,y:a.gridBox.scrollY,selected:f.grid.readState().selectedId,slot:a.selectedSlot,name:a.detailName.text,detailY:a.detailsBox.scrollY,cell:a.geometry.cell.width,geometry:a.geometry,document:f.document,snapshot:f.grid.snapshot()};});
  const point=()=>h.page.evaluate(()=>{const a=inventoryScrollFixture.grid.adapter,p=a.gridBox.toGlobal({x:a.geometry.grid.width/2,y:40}),r=harness.app.canvas.getBoundingClientRect();return {x:r.x+p.x,y:r.y+p.y};});
  const clickSlot=async slot=>{const p=await h.page.evaluate(slot=>{harness.app.render();const b=inventoryScrollFixture.grid.adapter.cells[slot].button.getBounds(),r=harness.app.canvas.getBoundingClientRect();return {x:r.x+b.x+b.width/2,y:r.y+b.y+b.height/2};},slot);await h.page.mouse.click(p.x,p.y);};
  for(const [columns,rows]of [[12,12],[32,4]]){
   const initial=await h.page.evaluate(makeFixture,{data:h.data,columns,rows}),capacity=columns*rows;
   assert.equal(initial.capacity,capacity);assert.equal(initial.geometry.cell.width,80);assert.equal(initial.geometry.grid.columns,columns);assert.equal(initial.geometry.grid.rows,rows);
   const authored=await inspect();
   for(const id of ['item'+(capacity-1),'item0',null,'item'+(capacity-1)]){
    await h.page.evaluate(id=>inventoryScrollFixture.grid.setState({selectedId:id}),id);
    const state=await inspect();assert.equal(state.selected,id);assert.equal(state.slot,id===null?null:id==='item0'?0:capacity-1);assert.deepEqual(state.snapshot,authored.snapshot);
   }
   const invalid=await h.page.evaluate(()=>{const f=inventoryScrollFixture,before=f.grid.readState();try{f.grid.setState({selectedId:'missing-item'});return {accepted:true};}catch(e){return {code:e.code,before,after:f.grid.readState()};}});
   assert.equal(invalid.code,'state.invalid');assert.deepEqual(invalid.after,invalid.before);
   await h.page.evaluate(()=>inventoryScrollFixture.grid.setState({selectedId:'item0'}));
   const before=await inspect(),p=await point();await h.page.mouse.move(p.x,p.y);await h.page.mouse.wheel(120,0);await h.page.waitForFunction(()=>inventoryScrollFixture.grid.adapter.gridBox.scrollX<0);
   const horizontal=await inspect();assert(horizontal.x<0);assert.equal(horizontal.y,0);assert.equal(horizontal.selected,before.selected);assert.deepEqual(horizontal.snapshot,before.snapshot);
   await h.page.mouse.wheel(0,120);if(initial.geometry.grid.scrollableY)await h.page.waitForFunction(()=>inventoryScrollFixture.grid.adapter.gridBox.scrollY<0);
   const vertical=await inspect();assert.equal(vertical.x,horizontal.x);assert.equal(vertical.y<0,initial.geometry.grid.scrollableY);
   await h.page.keyboard.down('Shift');await h.page.mouse.wheel(0,120);await h.page.keyboard.up('Shift');await h.page.waitForFunction(x=>inventoryScrollFixture.grid.adapter.gridBox.scrollX<x,vertical.x);
   const shifted=await inspect();assert.equal(shifted.y,vertical.y);
   await h.page.mouse.wheel(10000,10000);await h.page.waitForFunction(()=>{const a=inventoryScrollFixture.grid.adapter,g=a.geometry.grid;return Math.abs(a.gridBox.scrollX-(g.width-g.contentWidth))<1&&Math.abs(a.gridBox.scrollY-Math.min(0,g.height-g.contentHeight))<1;});
   await clickSlot(capacity-1);await h.page.waitForFunction(id=>inventoryScrollFixture.grid.readState().selectedId===id,'item'+(capacity-1));
   assert.equal((await inspect()).name,'末格物品');await clickSlot(capacity-2);await h.page.waitForFunction(slot=>inventoryScrollFixture.grid.adapter.selectedSlot===slot,capacity-2);assert.equal((await inspect()).selected,null);assert.equal((await inspect()).name,'空格');
   await clickSlot(capacity-1);const selected=await inspect();await h.page.keyboard.press('ArrowRight');await h.page.keyboard.press('Control+z');assert.equal((await inspect()).selected,selected.selected);
   // The details pane owns its wheel; it never pans the grid behind it.
   const detailPoint=await h.page.evaluate(()=>{const a=inventoryScrollFixture.grid.adapter,p=a.detailsBox.toGlobal({x:50,y:50}),r=harness.app.canvas.getBoundingClientRect();return {x:r.x+p.x,y:r.y+p.y};});
   await h.page.mouse.move(detailPoint.x,detailPoint.y);await h.page.mouse.wheel(0,300);await h.page.waitForFunction(()=>inventoryScrollFixture.grid.adapter.detailsBox.scrollY<0);const detail=await inspect();assert.equal(detail.x,selected.x);assert.equal(detail.y,selected.y);
   await h.page.evaluate(()=>{harness.app.stage.scale.set(.8);harness.app.render();});await clickSlot(capacity-2);await h.page.waitForFunction(slot=>inventoryScrollFixture.grid.adapter.selectedSlot===slot,capacity-2);assert.equal((await inspect()).selected,null);await clickSlot(capacity-1);assert.equal((await inspect()).selected,'item'+(capacity-1));
   // Scroll positions and local selection are not authored values in the JSON.
   const exported=await h.page.evaluate(()=>JSON.parse(JSON.stringify(inventoryScrollFixture.document)));assert.equal(exported.nodes[1].props.selectedId,'item0');assert.equal(exported.nodes[1].props.inventory.initialSlot,0);assert.equal(exported.nodes[1].props.inventory.scrollMode,'fixed-cells-both-v1');assert.equal(Object.hasOwn(exported.nodes[1].props,'scrollX'),false);
   if(process.env.UI_CHAIN_INVENTORY_EVIDENCE)await h.page.screenshot({path:join(process.env.UI_CHAIN_INVENTORY_EVIDENCE,'inventory-'+columns+'x'+rows+'-mobile.png')});
   await h.page.evaluate(()=>{harness.app.stage.scale.set(1);inventoryScrollFixture.grid.resize(280,600);});assert.equal((await inspect()).cell,80);assert.equal((await inspect()).selected,'item'+(capacity-1));
   // Runtime state may select another occupied slot without rewriting initialSlot.
   await h.page.evaluate(()=>inventoryScrollFixture.grid.setState({selectedId:null}));assert.equal((await inspect()).selected,null);
   const reopened=await h.page.evaluate(document=>{const f=inventoryScrollFixture;f.scene.dispose();harness.clear();f.scene=harness.compilePanel(document,f.ctx);f.document=document;f.grid=f.scene.runtime.handles.get('inventory');f.scene.runtime.setMode('play');f.scene.runtime.flush();return {state:f.grid.readState(),slot:f.grid.adapter.selectedSlot,geometry:f.grid.adapter.geometry,x:f.grid.adapter.gridBox.scrollX,y:f.grid.adapter.gridBox.scrollY};},exported);
   assert.equal(reopened.state.selectedId,'item0');assert.equal(reopened.slot,0);assert.equal(reopened.geometry.cell.width,80);assert.equal(reopened.geometry.grid.columns,columns);assert.equal(reopened.geometry.grid.rows,rows);assert.equal(reopened.x,0);assert.equal(reopened.y,0);
  }
  await h.page.evaluate(()=>{inventoryScrollFixture.scene.dispose();});assert.equal(await h.page.evaluate(()=>inventoryScrollFixture.live()),0);assert.deepEqual(h.errors,[]);
 }finally{await h.page.evaluate(()=>window.inventoryScrollFixture?.scene.dispose()).catch(()=>{});await h.close();}
});
