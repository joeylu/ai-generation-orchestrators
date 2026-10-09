/** Deterministic skin for the existing Select appearance contract. */
import {png,plate} from './raster-skin.mjs';
export function selectSkin(rect,optionCount,tokens,borderColor,cornerRadius=8) {
  const width=Math.ceil(rect.width),height=Math.ceil(rect.height),popupHeight=Math.max(32,height)*optionCount;
  const key=`generated/select-v1/${width}-${height}-${optionCount}-${tokens.control.slice(1)}-${borderColor.slice(1)}-${cornerRadius}`;
  const paths={field:`${key}/field.png`,popup:`${key}/popup.png`,arrow:`${key}/arrow.png`};
  const colors=[tokens.control,borderColor];
  const resources=[{path:paths.field,bytes:plate(width,height,cornerRadius,colors)},
    {path:paths.popup,bytes:plate(width,popupHeight,cornerRadius,colors)},
    {path:paths.arrow,bytes:png(12,12,[borderColor],(x,y)=>y>=3&&y<=8&&Math.abs(x-5.5)<=8-y?4:0)}]
    .map(resource=>({...resource,mime:'image/png'}));
  return {resources,appearance:{fieldImage:paths.field,arrowImage:paths.arrow,popupImage:paths.popup,
    sourceCanvas:{width,height},labelLayout:{x:12,y:0,width:width-48,height},arrowLayout:{x:width-28,y:(height-12)/2,width:12,height:12},
    popupCanvas:{width,height:popupHeight},popupContentLayout:{x:0,y:0,width,height:popupHeight},popupGap:2,fieldTextColor:tokens.text,
    menuHighlights:{version:'1.0',coordinateSpace:'popup-row-local',selected:{color:tokens.accent,alpha:.16,cornerRadius:Math.min(6,cornerRadius),insets:{top:4,right:4,bottom:4,left:4}},
      hover:{color:tokens.accent,alpha:.08,cornerRadius:Math.min(6,cornerRadius),insets:{top:4,right:4,bottom:4,left:4}}}}};
}
