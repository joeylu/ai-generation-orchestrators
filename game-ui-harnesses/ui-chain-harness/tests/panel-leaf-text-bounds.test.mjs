import test from 'node:test';
import assert from 'node:assert/strict';
import {editorData} from '../src/panel/data.mjs';
import {validateDocument} from '../src/panel/document.mjs';
import {textEditDocument,validateSizeEdit} from '../src/panel/size-edit.mjs';

const ctx=await editorData(),board=ctx.canvases.presets.landscape;
function fixture(recipe,props,width,height,context=ctx,extra={}){
  return validateDocument({kind:'ui_panel_document',version:'0.3',id:'leaf-text-bounds',revision:0,title:'fixture',canvas:'landscape',bindings:context.binding,rootId:'root',nodes:[
    {id:'control',name:'control',recipeRef:recipe+'@1.0.0',props,size:{width,height},slots:{},position:{x:24,y:24},...extra},
    {id:'root',name:'root',recipeRef:'container@1.0.0',props:{},size:{width:board.width,height:board.height},slots:{children:['control']},layout:{childrenMode:'free',padding:0}},
  ]},context);
}
const options=Array.from({length:4},(_,i)=>({id:'o'+i,label:'甲',enabled:true}));

test('horizontal radio labels reserve the same inter-item gaps as the runtime',()=>{
  const base=fixture('radio-group',{options,selectedId:'o0',direction:'row'},340,24),changed=structuredClone(base);
  // Old gate: 340 / 4 - 24 - 8 = 53; runtime: (340 - 3 * 8) / 4 - 24 - 8 = 47.
  // Three CJK characters require 52.8 conservative pixels and must be rejected.
  changed.nodes[0].props.options[0].label='甲乙丙';
  assert.throws(()=>validateSizeEdit(base,changed,ctx),{code:'edit.text-capacity'});
  assert.throws(()=>textEditDocument(base,{nodeId:'control',changes:{'options.0.label':'甲乙丙'}},ctx),{code:'edit.text-capacity'});
  assert.equal(textEditDocument(base,{nodeId:'control',changes:{'options.0.label':'甲乙'}},ctx).nodes[0].props.options[0].label,'甲乙');
  const column=fixture('radio-group',{options,selectedId:'o0',direction:'column'},340,120);
  assert.equal(textEditDocument(column,{nodeId:'control',changes:{'options.0.label':'甲乙丙'}},ctx).nodes[0].props.options[0].label,'甲乙丙');
});
function imported(mutate){
 const roles=ctx.usage.bindings.map(({role,assetId})=>({role,assetId})),assets=[...new Set(roles.map(r=>r.assetId))].map(assetId=>({assetId,width:512,height:512,stretch:'nine-slice',nineSlice:{left:0,right:0,top:0,bottom:0},contentInsets:{left:0,right:0,top:0,bottom:0},minSize:{width:1,height:1}})),geometry={version:'1.0',scale:1,roles,assets};
 for(const binding of roles)mutate(binding.role,assets.find(a=>a.assetId===binding.assetId));return {...ctx,binding:{sourceKind:'imported',sha256:'a'.repeat(64)},skinGeometry:geometry};
}
test('all button states share the actual per-side maximum safe insets',()=>{
 const c=imported((role,asset)=>{if(role==='skin.button.primary.normal')asset.contentInsets.left=20;if(role==='skin.button.primary.pressed')asset.contentInsets.right=20;}),base=fixture('button',{label:'甲',variant:'primary'},100,40,c);
 // Each state alone leaves 80px, but the fixed shared label has only 60px.
 assert.throws(()=>textEditDocument(base,{nodeId:'control',changes:{label:'甲乙丙丁'}},c),{code:'edit.text-capacity'});
 assert.doesNotThrow(()=>textEditDocument(base,{nodeId:'control',changes:{label:'甲乙丙'}},c));
});
test('layered List label checks consume the content layer before item insets',()=>{
 const c=imported((role,asset)=>{if(role==='skin.surface.content')asset.contentInsets={left:20,right:20,top:20,bottom:20};if(role.startsWith('skin.item.'))asset.contentInsets={left:12,right:12,top:0,bottom:0};}),props={items:[{id:'one',label:'甲',enabled:true}],itemRecipeRef:'button@1.0.0',selection:'single',selectedId:'one',gapToken:'controlGap'},base=fixture('list',props,100,120,c,{surfaceLayer:'content'});
 // Row width 60 minus 24 insets leaves 36, rather than the old 76.
 assert.throws(()=>textEditDocument(base,{nodeId:'control',changes:{'items.0.label':'甲乙丙'}},c),{code:'edit.text-capacity'});
 assert.doesNotThrow(()=>textEditDocument(base,{nodeId:'control',changes:{'items.0.label':'甲乙'}},c));
});

test('select placeholder and every closed-state option reserve both indicator margins',()=>{
  const base=fixture('select',{options,selectedId:'o0',placeholder:'甲',maxVisibleItems:3},120,32);
  // Fixture field horizontal insets total 24, indicator+gap is 22.
  // Old gate left 74px; the actual centered closed label has only 52px.
  for(const field of ['placeholder','options.0.label','options.3.label']){
    assert.throws(()=>textEditDocument(base,{nodeId:'control',changes:{[field]:'甲乙丙丁'}},ctx),{code:'edit.text-capacity'});
    const changed=structuredClone(base);
    if(field==='placeholder')changed.nodes[0].props.placeholder='甲乙丙丁';else changed.nodes[0].props.options[Number(field.split('.')[1])].label='甲乙丙丁';
    assert.throws(()=>validateSizeEdit(base,changed,ctx),{code:'edit.text-capacity'});
    const good=textEditDocument(base,{nodeId:'control',changes:{[field]:'甲乙'}},ctx);assert.ok(good);
  }
});
