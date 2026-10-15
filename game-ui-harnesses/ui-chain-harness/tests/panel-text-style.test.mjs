import test from 'node:test';
import assert from 'node:assert/strict';
import {editorData} from '../src/panel/data.mjs';
import {validateDocument} from '../src/panel/document.mjs';
import {createSession} from '../src/panel/session.mjs';
import {textEditDocument,textEditFields,textStyleEditState,validateSizeEdit} from '../src/panel/size-edit.mjs';
import {minimumSize} from '../src/runtime/geometry.mjs';
import {assertPngComponent} from '../src/runtime/png-geometry.mjs';
import {supportsTextStyle,supportsNodeTextStyle,textStylePropsSchema,textMetrics,textProfile,upgradeTextStyleRegistry} from '../src/runtime/text-style.mjs';

const ctx=await editorData(),find=(doc,id='subject')=>doc.nodes.find(node=>node.id===id);
const node=(id,type,props={},size={width:600,height:400},slots={})=>({id,name:id,recipeRef:type+'@1.0.0',props,size,slots});
function fixture(type,props={},customRows=false){
  const subject=node('subject',type,props),children=[];
  if(type==='text')subject.props.textStyleRef='body';
  if(['panel','dialog'].includes(type)){subject.slots.content=['body'];children.push(node('body','container',{}, {width:500,height:200},{children:[]}));}
  if(type==='tabs'){
    subject.props.tabs=[{id:'a',label:'甲',contentNodeId:'page-a'},{id:'b',label:'乙',contentNodeId:'page-b'}];subject.props.activeId='a';subject.slots.pages=['page-a','page-b'];
    children.push(...subject.slots.pages.map(id=>node(id,'container',{}, {width:500,height:200},{children:[]})));
  }
  if(['radio-group','select'].includes(type)){subject.props.options=[{id:'a',label:'甲',enabled:true},{id:'b',label:'乙',enabled:false}];subject.props.selectedId='a';}
  if(type==='list'){
    subject.props.items=[{id:'a',label:'甲',enabled:true}];subject.props.itemRecipeRef='button@1.0.0';subject.props.selectedId='a';
    if(customRows){subject.slots.items=['custom-row'];children.push(node('custom-row','button',{label:'子控件'}, {width:400,height:48}));}
  }
  if(type==='dialog')subject.props.actions=[{id:'confirm',label:'确认',variant:'primary',closeOnActivate:true}];
  subject.position={x:40,y:40};
  const {width,height}=ctx.canvases.presets.landscape,root=node('artboard','container',{}, {width,height},{children:['subject']});root.layout={childrenMode:'free',padding:0};
  return validateDocument({kind:'ui_panel_document',version:'0.3',id:'text-style-fixture',revision:0,title:'样式夹具',canvas:'landscape',bindings:ctx.binding,rootId:root.id,nodes:[root,subject,...children]},ctx);
}

test('shared metrics preserve defaults and apply node overrides once without scaling skin marks or padding',()=>{
  const base=ctx.profile,before=structuredClone(base),styled=textProfile(base,{fontSize:32,textColor:'#aBcDeF'});
  assert.strictEqual(textProfile(base),base);
  assert.deepEqual(textMetrics(base,{fontSize:32}),{fontSize:32,lineHeight:48,itemHeight:56});
  assert.deepEqual(textMetrics(base,{fontSize:12}),{fontSize:12,lineHeight:18,itemHeight:32});
  assert.equal(styled.markSize,base.markSize);assert.equal(styled.padding,base.padding);assert.equal(styled.palette.text,'#aBcDeF');
  assert.deepEqual(textProfile(styled,{fontSize:32,textColor:'#aBcDeF'}),styled);
  assert.strictEqual(textProfile(styled),base);assert.deepEqual(base,before);
  assert.equal(JSON.stringify(styled).includes('ui-chain.text-style'),false);
  assert.deepEqual(minimumSize('RadioGroup',{direction:'column',options:[{},{}],fontSize:32},base),{width:56,height:104});
  assert.deepEqual(minimumSize('RadioGroup',{direction:'row',options:[{},{}],fontSize:32},base),{width:120,height:48});
});

