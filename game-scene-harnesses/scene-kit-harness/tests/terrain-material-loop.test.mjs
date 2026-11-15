import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeRgbaPng,inspectPng} from '../src/png.mjs';
import {hash,seal,unseal} from '../src/generation/common.mjs';
import {buildTerrainMaterialLoop,measureTerrainBodyBands,validateTerrainMaterialLoop,TERRAIN_MATERIAL_LOOP_PROFILE} from '../src/terrain-material-loop.mjs';

function fixture({alpha=255,width=96,height=160}={}){
  const rgba=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const sx=x===width-1?0:x,p=(y*width+x)*4;
    rgba.set([(sx*7+y*3)%256,(Math.floor(sx/8)*19+Math.floor(y/9)*13)%256,(sx*3+y*11)%256,alpha],p);
  }
  const png=encodeRgbaPng(width,height,rgba),source={path:'materials/body-field.png',sha256:hash(png),byteLength:png.length},
    options={source,outputPath:'materials/body-loop.png',usableRows:144,overlapRows:48,phaseCount:3},
    appearance={format:'ai_scene_continuous_terrain_appearance_v6',body:{source,pixelSize:{width,height}}};
  return {png,rgba,source,options,appearance};
}
const rejects=(fn,code)=>assert.throws(fn,error=>error.errors?.some(issue=>issue.code===code));

test('closed overlap cycle is deterministic and every RGBA sample is an unchanged original source pixel',()=>{
  const f=fixture(),before=Buffer.from(f.png),a=buildTerrainMaterialLoop(f.png,f.options),b=buildTerrainMaterialLoop(f.png,f.options),
    output=inspectPng(a.png,{includePixels:true}),map=Buffer.alloc(output.width*output.height*4),P=f.options.usableRows-f.options.overlapRows;
  assert.deepEqual(a,b);assert.deepEqual(f.png,before);assert.equal(a.record.profile,TERRAIN_MATERIAL_LOOP_PROFILE);
  assert.equal(output.width,96);assert.equal(output.height,288);assert.equal(a.record.sourcePngChanged,false);assert.equal(a.record.pixelsRecolored,false);
  for(let y=0;y<output.height;y++)for(let x=0;x<output.width;x++){
    const phase=Math.floor(y/P),row=y%P,item=a.record.phases[phase],tail=row<item.cutRows[x],
      sourceY=tail?row+P:row,sourceX=(x+(tail?item.previousXOffsetPixels:item.xOffsetPixels))%output.width,
      sourceIndex=sourceY*output.width+sourceX,index=y*output.width+x;
    assert.deepEqual(output.rgba.subarray(index*4,index*4+4),f.rgba.subarray(sourceIndex*4,sourceIndex*4+4));map.writeUInt32LE(sourceIndex,index*4);
  }
  assert.equal(hash(map),a.record.provenanceSha256);assert.deepEqual(a.record.bodyPeriod,{width:{numerator:512,denominator:1},height:{numerator:2304,denominator:5}});
  assert.deepEqual(a.record.sourceDensity,{normalizationHeight:160,worldWidth:512,worldHeight:256});
});

test('each cut closes exactly across X and every band boundary continues to the next original row including the final Y wrap',()=>{
  const f=fixture(),{record,png}=buildTerrainMaterialLoop(f.png,f.options),image=inspectPng(png,{includePixels:true}),P=96;
  for(const phase of record.phases){
    assert.equal(phase.cutRows.length,96);assert.equal(phase.cutRows[0],phase.cutRows.at(-1));
    for(let x=0;x<96;x++){
      assert(phase.cutRows[x]>=4&&phase.cutRows[x]<44);
      if(x)assert(Math.abs(phase.cutRows[x]-phase.cutRows[x-1])<=2);
    }
  }
  for(let k=0;k<3;k++)for(let x=0;x<96;x++){
    const previous=record.phases[(k+2)%3],sx=(x+previous.xOffsetPixels)%96,
      beforeY=(k*P-1+image.height)%image.height,afterY=k*P;
    assert.deepEqual(image.rgba.subarray((beforeY*96+x)*4,(beforeY*96+x+1)*4),f.rgba.subarray(((P-1)*96+sx)*4,((P-1)*96+sx+1)*4));
    assert.deepEqual(image.rgba.subarray((afterY*96+x)*4,(afterY*96+x+1)*4),f.rgba.subarray((P*96+sx)*4,(P*96+sx+1)*4));
  }
});

