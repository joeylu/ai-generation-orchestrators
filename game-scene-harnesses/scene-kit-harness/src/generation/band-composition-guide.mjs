import {inspectPng,encodeRgbaPng} from '../png.mjs';
import {check,exact,id,text,digest,hash,isDigest,seal,unseal,receipt,imageRef} from './common.mjs';
import {validateBackgroundBand,backgroundBandCoverage} from './background-band.mjs';
import {backgroundBandCoverageGuide} from './background-band-coverage-guide.mjs';
import {backgroundBandOpenDepthGuide} from './background-band-open-depth-guide.mjs';
import {backgroundBandOpenTrenchGuide} from './background-band-open-trench-guide.mjs';
import {backgroundBandIrregularValleyGuide} from './background-band-irregular-valley-guide.mjs';
import {bandLayoutFeasibility} from './band-layout-feasibility.mjs';
import {isRegisteredMasterSpec,describeRegisteredMasterGuide,previewRegisteredMasterGuide} from './registered-layout-master.mjs';

export const BAND_COMPOSITION_GUIDE_PROFILE='band-feature-envelope-guide-v1';
export const BAND_COMPOSITION_GUIDE_IMAGE_ROLE='neutral-band-feature-envelope-guide';
export const BAND_REFERENCE_WINDOW_GUIDE_IMAGE_ROLE='accepted-reference-window-in-band-frame-guide';
export const isReferenceWindowGuide=spec=>spec?.format==='ai_scene_band_composition_guide_spec_v3';
export const isFeatureMarkersGuide=spec=>spec?.format==='ai_scene_band_composition_guide_spec_v4';
function prepareGuide({band,role,spec}) {
  validateBackgroundBand(band,{role});
  const referenceWindow=isReferenceWindowGuide(spec),markersOnly=isFeatureMarkersGuide(spec);
  const v2=referenceWindow||markersOnly||spec.format==='ai_scene_band_composition_guide_spec_v2';
  const profile=markersOnly?'band-feature-markers-guide-v4':referenceWindow?'band-reference-window-guide-v3':v2?'band-feature-envelope-guide-v2':BAND_COMPOSITION_GUIDE_PROFILE;
  check(band.format==='ai_scene_background_band_v3'||v2&&band.format==='ai_scene_background_band_v4','BAND_COMPOSITION_PROFILE');
  const registered=Object.hasOwn(spec,'instructionProfile');
  exact(spec,['format','referenceRawSha256','scale','translation','features',...(referenceWindow?['referenceViewport']:[]),...(registered?['instructionProfile']:[])]);
  check(!registered||referenceWindow&&spec.instructionProfile==='registered-window-extraction-v1','BAND_REFERENCE_WINDOW_INSTRUCTION');
  check((v2||spec.format==='ai_scene_band_composition_guide_spec_v1')&&isDigest(spec.referenceRawSha256),'BAND_COMPOSITION_BINDING');
  if(referenceWindow){exact(spec.referenceViewport,['width','height']);check(Object.values(spec.referenceViewport).every(n=>Number.isSafeInteger(n)&&n>0&&n<=4096),'BAND_REFERENCE_WINDOW_VIEWPORT');}
  check(Array.isArray(spec.features)&&spec.features.length>=2&&spec.features.length<=(v2?12:4),'BAND_COMPOSITION_FEATURES');
  const ids=new Set();for(const f of spec.features){exact(f,['featureId','description','native','target']);id(f.featureId);text(f.description,{limit:200});check(!ids.has(f.featureId),'BAND_COMPOSITION_FEATURES');ids.add(f.featureId);}
  const options={canvasAspect:band.canvasAspect,coverageBudget:band.coverageBudget,role},open=band.format==='ai_scene_background_band_v4';
  const base=!open?backgroundBandCoverageGuide(options):band.guidanceProfile==='open-valley-irregular-coverage-v3'?backgroundBandIrregularValleyGuide(options):band.guidanceProfile==='open-trench-three-cut-coverage-v2'?backgroundBandOpenTrenchGuide(options):backgroundBandOpenDepthGuide(options);
  const {width,height}=base.artifact.pixelSize;
  const rgba=markersOnly?Buffer.alloc(width*height*4):inspectPng(base.bytes,{includePixels:true}).rgba;
  const f=band.coverageFrameWorld;
  const coverage={x:[f.x,f.x+f.width],y:[f.y,f.y+f.height]};
  const assessment=bandLayoutFeasibility({sourceSize:{width,height},coverage,scale:spec.scale,translation:spec.translation,features:spec.features.map(({featureId,native,target})=>({featureId,native,target}))});
  check(assessment.status==='feasible','BAND_COMPOSITION_INFEASIBLE');
  return {base,width,height,rgba,coverage,assessment,v2,referenceWindow,markersOnly,profile};
}
// Configuration validation cannot approve a reference-derived raster without
// its bytes. The source compiler must independently regenerate the exact guide.
export function validateBandCompositionGuideConfiguration(options){
  if(isRegisteredMasterSpec(options.spec))return describeRegisteredMasterGuide(options);
  if(!isReferenceWindowGuide(options.spec))return bandCompositionGuide(options);
  prepareGuide(options);receipt(options.decision,'review');check(options.decision.decision==='accept','BAND_COMPOSITION_DECISION');
}
export function previewBandCompositionGuide({band,role,spec,referenceBytes,masterBytes}) {
  if(isRegisteredMasterSpec(spec))return previewRegisteredMasterGuide({band,role,spec,masterBytes});
  const {base,width,height,rgba,coverage,assessment,v2,referenceWindow,markersOnly,profile}=prepareGuide({band,role,spec});
  const referenceMapping=referenceWindow?renderReferenceWindowPixels({width,height,rgba,spec,referenceBytes,assessment}):null;
  const markerRendering=renderReferenceFeatureMarkers({width,height,rgba,features:spec.features,v2});
  const bytes=encodeRgbaPng(width,height,rgba);
  const version=markersOnly?4:referenceWindow?3:v2?2:1;
  const recipe=seal({format:`ai_scene_band_composition_guide_recipe_v${version}`,profile,referenceRawSha256:spec.referenceRawSha256,
    bandSha256:digest(band),specSha256:digest(spec),baseRecipeSha256:base.recipe.sha256,
    derivedCameraCoverage:backgroundBandCoverage(band),designCoverage:coverage,feasibility:assessment,featureIds:spec.features.map(f=>f.featureId),
    markerRendering,
    ...(markersOnly?{baseUsage:'canvas-aspect-size-and-coverage-contract-only-no-fixed-contour'}:{}),
    ...(referenceWindow?{referenceMapping,baseUsage:'canvas-aspect-size-and-coverage-contract-only-no-fixed-contour',...(spec.instructionProfile?{instructionProfile:spec.instructionProfile}:{})}:{}),
    guidesAreNotArtwork:true,automaticImageUnderstanding:false,humanArtAcceptance:'not-assessed'});
  const artifact=imageRef(bytes),proposal=seal({format:`ai_scene_band_composition_guide_proposal_v${version}`,profile,
    referenceRawSha256:spec.referenceRawSha256,bandSha256:digest(band),specSha256:digest(spec),artifact,recipeSha256:recipe.sha256,
    generationCalls:0,humanArtAcceptance:'not-assessed'});
  return {bytes,artifact,recipe,proposal,profile,role};
}
// Only a freshly recomputed preview can establish what was approved.
export function assertBandCompositionGuideDecision(proposal,decision) {
  unseal(proposal);receipt(decision,'review');
  check(['ai_scene_band_composition_guide_proposal_v1','ai_scene_band_composition_guide_proposal_v2','ai_scene_band_composition_guide_proposal_v3','ai_scene_band_composition_guide_proposal_v4','ai_scene_band_master_edit_proposal_v1'].includes(proposal.format)&&decision.decision==='accept'&&decision.targetSha256===proposal.sha256,'BAND_COMPOSITION_DECISION');
}
export function bandCompositionGuide({band,role,spec,decision,referenceBytes,masterBytes}) {
  const guide=previewBandCompositionGuide({band,role,spec,referenceBytes,masterBytes});assertBandCompositionGuideDecision(guide.proposal,decision);return guide;
}

