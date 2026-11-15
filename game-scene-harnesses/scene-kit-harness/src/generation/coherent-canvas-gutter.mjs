import {inspectPng,encodeRgbaPng} from '../png.mjs';
import {assertCurrent} from './compiler.mjs';
import {assessCoherentSource} from './coherent-source.mjs';
import {check,digest,exact,hash,id,isDigest,receipt as validateReceipt,seal,unseal} from './common.mjs';

export const COHERENT_CANVAS_GUTTER_FORMAT='ai_scene_coherent_canvas_gutter_preparation_v1';
export const COHERENT_CANVAS_GUTTER_V2_FORMAT='ai_scene_coherent_canvas_gutter_preparation_v2';
export const COHERENT_CANVAS_GUTTER_V2_PROFILE='low-alpha-margin-v2';
const MAX_BYTES=16777216;
const rule={profile:'coherent-transparent-canvas-gutter-v1',gutter:{numerator:12,denominator:100},
  paddingFormula:'ceil-original-axis-size-times-12-divided-by-76',
  pixelOperation:'copy-entire-original-rgba-at-integer-offset-add-zero-rgba-canvas',
  contentBoundsAlphaThreshold:1,sourceRawPreserved:true,maximumSizePolicy:'original-source-policy',maximumPngBytes:MAX_BYTES,
  newImageCalls:0,artAcceptance:'not-granted',hiddenGeometry:'not-recovered'};

const lowAlphaRule={...rule,profile:COHERENT_CANVAS_GUTTER_V2_PROFILE,eligibleIssue:'COHERENT_CLIPPED_SILHOUETTE',
  originalBorderWidth:2,maximumOriginalBorderAlpha:7,bodyAlphaThreshold:8,minimumBodyMargin:2};

// No implicit fallback: historical callers keep the original v1 qualification and bytes.
export function coherentCanvasGutterOptions(proposal){
  check(['ai_scene_coherent_canvas_gutter_proposal_v1','ai_scene_coherent_canvas_gutter_proposal_v2'].includes(proposal?.format),'COHERENT_CANVAS_GUTTER_PROFILE');
  return proposal.format==='ai_scene_coherent_canvas_gutter_proposal_v2'?{profile:COHERENT_CANVAS_GUTTER_V2_PROFILE}:{};
}
function isV2(options){
  exact(options,options&&Object.hasOwn(options,'profile')?['profile']:[]);
  check(!Object.hasOwn(options,'profile')||options.profile===COHERENT_CANVAS_GUTTER_V2_PROFILE,'COHERENT_CANVAS_GUTTER_PROFILE');
  return options.profile===COHERENT_CANVAS_GUTTER_V2_PROFILE;
}
function alphaBounds(image,threshold=1){
  let x0=image.width,y0=image.height,x1=-1,y1=-1;
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++)if(image.rgba[(y*image.width+x)*4+3]>=threshold){
    x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);
  }
  check(x1>=x0&&y1>=y0,'COHERENT_CANVAS_GUTTER_EMPTY');
  return {x:x0,y:y0,width:x1-x0+1,height:y1-y0+1};
}
const margins=(image,bounds)=>({left:bounds.x,top:bounds.y,right:image.width-bounds.x-bounds.width,bottom:image.height-bounds.y-bounds.height});
const sufficient=(size,padding)=>padding.left*100>=size.width*12&&padding.right*100>=size.width*12
  &&padding.top*100>=size.height*12&&padding.bottom*100>=size.height*12;

// These are opaque diagnostic pictures, never the source or prepared artwork.
// Composite before averaging: alpha-zero hidden RGB cannot become blue haze.
function checkerPreview(image,divisor){
  const width=Math.ceil(image.width/divisor),height=Math.ceil(image.height/divisor),rgba=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const sums=[0,0,0];let count=0;
    for(let sy=y*divisor;sy<Math.min((y+1)*divisor,image.height);sy++)for(let sx=x*divisor;sx<Math.min((x+1)*divisor,image.width);sx++){
      const p=(sy*image.width+sx)*4,a=image.rgba[p+3],background=(Math.floor(sx/16)+Math.floor(sy/16))%2?190:226;
      for(let c=0;c<3;c++)sums[c]+=Math.floor((image.rgba[p+c]*a+background*(255-a)+127)/255);
      count++;
    }
    const p=(y*width+x)*4;for(let c=0;c<3;c++)rgba[p+c]=Math.floor((sums[c]+Math.floor(count/2))/count);rgba[p+3]=255;
  }
  return encodeRgbaPng(width,height,rgba);
}

