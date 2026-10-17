import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {editorData} from '../src/panel/data.mjs';
import {componentContentBox,contentOwnerTypes} from '../src/runtime/content-bounds.mjs';
import {surfaceSlotBox,surfaceGeometryForContext,assertSurfaceSlotChildren} from '../src/runtime/surface-slots.mjs';
import {selectPopupBox} from '../src/runtime/select-geometry.mjs';
import {radioItemWidth,selectLabelWidth} from '../src/runtime/option-geometry.mjs';

// The public component contract only: no canvas editor drafts or edit helpers.
const ctx=await editorData(),cases=JSON.parse(await readFile(new URL('../fixtures/component-cases.json',import.meta.url))).cases;
const geometry=surfaceGeometryForContext(ctx);
test('all 16 component types distinguish owned child bodies from leaf controls',()=>{
 assert.equal(new Set(cases.map(c=>c.type)).size,16);
 for(const sample of cases){
  const options={type:sample.type,props:sample.props,size:sample.size,profile:ctx.profile,geometry,layout:{padding:7}},before=JSON.stringify(options),box=componentContentBox(options);
  assert.equal(!!box,contentOwnerTypes.includes(sample.type),sample.type);if(box){assert([box.x,box.y,box.width,box.height].every(Number.isFinite));assert(box.width>0&&box.height>0);}
  assert.equal(JSON.stringify(options),before);
 }
});
test('explicit surface layers share the runtime body without double-counted padding',()=>{
 for(const type of ['Panel','Dialog','ScrollView','Tabs','List'])for(const surfaceLayer of ['frame','content','inset']){
  const sample=cases.find(c=>c.type===type),options={type,props:{...sample.props,contentPadding:undefined},size:{width:900,height:650},profile:ctx.profile,geometry,surfaceLayer,...(surfaceLayer==='frame'?{surfaceScale:3}:{})};
  assert.deepEqual(componentContentBox(options),surfaceSlotBox(options),type+'/'+surfaceLayer);
 }
});
test('legacy Panel titles and asymmetric insets preserve the actual body; Container owns its padding',()=>{
 const options={type:'Panel',props:{title:'标题',contentPadding:{left:10,right:20,top:30,bottom:40}},size:{width:400,height:300},profile:ctx.profile,geometry};
 const body=componentContentBox(options),titleHeight=ctx.profile.geometry.lineHeight+ctx.profile.geometry.titleGap;
 assert.equal(body.x,10);assert.equal(body.y,30+titleHeight);assert.equal(body.width,370);assert.equal(body.height,230-titleHeight);
 assert.deepEqual(componentContentBox({...options,type:'Container',layout:{padding:5}}),{x:5,y:5,width:390,height:290,allowVerticalOverflow:false,insets:{left:5,right:5,top:5,bottom:5}});
});
test('hidden surface children consume no visible space while visible overflow still fails',()=>{
 const options={nodeId:'panel',type:'Panel',props:{},size:{width:300,height:200},profile:ctx.profile,geometry,surfaceLayer:'inset'};
 assert.doesNotThrow(()=>assertSurfaceSlotChildren(options,[{id:'body',size:{width:600,height:100},visible:false}]));
 assert.throws(()=>assertSurfaceSlotChildren(options,[{id:'body',size:{width:600,height:100},visible:true}]),{code:'panel.slot-bounds'});
});
test('rejected surface children report real available and required space without mutation',()=>{
 const options={nodeId:'group',type:'Panel',props:{title:'',contentPadding:{left:12,right:12,top:12,bottom:12}},size:{width:490,height:254},profile:ctx.profile,geometry,surfaceLayer:'inset'},child={id:'body',size:{width:466,height:231}},before=JSON.stringify({options,child});
 let failure;try{assertSurfaceSlotChildren(options,[child]);}catch(error){failure=error;}
 assert.equal(failure.contentBounds.available.height,230);assert.equal(failure.contentBounds.overflow.height,1);assert.equal(failure.contentBounds.minimumOwner.height,255);
 assert.equal(failure.ownerId,'group');assert.equal(failure.nodeId,'body');assert.equal(JSON.stringify({options,child}),before);
});
test('Select keeps all source options while constraining only the popup scroll viewport',()=>{
 const input={width:640,height:168,itemHeight:152,itemCount:5,maxVisibleItems:5,canvasWidth:1280,canvasHeight:720,x:100,y:600},box=selectPopupBox(input);
 assert.equal(box.menuHeight,552);assert.equal(box.height,720);assert.equal(box.y,0);assert(box.menuHeight<input.itemHeight*input.itemCount);assert(box.menuHeight>=input.itemHeight);assert.equal(input.itemCount,5);
 assert.throws(()=>selectPopupBox({...input,height:600}),{code:'select.viewport'});assert.equal(selectPopupBox({...input,itemCount:0,height:720}).menuHeight,0);
});
test('inventory uses independent grid and detail viewports, without a misleading authored body',()=>{
 assert.equal(componentContentBox({type:'List',props:{inventory:{}},surfaceLayer:'content',size:{width:500,height:500}}),null);
});
test('radio rows and Select labels reserve every gap and indicator margin',()=>{
 const width=340,count=4,gap=8,itemWidth=radioItemWidth(width,count,gap,'row');assert.equal(itemWidth,79);assert.equal(itemWidth*count+gap*(count-1),width);assert.equal(radioItemWidth(width,count,gap,'column'),width);
 assert.equal(selectLabelWidth(120,{left:12,right:12},14,8),52);
});
