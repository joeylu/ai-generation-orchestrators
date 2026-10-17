import test from 'node:test';
import assert from 'node:assert/strict';
import { refineAssets, repairEdgeColors, smoothOuterEnvelope } from '../src/skin-generation/refine.mjs';
import { resampleArea, validatePolicy } from '../src/skin-generation/normalize.mjs';
import base from '../configs/skin-normalization.json' with {type:'json'};
const edge={enabled:true,coreAlpha:224,bandPixels:2,searchRadius:8,minSaturation:0.85,hueRanges:[[0,12],[330,360]],maxChangedPixelFraction:0.03,maxUnresolvedPixels:0};
const states={enabled:true,coreAlpha:128,maxAxisScaleChange:1.15,maxRemovedAlphaMassFraction:0.05};
const im=(w=32,h=32)=>({width:w,height:h,pixels:Buffer.alloc(w*h*4)});
const paint=(a,x,y,w,h,c)=>{for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)a.pixels.set(c,(yy*a.width+xx)*4);};
test('state core registration produces identical alpha without changing the baselines',()=>{
  const a=im(),b=im();paint(a,5,5,22,22,[200,140,50,253]);paint(b,4,4,23,23,[160,100,40,252]);
  const r=refineAssets([{part:{assetId:'a'},image:a,operation:{}},{part:{assetId:'b'},image:b,operation:{}}],[{id:'s',assetIds:['a','b']}],{states,edgeColor:{...edge,enabled:false}},resampleArea);
  assert.ok(r.assets[0].baselineImage.pixels.equals(a.pixels));assert.equal(a.pixels[(5*32+5)*4+3],253);
  for(let i=3;i<a.pixels.length;i+=4)assert.equal(r.assets[0].image.pixels[i],r.assets[1].image.pixels[i]);
  assert.equal(r.report.states[0].sharedAlphaIdentical,true);
});
test('large state deformation and excessive intersection alpha loss fail instead of forced acceptance',()=>{
  const a=im(),b=im();paint(a,2,2,28,28,[200,140,50,255]);paint(b,8,8,16,16,[160,100,40,255]);
  const args=[[{part:{assetId:'a'},image:a,operation:{}},{part:{assetId:'b'},image:b,operation:{}}],[{id:'s',assetIds:['a','b']}]];
  assert.throws(()=>refineAssets(...args,{states,edgeColor:{...edge,enabled:false}},resampleArea),/axis change/);
  const c=im();paint(c,2,2,28,28,[200,100,40,255]);paint(c,12,12,5,5,[0,0,0,0]);
  assert.throws(()=>refineAssets([args[0][0],{part:{assetId:'b'},image:c,operation:{}}],args[1],{states:{...states,maxRemovedAlphaMassFraction:0.01},edgeColor:{...edge,enabled:false}},resampleArea),/too much alpha/);
});
test('red fringe RGB comes from reliable interior while alpha, wood/green colors and interior red are preserved',()=>{
  const a=im();paint(a,3,3,26,26,[190,130,40,253]);paint(a,3,8,1,1,[255,0,0,90]);paint(a,16,16,1,1,[255,0,0,253]);paint(a,4,12,1,1,[30,150,20,253]);
  const r=repairEdgeColors(a,edge),i=(8*32+3)*4;
  assert.equal(r.operation.changedPixels,1);assert.deepEqual([...r.image.pixels.subarray(i,i+4)],[190,130,40,90]);
  assert.deepEqual([...r.image.pixels.subarray((16*32+16)*4,(16*32+16)*4+4)],[255,0,0,253]);
  assert.ok(a.pixels.subarray(i,i+3).equals(Buffer.from([255,0,0])));
  for(let k=3;k<a.pixels.length;k+=4)assert.equal(r.image.pixels[k],a.pixels[k]);
});
test('repair budgets, unresolved color and invalid hue intervals are explicit blockers',()=>{
  const a=im();paint(a,3,3,26,26,[190,130,40,253]);paint(a,3,8,1,1,[255,0,0,90]);
  assert.throws(()=>repairEdgeColors(a,{...edge,maxChangedPixelFraction:0}),/pixel budget/);
  const b=im();paint(b,3,3,26,26,[255,0,0,253]);assert.throws(()=>repairEdgeColors(b,edge),/reliable interior/);
  assert.throws(()=>validatePolicy({...base,refinement:{states,edgeColor:{...edge,hueRanges:[[330,12]]}}}),/ordered/);
});
test('fitted envelope removes connected faint whiskers, preserves RGB/holes and keeps continuous alpha',()=>{
  const a=im(40,20);
  for(let y=0;y<20;y++)for(let x=0;x<40;x++){
    const d=Math.hypot(Math.max(0,Math.abs(x+0.5-20)-10),Math.abs(y+0.5-10))-7;
    const alpha=Math.round(253*Math.max(0,Math.min(1,0.5-d)));
    if(alpha)a.pixels.set([190,130,40,alpha],(y*40+x)*4);
  }
  paint(a,19,1,1,3,[230,160,20,40]);paint(a,20,10,1,1,[0,0,0,0]);
  const r=smoothOuterEnvelope(a,{type:'roundRect',radius:10},{coreAlpha:128,paddingPixels:0.5,featherPixels:1,maxRemovedAlphaMassFraction:0.03});
  assert.equal(r.image.pixels[(1*40+19)*4+3],0);assert.equal(r.image.pixels[(10*40+20)*4+3],0);
  let partial=0;for(let i=0;i<a.pixels.length;i+=4){assert.ok(r.image.pixels[i+3]<=a.pixels[i+3]);if(r.image.pixels[i+3])assert.ok(r.image.pixels.subarray(i,i+3).equals(a.pixels.subarray(i,i+3)));if(r.image.pixels[i+3]>0&&r.image.pixels[i+3]<128)partial++;}
  assert.ok(partial>0);assert.equal(a.pixels[(1*40+19)*4+3],40);
});
test('envelope refuses significant alpha loss instead of force-clipping artwork',()=>{
  const a=im();paint(a,3,3,26,26,[190,130,40,253]);
  assert.throws(()=>smoothOuterEnvelope(a,{type:'circle'},{coreAlpha:128,paddingPixels:0,featherPixels:1,maxRemovedAlphaMassFraction:0.01}),/too much/);
});
