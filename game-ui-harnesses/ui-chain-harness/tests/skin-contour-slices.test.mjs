import test from 'node:test';
import assert from 'node:assert/strict';
import {suggestContourSlices} from '../src/skins/contour-slices.mjs';
import {deriveMetadata} from '../src/skins/metadata-draft.mjs';
import {suggestSlices} from '../tools/panel-slicer/src/suggestion.mjs';
function glossy({width=320,height=96,top=8,bottom=8}={}){
  const pixels=Buffer.alloc(width*height*4),left=8,right=width-9;
  for(let y=top;y<height-bottom;y++)for(let x=left;x<=right;x++){
    const frame=x<left+5||x>right-5||y<top+5||y>=height-bottom-5;
    const shade=Math.round(200*(height-bottom-y)/(height-bottom-top));
    pixels.set(frame?[160,12,18,255]:[235,30+shade,35+shade,255],(y*width+x)*4);
  }
  // Widely separated alpha-1 specks must not determine the visible bounds.
  pixels.set([255,255,255,1],(1*width+120)*4);
  return {width,height,pixels};
}
test('glossy filled gradient gains measured cuts without changing pixels',()=>{
  const im=glossy(),before=Buffer.from(im.pixels);
  assert.equal(suggestSlices(im,4).status,'unsupported');
  const r=suggestContourSlices(im,4);
  assert.equal(r.status,'supported');assert.equal(r.method,'filled-contour-v1');
  assert.deepEqual(r.evidence.bounds,{left:8,top:8,right:311,bottom:87});
  assert.deepEqual(r.bordersPx,{left:28,top:28,right:28,bottom:28});
  assert.deepEqual(r.nineSlice,{left:7,top:7,right:7,bottom:7});assert.deepEqual(im.pixels,before);
  assert.match(r.notice,/验收/);
});
test('asymmetric transparent padding is measured and horizontal tabs retain zero vertical cuts',()=>{
  const im=glossy({top:24,bottom:10}),r=suggestContourSlices(im,4);
  assert.equal(r.status,'supported');assert.equal(r.bordersPx.top-r.bordersPx.bottom,14);
  const horizontal=suggestContourSlices(im,4,{axis:'horizontal'});
  assert.equal(horizontal.nineSlice.top,0);assert.equal(horizontal.nineSlice.bottom,0);
  assert.deepEqual(suggestContourSlices(im,8).bordersPx,r.bordersPx);
  for(const side of ['left','top','right','bottom'])assert.equal(suggestContourSlices(im,8).nineSlice[side]*2,r.nineSlice[side]);
});
test('missing fill, holes, high-frequency artwork and invalid inputs remain unsupported',()=>{
  const empty=glossy();empty.pixels.fill(0);assert.equal(suggestContourSlices(empty,4).status,'unsupported');
  const hole=glossy();for(let y=30;y<65;y++)for(let x=125;x<195;x++)hole.pixels[(y*hole.width+x)*4+3]=64;
  assert.equal(suggestContourSlices(hole,4).status,'unsupported');
  const noise=glossy();for(let y=25;y<70;y++)for(let x=90;x<230;x++)noise.pixels[(y*noise.width+x)*4]=(x*79+y*113)%256;
  assert.equal(suggestContourSlices(noise,4).status,'unsupported');
  assert.equal(suggestContourSlices(glossy(),0).status,'unsupported');
  assert.equal(suggestContourSlices(glossy(),4,{axis:'unknown'}).status,'unsupported');
});
test('metadata policy records fallback evidence and still honors explicit cuts',()=>{
  const im=glossy(),id='button.primary.normal';
  const t={coordinates:{outputScale:1},sheets:[{parts:[{assetId:id,stretch:'nine-slice',bodyRect:[0,0,320,96]}]}],stateGroups:[]};
  const p={version:'1.0',defaultDensity:4,verticalLogicalWidth:10,roundedEndHypotheses:[],contentInsets:{},automaticAcceptance:false};
  const images=new Map([[id,im]]);
  assert.throws(()=>deriveMetadata(t,images,p),/override-required/);
  const r=deriveMetadata(t,images,{...p,filledContourFallback:true});
  assert.equal(r.evidence[0].cutsBasis,'filled-contour-delivered-pixels');
  assert.equal(r.evidence[0].suggestion.method,'filled-contour-v1');assert.ok(r.evidence[0].suggestion.strictRejection);
  assert.equal(r.evidence[0].requiresVisualReview,true);
  const cuts={left:3,top:3,right:3,bottom:3};
  const manual=deriveMetadata(t,images,{...p,filledContourFallback:true},{[id]:{nineSlice:cuts}});
  assert.deepEqual(manual.parts[id].metadata.nineSlice,cuts);assert.equal(manual.evidence[0].cutsBasis,'skin-override');
});
