import {surfaceTextBox} from '../skins/surface-styles.mjs';

const fail=message=>{throw Object.assign(Error(message),{code:'skin.surface-text-visible'});};
const finite=value=>Number.isFinite(value)&&value>=0;

// Find a fully opaque central rectangle, rather than treating transparent
// texture padding or a disconnected ornament's bounding box as a text surface.
// This is derived geometry only. Never crop or alter verified source pixels.
export function opaqueSurfaceTextRegion(image,{minimumAlpha=240}={}){
 const {width,height,pixels}=image;
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>4096||height>4096||pixels?.length!==width*height*4)fail('Invalid verified surface image.');
 const centerX=Math.floor(width/2),centerY=Math.floor(height/2),heights=new Uint32Array(width);
 let best=null;
 for(let y=0;y<height;y++){
  for(let x=0;x<width;x++)heights[x]=pixels[(y*width+x)*4+3]>=minimumAlpha?heights[x]+1:0;
  const stack=[];
  for(let x=0;x<=width;x++){
   const current=x===width?0:heights[x];let start=x;
   while(stack.length&&stack.at(-1).height>current){
    const value=stack.pop(),rect={x:value.start,y:y-value.height+1,width:x-value.start,height:value.height};start=value.start;
    if(rect.x<=centerX&&rect.x+rect.width>centerX&&rect.y<=centerY&&rect.y+rect.height>centerY){
     const area=rect.width*rect.height;
     if(!best||area>best.area||area===best.area&&rect.width>best.rect.width)best={rect,area};
    }
   }
   if(current&&(!stack.length||stack.at(-1).height<current))stack.push({start,height:current});
  }
 }
 return best?{rect:best.rect,minimumAlpha,sourceWidth:width,sourceHeight:height,method:'largest-opaque-center-rectangle-v1'}:null;
}

// Coordinate conversion mirrors an actual NineSliceSprite: fixed corner bands
// and a stretched middle. Normalized bounding-box multiplication is incorrect.
export function mapSliceCoordinate(value,sourceSize,targetSize,startBorder,endBorder){
 if(![value,sourceSize,targetSize,startBorder,endBorder].every(finite)||sourceSize<=0||targetSize<=0||value>sourceSize||startBorder+endBorder>=sourceSize||targetSize<startBorder+endBorder)fail('Invalid nine-slice text mapping.');
 if(value<=startBorder)return value;
 if(value>=sourceSize-endBorder)return targetSize-(sourceSize-value);
 return startBorder+(value-startBorder)*(targetSize-startBorder-endBorder)/(sourceSize-startBorder-endBorder);
}
export function mapSurfaceTextRegion(asset,scale,region,width,height){
 const resolution=scale*(asset.density??1),sourceWidth=asset.width/resolution,sourceHeight=asset.height/resolution;
 if(!(resolution>0)||region.sourceWidth!==asset.width||region.sourceHeight!==asset.height)fail('Surface region differs from its verified asset.');
 const r=region.rect,b=asset.nineSlice;
 const map=(value,axis)=>asset.stretch==='uniform'?value/resolution/(axis==='x'?sourceWidth:sourceHeight)*(axis==='x'?width:height):
  mapSliceCoordinate(value/resolution,axis==='x'?sourceWidth:sourceHeight,axis==='x'?width:height,axis==='x'?b.left:b.top,axis==='x'?b.right:b.bottom);
 const x=map(r.x,'x'),y=map(r.y,'y'),right=map(r.x+r.width,'x'),bottom=map(r.y+r.height,'y');
 return {x,y,width:right-x,height:bottom-y};
}
export function prepareSurfaceTextRegions(pack,images){
 const roles=new Set(['skin.surface.bar']);
 for(const key of ['title','section']){const style=pack.surfaceStyles?.[key];if(style&&style.baseMode!=='replace'&&!style.layers.length)roles.add(style.baseRole);}
 const result=new Map();
 for(const {role,assetId}of pack.roles)if(roles.has(role)&&!result.has(assetId)){
  const image=images.get(assetId);if(!image)fail('Missing verified surface pixels.');
  result.set(assetId,opaqueSurfaceTextRegion(image));
 }
 return result;
}
export function runtimeSurfaceTextBox(skin,key,width,height,overrideInsets){
 const base=surfaceTextBox(skin.surfaceGeometry,key,width,height,overrideInsets);
 // An absent explicit marker keeps historical rendering byte-for-byte logical
// geometry. Existing material compositions retain their own frozen safe area.
 if(!overrideInsets||!skin.runtimeSurfaceTextRegions||base.style.baseMode==='replace'||base.style.layers.length)return base;
 const region=skin.runtimeSurfaceTextRegions.get(base.asset.assetId);
 if(!region)fail('No fully opaque central region for the explicit new heading.');
 const mapped=mapSurfaceTextRegion(base.asset,skin.surfaceGeometry.scale??1,region,width,height);
 // Leave room inside the visible art without modifying authored insets. The
// complete text must still fit this intersection in runtime preflight.
 const x=Math.max(base.x,mapped.x+8),y=Math.max(base.y,mapped.y+1);
 const right=Math.min(base.x+base.width,mapped.x+mapped.width-8),bottom=Math.min(base.y+base.height,mapped.y+mapped.height-1);
 if(right<=x||bottom<=y)fail('Visible text region is empty.');
 return {...base,x,y,width:right-x,height:bottom-y,insets:{left:x,right:width-right,top:y,bottom:height-bottom},
  runtimeTextRegion:{assetId:base.asset.assetId,sourceRect:{...region.rect},mappedRect:mapped,minimumAlpha:region.minimumAlpha}};
}
