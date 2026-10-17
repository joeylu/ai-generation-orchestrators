import test from 'node:test';
import assert from 'node:assert/strict';
import {CanvasTextMetrics,Text} from 'pixi.js';
import {selectCjkBodyWrap,applyReferenceCjkWrap,selectCjkClosingWrap,cjkBodyBalancePolicy} from '../src/runtime/cjk-text-flow.mjs';
import {basicAdapters} from '../src/runtime/basic.mjs';
const copies=['树影覆盖小径。前方传来鸟鸣。','石阶通向高处。窗外洒入微光。','帆船停靠岸边。海风带来潮声。'];
const measure=(text,width)=>{const chars=Array.from(text),count=Math.max(1,Math.floor(width/18)),lines=[];for(let at=0;at<chars.length;at+=count)lines.push(chars.slice(at,at+count).join(''));return {lines,width:Math.max(...lines.map(s=>s.length))*18,height:lines.length*28};};
const base={enabled:true,text:copies[0],width:216,height:56,fontSize:16,wordWrap:true};
test('C26 three exact short descriptions balance 12+2 isolated Han-and-stop tails without changing source, fit or line count',()=>{
 for(const text of copies){const input={...base,text},before=JSON.stringify(input),r=selectCjkBodyWrap({...input,measure:w=>measure(text,w)});assert.equal(r.changed,true);assert.deepEqual(r.before.map(s=>s.length),[12,2]);assert.deepEqual(r.after.map(s=>s.length),[7,7]);assert.equal(r.after.join(''),text);assert.equal(r.height,56);assert.equal(r.policy,'cjk-body-short-tail-balance-v1');assert(r.measurements<=33);assert.equal(JSON.stringify(input),before);}
});
test('short-body opt-in refuses authored newlines, long copy, foreign text and unsupported scope before measuring',()=>{
 for(const patch of [{enabled:false},{wordWrap:false},{text:'中'.repeat(65)},{text:'中'+' '.repeat(64)},{text:'树影覆盖小径\n鸣。'},{text:'树影覆盖小径\u2028鸣。'},{text:'The forest awaits you.'}]){let calls=0;assert.equal(selectCjkBodyWrap({...base,...patch,measure:()=>{calls++;throw Error('unexpected metrics');}}).changed,false);assert.equal(calls,0);}
 for(const lines of [['树影覆盖小径','前方传来','鸟鸣。'],['树影覆盖小径。前方传来','鸟鸣。'],[copies[0]]])assert.equal(selectCjkBodyWrap({...base,measure:()=>({lines,width:200,height:56})}).changed,false);
});
test('short-body candidates cannot add lines or exceed height; pathological metrics stay bounded',()=>{
 let calls=0;const original=measure(copies[0],216),r=selectCjkBodyWrap({...base,measure:w=>{calls++;return w===216?original:{lines:['树影覆盖','小径。前方','传来鸟鸣。'],width:100,height:84};}});assert.equal(r.changed,false);assert.equal(calls,1+cjkBodyBalancePolicy.maximumCandidateMeasurements);
 assert.equal(selectCjkBodyWrap({...base,height:55,measure:()=>original}).reason,'original-does-not-fit');assert(Object.isFrozen(cjkBodyBalancePolicy));
});
test('default closing selector remains exact; body opt-in balances punctuation-only tails and resets after resize',()=>{
 const original=CanvasTextMetrics.measureText;CanvasTextMetrics.measureText=(text,style)=>measure(text,style.wordWrapWidth);
 const make=()=>new Text({text:copies[0],style:{fontFamily:'Arial',fontSize:16,wordWrap:true,wordWrapWidth:216}}),old=make(),fresh=make();
 try{applyReferenceCjkWrap(old,216,56,{enabled:true});assert.equal(old.style.wordWrapWidth,216);assert.equal(old.runtimeBodyWrap,undefined);
  applyReferenceCjkWrap(fresh,216,56,{enabled:true,bodyEnabled:true});const narrow=fresh.style.wordWrapWidth;assert(narrow<216);assert.equal(fresh.runtimeBodyWrap.policy,'cjk-body-short-tail-balance-v1');assert.equal(fresh.text,copies[0]);assert.equal(fresh.style.fontSize,16);
  applyReferenceCjkWrap(fresh,300,56,{enabled:true,bodyEnabled:true});assert.equal(fresh.style.wordWrapWidth,300);assert.equal(fresh.runtimeBodyWrap,undefined);applyReferenceCjkWrap(fresh,216,56,{enabled:true,bodyEnabled:true});assert.equal(fresh.style.wordWrapWidth,narrow);
  const expected=selectCjkClosingWrap({...base,width:234,measure:w=>measure(copies[0],w)});applyReferenceCjkWrap(old,234,56,{enabled:true});assert.equal(old.style.wordWrapWidth,expected.width);assert.equal(old.runtimeBodyWrap,undefined);applyReferenceCjkWrap(fresh,234,56,{enabled:true,bodyEnabled:true});assert(fresh.style.wordWrapWidth<expected.width);assert.equal(fresh.runtimeBodyWrap.policy,'cjk-body-short-tail-balance-v1');
 }finally{CanvasTextMetrics.measureText=original;old.destroy();fresh.destroy();}
});
test('C26 full216 punctuation-only tail retains old closing207 while explicit body policy directly balances both lines',()=>{
 const text=copies[0],measure=w=>{const count=Math.max(1,Math.floor(w/16)),lines=[];for(let at=0;at<text.length;at+=count)lines.push(text.slice(at,at+count));return {lines,width:Math.max(...lines.map(s=>s.length))*16,height:lines.length*21};};
 const input={...base,measure},old=selectCjkClosingWrap(input),fresh=selectCjkBodyWrap(input);
 assert.equal(old.width,207);assert.equal(old.before.at(-1),'。');assert.equal(old.after.at(-1),'鸣。');assert.equal(fresh.changed,true);assert.equal(fresh.before.at(-1),'。');assert.deepEqual(fresh.after.map(s=>s.length),[7,7]);assert.equal(fresh.after.join(''),text);assert.equal(fresh.after.length,old.before.length);assert(fresh.height<=56);
 for(const last of ['', '  '])assert.equal(selectCjkBodyWrap({...base,measure:()=>({lines:[text,last],width:200,height:42})}).changed,false);
});
test('actual body adapter requires explicit referenceTextFlow; old body geometry, font and source stay unchanged',()=>{
 const original=CanvasTextMetrics.measureText,originalRequest=globalThis.requestAnimationFrame,originalCancel=globalThis.cancelAnimationFrame,created=[];globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};CanvasTextMetrics.measureText=(text,style)=>measure(text,style.wordWrapWidth);
 const skin={textStyle:extra=>({fontFamily:'Arial',fontSize:16,fill:'#000000',...extra})},props={text:copies[0],textStyleRef:'body',wrap:'word',overflow:'error',align:'left'},before=JSON.stringify(props);
 try{for(const enabled of [false,true]){const a=basicAdapters['pixi.text']({skin,p:props,w:216,h:56,referenceTextFlow:enabled});created.push(a.view);assert.equal(a.text.style.fontSize,16);assert.equal(a.text.text,copies[0]);assert.equal(a.textBox.width,216);assert.equal(a.textBox.height,56);assert.equal(a.text.x,0);assert.equal(a.text.y,0);assert.equal(Boolean(a.text.runtimeBodyWrap),enabled);assert.equal(a.text.style.wordWrapWidth<216,enabled);a.resize(300,56);a.resize(216,56);assert.equal(a.text.style.wordWrapWidth<216,enabled);}assert.equal(JSON.stringify(props),before);
 }finally{CanvasTextMetrics.measureText=original;for(const v of created.reverse())v.destroy({children:true});if(originalRequest)globalThis.requestAnimationFrame=originalRequest;else delete globalThis.requestAnimationFrame;if(originalCancel)globalThis.cancelAnimationFrame=originalCancel;else delete globalThis.cancelAnimationFrame;}
});
