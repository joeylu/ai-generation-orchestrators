import test from 'node:test';
import assert from 'node:assert/strict';
import Yoga from 'yoga-layout';
import {editorData} from '../src/panel/data.mjs';
import {validateDocument} from '../src/panel/document.mjs';
import {sizeEditDocument} from '../src/panel/size-edit.mjs';
import {createSession} from '../src/panel/session.mjs';
import {solveLayout,layoutBoundsError} from '../src/runtime/layout.mjs';
import {panelEditorError} from '../src/studio/panel-editor-errors.mjs';

const ctx=await editorData();
const capture=fn=>{try{fn();}catch(error){return error;}assert.fail('Expected bounds rejection');};
function fixture(direction='column'){
 const row=direction==='row';
 return {kind:'ui_panel_document',version:'0.3',id:'layout-feedback',revision:0,title:'布局错误回归',canvas:'landscape',bindings:ctx.binding,rootId:'artboard',nodes:[
  {id:'artboard',name:'画布',recipeRef:'container@1.0.0',props:{},size:{width:1280,height:720},slots:{children:['body']},layout:{childrenMode:'free',padding:0}},
  {id:'body',name:'内容分组',recipeRef:'container@1.0.0',props:{},size:{width:row?128:200,height:row?200:128},position:{x:20,y:20},slots:{children:['a','b']},layout:{childrenMode:'flow',direction,gap:12,padding:8}},
  ...['a','b'].map(id=>({id,name:id,recipeRef:'button@1.0.0',props:{label:id},size:{width:row?50:184,height:row?184:50},slots:{}})),
 ]};
}

for(const direction of ['column','row'])test('legacy '+direction+' reports the one-pixel rejected extent rather than the last valid document',()=>{
 const doc=fixture(direction),before=structuredClone(doc),axis=direction==='row'?'width':'height';
 validateDocument(doc,ctx);
 const failure=capture(()=>sizeEditDocument(doc,{nodeId:'body',[axis]:127},ctx));
 assert.equal(failure.code,'panel.overflow');assert.equal(failure.nodeId,'body');assert.equal(failure.layoutBounds.source,'fixed-flow');
 assert.equal(failure.layoutBounds.available[axis],111);assert.equal(failure.layoutBounds.occupied[axis],112);
 assert.equal(failure.layoutBounds.overflow[direction==='row'?'right':'bottom'],1);
 const formatted=panelEditorError(failure,doc,ctx);
 assert.ok(formatted.details.some(text=>text.includes(direction==='row'?'111 × 184':'184 × 111')));
 assert.ok(formatted.details.some(text=>text.includes((direction==='row'?'右边':'下边')+'超出 1')));
 assert.ok(formatted.details.every(text=>!text.includes('至少')));assert.equal(formatted.ownerId,undefined);
 assert.deepEqual(doc,before);assert.equal(Object.hasOwn(failure.layoutBounds,'minimumOwner'),false);
});

test('Yoga overflow uses the actual child offset and exposes a separate owner for navigation',()=>{
 const doc=fixture(),tree={id:'body',type:'Container',size:{width:200,height:127},layout:{direction:'column',padding:8,gap:12},children:['a','b'].map(id=>({id,type:'Button',size:{width:184,height:50}}))},before=structuredClone(tree);
 const failure=capture(()=>solveLayout(Yoga,tree));
 assert.equal(failure.nodeId,'b');assert.equal(failure.ownerId,'body');
 assert.deepEqual(failure.layoutBounds.available,{x:8,y:8,width:184,height:111});
 assert.deepEqual(failure.layoutBounds.occupied,{x:8,y:70,width:184,height:50});
 assert.deepEqual(failure.layoutBounds.overflow,{left:0,top:0,right:0,bottom:1});
 const formatted=panelEditorError(failure,doc,ctx);assert.equal(formatted.ownerId,'body');assert.equal(formatted.nodeId,'b');
 assert.ok(formatted.details.some(text=>text.includes('内容起点（8，70）')));assert.deepEqual(tree,before);
});

