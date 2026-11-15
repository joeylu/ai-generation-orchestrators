import {inspectPng,encodeRgbaPng} from './png.mjs';
import {check,exact,hash,isDigest,jsonBytes,seal,unseal,deepFreeze} from './generation/common.mjs';

export const SOURCE_ALPHA_REVIEW_PROFILE='continuous-alpha-fixed-surrounds-v1';
export const SOURCE_ALPHA_REVIEW_BACKGROUNDS=deepFreeze([
 {id:'white',kind:'solid',rgb:[255,255,255]},
 {id:'dark',kind:'solid',rgb:[32,36,42]},
 {id:'checker',kind:'checker',cellPixels:16,lightRgb:[232,232,232],darkRgb:[176,176,176],origin:{x:0,y:0}}
]);
const bounds=()=>({left:Infinity,top:Infinity,right:0,bottom:0});
const include=(b,x,y)=>{b.left=Math.min(b.left,x);b.top=Math.min(b.top,y);b.right=Math.max(b.right,x+1);b.bottom=Math.max(b.bottom,y+1);};
const box=b=>Number.isFinite(b.left)?{x:b.left,y:b.top,width:b.right-b.left,height:b.bottom-b.top}:null;

// Diagnostic rasterization only. It never returns a changed source, an alpha
// mask, a generation decision or a replacement QA result.
export function createSourceAlphaReview(raw,options={}){
 exact(options,Object.hasOwn(options,'generationResult')?['generationResult']:[]);
 check(raw instanceof Uint8Array&&raw.length>0&&raw.length<=16777216,'SOURCE_ALPHA_REVIEW_BYTES');
 const bytes=Buffer.from(raw),rawSha256=hash(bytes);let png;
 try{png=inspectPng(bytes,{includePixels:true,allowCabx:true,allowHiddenRgb:true});}catch{check(false,'SOURCE_ALPHA_REVIEW_PNG');}
 let binding={kind:'explicit-png-unbound',technicalStatus:'not-supplied'};
 if(Object.hasOwn(options,'generationResult')){
  const result=options.generationResult;unseal(result);const technical=result.technical;unseal(technical);
  check(result.format==='ai_scene_generation_result_v1'&&isDigest(result.planSha256)
   &&result.rawSha256===rawSha256&&result.byteLength===bytes.length&&['pass','fail'].includes(technical.status),'SOURCE_ALPHA_REVIEW_RESULT_BINDING');
  check(!technical.rawSha256||technical.rawSha256===rawSha256,'SOURCE_ALPHA_REVIEW_QA_BINDING');
  check(!technical.image||technical.image.sha256===rawSha256&&technical.image.byteLength===bytes.length
   &&technical.image.pixelSize.width===png.width&&technical.image.pixelSize.height===png.height,'SOURCE_ALPHA_REVIEW_QA_BINDING');
  binding={kind:'sealed-generation-result',planSha256:result.planSha256,resultSha256:result.sha256,
   technicalSha256:technical.sha256,technicalStatus:technical.status,originalTechnicalVerdictTransferred:false};
 }
 const count=png.width*png.height,alpha=Buffer.alloc(count),histogram={zero:0,weak1to7:0,soft8to127:0,soft128to254:0,opaque255:0},b1=bounds(),b8=bounds();
 let hiddenRgbPixels=0;
 for(let i=0;i<count;i++){
  const offset=i*4,a=png.rgba[offset+3],x=i%png.width,y=Math.floor(i/png.width);alpha[i]=a;
  if(a===0){histogram.zero++;if(png.rgba[offset]||png.rgba[offset+1]||png.rgba[offset+2])hiddenRgbPixels++;}
  else{include(b1,x,y);if(a<8)histogram.weak1to7++;else if(a<128)histogram.soft8to127++;else if(a<255)histogram.soft128to254++;else histogram.opaque255++;if(a>=8)include(b8,x,y);}
 }
 const files=new Map(),previews=[];
 for(const background of SOURCE_ALPHA_REVIEW_BACKGROUNDS){
  const rgba=Buffer.alloc(png.rgba.length);
  for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++){
   const offset=(y*png.width+x)*4,a=png.rgba[offset+3],bg=background.kind==='solid'?background.rgb
    :(Math.floor(x/background.cellPixels)+Math.floor(y/background.cellPixels))%2?background.darkRgb:background.lightRgb;
   for(let c=0;c<3;c++)rgba[offset+c]=Math.round((png.rgba[offset+c]*a+bg[c]*(255-a))/255);
   rgba[offset+3]=255;
  }
  const image=encodeRgbaPng(png.width,png.height,rgba),path=background.id+'.png';files.set(path,image);
  previews.push({path,sha256:hash(image),byteLength:image.length,pixelSize:{width:png.width,height:png.height},background:structuredClone(background),outputAlpha:255});
 }
 check(hash(raw)===rawSha256,'SOURCE_ALPHA_REVIEW_SOURCE_CHANGED');
 const report=seal({format:'ai_scene_source_alpha_review_v1',profile:SOURCE_ALPHA_REVIEW_PROFILE,sourceBinding:binding,
  input:{rawSha256,byteLength:bytes.length,pixelSize:{width:png.width,height:png.height},rgbaSha256:hash(png.rgba),alphaSha256:hash(alpha)},
  statistics:{pixelCount:count,alphaHistogram:histogram,zeroAlphaHiddenRgbPixels:hiddenRgbPixels,nonzeroAlphaPixels:count-histogram.zero,
   boundsAlphaAtLeast1:box(b1),boundsAlphaAtLeast8:box(b8)},
  rendering:{operation:'opaque-diagnostic-source-over-original-continuous-alpha',colorChannels:'unpremultiplied-encoded-RGB-byte-channels',
   channelFormula:'round((source*alpha+background*(255-alpha))/255)',sourcePixelSampling:'one-to-one-native-no-scale-no-crop',
   zeroAlphaRgbContributes:false,alphaThresholdApplied:false,outputAlpha:255},previews,
  originalPngModified:false,originalRgbaModified:false,originalAlphaModified:false,originalQaModified:false,
  sourceArtAcceptance:'not-granted',technicalReclassification:false,previewIsAuthoritativeSource:false,
  generationCalls:0,automaticRetry:false,limits:{maximumInputBytes:16777216,maximumDimension:4096},
  meaning:'These opaque diagnostic views composite every original continuous Alpha sample. Hidden RGB at Alpha zero is invisible; nonzero-Alpha color remains visible. No source cleanup, recoloring, mask repair or QA acceptance is performed.'});
 files.set('source-alpha-review.json',jsonBytes(report));
 return {files,report};
}
