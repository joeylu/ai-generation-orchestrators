import test from 'node:test';
import assert from 'node:assert/strict';
import {editorData} from '../src/panel/data.mjs';
import {validateProps} from '../src/contracts/props.mjs';
import {assertSize,minimumSize} from '../src/runtime/geometry.mjs';
import {pngGeometry} from '../src/runtime/png-geometry.mjs';
import {assertInventoryProps,inventoryIcons,inventoryPropsSchema,inventoryItemPropsSchema,upgradeInventoryRegistry,inventoryScrollMode,inventoryGridLimits,assertInventoryGridLimits} from '../src/runtime/inventory-policy.mjs';
import {inventoryLayout,inventoryMinimum,inventorySkinMetrics,inventoryDetailLayout} from '../src/runtime/inventory-geometry.mjs';

const ctx=await editorData(),item=(index=0)=>({id:'item'+index,label:'宝石',enabled:true,slotIndex:index,quantity:9,description:'程序示例物品。',icon:'gem'}),
  props=(details='right')=>({itemRecipeRef:'button@1.0.0',selection:'single',selectedId:null,items:[item()],inventory:{columns:10,rows:10,gap:4,details}}),
  context={resourceIds:[],textStyleIds:['body'],nodeIds:[],layoutTokens:ctx.usage.layoutTokens},validate=p=>validateProps(ctx.registry,'list@1.0.0',p,context);

test('portrait grid gives surplus vertical space to readable details instead of leaving an empty viewport',()=>{
  const layout=inventoryLayout(ctx.profile,props('below'),720,1100,evidence());
  assert.equal(layout.grid.height,layout.grid.contentHeight);assert.equal(layout.grid.scrollable,false);
  assert.equal(layout.details.y+layout.details.height,1100);assert.ok(layout.details.height>250);
  const short=inventoryLayout(ctx.profile,props('below'),720,300,evidence());
  assert.equal(short.grid.scrollable,true);assert.equal(short.details.y+short.details.height,300);
  assert.ok(short.cell.width>=short.cell.minimum);
});
function evidence(){
  return {version:'1.0',scale:1,roles:['normal','selected'].map(state=>({role:'skin.item.'+state,assetId:state})),assets:['normal','selected'].map(assetId=>({assetId,width:256,height:256,density:1,stretch:'nine-slice',nineSlice:{left:4,right:4,top:4,bottom:4},contentInsets:{left:8,right:8,top:8,bottom:8},minSize:{width:32,height:36}}))};
}

test('inventory is an additive optional List contract; old registries source bytes and ordinary list semantics stay intact',()=>{
  const before=structuredClone(ctx.registry),legacy=structuredClone(before),recipe=legacy.recipes.find(recipe=>recipe.type==='List');
  delete recipe.propsSchema.properties.inventory;for(const key of Object.keys(inventoryItemPropsSchema))delete recipe.propsSchema.properties.items.items.properties[key];
  const snapshot=JSON.stringify(legacy),upgraded=upgradeInventoryRegistry(legacy),next=upgraded.recipes.find(recipe=>recipe.type==='List');
  assert.equal(JSON.stringify(legacy),snapshot);assert.equal(upgraded.revision,legacy.revision);assert.equal(upgraded.recipes.length,16);
  assert.deepEqual(next.propsSchema.properties.inventory,inventoryPropsSchema);assert.deepEqual(upgradeInventoryRegistry(upgraded),upgraded);
  for(const key of ['inventory',...Object.keys(inventoryItemPropsSchema)])assert.equal(Object.hasOwn(key==='inventory'?next.propsSchema.properties[key]:next.propsSchema.properties.items.items.properties[key],'default'),false);
  const ordinary={itemRecipeRef:'button@1.0.0',items:Array.from({length:101},(_,index)=>({id:'old'+index,label:'原有条目'}))},result=validate(ordinary);
  assert.deepEqual(result.issues,[]);assert.equal(Object.hasOwn(result.props,'inventory'),false);assert.equal(result.props.items.length,101);
  assert.deepEqual(minimumSize('List',result.props,ctx.profile),{width:48,height:24});
  for(const mutate of [r=>r.propsSchema.properties.inventory={type:'string'},r=>r.propsSchema.properties.items.items.properties.quantity={type:'integer',maximum:999}]){
    const bad=structuredClone(legacy);mutate(bad.recipes.find(recipe=>recipe.type==='List'));assert.throws(()=>upgradeInventoryRegistry(bad),{code:'inventory.registry'});
  }
  assert.deepEqual(ctx.registry,before);
});

