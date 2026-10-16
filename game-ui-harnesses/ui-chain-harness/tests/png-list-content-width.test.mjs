import test from 'node:test';
import assert from 'node:assert/strict';
import {editorData} from '../src/panel/data.mjs';
import {pngGeometry} from '../src/runtime/png-geometry.mjs';
import {surfaceSlotBox} from '../src/runtime/surface-slots.mjs';

const {profile}=await editorData(),pad=value=>({left:value,right:value,top:value,bottom:value}),props={items:[{id:'one',label:'物品',enabled:true}],itemRecipeRef:'button@1.0.0',selection:'single',selectedId:null,gapToken:'controlGap'};
function evidence(){return {version:'1.0',scale:1,roles:[{role:'skin.surface.content',assetId:'content'},{role:'skin.surface.panel',assetId:'panel'},{role:'skin.item.normal',assetId:'normal'},{role:'skin.item.selected',assetId:'selected'}],assets:['content','panel','normal','selected'].map(assetId=>({assetId,width:512,height:512,density:1,stretch:'nine-slice',nineSlice:pad(4),contentInsets:pad(assetId==='content'?40:assetId==='panel'?14:0),minSize:{width:['normal','selected'].includes(assetId)?49:1,height:1}}))};}

test('ordinary layered List preflight checks the actual body row width rather than the outer surface',()=>{
  const geometry=evidence(),skin=pngGeometry(geometry,profile),before=structuredClone({geometry,props});
  assert.doesNotThrow(()=>skin.assertComponent('List',props,100,120));
  const options={type:'List',props,size:{width:100,height:120},profile,geometry,surfaceLayer:'content'},body=surfaceSlotBox(options);
  assert.equal(body.width,20);assert.throws(()=>skin.assertView('skin.item.normal',body.width,profile.itemHeight),{code:'skin.minimum'});
  assert.throws(()=>skin.assertComponent('List',props,100,120,{surfaceLayer:'content'}),{code:'skin.minimum'});
  assert.throws(()=>skin.assertComponent('List',props,128,120,{surfaceLayer:'content'}),{code:'skin.minimum'});
  assert.doesNotThrow(()=>skin.assertComponent('List',props,129,120,{surfaceLayer:'content'}));
  assert.deepEqual({geometry,props},before);
});

test('scaled frames reserve logical insets once while item artwork keeps its own minimum',()=>{
  const geometry=evidence();geometry.scale=2;for(const asset of geometry.assets){asset.density=2;asset.width=1024;asset.height=1024;}
  const skin=pngGeometry(geometry,profile),options={surfaceLayer:'frame',surfaceScale:2};
  const body=surfaceSlotBox({type:'List',props,size:{width:105,height:120},profile,geometry,...options});assert.equal(body.width,49);
  assert.throws(()=>skin.assertComponent('List',props,104,120,options),{code:'skin.minimum'});
  assert.doesNotThrow(()=>skin.assertComponent('List',props,105,120,options));
});

test('inventory still preflights its independent fixed cells and its internal grid/details surfaces',()=>{
  const geometry=evidence(),skin=pngGeometry(geometry,profile),inventory={...props,items:[],inventory:{columns:1,rows:1,gap:0,details:'below',appearance:'slots',cellSize:80}};
  assert.doesNotThrow(()=>skin.assertComponent('List',inventory,500,500,{surfaceLayer:'content'}));
  const small=structuredClone(inventory);small.inventory.cellSize=48;
  assert.throws(()=>skin.assertComponent('List',small,500,500,{surfaceLayer:'content'}),{code:'inventory.geometry'});
});
test('explicit author rows use their own component skins while the List surface and slot stay checked',()=>{
 const geometry=evidence(),skin=pngGeometry(geometry,profile);
 assert.throws(()=>skin.assertComponent('List',props,100,120,{surfaceLayer:'content'}),{code:'skin.minimum'});
 assert.doesNotThrow(()=>skin.assertComponent('List',props,100,120,{surfaceLayer:'content',explicitRows:true}));
 assert.throws(()=>skin.assertComponent('List',props,60,60,{surfaceLayer:'content',explicitRows:true}),{code:'skin.surface-style'});
});
