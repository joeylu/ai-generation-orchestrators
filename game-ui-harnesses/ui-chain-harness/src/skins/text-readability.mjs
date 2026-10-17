import policy from '../../configs/text-readability-policy.json' with {type:'json'};
export {policy as textReadabilityPolicy};
export const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
const linear=v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;};
export const luminance=color=>.2126*linear(color[0])+.7152*linear(color[1])+.0722*linear(color[2]);
export const contrastRatio=(a,b)=>{const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
export const bestInk=background=>contrastRatio(rgb(policy.light),background)>=contrastRatio(rgb(policy.dark),background)?policy.light:policy.dark;
export const textRoles=pack=>pack.roles.filter(b=>new RegExp(policy.surfaceRolePattern).test(b.role));

// Sample across the inset content area, not just its center. Source coordinates
// are pixels, while declared content insets are logical units.
export function sampleSurface(image,asset,scale){
 scale*=asset.density??1;
 const pad=asset.contentInsets,edge=axis=>axis==='x'?['left','right',image.width]:['top','bottom',image.height];
 const range=axis=>{const[a,b,size]=edge(axis);return [Math.max(pad[a]*scale,size*.15),Math.min(size-pad[b]*scale,size*.85)];};
 const [x0,x1]=range('x'),[y0,y1]=range('y'),colors=[];let transparent=0;
 if(x1<=x0||y1<=y0)return {colors,transparent};
 const seen=new Set();
 for(let y=0;y<policy.sampleGrid;y++)for(let x=0;x<policy.sampleGrid;x++){
  const px=Math.min(image.width-1,Math.max(0,Math.floor(x0+(x+.5)*(x1-x0)/policy.sampleGrid))),py=Math.min(image.height-1,Math.max(0,Math.floor(y0+(y+.5)*(y1-y0)/policy.sampleGrid))),i=(py*image.width+px)*4;
  if(seen.has(i))continue;seen.add(i);
  if(image.pixels[i+3]<policy.minimumAlpha){transparent++;continue;}colors.push([...image.pixels.slice(i,i+3)]);
 }return {colors,transparent};
}
export function deriveTextReadability(pack,images,{preserve=true}={}){
 const inks={},checks=[];
 const validRoles=new Set(textRoles(pack).map(b=>b.role));
 if(Object.keys(pack.theme.textColors??{}).some(role=>!validRoles.has(role)))throw Object.assign(Error('Unknown text surface role.'),{code:'skin.text-colors'});
 for(const {role,assetId}of textRoles(pack)){
  const asset=pack.assets.find(a=>a.assetId===assetId),sample=sampleSurface(images.get(assetId),asset,pack.scale);
  const score=fill=>sample.colors.length?Math.min(...sample.colors.map(c=>contrastRatio(rgb(fill),c))):0;
  const requested=preserve?pack.theme.textColors?.[role]:null,fill=requested??(score(policy.light)>=score(policy.dark)?policy.light:policy.dark),minimum=score(fill);
  inks[role]=fill;checks.push({role,assetId,sourceSha256:asset.sha256,fill,samples:sample.colors.length,transparentSamples:sample.transparent,minimumContrast:minimum,status:sample.colors.length>=policy.minimumOpaqueSamples&&sample.transparent===0&&minimum>=policy.minimumContrast?'passed':'needs-review'});
 }
 const composited=Object.entries(pack.surfaceStyles??{}).filter(([,s])=>s.layers.length).map(([key])=>key);
 return {inks,report:{kind:'ui_text_readability',version:'1.0',policy,scope:'sampled-content-regions',status:!composited.length&&checks.every(c=>c.status==='passed')?'passed':'needs-review',checks,...(composited.length?{surfaceCompositing:{status:'needs-review',styles:composited,reason:'Base-surface samples do not measure the layered material composite.'}}:{}),visualAcceptance:'unreviewed',productionReady:false}};
}
