import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeRgbaPng,inspectPng} from '../src/png.mjs';
import {hash,seal,unseal} from '../src/generation/common.mjs';
import {buildTerrainRigidRepeat,validateTerrainRigidRepeat,TERRAIN_RIGID_REPEAT_PROFILE} from '../src/terrain-rigid-repeat.mjs';

function fixture({alpha=255,width=96,height=160}={}){
  const rgba=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)rgba.set([(x*7+y*3)%256,(x*19+y*13)%256,(x*3+y*11)%256,alpha],(y*width+x)*4);
  const png=encodeRgbaPng(width,height,rgba),source={path:'materials/body-field.png',sha256:hash(png),byteLength:png.length},
    options={source,outputPath:'materials/body-rigid-repeat.png',fromRow:24,toRow:120},
    appearance={format:'ai_scene_continuous_terrain_appearance_v6',body:{source,pixelSize:{width,height}}};
  return {png,rgba,source,options,appearance};
}
const rejects=(action,code)=>assert.throws(action,error=>error.errors?.some(issue=>issue.code===code));
const ratio=value=>value.numerator/value.denominator;

test('rigid row selection preserves every retained RGBA sample and excludes outside rows without changing the input',()=>{
  const f=fixture(),before=Buffer.from(f.png),a=buildTerrainRigidRepeat(f.png,f.options),b=buildTerrainRigidRepeat(f.png,f.options),
    image=inspectPng(a.png,{includePixels:true});
  assert.deepEqual(a,b);assert.deepEqual(f.png,before);assert.equal(a.record.profile,TERRAIN_RIGID_REPEAT_PROFILE);
  assert.deepEqual(a.record.output.pixelSize,{width:96,height:96});
  assert.deepEqual(image.rgba,f.rgba.subarray(24*96*4,120*96*4));
  assert.deepEqual(image.rgba.subarray(0,96*4),f.rgba.subarray(24*96*4,25*96*4));
  assert.deepEqual(image.rgba.subarray(95*96*4),f.rgba.subarray(119*96*4,120*96*4));
  assert.equal(a.record.sourcePngChanged,false);assert.equal(a.record.sourceAlphaChanged,false);
  assert.equal(a.record.pixelsRecolored,false);assert.equal(a.record.pixelsBlended,false);
  assert.equal(a.record.sourceCoordinatesWarped,false);assert.equal(a.record.xPhaseShiftPixels,0);
  assert.equal(a.record.generationCalls,0);assert.equal(a.record.visualAcceptance,'not-assessed');
});

test('the rational period and phase retain world sampling scale at a nonzero crop start instead of resetting each owner',()=>{
  const f=fixture(),{record}=buildTerrainRigidRepeat(f.png,f.options);
  assert.deepEqual(record.bodyPeriod,{width:{numerator:512,denominator:1},height:{numerator:768,denominator:5}});
  assert.deepEqual(record.phaseOriginWorldY,{numerator:192,denominator:5});
  const H=ratio(record.bodyPeriod.height),phase=ratio(record.phaseOriginWorldY),outputH=record.output.pixelSize.height;
  for(const sourceRow of [24,25,60,119]){
    const worldY=sourceRow*256/160,uv=(worldY-phase)/H;
    assert(Math.abs(uv*outputH-(sourceRow-24))<1e-9);
  }
  assert.equal(outputH/H,160/256,'cropping must retain vertical pixels per world unit');
  assert.equal(record.output.pixelSize.width/ratio(record.bodyPeriod.width),96/512,'X phase and physical scale stay unchanged');
});

test('validated source identity and output bytes are both replayed and bound to the base appearance',()=>{
  const f=fixture(),{record,png}=buildTerrainRigidRepeat(f.png,f.options),assets=new Map([[f.source.path,f.png],[f.options.outputPath,png]]),
    readAsset=path=>assets.get(path);
  assert.deepEqual(validateTerrainRigidRepeat(record,{appearance:f.appearance,readAsset}),record);
  rejects(()=>validateTerrainRigidRepeat(record,{appearance:{...f.appearance,format:'ai_scene_continuous_terrain_appearance_v5'},readAsset}),'RIGID_REPEAT_BINDING');
  rejects(()=>validateTerrainRigidRepeat(record,{appearance:{...f.appearance,body:{...f.appearance.body,pixelSize:{width:95,height:160}}},readAsset}),'RIGID_REPEAT_BINDING');
  const changed=Buffer.from(png);changed[changed.length-1]^=1;assets.set(f.options.outputPath,changed);
  rejects(()=>validateTerrainRigidRepeat(record,{appearance:f.appearance,readAsset}),'RIGID_REPEAT_OUTPUT_REPLAY');
  assets.set(f.options.outputPath,png);assets.set(f.source.path,Buffer.from(f.png).subarray(0,f.png.length-1));
  rejects(()=>validateTerrainRigidRepeat(record,{appearance:f.appearance,readAsset}),'RIGID_REPEAT_SOURCE');
});

test('resealing invented phase, period, output dimensions, work or limits cannot bypass deterministic replay',()=>{
  const f=fixture(),{record,png}=buildTerrainRigidRepeat(f.png,f.options),readAsset=path=>path===f.source.path?f.png:png;
  for(const mutate of [r=>r.phaseOriginWorldY.numerator++,r=>r.bodyPeriod.height.numerator++,r=>r.output.pixelSize.height++,
    r=>r.work.rowsCopied++,r=>r.limits.maximumOutputPixels++,r=>r.output.source.sha256='a'.repeat(64)]){
    const body=structuredClone(unseal(record));mutate(body);
    rejects(()=>validateTerrainRigidRepeat(seal(body),{appearance:f.appearance,readAsset}),'RIGID_REPEAT_REPLAY');
  }
});

test('opaque bounded sources, half-open row ranges and distinct portable output paths are required',()=>{
  const f=fixture();rejects(()=>buildTerrainRigidRepeat(f.png,{...f.options,source:{...f.source,sha256:'a'.repeat(64)}}),'RIGID_REPEAT_SOURCE');
  const transparent=fixture({alpha:254});rejects(()=>buildTerrainRigidRepeat(transparent.png,transparent.options),'RIGID_REPEAT_SOURCE_IMAGE');
  const wide=fixture({width:2049,height:16});rejects(()=>buildTerrainRigidRepeat(wide.png,{...wide.options,fromRow:2,toRow:10}),'RIGID_REPEAT_SOURCE_IMAGE');
  for(const [fromRow,toRow]of [[-1,24],[24,24],[24,25],[100,170],[1.5,20],[24,60.5]])
    rejects(()=>buildTerrainRigidRepeat(f.png,{...f.options,fromRow,toRow}),'RIGID_REPEAT_OPTIONS');
  for(const path of ['../unsafe.png','materials//repeat.png','/repeat.png','materials/../repeat.png',f.source.path,'MATERIALS/BODY-FIELD.PNG'])
    rejects(()=>buildTerrainRigidRepeat(f.png,{...f.options,outputPath:path}),'RIGID_REPEAT_OUTPUT_PATH');
});
