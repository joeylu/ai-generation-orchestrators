import {rgbaPng} from './raster-skin.mjs';

export function raisedSliderPalette(surface) {
  const rgb=[1,3,5].map(index=>parseInt(surface.slice(index,index+2),16)/255);
  const dark=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722<.5;
  return {face:'#FFFFFF',edge:dark?'#B6B6BF':'#85858F',track:dark?'#777782':'#85858F'};
}

/** 28px face, 1px opaque rim, padded 36px image with a soft shadow underneath. */
export function raisedSliderThumb(pixelScale,palette) {
  const edge=[1,3,5].map(index=>parseInt(palette.edge.slice(index,index+2),16)),size=36*pixelScale;
  return rgbaPng(size,size,(px,py)=>{
    const sum=[0,0,0,0];
    for(const dx of [.125,.375,.625,.875])for(const dy of [.125,.375,.625,.875]){
      const x=(px+dx)/pixelScale,y=(py+dy)/pixelScale,distance=Math.hypot(x-18,y-16);
      if(distance<=14){const color=distance<=13?[255,255,255]:edge;for(let channel=0;channel<3;channel++)sum[channel]+=color[channel];sum[3]++;}
      else{
        const shadowDistance=Math.hypot(x-18,y-18);
        const alpha=shadowDistance<16?.2*Math.exp(-(Math.max(0,shadowDistance-12)**2)/8):0;
        sum[3]+=alpha; // Black shadow has zero premultiplied RGB.
      }
    }
    const alpha=Math.round(sum[3]*255/16);
    return alpha?[...sum.slice(0,3).map(channel=>Math.round(channel/sum[3])),alpha]:[0,0,0,0];
  });
}