test('legacy fixed-child size checks do not claim flow coordinates, while free bounds preserve left/top intrusion',()=>{
 const fixed=fixture();fixed.nodes[1].layout.align='center';fixed.nodes[2].size.width=190;
 const fixedFailure=capture(()=>validateDocument(fixed,ctx)),fixedFormatted=panelEditorError(fixedFailure,fixed,ctx);
 assert.equal(fixedFailure.layoutBounds.source,'fixed-child');
 assert.ok(fixedFormatted.details.some(text=>text.includes('宽度超出 6')));
 assert.ok(fixedFormatted.details.every(text=>!text.includes('内容起点')&&!text.includes('右边超出')));
 const doc=fixture(),body=doc.nodes[1];body.size={width:200,height:200};body.layout={childrenMode:'free',padding:8};
 doc.nodes[2].position={x:2,y:3};doc.nodes[2].size={width:50,height:50};doc.nodes[3].position={x:80,y:80};doc.nodes[3].size={width:50,height:50};
 const before=structuredClone(doc),failure=capture(()=>validateDocument(doc,ctx));
 assert.equal(failure.code,'panel.bounds');assert.equal(failure.layoutBounds.source,'free-child');
 assert.deepEqual(failure.layoutBounds.overflow,{left:6,top:5,right:0,bottom:0});
 const formatted=panelEditorError(failure,doc,ctx);assert.ok(formatted.details.some(text=>text.includes('左边超出 6，上边超出 5')));assert.deepEqual(doc,before);
});

test('Yoga negative coordinates and final grid row coordinates preserve the offending edges',()=>{
 const centered={id:'body',type:'Container',size:{width:100,height:100},layout:{direction:'row',padding:8,justify:'center',align:'center'},children:[{id:'a',type:'Button',size:{width:120,height:120}}]};
 const centeredFailure=capture(()=>solveLayout(Yoga,centered));
 assert.equal(centeredFailure.layoutBounds.occupied.x,-10);assert.equal(centeredFailure.layoutBounds.occupied.y,-10);
 assert.deepEqual(centeredFailure.layoutBounds.overflow,{left:18,top:18,right:18,bottom:18});
 const grid={id:'body',type:'Container',size:{width:200,height:147},layout:{direction:'grid',columns:2,cellHeight:60,padding:8,gap:12},children:['a','b','c'].map(id=>({id,type:'Button',size:{width:24,height:24}}))};
 const gridFailure=capture(()=>solveLayout(Yoga,grid));assert.equal(gridFailure.nodeId,'c');
 assert.equal(gridFailure.layoutBounds.occupied.y,80);assert.equal(gridFailure.layoutBounds.overflow.bottom,1);
});

for(const [sides,position]of [[['左边','上边'],{x:7.9999,y:7.9998}],[['右边','下边'],{x:142.0001,y:142.0002}]])test('legacy strict free bounds never display positive '+sides.join('/')+' excess as zero',()=>{
 const doc=fixture(),body=doc.nodes[1];body.size={width:200,height:200};body.layout={childrenMode:'free',padding:8};
 doc.nodes[2].position=position;doc.nodes[2].size={width:50,height:50};doc.nodes[3].position={x:80,y:80};doc.nodes[3].size={width:50,height:50};
 const before=structuredClone(doc),failure=capture(()=>validateDocument(doc,ctx)),evidence=structuredClone(failure.layoutBounds),formatted=panelEditorError(failure,doc,ctx);
 assert.equal(failure.code,'panel.bounds');assert.equal(failure.layoutBounds.source,'free-child');
 for(const side of sides)assert.ok(formatted.details.some(text=>text.includes(side+'超出 少于 0.001')));
 assert.ok(formatted.details.every(text=>!text.includes('超出 0 逻辑像素')));
 assert.deepEqual(failure.layoutBounds,evidence);assert.deepEqual(doc,before);
});

