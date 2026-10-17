import { Application, ImageSource, Texture, Sprite } from 'pixi.js';
import { SlicedBackground } from '../../src/runtime/sliced-background.mjs';
const data=window.SURFACE_DATA,$=id=>document.getElementById(id);
const app=new Application();
await app.init({width:720,height:400,backgroundAlpha:0,resolution:devicePixelRatio,autoDensity:true,antialias:true,preference:'webgl'});
$('canvas').append(app.canvas);
const textures=[];
for(const part of data.parts){
  const bytes=Uint8Array.from(atob(part.data),c=>c.charCodeAt(0));
  const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}),{premultiplyAlpha:'premultiply',colorSpaceConversion:'none'});
  textures.push(new Texture({source:new ImageSource({resource:bitmap,alphaMode:'premultiplied-alpha',scaleMode:'linear',autoGenerateMipmaps:true})}));
  const option=document.createElement('option');option.textContent=part.id;option.value=textures.length-1;$('part').append(option);
}
let view;
function render(){
  const index=Number($('part').value),part=data.parts[index],texture=textures[index];
  $('mode').querySelector('[value="slice"]').disabled=part.stretch==='uniform';
  if(part.stretch==='uniform')$('mode').value='uniform';
  const [w,h]=$('size').value==='native'?[part.width,part.height]:$('size').value.split('x').map(Number);
  view?.destroy();app.renderer.resize(w,h);
  if($('mode').value==='slice')view=new SlicedBackground({texture,borders:part.borders,width:w,height:h,multiplier:part.multiplier});
  else{view=new Sprite({texture});const scale=Math.min(w/part.width,h/part.height);view.scale.set(scale);view.position.set((w-view.width)/2,(h-view.height)/2);}
  app.stage.addChild(view);$('original').src='data:image/png;base64,'+part.data;
  $('original').style.width=part.width+'px';$('original').style.height=part.height+'px';
  for(const el of document.querySelectorAll('.backdrop'))el.style.background=$('background').value;
  $('info').textContent=`原裁切 ${part.width}×${part.height} · 显示 ${w}×${h} · 未修边 · 九宫格切线为试验参数`;
  app.render();window.surfacePreview={ready:true,id:part.id,width:w,height:h,mode:$('mode').value,mipLevels:texture.source.mipLevelCount};
}
for(const id of ['part','size','mode','background'])$(id).addEventListener('change',render);
render();