test('optional typography schema is additive for 13 types and never changes frozen registry identity or defaults',()=>{
  const original=structuredClone(ctx.registry);
  for(const recipe of original.recipes)for(const key of Object.keys(textStylePropsSchema))delete recipe.propsSchema.properties[key];
  const snapshot=structuredClone(original),upgraded=upgradeTextStyleRegistry(original);
  assert.deepEqual(original,snapshot);assert.equal(upgraded.revision,original.revision);
  assert.equal(upgraded.recipes.filter(recipe=>supportsTextStyle(recipe.type)).length,13);
  for(const recipe of upgraded.recipes)for(const [key,schema]of Object.entries(textStylePropsSchema)){
    assert.deepEqual(recipe.propsSchema.properties[key],supportsTextStyle(recipe.type)?schema:undefined);
    assert.equal(Object.hasOwn(recipe.propsSchema.properties[key]??{},'default'),false);
  }
  assert.deepEqual(upgradeTextStyleRegistry(upgraded),upgraded);
  for(const incompatible of [{type:'integer',minimum:1,maximum:999},{...textStylePropsSchema.fontSize,default:16},null]){
    const bad=structuredClone(original);bad.recipes[0].propsSchema.properties.fontSize=incompatible;
    assert.throws(()=>upgradeTextStyleRegistry(bad),{code:'text.registry'});
  }
  const doc=fixture('button',{label:'原文'});assert.equal(Object.hasOwn(find(doc).props,'fontSize'),false);assert.equal(Object.hasOwn(find(doc).props,'textColor'),false);
  assert.deepEqual(validateSizeEdit(doc,doc,ctx),doc);
});

test('text font and color form one pure candidate with exact hexadecimal strings and explicit default restoration',()=>{
  const doc=fixture('button',{label:'原文'}),snapshot=structuredClone(doc),next=textEditDocument(doc,{nodeId:'subject',changes:{label:'新文字',fontSize:32,textColor:'#aBcDeF'}},ctx);
  assert.deepEqual(doc,snapshot);assert.equal(find(next).props.label,'新文字');assert.equal(find(next).props.fontSize,32);assert.equal(find(next).props.textColor,'#aBcDeF');
  assert.deepEqual(textEditFields(next,'subject',ctx).map(field=>field.id),['label']);
  assert.deepEqual(textStyleEditState(next,'subject',ctx),{supported:true,editable:true,fontSize:32,fontSizeOverride:32,textColor:'#aBcDeF',textColorOverride:'#aBcDeF',isAutomaticColor:false});
  const restored=textEditDocument(next,{nodeId:'subject',changes:{fontSize:null,textColor:null}},ctx);
  assert.equal(Object.hasOwn(find(restored).props,'fontSize'),false);assert.equal(Object.hasOwn(find(restored).props,'textColor'),false);
  const state=textStyleEditState(restored,'subject',ctx,{defaultTextColor:'#102030'});assert.equal(state.fontSize,ctx.profile.fontSize);assert.equal(state.textColor,'#102030');assert.equal(state.isAutomaticColor,true);
  assert.deepEqual(next.nodes.map(node=>node.slots),doc.nodes.map(node=>node.slots));assert.deepEqual(next.bindings,doc.bindings);
});

test('every drawn text type accepts scoped style while content children retain their own inherited profile',()=>{
  for(const type of ['text','panel','dialog','button','switch','check-box','radio-group','input','select','tabs','list','slider','progress-bar']){
    const doc=fixture(type,['slider','progress-bar'].includes(type)?{showValue:true}:{}),next=textEditDocument(doc,{nodeId:'subject',changes:{fontSize:24,textColor:'#FFFFFF'}},ctx);
    assert.equal(find(next).props.fontSize,24,type);assert.equal(find(next).props.textColor,'#FFFFFF',type);
    for(const child of next.nodes.filter(node=>!['artboard','subject'].includes(node.id)))assert.equal(child.props.fontSize,undefined);
  }
});