test('inventory records identify occupied single cells; all 100 slots and sparse or empty records are legal',()=>{
  for(const items of [[],[item(99)],Array.from({length:100},(_,index)=>item(index))]){
    const p={...props(),items},before=structuredClone(p),result=validate(p);assert.deepEqual(result.issues,[]);assert.doesNotThrow(()=>assertInventoryProps(result.props));assert.deepEqual(p,before);
  }
  assert.equal(inventoryIcons.length,8);
  for(const icon of inventoryIcons)assert.deepEqual(validate({...props(),items:[{...item(),icon}]}).issues,[]);
  const literal='<script>example</script>',p={...props(),items:[{...item(),label:literal,description:literal}]};assert.deepEqual(validate(p).issues,[]);assert.equal(validate(p).props.items[0].label,literal);
});

test('bad slot ownership counts icons geometry and unsupported inventory semantics fail closed',()=>{
  for(const mutate of [p=>p.items.push({...item(1),slotIndex:0}),p=>p.items[0].slotIndex=-1,p=>p.items[0].slotIndex=100,p=>p.items[0].slotIndex=.5,p=>delete p.items[0].slotIndex,p=>p.items[0].quantity=0,p=>p.items[0].quantity=1.5,p=>p.items[0].quantity=1000000,p=>p.items[0].icon='external.png',p=>p.items[0].description='x'.repeat(2049),p=>p.items[0].label='',p=>p.items[0].label='x'.repeat(65),p=>p.items[0].span=2,p=>p.inventory.columns=0,p=>p.inventory.rows=11,p=>p.inventory.gap=-1,p=>p.inventory.details='left',p=>p.inventory.dragSwap=true,p=>p.items=Array.from({length:101},(_,index)=>item(index))]){
    const p=props();mutate(p);assert.ok(validate(p).issues.length,JSON.stringify(p).slice(0,200));
  }
  assert.throws(()=>assertInventoryProps(props(),{childIds:['custom-row']}),{code:'inventory.children'});
  assert.ok(validateProps(ctx.registry,'list@1.0.0',props(),{...context,nodeIds:['custom-row']}).issues.some(issue=>issue.code==='inventory.children'));
  const ordinary=props();delete ordinary.inventory;assert.ok(validate(ordinary).issues.some(issue=>issue.code==='inventory.presentation'));
  const invalidSelection={...props(),selectedId:'missing'};assert.ok(validate(invalidSelection).issues.some(issue=>issue.code==='selection.missing'));
  assert.ok(validate({...props(),itemRecipeRef:'input@1.0.0'}).issues.some(issue=>issue.code==='inventory.recipe'));
});

test('shared geometry preserves exact ten columns and skin-safe square cells with right or below detail panes',()=>{
  for(const details of ['right','below']){
    const p=props(details),skin=evidence(),snapshot=structuredClone(skin),m=inventoryMinimum(ctx.profile,p,skin),layout=inventoryLayout(ctx.profile,p,1000,800,skin);
    assert.deepEqual(layout.minimum,m);assert.equal(layout.grid.columns,10);assert.equal(layout.grid.rows,10);assert.equal(layout.cell.width,layout.cell.height);
    assert(layout.cell.width>=40);assert.equal(layout.grid.contentWidth,layout.cell.width*10+36);assert.equal(layout.grid.contentHeight,layout.cell.height*10+36);
    assert(layout.cell.contentWidth>=layout.cell.iconSize);assert(layout.cell.contentHeight>=layout.lineHeight);assert(layout.quantityBox.x>=layout.cell.insets.left);assert(layout.quantityBox.y>=layout.cell.insets.top);
    assert(layout.details.x+layout.details.width<=1000);assert(layout.details.y+layout.details.height<=800);assert.equal(layout.detailName.width,layout.details.contentWidth);assert.equal(layout.detailName.scrollable,true);
    assert.deepEqual(skin,snapshot);
  }
});

