import {inspectPng,encodeRgbaPng} from '../png.mjs';
import {assertTerrainEdgeCurrent,assessTerrainEdgeSource,TERRAIN_EDGE_BATCH_FORMATS} from './terrain-edge-source.mjs';
import {check,digest,exact,hash,id,isDigest,receipt as validateReceipt,seal,unseal} from './common.mjs';

export const TERRAIN_EDGE_NATIVE_SIZE_FORMAT='ai_scene_terrain_edge_native_size_preparation_v1';
export const TERRAIN_EDGE_PREPARED_BATCH_FORMAT='ai_scene_terrain_edge_prepared_batch_v1';
export const TERRAIN_EDGE_NATIVE_SIZE_RULE=seal({profile:'native-terrain-edge-size-envelope-v1',nativeSizeProfile:'bounded-native-4m-v1',eligibleOriginalIssue:'OUTPUT_SIZE',
  requiredRenderEnvelopeProfile:'visible-alpha8-outward16-native-rgba-v1',
  renderEnvelope:{visibleAlphaThreshold:8,maximumVisibleOutwardWorld:16,sourceRgba:'retain-all-original-alpha1-through255-and-hidden-rgb',
    weakTailHandling:'render-geometry-clipping-only-never-source-alpha-editing',calibration:'pending-explicit-native-controls-and-render-tail-statistics'},
  eligibleOriginalPlans:['ai_scene_generation_plan_v33','ai_scene_generation_plan_v34'],maximumWidth:4096,maximumHeight:4096,
  maximumPixels:4194304,maximumPngBytes:16777216,pixelOperation:'identity-preserve-entire-original-png-and-rgba',
  minimumTransparentGutterPixels:1,originalPromptGutter:{numerator:12,denominator:100},
  adoptedGutterStandard:'complete-subject-with-real-transparent-gutter-on-each-side-review-exact-actual-margins',
  sourceRawPreserved:true,originalRequestAndFailedQaPreserved:true,newImageCalls:0,artAcceptance:'not-granted',hiddenGeometry:'not-recovered'});

