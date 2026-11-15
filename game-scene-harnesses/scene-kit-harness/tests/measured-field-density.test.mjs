import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeRgbaPng,inspectPng} from '../src/png.mjs';
import {hash,seal,unseal} from '../src/generation/common.mjs';
import {compileMeasuredSurfaceMapping,deriveMeasuredField,MEASURED_FIELD_SHA256} from '../src/terrain-proof/measured-field.mjs';
import {deriveMeasuredFieldDensity2,measuredFieldDensity2Parameters,MEASURED_FIELD_DENSITY2_PROFILE,MEASURED_FIELD_DENSITY2_SHA256} from '../src/terrain-proof/measured-field-density.mjs';

const value=r=>r.numerator/r.denominator;
const pixel=(image,x,y)=>[...image.rgba.subarray((y*image.width+x)*4,(y*image.width+x)*4+4)];
const rejects=(fn,code)=>assert.throws(fn,error=>error.errors?.some(issue=>issue.code===code));
function material(height=1024){
  const width=1536,rgba=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)rgba.set(y<12?[248,210,61,255]:y<40?[118,119,43,255]
    :[x%2?200:100,80,y%2?180:100,255],(y*width+x)*4);
  return encodeRgbaPng(width,height,rgba);
}
function inputs({height=1024,pair={source:{fromX:0,toX:505},reference:{fromX:0,toX:256}}}={}){
  const raw=material(height),rgba=Buffer.alloc(1024*512*4,255);for(let i=0;i<1024*512;i++)rgba[i*4]=i%251;
  const reference=encodeRgbaPng(1024,512,rgba),target=seal({format:'ai_scene_reference_reconstruction_target_v2',rawSha256:hash(reference),
    mapping:{nativeSize:{width:1024,height:512},viewport:{width:1024,height:512},scale:{numerator:1,denominator:1},offset:{x:0,y:0}},surfaces:[{surfaceId:'ground.top'}]});
  const observations={format:'ai_scene_measured_surface_observations_v1',sourceSurfaceTopY:0,sourceBodyStartY:40,sourceWindowCenterX:768,
    rockFeaturePairs:[{featureId:'rock.observation',...pair}],referenceSurfaceSamples:[{sampleId:'top.a',surfaceId:'ground.top',x:300,topY:200,bodyStartY:220}],
    notes:'Synthetic explicit observations; source coordinates are known and no art acceptance is inferred.'};
  return {raw,reference,target,observations};
}
let cache;
function sample(){
  if(!cache){const input=inputs(),mapping=compileMeasuredSurfaceMapping({...input,material:input.raw}),base=deriveMeasuredField(input.raw,mapping),dense=deriveMeasuredFieldDensity2(input.raw,mapping);
    cache={input,mapping,base,dense};}
  return cache;
}

test('density2 reads the original native samples instead of enlarging the old averaged field',()=>{
  const {input,mapping,base,dense}=sample(),body=inspectPng(dense.files.get('materials/body-field.png'),{includePixels:true}),old=inspectPng(base.files.get('materials/body-field.png'),{includePixels:true});
  assert.deepEqual([body.width,body.height],[1010,506]);assert.equal(value(mapping.nativePixelsPerFieldPixel),2);
  assert.deepEqual(pixel(old,100,50),[150,80,140,255]);
  // Native x263+200=463 and body y40+100=140 are known pixels, not a
  // round-trip through the old [150,80,140] area-averaged texel.
  assert.deepEqual(pixel(body,200,100),[200,80,100,255]);assert.deepEqual(pixel(body,201,100),[100,80,100,255]);
  assert.deepEqual(pixel(body,200,101),[200,80,180,255]);
  assert.equal(dense.report.directNativeSampling,true);assert.equal(dense.report.resizedLegacyField,false);
  assert.equal(dense.report.source.sha256,hash(input.raw));assert.equal(dense.report.artSeams,'not-repaired-or-certified');
});