test('height shortage scrolls without shrinking cells and width shortage never silently changes columns',()=>{
  const p=props(),skin=evidence(),m=inventoryMinimum(ctx.profile,p,skin),layout=inventoryLayout(ctx.profile,p,m.width,m.height,skin);
  assert.equal(layout.grid.scrollable,true);assert.equal(layout.cell.width,40);assert.equal(layout.grid.columns,10);
  assert.throws(()=>inventoryLayout(ctx.profile,p,m.width-1,m.height,skin),{code:'inventory.geometry'});
  assert.throws(()=>inventoryLayout(ctx.profile,p,m.width,m.height-1,skin),{code:'inventory.geometry'});
  for(const value of [NaN,Infinity,0,-1])assert.throws(()=>inventoryLayout(ctx.profile,p,value,800,skin),{code:'inventory.geometry'});
  const declared=evidence();declared.assets[1].minSize={width:80,height:60};assert.equal(inventoryLayout(ctx.profile,p,1400,1000,declared).cell.minimum,80);
});

test('offline evidence and loaded skin use the same logical metadata with scale and density applied exactly once',()=>{
  const p=props(),e=evidence();e.scale=2;for(const asset of e.assets){asset.density=2;asset.width=1024;asset.height=1024;asset.nineSlice={left:12,right:16,top:8,bottom:10};}
  const loaded={profile:ctx.profile,roles:new Map(e.roles.map(role=>[role.role,role.assetId])),metadata:new Map(e.assets.map(asset=>[asset.assetId,asset])),insets:role=>structuredClone(e.assets.find(asset=>asset.assetId===e.roles.find(binding=>binding.role===role).assetId).contentInsets)};
  assert.deepEqual(inventorySkinMetrics(ctx.profile,e),inventorySkinMetrics(ctx.profile,loaded));
  assert.deepEqual(inventoryLayout(ctx.profile,p,1000,800,e),inventoryLayout(ctx.profile,p,1000,800,loaded));
  const png=pngGeometry(e,ctx.profile),box=inventoryLayout(ctx.profile,p,1000,800,e);assert.doesNotThrow(()=>png.assertComponent('List',p,1000,800));assert.equal(box.cell.minimum,40);
});

test('font and quantity capacity plus nine-slice preflight share the actual inventory layout',()=>{
  const p=props('below'),skin=evidence(),normal=inventoryMinimum(ctx.profile,p,skin),large=inventoryMinimum(ctx.profile,{...p,fontSize:32},skin),sixDigits=inventoryMinimum(ctx.profile,{...p,items:[{...item(),quantity:999999}]},skin);
  assert(large.width>normal.width);assert(sixDigits.width>normal.width);
  const min=minimumSize('List',p,ctx.profile);assert.doesNotThrow(()=>assertSize('List',p,ctx.profile,min.width,min.height));assert.throws(()=>assertSize('List',p,ctx.profile,min.width-1,min.height),{code:'node.size'});
  const png=pngGeometry(skin,ctx.profile);assert.doesNotThrow(()=>png.assertComponent('List',p,normal.width,normal.height));assert.throws(()=>png.assertComponent('List',{...p,fontSize:32},normal.width,normal.height),{code:'inventory.geometry'});
  assert.deepEqual(inventoryMinimum(ctx.profile,{...p,textColor:'#000000'},skin),normal);
});