function sourceFrame(store,state,sourcePlanSha256,parentBatchSha256,v2){
  check(isDigest(sourcePlanSha256)&&isDigest(parentBatchSha256),'COHERENT_CANVAS_GUTTER_BINDING');
  const source=state.plans.get(sourcePlanSha256),batch=state.batches.get(parentBatchSha256);
  check(source?.plan.format==='ai_scene_generation_plan_v27'&&source.plan.target.alpha==='transparent'
    &&(v2?source.status==='rejected-technical'&&source.result?.technical.status==='fail'
      :['pending-visual-review','accepted'].includes(source.status)&&source.result?.technical.status==='pass'),'COHERENT_CANVAS_GUTTER_SOURCE');
  check(['ai_scene_coherent_source_batch_v1','ai_scene_coherent_source_batch_v2','ai_scene_coherent_source_batch_v3'].includes(batch?.format)
    &&batch.planSha256s.includes(sourcePlanSha256)&&batch.referencePlanSha256===source.plan.recipe.referencePlans[0]
    &&batch.targetSha256===source.plan.recipe.targetSha256,'COHERENT_CANVAS_GUTTER_BATCH');
  // The writer gates new preparations against the latest batch. This pure
  // producer must also reproduce a historical reviewed packet after adoption.
  assertCurrent(state,source.plan);
  const raw=store.readBlob(source.result.rawSha256);
  check(raw instanceof Uint8Array&&raw.length>0&&raw.length<=MAX_BYTES&&hash(raw)===source.result.rawSha256,'COHERENT_CANVAS_GUTTER_RAW');
  const qa=assessCoherentSource(source.plan,raw);
  check(digest(qa)===digest(source.result.technical)&&(v2?qa.status==='fail'&&qa.issues.length===1&&qa.issues[0]===lowAlphaRule.eligibleIssue
    :qa.status==='pass'),'COHERENT_CANVAS_GUTTER_SOURCE_QA');
  const png=inspectPng(raw,{includePixels:true,pixelStats:true,allowCabx:true,allowHiddenRgb:true});
  let lowAlphaEvidence;
  if(v2){
    let maximumAlpha=0,nonzeroPixels=0;
    for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++)if(x<2||y<2||x>=png.width-2||y>=png.height-2){
      const a=png.rgba[(y*png.width+x)*4+3];maximumAlpha=Math.max(maximumAlpha,a);if(a)nonzeroPixels++;
    }
    check(maximumAlpha>1&&maximumAlpha<=lowAlphaRule.maximumOriginalBorderAlpha&&maximumAlpha===qa.edgeMaximumAlpha,'COHERENT_CANVAS_GUTTER_EDGE');
    const bodyBounds=alphaBounds(png,lowAlphaRule.bodyAlphaThreshold),bodyMargins=margins(png,bodyBounds);
    check(Math.min(...Object.values(bodyMargins))>=lowAlphaRule.minimumBodyMargin,'COHERENT_CANVAS_GUTTER_BODY_MARGIN');
    lowAlphaEvidence={originalBorder:{maximumAlpha,nonzeroPixels,width:2},bodyBounds,bodyMargins};
  }
  const originalContentBounds=alphaBounds(png),originalPaddingPixels=margins(png,originalContentBounds);
  check(!sufficient(png,originalPaddingPixels),'COHERENT_CANVAS_GUTTER_ALREADY_SATISFIED');
  const x=Math.ceil(png.width*12/76),y=Math.ceil(png.height*12/76),width=png.width+2*x,height=png.height+2*y,policy=source.plan.target.sourcePolicy;
  check(Number.isSafeInteger(policy.maximumWidth)&&Number.isSafeInteger(policy.maximumHeight)
    &&policy.maximumWidth>0&&policy.maximumHeight>0&&policy.maximumWidth<=4096&&policy.maximumHeight<=4096
    &&width<=policy.maximumWidth&&height<=policy.maximumHeight,'COHERENT_CANVAS_GUTTER_SIZE');
  const rgba=Buffer.alloc(width*height*4);
  for(let row=0;row<png.height;row++)png.rgba.copy(rgba,((row+y)*width+x)*4,row*png.width*4,(row+1)*png.width*4);
  const bytes=encodeRgbaPng(width,height,rgba);
  check(bytes.length<=MAX_BYTES,'COHERENT_CANVAS_GUTTER_BYTES');
  const paddedImage={width,height,rgba},paddedContentBounds={...originalContentBounds,x:originalContentBounds.x+x,y:originalContentBounds.y+y};
  const paddedPaddingPixels=margins(paddedImage,paddedContentBounds);
  check(sufficient(paddedImage,paddedPaddingPixels),'COHERENT_CANVAS_GUTTER_DERIVED_PADDING');
  const technical=assessCoherentSource(source.plan,bytes);check(technical.status==='pass','COHERENT_CANVAS_GUTTER_DERIVED_QA');
  const pixelDivisor=Math.max(1,Math.ceil(Math.max(width,height)/1024));
  const previews={original:checkerPreview(png,pixelDivisor),padded:checkerPreview(paddedImage,pixelDivisor)};
  return {source,raw,png,bytes,rgba,width,height,x,y,technical,originalContentBounds,originalPaddingPixels,paddedContentBounds,paddedPaddingPixels,previews,pixelDivisor,lowAlphaEvidence};
}

