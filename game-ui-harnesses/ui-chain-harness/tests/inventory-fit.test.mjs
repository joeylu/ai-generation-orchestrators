import test from 'node:test';
import assert from 'node:assert/strict';
import {inventorySlotCrop,wholeSlotExtent,wholeSlotViewport} from '../src/runtime/inventory-slot-fit.mjs';
import {inventoryLayout,inventoryMinimum} from '../src/runtime/inventory-geometry.mjs';
import {inventoryScrollbarChrome} from '../src/runtime/inventory-scrollbars.mjs';
import {editorData} from '../src/panel/data.mjs';
import base from '../configs/action-presets.json' with {type:'json'};
import {inventoryActionConfig,validateInventoryActionConfig} from '../src/panel/inventory-intent.mjs';
import {inventoryContentDocument,validateInventoryLayoutConfig} from '../src/panel/inventory-preset.mjs';
const data=await editorData(),fit={slotFit:'visible-square-v1',viewportFit:'whole-slots-v1'};
test('shared state crop retains every nonzero pixel including faint one-alpha fringes and preserves verified cut positions',()=>{
 const image=(x,width)=>{const i={width:384,height:96,pixels:new Uint8Array(384*96*4)};for(let y=0;y<96;y++)for(let xx=x;xx<x+width;xx++)i.pixels[(y*384+xx)*4+3]=xx===x?1:255;return i;};
 const entries=[{assetId:'normal',image:image(19,345),resolution:4,borders:{left:12,top:8,right:12,bottom:7}},{assetId:'selected',image:image(17,349),resolution:4,borders:{left:12,top:8,right:13,bottom:9}}],before=structuredClone(entries),r=inventorySlotCrop(entries);
 assert.equal(r.status,'normalized');assert.deepEqual(r.crop,{x:17,y:0,width:349,height:96});assert.deepEqual(entries,before);
 for(const e of entries)for(let y=0;y<96;y++)for(let x=0;x<384;x++)if(x<17||x>=366)assert.equal(e.image.pixels[(y*384+x)*4+3],0);
 assert.deepEqual(r.states[0].borders,{left:7.75,top:8,right:7.5,bottom:7});
 const unsuitable=structuredClone(entries);unsuitable[0].borders.left=1;assert.equal(inventorySlotCrop(unsuitable).status,'unavailable');
 assert.equal(inventorySlotCrop([]).reason,'missing-slot-state');
});
test('new viewport quantizes after both scrollbar reservations and keeps full cells at initial and terminal offsets',()=>{
 for(const details of ['right','below'])for(const [columns,rows]of [[5,4],[12,12],[32,4],[1,1]]){
  const props={items:[],selectedId:null,inventory:{columns,rows,gap:10,details,appearance:'slots',cellSize:88,scrollMode:'fixed-cells-both-v1',...fit}},geometry=inventoryLayout(data.profile,props,details==='right'?750:370,650,undefined,{surfaceLayer:'inset'}),chrome=inventoryScrollbarChrome(geometry,{details,barWidth:data.profile.geometry.scrollbarWidth,gap:data.profile.geometry.scrollbarGap,minThumbLength:data.profile.geometry.minThumbLength});
  for(const [axis,side,count]of [['x','width',columns],['y','height',rows]]){
   const n=(chrome.viewport[side]+10)/98;assert(Math.abs(n-Math.round(n))<1e-8);assert(n>=1&&n<=count);
   assert.equal(chrome.range[axis],geometry.grid[axis==='x'?'contentWidth':'contentHeight']-chrome.viewport[side]);
   assert.equal((chrome.range[axis]%98+98)%98,0);
  }
 }
 assert.equal(wholeSlotExtent(366,88,10,4),284);
 assert.equal(wholeSlotExtent(87,88,10,4),0);
 assert.equal(wholeSlotViewport({width:255,height:256,side:256,gap:10,columns:2,rows:2,rail:20}),null);
});
test('fit minimum includes internal rails and every admitted 1×1, single-axis or 2×2 size stays inside the authored bounds',()=>{
 for(const details of ['right','below'])for(const [columns,rows]of [[1,1],[1,2],[2,1],[2,2],[5,4]])for(const cellSize of [88,256]){
  const props={items:[],selectedId:null,inventory:{columns,rows,gap:10,details,appearance:'slots',cellSize,scrollMode:'fixed-cells-both-v1',...fit}},options={surfaceLayer:'inset'},minimum=inventoryMinimum(data.profile,props,undefined,options);
  for(const [width,height]of [[minimum.width,minimum.height],[minimum.width+19,minimum.height+19],[minimum.width+cellSize+10,minimum.height+cellSize+10]]){
   const layout=inventoryLayout(data.profile,props,width,height,undefined,options),chrome=inventoryScrollbarChrome(layout,{details,barWidth:data.profile.geometry.scrollbarWidth,gap:data.profile.geometry.scrollbarGap,minThumbLength:data.profile.geometry.minThumbLength});
   for(const box of [layout.grid.surface,layout.details]){assert(box.x>=-.01);assert(box.y>=-.01);assert(box.x+box.width<=width+.01);assert(box.y+box.height<=height+.01);}
   for(const side of ['width','height']){const cells=(chrome.viewport[side]+10)/(cellSize+10);assert(cells>=1);assert(Math.abs(cells-Math.round(cells))<1e-8);}
  }
  assert.throws(()=>inventoryLayout(data.profile,props,minimum.width-1,minimum.height,undefined,options),{code:'inventory.geometry'});
  assert.throws(()=>inventoryLayout(data.profile,props,minimum.width,minimum.height-1,undefined,options),{code:'inventory.geometry'});
 }
});
test('new current layout freezes both fit options and centered title while legacy reference 1.3/1.4 replays without them',()=>{
 for(const orientation of ['landscape','portrait']){
  const ctx={...data,orientation},config=inventoryActionConfig(base,ctx),p=config.inventoryPlanning;assert.equal(p.version,'1.4');assert.equal(p.layout.version,'1.5');assert.equal(p.layout.titleAlign,'center');assert.equal(p.layout.slotFit,fit.slotFit);assert.equal(p.layout.viewportFit,fit.viewportFit);assert.deepEqual(validateInventoryActionConfig(config,ctx),config);
  const props={items:[],selectedId:null,selection:'single',itemRecipeRef:'button@1.0.0',inventory:{columns:5,rows:4,gap:10,cellSize:p.programGrid.cellWidth,scrollMode:'fixed-cells-both-v1',details:orientation==='landscape'?'right':'below',appearance:'slots'}};
  const current=inventoryContentDocument(ctx,{title:'仓库',props},p.layout);assert.equal(current.nodes.find(n=>n.id==='inventory-heading').props.align,'center');assert.equal(current.nodes.find(n=>n.id==='inventory-grid').props.inventory.slotFit,fit.slotFit);
  const latin=inventoryContentDocument(ctx,{title:'Inventory',props},p.layout),long=inventoryContentDocument(ctx,{title:'仓'.repeat(40),props},p.layout);assert(latin.nodes.find(n=>n.id==='inventory-heading').size.height<=long.nodes.find(n=>n.id==='inventory-heading').size.height);if(orientation==='portrait')assert(latin.nodes.find(n=>n.id==='inventory-heading').size.height<long.nodes.find(n=>n.id==='inventory-heading').size.height);
  const old=structuredClone(config);old.inventoryPlanning.version='1.3';old.inventoryPlanning.layout.version='1.4';old.inventoryPlanning.capabilities.version='1.3';for(const key of ['slotFit','viewportFit','titleAlign']){delete old.inventoryPlanning.layout[key];delete old.inventoryPlanning.capabilities[key];}
  assert.deepEqual(validateInventoryActionConfig(old,ctx),old);assert.deepEqual(validateInventoryLayoutConfig(old.inventoryPlanning.layout),old.inventoryPlanning.layout);
  const legacy=inventoryContentDocument(ctx,{title:'仓库',props},old.inventoryPlanning.layout);assert.equal(legacy.nodes.find(n=>n.id==='inventory-heading').props.align,'left');assert.equal(legacy.nodes.find(n=>n.id==='inventory-grid').props.inventory.slotFit,undefined);
 }
});
