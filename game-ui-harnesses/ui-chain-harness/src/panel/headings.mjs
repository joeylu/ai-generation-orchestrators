import {surfaceStyleInfo} from '../skins/surface-styles.mjs';
// Semantic visual recipes use verified skin metadata. Historic documents remain
// plain Text; only newly compiled headings opt into the surface.
export function headingPresentation(ctx,key,width,height){
 if(ctx.surfaceStylesEnabled===false)return {height,insets:{left:0,right:0,top:0,bottom:0}};
 const info=surfaceStyleInfo(ctx.skinGeometry,key);
 if(!info)return {height,insets:{left:0,right:0,top:0,bottom:0}};
 if(width<info.minWidth)throw Object.assign(Error('Heading is narrower than its skin minimum.'),{code:'panel.heading-capacity'});
 const pad=info.insets,line=Math.max(ctx.profile.geometry.lineHeight,Math.ceil(ctx.profile.fontSize*1.7));
 return {surfaceStyle:key,height:Math.max(height,info.minHeight,line+pad.top+pad.bottom),insets:pad};
}
