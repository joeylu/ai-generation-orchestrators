import test from 'node:test';
import assert from 'node:assert/strict';
import {CanvasTextMetrics,Text,Texture,TextureSource} from 'pixi.js';
import {selectCjkTitleWrap,applyReferenceCjkWrap,cjkTitleBalancePolicy} from '../src/runtime/cjk-text-flow.mjs';
import {basicAdapters} from '../src/runtime/basic.mjs';
import {prepareSurfaceTextRegions} from '../src/runtime/surface-text-box.mjs';
import {prepareReferenceHeadingBands} from '../src/runtime/heading-band.mjs';
const title='远行者的旅途偏好与声音设置';
const metrics=(text,width,unit=28)=>{const chars=Array.from(text),count=Math.max(1,Math.floor(width/unit)),lines=[];for(let at=0;at<chars.length;at+=count)lines.push(chars.slice(at,at+count).join(''));return {lines,width:Math.max(...lines.map(s=>Array.from(s).length))*unit,height:lines.length*28};};
const base={enabled:true,text:title,width:360,height:96,fontSize:28,wordWrap:true};
test('C19 thirteen-Han title balances its automatic 12+1 tail into 7+6 while retaining text, line count, font and fit',()=>{
 assert.equal(Array.from(title).length,13);const before=JSON.stringify(base),r=selectCjkTitleWrap({...base,measure:w=>metrics(title,w)});
 assert.equal(r.changed,true);assert.deepEqual(r.before.map(s=>s.length),[12,1]);assert.deepEqual(r.after.map(s=>s.length),[7,6]);assert.equal(r.before.join(''),r.after.join(''));assert.equal(r.height,56);assert.equal(r.policy,'cjk-title-orphan-balance-v1');assert.equal(JSON.stringify(base),before);assert(r.measurements<=33);
});
test('author newlines, non-CJK, nonwrapped and disabled titles never enter measurement',()=>{
 for(const patch of [{enabled:false},{wordWrap:false},{text:'设置\n置'},{text:'设置\r置'},{text:'设置\u2028置'},{text:'设置\u2029置'},{text:'Welcome to the sound settings'},{text:'Settings A B 中文'},{width:0}]){let calls=0;assert.equal(selectCjkTitleWrap({...base,...patch,measure:()=>{calls++;throw Error('unexpected metric call');}}).changed,false);assert.equal(calls,0);}
});
test('normal multiple-character final lines and a one-line title retain exactly their old wrap width',()=>{
 for(const lines of [['远行者的旅途','偏好与声音设置'],[title]])assert.deepEqual(selectCjkTitleWrap({...base,measure:()=>({lines,width:300,height:lines.length*28})}),{changed:false,width:360,reason:'no-title-orphan'});
});
test('unsafe candidates cannot add lines, exceed the box or bypass an original fit error',()=>{
 const original={lines:[title.slice(0,-1),title.slice(-1)],width:336,height:56};
 for(const bad of [{lines:['远行者','的旅途偏好','与声音设置'],width:200,height:84},{lines:['远行者的旅途偏','好与声音设置'],width:361,height:56},{lines:['远行者的旅途偏','好与声音设置'],width:224,height:97}])assert.equal(selectCjkTitleWrap({...base,measure:w=>w===360?original:bad}).changed,false);
 assert.equal(selectCjkTitleWrap({...base,height:55,measure:()=>original}).reason,'original-does-not-fit');
});
test('wide and long pathological inputs have a fixed metric-call budget',()=>{
 let calls=0;const text='中'.repeat(4097),r=selectCjkTitleWrap({...base,text,width:4096,height:100000,measure:w=>{calls++;return w===4096?{lines:[text.slice(0,-1),text.slice(-1)],width:4096,height:56}:{lines:['中','中','中'],width:w,height:84};}});
 assert.equal(r.changed,false);assert.equal(calls,1+cjkTitleBalancePolicy.maximumCandidateMeasurements);assert(Object.isFrozen(cjkTitleBalancePolicy));
});
test('apply path invokes CanvasTextMetrics with cloned styles; resize resets width and author strings remain exact',()=>{
 const original=CanvasTextMetrics.measureText,measured=[];CanvasTextMetrics.measureText=(text,style)=>{measured.push(style);return metrics(text,style.wordWrapWidth);};
 const t=new Text({text:title,style:{fontFamily:'Arial',fontSize:28,align:'center',wordWrap:true,wordWrapWidth:360}});
 try{const r=applyReferenceCjkWrap(t,360,96,{titleEnabled:true});assert(r.changed);assert.equal(t.text,title);assert.equal(t.style.fontSize,28);assert.equal(t.runtimeTitleWrap.policy,'cjk-title-orphan-balance-v1');assert(measured.every(s=>s!==t.style));const narrow=t.style.wordWrapWidth;
  applyReferenceCjkWrap(t,500,96,{titleEnabled:true});assert.equal(t.style.wordWrapWidth,500);applyReferenceCjkWrap(t,360,96,{titleEnabled:true});assert.equal(t.style.wordWrapWidth,narrow);
  t.text='远行者的旅途偏好与声音设\n置';applyReferenceCjkWrap(t,360,96,{titleEnabled:true});assert.equal(t.style.wordWrapWidth,360);assert.equal(t.text,'远行者的旅途偏好与声音设\n置');
 }finally{CanvasTextMetrics.measureText=original;t.destroy();}
});
test('actual centered reference title uses balance and opaque y together while section, left and legacy title remain unchanged',()=>{
 const original=CanvasTextMetrics.measureText,originalRequest=globalThis.requestAnimationFrame,originalCancel=globalThis.cancelAnimationFrame,created=[];
 globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};CanvasTextMetrics.measureText=(text,style)=>metrics(text,style.wordWrap?style.wordWrapWidth:10000);
 const width=1098,height=177,pixels=new Uint8Array(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++)pixels.set([50,110,180,x>=6&&x<1093&&y>=50?255:1],(y*width+x)*4);
 const bar={assetId:'bar',width:100,height:40,stretch:'horizontal',nineSlice:{left:2,right:2,top:2,bottom:2},contentInsets:{left:0,right:0,top:0,bottom:0},minSize:{width:5,height:5}},layer={assetId:'material.title',mode:'cover'},style={baseRole:'skin.surface.bar',baseMode:'replace',insets:{left:12,right:12,top:4,bottom:4},textColor:'#FFFFFF',layers:[layer]},pack={scale:1,assets:[bar],roles:[{role:'skin.surface.bar',assetId:'bar'}],surfaceStyles:{title:style,section:style}},images=new Map([['bar',{width:100,height:40,pixels:new Uint8Array(100*40*4).fill(255)}],['material.title',{width,height,pixels}]]),texture=new Texture({source:new TextureSource({width,height})});created.push(texture);
 const skin={surfaceGeometry:pack,textures:new Map([['material.title',texture]]),runtimeSurfaceTextRegions:prepareSurfaceTextRegions(pack,images),runtimeHeadingBands:prepareReferenceHeadingBands(pack,images),textStyle:extra=>({fontFamily:'Arial',fontSize:28,fill:'#000000',...extra})};
 const create=(extra={})=>{const adapter=basicAdapters['pixi.text']({skin,p:{text:title,textStyleRef:'body',wrap:'word',overflow:'error',align:'center'},w:536,h:112,surfaceStyle:'title',surfaceBand:'reference-v1',surfaceTextInsets:{left:88,right:88,top:8,bottom:8},...extra});created.push(adapter.view);return adapter;};
 try{const a=create();assert.deepEqual(a.text.runtimeTitleWrap.after.map(s=>s.length),[7,6]);assert.equal(a.text.text,title);assert.equal(a.text.style.fontSize,28);assert.equal(a.textBox.height,96);assert.equal(a.text.x+a.text.width/2,268);assert.equal(a.text.runtimeTitlePlacement.policy,'opaque-title-center-v1');assert(a.text.y>=8&&a.text.y+a.text.height<=104);assert(Math.abs(a.text.y+a.text.height/2-(50+127/2)*112/177)<1e-10);
  const wrap=a.text.style.wordWrapWidth;a.resize(676,112);a.resize(536,112);assert.equal(a.text.style.wordWrapWidth,wrap);assert.equal(a.text.text,title);
  for(const extra of [{surfaceStyle:'section'},{surfaceBand:undefined},{p:{text:title,textStyleRef:'body',wrap:'word',overflow:'error',align:'left'}}]){const other=create(extra);assert.equal(other.text.style.wordWrapWidth,360);assert.equal(other.text.runtimeTitleWrap,undefined);}
 }finally{CanvasTextMetrics.measureText=original;for(const item of created.reverse())item.destroy({children:true});if(originalRequest)globalThis.requestAnimationFrame=originalRequest;else delete globalThis.requestAnimationFrame;if(originalCancel)globalThis.cancelAnimationFrame=originalCancel;else delete globalThis.cancelAnimationFrame;}
});
