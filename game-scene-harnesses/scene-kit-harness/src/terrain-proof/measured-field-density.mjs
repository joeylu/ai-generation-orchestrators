import {inspectPng,encodeRgbaPng} from '../png.mjs';
import {check,clone,deepFreeze,digest,hash,jsonBytes,seal} from '../generation/common.mjs';
import {validateMeasuredSurfaceMapping,MEASURED_FIELD_SHA256} from './measured-field.mjs';
import {resampleJoinedField} from './joined-field.mjs';
import {periodize,raster} from './raster.mjs';

// This density profile only changes the number of samples within the SAME
// physical material windows. It is not a new source, sharpening or a terrain
// edge blending policy. Legacy measured-field output remains independently
// replayable and is never resized to produce these fields.
export const MEASURED_FIELD_DENSITY2_PROFILE=deepFreeze({
  format:'ai_scene_measured_field_density_profile_v1',profile:'sideview-observed-source-field-density2-v1',
  baseProfileSha256:MEASURED_FIELD_SHA256,density:2,
  field:{width:1010,height:506,capHeight:'twice-base-measured-cap-height',blend:8},
  logicalPeriod:{width:512,height:256},source:'exact-bound-opaque-native-material-only',
  physicalCrop:'identical-to-base-measured-mapping-v1',
  resample:'direct-native-uniform-rational-area-box-round-half-up-v1',nativeUpscale:false,
  bodyFill:'double-base-sampled-row-window-then-periodic-fill-same-physical-repeat-boundary',
  periodicCollar:'horizontal-symmetric-eight-pixels-body-bottom-only-eight-pixels-preserve-body-head-v1',
  transition:{overlapFieldPixels:2,alphaFadeRows:0,capAlpha:255,
    capMapping:'world-x-512-v1',bodyMapping:'surface-vertical-depth-with-source-origin-v1',
    sourceOriginNormalizationHeight:506,capDepth:'unchanged-base-world-depth',capUvEnd:'unchanged-base-normalized-uv-end'},
  gridCompatibility:'legacy-1x-phase-tiles-unchanged-not-a-2x-grid-tile-derivation',
  color:'native-area-samples-and-declared-periodic-collar-only-no-grading-or-sharpening',
  artSeams:'not-repaired-or-certified',referencePixelsCopied:0,generationCalls:0,productionKit:false,visualAcceptance:'not-assessed',
});
export const MEASURED_FIELD_DENSITY2_SHA256=digest(MEASURED_FIELD_DENSITY2_PROFILE);
const gcd=(a,b)=>b?gcd(b,a%b):a;
const fraction=(numerator,denominator)=>{
  check(Number.isSafeInteger(numerator)&&Number.isSafeInteger(denominator)&&denominator>0,'MEASURED_DENSITY_RATIONAL');
  const g=gcd(Math.abs(numerator),denominator);return {numerator:numerator/g,denominator:denominator/g};
};

export function measuredFieldDensity2Parameters(mapping){
  validateMeasuredSurfaceMapping(mapping);
  const base=mapping.sampling,sampling={xNumerator:base.xNumerator*2,bodyYNumerator:base.bodyYNumerator*2,
    capYNumerator:base.capYNumerator*2,stepNumerator:base.stepNumerator,denominator:base.denominator*2};
  check(Object.values(sampling).every(Number.isSafeInteger),'MEASURED_DENSITY_RATIONAL');
  check(sampling.stepNumerator>=sampling.denominator,'MEASURED_DENSITY_NATIVE_UPSCALE',
    'The native source cannot provide this density at the existing physical material scale');
  return deepFreeze({density:2,field:{width:1010,height:506,capHeight:mapping.field.capHeight*2},
    nativePixelsPerFieldPixel:fraction(mapping.nativePixelsPerFieldPixel.numerator,mapping.nativePixelsPerFieldPixel.denominator*2),
    sampling,bodySampleHeight:mapping.bodySampleHeight*2,
    bodyRepeatRanges:mapping.bodyRepeatRanges.map(row=>({targetStartRow:row.targetStartRow*2,targetEndRowExclusive:row.targetEndRowExclusive*2,
      sourceStartRow:row.sourceStartRow*2,sourceEndRowExclusive:row.sourceEndRowExclusive*2})),
    surfaceOriginInBodyPixels:fraction(mapping.surfaceOriginInBodyPixels.numerator*2,mapping.surfaceOriginInBodyPixels.denominator),
    sourceOriginNormalizationHeight:506,capDepth:clone(mapping.capDepth),capUvEnd:clone(mapping.capUvEnd),
    crops:clone(mapping.crops),logicalPeriod:{width:512,height:256}});
}

