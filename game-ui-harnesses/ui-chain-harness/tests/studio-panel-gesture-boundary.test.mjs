import test from 'node:test';
import assert from 'node:assert/strict';
import {editorData} from '../src/panel/data.mjs';
import {validateDocument} from '../src/panel/document.mjs';
import {mountPanelCanvasGestures} from '../src/studio/panel-canvas-gestures.mjs';

const ctx=await editorData(),board={width:ctx.canvases.presets.landscape.width,height:ctx.canvases.presets.landscape.height};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const settled=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};
function surface(){
  const handlers=new Map();return {addEventListener(name,callback){if(!handlers.has(name))handlers.set(name,new Set());handlers.get(name).add(callback);},removeEventListener(name,callback){handlers.get(name)?.delete(callback);},emit(name,event={}){event.type=name;for(const callback of [...(handlers.get(name)??[])])callback(event);}};
}
function harness(beforeEdit,boxAfterChoose){
  let doc=validateDocument({kind:'ui_panel_document',version:'0.3',id:'gesture-boundary',revision:0,title:'边界测试',canvas:'landscape',bindings:ctx.binding,rootId:'artboard',nodes:[{id:'artboard',name:'画布',recipeRef:'container@1.0.0',size:board,props:{},slots:{children:['first']},layout:{childrenMode:'free',padding:0}},{id:'first',name:'开始',recipeRef:'button@1.0.0',size:{width:300,height:60},position:{x:40,y:40},props:{label:'开始'},slots:{}}]},ctx),allowed=true;
  const win=surface(),viewport=surface(),captures=new Set(),frames=new Map(),previous={window:globalThis.window,requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame};let frame=0;
  Object.assign(viewport,{hasPointerCapture:id=>captures.has(id),setPointerCapture:id=>captures.add(id),releasePointerCapture:id=>{captures.delete(id);viewport.emit('lostpointercapture',{pointerId:id});},focus(){}});
  Object.assign(globalThis,{window:win,requestAnimationFrame:callback=>{frames.set(++frame,callback);return frame;},cancelAnimationFrame:id=>frames.delete(id)});
  let canvasBox={left:0,top:0,...board};
  const calls={choose:[],start:0,preview:[],invalid:[],finish:[],cancel:[]},defaultTarget={closest:selector=>selector==='[data-resize]'?{dataset:{resize:'e'}}:null};
  const event=(x=340,{pointerId=1,target=defaultTarget,...extra}={})=>({button:0,pointerId,clientX:x,clientY:70,target,preventDefault(){},stopImmediatePropagation(){},...extra});
  const gesture=mountPanelCanvasGestures({viewport,world:{contains:target=>target?.outside!==true},canvas:{getBoundingClientRect:()=>canvasBox},document:()=>doc,context:()=>ctx,scene:()=>({runtime:{handles:new Map(doc.nodes.map(node=>[node.id,{size:node.size,root:{visible:true,renderable:true,alpha:1,toGlobal:()=>node.position??{x:0,y:0}}}]))}}),selected:()=> 'first',canEdit:()=>allowed,beforeEdit,choose:id=>{calls.choose.push(id);if(boxAfterChoose)canvasBox={...boxAfterChoose};},start:()=>calls.start++,preview:value=>calls.preview.push(value),invalid:error=>calls.invalid.push(error),finish:value=>calls.finish.push(value),cancel:reason=>calls.cancel.push(reason),status(){}});
  return {gesture,viewport,win,calls,captures,event,get document(){return doc;},set document(value){doc=value;},set allowed(value){allowed=value;},tick(){for(const [id,callback]of [...frames]){frames.delete(id);callback();}},close(){gesture.dispose();for(const[key,value]of Object.entries(previous))if(value===undefined)delete globalThis[key];else globalThis[key]=value;}};
}

test('omitting the boundary preserves synchronous selection and the existing resize transaction',()=>{
  const h=harness();try{h.viewport.emit('pointerdown',h.event());assert.deepEqual(h.calls.choose,['first']);assert.equal(h.gesture.active,true);h.viewport.emit('pointermove',h.event(350));h.viewport.emit('pointerup',h.event(350));assert.equal(h.calls.finish.length,1);assert.equal(h.calls.finish[0].nodes.find(node=>node.id==='first').size.width,310);}finally{h.close();}
});

test('selection camera movement or scaling cannot become an extra resize delta',()=>{
  for(const {box,delta,expected}of [
    {box:{left:-100,top:0,...board},delta:10,expected:310},
    {box:{left:-300,top:-100,width:board.width*2,height:board.height*2},delta:20,expected:310},
  ]){
    const h=harness(undefined,box);try{
      h.viewport.emit('pointerdown',h.event());h.viewport.emit('pointermove',h.event(340+delta));h.viewport.emit('pointerup',h.event(340+delta));
      assert.deepEqual(h.calls.choose,['first']);assert.equal(h.calls.invalid.length,0);assert.equal(h.calls.finish.length,1);
      assert.equal(h.calls.finish[0].nodes.find(node=>node.id==='first').size.width,expected);
    }finally{h.close();}
  }
});

