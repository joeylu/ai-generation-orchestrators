import {readFile} from 'node:fs/promises';
import {hash,json} from '../skins/package.mjs';
import {decodePng,encodePng} from '../skins/png.mjs';

const config=new URL('../../configs/material-template.json',import.meta.url);
const ids=['material.title-band','material.section-band','material.panel-fill'];
const fail=message=>{throw Object.assign(Error(message),{code:'skin.material-template'});};
export function validateMaterialTemplate(spec){
 if(!spec||spec.kind!=='ui_material_template'||spec.version!=='1.0'||spec.sheetId!=='S05'||!spec.coordinates||!Array.isArray(spec.parts)||spec.parts.length!==3)fail('Invalid material template.');
 const {width,height,outputScale}=spec.coordinates;
 if(![width,height,outputScale].every(Number.isInteger)||width<1||height<1||outputScale<1||width*outputScale>4096||height*outputScale>4096)fail('Invalid material dimensions.');
 const occupied=new Uint8Array(width*height);
 spec.parts.forEach((part,i)=>{
  if(part.assetId!==ids[i]||!['horizontal','tile'].includes(part.stretch)||typeof part.purpose!=='string')fail('Invalid material slot identity.');
  for(const r of [part.slotRect,part.bodyRect])if(!Array.isArray(r)||r.length!==4||!r.every(Number.isInteger)||r.some(n=>n<0)||r[2]<1||r[3]<1||r[0]+r[2]>width||r[1]+r[3]>height)fail('Invalid material rectangle.');
  const [sx,sy,sw,sh]=part.slotRect,[x,y,w,h]=part.bodyRect;
  if(x<sx||y<sy||x+w>sx+sw||y+h>sy+sh)fail('Material body exceeds its slot.');
  for(let row=sy;row<sy+sh;row++)for(let col=sx;col<sx+sw;col++){const at=row*width+col;if(occupied[at])fail('Material slots overlap.');occupied[at]=1;}
 });
 return spec;
}
export async function readMaterialTemplate(){
 const bytes=await readFile(config),spec=validateMaterialTemplate(JSON.parse(bytes));
 return {spec,bytes,sha256:hash(bytes),sheet:{id:spec.sheetId,parts:spec.parts}};
}
export function materialGeometry(spec,sha256){
 validateMaterialTemplate(spec);
 return {kind:'ui_material_model_geometry',version:'1.0',sourceSha256:sha256,coordinates:spec.coordinates,sheets:[{id:spec.sheetId,parts:spec.parts}]};
}
/** The clean geometry is generated locally; it is never a generated material asset. */
export function materialTemplateImages(spec){
 validateMaterialTemplate(spec);
 const {outputScale:scale}=spec.coordinates,width=spec.coordinates.width*scale,height=spec.coordinates.height*scale,pixels=Buffer.alloc(width*height*4);
 for(const [i,part]of spec.parts.entries()){
  const [x,y,w,h]=part.bodyRect.map(n=>n*scale),color=[[88,120,126],[144,156,143],[155,150,137]][i];
  for(let row=y;row<y+h;row++)for(let col=x;col<x+w;col++){const at=(row*width+col)*4;pixels.set([...color,255],at);}
 }
 const clean=encodePng({width,height,pixels});
 return {clean,review:clean};
}
export function compileMaterialPrompt(style,geometry){
 return [
  'Generate one game UI MATERIAL atlas, not controls or a finished panel. Input image 1 is the shared style reference. Input image 2 is exact geometry with placeholder colors.',
  'Preserve the canvas and each named bodyRect exactly. Paint richly detailed material only within the three body rectangles; all gutters and all pixels outside those rectangles must remain truly transparent. Opaque material inside rectangles is allowed. Disconnected decorative marks inside a rectangle are allowed.',
  'Use the same palette, material, lighting and ornamental language as the reference. Do not copy its composition, text or complete controls. Do not draw text, labels, IDs, numbers, guides, icons, knobs, buttons, frames or additional objects.',
  'The title band should carry the reference-specific rich ornament near its ends with a readable quieter central text area. The section band should be a restrained related surface. Both bands are complete rectangular background surfaces and can have continuous alpha. The panel fill must be a continuous low-contrast material tile, no frame or isolated subject; match opposite edges for tiling.',
  `Coordinates are top-left logical [x,y,width,height], multiplied by outputScale=${geometry.coordinates.outputScale}. Do not move, rotate, merge, crop or omit any rectangle. Output one ${geometry.coordinates.width*geometry.coordinates.outputScale} x ${geometry.coordinates.height*geometry.coordinates.outputScale} RGBA PNG. This material contract deliberately permits complex texture within each body rectangle.`,
  'STYLE DATA:',json(style),'AUTHORITATIVE MATERIAL GEOMETRY (identities are metadata and must not be drawn):',json(geometry)
 ].join('\n\n');
}
/** Material gates deliberately do not infer or constrain connected silhouettes. */
export function assessMaterialAtlas(bytes,plan){
 let image;try{image=decodePng(bytes);}catch{return {status:'rejected',purpose:'material-atlas',issues:[{code:'png.unsupported'}],visualAcceptance:'unreviewed',productionReady:false};}
 const {width,height,pixels}=image,issues=[],occupancy=new Uint8Array(width*height),parts=[],scale=plan.outputScale??1;
 const dimensionsMatch=width===plan.request.width&&height===plan.request.height;
 if(!dimensionsMatch)issues.push({code:'dimensions',expected:[plan.request.width,plan.request.height],actual:[width,height]});
 for(const p of plan.parts){
  const [x,y,w,h]=p.bodyRect.map(n=>n*scale);let visiblePixels=0;
  for(let row=Math.max(0,y);row<Math.min(height,y+h);row++)for(let col=Math.max(0,x);col<Math.min(width,x+w);col++){const at=row*width+col;occupancy[at]=1;if(pixels[at*4+3])visiblePixels++;}
  if(!visiblePixels)issues.push({code:'empty-body',assetId:p.assetId});
  parts.push({assetId:p.assetId,expectedBodyRect:[x,y,w,h],visiblePixelsInsideExpectedBody:visiblePixels});
 }
 let outsideBodyPixels=0,transparentPixels=0,partialAlphaPixels=0,opaquePixels=0;
 for(let i=0;i<occupancy.length;i++){const a=pixels[i*4+3];if(!a)transparentPixels++;else{if(a===255)opaquePixels++;else partialAlphaPixels++;if(!occupancy[i])outsideBodyPixels++;}}
 if(outsideBodyPixels)issues.push({code:'outside-body',pixels:outsideBodyPixels});
 if(!transparentPixels)issues.push({code:'alpha.opaque-background'});
 if(image.transparentRgbPixels)issues.push({code:'alpha.transparent-rgb',pixels:image.transparentRgbPixels});
 return {status:issues.length?'rejected':'pixel-gates-passed-awaiting-visual-review',purpose:'material-atlas',width,height,dimensionsMatch,parts,outsideBodyPixels,transparentPixels,partialAlphaPixels,opaquePixels,transparentRgbPixels:image.transparentRgbPixels,issues,semanticIdentity:'fixed-template-slot',visualAcceptance:'unreviewed',productionReady:false};
}
