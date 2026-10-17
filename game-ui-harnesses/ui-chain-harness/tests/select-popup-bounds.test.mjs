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
 assert.equal(value.scrollBox.x,8);assert.equal(value.menuWidth,624);assert.equal(value.openView.height,720);assert.equal(value.menuHeight,544);assert.deepEqual(records.sizes.at(-1),{width:624,height:544});assert.deepEqual(records.position,{x:100,y:0});assert.equal(records.masks.at(-1).height,720);assert.equal(value.model.options.length,5);assert.equal(value.skin.profile.itemHeight,152);
 value.applyReveal(.5);assert.equal(records.masks.at(-1).height,168+552*.5);
});
test('popup placement recomputes viewport capacity after a logical screen change and rejects impossible rows',()=>{
 const {value,records}=fixture();value.resizeBox(640,168);value.overlay.height=600;value.place();assert.equal(value.menuHeight,424);assert.equal(value.openView.height,600);assert.equal(records.position.y,0);assert.equal(records.masks.at(-1).height,600);
 assert.throws(()=>value.resizeBox(640,500),{code:'select.viewport'});
});

test('Select popup aligns visible edges despite different transparent texture padding',async()=>{
 const {selectBackdropBox,selectVisibleEdges}=await import('../src/runtime/select-geometry.mjs');
 const field={sourceWidth:96,left:21,right:22,bounds:{x:52/384,width:276/384}};
 const popup={sourceWidth:104,left:15,right:14,bounds:{x:17/416,width:384/416}};
 for(const width of [96,200,306]){
  const box=selectBackdropBox(width,field,popup,30),a=selectVisibleEdges(width,field),b=selectVisibleEdges(box.width,popup);
  assert.ok(box.width<width);assert.ok(Math.abs(a.left-(b.left+box.x))<1e-8);assert.ok(Math.abs(a.right-(b.right+box.x))<1e-8);
 }
 const full={sourceWidth:100,left:10,right:10,bounds:{x:0,width:1}};
 assert.deepEqual(selectBackdropBox(200,full,full),{x:0,width:200});
 assert.deepEqual(selectBackdropBox(40,field,popup,30),{x:0,width:40});
});

test('outside click coordinates follow a resized canvas rather than the initial overlay height',()=>{
 let listener,closed=0,point;
 const context={Container:class{},document:{addEventListener:(_name,fn)=>listener=fn}};
 vm.runInNewContext(source.slice(source.indexOf('export class OverlayOwner')).replace('export class','class')+'\nglobalThis.Owner=OverlayOwner;',context);
 const app={screen:{width:1440,height:1120},stage:{addChild(){}},canvas:{getBoundingClientRect:()=>({left:20,top:30,width:720,height:791})}};
 const owner=new context.Owner(app);app.screen.height=1582;
 owner.selects.add({containsGlobal:p=>{point=p;return Math.abs(p.y-365)<1;},close:()=>closed++});
 listener({clientX:20+540/2,clientY:30+365/2});
 assert.equal(point.x,540);assert.equal(point.y,365);assert.equal(closed,0);
 listener({clientX:20+540/2,clientY:30+600/2});assert.equal(closed,1);
});