function checkerPreview(image,divisor){
  const width=Math.ceil(image.width/divisor),height=Math.ceil(image.height/divisor),rgba=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const sums=[0,0,0];let count=0;
    for(let sy=y*divisor;sy<Math.min(image.height,(y+1)*divisor);sy++)for(let sx=x*divisor;sx<Math.min(image.width,(x+1)*divisor);sx++){
      const p=(sy*image.width+sx)*4,a=image.rgba[p+3],background=(Math.floor(sx/16)+Math.floor(sy/16))%2?190:226;
      for(let c=0;c<3;c++)sums[c]+=Math.floor((image.rgba[p+c]*a+background*(255-a)+127)/255);count++;
    }
    const p=(y*width+x)*4;for(let c=0;c<3;c++)rgba[p+c]=Math.floor((sums[c]+Math.floor(count/2))/count);rgba[p+3]=255;
  }return encodeRgbaPng(width,height,rgba);
}
function envelopeTechnical({sourcePlanSha256,parentBatchSha256,originalTechnical,originalSourcePolicy,edgeRole,surfaceFamily},raw){
  const R=TERRAIN_EDGE_NATIVE_SIZE_RULE;
  check(raw instanceof Uint8Array&&raw.length>0&&raw.length<=R.maximumPngBytes,'TERRAIN_EDGE_NATIVE_SIZE_BYTES');
  check(originalTechnical?.status==='fail'&&originalTechnical.issues.length===1&&originalTechnical.issues[0]===R.eligibleOriginalIssue
    &&originalTechnical.rawSha256===hash(raw),'TERRAIN_EDGE_NATIVE_SIZE_ORIGINAL_QA');
  const image=inspectPng(Buffer.from(raw),{includePixels:true,pixelStats:true,allowCabx:true,allowHiddenRgb:true});
  check(image.width<=R.maximumWidth&&image.height<=R.maximumHeight&&image.width*image.height<=R.maximumPixels
    &&image.width>=originalSourcePolicy.minimumWidth&&image.height>=originalSourcePolicy.minimumHeight
    &&(image.width>originalSourcePolicy.maximumWidth||image.height>originalSourcePolicy.maximumHeight),
  'TERRAIN_EDGE_NATIVE_SIZE_ENVELOPE');
  const bounds=originalTechnical.contentBounds;
  check(bounds&&Number.isSafeInteger(bounds.x)&&Number.isSafeInteger(bounds.y)&&bounds.width>0&&bounds.height>0,'TERRAIN_EDGE_NATIVE_SIZE_BOUNDS');
  const actualPaddingPixels={left:bounds.x,right:image.width-bounds.x-bounds.width,top:bounds.y,bottom:image.height-bounds.y-bounds.height},
    actualPaddingRatios=Object.fromEntries(Object.entries(actualPaddingPixels).map(([side,numerator])=>[side,{numerator,denominator:['left','right'].includes(side)?image.width:image.height}])),
    originalPromptGutterSatisfied=Object.entries(actualPaddingRatios).every(([,r])=>r.numerator*100>=r.denominator*12);
  check(Object.values(actualPaddingPixels).every(value=>Number.isSafeInteger(value)&&value>=R.minimumTransparentGutterPixels),
    'TERRAIN_EDGE_NATIVE_SIZE_GUTTER');
  return {image,technical:seal({format:'ai_scene_terrain_edge_native_size_qa_v1',policySha256:R.sha256,sourcePlanSha256,parentBatchSha256,
    rawSha256:hash(raw),rgbaSha256:hash(image.rgba),image:originalTechnical.image,edgeRole,...(surfaceFamily?{surfaceFamily}:{}),nativeSizeProfile:R.nativeSizeProfile,
    requiredRenderEnvelopeProfile:R.requiredRenderEnvelopeProfile,renderEnvelopeMeasurement:'not-assessed-pending-explicit-native-controls',
    originalTechnicalSha256:originalTechnical.sha256,originalQaStatus:'fail',originalIssues:[...originalTechnical.issues],originalSourcePolicy,
    actualPixelSize:{width:image.width,height:image.height},maximumWidth:R.maximumWidth,maximumHeight:R.maximumHeight,maximumPixels:R.maximumPixels,
    actualContentBounds:bounds,actualPaddingPixels,actualPaddingRatios,originalPromptGutter:R.originalPromptGutter,originalPromptGutterSatisfied,
    adoptedGutterStandard:R.adoptedGutterStandard,
    contentBounds:originalTechnical.contentBounds,hiddenRgbPixels:originalTechnical.hiddenRgbPixels,edgeMaximumAlpha:originalTechnical.edgeMaximumAlpha,
    status:'pass',issues:[],scope:'new-size-envelope-only-original-generation-request-remains-failed',
    transparencyAndCompleteness:'original-replayed-qa-passes-all-non-size-checks',sourcePngModified:false,allOriginalRgbaPreserved:true,
    sourceToWorldScale:'not-assessed',semanticArtAcceptance:'not-assessed',automaticSemanticDetection:false,automaticRetry:false,maximumCalls:0})};
}
function sourceFrame(store,state,sourcePlanSha256,parentBatchSha256){
  check(isDigest(sourcePlanSha256)&&isDigest(parentBatchSha256),'TERRAIN_EDGE_NATIVE_SIZE_BINDING');
  const source=state.plans.get(sourcePlanSha256),parent=state.batches.get(parentBatchSha256),R=TERRAIN_EDGE_NATIVE_SIZE_RULE;
  check(R.eligibleOriginalPlans.includes(source?.plan.format)&&source.plan.target.alpha==='transparent'
    &&source.status==='rejected-technical'&&source.result?.technical.status==='fail','TERRAIN_EDGE_NATIVE_SIZE_SOURCE');
  check(TERRAIN_EDGE_BATCH_FORMATS.includes(parent?.format)&&parent.coverageProfile==='full-perimeter-v1'
    &&parent.planSha256s.includes(sourcePlanSha256)&&parent.referencePlanSha256===source.plan.recipe.referencePlans[0]
    &&parent.targetSha256===source.plan.recipe.targetSha256,'TERRAIN_EDGE_NATIVE_SIZE_BATCH');
  assertTerrainEdgeCurrent(state,source.plan);
  const raw=store.readBlob(source.result.rawSha256);
  check(raw instanceof Uint8Array&&hash(raw)===source.result.rawSha256,'TERRAIN_EDGE_NATIVE_SIZE_RAW');
  const originalTechnical=assessTerrainEdgeSource(source.plan,raw);
  check(digest(originalTechnical)===digest(source.result.technical),'TERRAIN_EDGE_NATIVE_SIZE_ORIGINAL_QA');
  const input={sourcePlanSha256,parentBatchSha256,originalTechnical,originalSourcePolicy:source.plan.target.sourcePolicy,
    edgeRole:source.plan.recipe.edgeRole,...(source.plan.recipe.surfaceFamily?{surfaceFamily:source.plan.recipe.surfaceFamily}:{})};
  const {image,technical}=envelopeTechnical(input,raw),pixelDivisor=Math.max(1,Math.ceil(Math.max(image.width,image.height)/1024)),
    previews={original:checkerPreview(image,pixelDivisor)};
  return {source,parent,raw,image,originalTechnical,technical,previews,pixelDivisor};
}
export function compileTerrainEdgeNativeSizeProposal(store,state,sourcePlanSha256,parentBatchSha256){
  const f=sourceFrame(store,state,sourcePlanSha256,parentBatchSha256),proposal=seal({format:'ai_scene_terrain_edge_native_size_proposal_v1',
    compiler:'scene-kit-native-terrain-edge-size-envelope-v1',sourcePlanSha256,parentBatchSha256,sourceResultSha256:f.source.result.sha256,
    originalRawSha256:hash(f.raw),originalRgbaSha256:hash(f.image.rgba),originalTechnicalSha256:f.originalTechnical.sha256,
    originalTechnical:f.originalTechnical,originalSourcePolicy:f.source.plan.target.sourcePolicy,actualPixelSize:{width:f.image.width,height:f.image.height},
    actualContentBounds:f.technical.actualContentBounds,actualPaddingPixels:f.technical.actualPaddingPixels,actualPaddingRatios:f.technical.actualPaddingRatios,
    originalPromptGutter:f.technical.originalPromptGutter,originalPromptGutterSatisfied:f.technical.originalPromptGutterSatisfied,
    adoptedGutterStandard:f.technical.adoptedGutterStandard,
    edgeRole:f.source.plan.recipe.edgeRole,...(f.source.plan.recipe.surfaceFamily?{surfaceFamily:f.source.plan.recipe.surfaceFamily}:{}),
    rule:TERRAIN_EDGE_NATIVE_SIZE_RULE,requiredRenderEnvelopeProfile:TERRAIN_EDGE_NATIVE_SIZE_RULE.requiredRenderEnvelopeProfile,technical:f.technical,
    diagnosticPreviews:{originalSha256:hash(f.previews.original),pixelDivisor:f.pixelDivisor,compositing:'straight-alpha-over-checkerboard'},
    requiredHumanChecks:['Inspect the exact original PNG and alpha-composited preview: the requested single native edge is complete and isolated.',
      'Accept this exact native pixel size under the displayed bounded envelope. The original PNG and every RGBA sample remain unchanged; there is no rescaling, crop, padding or alpha repair.',
      `Review and accept the exact actual transparent margins ${JSON.stringify(f.technical.actualPaddingPixels)} and the displayed ratios. The original prompt requested 12 percent on each side; this image ${f.technical.originalPromptGutterSatisfied?'meets':'does not meet'} that request. The new adoption standard is a complete subject with real transparent gutter on all four sides, not a claim that the original requested gutter succeeded.`,
      'Accept the fixed visible-alpha8-outward16-native-rgba-v1 render envelope: after native-scale measurement, the visible contour with Alpha at least 8 must stay within 16 world units outward. All original Alpha 1 through 255 remains intact in the source PNG and inside the render window. Weak tails outside that window may only be clipped by presentation geometry and must be counted in later measured render statistics; this proposal does not invent anchors, scale or weak-tail coordinates.',
      'The original generation request and failed size QA remain unchanged. This approval authorizes zero image calls and does not grant source-art acceptance or reuse an old compute authorization.'],
    originalPngModified:false,allOriginalRgbaPreserved:true,originalQaModified:false,sourceArtAcceptance:'not-granted',maximumNewImageCalls:0});
  return {proposal,bytes:Buffer.from(f.raw),previews:f.previews};
}
export function assertTerrainEdgeNativeSizeCurrent(state,record){
  const source=state.plans.get(record.sourcePlanSha256);
  check(source?.status==='rejected-technical'&&source.result?.rawSha256===record.originalRawSha256
    &&source.result.technical.sha256===record.originalTechnicalSha256&&source.plan.sha256===record.proposal?.sourcePlanSha256,
  'TERRAIN_EDGE_NATIVE_SIZE_SOURCE_STALE');
  assertTerrainEdgeCurrent(state,source.plan);
  check(record.rawSha256===record.originalRawSha256&&record.request.maximumCalls===0
    &&record.nativeSizeProfile===TERRAIN_EDGE_NATIVE_SIZE_RULE.nativeSizeProfile
    &&record.renderEnvelopeProfile===TERRAIN_EDGE_NATIVE_SIZE_RULE.requiredRenderEnvelopeProfile
    &&record.recipe.parents.length===1&&record.recipe.parents[0]===source.plan.sha256
    &&digest(record.materialEvidence)===digest(source.plan.materialEvidence),'TERRAIN_EDGE_NATIVE_SIZE_BINDING');
}
export function assessTerrainEdgeNativeSizePreparation(record,bytes){
  const p=record.proposal;
  check(hash(bytes)===p.originalRawSha256,'TERRAIN_EDGE_NATIVE_SIZE_RAW');
  const {image,technical}=envelopeTechnical({sourcePlanSha256:p.sourcePlanSha256,parentBatchSha256:p.parentBatchSha256,
    originalTechnical:p.originalTechnical,originalSourcePolicy:p.originalSourcePolicy,edgeRole:p.edgeRole,...(p.surfaceFamily?{surfaceFamily:p.surfaceFamily}:{})},bytes);
  check(hash(image.rgba)===p.originalRgbaSha256,'TERRAIN_EDGE_NATIVE_SIZE_RGBA');return technical;
}
export function compileTerrainEdgeNativeSizePreparation(store,state,options){
  exact(options,['preparationId','proposal','receipt']);id(options.preparationId);unseal(options.proposal);
  const {proposal,bytes}=compileTerrainEdgeNativeSizeProposal(store,state,options.proposal.sourcePlanSha256,options.proposal.parentBatchSha256);
  check(digest(proposal)===digest(options.proposal),'TERRAIN_EDGE_NATIVE_SIZE_PROPOSAL_CHANGED');
  validateReceipt(options.receipt,'review');check(options.receipt.decision==='accept'&&options.receipt.targetSha256===proposal.sha256,'TERRAIN_EDGE_NATIVE_SIZE_APPROVAL');
  const source=state.plans.get(proposal.sourcePlanSha256),p=source.plan;
  const record=seal({format:TERRAIN_EDGE_NATIVE_SIZE_FORMAT,compiler:'scene-kit-native-terrain-edge-size-envelope-v1',sourcePlanSha256:p.sha256,
    proposal,receipt:options.receipt,nativeSizeProfile:TERRAIN_EDGE_NATIVE_SIZE_RULE.nativeSizeProfile,
    renderEnvelopeProfile:TERRAIN_EDGE_NATIVE_SIZE_RULE.requiredRenderEnvelopeProfile,originalRawSha256:proposal.originalRawSha256,rawSha256:proposal.originalRawSha256,
    originalTechnicalSha256:proposal.originalTechnicalSha256,technical:proposal.technical,
    recipe:{...p.recipe,planId:options.preparationId,parents:[p.sha256]},designReviews:p.designReviews,referenceEvidence:p.referenceEvidence,
    materialEvidence:p.materialEvidence,instanceBinding:p.instanceBinding,target:p.target,qualityPolicy:p.qualityPolicy,
    sourceScope:p.sourceScope,visualReviewChecklist:p.visualReviewChecklist,request:{format:'ai_scene_no_generation_request_v1',maximumCalls:0},
    originalAttemptOutcome:'rejected-technical',originalPreserved:true,allOriginalRgbaPreserved:true,sourceArtAcceptance:'not-granted'});
  return {record,bytes};
}
export function assertTerrainEdgeNativeSizeParent(state,parentBatchSha256){
  const parent=state.batches.get(parentBatchSha256),latest=[...state.batches.values()].findLast(b=>TERRAIN_EDGE_BATCH_FORMATS.includes(b.format)
    &&b.referencePlanSha256===parent?.referencePlanSha256&&b.baseBatchSha256===parent?.baseBatchSha256);
  check(parent&&latest?.sha256===parent.sha256,'TERRAIN_EDGE_NATIVE_SIZE_PARENT_STALE');return parent;
}
export function compileTerrainEdgePreparedBatch(state,options){
  exact(options,['batchId','parentBatchSha256','preparationSha256']);id(options.batchId);
  const parent=assertTerrainEdgeNativeSizeParent(state,options.parentBatchSha256),prepared=state.plans.get(options.preparationSha256);
  check(prepared?.kind==='terrain-edge-native-size-preparation'&&prepared.status==='pending-visual-review'
    &&prepared.plan.proposal.parentBatchSha256===parent.sha256&&parent.planSha256s.includes(prepared.plan.sourcePlanSha256),
  'TERRAIN_EDGE_NATIVE_SIZE_PREPARED_BATCH');
  assertTerrainEdgeNativeSizeCurrent(state,prepared.plan);
  const planSha256s=parent.planSha256s.map(sha=>sha===prepared.plan.sourcePlanSha256?prepared.plan.sha256:sha),reusedAuthorizations=[];
  for(const sha of planSha256s){
    const entry=state.plans.get(sha);
    check(['authorized','pending-visual-review','accepted'].includes(entry?.status),'TERRAIN_EDGE_NATIVE_SIZE_CONTINUATION');
    if(entry.status==='authorized'){
      check(entry.authorization?.receipt?.targetSha256&&entry.plan.request.maximumCalls===1,'TERRAIN_EDGE_NATIVE_SIZE_CONTINUATION');
      reusedAuthorizations.push({planSha256:sha,authorizationSha256:entry.authorization.sha256,requestSha256:digest(entry.plan.request)});
    }else check(entry.result?.technical.status==='pass','TERRAIN_EDGE_NATIVE_SIZE_CONTINUATION');
  }
  const bindings=Object.fromEntries(['baseBatchSha256','referencePlanSha256','targetSha256','materialPlanSha256','materialRawSha256','policySha256',
    'surfaceFamily','coverageProfile','coverage','expectedRoles','requestedRoles','fullPerimeterComplete','coverageIntent'].filter(k=>Object.hasOwn(parent,k)).map(k=>[k,parent[k]]));
  return seal({format:TERRAIN_EDGE_PREPARED_BATCH_FORMAT,batchId:options.batchId,parentBatchSha256:parent.sha256,...bindings,planSha256s,
    preparationSha256s:[...(parent.preparationSha256s??[]),prepared.plan.sha256],reusedAuthorizations,remainingAuthorizedCalls:reusedAuthorizations.length,
    maximumCalls:0,newImageRequests:0,automaticRetry:false,scope:'reviewed-native-size-preparation-plus-original-authorized-continuation'});
}
