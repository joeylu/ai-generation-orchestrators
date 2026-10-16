import {surfaceStyleInfo} from '../skins/surface-styles.mjs';
// Semantic visual recipes use verified skin metadata. Historic documents remain
// plain Text; only newly compiled headings opt into the surface.
export function headingPresentation(ctx,key,width,height,{layered=ctx.surfaceLayersEnabled===true,reference=false}={}){
 if(ctx.surfaceStylesEnabled===false)return {height,insets:{left:0,right:0,top:0,bottom:0}};
 const info=surfaceStyleInfo(ctx.skinGeometry,key);
 if(!info)return {height,insets:{left:0,right:0,top:0,bottom:0}};
 if(width<info.minWidth)throw Object.assign(Error('Heading is narrower than its skin minimum.'),{code:'panel.heading-capacity'});
 const border=info.clipInsets;
 if(reference){
  const fontSize=key==='title'?Math.min(36,Math.max(24,Math.round(ctx.profile.fontSize*1.75))):Math.min(24,Math.max(18,Math.round(ctx.profile.fontSize*1.125)));
  const pad={left:Math.max(info.insets.left,key==='title'?88:56),right:Math.max(info.insets.right,key==='title'?48:24),top:Math.max(info.insets.top,key==='title'?8:6),bottom:Math.max(info.insets.bottom,key==='title'?8:6)};
  if(width<=pad.left+pad.right+fontSize)throw Object.assign(Error('Reference heading cannot contain its ornaments and text.'),{code:'panel.heading-capacity'});
  // Older bar artwork may reserve transparent space above and below its opaque
  // center. Its runtime still enforces that verified visible text region.
  const legacyBar=ctx.binding.sourceKind==='imported'&&!info.style.layers.length,lineHeightScale=legacyBar?1.35:1,textWidthScale=legacyBar?1.25:1;
  return {surfaceStyle:key,surfaceBand:'reference-v1',fontSize,lineHeightScale,textWidthScale,height:Math.max(height,key==='title'?64:42,Math.ceil(fontSize*1.7*lineHeightScale)+pad.top+pad.bottom,info.minHeight),insets:pad,surfaceTextInsets:pad};
 }
 const pad=layered?{
  left:Math.max(info.insets.left,border.left+8,Math.min(key==='title'?128:64,width*(key==='title'?.11:.08)+8)),
  right:Math.max(info.insets.right,border.right+8,Math.min(key==='title'?64:32,width*.06)),
  top:Math.max(info.insets.top,border.top+6),bottom:Math.max(info.insets.bottom,border.bottom+6),
 }:info.insets,line=Math.max(ctx.profile.geometry.lineHeight,Math.ceil(ctx.profile.fontSize*1.7));
 if(layered&&width<pad.left+pad.right+ctx.profile.fontSize)throw Object.assign(Error('Heading has no safe text region beside its ornament.'),{code:'panel.heading-capacity'});
 return {surfaceStyle:key,height:Math.max(height,info.minHeight,line+pad.top+pad.bottom),insets:pad,...(layered?{surfaceTextInsets:pad}:{})};
}
