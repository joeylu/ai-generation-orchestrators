import {Container,Sprite,TilingSprite,Graphics,Texture,Rectangle} from 'pixi.js';
import {surfaceStyleInfo,surfaceTextBox} from '../skins/surface-styles.mjs';
import {completeReferenceHeadingRegion,referenceHeadingLayout,referenceHeadingVersion,referenceHeadingLayer} from './heading-band.mjs';
function createHeadingBand(texture,region){
 const view=new Container(),content=new Container(),derived=[],parts=[],r=region.sourceRect,f=texture.frame,cornerMask=region.cornerCuts?new Graphics():null;
 const sections=[{x:r.x,width:region.caps.left},{x:r.x+region.caps.left,width:r.width-region.caps.left-region.caps.right},{x:r.x+r.width-region.caps.right,width:region.caps.right}];
 view.eventMode='none';view.label='reference-heading-band';view.runtimeHeadingBand=structuredClone(region);
 content.eventMode='none';view.addChild(content);
 if(cornerMask){cornerMask.eventMode='none';view.addChild(cornerMask);content.mask=cornerMask;}
 for(const section of sections){
  if(!section.width){parts.push(null);continue;}
  const frame=new Rectangle(f.x+section.x/region.sourceWidth*f.width,f.y+r.y/region.sourceHeight*f.height,section.width/region.sourceWidth*f.width,r.height/region.sourceHeight*f.height);
  const framed=new Texture({source:texture.source,frame,label:'reference-heading-part'}),part=new Sprite({texture:framed});
  derived.push(framed);parts.push(part);part.eventMode='none';content.addChild(part);
 }
 view.once('destroyed',()=>{for(const framed of derived)framed.destroy(false);});
 const resize=(width,height)=>{
  const layout=referenceHeadingLayout(region,width,height),widths=[layout.left,layout.middle,layout.right];let x=0;
  for(let i=0;i<parts.length;i++){if(parts[i]){parts[i].position.set(x,0);parts[i].width=widths[i];parts[i].height=height;}x+=widths[i];}
  if(cornerMask){
   const cuts=region.cornerCuts,s=layout.scale,corner=name=>({width:(cuts[name]?.width??0)*s,height:(cuts[name]?.height??0)*s}),tl=corner('topLeft'),tr=corner('topRight'),br=corner('bottomRight'),bl=corner('bottomLeft');
   cornerMask.clear().poly([tl.width,0,width-tr.width,0,width-tr.width,tr.height,width,tr.height,width,height-br.height,width-br.width,height-br.height,width-br.width,height,bl.width,height,bl.width,height-bl.height,0,height-bl.height,0,tl.height,tl.width,tl.height]).fill(0xffffff);
  }
  return layout;
 };
 return {view,resize,parts,derived,region,cornerMask};
}
export function createSurfaceView(skin,key,width,height,{base=true,band}={}){
 if(band!==undefined&&(band!==referenceHeadingVersion||!['title','section'].includes(key)))throw Object.assign(Error('Unsupported reference heading band.'),{code:'skin.heading-band'});
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
  const region=band&&referenceHeadingLayer(layer,texture.frame)?(skin.runtimeHeadingBands?.get(layer.assetId)??completeReferenceHeadingRegion(texture.frame.width,texture.frame.height)):null;
  const heading=region?createHeadingBand(skin.runtimeHeadingBandTextures?.get(layer.assetId)??texture,region):null;
  const item=heading?.view??(layer.mode==='tile'?new TilingSprite({texture,width:1,height:1}):new Sprite({texture}));
  item.label='material:'+layer.assetId;item.eventMode='none';item.alpha=layer.alpha??1;item.blendMode=layer.blendMode??'normal';materials.addChild(item);return {item,layer,...(heading?{heading}:{})};
 });
 const resize=(w,h)=>{
  surfaceTextBox(skin.surfaceGeometry,key,w,h);
  if(background){background.width=w;background.height=h;skin.assertView?.(style.baseRole,w,h);}
  const pad=clipInsets,box={x:pad.left,y:pad.top,width:w-pad.left-pad.right,height:h-pad.top-pad.bottom};
  if(box.width<=0||box.height<=0)throw Object.assign(Error('Surface clip area is empty.'),{code:'skin.surface-style'});
  mask.clear().roundRect(box.x,box.y,box.width,box.height,Math.min(style.radius??0,box.width/2,box.height/2)).fill(0xffffff);
  for(const {item,layer,heading}of layers){
   const scale=layer.scale??1,ax=layer.anchorX??.5,ay=layer.anchorY??.5;
   if(heading){
    heading.resize(box.width,box.height);item.position.set(box.x,box.y);
   }else if(layer.mode==='tile'){
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
 try{resize(width,height);}catch(error){view.destroy({children:true});throw error;}
 return {view,resize,style,materials,mask,layers,...(band?{surfaceBand:band,runtimeHeadingBands:layers.filter(v=>v.heading).map(v=>({assetId:v.layer.assetId,...structuredClone(v.heading.region)}))}:{})};
}
