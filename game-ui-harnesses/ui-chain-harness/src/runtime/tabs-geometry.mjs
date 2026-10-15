import {scrollPadding} from './scroll-geometry.mjs';

// An outer surface wraps the header and a separate, padded content surface. Page authors use this
// same geometry; child controls keep their own dimensions and interaction state.
export function tabsContentBox(profile, insets, width, height) {
  const headerHeight=profile.itemHeight+profile.geometry.labelGap;
  const outerPad=insets?scrollPadding(profile,insets):{left:0,right:0,top:0,bottom:0};
  const pad=Object.fromEntries(Object.entries(outerPad).map(([key,value])=>[key,value*2]));
  const surface={x:outerPad.left,y:outerPad.top+headerHeight,
    width:width-outerPad.left-outerPad.right,height:height-headerHeight-outerPad.top-outerPad.bottom};
  return {headerHeight,outerPad,surface,pad,x:pad.left,y:headerHeight+pad.top,
    width:width-pad.left-pad.right,height:height-headerHeight-pad.top-pad.bottom};
}
