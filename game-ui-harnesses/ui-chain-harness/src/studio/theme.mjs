import {decodePng} from '../skins/png.mjs';
// A bounded, documented center sample, not a visual approval or palette inference.
export function sampledTextTheme(raw,part,canvas){
 const image=decodePng(raw),[x,y,width,height]=part.bodyRect,box={x,y,width,height};
 const sx=image.width/canvas.width,sy=image.height/canvas.height;
 const x0=Math.floor((box.x+box.width*.3)*sx),x1=Math.ceil((box.x+box.width*.7)*sx);
 const y0=Math.floor((box.y+box.height*.3)*sy),y1=Math.ceil((box.y+box.height*.7)*sy),values=[];
 const linear=x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;};
 for(let y=Math.max(0,y0);y<Math.min(image.height,y1);y+=3)for(let x=Math.max(0,x0);x<Math.min(image.width,x1);x+=3){const i=(y*image.width+x)*4;if(image.pixels[i+3]<240)continue;values.push(.2126*linear(image.pixels[i])+.7152*linear(image.pixels[i+1])+.0722*linear(image.pixels[i+2]));}
 if(values.length<16)throw Error('STUDIO_THEME_SAMPLE_EMPTY');
 values.sort((a,b)=>a-b);const luminance=values[Math.floor(values.length/2)],text=luminance>.179?'#151923':'#F5F7FF';
 return {text,evidence:{policy:'opaque-surface-center-median-v1',assetId:part.assetId,samples:values.length,luminance,text,requiresVisualReview:true}};
}
