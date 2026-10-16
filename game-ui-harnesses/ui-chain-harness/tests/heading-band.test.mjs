import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveReferenceHeadingRegion,completeReferenceHeadingRegion,prepareReferenceHeadingBands,referenceHeadingLayout,referenceHeadingLayer} from '../src/runtime/heading-band.mjs';
const image=(width,height)=>({width,height,pixels:new Uint8Array(width*height*4)});
function paint(i,x,y,w,h,color){for(let py=y;py<y+h;py++)for(let px=x;px<x+w;px++)i.pixels.set([...color,255],(py*i.width+px)*4);return i;}
function nested(width=240,height=96){
 const i=image(width,height),sx=width/240,sy=height/96;
 const rect=(x,y,w,h,color)=>paint(i,Math.round(x*sx),Math.round(y*sy),Math.round(w*sx),Math.round(h*sy),color);
 rect(2,2,236,92,[220,170,30]);rect(6,6,228,84,[55,80,115]);
 rect(16,24,208,48,[95,130,180]);rect(20,28,200,40,[20,40,70]);return i;
}
test('reference heading derives an inset only with a second continuous frame on all four sides',()=>{
 for(const [w,h]of[[240,96],[480,192],[960,384]]){
  const derived=deriveReferenceHeadingRegion(nested(w,h));
  assert.equal(derived.method,'nested-opaque-frame-v1');assert.equal(derived.version,'reference-v1');
  assert(derived.sourceRect.x>w*.04&&derived.sourceRect.x<w*.1);
  assert(derived.sourceRect.y>h*.2&&derived.sourceRect.y<h*.3);
  assert.equal(derived.caps.left,Math.min(derived.sourceRect.height,Math.floor(derived.sourceRect.width*.22)));
 }
});
test('complete simple bands, transparent art, texture noise and a lone double border are not guessed into crops',()=>{
 const simple=paint(image(240,96),0,0,240,96,[20,40,70]);
 paint(simple,4,4,232,88,[100,130,170]);paint(simple,8,8,224,80,[20,40,70]);
 for(const i of [simple,image(240,96),image(30,80)]){
  const derived=deriveReferenceHeadingRegion(i);assert.equal(derived.method,'complete-source-v1');assert.deepEqual(derived.sourceRect,{x:0,y:0,width:i.width,height:i.height});
 }
 const broken=nested();paint(broken,0,30,35,36,[20,40,70]);
 assert.equal(deriveReferenceHeadingRegion(broken).method,'complete-source-v1');
});
test('reference band preserves both end proportions for 64, 48 and narrow layouts, and rejects a destructive resize',()=>{
 const region=deriveReferenceHeadingRegion(nested());
 for(const [width,height]of[[720,64],[720,48],[220,64]]){
  const l=referenceHeadingLayout(region,width,height);
  assert.equal(l.left/region.caps.left,height/region.sourceRect.height);
  assert.equal(l.right/region.caps.right,height/region.sourceRect.height);
  assert.equal(l.left+l.middle+l.right,width);assert(l.middle>0);
 }
 assert.throws(()=>referenceHeadingLayout(region,100,64),e=>e.code==='skin.heading-band');
 assert.equal(referenceHeadingLayout(completeReferenceHeadingRegion(1,1),10,4).middle,10);
});
test('verified heading material preparation leaves pack metadata and source pixels untouched',()=>{
 const i=nested(),before=i.pixels.slice(),pack={surfaceStyles:{title:{layers:[{assetId:'material.title',mode:'cover'}]},section:{layers:[{assetId:'material.tile',mode:'tile'}]}}},snapshot=structuredClone(pack);
 const derived=prepareReferenceHeadingBands(pack,new Map([['material.title',i]]));
 assert.equal(derived.size,1);assert.equal(derived.get('material.title').method,'nested-opaque-frame-v1');
 assert.deepEqual(pack,snapshot);assert.deepEqual(i.pixels,before);
 assert.throws(()=>prepareReferenceHeadingBands(pack,new Map()),e=>e.code==='skin.heading-band');
 assert.throws(()=>deriveReferenceHeadingRegion({...i,pixels:[]}),e=>e.code==='skin.heading-band');
});
test('reference adaptation does not turn independent accents or authored material rectangles into full width bands',()=>{
 assert(referenceHeadingLayer({mode:'cover'},{width:800,height:100}));
 for(const [layer,size]of [[{mode:'tile'},{width:800,height:100}],[{mode:'contain'},{width:40,height:40}],[{mode:'contain',width:48,height:48},{width:800,height:100}],[{mode:'cover',offsetX:5},{width:800,height:100}],[{mode:'cover',scale:2},{width:800,height:100}]])assert.equal(referenceHeadingLayer(layer,size),false);
});
test('corner masking only follows outer accents crossing the crop, leaving isolated inner decorations intact',()=>{
 const original=nested(),region=deriveReferenceHeadingRegion(original);
 assert.equal(region.cornerCuts,undefined);
 const decorated=nested();paint(decorated,region.sourceRect.x+4,region.sourceRect.y+4,3,3,[220,170,30]);
 assert.equal(deriveReferenceHeadingRegion(decorated).cornerCuts,undefined,'An isolated gold inner ornament is not enclosing-frame evidence.');
 const overlapping=nested();paint(overlapping,region.sourceRect.x+2,region.sourceRect.y-2,3,5,[220,170,30]);
 const result=deriveReferenceHeadingRegion(overlapping);assert.equal(result.cornerCuts?.method,'connected-outer-accent-v1');
 assert.deepEqual(result.cornerCuts.topLeft,{width:5,height:3});
 assert.equal(result.cornerCuts.topRight,undefined);assert.equal(result.cornerCuts.bottomLeft,undefined);assert.equal(result.cornerCuts.bottomRight,undefined);
 const single=paint(image(240,96),0,0,240,96,[220,170,30]);assert.equal(deriveReferenceHeadingRegion(single).cornerCuts,undefined);
});