function periodizeDenseBody(source){
  const result=periodize(source,8,false),band=8;
  for(let d=0;d<band;d++)for(let x=0;x<result.width;x++){
    const p=((result.height-1-d)*result.width+x)*4,donor=(d*result.width+x)*4;
    for(let c=0;c<3;c++)result.rgba[p+c]=Math.floor((result.rgba[p+c]*d+result.rgba[donor+c]*(band-d)+band/2)/band);
  }
  return result;
}

export function deriveMeasuredFieldDensity2(raw,mapping){
  const parameters=measuredFieldDensity2Parameters(mapping);
  check(raw instanceof Uint8Array&&raw.length>0&&raw.length<=16777216,'IMAGE_BYTES');
  check(hash(raw)===mapping.material.sha256&&raw.length===mapping.material.byteLength,'MEASURED_MATERIAL_IDENTITY');
  const source=inspectPng(Buffer.from(raw),{includePixels:true,pixelStats:true,allowCabx:true});
  check(source.width===mapping.material.pixelSize.width&&source.height===mapping.material.pixelSize.height
    &&source.transparentPixels===0&&source.varied,'MEASURED_MATERIAL_IDENTITY');
  const {sampling,field,bodySampleHeight}=parameters;
  const sampledBody=resampleJoinedField(source,sampling,field.width,bodySampleHeight,sampling.bodyYNumerator),repeated=raster(field.width,field.height);
  for(let y=0;y<field.height;y++){
    const sy=y%sampledBody.height;
    repeated.rgba.set(sampledBody.rgba.subarray(sy*field.width*4,(sy+1)*field.width*4),y*field.width*4);
  }
  const body=periodizeDenseBody(repeated),cap=periodize(resampleJoinedField(source,sampling,field.width,field.capHeight,sampling.capYNumerator),8,false);
  const files=new Map(),artifacts=[];
  for(const [kind,image]of [['body',body],['cap',cap]]){
    const path=`materials/${kind}-field.png`,bytes=encodeRgbaPng(image.width,image.height,image.rgba);files.set(path,bytes);
    artifacts.push({path,sha256:hash(bytes),pixelSha256:hash(image.rgba),byteLength:bytes.length,pixelSize:{width:image.width,height:image.height}});
  }
  const report=seal({format:'ai_scene_measured_field_density_derivation_v1',profile:MEASURED_FIELD_DENSITY2_PROFILE,
    profileSha256:MEASURED_FIELD_DENSITY2_SHA256,baseProfileSha256:MEASURED_FIELD_SHA256,
    source:clone(mapping.material),surfaceMappingSha256:mapping.sha256,referenceSha256:mapping.reference.sha256,targetSha256:mapping.targetSha256,
    ...parameters,baseField:clone(mapping.field),baseBodySampleHeight:mapping.bodySampleHeight,
    bodyFill:'periodic-source-rows-no-rescale',directNativeSampling:true,resizedLegacyField:false,
    sourceTransition:{origin:'same-explicit-contiguous-source-paint',sourceSurfaceTopY:mapping.observations.sourceSurfaceTopY,
      sourceBodyStartY:mapping.observations.sourceBodyStartY,overlapFieldPixels:2,alphaFadeRows:0,capOpaque:true,
      sourcePngModified:false,sourceCropChanged:false,physicalMaterialScaleChanged:false,colorGrading:false,sharpening:false,referencePixelsCopied:0},
    gridCompatibility:'legacy-1x-phase-tiles-preserved-separately',artSeams:'not-repaired-or-certified',artifacts,
    productionKit:false,visualAcceptance:'not-assessed',generationCalls:0});
  files.set('density-profile.json',jsonBytes(MEASURED_FIELD_DENSITY2_PROFILE));files.set('surface-mapping-base.json',jsonBytes(mapping));
  files.set('density-derivation.json',jsonBytes(report));return {files,report};
}
