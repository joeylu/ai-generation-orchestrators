import {terrainStudyTextureKey} from '../pixi/terrain-appearance.mjs';
const ns='http://www.w3.org/2000/svg';
let nextId=0;
function element(tag,attrs={}){const e=document.createElementNS(ns,tag);for(const [key,value]of Object.entries(attrs))e.setAttribute(key,String(value));return e;}
export function presetThumbnail(preset,metadata,appearance='fixture'){
  const {bounds,nodes}=preset.thumbnail,padding=Math.max(bounds.width,bounds.height)*.025;
  const svg=element('svg',{viewBox:`${bounds.x-padding} ${bounds.y-padding} ${bounds.width+padding*2} ${bounds.height+padding*2}`,'aria-hidden':true});svg.classList.add('preset-art-preview');
  const defs=element('defs'),filters=new Map();svg.append(defs);const prefix=`preset-art-${++nextId}`;
  for(const node of nodes){
    const module=metadata.modules.find(m=>m.assetId===node.assetId);if(!module)throw Error('组合预览缺少已校验的素材。');
    const key=appearance==='study'?terrainStudyTextureKey(node):null,url=key?metadata.terrainPreview.modules.find(m=>m.key===key)?.url:module.url;if(!url)throw Error('组合预览缺少地形材质。');
    const image=element('image',{href:url,x:node.position.x,y:node.position.y,width:node.size.width,height:node.size.height,preserveAspectRatio:'none',opacity:node.renderStyle?.opacity??1});
    const tint=node.renderStyle?.tint??0xffffff;
    if(tint!==0xffffff){
      if(!filters.has(tint)){const id=`${prefix}-${tint}`,filter=element('filter',{id,'color-interpolation-filters':'sRGB'});filter.append(element('feColorMatrix',{type:'matrix',values:`${((tint>>16)&255)/255} 0 0 0 0 0 ${((tint>>8)&255)/255} 0 0 0 0 0 ${(tint&255)/255} 0 0 0 0 0 1 0`}));defs.append(filter);filters.set(tint,id);}
      image.setAttribute('filter',`url(#${filters.get(tint)})`);
    }
    svg.append(image);
  }
  return svg;
}
