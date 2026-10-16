import test from 'node:test';
import assert from 'node:assert/strict';
import {CanvasTextMetrics,Texture,TextureSource} from 'pixi.js';
import {prepareSurfaceTextRegions,runtimeSurfaceTextBox,runtimeSurfaceTextY,runtimeSurfaceTextPlacement} from '../src/runtime/surface-text-box.mjs';
import {prepareReferenceHeadingBands} from '../src/runtime/heading-band.mjs';
import {basicAdapters} from '../src/runtime/basic.mjs';
import {fitText} from '../src/runtime/skin.mjs';
const image=(width,height,rgba)=>({width,height,pixels:Uint8Array.from({length:width*height*4},(_,i)=>rgba(Math.floor(i/4)%width,Math.floor(i/(width*4)))[i%4])});
const pad={left:88,right:88,top:8,bottom:8};
function fixture({width=1098,height=177,body={x:6,y:50,width:1087,height:127},alpha=255,layer={},clip={left:0,right:0,top:0,bottom:0},paint}={}){
 const material={assetId:'material.title',sha256:'a'.repeat(64),width,height},bar={assetId:'bar',width:100,height:40,stretch:'horizontal',nineSlice:{left:2,right:2,top:2,bottom:2},contentInsets:{left:0,right:0,top:0,bottom:0},minSize:{width:5,height:5}};
 const style={baseRole:'skin.surface.bar',baseMode:'replace',insets:{left:12,right:12,top:4,bottom:4},clipInsets:clip,textColor:'#F5F7FF',layers:[{assetId:material.assetId,mode:'cover',...layer}]};
 const pack={scale:1,roles:[{role:'skin.surface.bar',assetId:'bar'}],assets:[bar],materialAssets:[material],surfaceStyles:{title:style,section:structuredClone(style)}};
 // Real C01 geometry: alpha1 noise occupies the full 1098x177 crop while
 // the wide, alpha240 body only starts at source y=50.
 const pixels=image(width,height,paint??((x,y)=>[50,110,180,x>=body.x&&x<body.x+body.width&&y>=body.y&&y<body.y+body.height?alpha:1]));
 const images=new Map([['bar',image(100,40,()=>[60,80,100,255])],[material.assetId,pixels]]);
 const skin={surfaceGeometry:pack,textures:new Map([[material.assetId,{frame:{width,height}}]]),runtimeSurfaceTextRegions:prepareSurfaceTextRegions(pack,images),runtimeHeadingBands:prepareReferenceHeadingBands(pack,images)};
 return {pack,skin,pixels,images};
}
const textY=(f,height=28,{key='title',surfaceBand='reference-v1',explicitInsets=true,width=536,nodeHeight=64,insets=pad}={})=>{
 const box=runtimeSurfaceTextBox(f.skin,key,width,nodeHeight,insets,surfaceBand);
 return {box,y:runtimeSurfaceTextY(f.skin,key,box,height,{surfaceBand,explicitInsets})};
};
test('C01 alpha1 top noise cannot hide the opaque body; short title centers without changing its fit box or source',()=>{
 const f=fixture(),before=Buffer.from(f.pixels.pixels),pack=JSON.stringify(f.pack),insets=structuredClone(pad),cache=f.skin.runtimeSurfaceTextRegions.get('material.title');
 assert.equal(f.pixels.pixels[3],1);assert.deepEqual(cache.rect,{x:6,y:50,width:1087,height:127});assert.equal(cache.minimumAlpha,240);assert(Object.isFrozen(cache)&&Object.isFrozen(cache.rect));
 const {box,y}=textY(f);assert.equal(box.y,8);assert.equal(box.height,48);assert.equal(box.width,360);assert.equal(box.runtimeTextRegion,undefined);
 const bodyCenter=(50+127/2)*64/177;assert(Math.abs(y+14-bodyCenter)<1e-10);assert(Math.abs(y-18-9.03954802259887)<1e-10);
 const evidence=runtimeSurfaceTextPlacement(f.skin,'title',box,28,{surfaceBand:'reference-v1',explicitInsets:true}).evidence;assert.equal(evidence.policy,'opaque-title-center-v1');assert.equal(evidence.assetSha256,'a'.repeat(64));assert.equal(evidence.clamped,false);assert.equal(evidence.residualOffset,0);
 assert.deepEqual(Buffer.from(f.pixels.pixels),before);assert.equal(JSON.stringify(f.pack),pack);assert.deepEqual(pad,insets);
});
test('long or tall titles clamp to the old safe box and an original fit error still fails',()=>{
 const f=fixture();assert.equal(textY(f,40).y,16);assert.equal(textY(f,48).y,8);
 const {box}=textY(f,49);assert.throws(()=>fitText({width:100,height:49},box.width,box.height,'error'),{code:'text.overflow'});
 assert.equal(textY(f,49).y,7.5);assert.equal(textY(f,48).box.height,48);
});
test('five other measured title bodies remain bit-exact below the two-pixel threshold',()=>{
 const values=[['pixel',1132,213,{x:40,y:49,width:1056,height:117},{x:40,y:49,width:1056,height:117}],['chinese',1099,197,{x:0,y:0,width:1099,height:197},{x:4,y:8,width:1090,height:174}],['handpainted',1133,173,{x:0,y:0,width:1133,height:173},{x:13,y:9,width:1111,height:149}],['anime',1098,177,{x:0,y:0,width:1098,height:177},{x:15,y:4,width:1081,height:165}],['western',1130,180,{x:0,y:0,width:1130,height:180},{x:33,y:4,width:1065,height:167}]];
 for(const [name,width,height,sourceRect,rect]of values){
  const f=fixture({width,height}),region={version:'reference-v1',sourceWidth:width,sourceHeight:height,sourceRect,caps:{left:Math.min(sourceRect.height,Math.floor(sourceRect.width*.22)),right:Math.min(sourceRect.height,Math.floor(sourceRect.width*.22))}};
  f.skin.runtimeHeadingBands.set('material.title',region);f.skin.runtimeSurfaceTextRegions.set('material.title',{kind:'reference-heading-opaque-body-v1',sourceWidth:width,sourceHeight:height,sourceRect,rect});
  assert.equal(textY(f).y,18,name);
 }
});
test('sections, unmarked documents and absent explicit safe insets retain old placement',()=>{
 const f=fixture();assert.equal(textY(f,28,{key:'section'}).y,18);assert.equal(textY(f,28,{explicitInsets:false}).y,18);
 const box=runtimeSurfaceTextBox(f.skin,'title',536,64,pad);assert.equal(runtimeSurfaceTextY(f.skin,'title',box,28,{explicitInsets:true}),18);assert.equal(runtimeSurfaceTextY(f.skin,'title',box,28),18);
});
test('tile, customized layer geometry, compositing and multiple layers cannot acquire a correction',()=>{
 for(const layer of [{mode:'tile'},{width:300},{height:40},{scale:2},{offsetX:1},{offsetY:1},{alpha:.5},{blendMode:'multiply'}]){const f=fixture({layer});assert.equal(f.skin.runtimeSurfaceTextRegions.has('material.title'),false);assert.equal(textY(f).y,18,JSON.stringify(layer));}
 const f=fixture();f.pack.surfaceStyles.title.layers.push({...f.pack.surfaceStyles.title.layers[0]});assert.equal(textY(f).y,18);
 f.pack.surfaceStyles.title.layers.pop();f.pack.surfaceStyles.title.baseMode='overlay';f.pack.surfaceStyles.title.clipInsets={left:2,right:2,top:2,bottom:2};assert.equal(textY(f).y,18);
});
test('translucent, narrow, short and hollow evidence preserves the original base-role cache and placement',()=>{
 for(const options of [{alpha:239},{body:{x:500,y:50,width:90,height:127}},{body:{x:6,y:80,width:1087,height:10}},{paint:(x,y)=>[40,80,120,x===549||y===88?1:255]}]){
  const f=fixture(options);assert.equal(f.skin.runtimeSurfaceTextRegions.has('material.title'),false);assert.equal(textY(f).y,18);assert.deepEqual(f.skin.runtimeSurfaceTextRegions.get('bar').rect,{x:0,y:0,width:100,height:40});
 }
 const f=fixture();f.skin.runtimeHeadingBands.get('material.title').sourceRect.y=1;assert.equal(textY(f).y,18);
});
test('sourceRect origin and asymmetric clip map once, with authored safe insets preserved',()=>{
 const clip={left:0,right:0,top:10,bottom:20},f=fixture({width:1200,height:200,clip}),sourceRect={x:20,y:40,width:1000,height:100};
 f.skin.runtimeHeadingBands.set('material.title',{version:'reference-v1',sourceWidth:1200,sourceHeight:200,sourceRect,caps:{left:100,right:100}});
 f.skin.runtimeSurfaceTextRegions.set('material.title',{kind:'reference-heading-opaque-body-v1',sourceWidth:1200,sourceHeight:200,sourceRect,rect:{x:30,y:70,width:980,height:70}});
 const insets={left:88,right:88,top:8,bottom:12},before=structuredClone(insets),{box,y}=textY(f,28,{nodeHeight:100,insets});assert.equal(y,41.5);assert.equal(box.height,80);assert.deepEqual(insets,before);
});
test('actual text adapter keeps safe-box, font, ink and horizontal placement through resize; overflow remains an error',()=>{
 const originalMeasure=CanvasTextMetrics.measureText,originalRequest=globalThis.requestAnimationFrame,originalCancel=globalThis.cancelAnimationFrame,created=[];let measuredHeight=28;
 globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
 CanvasTextMetrics.measureText=(text,style)=>({width:text.length*14,height:measuredHeight,lines:[text],lineWidths:[text.length*14],lineHeight:measuredHeight,maxLineWidth:text.length*14,fontProperties:{ascent:24,descent:4,fontSize:style.fontSize}});
 try{
  const f=fixture(),texture=new Texture({source:new TextureSource({width:1098,height:177})});created.push(texture);
  f.skin.textures.set('material.title',texture);f.skin.textStyle=extra=>({fontFamily:'Arial',fontSize:28,fill:'#000000',...extra});
  const props={text:'公告面板',textStyleRef:'body',wrap:'none',overflow:'error',align:'center',textColor:'#12AB34'},before=JSON.stringify(props),adapter=basicAdapters['pixi.text']({skin:f.skin,p:props,w:536,h:64,surfaceStyle:'title',surfaceBand:'reference-v1',surfaceTextInsets:pad});created.push(adapter.view);
  const expected=(50+127/2)*64/177-14;assert(Math.abs(adapter.text.y-expected)<1e-10);assert.equal(adapter.text.x+adapter.text.width/2,268);assert.equal(adapter.text.style.fontSize,28);assert.equal(adapter.text.surfaceTextColor,'#12AB34');assert.equal(adapter.textBox.height,48);
  adapter.resize(676,64);assert(Math.abs(adapter.text.y-expected)<1e-10);assert.equal(adapter.text.x+adapter.text.width/2,338);assert.equal(adapter.text.style.fontSize,28);assert.equal(JSON.stringify(props),before);
  measuredHeight=40;adapter.text.text='reset';adapter.resize(676,64);assert.equal(adapter.text.y,16);assert.equal(adapter.textBox.height,48);
  measuredHeight=49;adapter.text.text='reset';assert.throws(()=>adapter.resize(676,64),{code:'text.overflow'});
 }finally{CanvasTextMetrics.measureText=originalMeasure;for(const item of created.reverse())item.destroy({children:true});if(originalRequest)globalThis.requestAnimationFrame=originalRequest;else delete globalThis.requestAnimationFrame;if(originalCancel)globalThis.cancelAnimationFrame=originalCancel;else delete globalThis.cancelAnimationFrame;}
});
