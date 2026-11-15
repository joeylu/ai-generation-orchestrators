import test from 'node:test';
import assert from 'node:assert/strict';
import {terrainEdgesFixture} from './helpers/terrain-edges.mjs';
import {reviewTerrainBrushFootprint,requireTerrainBrushFootprint} from '../src/terrain-brush-footprint.mjs';
const policy={minimumSpanCells:{width:1,height:1},maximumCornerTransitionCells:1,minimumInteriorWidthCells:.25,minimumBottomRepeatCells:1,requireFullPerimeter:true};
function input(){return {grid:{width:64,height:64},terrainEdges:terrainEdgesFixture().edges,
  terrainBottomEdges:{edge:{scale:{numerator:1,denominator:2},repeatX:{from:0,to:256}},leftCorner:{},rightCorner:{}},policy:structuredClone(policy)};}
const codes=r=>r.issues.map(i=>i.code);
test('small footprint passes only the declared budget, without granting artwork acceptance or changing input',()=>{
  const x=input(),before=structuredClone(x),r=requireTerrainBrushFootprint(x);assert.equal(r.status,'pass');assert.equal(r.artAcceptance,'not-assessed');assert.equal(r.productionKit,false);assert.equal(r.generationCalls,0);assert.deepEqual(x,before);
  assert.equal(r.sides.left.minimumSpanInwardFitFactor,1);assert.equal(r.interiorWidthWorld,48);assert.equal(r.bottom.repeatWorld,128);
});
test('wide side collars, long corners and a short bottom period are rejected before delivery',()=>{
  const x=input();x.policy.maximumCornerTransitionCells=.75;for(const side of ['left','right']){const wall=x.terrainEdges[side].wall,corner=x.terrainEdges[side].corner;wall.scale={numerator:1,denominator:1};corner.scale={numerator:1,denominator:1};wall.boundaryX=side==='left'?4:44;corner.boundaryX=wall.boundaryX;wall.innerX=side==='left'?44:4;corner.innerX=wall.innerX;wall.inboardBlend={toX:side==='left'?46:2};corner.inboardBlend={toX:wall.inboardBlend.toX};corner.wallStartY=72;}
  x.terrainBottomEdges.edge.repeatX.to=64;const r=reviewTerrainBrushFootprint(x);
  for(const code of ['TERRAIN_BRUSH_INWARD_COMPRESSION','TERRAIN_BRUSH_CORNER_DEPTH','TERRAIN_BRUSH_INTERIOR_WIDTH','TERRAIN_BRUSH_BOTTOM_REPEAT'])assert(codes(r).includes(code));
  assert.throws(()=>requireTerrainBrushFootprint(x),e=>e.errors?.some(i=>i.code==='TERRAIN_BRUSH_FOOTPRINT'));
});
test('narrow new collars cannot hide a missing lower perimeter or an unchanged failing opposite side',()=>{
  const x=input();x.terrainBottomEdges=null;x.policy.maximumCornerTransitionCells=.25;x.terrainEdges.left.corner.wallStartY=32;
  const r=reviewTerrainBrushFootprint(x);assert(codes(r).includes('TERRAIN_BRUSH_FULL_PERIMETER_REQUIRED'));assert(r.issues.some(i=>i.code==='TERRAIN_BRUSH_CORNER_DEPTH'&&i.side==='right'));
});
test('policy is explicit and fingerprinted; a larger reviewed span does not erase source or art checks',()=>{
  const x=input(),a=reviewTerrainBrushFootprint(x);x.policy.minimumSpanCells.width=2;const b=reviewTerrainBrushFootprint(x);assert.notEqual(a.policySha256,b.policySha256);assert.equal(b.minimumSpanWorld.width,128);assert.equal(b.artAcceptance,'not-assessed');
  x.policy.maximumCornerTransitionCells=NaN;assert.throws(()=>reviewTerrainBrushFootprint(x));
});