test('twenty and twenty-four slot topologies preserve configured columns rows and rectangular grid extent',()=>{
  for(const [columns,rows]of [[5,4],[6,4],[1,1],[10,10]]){
    const p={...props(),items:[item(columns*rows-1)],inventory:{columns,rows,gap:10,details:'right',appearance:'slots'}},result=validate(p);
    assert.deepEqual(result.issues,[]);const box=inventoryLayout(ctx.profile,p,1400,1000,evidence());
    assert.equal(box.capacity,columns*rows);assert.equal(box.grid.columns,columns);assert.equal(box.grid.rows,rows);
    assert.equal(box.grid.contentWidth,box.cell.width*columns+10*(columns-1));assert.equal(box.grid.contentHeight,box.cell.height*rows+10*(rows-1));
    assert(box.cell.width>=box.cell.minimum);assert.equal(box.cell.iconSize,40);assert(box.cell.width<=Math.max(88,box.cell.minimum));
  }
  const p={...props(),inventory:{columns:5,rows:4,gap:10,details:'below',appearance:'slots'}};
  const full={...p,items:Array.from({length:20},(_,index)=>item(index))};assert.deepEqual(validate(full).issues,[]);
  assert.ok(validate({...full,items:[...full.items,item(20)]}).issues.some(issue=>issue.code==='inventory.capacity'));
  assert.ok(validate({...p,items:[item(20)]}).issues.some(issue=>issue.code==='inventory.slot'));
  assert.ok(validate({...p,inventory:{...p.inventory,columns:1.5}}).issues.length);
  assert.ok(validate({...p,inventory:{...p.inventory,appearance:'custom-css'}}).issues.length);
});

test('slots layout has readable preferred cell sizes and compact details without consuming extra canvas height',()=>{
  for(const details of ['right','below']){
    const p={...props(),inventory:{columns:5,rows:4,gap:10,details,appearance:'slots'}},box=inventoryLayout(ctx.profile,p,details==='right'?900:620,850,evidence());
    assert(box.cell.width>=72&&box.cell.width<=88);assert.equal(box.cell.preferred,80);assert(box.cell.iconSize>=36&&box.cell.iconSize<=44);
    assert.equal(box.details.height,220);assert.equal(box.details.width,details==='right'?250:box.grid.width);assert(box.details.icon.size>=56);
    assert.equal(box.naturalHeight,details==='right'?Math.max(box.grid.height,box.details.height):box.details.y+box.details.height);assert(box.naturalHeight<850);
    assert(box.detailName.width<box.details.contentWidth);assert.equal(box.grid.height,box.grid.contentHeight);
    const png=pngGeometry(evidence(),ctx.profile);assert.doesNotThrow(()=>png.assertComponent('List',p,details==='right'?900:620,850));
  }
});

test('exact legacy inventory schema alone widens safely and old hundred-slot authored documents retain their mode',()=>{
  const registry=structuredClone(ctx.registry),recipe=registry.recipes.find(recipe=>recipe.type==='List'),old=recipe.propsSchema.properties.inventory;
  old.properties.columns={type:'integer',enum:[10]};old.properties.rows={type:'integer',enum:[10]};for(const key of ['appearance','cellSize','initialSlot'])delete old.properties[key];
  const before=JSON.stringify(registry),next=upgradeInventoryRegistry(registry);assert.equal(JSON.stringify(registry),before);assert.deepEqual(next.recipes.find(recipe=>recipe.type==='List').propsSchema.properties.inventory,inventoryPropsSchema);
  const p={...props(),items:[item(99)]},result=validateProps(next,'list@1.0.0',p,context);assert.deepEqual(result.issues,[]);assert.equal(Object.hasOwn(result.props.inventory,'appearance'),false);
  assert.equal(inventoryLayout(ctx.profile,p,1000,800,evidence()).capacity,100);
  const bad=structuredClone(registry);bad.recipes.find(recipe=>recipe.type==='List').propsSchema.properties.inventory.properties.columns.default=10;assert.throws(()=>upgradeInventoryRegistry(bad),{code:'inventory.registry'});
});

test('compact detail geometry places icon full name metadata and scrollable prose without overlap or truncation',()=>{
  const p={...props(),inventory:{columns:5,rows:4,gap:10,details:'right',appearance:'slots'}},layout=inventoryLayout(ctx.profile,p,900,500,evidence()),
    short=inventoryDetailLayout(layout,{titleHeight:24,nameHeight:24,quantityWidth:60,quantityHeight:24,slotWidth:110,slotHeight:24,descriptionHeight:48});
  assert(short.name.x>=short.icon.x+short.icon.size);assert(short.quantity.y>=short.icon.y+short.icon.size);assert.equal(short.quantity.y,short.slot.y);assert(short.slot.x>=60+16);
  assert(short.description.y>=short.slot.y+short.slot.height);assert.equal(short.contentHeight,short.description.y+48);
  const long=inventoryDetailLayout(layout,{titleHeight:24,nameHeight:100,quantityWidth:150,quantityHeight:24,slotWidth:150,slotHeight:24,descriptionHeight:1000});
  assert(long.quantity.y>=long.name.y+long.name.height);assert(long.slot.y>=long.quantity.y+long.quantity.height);assert(long.contentHeight>layout.details.height);assert.equal(layout.details.scrollable,true);
});

