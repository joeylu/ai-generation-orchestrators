import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { pngVisibleBounds } from '../src/png-visible-bounds.ts';
import { fixtureRgbaPng } from './helpers/decomposition-fixture.ts';

// This focused decoder fixture supplies IDAT; the importer separately verifies PNG CRC/structure.
function encoded(raw:Uint8Array):Uint8Array {
  const compressed=deflateSync(raw),out=new Uint8Array(8+12+compressed.length),v=new DataView(out.buffer);
  v.setUint32(8,compressed.length);out.set(new TextEncoder().encode('IDAT'),12);out.set(compressed,16);return out;
}
const paeth=(a:number,b:number,c:number)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
for(let filter=0;filter<=4;filter++)test(`PNG alpha bounds preserve soft alpha with filter ${filter}`,async()=>{
  const width=4,height=3,stride=width*4,raw=new Uint8Array(height*(stride+1));let prior=new Uint8Array(stride);
  for(let y=0;y<height;y++){
    const row=new Uint8Array(stride);if(y===1){row[1*4+3]=1;row[2*4+3]=128;}
    raw[y*(stride+1)]=filter;
    for(let i=0;i<stride;i++){const a=i>=4?row[i-4]:0,b=prior[i],c=i>=4?prior[i-4]:0;raw[y*(stride+1)+1+i]=row[i]-(filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c));}
    prior=row;
  }
  assert.deepEqual(await pngVisibleBounds(encoded(raw),width,height),[1,1,2,1]);
});
test('PNG bounded decoder rejects transparent, truncated, invalid filters and oversized inflation',async()=>{
  await assert.rejects(()=>pngVisibleBounds(fixtureRgbaPng(1,1,[0,0,0,0]),1,1),/ASSETS_EMPTY_ALPHA/);
  await assert.rejects(()=>pngVisibleBounds(encoded(new Uint8Array(4)),1,1),/DECODE/);
  await assert.rejects(()=>pngVisibleBounds(encoded(new Uint8Array(6)),1,1),/DECODE/);
  await assert.rejects(()=>pngVisibleBounds(encoded(Uint8Array.of(5,0,0,0,255)),1,1),/DECODE/);
});
