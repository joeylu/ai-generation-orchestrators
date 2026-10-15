import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertVisibleAsset,sliceRisks} from '../src/skins/quality.mjs';
test('empty gate ignores hidden RGB but preserves low alpha and hollow artwork',()=>{
  const image={width:3,height:3,pixels:Buffer.alloc(36,255)};
  for(let i=3;i<36;i+=4)image.pixels[i]=0;
  assert.throws(()=>assertVisibleAsset(image,'x','source'),{code:'skin.empty-asset'});
  image.pixels[3]=1;
  assert.doesNotThrow(()=>assertVisibleAsset(image,'x','source'));
});
test('risk comparison uses pixel density, active axes and one-pixel seam tolerance',()=>{
  const args={source:{},stretch:'vertical',resolution:2,metadata:{nineSlice:{left:0,right:0,top:4,bottom:4}},suggestion:{status:'supported',method:'repeated-center-bands-v1',bordersPx:{left:30,right:30,top:9,bottom:9}}};
  assert.deepEqual(sliceRisks(args),[]);
  args.suggestion.bordersPx.top=12;
  assert.deepEqual(sliceRisks(args)[0].sides,['top']);
  args.suggestion.method='structure-fallback';
  assert.deepEqual(sliceRisks(args),[]);
});
