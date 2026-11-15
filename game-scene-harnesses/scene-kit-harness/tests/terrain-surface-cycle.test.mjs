import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTerrainSurfaceCycle,validateTerrainSurfaceCycle} from '../src/terrain-surface-cycle.mjs';
import {encodeRgbaPng,inspectPng} from '../src/png.mjs';
import {hash,seal,unseal} from '../src/generation/common.mjs';

function fixture(){
  const width=128,height=64,rgba=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)rgba.set([(x*11)%256,y*3,(x*7+y)%256,255],(y*width+x)*4);
  const png=encodeRgbaPng(width,height,rgba),source={path:'materials/cap.png',sha256:hash(png),byteLength:png.length};
  return {png,rgba,width,height,options:{source,outputPath:'materials/cap-cycle.png',fromColumn:8,usableColumns:96,overlapColumns:32}};
}

test('surface cycle independently replays, preserving the source and granting no kit or artwork acceptance',()=>{
  const f=fixture(),before=Buffer.from(f.png),a=buildTerrainSurfaceCycle(f.png,f.options),b=buildTerrainSurfaceCycle(f.png,f.options);
  assert.deepEqual(a,b);assert.deepEqual(f.png,before);
  const files=new Map([[f.options.source.path,f.png],[f.options.outputPath,a.png]]);
  assert.equal(validateTerrainSurfaceCycle(a.record,{readAsset:p=>files.get(p)}),a.record);
  assert.equal(a.record.productionKit,false);assert.equal(a.record.artAcceptance,'not-assessed');assert.equal(a.record.generationCalls,0);
  assert.equal(a.record.periodColumns,64);assert.equal(a.record.repeatCount,2);
});

test('every selected RGBA value stays on its original native row and the full horizontal cycle closes without resizing',()=>{
  const f=fixture(),{png,record}=buildTerrainSurfaceCycle(f.png,f.options),image=inspectPng(png,{includePixels:true}),cuts=record.closure.phases[0].cutRows;
  assert.equal(image.width,f.width);assert.equal(image.height,f.height);assert.equal(record.closure.options.phaseCount,1);
  for(let y=0;y<f.height;y++)for(let x=0;x<f.width;x++){
    const r=x%64,sx=8+r+(r<cuts[y]?64:0),src=(y*f.width+sx)*4,d=(y*f.width+x)*4;
    assert.deepEqual(image.rgba.subarray(d,d+4),f.rgba.subarray(src,src+4));
    assert.equal(image.rgba[d+1],y*3,'a solver-axis transpose cannot become vertical paint translation');
    assert.deepEqual(image.rgba.subarray(d,d+4),image.rgba.subarray((y*f.width+(x+64)%f.width)*4,(y*f.width+(x+64)%f.width)*4+4));
  }
});

test('resealed cut paths, provenance, source identity and acceptance claims fail deterministic replay',()=>{
  const f=fixture(),{record,png}=buildTerrainSurfaceCycle(f.png,f.options),files=new Map([[f.options.source.path,f.png],[f.options.outputPath,png]]);
  for(const mutate of [r=>r.closure.phases[0].cutRows[0]++,r=>r.provenanceSha256='f'.repeat(64),r=>r.sourceInput.rgbaSha256='e'.repeat(64),r=>r.productionKit=true,r=>r.artAcceptance='accepted']){
    const r=structuredClone(unseal(record));mutate(r);assert.throws(()=>validateTerrainSurfaceCycle(seal(r),{readAsset:p=>files.get(p)}));
  }
  files.set(f.options.outputPath,f.png);assert.throws(()=>validateTerrainSurfaceCycle(record,{readAsset:p=>files.get(p)}));
  const unsafe=structuredClone(unseal(record));unsafe.sourceInput.path='../secret.png';let reads=0;
  assert.throws(()=>validateTerrainSurfaceCycle(seal(unsafe),{readAsset:()=>{reads++;return f.png;}}));assert.equal(reads,0);
});

test('invalid crops, nonclosing periods, unsafe paths, bad source checksums and translucent inputs are refused',()=>{
  const f=fixture();
  for(const delta of [{fromColumn:-1},{fromColumn:33},{usableColumns:63},{overlapColumns:48},{usableColumns:95},{outputPath:'../cap.png'},{outputPath:f.options.source.path},{extra:true},
    {source:{...f.options.source,sha256:'a'.repeat(64)}}])assert.throws(()=>buildTerrainSurfaceCycle(f.png,{...f.options,...delta}));
  const rgba=Buffer.from(f.rgba);rgba[3]=254;const png=encodeRgbaPng(f.width,f.height,rgba);
  assert.throws(()=>buildTerrainSurfaceCycle(png,{...f.options,source:{...f.options.source,sha256:hash(png),byteLength:png.length}}));
  const flat=Buffer.alloc(f.rgba.length);for(let i=0;i<flat.length;i+=4)flat.set([10,20,30,255],i);
  const flatPng=encodeRgbaPng(f.width,f.height,flat);
  assert.throws(()=>buildTerrainSurfaceCycle(flatPng,{...f.options,source:{...f.options.source,sha256:hash(flatPng),byteLength:flatPng.length}}));
});
