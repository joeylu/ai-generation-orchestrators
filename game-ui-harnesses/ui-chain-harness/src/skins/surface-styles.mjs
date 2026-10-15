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
export function surfaceTextBox(geometry,key,width,height){
 const info=surfaceStyleInfo(geometry,key);
 if(!info)fail('Surface geometry is missing.');
 const p=info.insets;
 if(width<info.minWidth||height<info.minHeight)fail('Surface is smaller than its skin minimum.');
 return {x:p.left,y:p.top,width:width-p.left-p.right,height:height-p.top-p.bottom,...info};
}