test('negative child coordinates retain every sub-thousandth edge excess in feedback',()=>{
 const doc=fixture(),failure=layoutBoundsError({nodeId:'a',ownerId:'body',source:'yoga',available:{x:0,y:0,width:100,height:100},occupied:{x:-.0001,y:-.0002,width:100.0003,height:100.0005},message:'排版超出容器。'}),before=structuredClone(failure.layoutBounds);
 assert.ok(failure.layoutBounds.occupied.x<0&&failure.layoutBounds.occupied.y<0);
 for(const value of Object.values(failure.layoutBounds.overflow))assert.ok(value>0&&value<.001);
 const formatted=panelEditorError(failure,doc,ctx);
 for(const side of ['左边','上边','右边','下边'])assert.ok(formatted.details.some(text=>text.includes(side+'超出 少于 0.001')));
 assert.equal(formatted.nodeId,'a');assert.equal(formatted.ownerId,'body');assert.deepEqual(failure.layoutBounds,before);
});

test('legacy invisible children do not consume visible bounds, while structure and re-show remain checked',()=>{
 for(const mode of ['flow','free']){
  const doc=fixture(),body=doc.nodes[1];
  const hidden={id:'hidden',name:'隐藏控件',recipeRef:'button@1.0.0',props:{visible:false},size:{width:1000,height:1000},slots:{}};
  body.slots.children.push(hidden.id);doc.nodes.push(hidden);
  if(mode==='free'){body.layout={childrenMode:'free',padding:8};doc.nodes[2].position={x:8,y:8};doc.nodes[3].position={x:8,y:70};hidden.position={x:500,y:500};}
  validateDocument(doc,ctx);
  hidden.props.visible=true;assert.throws(()=>validateDocument(doc,ctx),{code:'panel.bounds'});hidden.props.visible=false;
  if(mode==='free'){delete hidden.position;assert.throws(()=>validateDocument(doc,ctx),{code:'panel.position'});}
  else{hidden.position={x:1,y:1};assert.throws(()=>validateDocument(doc,ctx),{code:'panel.position'});}
 }
});

test('malformed or foreign layout evidence never supplies numbers or a guessed owner',()=>{
 const doc=fixture(),failure=capture(()=>sizeEditDocument(doc,{nodeId:'body',height:127},ctx));
 for(const mutate of [e=>e.layoutBounds.available.width=NaN,e=>e.layoutBounds.occupied.height=-1,e=>e.layoutBounds.ownerId='missing',e=>e.layoutBounds.nodeId='a',e=>e.layoutBounds.source='invented',e=>e.layoutBounds.overflow.bottom=Infinity]){
  const bad=Object.assign(new Error(failure.message),{code:failure.code,nodeId:failure.nodeId,layoutBounds:structuredClone(failure.layoutBounds)});mutate(bad);
  const formatted=panelEditorError(bad,doc,ctx);assert.ok(formatted.details.every(text=>!text.includes('可用内容区')));assert.equal(formatted.ownerId,undefined);
 }
 const invalid=layoutBoundsError({nodeId:'a',ownerId:'body',source:'yoga',available:{x:0,y:0,width:-1,height:10},occupied:{x:0,y:0,width:10,height:10},message:'越界'});assert.equal(invalid.layoutBounds,undefined);
});

test('failed candidate diagnostics preserve session authoring, renderer and undo/redo history',async()=>{
 const doc=fixture(),session=createSession(doc,ctx,document=>({document}));await session.initialize();
 const before=session.document,current=session.current,revision=session.revision;
 const candidate=structuredClone(doc);candidate.nodes[1].size.height=127;
 await assert.rejects(session.commit(candidate),{code:'panel.overflow'});
 assert.deepEqual(session.document,before);assert.equal(session.current,current);assert.equal(session.revision,revision);assert.equal(session.canUndo,false);assert.equal(session.canRedo,false);
});
