import test from 'node:test';
import assert from 'node:assert/strict';
import {opaqueSurfaceTextRegion,mapSliceCoordinate,prepareSurfaceTextRegions,runtimeSurfaceTextBox} from '../src/runtime/surface-text-box.mjs';
import {runtimeRoleInk,applyRuntimeInk,logicalEnhancedTextScope,logicalTextScopeRoots} from '../src/runtime/derived-text-ink.mjs';
import {surfaceTextBox} from '../src/skins/surface-styles.mjs';
import {deriveTextReadability} from '../src/skins/text-readability.mjs';
const image=(w,h,rgba)=>({width:w,height:h,pixels:Uint8Array.from({length:w*h*4},(_,i)=>rgba(Math.floor(i/4)%w,Math.floor(i/(w*4)))[i%4])});
const bar={assetId:'bar',width:896,height:80,density:4,stretch:'horizontal',nineSlice:{left:12,right:12,top:4,bottom:4},contentInsets:{left:0,right:0,top:0,bottom:0},minSize:{width:25,height:9}};
const geometry={scale:1,roles:[{role:'skin.surface.bar',assetId:'bar'}],assets:[bar]};
function skin(){return {surfaceGeometry:geometry,runtimeSurfaceTextRegions:prepareSurfaceTextRegions(geometry,new Map([['bar',image(896,80,(x,y)=>[90,40,10,x>=144&&x<751&&y>=6&&y<71?255:1])]]))};}