// Read-only proposal. All old pixel bytes are retained, but an operator must
// still inspect the original silhouette and accept this exact canvas change.
export function compileCoherentCanvasGutterProposal(store,state,sourcePlanSha256,parentBatchSha256,options={}){
  const v2=isV2(options),version=v2?'v2':'v1',f=sourceFrame(store,state,sourcePlanSha256,parentBatchSha256,v2);
  const proposal=seal({format:'ai_scene_coherent_canvas_gutter_proposal_'+version,compiler:'scene-kit-coherent-canvas-gutter-'+version,parentBatchSha256,
    sourcePlanSha256,sourceResultSha256:f.source.result.sha256,originalTechnicalSha256:f.source.result.technical.sha256,
    originalRawSha256:hash(f.raw),originalRgbaSha256:hash(f.png.rgba),paddedRawSha256:hash(f.bytes),paddedRgbaSha256:hash(f.rgba),
    originalPixelSize:{width:f.png.width,height:f.png.height},paddedPixelSize:{width:f.width,height:f.height},contentOffset:{x:f.x,y:f.y},
    originalContentBounds:f.originalContentBounds,originalPaddingPixels:f.originalPaddingPixels,paddedContentBounds:f.paddedContentBounds,paddedPaddingPixels:f.paddedPaddingPixels,
    ...(v2?f.lowAlphaEvidence:{}),rule:v2?lowAlphaRule:rule,technical:f.technical,diagnosticPreviews:{originalSha256:hash(f.previews.original),paddedSha256:hash(f.previews.padded),pixelDivisor:f.pixelDivisor,compositing:'straight-alpha-over-checkerboard'},
    requiredHumanChecks:['Inspect the original PNG and correctly alpha-composited previews; the requested subject is complete and belongs to its own layer.',
      'Accept this exact transparent canvas expansion, offset and pixel dimensions. It copies every original RGBA value and does not recover clipped or hidden geometry.',
      'The original image, generation attempt and art decision remain unchanged. This approval is neither source-art acceptance nor authorization for image generation.'],
    originalPngModified:false,allOriginalRgbaPreserved:true,hiddenGeometry:'not-recovered',sourceArtAcceptance:'not-granted',maximumNewImageCalls:0});
  return {proposal,bytes:f.bytes,previews:f.previews};
}

export function compileCoherentCanvasGutterPreparation(store,state,options){
  exact(options,['preparationId','proposal','receipt']);id(options.preparationId);unseal(options.proposal);
  const {proposal,bytes}=compileCoherentCanvasGutterProposal(store,state,options.proposal.sourcePlanSha256,options.proposal.parentBatchSha256,coherentCanvasGutterOptions(options.proposal));
  check(digest(proposal)===digest(options.proposal),'COHERENT_CANVAS_GUTTER_PROPOSAL_CHANGED');
  validateReceipt(options.receipt,'review');
  check(options.receipt.decision==='accept'&&options.receipt.targetSha256===proposal.sha256,'COHERENT_CANVAS_GUTTER_APPROVAL');
  const source=state.plans.get(proposal.sourcePlanSha256),p=source.plan;
  const v2=proposal.format==='ai_scene_coherent_canvas_gutter_proposal_v2';
  const record=seal({format:v2?COHERENT_CANVAS_GUTTER_V2_FORMAT:COHERENT_CANVAS_GUTTER_FORMAT,compiler:v2?'scene-kit-coherent-canvas-gutter-v2':'scene-kit-coherent-canvas-gutter-v1',sourcePlanSha256:p.sha256,proposal,receipt:options.receipt,
    originalRawSha256:proposal.originalRawSha256,rawSha256:proposal.paddedRawSha256,originalTechnicalSha256:proposal.originalTechnicalSha256,technical:proposal.technical,
    recipe:{...p.recipe,planId:options.preparationId,parents:[p.sha256]},designReviews:p.designReviews,referenceEvidence:p.referenceEvidence,instanceBinding:p.instanceBinding,
    target:p.target,qualityPolicy:p.qualityPolicy,...(p.sourceScope?{sourceScope:p.sourceScope}:{}),visualReviewChecklist:p.visualReviewChecklist,
    request:{format:'ai_scene_no_generation_request_v1',maximumCalls:0},originalAttemptOutcome:source.status,originalPreserved:true,
    allOriginalRgbaPreserved:true,sourceArtAcceptance:'not-granted'});
  return {record,bytes};
}