test('both physical crops, material scale, cap depth and normalized UV origin remain unchanged',()=>{
  const {mapping,dense}=sample(),report=dense.report;
  assert.deepEqual(report.crops,mapping.crops);assert.deepEqual(report.logicalPeriod,{width:512,height:256});
  assert.equal(report.field.width,2*mapping.field.width);assert.equal(report.field.height,2*mapping.field.height);assert.equal(report.field.capHeight,2*mapping.field.capHeight);
  assert.equal(value(report.nativePixelsPerFieldPixel)*report.field.width,value(mapping.nativePixelsPerFieldPixel)*mapping.field.width);
  assert.equal(value(report.nativePixelsPerFieldPixel)*report.field.height,value(mapping.nativePixelsPerFieldPixel)*mapping.field.height);
  assert.equal(value(report.surfaceOriginInBodyPixels)/506,value(mapping.surfaceOriginInBodyPixels)/253);
  assert.deepEqual(report.capDepth,mapping.capDepth);assert.deepEqual(report.capUvEnd,mapping.capUvEnd);
  assert.equal(value(report.capDepth),(2-value(report.surfaceOriginInBodyPixels))*256/506);
  assert.equal(value(report.capUvEnd),(2-value(report.surfaceOriginInBodyPixels))/report.field.capHeight);
  assert.equal(report.sampling.xNumerator/report.sampling.denominator,mapping.sampling.xNumerator/mapping.sampling.denominator);
  assert.equal(report.sampling.stepNumerator/report.sampling.denominator,mapping.sampling.stepNumerator/mapping.sampling.denominator/2);
});

test('the bright source top and adjacent real body paint survive with two field pixels of overlap and no alpha fade',()=>{
  const {dense}=sample(),cap=inspectPng(dense.files.get('materials/cap-field.png'),{includePixels:true}),body=inspectPng(dense.files.get('materials/body-field.png'),{includePixels:true});
  assert.deepEqual([cap.width,cap.height],[1010,42]);assert.deepEqual(pixel(cap,200,0),[248,210,61,255]);
  assert.deepEqual(pixel(cap,200,11),[248,210,61,255]);assert.deepEqual(pixel(cap,200,12),[118,119,43,255]);
  assert.deepEqual(pixel(cap,200,40),pixel(body,200,0));assert.deepEqual(pixel(cap,200,41),pixel(body,200,1));
  for(const image of [body,cap])for(let p=3;p<image.rgba.length;p+=4)assert.equal(image.rgba[p],255);
  assert.equal(dense.report.sourceTransition.overlapFieldPixels,2);assert.equal(dense.report.sourceTransition.alphaFadeRows,0);
  assert.equal(dense.report.sourceTransition.physicalMaterialScaleChanged,false);assert.equal(dense.report.sourceTransition.colorGrading,false);
});

test('short source repeats at the same physical boundary without consuming an extra partial row',()=>{
  const input=inputs({height:512}),mapping=compileMeasuredSurfaceMapping({...input,material:input.raw}),{files,report}=deriveMeasuredFieldDensity2(input.raw,mapping),body=inspectPng(files.get('materials/body-field.png'),{includePixels:true});
  assert.equal(mapping.bodySampleHeight,236);assert.equal(report.bodySampleHeight,472);
  assert.equal(report.bodySampleHeight/506,mapping.bodySampleHeight/253);
  assert.deepEqual(report.bodyRepeatRanges,[{targetStartRow:472,targetEndRowExclusive:506,sourceStartRow:0,sourceEndRowExclusive:34}]);
  for(let y=0;y<26;y++)assert.deepEqual(pixel(body,200,y+472),pixel(body,200,y));
  assert.deepEqual(pixel(body,200,505),pixel(body,200,0));assert.deepEqual(report.crops,mapping.crops);
});