// Shared raster operations only; callers own scope, framing and acceptance.
export function renderReferenceWindowPixels({width,height,rgba,spec,referenceBytes,assessment,referenceContentFrame=null}){
  const referenceWindow=true;
  let referenceMapping=null;
  if(referenceWindow){
    check(referenceBytes instanceof Uint8Array&&hash(referenceBytes)===spec.referenceRawSha256,'BAND_REFERENCE_WINDOW_BYTES');
    const ref=inspectPng(Buffer.from(referenceBytes),{includePixels:true,allowCabx:true,allowHiddenRgb:true}),v=spec.referenceViewport,w=assessment.witness;
    check(Math.abs(ref.width*v.height-ref.height*v.width)*1000<=20*ref.height*v.width,'BAND_REFERENCE_WINDOW_ASPECT');
    const c=referenceContentFrame??{x:0,y:0,width:v.width,height:v.height};
    const window={x:(c.x-w.x)/w.scale,y:(c.y-w.y)/w.scale,width:c.width/w.scale,height:c.height/w.scale};
    const intersection={left:Math.max(0,window.x),right:Math.min(width,window.x+window.width),top:Math.max(0,window.y),bottom:Math.min(height,window.y+window.height)};
    check(intersection.left<intersection.right&&intersection.top<intersection.bottom,'BAND_REFERENCE_WINDOW_EMPTY');
    // A diagnostic guide only: show the accepted full-scene reference at its
    // planned world registration. Stripe every unobserved outside-frame pixel;
    // no segmentation, asset extraction or source acceptance is performed here.
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const p=(y*width+x)*4,gray=(x+y)%32<16?215:235;rgba.set([gray,gray,gray,255],p);
      const wx=w.x+(x+.5)*w.scale,wy=w.y+(y+.5)*w.scale;
      if(wx<c.x||wy<c.y||wx>=c.x+c.width||wy>=c.y+c.height)continue;
      const sx=Math.min(ref.width-1,Math.floor((wx-c.x)/c.width*ref.width)),sy=Math.min(ref.height-1,Math.floor((wy-c.y)/c.height*ref.height)),q=(sy*ref.width+sx)*4,a=ref.rgba[q+3]/255;
      for(let c=0;c<3;c++)rgba[p+c]=Math.round(ref.rgba[q+c]*a+gray*(1-a));
    }
    referenceMapping={referenceRawSha256:spec.referenceRawSha256,referenceNativeSize:{width:ref.width,height:ref.height},referenceViewport:spec.referenceViewport,guideSize:{width,height},guidePixelToWorld:{scale:w.scale,position:{x:w.x,y:w.y}},referenceWindowInGuide:window,visibleReferenceIntersection:intersection,outsideReference:'striped-unobserved-design-reserve-not-artwork-or-transparency',segmentationPerformed:false,originalReferenceModified:false};
  }
  if(referenceContentFrame)referenceMapping.referenceContentFrame=referenceContentFrame;
  return referenceMapping;
}
export function renderReferenceFeatureMarkers({width,height,rgba,features,v2=true}){
  // Readable abstract numbered badges and dashed rectangles, never topic art.
  const digits=['01100100011000110001100011000101100','00100011000010000100001000010001110','01110100010000100010001000100011111','11110000010000101110000010000111110','00010001100101010010111110001000010','11111100001111000001000011000101110','01110100001000011110100011000101110','11111000010001000100010000100001000','01110100011000101110100011000101110','01110100011000101111000010000101110'];
  const unit=Math.max(2,Math.round(height/140)),stroke=Math.max(2,Math.round(height/140)),dash=unit*4,gap=unit*2;
  features.forEach((feature,i)=>{
    const [ax,bx]=feature.native.x,[ay,by]=feature.native.y;
    const x0=Math.max(0,Math.min(width-1,Math.floor(ax*(width-1)))),x1=Math.max(x0,Math.min(width-1,Math.ceil(bx*(width-1))));
    const y0=Math.max(0,Math.min(height-1,Math.floor(ay*(height-1)))),y1=Math.max(y0,Math.min(height-1,Math.ceil(by*(height-1))));
    const pixel=(x,y,gray=32)=>{if(x>=0&&x<width&&y>=0&&y<height)rgba.set([gray,gray,gray,255],(y*width+x)*4);};
    const square=(x,y,w,h,gray)=>{for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)pixel(xx,yy,gray);};
    for(let x=x0;x<=x1;x++)if((x-x0)%(dash+gap)<dash){square(x,y0,1,stroke,32);square(x,y1-stroke+1,1,stroke,32);}
    for(let y=y0;y<=y1;y++)if((y-y0)%(dash+gap)<dash){square(x0,y,stroke,1,32);square(x1-stroke+1,y,stroke,1,32);}
    const number=String(i+1),labelWidth=(v2?number.length*6+1:7)*unit,labelHeight=9*unit,
      badgeX=x0>=labelWidth+unit?x0-labelWidth-unit:Math.min(width-labelWidth,x1+unit),
      badgeY=Math.max(0,Math.min(height-labelHeight,y0));
    square(badgeX,badgeY,labelWidth,labelHeight,245);
    for(let digit=0;digit<number.length;digit++){const glyph=digits[Number(number[digit])];for(let row=0;row<7;row++)for(let col=0;col<5;col++)if(glyph[row*5+col]==='1')square(badgeX+(col+1+6*digit)*unit,badgeY+(row+1)*unit,unit,unit,32);}
    if(v2){const cx=Math.round((x0+x1)/2),cy=Math.round((y0+y1)/2);square(cx-2*unit-1,cy-1,4*unit+3,3,245);square(cx-1,cy-2*unit-1,3,4*unit+3,245);square(cx-2*unit,cy,4*unit+1,1,32);square(cx,cy-2*unit,1,4*unit+1,32);}
  });
  return {profile:v2?'high-contrast-numbered-centers-v3':'high-contrast-dashed-numbered-v2',lineWidth:stroke,dashLength:dash,gapLength:gap,glyphScale:unit};
}