test('explicit cell size preserves declared geometry under scrolling and larger type fails instead of shrinking a fixed cell',()=>{
  const p={...props('below'),items:[{...item(),icon:null}],inventory:{columns:5,rows:4,gap:10,details:'below',appearance:'slots',cellSize:80,initialSlot:19}},result=validate(p);
  assert.deepEqual(result.issues,[]);const skin=evidence(),full=inventoryLayout(ctx.profile,p,650,850,skin),short=inventoryLayout(ctx.profile,p,650,full.minimum.height,skin);
  assert.equal(full.cell.width,80);assert.equal(short.cell.width,80);assert.equal(short.grid.scrollable,true);assert.equal(short.grid.contentHeight,350);
  assert.throws(()=>inventoryLayout(ctx.profile,{...p,fontSize:96},650,850,skin),{code:'inventory.geometry'});
  assert.throws(()=>inventoryLayout(ctx.profile,{...p,selectedId:'item0'},650,850,skin),{code:'inventory.selection'});
  assert.throws(()=>inventoryLayout(ctx.profile,{...p,inventory:{...p.inventory,initialSlot:20}},650,850,skin),{code:'inventory.selection'});
});

test('exact pre-AI optional inventory and example icon contracts widen without mutating a frozen source registry',()=>{
  const legacy=structuredClone(ctx.registry),list=legacy.recipes.find(recipe=>recipe.type==='List');
  delete list.propsSchema.properties.inventory.properties.cellSize;delete list.propsSchema.properties.inventory.properties.initialSlot;
  list.propsSchema.properties.items.items.properties.icon={type:'string',enum:[...inventoryIcons]};
  const bytes=JSON.stringify(legacy),next=upgradeInventoryRegistry(legacy);assert.equal(JSON.stringify(legacy),bytes);
  assert.deepEqual(next.recipes.find(recipe=>recipe.type==='List').propsSchema.properties.inventory,inventoryPropsSchema);
  const p={...props(),items:[{...item(),icon:null}],inventory:{...props().inventory,cellSize:80}};
  assert.deepEqual(validateProps(next,'list@1.0.0',p,context).issues,[]);
  const conflict=structuredClone(legacy);conflict.recipes.find(recipe=>recipe.type==='List').propsSchema.properties.items.items.properties.icon.enum.push('external');
  assert.throws(()=>upgradeInventoryRegistry(conflict),{code:'inventory.registry'});
});

test('explicit fixed-cell scrolling admits all legal 144-cell topologies without migrating legacy inventory documents',()=>{
  const before=JSON.stringify(ctx.registry),registry=upgradeInventoryRegistry(ctx.registry);
  assert.equal(JSON.stringify(ctx.registry),before);
  for(const [columns,rows]of [[12,12],[32,4],[4,32],[24,6],[1,32]]){
    const capacity=columns*rows,p={...props('below'),items:[item(capacity-1)],inventory:{columns,rows,gap:10,details:'below',appearance:'slots',cellSize:80,scrollMode:inventoryScrollMode}};
    assert.deepEqual(validateProps(registry,'list@1.0.0',p,context).issues,[]);assert.equal(assertInventoryGridLimits(p.inventory).capacity,capacity);
    const legacy=structuredClone(p);delete legacy.inventory.scrollMode;
    if(columns>10||rows>10)assert.throws(()=>assertInventoryProps(legacy),{code:'inventory.layout'});
  }
  const all={...props('below'),items:Array.from({length:144},(_,i)=>item(i)),inventory:{columns:12,rows:12,gap:10,details:'below',appearance:'slots',cellSize:80,scrollMode:inventoryScrollMode}};
  assert.deepEqual(validateProps(registry,'list@1.0.0',all,context).issues,[]);
  for(const [columns,rows]of [[12,13],[32,5],[33,1],[0,1]])assert.throws(()=>assertInventoryProps({...all,items:[],inventory:{...all.inventory,columns,rows}}));
  assert.throws(()=>assertInventoryProps({...all,inventory:{...all.inventory,scrollMode:'both'}}),{code:'inventory.layout'});
  const last=structuredClone(all);last.items[143].slotIndex=144;assert.throws(()=>assertInventoryProps(last),{code:'inventory.slot'});
});

