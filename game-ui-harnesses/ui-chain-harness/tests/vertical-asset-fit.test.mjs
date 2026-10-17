import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fitVerticalAsset} from '../src/skins/assemble.mjs';

test('vertical rail retains cap aspect and fills long and short slots without transparent bands',()=>{
  const source={width:8,height:40,pixels:Buffer.alloc(8*40*4)};
  for(let y=0;y<40;y++)for(let x=0;x<8;x++)source.pixels.set(y<4?[255,0,0,255]:y>=36?[0,0,255,255]:[0,255,0,255],(y*8+x)*4);
  for(const height of [16,80]){
    const {image}=fitVerticalAsset(source,4,height,[4,4]);
    for(let y=0;y<height;y++)assert.deepEqual([...image.pixels.subarray(y*16,y*16+4)],y<2?[255,0,0,255]:y>=height-2?[0,0,255,255]:[0,255,0,255]);
  }
  assert.throws(()=>fitVerticalAsset(source,8,8,[4,4]),/too short/);
  assert.throws(()=>fitVerticalAsset(source,8,80,[20,20]),/Invalid/);
});
