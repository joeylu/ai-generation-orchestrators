import test from 'node:test';
import assert from 'node:assert/strict';
import {fitAsset} from '../src/skins/assemble.mjs';
import {assertMetadata} from '../src/skins/contract.mjs';
test('shared state frame preserves aspect, center alignment, transparent holes and source bytes',()=>{
  const a={width:8,height:4,pixels:Buffer.alloc(8*4*4)},b={width:6,height:4,pixels:Buffer.alloc(6*4*4)};
  for(const im of [a,b])for(let i=0;i<im.pixels.length;i+=4)im.pixels.set([200,120,60,128],i);
  a.pixels.fill(0,(1*8+3)*4,(1*8+5)*4);const original=Buffer.from(a.pixels);
  const x=fitAsset(a,16,16,[8,4]),y=fitAsset(b,16,16,[8,4]);
  assert.deepEqual(x.operation.resized,[16,8]);assert.equal(x.operation.scale,y.operation.scale);
  assert.deepEqual(x.operation.offset,[0,4]);assert.deepEqual(y.operation.sourceOffset,[1,0]);
  assert.equal(x.image.pixels[(6*16+6)*4+3],0);assert.deepEqual(a.pixels,original);
  assert.throws(()=>fitAsset(a,16,16,[4,4]),/Invalid/);
});
test('density changes logical slicing limits without changing source pixel dimensions',()=>{
  const meta={density:4,nineSlice:{left:10,right:10,top:3,bottom:3},contentInsets:{left:0,right:0,top:0,bottom:0},minSize:{width:20,height:6}};
  assert.doesNotThrow(()=>assertMetadata(meta,160,48,'nine-slice'));
  assert.throws(()=>assertMetadata({...meta,density:8},160,48,'nine-slice'),e=>e.code==='skin.slice');
});
