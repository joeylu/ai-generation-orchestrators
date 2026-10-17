import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {editorData} from '../src/panel/data.mjs';
import {componentContentBox,contentOwnerTypes} from '../src/runtime/content-bounds.mjs';
import {surfaceSlotBox,surfaceGeometryForContext,assertSurfaceSlotChildren} from '../src/runtime/surface-slots.mjs';
import {validateDocument} from '../src/panel/document.mjs';
import {validateSizeEdit,sizeEditTargets} from '../src/panel/size-edit.mjs';
import {panelBodyFrames} from '../src/studio/panel-editor-body.mjs';
import {panelEditorError} from '../src/studio/panel-editor-errors.mjs';
import {selectPopupBox} from '../src/runtime/select-geometry.mjs';
import {radioItemWidth,selectLabelWidth} from '../src/runtime/option-geometry.mjs';
const ctx=await editorData(),cases=JSON.parse(await readFile(new URL('../fixtures/component-cases.json',import.meta.url))).cases;
const geometry=surfaceGeometryForContext(ctx);
test('all 16 components explicitly distinguish an owned child body from leaf content',()=>{
 assert.equal(new Set(cases.map(c=>c.type)).size,16);
 for(const sample of cases){
  const options={type:sample.type,props:sample.props,size:sample.size,profile:ctx.profile,geometry,layout:{padding:7}},before=JSON.stringify(options),box=componentContentBox(options);
  assert.equal(!!box,contentOwnerTypes.includes(sample.type),sample.type);if(box){assert([box.x,box.y,box.width,box.height].every(Number.isFinite));assert(box.width>0&&box.height>0);}
  assert.equal(JSON.stringify(options),before);
 }
});
test('explicit layers and scaled frames report the exact shared surface slot without subtracting padding twice',()=>{
 for(const type of ['Panel','Dialog','ScrollView','Tabs','List'])for(const layer of ['frame','content','inset']){
  const sample=cases.find(c=>c.type===type),options={type,props:{...sample.props,contentPadding:undefined},size:{width:900,height:650},profile:ctx.profile,geometry,surfaceLayer:layer,...(layer==='frame'?{surfaceScale:3}:{})};
  assert.deepEqual(componentContentBox(options),surfaceSlotBox(options),type+'/'+layer);
 }
});
test('asymmetric legacy panel body includes title and literal insets; Container only consumes its own padding',()=>{
 const options={type:'Panel',props:{title:'标题',contentPadding:{left:10,right:20,top:30,bottom:40}},size:{width:400,height:300},profile:ctx.profile,geometry};
 const b=componentContentBox(options),title=ctx.profile.geometry.lineHeight+ctx.profile.geometry.titleGap;assert.equal(b.x,10);assert.equal(b.y,30+title);assert.equal(b.width,370);assert.equal(b.height,230-title);
 assert.deepEqual(componentContentBox({...options,type:'Container',layout:{padding:5}}),{x:5,y:5,width:390,height:290,allowVerticalOverflow:false,insets:{left:5,right:5,top:5,bottom:5}});
});
test('hidden slot nodes do not falsely consume a visible body, while visible equivalents still fail',()=>{
 const {width,height}=ctx.canvases.presets.landscape,doc={kind:'ui_panel_document',version:'0.3',id:'hidden-slot',title:'隐藏边界',revision:0,canvas:'landscape',bindings:ctx.binding,rootId:'artboard',nodes:[{id:'artboard',name:'画布',recipeRef:'container@1.0.0',props:{},size:{width,height},layout:{childrenMode:'free'},slots:{children:['panel']}},{id:'panel',name:'面板',recipeRef:'panel@1.0.0',props:{title:''},size:{width:300,height:200},position:{x:10,y:10},slots:{content:['body']}},{id:'body',name:'内容',recipeRef:'container@1.0.0',props:{visible:false},size:{width:600,height:100},slots:{children:[]}}]};
 const valid=validateDocument(doc,ctx);assert.doesNotThrow(()=>validateSizeEdit(valid,valid,ctx));
 const options={nodeId:'panel',type:'Panel',props:{},size:{width:300,height:200},profile:ctx.profile,geometry,surfaceLayer:'inset'};
 assert.doesNotThrow(()=>assertSurfaceSlotChildren(options,[{id:'body',size:{width:600,height:100},visible:false}]));assert.throws(()=>assertSurfaceSlotChildren(options,[{id:'body',size:{width:600,height:100},visible:true}]),{code:'panel.slot-bounds'});
});
test('rejected candidate diagnostics report actual space, excess and owner without mutating inputs',()=>{
 const options={nodeId:'group',type:'Panel',props:{title:'',contentPadding:{left:12,right:12,top:12,bottom:12}},size:{width:490,height:254},profile:ctx.profile,geometry,surfaceLayer:'inset'},child={id:'body',size:{width:466,height:231}},before=JSON.stringify({options,child});
 let failure;try{assertSurfaceSlotChildren(options,[child]);}catch(error){failure=error;}
 assert.equal(failure.contentBounds.available.height,230);assert.equal(failure.contentBounds.overflow.height,1);assert.equal(failure.contentBounds.minimumOwner.height,255);
 const doc={rootId:'root',nodes:[{id:'group',recipeRef:'panel@1.0.0',props:{title:'信息分组'}},{id:'body',recipeRef:'container@1.0.0',props:{}}]},message=panelEditorError(failure,doc,ctx);assert.equal(message.nodeId,'body');assert.match(message.details.join(''),/230/);assert.match(message.details.join(''),/超出 1/);assert.match(message.details.join(''),/255/);assert.equal(JSON.stringify({options,child}),before);
});
test('body overlay uses rendered origins and the logical scale once, including scrolled ancestors',()=>{
 const targets=[{id:'panel',body:{x:12,y:20,width:466,height:231}},{id:'body',parentId:'panel',body:{x:5,y:5,width:456,height:221}}],before=structuredClone(targets),offsets={panel:{x:100,y:200},body:{x:112,y:170}},frames=panelBodyFrames(targets,'body',(id,p)=>({x:offsets[id].x+p.x,y:offsets[id].y+p.y}),.5);
 assert.deepEqual(frames.find(f=>f.key==='parent').rect,{x:56,y:110,width:233,height:115.5});assert.deepEqual(frames.find(f=>f.key==='self').rect,{x:58.5,y:87.5,width:228,height:110.5});assert.deepEqual(targets,before);
});
test('Select popup stays within the canvas and all original rows remain reachable by scrolling',()=>{
 const input={width:640,height:168,itemHeight:152,itemCount:5,maxVisibleItems:5,canvasWidth:1280,canvasHeight:720,x:100,y:600},box=selectPopupBox(input);
 assert.equal(box.menuHeight,552);assert.equal(box.height,720);assert.equal(box.y,0);assert(box.menuHeight<input.itemHeight*input.itemCount);assert(box.menuHeight>=input.itemHeight);assert.equal(input.itemCount,5);
 assert.throws(()=>selectPopupBox({...input,height:600}),{code:'select.viewport'});assert.equal(selectPopupBox({...input,itemCount:0,height:720}).menuHeight,0);
});
test('inventory has independent grid/detail viewports and never reports a misleading single authored body',()=>{
 assert.equal(componentContentBox({type:'List',props:{inventory:{}},surfaceLayer:'content',size:{width:500,height:500}}),null);
});
test('row option widths used at initial construction and resize include every gap and indicator reservation',()=>{
 const width=340,count=4,gap=8,itemWidth=radioItemWidth(width,count,gap,'row');assert.equal(itemWidth,79);assert.equal(itemWidth*count+gap*(count-1),width);assert.equal(radioItemWidth(width,count,gap,'column'),width);
 assert.equal(selectLabelWidth(120,{left:12,right:12},14,8),52);
});
