import {inspectPng,encodeRgbaPng} from './png.mjs';
import {canonicalJson,deepFreeze} from './document.mjs';
import {check,exact,hash,seal,unseal} from './generation/common.mjs';

export const TERRAIN_RIGID_REPEAT_PROFILE='rigid-source-row-repeat-v1';
export const TERRAIN_RIGID_REPEAT_LIMITS=deepFreeze({maximumSourceDimension:2048,
  maximumOutputPixels:4194304,maximumPngBytes:16777216,minimumRows:2});
const ALGORITHM='axis-aligned-full-width-half-open-row-copy-v1';
const pathSafe=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._/-]*\.png$/.test(value)
  &&value.split('/').every(part=>part&&part!=='.'&&part!=='..');
const digest=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const gcd=(a,b)=>b?gcd(b,a%b):a;
const rational=(numerator,denominator)=>{const g=gcd(numerator,denominator);return {numerator:numerator/g,denominator:denominator/g};};
function sourceShape(source){
  exact(source,['path','sha256','byteLength']);
  check(pathSafe(source.path)&&digest(source.sha256)&&integer(source.byteLength,1,TERRAIN_RIGID_REPEAT_LIMITS.maximumPngBytes),
    'RIGID_REPEAT_SOURCE');
}

// This crop selects whole source rows without changing a single retained RGBA
// sample. The period and its world origin keep the old field's physical sample
// scale and phase; callers must use one shared affine map across all owners.
export function buildTerrainRigidRepeat(inputPNG,options){
  exact(options,['source','outputPath','fromRow','toRow']);
  const {source,outputPath,fromRow,toRow}=options,L=TERRAIN_RIGID_REPEAT_LIMITS;sourceShape(source);
  check(pathSafe(outputPath)&&outputPath.toLowerCase()!==source.path.toLowerCase(),'RIGID_REPEAT_OUTPUT_PATH');
  check(inputPNG instanceof Uint8Array&&inputPNG.byteLength===source.byteLength&&hash(inputPNG)===source.sha256,
    'RIGID_REPEAT_SOURCE');
  let image;
  try{image=inspectPng(Buffer.from(inputPNG),{includePixels:true,pixelStats:true});}
  catch{check(false,'RIGID_REPEAT_SOURCE_IMAGE');}
  check(integer(image.width,1,L.maximumSourceDimension)&&integer(image.height,L.minimumRows,L.maximumSourceDimension)
    &&image.transparentPixels===0,'RIGID_REPEAT_SOURCE_IMAGE');
  check(integer(fromRow,0,image.height-L.minimumRows)&&integer(toRow,fromRow+L.minimumRows,image.height),
    'RIGID_REPEAT_OPTIONS');
  const height=toRow-fromRow,width=image.width;
  check(width*height<=L.maximumOutputPixels,'RIGID_REPEAT_BUDGET');
  const rgba=Buffer.from(image.rgba.subarray(fromRow*width*4,toRow*width*4));
  const png=encodeRgbaPng(width,height,rgba);check(png.length<=L.maximumPngBytes,'RIGID_REPEAT_BUDGET');
  const record=seal({format:'ai_scene_terrain_rigid_repeat_v1',profile:TERRAIN_RIGID_REPEAT_PROFILE,
    sourceInput:{...source,pixelSize:{width,height:image.height}},options:{fromRow,toRow},algorithm:ALGORITHM,
    output:{source:{path:outputPath,sha256:hash(png),byteLength:png.length},pixelSize:{width,height}},
    bodyPeriod:{width:rational(512,1),height:rational(height*256,image.height)},
    phaseOriginWorldY:rational(fromRow*256,image.height),
    sourceDensity:{normalizationHeight:image.height,worldWidth:512,worldHeight:256},
    limits:L,work:{inputPixels:width*image.height,outputPixels:width*height,rowsCopied:height},
    sourcePngChanged:false,sourceAlphaChanged:false,pixelsRecolored:false,pixelsBlended:false,
    sourceCoordinatesWarped:false,sourcePixelSelectionOnly:true,xPhaseShiftPixels:0,
    generationCalls:0,visualAcceptance:'not-assessed'});
  return {record,png};
}

export function validateTerrainRigidRepeat(record,{appearance,readAsset}={}){
  unseal(record);
  exact(record,['format','profile','sourceInput','options','algorithm','output','bodyPeriod','phaseOriginWorldY',
    'sourceDensity','limits','work','sourcePngChanged','sourceAlphaChanged','pixelsRecolored','pixelsBlended',
    'sourceCoordinatesWarped','sourcePixelSelectionOnly','xPhaseShiftPixels','generationCalls','visualAcceptance','sha256']);
  check(record.format==='ai_scene_terrain_rigid_repeat_v1'&&record.profile===TERRAIN_RIGID_REPEAT_PROFILE
    &&record.algorithm===ALGORITHM&&record.sourcePngChanged===false&&record.sourceAlphaChanged===false
    &&record.pixelsRecolored===false&&record.pixelsBlended===false&&record.sourceCoordinatesWarped===false
    &&record.sourcePixelSelectionOnly===true&&record.xPhaseShiftPixels===0&&record.generationCalls===0
    &&record.visualAcceptance==='not-assessed','RIGID_REPEAT_PROFILE');
  const source=record.sourceInput;exact(source,['path','sha256','byteLength','pixelSize']);
  const {pixelSize,...ref}=source;sourceShape(ref);
  check(appearance?.format==='ai_scene_continuous_terrain_appearance_v6'
    &&canonicalJson(ref)===canonicalJson(appearance.body?.source)
    &&canonicalJson(pixelSize)===canonicalJson(appearance.body?.pixelSize),'RIGID_REPEAT_BINDING');
  exact(record.options,['fromRow','toRow']);exact(record.output,['source','pixelSize']);sourceShape(record.output.source);
  check(typeof readAsset==='function','RIGID_REPEAT_READ_ASSET');
  const original=readAsset(source.path);check(original instanceof Uint8Array,'RIGID_REPEAT_SOURCE');
  const replay=buildTerrainRigidRepeat(original,{source:ref,outputPath:record.output.source.path,...record.options});
  check(canonicalJson(replay.record)===canonicalJson(record),'RIGID_REPEAT_REPLAY');
  const actual=readAsset(record.output.source.path);
  check(actual instanceof Uint8Array&&Buffer.from(actual).equals(replay.png),'RIGID_REPEAT_OUTPUT_REPLAY');
  return record;
}
