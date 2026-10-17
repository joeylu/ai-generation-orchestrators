// Display-only contrast assistance for old, immutable component packages.
// Never changes the package theme, pixels, manifest, or export defaults.
const linear=v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;};
export const luminance=rgb=>.2126*linear(rgb[0])+.7152*linear(rgb[1])+.0722*linear(rgb[2]);
export function contrastInk(background){
 const light='#f5f7ff',dark='#111827',l=luminance(background),a=luminance([245,247,255]),b=luminance([17,24,39]);
 const contrast=x=>(Math.max(l,x)+.05)/(Math.min(l,x)+.05);
 return contrast(a)>=contrast(b)?{fill:light,ratio:contrast(a)}:{fill:dark,ratio:contrast(b)};
}
export function opaqueMedian(pixels){
 const colors=[];for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>=240)colors.push([pixels[i],pixels[i+1],pixels[i+2]]);
 if(colors.length<16)return null;colors.sort((a,b)=>luminance(a)-luminance(b));return colors[Math.floor(colors.length/2)];
}
export function canvasContrast({stage,skin,Text}){
 const colors=new Map(),canvas=document.createElement('canvas');canvas.width=canvas.height=24;const context=canvas.getContext('2d',{willReadFrequently:true});
 for(const [id,texture]of skin.textures){
  const bitmap=texture.source.resource,w=bitmap.width,h=bitmap.height;context.clearRect(0,0,24,24);
  context.drawImage(bitmap,w*.3,h*.3,w*.4,h*.4,0,0,24,24);
  const color=opaqueMedian(context.getImageData(0,0,24,24).data);if(color)colors.set(texture,{color,id});
 }
 let evidence=[];
 function refresh(){
  const backgrounds=[];evidence=[];
  function walk(view){
   if(!view.visible||view.alpha===0)return;
   const sampled=colors.get(view.texture);
   if(sampled)backgrounds.push({...sampled,view,box:view.getBounds()});
   if(view instanceof Text){
    const box=view.getBounds(),cx=box.x+box.width/2,cy=box.y+box.height/2;
    const behind=backgrounds.findLast(s=>cx>=s.box.x&&cx<=s.box.x+s.box.width&&cy>=s.box.y&&cy<=s.box.y+s.box.height);
    const ink=contrastInk(behind?.color??[11,16,22]);
    if(view.style.fill!==ink.fill)view.style.fill=ink.fill;
    evidence.push({text:view.text,background:behind?.id??'canvas',...ink});
   }
   for(const child of view.children??[])walk(child);
  }walk(stage);return evidence;
 }
 return {refresh,get evidence(){return evidence;}};
}
