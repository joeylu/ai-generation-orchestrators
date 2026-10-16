import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {selectPopupBox} from '../src/runtime/select-geometry.mjs';

// Run the actual resize/place/reveal methods with display doubles. No browser,
// generated media, document service, or external resources are involved.
const source=await readFile(new URL('../src/runtime/controls.mjs',import.meta.url),'utf8'),start=source.indexOf('export class SkinnedSelect'),end=source.indexOf('// Dialog\'s default inner view',start),sandbox={selectPopupBox,Select:class {}};
vm.runInNewContext(source.slice(start,end).replace('export class','class')+'\nglobalThis.SelectView=SkinnedSelect;',sandbox);
function fixture(){
 const value=Object.create(sandbox.SelectView.prototype),records={rows:[],sizes:[],masks:[],views:[]};
 Object.assign(value,{skin:{profile:{itemHeight:152,geometry:{indicatorWidth:14,indicatorHeight:10,labelGap:8}},insets:()=>({left:12,right:12,top:0,bottom:0}),assertView:(role,width,height)=>records.views.push({role,width,height})},model:{options:Array.from({length:5},(_,i)=>({id:String(i)})),maxVisibleItems:5},overlay:{width:1280,height:720},value:-1,setSelection(){},openView:{},rows:[],scrollBox:{setSize:(width,height)=>records.sizes.push({width,height}),resize(){},alpha:0},view:{visible:true,position:{set(x,y){records.position={x,y};}}},indicator:{pivot:{set(){}},position:{set(){}},rotation:0},revealMask:{clear(){return this;},rect(x,y,width,height){records.masks.push({x,y,width,height});return this;},fill(){return this;}},toGlobal:()=>({x:100,y:600}),expanded:true,motionProgress:1});
 return {value,records};
}
test('actual Select resize, placement and reveal all use the bounded scroll viewport',()=>{
 const {value,records}=fixture();value.resizeBox(640,168);
 assert.equal(value.openView.height,720);assert.equal(value.menuHeight,552);assert.deepEqual(records.sizes.at(-1),{width:640,height:552});assert.deepEqual(records.position,{x:100,y:0});assert.equal(records.masks.at(-1).height,720);assert.equal(value.model.options.length,5);assert.equal(value.skin.profile.itemHeight,152);
 value.applyReveal(.5);assert.equal(records.masks.at(-1).height,168+552*.5);
});
test('popup placement recomputes viewport capacity after a logical screen change and rejects impossible rows',()=>{
 const {value,records}=fixture();value.resizeBox(640,168);value.overlay.height=600;value.place();assert.equal(value.menuHeight,432);assert.equal(value.openView.height,600);assert.equal(records.position.y,0);assert.equal(records.masks.at(-1).height,600);
 assert.throws(()=>value.resizeBox(640,500),{code:'select.viewport'});
});