test('transparent texture padding uses nine-slice mapping and a fully opaque central text region',()=>{
 const s=skin(),pad={left:35.04,right:20.28,top:10,bottom:10},before=structuredClone(pad),box=runtimeSurfaceTextBox(s,'section',338,48,pad);
 assert.equal(mapSliceCoordinate(133/4,224,556,12,12),68.525);
 assert.equal(box.x,57.68);assert.equal(box.height,28);assert(Math.abs(box.width-222.2475)<1e-6);
 assert(box.x>pad.left+20);assert.deepStrictEqual(pad,before);assert.equal(box.runtimeTextRegion.minimumAlpha,240);
});
test('unmarked headings and replacement material styles retain the frozen text box',()=>{
 const s=skin();assert.deepStrictEqual(runtimeSurfaceTextBox(s,'title',556,48),surfaceTextBox(geometry,'title',556,48));
 const composed={...s,surfaceGeometry:{...geometry,surfaceStyles:{title:{baseRole:'skin.surface.bar',baseMode:'replace',textColor:'#FFFFFF',layers:[{assetId:'material.title',mode:'contain'}]}}}};
 const pad={left:70,right:40,top:10,bottom:10};assert.deepStrictEqual(runtimeSurfaceTextBox(composed,'title',556,48,pad),surfaceTextBox(composed.surfaceGeometry,'title',556,48,pad));
});
test('a transparent center cannot borrow detached opaque decoration or silently erase the safe-area gate',()=>{
 const hollow=image(100,40,(x,y)=>[0,0,0,x===50||y===20?0:255]);assert.equal(opaqueSurfaceTextRegion(hollow),null);
 const s=skin();s.runtimeSurfaceTextRegions.set('bar',null);
 assert.throws(()=>runtimeSurfaceTextBox(s,'title',556,48,{left:70,right:40,top:10,bottom:10}),{code:'skin.surface-text-visible'});
 assert.throws(()=>mapSliceCoordinate(10,100,10,10,10),{code:'skin.surface-text-visible'});
});
test('forty-pixel headings with a transparent top strip retain room for a full twenty-one-pixel glyph',()=>{
 const asset={...bar,nineSlice:{left:10,right:10,top:0,bottom:0},minSize:{width:21,height:1}},g={...geometry,assets:[asset]};
 const s={surfaceGeometry:g,runtimeSurfaceTextRegions:prepareSurfaceTextRegions(g,new Map([['bar',image(896,80,(x,y)=>[150,80,40,x>=12&&x<883&&y>=24&&y<73?255:0])]]))};
 const box=runtimeSurfaceTextBox(s,'title',556,40,{left:69.16,right:33.36,top:6,bottom:6});assert.equal(box.y,13);assert.equal(box.height,21);
 assert(box.y>=box.runtimeTextRegion.mappedRect.y+1);assert(box.y+box.height<=box.runtimeTextRegion.mappedRect.y+box.runtimeTextRegion.mappedRect.height-1);
});
function inkSkin(){
 const roles=[{role:'skin.surface.bar',assetId:'wood'},{role:'skin.surface.content',assetId:'paper'}],assets=roles.map(r=>({assetId:r.assetId,sha256:'a'.repeat(64),contentInsets:{left:0,right:0,top:0,bottom:0}}));
 const pack={scale:1,theme:{palette:{text:'#4C260E'}},roles,assets};
 const images=new Map([['wood',image(64,64,x=>x<32?[0,0,0,255]:[255,255,255,255])],['paper',image(64,64,()=>[250,230,190,255])]]);
 return {profile:pack.theme,runtimeTextReadability:deriveTextReadability(pack,images)};
}
test('only missing-role inks in explicit new scope use sampled fallback; original reports remain needs-review',()=>{
 const s=inkSkin(),before=JSON.stringify(s),wood=runtimeRoleInk(s,'skin.surface.bar',{enhanced:true}),paper=runtimeRoleInk(s,'skin.surface.content',{enhanced:true});
 assert.equal(wood.source,'derived-role');assert.equal(wood.samplingStatus,'needs-review');assert.equal(wood.stroke.width,1);assert(wood.minimumContrast<4.5);
 assert.equal(paper.samplingStatus,'passed');assert.equal(paper.stroke,undefined);
 assert.deepStrictEqual(runtimeRoleInk(s,'skin.surface.bar'),{fill:'#4C260E',source:'legacy'});
 assert.equal(JSON.stringify(s),before);assert.equal(s.runtimeTextReadability.report.status,'needs-review');
});
test('author, surface recipe and declared role colors outrank derived fallback without inherited outlines',()=>{
 const s=inkSkin();s.profile.textColors={'skin.surface.bar':'#AABBCC'};
 assert.deepStrictEqual(runtimeRoleInk(s,'skin.surface.bar',{enhanced:true,authorColor:'#123456',styleColor:'#FFFFFF'}),{fill:'#123456',source:'author'});
 assert.deepStrictEqual(runtimeRoleInk(s,'skin.surface.bar',{enhanced:true,styleColor:'#FFFFFF',replacement:true}),{fill:'#FFFFFF',source:'surface-style'});
 assert.deepStrictEqual(runtimeRoleInk(s,'skin.surface.bar',{enhanced:true}),{fill:'#AABBCC',source:'declared-role'});
 delete s.profile.textColors;assert.deepStrictEqual(runtimeRoleInk(s,'skin.surface.bar',{enhanced:true,replacement:true}),{fill:'#4C260E',source:'legacy'});
});
test('fallback outlines restore previous typography when an explicit override takes over',()=>{
 const prior={color:'#ABCDEF',width:2},text={style:{fill:'#4C260E',stroke:prior}};
 applyRuntimeInk(text,{fill:'#F5F7FF',source:'derived-role',stroke:{color:'#111827',width:1}});assert.equal(text.style.stroke.width,1);
 applyRuntimeInk(text,{fill:'#123456',source:'author'});assert.equal(text.style.fill,'#123456');assert.equal(text.style.stroke,prior);assert.equal(text.runtimeDerivedInk,false);
});
test('popup scope follows logical parent handles rather than relocated display parents',()=>{
 const parent={enhancedTextScope:true},popup={parent:{name:'overlay'}},view={view:popup},select={parent,root:{},recipe:{type:'Select'},adapter:{view}};
 const dialog={parent,root:{},recipe:{type:'Dialog'},adapter:{view:{parent:{name:'overlay'}}}},legacy={root:{},recipe:{type:'Select'},adapter:{view:{view:{}}}};
 const map=logicalTextScopeRoots([select,dialog,legacy]);for(const root of [select.root,view,popup,dialog.adapter.view])assert.equal(map.get(root),true);
 assert.equal(map.get(legacy.adapter.view.view),false);const cycle={};cycle.parent=cycle;assert.throws(()=>logicalEnhancedTextScope(cycle),{code:'skin.runtime-ink'});
});
