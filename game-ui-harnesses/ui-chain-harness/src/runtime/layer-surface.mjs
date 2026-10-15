import {Container,Rectangle,Sprite,Texture,Graphics} from 'pixi.js';
import {surfaceLayerInfo} from '../skins/surface-styles.mjs';
import {createSurfaceView} from './surface-view.mjs';

// One owner per view. Derived texture frames share the verified source, and
// release only their own UV frame when the display tree is destroyed.
export function createLayerSurface(skin,layer,width,height){
 const info=surfaceLayerInfo(skin.surfaceGeometry??skin,layer),view=new Container();
 view.eventMode='none';view.label='surface-layer:'+layer;
 let background,material=null,derived=null;
 if(info.materialStyle){material=createSurfaceView(skin,info.materialStyle,width,height);background=material.view;}
 else if(layer==='inset'){
  const texture=skin.texture(info.baseRole),s=info.sample,f=texture.frame;
  derived=new Texture({source:texture.source,frame:new Rectangle(f.x+s.x/s.sourceWidth*f.width,f.y+s.y/s.sourceHeight*f.height,s.width/s.sourceWidth*f.width,s.height/s.sourceHeight*f.height),label:'surface-inset:'+info.asset.assetId});
  background=new Sprite({texture:derived});
  background.surfaceBaseRole=info.baseRole;
  view.once('destroyed',()=>derived.destroy(false));
 }else background=skin.view(info.baseRole,width,height);
 background.eventMode='none';view.addChild(background);
 const outline=layer==='inset'?new Graphics():null;
 if(outline){outline.eventMode='none';view.addChild(outline);}
 const resize=(w,h)=>{
  if(!Number.isFinite(w)||!Number.isFinite(h)||w<info.minWidth||h<info.minHeight)throw Object.assign(Error('Surface layer is smaller than its skin minimum.'),{code:'skin.surface-style'});
  if(material)material.resize(w,h);else {skin.assertView?.(info.baseRole,w,h);background.width=w;background.height=h;}
  if(outline){const color=skin.runtimeRoleInk?.(info.baseRole,{enhanced:true})?.fill??skin.profile.textColors?.[info.baseRole]??skin.profile.palette.text;outline.clear().rect(.5,.5,w-1,h-1).stroke({color,width:1,alpha:.14});}
 };
 try{resize(width,height);}catch(e){view.destroy({children:true});throw e;}
 return {view,background,material,outline,info,resize,get derivedTexture(){return derived;}};
}
