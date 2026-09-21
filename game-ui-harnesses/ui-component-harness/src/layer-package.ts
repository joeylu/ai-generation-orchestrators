/** Minimal raster-layer contract; independent of component semantics and rendering. */
import { readStoredZipMembers } from './decomposition-import.ts';

export interface Layer { id:string; name:string; role:'background'|'foreground'; path:string; x:number; y:number; width:number; height:number; visible:true }
export interface Composition { kind:'ui_layer_composition_v1'; canvas:{width:number;height:number}; coordinates:'top-left-pixels'; order:'array-back-to-front'; textPolicy:'remove-business-text'|'preserve-raster-text'; backgroundMode:'scene-only'|'preserve-underlay'; reference:'reference.png'; preview:'preview.png'; layers:Layer[] }
export interface LayerPackage { composition:Composition; files:ReadonlyMap<string,Uint8Array>; issues:string[] }
const fail=(code:string):never=>{throw new Error(code);};
function record(v:unknown):Record<string,unknown> { if(!v||typeof v!=='object'||Array.isArray(v))fail('INVALID_OBJECT');return v as Record<string,unknown>; }
function exact(v:Record<string,unknown>,keys:string[]) { if(Object.keys(v).sort().join('|')!==keys.sort().join('|'))fail('UNKNOWN_OR_MISSING_FIELDS'); }
function integer(v:unknown,min:number,max:number) { if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min||v>max)fail('INVALID_DIMENSION'); }
function text(v:unknown,max:number) { if(typeof v!=='string'||!v.length||v.length>max)fail('INVALID_TEXT'); }
export function validateComposition(value:unknown):Composition {
  const c=record(value);exact(c,['kind','canvas','coordinates','order','textPolicy','backgroundMode','reference','preview','layers']);
  if(c.kind!=='ui_layer_composition_v1'||c.coordinates!=='top-left-pixels'||c.order!=='array-back-to-front'||c.reference!=='reference.png'||c.preview!=='preview.png')fail('COMPOSITION_VERSION');
  if(!['remove-business-text','preserve-raster-text'].includes(String(c.textPolicy))||!['scene-only','preserve-underlay'].includes(String(c.backgroundMode)))fail('COMPOSITION_POLICY');
  const size=record(c.canvas);exact(size,['width','height']);integer(size.width,1,8192);integer(size.height,1,8192);
  const w=size.width as number,h=size.height as number;if(w*h>16777216)fail('CANVAS_PIXEL_LIMIT');
  if(!Array.isArray(c.layers)||!c.layers.length||c.layers.length>128)fail('LAYER_COUNT');
  const ids=new Set(),paths=new Set();let pixels=0;
  for(const value of c.layers as unknown[]) {
    const l=record(value);exact(l,['id','name','role','path','x','y','width','height','visible']);text(l.id,128);text(l.name,512);
    if(!/^layers\/layer-\d{3}\.png$/.test(String(l.path))||ids.has(l.id)||paths.has(l.path))fail('LAYER_ID_OR_PATH');
    ids.add(l.id);paths.add(l.path);
    if(!['background','foreground'].includes(String(l.role))||l.visible!==true)fail('LAYER_ROLE');
    integer(l.x,0,w);integer(l.y,0,h);integer(l.width,1,w);integer(l.height,1,h);
    if((l.x as number)+(l.width as number)>w||(l.y as number)+(l.height as number)>h)fail('LAYER_BOUNDS');
    pixels+=(l.width as number)*(l.height as number);
  }
  if(pixels>134217728)fail('LAYER_PIXEL_LIMIT');return value as Composition;
}
function json(files:ReadonlyMap<string,Uint8Array>,path:string):unknown {
  const bytes=files.get(path);if(!bytes||bytes.length>2097152)fail('JSON_MISSING_OR_TOO_LARGE');
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
function pngSize(bytes:Uint8Array|undefined):[number,number] {
  if(!bytes||bytes.length<33||[137,80,78,71,13,10,26,10].some((b,i)=>bytes[i]!==b))fail('PNG_REQUIRED');
  const v=new DataView(bytes!.buffer,bytes!.byteOffset,bytes!.byteLength);return [v.getUint32(16),v.getUint32(20)];
}
export async function importLayerPackage(bytes:Uint8Array):Promise<LayerPackage> {
  const files=readStoredZipMembers(bytes),manifest=record(json(files,'manifest.json'));exact(manifest,['kind','version','files']);
  if(manifest.kind!=='ui_layers_package_v1'||manifest.version!==1)fail('PACKAGE_VERSION');
  const inventory=record(manifest.files);
  if(files.size!==Object.keys(inventory).length+1)fail('INVENTORY_MISMATCH');
  for(const [path,value] of Object.entries(inventory)) {
    if(!/^(layers\/layer-\d{3}\.png|composition\.json|reference\.png|preview\.png|review\.json|README\.txt|viewer\.html|viewer\.js)$/.test(path))fail('PACKAGE_PATH');
    const entry=record(value);exact(entry,['sha256','bytes']);const data=files.get(path);
    if(!data||data.length!==entry.bytes||!/^[a-f0-9]{64}$/.test(String(entry.sha256)))fail('INVENTORY_MISMATCH');
    const hash=await crypto.subtle.digest('SHA-256',new Uint8Array(data!).buffer);
    if([...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('')!==entry.sha256)fail('PACKAGE_HASH_MISMATCH');
  }
  const composition=validateComposition(json(files,'composition.json'));
  const expected=new Set(['manifest.json','composition.json','reference.png','preview.png','review.json','README.txt','viewer.html','viewer.js',...composition.layers.map(l=>l.path)]);
  if(files.size!==expected.size||[...files.keys()].some(k=>!expected.has(k)))fail('PACKAGE_INVENTORY');
  for(const l of composition.layers) {const [w,h]=pngSize(files.get(l.path));if(w!==l.width||h!==l.height)fail('PNG_GEOMETRY');}
  for(const path of ['reference.png','preview.png']) {const [w,h]=pngSize(files.get(path));if(w!==composition.canvas.width||h!==composition.canvas.height)fail('CANVAS_GEOMETRY');}
  const review=record(json(files,'review.json'));
  if(review.status!=='review-required'||review.humanVisualAcceptance!==false||review.textPolicy!==composition.textPolicy||!Array.isArray(review.issues)||review.issues.length>128||review.issues.some(v=>typeof v!=='string'))fail('REVIEW_REQUIRED');
  return {composition,files,issues:review.issues as string[]};
}
