import {surfaceStyleInfo} from '../skins/surface-styles.mjs';
// Semantic visual recipes use verified skin metadata. Historic documents remain
// plain Text; only newly compiled headings opt into the surface.
export function headingPresentation(ctx,key,width,height,{layered=ctx.surfaceLayersEnabled===true}={}){
 if(ctx.surfaceStylesEnabled===false)return {height,insets:{left:0,right:0,top:0,bottom:0}};
 const info=surfaceStyleInfo(ctx.skinGeometry,key);
 if(!info)return {height,insets:{left:0,right:0,top:0,bottom:0}};
 if(width<info.minWidth)throw Object.assign(Error('Heading is narrower than its skin minimum.'),{code:'panel.heading-capacity'});
 const border=info.clipInsets,pad=layered?{
  left:Math.max(info.insets.left,border.left+8,Math.min(key==='title'?128:64,width*(key==='title'?.11:.08)+8)),
  right:Math.max(info.insets.right,border.right+8,Math.min(key==='title'?64:32,width*.06)),
  top:Math.max(info.insets.top,border.top+6),bottom:Math.max(info.insets.bottom,border.bottom+6),
 }:info.insets,line=Math.max(ctx.profile.geometry.lineHeight,Math.ceil(ctx.profile.fontSize*1.7));
 if(layered&&width<pad.left+pad.right+ctx.profile.fontSize)throw Object.assign(Error('Heading has no safe text region beside its ornament.'),{code:'panel.heading-capacity'});
 return {surfaceStyle:key,height:Math.max(height,info.minHeight,line+pad.top+pad.bottom),insets:pad,...(layered?{surfaceTextInsets:pad}:{})};
}
