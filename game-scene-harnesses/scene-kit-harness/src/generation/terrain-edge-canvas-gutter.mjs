import {inspectPng,encodeRgbaPng} from '../png.mjs';
import {assertTerrainEdgeCurrent,assessTerrainEdgeSource,TERRAIN_EDGE_BATCH_FORMATS} from './terrain-edge-source.mjs';
import {check,digest,exact,hash,id,isDigest,receipt as validateReceipt,seal,unseal} from './common.mjs';

export const TERRAIN_EDGE_CANVAS_GUTTER_FORMAT='ai_scene_terrain_edge_canvas_gutter_preparation_v1';
export const TERRAIN_EDGE_CANVAS_GUTTER_BATCH_FORMAT='ai_scene_terrain_edge_canvas_gutter_batch_v1';
export const TERRAIN_EDGE_AUTO_GUTTER_PROFILE='alpha-one-transparent-canvas-2px-v1';
export const TERRAIN_EDGE_CANVAS_GUTTER_RULE=seal({profile:'native-terrain-edge-transparent-canvas-2px-v1',
  eligibleOriginalPlans:['ai_scene_generation_plan_v35','ai_scene_generation_plan_v36','ai_scene_generation_plan_v37'],
  eligibleOriginalIssue:'TERRAIN_EDGE_NATIVE_GUTTER',originalBorderWidth:2,maximumOriginalBorderAlpha:7,
  bodyAlphaThreshold:8,minimumBodyMargin:2,paddingPixels:2,pixelOperation:'integer-copy-all-original-rgba-add-zero-rgba-canvas',
  nativeSizeProfile:'bounded-native-4m-v1',requiredRenderEnvelopeProfile:'visible-alpha8-outward16-native-rgba-v1',
  maximumWidth:4096,maximumHeight:4096,maximumPixels:4194304,maximumPngBytes:16777216,
  consumerFrame:'original-pixel-frame-excludes-only-new-transparent-padding-controls-remain-original-native-coordinates',
  originalRawAndFailedQaPreserved:true,allOriginalRgbaPreserved:true,newImageCalls:0,artAcceptance:'not-granted',hiddenGeometry:'not-recovered'});
