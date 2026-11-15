import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewTerrainBrushFootprint,reviewTerrainSurfaceSpan} from '../src/terrain-brush-footprint.mjs';

function fixture(inset=24){
  const edges={left:{},right:{},surfaceInterface:{profile:'world-body-native-lip-v1',capSourceSha256:'a'.repeat(64),capEndRow:56,fadeRows:12}};
  for(const side of ['left','right'])for(const part of ['wall','corner']){
    const sign=side==='left'?1:-1,boundaryX=64,innerX=64+sign*inset;
    edges[side][part]={pixelSize:{width:128,height:128},scale:{numerator:1,denominator:1},boundaryX,innerX,
      inboardBlend:{fromX:innerX+sign*1,toX:innerX+sign*6},source:{sha256:(side==='left'?'b':'c').repeat(64)},
      ...(part==='wall'?{repeatY:{from:16,to:96}}:{surfaceY:16,wallStartY:48})};
  }
  return {grid:{width:64,height:64},terrainEdges:edges,terrainBottomEdges:{edge:{scale:{numerator:1,denominator:1},repeatX:{from:0,to:128}},leftCorner:{},rightCorner:{}},
    appearance:{cap:{source:{sha256:'a'.repeat(64)},pixelSize:{width:128,height:64}},capDepth:{numerator:32,denominator:1},capUvEnd:{numerator:1,denominator:1}},
    policy:{minimumSpanCells:{width:1,height:1},maximumCornerTransitionCells:1,minimumInteriorWidthCells:.25,minimumBottomRepeatCells:1,requireFullPerimeter:true}};
}

test('a passing size budget can still expose a deep shared cover in a narrow nominal interior',()=>{
  const x=fixture(),before=structuredClone(x),size=reviewTerrainBrushFootprint(x),r=reviewTerrainSurfaceSpan(x);
  assert.equal(size.status,'pass');assert.equal(r.minimumSpanBudgetStatus,'pass');assert.equal(r.status,'measured-not-qualified');
  assert.deepEqual(r.nominalSharedIntervalWorld,{from:24,to:40,width:16});assert.equal(r.overlayDepthWorld,28);assert.equal(r.fadeWorld,6);
  assert.equal(r.overlayDepthToNominalInterior,1.75);assert.equal(r.technicalOrArtQualification,false);assert.equal(r.automaticCalibration,false);
  assert.equal(r.sourceProcessing,'none');assert.equal(r.artAcceptance,'not-assessed');assert.deepEqual(x,before);
  assert.deepEqual(reviewTerrainBrushFootprint(x),size,'new review never weakens or mutates the old size gate');
});

test('wider declared joins and a larger minimum span report their own depth ratios without automatic acceptance',()=>{
  const a=reviewTerrainSurfaceSpan(fixture(18)),x=fixture();x.policy.minimumSpanCells.width=2;const b=reviewTerrainSurfaceSpan(x);
  assert.equal(a.nominalSharedIntervalWorld.width,28);assert.equal(a.overlayDepthToNominalInterior,1);
  assert.equal(b.nominalSharedIntervalWorld.width,80);assert.equal(b.overlayDepthToNominalInterior,.35);
  assert.equal(a.status,'measured-not-qualified');assert.equal(b.status,'measured-not-qualified');assert.notEqual(a.inputSha256,b.inputSha256);
  assert.deepEqual(a.nativeUpperCorners.left.fadeFromBoundaryWorld,{from:19,to:24});
});

test('wrong cap identity, invalid native fade and missing or exhausted shared space cannot become a fit success',()=>{
  const x=fixture();x.appearance.cap.source.sha256='d'.repeat(64);assert.throws(()=>reviewTerrainSurfaceSpan(x));
  const y=fixture();y.terrainEdges.left.corner.inboardBlend.fromX=64;assert.throws(()=>reviewTerrainSurfaceSpan(y));
  const z=fixture();delete z.terrainEdges.surfaceInterface;assert.throws(()=>reviewTerrainSurfaceSpan(z));
  const noSpace=fixture(32),r=reviewTerrainSurfaceSpan(noSpace);assert.equal(r.minimumSpanBudgetStatus,'fail');assert.equal(r.overlayDepthToNominalInterior,null);
  assert.equal(r.status,'measured-not-qualified');assert.equal(r.technicalOrArtQualification,false);
});
