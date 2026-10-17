// Shared byte-exact crop and premultiplied area resampling for Node and browser.
export const allocate = n => typeof Buffer === 'undefined' ? new Uint8Array(n) : Buffer.alloc(n);
const rasterError=(code,message)=>{throw Object.assign(Error(message),{code});};
export function resampleArea(image,width,height,mapX=t=>t*image.width/width,mapY=t=>t*image.height/height){
  if(![width,height].every(n=>Number.isInteger(n)&&n>0&&n<=4096))rasterError('skin.normalize','Invalid resampling size.');
  const pixels=allocate(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const x0=Math.max(0,mapX(x)),x1=Math.min(image.width,mapX(x+1)),y0=Math.max(0,mapY(y)),y1=Math.min(image.height,mapY(y+1));
    const area=(x1-x0)*(y1-y0);if(!Number.isFinite(area)||area<=0)rasterError('skin.normalize','Invalid resampling map.');
    let alpha=0,r=0,g=0,b=0;
    for(let sy=Math.floor(y0);sy<Math.ceil(y1);sy++)for(let sx=Math.floor(x0);sx<Math.ceil(x1);sx++){
      const weight=(Math.min(x1,sx+1)-Math.max(x0,sx))*(Math.min(y1,sy+1)-Math.max(y0,sy));
      const i=(sy*image.width+sx)*4,wa=weight*image.pixels[i+3];alpha+=wa;r+=wa*image.pixels[i];g+=wa*image.pixels[i+1];b+=wa*image.pixels[i+2];
    }
    const j=(y*width+x)*4,a=Math.round(alpha/area);pixels[j+3]=a;
    if(a){pixels[j]=Math.round(r/alpha);pixels[j+1]=Math.round(g/alpha);pixels[j+2]=Math.round(b/alpha);}
  }
  return {width,height,pixels};
}
export function cropPng(image, [x,y,width,height]) {
  if (![x,y,width,height].every(Number.isInteger) || x < 0 || y < 0 || width <= 0 || height <= 0 || x+width > image.width || y+height > image.height) rasterError('skin.png','Crop exceeds source.');
  const pixels = allocate(width * height * 4);
  for (let row=0; row<height; row++) pixels.set(image.pixels.subarray(((y+row)*image.width+x)*4, ((y+row)*image.width+x+width)*4), row*width*4);
  return { width, height, pixels };
}