const R=TERRAIN_EDGE_CANVAS_GUTTER_RULE;
function bounds(p,threshold){let x0=p.width,y0=p.height,x1=-1,y1=-1;
  for(let y=0;y<p.height;y++)for(let x=0;x<p.width;x++)if(p.rgba[(y*p.width+x)*4+3]>=threshold){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
  check(x1>=x0&&y1>=y0,'TERRAIN_EDGE_CANVAS_GUTTER_EMPTY');return {x:x0,y:y0,width:x1-x0+1,height:y1-y0+1};}
const margins=(p,b)=>({left:b.x,top:b.y,right:p.width-b.x-b.width,bottom:p.height-b.y-b.height});
function checker(p,d){const w=Math.ceil(p.width/d),h=Math.ceil(p.height/d),rgba=Buffer.alloc(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const sum=[0,0,0];let n=0;
    for(let sy=y*d;sy<Math.min(p.height,(y+1)*d);sy++)for(let sx=x*d;sx<Math.min(p.width,(x+1)*d);sx++){
      const q=(sy*p.width+sx)*4,a=p.rgba[q+3],bg=(Math.floor(sx/16)+Math.floor(sy/16))%2?190:226;
      for(let c=0;c<3;c++)sum[c]+=Math.floor((p.rgba[q+c]*a+bg*(255-a)+127)/255);n++;}
    const q=(y*w+x)*4;for(let c=0;c<3;c++)rgba[q+c]=Math.floor((sum[c]+Math.floor(n/2))/n);rgba[q+3]=255;
  }return encodeRgbaPng(w,h,rgba);}
function padded(raw,plan){
  check(raw instanceof Uint8Array&&raw.length>0&&raw.length<=R.maximumPngBytes,'TERRAIN_EDGE_CANVAS_GUTTER_BYTES');
  const p=inspectPng(raw,{includePixels:true,pixelStats:true,allowCabx:true,allowHiddenRgb:true}),width=p.width+4,height=p.height+4,policy=plan.target.sourcePolicy;
  check(width<=policy.maximumWidth&&height<=policy.maximumHeight&&width<=R.maximumWidth&&height<=R.maximumHeight
    &&width*height<=policy.maximumPixels&&width*height<=R.maximumPixels,'TERRAIN_EDGE_CANVAS_GUTTER_SIZE');
  let maximumAlpha=0,nonzeroPixels=0;for(let y=0;y<p.height;y++)for(let x=0;x<p.width;x++)if(x<2||y<2||x>=p.width-2||y>=p.height-2){
    const a=p.rgba[(y*p.width+x)*4+3];maximumAlpha=Math.max(maximumAlpha,a);if(a)nonzeroPixels++;}
  check(maximumAlpha>0&&maximumAlpha<=R.maximumOriginalBorderAlpha,'TERRAIN_EDGE_CANVAS_GUTTER_BORDER');
  const bodyBounds=bounds(p,8),bodyMargins=margins(p,bodyBounds);check(Math.min(...Object.values(bodyMargins))>=2,'TERRAIN_EDGE_CANVAS_GUTTER_BODY_MARGIN');
  const rgba=Buffer.alloc(width*height*4);for(let y=0;y<p.height;y++)p.rgba.copy(rgba,((y+2)*width+2)*4,y*p.width*4,(y+1)*p.width*4);
  const bytes=encodeRgbaPng(width,height,rgba);check(bytes.length<=R.maximumPngBytes,'TERRAIN_EDGE_CANVAS_GUTTER_BYTES');
  const technical=assessTerrainEdgeSource(plan,bytes);check(technical.status==='pass','TERRAIN_EDGE_CANVAS_GUTTER_DERIVED_QA');
  return {p,bytes,rgba,width,height,technical,bodyBounds,bodyMargins,originalBorder:{width:2,maximumAlpha,nonzeroPixels}};
}
export function compileTerrainEdgeCanvasGutterProposal(store,state,sourcePlanSha256,parentBatchSha256){
  check(isDigest(sourcePlanSha256)&&isDigest(parentBatchSha256),'TERRAIN_EDGE_CANVAS_GUTTER_BINDING');
  const source=state.plans.get(sourcePlanSha256),parent=state.batches.get(parentBatchSha256);
  check(R.eligibleOriginalPlans.includes(source?.plan.format)&&source.plan.target.alpha==='transparent'
    &&source.plan.recipe.nativeSizeProfile===R.nativeSizeProfile&&source.plan.recipe.renderEnvelopeProfile===R.requiredRenderEnvelopeProfile
    &&source.status==='rejected-technical'&&source.result?.technical.status==='fail','TERRAIN_EDGE_CANVAS_GUTTER_SOURCE');
  check(TERRAIN_EDGE_BATCH_FORMATS.includes(parent?.format)&&parent.coverageProfile==='full-perimeter-v1'
    &&parent.planSha256s.includes(sourcePlanSha256)&&parent.referencePlanSha256===source.plan.recipe.referencePlans[0]
    &&parent.targetSha256===source.plan.recipe.targetSha256,'TERRAIN_EDGE_CANVAS_GUTTER_BATCH');
  assertTerrainEdgeCurrent(state,source.plan);const raw=store.readBlob(source.result.rawSha256);
  check(hash(raw)===source.result.rawSha256,'TERRAIN_EDGE_CANVAS_GUTTER_RAW');const originalTechnical=assessTerrainEdgeSource(source.plan,raw);
  check(digest(originalTechnical)===digest(source.result.technical)&&originalTechnical.status==='fail'
    &&originalTechnical.issues.length===1&&originalTechnical.issues[0]===R.eligibleOriginalIssue,'TERRAIN_EDGE_CANVAS_GUTTER_ORIGINAL_QA');
  const f=padded(raw,source.plan),d=Math.max(1,Math.ceil(Math.max(f.width,f.height)/1024)),previews={original:checker(f.p,d),padded:checker({width:f.width,height:f.height,rgba:f.rgba},d)};
  const proposal=seal({format:'ai_scene_terrain_edge_canvas_gutter_proposal_v1',compiler:'scene-kit-terrain-edge-canvas-gutter-v1',sourcePlanSha256,parentBatchSha256,
    sourceResultSha256:source.result.sha256,originalPlan:source.plan,originalTechnicalSha256:originalTechnical.sha256,originalTechnical,
    originalRawSha256:hash(raw),originalRgbaSha256:hash(f.p.rgba),paddedRawSha256:hash(f.bytes),paddedRgbaSha256:hash(f.rgba),
    originalPixelSize:{width:f.p.width,height:f.p.height},paddedPixelSize:{width:f.width,height:f.height},contentOffset:{x:2,y:2},
    nativeFrame:{x:2,y:2,width:f.p.width,height:f.p.height},originalContentBounds:originalTechnical.contentBounds,
    originalPaddingPixels:margins(f.p,originalTechnical.contentBounds),originalBorder:f.originalBorder,bodyBounds:f.bodyBounds,bodyMargins:f.bodyMargins,
    edgeRole:source.plan.recipe.edgeRole,rule:R,technical:f.technical,
    diagnosticPreviews:{originalSha256:hash(previews.original),paddedSha256:hash(previews.padded),pixelDivisor:d,compositing:'straight-alpha-over-checkerboard'},
    requiredHumanChecks:['Inspect the exact original and alpha-composited previews: the single requested edge and its ends are complete and isolated.',
      'Accept exactly two pixels of added zero-RGBA canvas on every side. Every original RGBA sample including weak alpha and hidden RGB is preserved; missing geometry is not recovered.',
      'Controls and native-scale budgets retain the original pixel frame. Derivation reads the complete original RGBA footprint inside the prepared image, excluding only the newly added zero canvas. It never crops the subject or removes old tails.',
      'The original generation request and failed QA remain failed and preserved. This acceptance adds zero image calls and does not grant source-art acceptance.'],
    originalPngModified:false,allOriginalRgbaPreserved:true,hiddenGeometry:'not-recovered',sourceArtAcceptance:'not-granted',maximumNewImageCalls:0});
  return {proposal,bytes:f.bytes,previews};
}
export function assessTerrainEdgeCanvasGutterPreparation(record,bytes){
  unseal(record);const p=record.proposal;unseal(p);unseal(p.originalPlan);
  check(record.format===TERRAIN_EDGE_CANVAS_GUTTER_FORMAT&&record.request.maximumCalls===0
    &&p.originalPlan.sha256===record.sourcePlanSha256&&hash(bytes)===p.paddedRawSha256&&record.rawSha256===p.paddedRawSha256,
    'TERRAIN_EDGE_CANVAS_GUTTER_PREPARED_QA');
  const image=inspectPng(bytes,{includePixels:true,allowCabx:true,allowHiddenRgb:true}),frame=record.nativeFrame;
  check(image.width===p.paddedPixelSize.width&&image.height===p.paddedPixelSize.height&&hash(image.rgba)===p.paddedRgbaSha256
    &&digest(frame)===digest({x:2,y:2,...p.originalPixelSize}),'TERRAIN_EDGE_CANVAS_GUTTER_PREPARED_QA');
  const rgba=Buffer.alloc(frame.width*frame.height*4);
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){
    const q=(y*image.width+x)*4;
    if(x<2||y<2||x>=image.width-2||y>=image.height-2)check(image.rgba.subarray(q,q+4).every(v=>v===0),'TERRAIN_EDGE_CANVAS_GUTTER_PREPARED_QA');
    else image.rgba.copy(rgba,((y-2)*frame.width+x-2)*4,q,q+4);
  }
  check(hash(rgba)===p.originalRgbaSha256,'TERRAIN_EDGE_CANVAS_GUTTER_PREPARED_QA');
  const technical=assessTerrainEdgeSource(p.originalPlan,bytes);
  check(technical.status==='pass'&&digest(technical)===digest(record.technical),'TERRAIN_EDGE_CANVAS_GUTTER_PREPARED_QA');return technical;
}
export function compileTerrainEdgeCanvasGutterPreparation(store,state,options){
  const automatic=Object.hasOwn(options,'automaticPolicy');
  exact(options,['preparationId','proposal',automatic?'automaticPolicy':'receipt']);id(options.preparationId);unseal(options.proposal);
  const {proposal,bytes}=compileTerrainEdgeCanvasGutterProposal(store,state,options.proposal.sourcePlanSha256,options.proposal.parentBatchSha256);
  check(digest(proposal)===digest(options.proposal),'TERRAIN_EDGE_CANVAS_GUTTER_PROPOSAL_CHANGED');
  if(automatic){
    check(options.automaticPolicy===TERRAIN_EDGE_AUTO_GUTTER_PROFILE&&proposal.originalBorder.maximumAlpha===1
      &&state.batches.get(proposal.parentBatchSha256)?.fullPerimeterComplete===true,
      'TERRAIN_EDGE_AUTO_GUTTER_INELIGIBLE');
  }else{
    validateReceipt(options.receipt,'review');
    check(options.receipt.decision==='accept'&&options.receipt.targetSha256===proposal.sha256,'TERRAIN_EDGE_CANVAS_GUTTER_APPROVAL');
  }
  const decision=automatic?{automaticPolicy:options.automaticPolicy}:{receipt:options.receipt};
  const source=state.plans.get(proposal.sourcePlanSha256),p=source.plan,record=seal({format:TERRAIN_EDGE_CANVAS_GUTTER_FORMAT,compiler:'scene-kit-terrain-edge-canvas-gutter-v1',
    sourcePlanSha256:p.sha256,proposal,...decision,nativeSizeProfile:R.nativeSizeProfile,renderEnvelopeProfile:R.requiredRenderEnvelopeProfile,
    originalRawSha256:proposal.originalRawSha256,rawSha256:proposal.paddedRawSha256,originalTechnicalSha256:proposal.originalTechnicalSha256,
    technical:proposal.technical,nativeFrame:proposal.nativeFrame,recipe:{...p.recipe,planId:options.preparationId,parents:[p.sha256]},
    designReviews:p.designReviews,referenceEvidence:p.referenceEvidence,materialEvidence:p.materialEvidence,instanceBinding:p.instanceBinding,
    target:p.target,qualityPolicy:p.qualityPolicy,sourceScope:p.sourceScope,visualReviewChecklist:p.visualReviewChecklist,
    request:{format:'ai_scene_no_generation_request_v1',maximumCalls:0},originalAttemptOutcome:'rejected-technical',originalPreserved:true,
    allOriginalRgbaPreserved:true,sourceArtAcceptance:'not-granted'});return {record,bytes};
}
export function assertTerrainEdgeCanvasGutterCurrent(state,record){
  const source=state.plans.get(record.sourcePlanSha256);check(source?.status==='rejected-technical'&&source.result?.rawSha256===record.originalRawSha256
    &&source.result.technical.sha256===record.originalTechnicalSha256&&record.rawSha256===record.proposal?.paddedRawSha256
    &&record.request.maximumCalls===0&&digest(record.nativeFrame)===digest(record.proposal.nativeFrame),'TERRAIN_EDGE_CANVAS_GUTTER_STALE');
  assertTerrainEdgeCurrent(state,source.plan);
}
export function assertTerrainEdgeCanvasGutterParent(state,sha){const parent=state.batches.get(sha),latest=[...state.batches.values()].findLast(b=>
  TERRAIN_EDGE_BATCH_FORMATS.includes(b.format)&&b.referencePlanSha256===parent?.referencePlanSha256&&b.baseBatchSha256===parent?.baseBatchSha256);
  check(parent&&latest?.sha256===sha,'TERRAIN_EDGE_CANVAS_GUTTER_PARENT_STALE');return parent;}
