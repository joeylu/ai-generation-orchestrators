import test from 'node:test';
import assert from 'node:assert/strict';
import {visibleSelectionBounds,selectionMarkGeometry} from '../src/runtime/selection-geometry.mjs';
const image=(width,height)=>({width,height,pixels:Buffer.alloc(width*height*4)});
function fill(im,x,y,w,h,alpha=255){for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)im.pixels[(yy*im.width+xx)*4+3]=alpha;return im;}
test('asymmetric transparent padding and alpha-1 fringe do not offset a radio dot from its ring',()=>{
  const ring=fill(image(96,96),32,33,60,60),dot=fill(image(48,48),3,3,39,39);
  fill(ring,0,0,1,1,1);fill(dot,47,47,1,1,1);const original=Buffer.from(ring.pixels);
  const base=visibleSelectionBounds(ring),mark=visibleSelectionBounds(dot),g=selectionMarkGeometry(24,base,mark,true);
  const actual=[g.x+(mark.x+mark.width/2)*g.width,g.y+(mark.y+mark.height/2)*g.height];
  const expected=[(base.x+base.width/2)*24,(base.y+base.height/2)*24];
  assert.ok(actual.every((n,i)=>Math.abs(n-expected[i])<1e-9));assert.ok(Math.abs(expected[0]-15.5)<1e-9);assert.equal(expected[1],15.75);
  assert.ok(Math.abs(4+(mark.x+mark.width/2)*16-expected[0])>3,'reproduces the old fixed-offset failure');
  assert.ok(g.width*mark.width<=base.width*24*2/3);assert.ok(g.height*mark.height<=base.height*24*2/3);
  assert.deepEqual(ring.pixels,original);
});
test('centered fixtures retain their authored dimensions and checkbox marks keep their nominal size',()=>{
  assert.deepEqual(selectionMarkGeometry(24),{width:16,height:16,x:4,y:4});
  assert.deepEqual(selectionMarkGeometry(24,undefined,undefined,true),{width:16,height:16,x:4,y:4});
  const base={x:.2,y:.1,width:.6,height:.7},mark={x:.1,y:.2,width:.8,height:.6},g=selectionMarkGeometry(24,base,mark);
  assert.equal(g.width,16);assert.equal(g.height,16);
  assert.equal(g.x+(mark.x+mark.width/2)*g.width,(base.x+base.width/2)*24);
});
test('genuinely translucent artwork uses its nonzero alpha, and empty masks have a neutral fallback',()=>{
  const im=fill(image(20,20),2,6,10,8,12);
  assert.deepEqual(visibleSelectionBounds(im),{x:.1,y:.3,width:.5,height:.4});
  assert.deepEqual(visibleSelectionBounds(image(20,20)),{x:0,y:0,width:1,height:1});
});
