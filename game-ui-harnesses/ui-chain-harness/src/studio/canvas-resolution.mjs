// Preview-only backing pixels. Keep scene/CSS dimensions and component state
// independent of zoom and screen density; no asset pixels or package changes.
export function canvasResolution({width,height,scale,devicePixelRatio=1,maxDimension=8192,maxPixels=32*1024*1024}){
 if(![width,height,scale,devicePixelRatio,maxDimension,maxPixels].every(n=>Number.isFinite(n)&&n>0))throw Error('Invalid canvas resolution inputs');
 const requested=Math.max(1,Math.ceil(scale*devicePixelRatio*4)/4);
 const limit=Math.min(maxDimension/width,maxDimension/height,Math.sqrt(maxPixels/(width*height)));
 const resolution=Math.min(requested,Math.floor(limit*4)/4);
 if(resolution<=0)throw Error('Canvas exceeds rendering budget');
 return {resolution,requested,limited:resolution<requested};
}