test('invalid style values and invisible text ownership are rejected by candidate and save gates',()=>{
  const doc=fixture('button',{label:'原文'});
  for(const value of [11,97,16.5,'24',NaN,Infinity])assert.throws(()=>textEditDocument(doc,{nodeId:'subject',changes:{fontSize:value}},ctx),{code:'edit.font-size'});
  for(const value of ['red','#FFF','#12345678','var(--text)','<style>x</style>',' #123456'])assert.throws(()=>textEditDocument(doc,{nodeId:'subject',changes:{textColor:value}},ctx),{code:'edit.text-color'});
  for(const [type,props,customRows]of [['container',{},false],['list',{},true],['slider',{showValue:false},false],['progress-bar',{showValue:false},false]]){
    const d=fixture(type,props,customRows),n=find(d),kind=ctx.registry.recipes.find(recipe=>recipe.recipeId+'@'+recipe.recipeVersion===n.recipeRef).type;
    assert.equal(supportsNodeTextStyle(kind,n),false);assert.equal(textStyleEditState(d,'subject',ctx).supported,false);
    for(const changes of [{fontSize:24},{textColor:'#123456'}]){
      assert.throws(()=>textEditDocument(d,{nodeId:'subject',changes},ctx),{code:'edit.text-style'});
      const bad=structuredClone(d);Object.assign(find(bad).props,changes);assert.throws(()=>validateSizeEdit(d,bad,ctx));
    }
  }
  for(const id of ['subject','artboard']){
    const d=structuredClone(doc);find(d,id).locked=true;assert.equal(textStyleEditState(d,'subject',ctx).editable,false);
    assert.throws(()=>textEditDocument(d,{nodeId:'subject',changes:{fontSize:24}},ctx),{code:'edit.locked'});
    const bad=structuredClone(d);find(bad).props.textColor='#123456';assert.throws(()=>validateSizeEdit(d,bad,ctx),{code:'edit.locked'});
  }
  for(const mutate of [n=>n.props.fontFamily='other',n=>n.props.textStyleRef='other',n=>n.props.align='right',n=>n.props.enabled=false]){const bad=structuredClone(doc);mutate(find(bad));assert.throws(()=>validateSizeEdit(doc,bad,ctx));}
});

test('font changes recheck every caption and reserved slot even when authored dimensions do not change',()=>{
  const button=fixture('button',{label:'甲'.repeat(10)});find(button).size={width:200,height:80};
  const before=structuredClone(button);assert.throws(()=>textEditDocument(button,{nodeId:'subject',changes:{fontSize:32}},ctx),{code:'edit.text-capacity'});assert.deepEqual(button,before);
  assert.equal(find(textEditDocument(button,{nodeId:'subject',changes:{fontSize:32,label:'甲'}},ctx)).props.fontSize,32);
  const panel=fixture('panel',{title:'标题'});find(panel,'body').size.height=340;
  assert.doesNotThrow(()=>validateSizeEdit(panel,panel,ctx));assert.throws(()=>textEditDocument(panel,{nodeId:'subject',changes:{fontSize:32}},ctx),{code:'edit.slot-bounds'});
  const tabs=fixture('tabs');for(const id of find(tabs).slots.pages)find(tabs,id).size.height=300;
  assert.doesNotThrow(()=>validateSizeEdit(tabs,tabs,ctx));assert.throws(()=>textEditDocument(tabs,{nodeId:'subject',changes:{fontSize:32}},ctx),{code:'edit.slot-bounds'});
  const skin={profile:ctx.profile,roles:new Map(),assertView(){},insets(){return {left:12,right:12,top:2,bottom:2};}};
  assert.doesNotThrow(()=>assertPngComponent(skin,'Input',{},200,32));assert.throws(()=>assertPngComponent(skin,'Input',{fontSize:32},200,32),{code:'skin.content'});
});

test('color-only changes faithfully preserve existing copy and geometry without new capacity or contrast restrictions',()=>{
  const doc=fixture('button',{label:'旧标签'.repeat(2000)}),next=textEditDocument(doc,{nodeId:'subject',changes:{textColor:'#000000'}},ctx);
  assert.equal(find(next).props.label,find(doc).props.label);assert.deepEqual(find(next).size,find(doc).size);assert.equal(find(next).props.textColor,'#000000');
  assert.deepEqual(validateSizeEdit(doc,next,ctx),next);
});

test('combined typography and caption changes publish and undo as one transaction; failed preparation leaves history untouched',async()=>{
  const doc=fixture('button',{label:'原文'}),session=createSession(doc,ctx,async candidate=>{if(find(candidate).props.textColor==='#FF0000')throw Error('font render rejected');return {dispose(){}};});
  await session.initialize();const initial=session.exportDocument();
  await assert.rejects(session.commit(textEditDocument(session.document,{nodeId:'subject',changes:{label:'拒绝',fontSize:24,textColor:'#FF0000'}},ctx)),/font render rejected/);
  assert.equal(session.exportDocument(),initial);assert.equal(session.canUndo,false);
  await session.commit(textEditDocument(session.document,{nodeId:'subject',changes:{label:'新文字',fontSize:24,textColor:'#aBcDeF'}},ctx));
  await session.undo();assert.deepEqual(session.document.nodes,doc.nodes);assert.equal(session.canUndo,false);await session.redo();assert.equal(find(session.document).props.label,'新文字');assert.equal(find(session.document).props.fontSize,24);assert.equal(find(session.document).props.textColor,'#aBcDeF');
});