test('fractional sampling keeps the exact old native rectangle and source-row positions',()=>{
  const input=inputs({pair:{source:{fromX:200,toX:402},reference:{fromX:100,toX:202}}}),mapping=compileMeasuredSurfaceMapping({...input,material:input.raw}),parameters=measuredFieldDensity2Parameters(mapping);
  assert(value(mapping.nativePixelsPerFieldPixel)>2);assert(value(parameters.nativePixelsPerFieldPixel)>1);
  for(const key of ['xNumerator','bodyYNumerator','capYNumerator'])assert.equal(parameters.sampling[key]/parameters.sampling.denominator,mapping.sampling[key]/mapping.sampling.denominator);
  assert.equal(parameters.sampling.stepNumerator/parameters.sampling.denominator*1010,mapping.sampling.stepNumerator/mapping.sampling.denominator*505);
  const {report}=deriveMeasuredFieldDensity2(input.raw,mapping);assert.deepEqual(report.crops,mapping.crops);assert.equal(report.sourceTransition.sourceCropChanged,false);
});

test('native bytes, base mapping and legacy derivation remain independent and exactly replayable',()=>{
  const {input,mapping,base,dense}=sample(),before=Buffer.from(input.raw),mappingSha=mapping.sha256,again=deriveMeasuredFieldDensity2(input.raw,mapping),oldAgain=deriveMeasuredField(input.raw,mapping);
  assert.deepEqual(input.raw,before);assert.equal(mapping.sha256,mappingSha);assert.equal(base.report.sha256,oldAgain.report.sha256);
  for(const [path,bytes]of base.files)assert.deepEqual(oldAgain.files.get(path),bytes);
  assert.equal(dense.report.sha256,again.report.sha256);for(const [path,bytes]of dense.files)assert.deepEqual(again.files.get(path),bytes);
  assert.equal(dense.report.profileSha256,MEASURED_FIELD_DENSITY2_SHA256);assert.equal(dense.report.baseProfileSha256,MEASURED_FIELD_SHA256);
  assert.equal(dense.report.surfaceMappingSha256,mapping.sha256);assert.equal(dense.report.generationCalls,0);assert.equal(dense.report.visualAcceptance,'not-assessed');
  assert(Object.isFrozen(MEASURED_FIELD_DENSITY2_PROFILE));assert.equal(MEASURED_FIELD_DENSITY2_PROFILE.gridCompatibility,'legacy-1x-phase-tiles-unchanged-not-a-2x-grid-tile-derivation');
  for(const artifact of dense.report.artifacts)assert.equal(hash(dense.files.get(artifact.path)),artifact.sha256);
});

test('wrong material, changed mapping and insufficient native density cannot silently create a dense field',()=>{
  const {input,mapping}=sample(),changed=Buffer.from(input.raw);changed[changed.length-1]^=1;
  rejects(()=>deriveMeasuredFieldDensity2(changed,mapping),'MEASURED_MATERIAL_IDENTITY');
  rejects(()=>deriveMeasuredFieldDensity2(input.raw,seal({...unseal(mapping),bodySampleHeight:250})),'MEASURED_MAPPING_PARAMETERS');
  const small=inputs({pair:{source:{fromX:0,toX:151},reference:{fromX:0,toX:102}}}),low=compileMeasuredSurfaceMapping({...small,material:small.raw});
  assert(value(low.nativePixelsPerFieldPixel)<2);rejects(()=>deriveMeasuredFieldDensity2(small.raw,low),'MEASURED_DENSITY_NATIVE_UPSCALE');
});

test('reference color changes update evidence without contributing pixels to either dense output PNG',()=>{
  const {input,mapping,dense}=sample(),ref=inspectPng(input.reference,{includePixels:true});
  for(let p=0;p<ref.rgba.length;p+=4)ref.rgba[p+1]=255-ref.rgba[p+1];
  const reference=encodeRgbaPng(ref.width,ref.height,ref.rgba),target=seal({...unseal(input.target),rawSha256:hash(reference)}),other=compileMeasuredSurfaceMapping({...input,reference,target,material:input.raw}),result=deriveMeasuredFieldDensity2(input.raw,other);
  assert.notEqual(other.sha256,mapping.sha256);assert.notEqual(result.report.sha256,dense.report.sha256);
  for(const path of ['materials/body-field.png','materials/cap-field.png'])assert.deepEqual(result.files.get(path),dense.files.get(path));
  assert.equal(result.report.sourceTransition.referencePixelsCopied,0);
});
