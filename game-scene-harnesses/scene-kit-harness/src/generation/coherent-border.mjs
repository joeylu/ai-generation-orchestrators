import {inspectPng,encodeRgbaPng} from '../png.mjs';
import {assertCurrent} from './compiler.mjs';
import {assessCoherentSource} from './coherent-source.mjs';
import {check,digest,exact,hash,id,receipt as validateReceipt,seal,unseal} from './common.mjs';

export const COHERENT_BORDER_FORMAT='ai_scene_coherent_border_preparation_v1';
export const COHERENT_PREPARED_BATCH_FORMAT='ai_scene_coherent_source_batch_v2';
const rule={profile:'coherent-low-alpha-canvas-border-v1',eligibleIssue:'COHERENT_CLIPPED_SILHOUETTE',
  originalBorderWidth:2,maximumOriginalBorderAlpha:3,bodyAlphaThreshold:16,minimumBodyMargin:4,paddingPixels:2,
  pixelOperation:'copy-all-original-rgba-at-offset-two-add-zero-rgba-border',sourceRawPreserved:true,
  maximumSizePolicy:'original-source-policy',newImageCalls:0,artAcceptance:'not-granted'};

function sourceFrame(store,state,sourcePlanSha256){
  const source=state.plans.get(sourcePlanSha256);
  check(source?.plan.format==='ai_scene_generation_plan_v27'&&source.plan.target.alpha==='transparent'
    &&source.status==='rejected-technical'&&source.result?.technical.status==='fail','COHERENT_BORDER_SOURCE');
  assertCurrent(state,source.plan);
  const raw=store.readBlob(source.result.rawSha256),qa=assessCoherentSource(source.plan,raw);
  check(digest(qa)===digest(source.result.technical)&&qa.issues.length===1&&qa.issues[0]===rule.eligibleIssue,
    'COHERENT_BORDER_SOURCE_QA');
  const png=inspectPng(raw,{includePixels:true,pixelStats:true,allowCabx:true,allowHiddenRgb:true});
  let edgeMaximumAlpha=0,edgeNonzeroPixels=0,minX=png.width,minY=png.height,maxX=-1,maxY=-1;
  for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++){
    const a=png.rgba[(y*png.width+x)*4+3];
    if(x<2||y<2||x>=png.width-2||y>=png.height-2){edgeMaximumAlpha=Math.max(edgeMaximumAlpha,a);if(a)edgeNonzeroPixels++;}
    if(a>=rule.bodyAlphaThreshold){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
  }
  check(edgeMaximumAlpha>1&&edgeMaximumAlpha<=rule.maximumOriginalBorderAlpha&&edgeMaximumAlpha===qa.edgeMaximumAlpha,
    'COHERENT_BORDER_EDGE');
  check(maxX>=minX&&Math.min(minX,minY,png.width-1-maxX,png.height-1-maxY)>=rule.minimumBodyMargin,
    'COHERENT_BORDER_BODY_MARGIN');
  const width=png.width+4,height=png.height+4,policy=source.plan.target.sourcePolicy;
  check(width<=policy.maximumWidth&&height<=policy.maximumHeight,'COHERENT_BORDER_SIZE');
  const rgba=Buffer.alloc(width*height*4);
  for(let y=0;y<png.height;y++)png.rgba.copy(rgba,((y+2)*width+2)*4,y*png.width*4,(y+1)*png.width*4);
  const bytes=encodeRgbaPng(width,height,rgba),technical=assessCoherentSource(source.plan,bytes);
  check(technical.status==='pass','COHERENT_BORDER_DERIVED_QA');
  return {source,raw,png,bytes,rgba,technical,width,height,edgeMaximumAlpha,edgeNonzeroPixels,
    bodyBounds:{x:minX,y:minY,width:maxX-minX+1,height:maxY-minY+1},
    bodyMargins:{left:minX,top:minY,right:png.width-1-maxX,bottom:png.height-1-maxY}};
}

// A proposal is deterministic read-only evidence. It never changes the failed
// source, spends image compute or certifies that hidden geometry is complete.
export function compileCoherentBorderProposal(store,state,sourcePlanSha256){
  const f=sourceFrame(store,state,sourcePlanSha256);
  const proposal=seal({format:'ai_scene_coherent_border_proposal_v1',compiler:'scene-kit-coherent-border-v1',
    sourcePlanSha256,sourceResultSha256:f.source.result.sha256,originalTechnicalSha256:f.source.result.technical.sha256,
    originalRawSha256:hash(f.raw),originalRgbaSha256:hash(f.png.rgba),paddedRawSha256:hash(f.bytes),paddedRgbaSha256:hash(f.rgba),
    originalPixelSize:{width:f.png.width,height:f.png.height},paddedPixelSize:{width:f.width,height:f.height},
    originalBorder:{maximumAlpha:f.edgeMaximumAlpha,nonzeroPixels:f.edgeNonzeroPixels,width:2},
    bodyBounds:f.bodyBounds,bodyMargins:f.bodyMargins,rule,technical:f.technical,
    originalPngModified:false,allOriginalRgbaPreserved:true,hiddenGeometry:'not-recovered',sourceArtAcceptance:'not-granted',maximumNewImageCalls:0});
  return {proposal,bytes:f.bytes};
}

export function compileCoherentBorderPreparation(store,state,options){
  exact(options,['preparationId','proposal','receipt']);id(options.preparationId);unseal(options.proposal);
  const {proposal,bytes}=compileCoherentBorderProposal(store,state,options.proposal.sourcePlanSha256);
  check(digest(proposal)===digest(options.proposal),'COHERENT_BORDER_PROPOSAL_CHANGED');
  validateReceipt(options.receipt,'review');
  check(options.receipt.decision==='accept'&&options.receipt.targetSha256===proposal.sha256,'COHERENT_BORDER_APPROVAL');
  const source=state.plans.get(proposal.sourcePlanSha256),p=source.plan;
  const record=seal({format:COHERENT_BORDER_FORMAT,compiler:'scene-kit-coherent-border-v1',
    sourcePlanSha256:p.sha256,proposal,receipt:options.receipt,
    originalRawSha256:proposal.originalRawSha256,rawSha256:proposal.paddedRawSha256,
    originalTechnicalSha256:proposal.originalTechnicalSha256,technical:proposal.technical,
    recipe:{...p.recipe,planId:options.preparationId,parents:[p.sha256]},designReviews:p.designReviews,
    referenceEvidence:p.referenceEvidence,instanceBinding:p.instanceBinding,target:p.target,
    qualityPolicy:p.qualityPolicy,...(p.sourceScope?{sourceScope:p.sourceScope}:{}),visualReviewChecklist:p.visualReviewChecklist,
    request:{format:'ai_scene_no_generation_request_v1',maximumCalls:0},
    originalAttemptOutcome:'rejected-technical',originalPreserved:true,allOriginalRgbaPreserved:true,sourceArtAcceptance:'not-granted'});
  return {record,bytes};
}
