// Shared, provider-neutral appearance contract. These are visual recipes for
// existing Text/Panel nodes, not new interactive component types.
const sides=['left','right','top','bottom'];
const fail=message=>{throw Object.assign(Error(message),{code:'skin.surface-style'});};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k));
const number=(v,min,max)=>Number.isFinite(v)&&v>=min&&v<=max;
const insets=v=>exact(v,sides)&&sides.every(k=>number(v[k],0,512));
export function validateMaterialAsset(a){
 if(!exact(a,['assetId','file','sha256','bytes','width','height','source'])||!/^material\.[a-z][a-z0-9.-]{0,80}$/.test(a.assetId)||!a.source)fail('Invalid material record.');
 const s=a.source;
 if(!exact(s,['file','sha256','bytes','width','height','crop']))fail('Invalid material source.');
 for(const f of [a,s])if(typeof f.file!=='string'||!/^[a-f0-9]{64}$/.test(f.sha256)||!Number.isSafeInteger(f.bytes)||f.bytes<1||f.bytes>32*1024*1024||![f.width,f.height].every(n=>Number.isInteger(n)&&n>0&&n<=4096))fail('Invalid material dimensions or digest.');
 if(!Array.isArray(s.crop)||s.crop.length!==4||!s.crop.every(Number.isInteger)||s.crop.some(n=>n<0)||s.crop[2]!==a.width||s.crop[3]!==a.height||s.crop[0]+a.width>s.width||s.crop[1]+a.height>s.height)fail('Invalid material crop.');
}
export function materialFiles(pack){return (pack.materialAssets??[]).flatMap(a=>[a,a.source]);}
export function validateSurfaceStyles(styles={},assetIds=[],roles=[]){
 if(!exact(styles,['title','section','panel']))fail('Unknown surface style.');
 for(const [key,style] of Object.entries(styles)){
  if(!exact(style,['baseRole','baseMode','insets','clipInsets','radius','layers','textColor'])||!roles.includes(style.baseRole)||!Array.isArray(style.layers)||style.layers.length>12)fail('Invalid surface style or base role.');
  if(style.baseMode!==undefined&&!['overlay','replace'].includes(style.baseMode))fail('Invalid surface base mode.');
  if(style.baseMode==='replace'&&(key==='panel'||!style.layers.length))fail('Replacement requires a title material; panel materials overlay their existing background.');
  for(const key of ['insets','clipInsets'])if(style[key]!==undefined&&!insets(style[key]))fail('Invalid surface insets.');
  if(style.radius!==undefined&&!number(style.radius,0,256))fail('Invalid surface radius.');
  if(style.textColor!==undefined&&!/^#[a-fA-F0-9]{6}$/.test(style.textColor))fail('Invalid surface text color.');
  for(const layer of style.layers){
   if(!exact(layer,['assetId','mode','scale','anchorX','anchorY','width','height','offsetX','offsetY','alpha','blendMode'])||!assetIds.includes(layer.assetId)||!['tile','contain','cover'].includes(layer.mode))fail('Invalid surface material reference.');
   for(const key of ['anchorX','anchorY','alpha'])if(layer[key]!==undefined&&!number(layer[key],0,1))fail('Invalid surface anchor or alpha.');
   if(layer.scale!==undefined&&!number(layer.scale,.1,8))fail('Invalid material scale.');
   for(const key of ['width','height'])if(layer[key]!==undefined&&!number(layer[key],1,4096))fail('Invalid material size.');
   for(const key of ['offsetX','offsetY'])if(layer[key]!==undefined&&!number(layer[key],-4096,4096))fail('Invalid material offset.');
   if(layer.blendMode!==undefined&&!['normal','multiply','screen'].includes(layer.blendMode))fail('Invalid material blend.');
  }
 }
 return styles;
}
export function surfaceStyleInfo(geometry,key){
 if(!['title','section','panel'].includes(key))fail('Unknown surface style.');
 if(!geometry)return null;
 const fallback=key==='panel'?null:{baseRole:'skin.surface.bar',layers:[]};
 const style=geometry.surfaceStyles?.[key]??fallback;
 if(!style)return null;
 const assetId=geometry.roles.find(r=>r.role===style.baseRole)?.assetId;
 const asset=geometry.assets.find(a=>a.assetId===assetId);
 if(!asset)fail('Surface base role is unavailable.');
 const pad=style.insets??Object.fromEntries(sides.map(k=>[k,Math.max(asset.contentInsets[k],key==='panel'?0:['left','right'].includes(k)?12:4)]));
 const replace=style.baseMode==='replace',clip=style.clipInsets??(replace?{left:0,right:0,top:0,bottom:0}:asset.nineSlice);
 if(sides.some(k=>pad[k]<asset.contentInsets[k]||(!replace&&clip[k]<asset.nineSlice[k])))fail('Surface insets intrude into the skin border.');
 return {style,asset,insets:{...pad},clipInsets:{...clip},minWidth:Math.max(asset.minSize.width,pad.left+pad.right+1,clip.left+clip.right+1),minHeight:Math.max(asset.minSize.height,pad.top+pad.bottom+1,clip.top+clip.bottom+1)};
}
export function surfaceTextBox(geometry,key,width,height,overrideInsets){
 const info=surfaceStyleInfo(geometry,key);
 if(!info)fail('Surface geometry is missing.');
 const p=overrideInsets??info.insets;
 if(overrideInsets&&(!insets(overrideInsets)||sides.some(k=>overrideInsets[k]<info.insets[k])))fail('Text insets intrude into the frozen surface safe area.');
 if(width<info.minWidth||height<info.minHeight)fail('Surface is smaller than its skin minimum.');
 if(width<=p.left+p.right||height<=p.top+p.bottom)fail('Surface text safe area is empty.');
 return {x:p.left,y:p.top,width:width-p.left-p.right,height:height-p.top-p.bottom,...info,insets:{...p}};
}

export const surfaceLayers=Object.freeze(['frame','content','inset']);
export const surfaceLayerTypes=Object.freeze(['Panel','Dialog','ScrollView','Tabs','List']);
// Explicit document presentation, independent of the immutable skin recipe.
// The inset samples the complete safe central region, never an inferred color.
export function surfaceLayerInfo(geometry,layer,scale=1){
 if(!surfaceLayers.includes(layer))fail('Unknown surface layer.');
 if(!number(scale,1,4)||layer!=='frame'&&scale!==1)fail('Surface scale requires a frame and must be between 1 and 4.');
 if(!geometry)return null;
 const materialStyle=layer==='frame'&&geometry.surfaceStyles?.panel?'panel':null,style=materialStyle?geometry.surfaceStyles.panel:null;
 const baseRole=layer==='frame'?style?.baseRole??'skin.surface.panel':'skin.surface.content';
 const assetId=geometry.roles instanceof Map?geometry.roles.get(baseRole):geometry.roles?.find(r=>r.role===baseRole)?.assetId;
 const asset=geometry.metadata instanceof Map?geometry.metadata.get(assetId):geometry.assets?.find(a=>a.assetId===assetId);
 if(!asset)fail('Surface layer base role is unavailable.');
 const nativePad=geometry.insets?geometry.insets(baseRole):asset.contentInsets;
 const border=asset.nineSlice??Object.fromEntries(sides.map(k=>[k,asset.slice??0]));
 if(!nativePad||sides.some(k=>!Number.isFinite(nativePad[k])||nativePad[k]<0||!Number.isFinite(border[k])||border[k]<0))fail('Surface layer geometry is invalid.');
 // Older packs may have declared zero content insets around a visible frame.
 // Explicit new layers reserve that frame and breathing room without changing
 // the source metadata or the meaning of an unmarked historic document.
 const basePad=style?.insets??Object.fromEntries(sides.map(k=>[k,layer==='content'?Math.max(nativePad[k],border[k]+8):layer==='inset'?Math.max(nativePad[k],8):nativePad[k]]));
 const pad=Object.fromEntries(sides.map(k=>[k,basePad[k]*scale]));
 const resolution=(geometry.scale??geometry.surfaceGeometry?.scale??1)*(asset.density??1),width=asset.width/resolution,height=asset.height/resolution;
 const cut=Object.fromEntries(sides.map(k=>[k,Math.max(nativePad[k],border[k])]));
 const sample={x:cut.left,y:cut.top,width:width-cut.left-cut.right,height:height-cut.top-cut.bottom,sourceWidth:width,sourceHeight:height};
 if(layer==='inset'&&(sample.width<2||sample.height<2))fail('Inset material needs a safe central region of at least 2 × 2 pixels.');
 const baseClip=style?.clipInsets??border,clip=Object.fromEntries(sides.map(k=>[k,baseClip[k]*scale]));
 return {layer,scale,baseRole,asset,insets:{...pad},clipInsets:clip,minWidth:Math.max(asset.minSize?.width??1,basePad.left+basePad.right+1,baseClip.left+baseClip.right+1)*scale,minHeight:Math.max(asset.minSize?.height??1,basePad.top+basePad.bottom+1,baseClip.top+baseClip.bottom+1)*scale,materialStyle,...(layer==='inset'?{sample}:{})};
}
