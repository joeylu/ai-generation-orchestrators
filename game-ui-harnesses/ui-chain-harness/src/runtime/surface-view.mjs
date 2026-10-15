import {Container,Sprite,TilingSprite,Graphics} from 'pixi.js';
import {surfaceStyleInfo,surfaceTextBox} from '../skins/surface-styles.mjs';
export function createSurfaceView(skin,key,width,height,{base=true}={}){
 const info=surfaceStyleInfo(skin.surfaceGeometry,key);
 if(!info)throw Object.assign(Error('Surface style is unavailable.'),{code:'skin.surface-style'});
 const {style,clipInsets}=info,view=new Container();view.eventMode='none';view.label='surface:'+key;
 view.surfaceCompositing=style.layers.length>0;
 const background=base&&style.baseMode!=='replace'?skin.view(style.baseRole,width,height):null;
 if(background)view.addChild(background);
 const materials=new Container(),mask=new Graphics();materials.eventMode='none';mask.eventMode='none';
 view.addChild(materials,mask);materials.mask=mask;
 const layers=style.layers.map(layer=>{
  const texture=skin.textures.get(layer.assetId);
  if(!texture)throw Object.assign(Error('Surface material is unavailable.'),{code:'skin.surface-style'});
  const item=layer.mode==='tile'?new TilingSprite({texture,width:1,height:1}):new Sprite({texture});
  item.label='material:'+layer.assetId;item.eventMode='none';item.alpha=layer.alpha??1;item.blendMode=layer.blendMode??'normal';materials.addChild(item);return {item,layer};
 });
 const resize=(w,h)=>{
  surfaceTextBox(skin.surfaceGeometry,key,w,h);
  if(background){background.width=w;background.height=h;skin.assertView?.(style.baseRole,w,h);}
  const pad=clipInsets,box={x:pad.left,y:pad.top,width:w-pad.left-pad.right,height:h-pad.top-pad.bottom};
  if(box.width<=0||box.height<=0)throw Object.assign(Error('Surface clip area is empty.'),{code:'skin.surface-style'});
  mask.clear().roundRect(box.x,box.y,box.width,box.height,Math.min(style.radius??0,box.width/2,box.height/2)).fill(0xffffff);
  for(const {item,layer}of layers){
   const scale=layer.scale??1,ax=layer.anchorX??.5,ay=layer.anchorY??.5;
   if(layer.mode==='tile'){
    item.position.set(box.x,box.y);item.width=box.width;item.height=box.height;
    item.tileScale.set(scale);item.tilePosition.set(layer.offsetX??0,layer.offsetY??0);
   }else{
    const bw=layer.width??box.width,bh=layer.height??box.height;
    const factor=(layer.mode==='cover'?Math.max:Math.min)(bw/item.texture.orig.width,bh/item.texture.orig.height)*scale;
    item.scale.set(factor);item.position.set(box.x+(box.width-item.width)*ax+(layer.offsetX??0),box.y+(box.height-item.height)*ay+(layer.offsetY??0));
   }
  }
  return box;
 };
 resize(width,height);
 return {view,resize,style,materials,mask,layers};
}
