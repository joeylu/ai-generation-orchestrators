import test from 'node:test';
import assert from 'node:assert/strict';
import {inventorySlotRoles,inventorySlotAssets,assertInventoryProps,upgradeInventoryRegistry} from '../src/runtime/inventory-policy.mjs';
import {inventoryLayout} from '../src/runtime/inventory-geometry.mjs';
import {editorData} from '../src/panel/data.mjs';
import {inventoryContentDocument,inventoryLayoutConfig} from '../src/panel/inventory-preset.mjs';
import {inventoryActionConfig,validateInventoryActionConfig} from '../src/panel/inventory-intent.mjs';
import {resourceClosure} from '../src/panel/document.mjs';
import base from '../configs/action-presets.json' with {type:'json'};
const data=await editorData(),marker={slotAssets:inventorySlotAssets},roles=['skin.slot.normal','skin.slot.selected'],items=['skin.item.normal','skin.item.selected'];
const source={roles:[...items,...roles].map(role=>({role,assetId:role})),assets:[...items,...roles].map(role=>({assetId:role,width:role.includes('.slot.')?160:384,height:role.includes('.slot.')?160:96,stretch:role.includes('.slot.')?'uniform':'horizontal',minSize:{width:1,height:1},contentInsets:{left:0,right:0,top:0,bottom:0},nineSlice:{left:0,right:0,top:0,bottom:0}}))};
const props={items:[],selectedId:null,itemRecipeRef:'button@1.0.0',selection:'single',inventory:{columns:5,rows:4,gap:10,details:'right',appearance:'slots',cellSize:88,scrollMode:'fixed-cells-both-v1',slotFit:'visible-square-v1',viewportFit:'whole-slots-v1',...marker}};
test('only explicit square inventories use a complete square state family; old inventories and old packages retain item roles',()=>{
 assert.deepEqual(inventorySlotRoles(source,marker),roles);assert.deepEqual(inventorySlotRoles(source,{}),items);assert.deepEqual(inventorySlotRoles({roles:source.roles.slice(0,2),assets:source.assets.slice(0,2)},marker),items);
 const loaded={roles:new Map(source.roles.map(r=>[r.role,r.assetId])),metadata:new Map(source.assets.map(a=>[a.assetId,a]))};assert.deepEqual(inventorySlotRoles(loaded,marker),roles);
 assert.equal(inventoryLayout(data.profile,props,800,500,source).cell.width,88);
});
test('partial or non-square dedicated states fail before rendering instead of hiding an invalid new family',()=>{
 const half=structuredClone(source);half.roles.pop();assert.throws(()=>inventorySlotRoles(half,marker),{code:'inventory.slot-assets'});
 for(const change of [a=>a.width=384,a=>a.stretch='horizontal']){const invalid=structuredClone(source);change(invalid.assets[2]);assert.throws(()=>inventorySlotRoles(invalid,marker),{code:'inventory.slot-assets'});}
 assert.throws(()=>assertInventoryProps({...props,inventory:{...props.inventory,slotFit:undefined}}),{code:'inventory.slot-assets'});
});
test('new layout freezes square-slot policy and portable closure includes both states; frozen 1.5 keeps old artwork',()=>{
 const ctx={...data,orientation:'landscape'},layout=inventoryLayoutConfig(),current=inventoryContentDocument(ctx,{title:'仓库',props},layout),oldLayout={...layout,version:'1.5'};delete oldLayout.slotAssets;
 const oldProps=structuredClone(props);delete oldProps.inventory.slotAssets;
 const legacy=inventoryContentDocument(ctx,{title:'仓库',props:oldProps},oldLayout),closure=resourceClosure(current,ctx),oldClosure=resourceClosure(legacy,ctx);
 for(const role of roles){assert(closure.roles.includes(role));assert(closure.assets.includes(data.usage.bindings.find(r=>r.role===role).assetId));assert(!oldClosure.roles.includes(role));}
 assert.equal(current.nodes.find(n=>n.id==='inventory-grid').props.inventory.slotAssets,inventorySlotAssets);assert.equal(legacy.nodes.find(n=>n.id==='inventory-grid').props.inventory.slotAssets,undefined);
 const config=inventoryActionConfig(base,ctx),oldConfig=structuredClone(config);oldConfig.inventoryPlanning.version='1.4';oldConfig.inventoryPlanning.capabilities.version='1.4';oldConfig.inventoryPlanning.layout.version='1.5';delete oldConfig.inventoryPlanning.layout.slotAssets;delete oldConfig.inventoryPlanning.capabilities.slotAssets;
 assert.deepEqual(validateInventoryActionConfig(oldConfig,ctx),oldConfig);
 const original=structuredClone(data.registry),once=upgradeInventoryRegistry(original);assert.deepEqual(upgradeInventoryRegistry(once),once);assert.deepEqual(original,data.registry);
});