test('uniform-grid budgets match upstream axis, total, cell, spacing and 4000-pixel natural extent rules',()=>{
  assert.equal(inventoryGridLimits.maxAxis,32);assert.equal(inventoryGridLimits.maxCells,144);
  const grid={columns:32,rows:1,cellWidth:125,cellHeight:80,spacingX:0,spacingY:0,padding:0},before=structuredClone(grid);
  assert.equal(assertInventoryGridLimits(grid).width,4000);assert.deepEqual(grid,before);
  assert.equal(assertInventoryGridLimits({...grid,columns:1,rows:32,cellWidth:80,cellHeight:125}).height,4000);
  assert.equal(assertInventoryGridLimits({...grid,columns:1,cellWidth:256,cellHeight:256,spacingX:64,spacingY:64,padding:64}).width,384);
  for(const bad of [{...grid,cellWidth:126},{...grid,cellWidth:47},{...grid,cellHeight:257},{...grid,spacingX:65},{...grid,padding:65},{columns:12,rows:13},{columns:33,rows:1},{columns:32,rows:1,cellWidth:80}])assert.throws(()=>assertInventoryGridLimits(bad));
});

test('new narrow viewports scroll fixed cells independently on each axis while old layouts still reject horizontal shortage',()=>{
  for(const [columns,rows]of [[12,12],[32,4],[4,32]]){
    const p={...props('below'),items:[item(columns*rows-1)],inventory:{columns,rows,gap:10,details:'below',appearance:'slots',cellSize:80,scrollMode:inventoryScrollMode}},skin=evidence(),box=inventoryLayout(ctx.profile,p,370,540,skin);
    assert.equal(box.cell.width,80);assert.equal(box.cell.height,80);assert.equal(box.grid.columns,columns);assert.equal(box.grid.rows,rows);
    assert.equal(box.grid.contentWidth,columns*80+(columns-1)*10);assert.equal(box.grid.contentHeight,rows*80+(rows-1)*10);
    assert.equal(box.grid.width,Math.min(370,box.grid.contentWidth));assert.equal(box.grid.scrollableX,box.grid.contentWidth>box.grid.width);assert.equal(box.grid.scrollableY,box.grid.contentHeight>box.grid.height);
    const smaller=inventoryLayout(ctx.profile,p,280,box.minimum.height,skin);assert.equal(smaller.cell.width,80);assert.equal(smaller.grid.width,280);assert.equal(smaller.grid.height,80);
    assert(box.details.y>=box.grid.y+box.grid.height);assert(box.details.x>=0);assert(box.details.x+box.details.width<=370);
  }
  const p={...props('right'),inventory:{columns:32,rows:4,gap:10,details:'right',appearance:'slots',cellSize:80,scrollMode:inventoryScrollMode}},side=inventoryLayout(ctx.profile,p,500,480,evidence());
  assert.equal(side.grid.scrollableX,true);assert.equal(side.grid.scrollableY,false);assert(side.details.x>=side.grid.x+side.grid.width+20);
  const old={...props('below'),inventory:{columns:5,rows:4,gap:10,details:'below',appearance:'slots',cellSize:80}};
  assert.throws(()=>inventoryLayout(ctx.profile,old,370,540,evidence()),{code:'inventory.geometry'});
  assert.throws(()=>inventoryLayout(ctx.profile,{...p,fontSize:96},500,480,evidence()),{code:'inventory.geometry'});
});
