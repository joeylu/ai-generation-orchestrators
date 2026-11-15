import {check} from './generation/common.mjs';

export const COHERENT_SAMPLING = 'display-density-2x-v1';
const gcd=(a,b)=>b?gcd(b,a%b):a;

// Storage resolution and world placement are independent. Always sample the
// native crop directly; never enlarge a previously minified asset.
export function coherentSamplingSize(crop,logical,displayScale,{platformSpan=null,nativePlatformSpan=null,margin=2}={}){
  const limit=4096-margin*2;
  if(platformSpan!==null){
    check(nativePlatformSpan>=8&&platformSpan>0,'COHERENT_SAMPLING_PLATFORM');
    const scale=Math.min(1,(platformSpan*2+2)/nativePlatformSpan,limit/crop.width,limit/crop.height);
    return {width:Math.max(1,Math.floor(crop.width*scale)),height:Math.max(1,Math.floor(crop.height*scale)),factor:null};
  }
  const quantum=gcd(gcd(logical.width,logical.height),16),ceiling=Math.max(1,Math.ceil(displayScale*2));
  const limitFactor=Math.min(ceiling,crop.width/logical.width,crop.height/logical.height,limit/logical.width,limit/logical.height);
  const units=Math.floor(limitFactor*quantum+1e-9);
  check(units>=quantum,'COHERENT_SAMPLING_NATIVE_TOO_SMALL');
  return {width:logical.width/quantum*units,height:logical.height/quantum*units,factor:{numerator:units,denominator:quantum}};
}

export function coherentSamplingStyle(style,factor){
  const previous=style??{scale:{numerator:1,denominator:1},tint:0xffffff,opacity:1};
  const n=previous.scale.numerator*factor.denominator,d=previous.scale.denominator*factor.numerator,g=gcd(n,d);
  return {...previous,scale:{numerator:n/g,denominator:d/g}};
}