export function compileTerrainEdgeCanvasGutterBatch(state,options){
  exact(options,['batchId','parentBatchSha256','preparationSha256']);id(options.batchId);const parent=assertTerrainEdgeCanvasGutterParent(state,options.parentBatchSha256),p=state.plans.get(options.preparationSha256);
  check(p?.kind==='terrain-edge-canvas-gutter-preparation'&&p.status==='pending-visual-review'&&p.plan.proposal.parentBatchSha256===parent.sha256
    &&parent.planSha256s.includes(p.plan.sourcePlanSha256),'TERRAIN_EDGE_CANVAS_GUTTER_PREPARED_BATCH');assertTerrainEdgeCanvasGutterCurrent(state,p.plan);
  const planSha256s=parent.planSha256s.map(sha=>sha===p.plan.sourcePlanSha256?p.plan.sha256:sha),reusedAuthorizations=[];
  for(const sha of planSha256s){const e=state.plans.get(sha);check(['authorized','pending-visual-review','accepted'].includes(e?.status),'TERRAIN_EDGE_CANVAS_GUTTER_CONTINUATION');
    if(e.status==='authorized'){check(e.authorization?.receipt?.targetSha256&&e.plan.request.maximumCalls===1,'TERRAIN_EDGE_CANVAS_GUTTER_CONTINUATION');
      reusedAuthorizations.push({planSha256:sha,authorizationSha256:e.authorization.sha256,requestSha256:digest(e.plan.request)});
    }else check(e.result?.technical.status==='pass','TERRAIN_EDGE_CANVAS_GUTTER_CONTINUATION');}
  const binding=Object.fromEntries(['baseBatchSha256','referencePlanSha256','targetSha256','materialPlanSha256','materialRawSha256','policySha256','surfaceFamily',
    'coverageProfile','coverage','expectedRoles','requestedRoles','fullPerimeterComplete','coverageIntent','nativeSizeProfile','renderEnvelopeProfile','naturalSurfaceProfile']
    .filter(k=>Object.hasOwn(parent,k)).map(k=>[k,parent[k]]));
  return seal({format:TERRAIN_EDGE_CANVAS_GUTTER_BATCH_FORMAT,batchId:options.batchId,parentBatchSha256:parent.sha256,...binding,planSha256s,
    preparationSha256s:[...(parent.preparationSha256s??[]),p.plan.sha256],reusedAuthorizations,remainingAuthorizedCalls:reusedAuthorizations.length,
    maximumCalls:0,newImageRequests:0,automaticRetry:false,scope:'reviewed-native-canvas-gutter-plus-original-authorized-continuation'});
}
// Consumer geometry is the original pixel frame, never the larger padding canvas.
export function terrainEdgeCanvasGutterView(item){
  const {record,originalPlan,originalResult,originalRaw}=item.preparation??{};check(record?.format===TERRAIN_EDGE_CANVAS_GUTTER_FORMAT,'TERRAIN_EDGE_CANVAS_GUTTER_LINEAGE');
  unseal(record);unseal(record.proposal);unseal(originalPlan);unseal(originalResult);unseal(item.result);
  check(record.sha256===item.plan.sha256&&record.sourcePlanSha256===originalPlan?.sha256&&hash(originalRaw)===record.originalRawSha256
    &&originalResult?.rawSha256===record.originalRawSha256&&originalResult.technical.sha256===record.originalTechnicalSha256
    &&digest(originalPlan)===digest(record.proposal.originalPlan)&&record.proposal.sourceResultSha256===originalResult.sha256
    &&digest(originalResult.technical)===digest(record.proposal.originalTechnical)
    &&originalResult.technical.status==='fail'&&digest(originalResult.technical.issues)===digest([R.eligibleOriginalIssue])
    &&(record.automaticPolicy===TERRAIN_EDGE_AUTO_GUTTER_PROFILE&&!Object.hasOwn(record,'receipt')
      ||record.receipt?.decision==='accept'&&record.receipt.targetSha256===record.proposal.sha256&&!Object.hasOwn(record,'automaticPolicy'))
    &&record.rawSha256===hash(item.raw)
    &&item.result.technical.sha256===record.technical.sha256&&record.request.maximumCalls===0,'TERRAIN_EDGE_CANVAS_GUTTER_LINEAGE');
  const f=padded(originalRaw,originalPlan);check(f.bytes.equals(item.raw)&&hash(f.p.rgba)===record.proposal.originalRgbaSha256
    &&(!record.automaticPolicy||f.originalBorder.maximumAlpha===1)
    &&digest(record.nativeFrame)===digest({x:2,y:2,width:f.p.width,height:f.p.height}),'TERRAIN_EDGE_CANVAS_GUTTER_FRAME');
  return {width:f.p.width,height:f.p.height,rgba:Buffer.from(f.p.rgba)};
}