test('canvas hits use the pre-selection frame and moves start in the focused frame',()=>{
  const h=harness(undefined,{left:-100,top:-20,width:board.width*2,height:board.height*2}),target={closest:()=>null};try{
    h.viewport.emit('pointerdown',h.event(60,{target}));h.viewport.emit('pointermove',h.event(80,{target,clientY:90}));h.viewport.emit('pointerup',h.event(80,{target,clientY:90}));
    assert.deepEqual(h.calls.choose,['first']);assert.equal(h.calls.invalid.length,0);assert.equal(h.calls.finish.length,1);
    assert.deepEqual(h.calls.finish[0].nodes.find(node=>node.id==='first').position,{x:50,y:50});
  }finally{h.close();}
});

test('boolean boundaries accept synchronously or decline without selection or dragging',()=>{
  for(const allowed of [false,true]){const h=harness(()=>allowed);try{h.viewport.emit('pointerdown',h.event());assert.equal(h.gesture.pending,false);assert.equal(h.gesture.active,allowed);assert.equal(h.calls.choose.length,allowed?1:0);}finally{h.close();}}
});

test('an async boundary commits first, then measures the fresh document and retains movement made while waiting',async()=>{
  const gate=deferred(),h=harness(()=>gate.promise);try{
    h.viewport.emit('pointerdown',h.event());assert.equal(h.gesture.pending,true);assert.equal(h.gesture.active,false);assert.equal(h.captures.has(1),true);assert.equal(h.calls.choose.length,0);
    h.viewport.emit('pointermove',h.event(350));const next=structuredClone(h.document);next.nodes.find(node=>node.id==='first').size.width=320;next.revision=1;h.document=validateDocument(next,ctx);gate.resolve(true);await settled();
    assert.equal(h.gesture.pending,false);assert.equal(h.gesture.active,true);assert.deepEqual(h.calls.choose,['first']);h.viewport.emit('pointerup',h.event(350));
    assert.equal(h.calls.finish.length,1);assert.equal(h.calls.finish[0].nodes.find(node=>node.id==='first').size.width,330);assert.equal(h.captures.size,0);
  }finally{h.close();}
});

test('release cancel lost capture blur escape external cancel and disposal forbid late gesture starts',async()=>{
  for(const action of [h=>h.viewport.emit('pointerup',h.event()),h=>h.viewport.emit('pointercancel',h.event()),h=>h.viewport.emit('lostpointercapture',h.event()),h=>h.win.emit('blur'),h=>h.win.emit('keydown',{key:'Escape',preventDefault(){},stopImmediatePropagation(){}}),h=>h.gesture.cancel('selection'),h=>h.gesture.dispose()]){
    const gate=deferred(),h=harness(()=>gate.promise);try{h.viewport.emit('pointerdown',h.event());action(h);gate.resolve(true);await settled();assert.equal(h.gesture.active,false);assert.equal(h.gesture.pending,false);assert.equal(h.calls.choose.length,0);assert.equal(h.calls.start,0);assert.equal(h.calls.finish.length,0);assert.equal(h.captures.size,0);}finally{h.close();}
  }
});

test('false async results and changing eligibility or hit geometry never start a stale drag',async()=>{
  for(const mode of ['false','disabled','moved']){
    const gate=deferred(),h=harness(()=>gate.promise);try{
      const target={closest:()=>null};h.viewport.emit('pointerdown',h.event(60,{target}));
      if(mode==='disabled')h.allowed=false;
      if(mode==='moved'){const next=structuredClone(h.document);next.nodes.find(node=>node.id==='first').position.x=500;h.document=next;}
      gate.resolve(mode!=='false');await settled();assert.equal(h.calls.choose.length,0);assert.equal(h.gesture.active,false);assert.equal(h.captures.size,0);
    }finally{h.close();}
  }
});

test('hook errors use invalid and late rejections cannot disturb a newer accepted gesture',async()=>{
  const failure=Error('input does not fit'),sync=harness(()=>{throw failure;});try{sync.viewport.emit('pointerdown',sync.event());assert.deepEqual(sync.calls.invalid,[failure]);assert.equal(sync.gesture.active,false);}finally{sync.close();}
  const first=deferred(),second=deferred();let count=0;const h=harness(()=>++count===1?first.promise:second.promise);try{
    h.viewport.emit('pointerdown',h.event());h.viewport.emit('pointerup',h.event());h.viewport.emit('pointerdown',h.event(340,{pointerId:2}));second.resolve(true);await settled();assert.equal(h.gesture.active,true);first.reject(failure);await settled();assert.equal(h.gesture.active,true);assert.equal(h.calls.invalid.length,0);assert.equal(h.calls.choose.length,1);
  }finally{h.close();}
  const current=deferred(),rejected=harness(()=>current.promise);try{rejected.viewport.emit('pointerdown',rejected.event());current.reject(failure);await settled();assert.deepEqual(rejected.calls.invalid,[failure]);assert.equal(rejected.gesture.active,false);assert.equal(rejected.gesture.pending,false);assert.equal(rejected.captures.size,0);}finally{rejected.close();}
  let disposed;disposed=harness(()=>{disposed.gesture.dispose();return Promise.reject(failure);});try{disposed.viewport.emit('pointerdown',disposed.event());await settled();assert.equal(disposed.calls.invalid.length,0);assert.equal(disposed.gesture.active,false);}finally{disposed.close();}
});

test('the input settlement hook can synchronously use the normal change cancellation path',async()=>{
  const gate=deferred();let h;h=harness(()=>{h.gesture.cancel('change');return gate.promise;});try{h.viewport.emit('pointerdown',h.event());gate.resolve(true);await settled();assert.equal(h.gesture.active,true);assert.deepEqual(h.calls.choose,['first']);}finally{h.close();}
});
