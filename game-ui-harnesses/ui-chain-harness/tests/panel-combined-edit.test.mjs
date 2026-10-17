import test from 'node:test';
import assert from 'node:assert/strict';
import {editorData} from '../src/panel/data.mjs';
import {validateDocument} from '../src/panel/document.mjs';
import {combinedEditDocument,rectangleEditDocument,textEditDocument,sizeEditTargets,validateSizeEdit} from '../src/panel/size-edit.mjs';

const ctx=await editorData(),find=(doc,id='copy')=>doc.nodes.find(node=>node.id===id);
function textDocument({fontSize=32,height=60}={}){
  const {width:boardWidth,height:boardHeight}=ctx.canvases.presets.landscape;
  return validateDocument({kind:'ui_panel_document',version:'0.3',id:'combined-edit',revision:0,title:'Combined edit fixture',canvas:'landscape',bindings:ctx.binding,rootId:'board',nodes:[
    {id:'board',name:'Board',recipeRef:'container@1.0.0',size:{width:boardWidth,height:boardHeight},props:{},slots:{children:['copy']},layout:{childrenMode:'free',padding:0}},
    {id:'copy',name:'Copy',recipeRef:'text@1.0.0',size:{width:300,height},position:{x:40,y:40},props:{text:'Hello',textStyleRef:'body',wrap:'none',overflow:'error',fontSize},slots:{}},
  ]},ctx);
}

test('a smaller font and smaller rectangle validate together rather than rejecting an intermediate size',()=>{
  const doc=textDocument(),before=structuredClone(doc);
  assert.throws(()=>rectangleEditDocument(doc,{nodeId:'copy',height:30},ctx),{code:'edit.text-capacity'});
  const next=combinedEditDocument(doc,{nodeId:'copy',rect:{height:30},changes:{fontSize:12}},ctx);
  assert.equal(find(next).size.height,30);assert.equal(find(next).props.fontSize,12);
  assert.deepEqual(validateSizeEdit(doc,next,ctx),next);assert.deepEqual(doc,before);assert.equal(next.revision,doc.revision);
});

test('a larger font and larger rectangle also validate as one complete candidate',()=>{
  const doc=textDocument({fontSize:12,height:30}),before=structuredClone(doc);
  assert.throws(()=>textEditDocument(doc,{nodeId:'copy',changes:{fontSize:32}},ctx));
  const next=combinedEditDocument(doc,{nodeId:'copy',rect:{height:60},changes:{fontSize:32}},ctx);
  assert.equal(find(next).size.height,60);assert.equal(find(next).props.fontSize,32);assert.deepEqual(doc,before);
});

test('copy, typography, color and all rectangle fields form a single authored transaction',()=>{
  const doc=textDocument(),before=structuredClone(doc),text='abcdefghijklmnop';
  assert.throws(()=>textEditDocument(doc,{nodeId:'copy',changes:{text}},ctx),{code:'edit.text-capacity'});
  const next=combinedEditDocument(doc,{nodeId:'copy',rect:{x:100,y:90,width:260,height:30},changes:{text,fontSize:12,textColor:'#dba442'}},ctx),node=find(next);
  assert.deepEqual(node.position,{x:100,y:90});assert.deepEqual(node.size,{width:260,height:30});
  assert.equal(node.props.text,text);assert.equal(node.props.fontSize,12);assert.equal(node.props.textColor,'#dba442');
  const target=sizeEditTargets(next,ctx).find(target=>target.id==='copy');assert.equal(target.width,260);assert.equal(target.height,30);
  assert.deepEqual(next.bindings,doc.bindings);assert.deepEqual(node.slots,find(doc).slots);assert.deepEqual(doc,before);
});

test('combined edits reuse fitted child propagation with the old and new title reservations',()=>{
  const {width,height}=ctx.canvases.presets.landscape,pad=ctx.profile.padding,titleHeight=ctx.profile.geometry.lineHeight+ctx.profile.geometry.titleGap;
  const doc=validateDocument({kind:'ui_panel_document',version:'0.3',id:'combined-panel-edit',revision:0,title:'Panel fixture',canvas:'landscape',bindings:ctx.binding,rootId:'board',nodes:[
    {id:'board',name:'Board',recipeRef:'container@1.0.0',size:{width,height},props:{},slots:{children:['surface']},layout:{childrenMode:'free',padding:0}},
    {id:'surface',name:'Surface',recipeRef:'panel@1.0.0',size:{width:400,height:500},position:{x:40,y:40},props:{title:'Inventory'},slots:{content:['body']}},
    {id:'body',name:'Body',recipeRef:'container@1.0.0',size:{width:400-pad*2,height:500-pad*2-titleHeight},props:{},slots:{children:[]},layout:{childrenMode:'free',padding:0}},
  ]},ctx),before=structuredClone(doc);
  const next=combinedEditDocument(doc,{nodeId:'surface',rect:{width:480,height:540},changes:{fontSize:ctx.profile.fontSize*2}},ctx);
  assert.equal(find(next,'body').size.width,find(doc,'body').size.width+80);
  assert.equal(find(next,'body').size.height,find(doc,'body').size.height+40-ctx.profile.geometry.lineHeight);
  assert.deepEqual(find(next,'surface').position,{x:40,y:40});assert.deepEqual(doc,before);
});

test('incomplete or forbidden combined candidates fail atomically without weakening any final gate',()=>{
  const doc=textDocument(),before=structuredClone(doc);
  for(const edit of [
    {nodeId:'copy',rect:{height:24},changes:{fontSize:32}},
    {nodeId:'copy',rect:{x:2000},changes:{fontSize:12}},
    {nodeId:'copy',rect:{height:30},changes:{fontSize:12,text:'x'.repeat(1000)}},
    {nodeId:'copy',rect:{height:30},changes:{fontSize:0}},
    {nodeId:'copy',rect:{height:30},changes:{textColor:'red'}},
    {nodeId:'copy',rect:{height:30},changes:{align:'right'}},
    {nodeId:'copy',rect:{position:{x:1,y:1}}},
  ]){assert.throws(()=>combinedEditDocument(doc,edit,ctx));assert.deepEqual(doc,before);}
  const locked=structuredClone(doc);find(locked,'board').locked=true;
  assert.throws(()=>combinedEditDocument(locked,{nodeId:'copy',changes:{text:'Changed'}},ctx),{code:'edit.locked'});
  assert.deepEqual(locked,{...before,nodes:before.nodes.map(node=>node.id==='board'?{...node,locked:true}:node)});
});

test('single-group calls retain the existing public edit results and can restore default typography',()=>{
  const doc=textDocument();
  assert.deepEqual(combinedEditDocument(doc,{nodeId:'copy',rect:{width:320}},ctx),rectangleEditDocument(doc,{nodeId:'copy',width:320},ctx));
  assert.deepEqual(combinedEditDocument(doc,{nodeId:'copy',changes:{fontSize:null,textColor:'#123456'}},ctx),textEditDocument(doc,{nodeId:'copy',changes:{fontSize:null,textColor:'#123456'}},ctx));
});
