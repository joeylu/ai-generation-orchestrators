import {resampleArea,cropPng,allocate} from './raster.mjs';

// Horizontal rails preserve the cap aspect ratio while their middle fills the slot.
export function fitHorizontalAsset(source,width,height,caps){
  if(!Array.isArray(caps)||caps.length!==2||caps.some(n=>!Number.isInteger(n)||n<=0)||caps[0]+caps[1]>=source.width||![width,height].every(n=>Number.isInteger(n)&&n>0&&n<=4096))throw Error('Invalid horizontal slice fit');
  const scale=height/source.height,ends=caps.map(n=>Math.max(1,Math.round(n*scale)));
  if(ends[0]+ends[1]>=width)throw Error('Horizontal slice target is too short');
  const sourceWidths=[caps[0],source.width-caps[0]-caps[1],caps[1]],targetWidths=[ends[0],width-ends[0]-ends[1],ends[1]],image={width,height,pixels:allocate(width*height*4)};
  let sx=0,dx=0;
  for(let i=0;i<3;i++){
    const band=resampleArea(cropPng(source,[sx,0,sourceWidths[i],source.height]),targetWidths[i],height);
    for(let y=0;y<height;y++)image.pixels.set(band.pixels.subarray(y*band.width*4,(y+1)*band.width*4),(y*width+dx)*4);
    sx+=sourceWidths[i];dx+=targetWidths[i];
  }
  return{image,operation:{method:'horizontal-slice',sourceCaps:caps,targetCaps:ends,scale}};
}
export function fitSlicedAsset(source,width,height,fit){
  if(fit.method==='vertical-slice')return fitVerticalAsset(source,width,height,fit.caps);
  if(fit.method==='horizontal-slice')return fitHorizontalAsset(source,width,height,fit.caps);
  throw Error('Invalid slice fit method');
}
export function supportsSliceFit(fit,stretch,group){
  return !group&&['vertical','horizontal'].includes(stretch)&&fit.method===stretch+'-slice';
}

// Vertical rails fill their slot by resizing the middle, not by letterboxing.
// Cap dimensions are source pixels and retain the same scale as the width.
export function fitVerticalAsset(source,width,height,caps){
  if(!Array.isArray(caps)||caps.length!==2||caps.some(n=>!Number.isInteger(n)||n<=0)||caps[0]+caps[1]>=source.height||![width,height].every(n=>Number.isInteger(n)&&n>0&&n<=4096))throw Error('Invalid vertical slice fit');
  const scale=width/source.width,ends=caps.map(n=>Math.max(1,Math.round(n*scale)));
  if(ends[0]+ends[1]>=height)throw Error('Vertical slice target is too short');
  const sourceHeights=[caps[0],source.height-caps[0]-caps[1],caps[1]],targetHeights=[ends[0],height-ends[0]-ends[1],ends[1]],image={width,height,pixels:allocate(width*height*4)};
  let sy=0,dy=0;
  for(let i=0;i<3;i++){
    const band=resampleArea(cropPng(source,[0,sy,source.width,sourceHeights[i]]),width,targetHeights[i]);
    image.pixels.set(band.pixels,dy*width*4);sy+=sourceHeights[i];dy+=targetHeights[i];
  }
  return{image,operation:{method:'vertical-slice',sourceCaps:caps,targetCaps:ends,scale}};
}
// Contain without changing aspect. State families share an identical source frame
// and destination scale, but no alpha masks or artwork colors are rewritten.
export function fitAsset(source,width,height,frame=[source.width,source.height]){
  if(![width,height,...frame].every(n=>Number.isInteger(n)&&n>0&&n<=4096)||frame[0]<source.width||frame[1]<source.height)throw Error('Invalid asset frame');
  const padded={width:frame[0],height:frame[1],pixels:allocate(frame[0]*frame[1]*4)};
  const sourceOffset=[Math.floor((frame[0]-source.width)/2),Math.floor((frame[1]-source.height)/2)];
  for(let y=0;y<source.height;y++)padded.pixels.set(source.pixels.subarray(y*source.width*4,(y+1)*source.width*4),((sourceOffset[1]+y)*frame[0]+sourceOffset[0])*4);
  const scale=Math.min(width/frame[0],height/frame[1]),w=Math.max(1,Math.round(frame[0]*scale)),h=Math.max(1,Math.round(frame[1]*scale));
  const resized=resampleArea(padded,w,h),offset=[Math.floor((width-w)/2),Math.floor((height-h)/2)],image={width,height,pixels:allocate(width*height*4)};
  for(let y=0;y<h;y++)image.pixels.set(resized.pixels.subarray(y*w*4,(y+1)*w*4),((offset[1]+y)*width+offset[0])*4);
  return{image,operation:{method:'uniform-contain-shared-frame',frame,sourceOffset,scale,resized:[w,h],offset}};
}
