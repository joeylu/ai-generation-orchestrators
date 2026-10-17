import test from 'node:test';
import assert from 'node:assert/strict';
import {editorData} from '../src/panel/data.mjs';
import {validateDocument} from '../src/panel/document.mjs';
import {mountPanelCanvasGestures} from '../src/studio/panel-canvas-gestures.mjs';
import {panelEditorError} from '../src/studio/panel-editor-errors.mjs';
const ctx=await editorData();
test('an invalid release retains the structured error identity needed to locate the blocker',()=>{
 const {width,height}=ctx.canvases.presets.landscape;
 const doc=validateDocument({kind:'ui_panel_document',version:'0.3',id:'gesture-error',revision:0,title:'拖动错误夹具',canvas:'landscape',bindings:ctx.binding,rootId:'artboard',nodes:[{id:'artboard',name:'画布',recipeRef:'container@1.0.0',size:{width,height},props:{},slots:{children:['first']},layout:{childrenMode:'free',padding:0}},{id:'first',name:'开始',recipeRef:'button@1.0.0',size:{width:300,height:60},position:{x:40,y:40},props:{label:'开始'},slots:{}}]},ctx);
 const callbacks={},win={addEventListener(){},removeEventListener(){}},previous={window:globalThis.window,requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame};
 Object.assign(globalThis,{window:win,requestAnimationFrame:()=>1,cancelAnimationFrame(){}});
 const viewport={addEventListener(name,fn){callbacks[name]=fn;},removeEventListener(){},hasPointerCapture(){return false;},setPointerCapture(){},focus(){}},invalid=[],cancelled=[],published=[];
 const blocker=Object.assign(Error('first: 流式区域内容放不下，请增大容器或使用滚动区域。'),{code:'panel.overflow'});
 const gesture=mountPanelCanvasGestures({viewport,world:{contains:()=>true},canvas:{getBoundingClientRect:()=>({left:0,top:0,width,height})},document:()=>doc,context:()=>ctx,scene:()=>({runtime:{handles:new Map()}}),selected:()=> 'first',canEdit:()=>true,choose(){},start(){},preview(){throw blocker;},invalid:error=>invalid.push(error),cancel:event=>cancelled.push(event),finish:value=>published.push(value),status(){}});
 const event=x=>({button:0,pointerId:1,clientX:x,clientY:70,target:{closest:selector=>selector==='[data-resize]'?{dataset:{resize:'e'}}:null},preventDefault(){},stopImmediatePropagation(){}});
 try{
  callbacks.pointerdown(event(340));callbacks.pointermove(event(350));callbacks.pointerup(event(350));
  assert.equal(published.length,0);assert.equal(cancelled.at(-1).reason,'invalid');assert.equal(invalid.at(-1),blocker);assert.equal(invalid.at(-1).code,'panel.overflow');assert.equal(panelEditorError(invalid.at(-1),doc,ctx).nodeId,'first');assert.equal(gesture.active,false);
 }finally{gesture.dispose();for(const[key,value]of Object.entries(previous))if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
});
