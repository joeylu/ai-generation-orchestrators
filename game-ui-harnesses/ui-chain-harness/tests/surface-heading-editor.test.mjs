import test from 'node:test';
import assert from 'node:assert/strict';
import {editorData} from '../src/panel/data.mjs';
import {validateDocument} from '../src/panel/document.mjs';
import {textStyleEditState,textEditDocument,sizeEditDocument,validateSizeEdit} from '../src/panel/size-edit.mjs';
import {textMetrics,textProfile,surfaceTextMetrics,surfaceTextProfile} from '../src/runtime/text-style.mjs';

const base=await editorData(),zero={left:0,right:0,top:0,bottom:0},ctx={...base,skinGeometry:{scale:1,roles:[{role:'skin.surface.bar',assetId:'bar'}],assets:[{assetId:'bar',width:400,height:80,nineSlice:zero,contentInsets:zero,minSize:{width:1,height:1}}]}};
const subject=doc=>doc.nodes.find(n=>n.id==='heading');
function document(){
 const board=ctx.canvases.presets.landscape;
 return validateDocument({kind:'ui_panel_document',version:'0.3',id:'heading-font-edit',revision:0,title:'Heading editor',canvas:'landscape',bindings:ctx.binding,rootId:'board',nodes:[{id:'board',name:'Board',recipeRef:'container@1.0.0',props:{},size:{width:board.width,height:board.height},slots:{children:['heading']},layout:{childrenMode:'free',padding:0}},{id:'heading',name:'Heading',recipeRef:'text@1.0.0',surfaceStyle:'title',surfaceBand:'reference-v1',surfaceFontSize:24,surfaceTextInsets:{left:12,right:12,top:4,bottom:4},props:{text:'四个汉字',textStyleRef:'body',wrap:'none',overflow:'error'},size:{width:200,height:80},position:{x:40,y:40},slots:{}}]},ctx);
}

test('semantic default typography uses original metrics once while author settings and old unmarked profiles retain priority',()=>{
 const profile=ctx.profile,before=structuredClone(profile),plain=textProfile(profile),semantic=surfaceTextProfile(profile,{},24);
 assert.strictEqual(surfaceTextProfile(profile),plain);assert.deepEqual(surfaceTextMetrics(profile),textMetrics(profile));assert.deepEqual(surfaceTextMetrics(profile,{},24),{fontSize:24,lineHeight:36,itemHeight:44});assert.equal(semantic.fontSize,24);assert.equal(semantic.geometry.lineHeight,36);assert.deepEqual(surfaceTextProfile(semantic,{},24),semantic);
 assert.deepEqual(surfaceTextProfile(profile,{fontSize:18,textColor:'#123456'},24),textProfile(profile,{fontSize:18,textColor:'#123456'}));assert.deepEqual(surfaceTextMetrics(profile,{},8),{fontSize:8,lineHeight:12,itemHeight:32});assert.deepEqual(profile,before);
 for(const size of [7,97,8.5,'24',NaN])assert.throws(()=>surfaceTextMetrics(profile,{},size),{code:'skin.surface-style'});
 assert.throws(()=>surfaceTextMetrics(profile,{fontSize:8},24),{code:'edit.font-size'});
});

test('heading editor displays effective presentation default, applies an author override and restores that exact default',()=>{
 const doc=document(),before=structuredClone(doc),initial=textStyleEditState(doc,'heading',ctx);assert.equal(initial.fontSize,24);assert.equal(initial.fontSizeOverride,null);
 const edited=textEditDocument(doc,{nodeId:'heading',changes:{fontSize:18}},ctx);assert.equal(subject(edited).surfaceFontSize,24);assert.equal(subject(edited).props.fontSize,18);assert.equal(textStyleEditState(edited,'heading',ctx).fontSize,18);
 const restored=textEditDocument(edited,{nodeId:'heading',changes:{fontSize:null}},ctx);assert.equal(textStyleEditState(restored,'heading',ctx).fontSize,24);assert.equal(Object.hasOwn(subject(restored).props,'fontSize'),false);assert.deepEqual(subject(restored),subject(doc));assert.deepEqual(doc,before);
 const changed=structuredClone(doc);subject(changed).surfaceFontSize=25;assert.throws(()=>validateSizeEdit(doc,changed,ctx),{code:'edit.size-only'});
});

test('heading copy and resize capacity use its effective larger default and preserve failed candidates atomically',()=>{
 const doc=document(),before=structuredClone(doc);
 assert.throws(()=>sizeEditDocument(doc,{nodeId:'heading',height:40},ctx),{code:'edit.text-capacity'});assert.throws(()=>textEditDocument(doc,{nodeId:'heading',changes:{text:'八个汉字内容测试'}},ctx),{code:'edit.text-capacity'});assert.deepEqual(doc,before);
 const smaller=textEditDocument(doc,{nodeId:'heading',changes:{text:'八个汉字内容测试',fontSize:12}},ctx);assert.equal(subject(smaller).props.fontSize,12);assert.equal(subject(smaller).surfaceFontSize,24);assert.equal(subject(sizeEditDocument(smaller,{nodeId:'heading',height:40},ctx)).size.height,40);
});