test('original image, dimensions and material identity bind the replay and exact output PNG',()=>{
  const f=fixture(),result=buildTerrainMaterialLoop(f.png,f.options),assets=new Map([[f.source.path,f.png],[f.options.outputPath,result.png]]),readAsset=p=>assets.get(p);
  assert.deepEqual(validateTerrainMaterialLoop(result.record,{appearance:f.appearance,readAsset}),result.record);
  rejects(()=>validateTerrainMaterialLoop(result.record,{appearance:{...f.appearance,body:{...f.appearance.body,pixelSize:{width:95,height:160}}},readAsset}),'MATERIAL_LOOP_BINDING');
  const changed=Buffer.from(result.png);changed[changed.length-1]^=1;assets.set(f.options.outputPath,changed);
  rejects(()=>validateTerrainMaterialLoop(result.record,{appearance:f.appearance,readAsset}),'MATERIAL_LOOP_OUTPUT_REPLAY');
  assets.set(f.options.outputPath,result.png);assets.set(f.source.path,Buffer.from(f.png).subarray(0,f.png.length-1));
  rejects(()=>validateTerrainMaterialLoop(result.record,{appearance:f.appearance,readAsset}),'MATERIAL_LOOP_SOURCE');
});

test('resealed invented paths, costs, output hashes and provenance cannot be accepted without full deterministic replay',()=>{
  const f=fixture(),result=buildTerrainMaterialLoop(f.png,f.options),readAsset=p=>p===f.source.path?f.png:result.png;
  for(const edit of [body=>{body.phases[0].cutRows[3]++;},body=>{body.phases[0].cutCosts.pathMean++;},
    body=>{body.provenanceSha256='a'.repeat(64);},body=>{body.output.source.sha256='a'.repeat(64);},body=>{body.algorithm.maxStep=3;}]){
    const body=structuredClone(unseal(result.record));edit(body);
    rejects(()=>validateTerrainMaterialLoop(seal(body),{appearance:f.appearance,readAsset}),'MATERIAL_LOOP_REPLAY');
  }
});

test('bad source alpha, source checksums, output paths and unbounded overlap/output work are rejected',()=>{
  const f=fixture();rejects(()=>buildTerrainMaterialLoop(f.png,{...f.options,source:{...f.source,sha256:'a'.repeat(64)}}),'MATERIAL_LOOP_SOURCE');
  const transparent=fixture({alpha:254});rejects(()=>buildTerrainMaterialLoop(transparent.png,transparent.options),'MATERIAL_LOOP_SOURCE_IMAGE');
  for(const path of ['../unsafe.png','materials//loop.png',f.source.path,'/loop.png'])rejects(()=>buildTerrainMaterialLoop(f.png,{...f.options,outputPath:path}),'MATERIAL_LOOP_OUTPUT_PATH');
  for(const overlapRows of [0,15,72,400])rejects(()=>buildTerrainMaterialLoop(f.png,{...f.options,overlapRows}),'MATERIAL_LOOP_OPTIONS');
  rejects(()=>buildTerrainMaterialLoop(f.png,{...f.options,phaseCount:99}),'MATERIAL_LOOP_OPTIONS');
});

test('single phase is explicit and keeps the same input pixel density without duplicating a three-phase budget',()=>{
  const f=fixture(),single=buildTerrainMaterialLoop(f.png,{...f.options,phaseCount:1});
  assert.equal(single.record.output.pixelSize.height,96);assert.equal(single.record.phases.length,1);
  assert.equal(single.record.phases[0].xOffsetPixels,0);assert.equal(single.record.phases[0].previousXOffsetPixels,0);
  assert.deepEqual(single.record.bodyPeriod.height,{numerator:768,denominator:5});assert.equal(single.record.generationCalls,0);
});

test('equal wrap rows do not hide a short horizontal collar, and a source-pixel loop can remove it',()=>{
  const width=64,height=160,rgba=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const grain=Math.round(12*Math.sin(x*Math.PI/16)),row=y>=156?2*(159-y):Math.floor(y/3);
    rgba.set([48+grain+row,67+grain+row,76+grain+row,255],(y*width+x)*4);
  }
  const png=encodeRgbaPng(width,height,rgba),source={path:'body.png',byteLength:png.length,sha256:hash(png)};
  const {record,png:loop}=buildTerrainMaterialLoop(png,{source,outputPath:'loop.png',usableRows:154,overlapRows:60,phaseCount:1});
  const original=measureTerrainBodyBands(png),derived=measureTerrainBodyBands(loop);
  assert.equal(original.wrapNeighborMean,0);
  assert(original.maximumFourRowMean>10);
  assert(derived.maximumFourRowMean<original.maximumFourRowMean);
  const appearance={format:'ai_scene_continuous_terrain_appearance_v5',body:{source,pixelSize:{width,height}}};
  assert.deepEqual(validateTerrainMaterialLoop(record,{appearance,readAsset:path=>path===source.path?png:loop}),record);
});
