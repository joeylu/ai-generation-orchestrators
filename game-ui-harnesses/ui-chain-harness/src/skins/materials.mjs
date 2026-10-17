import {readSafe,hash,json,verifySkinPackage,noLinks} from './package.mjs';
import {decodePng,cropPng,encodePng} from './png.mjs';
import {validateSurfaceStyles,validateMaterialAsset} from './surface-styles.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
const fail=message=>{throw Object.assign(Error(message),{code:'skin.material'});};
// Producers own every manifest and fingerprint. Explicit local source crops
// are lossless and replayable; there is no segmentation, inpainting or compute.
export async function importMaterials(pack,spec,base,emit){
 if(!Array.isArray(spec.materials??[])||(spec.materials??[]).length>32)fail('Invalid material input.');
 const ids=new Set([...pack.assets,...(pack.materialAssets??[])].map(a=>a.assetId)),sources=new Map();
 for(const input of spec.materials??[]){
  if(!input||Object.keys(input).some(k=>!['assetId','file','sha256','crop'].includes(k))||!/^material\.[a-z][a-z0-9.-]{0,80}$/.test(input.assetId)||ids.has(input.assetId)||!/^[a-f0-9]{64}$/.test(input.sha256))fail('Invalid or duplicate material input.');
  const raw=await readSafe(base,input.file);if(hash(raw)!==input.sha256)fail('Material source digest changed.');
  const sourceImage=decodePng(raw);if(sourceImage.width>4096||sourceImage.height>4096)fail('Material source is too large.');
  const crop=input.crop;if(!Array.isArray(crop)||crop.length!==4||!crop.every(Number.isInteger)||crop.some(n=>n<0)||crop[2]<1||crop[3]<1||crop[0]+crop[2]>sourceImage.width||crop[1]+crop[3]>sourceImage.height)fail('Material crop exceeds source.');
  const image=cropPng(sourceImage,crop);if(image.transparentRgbPixels)fail('Material contains nonzero transparent RGB.');
  if(!image.pixels.some((n,i)=>i%4===3&&n))fail('Material is empty.');
  let source=sources.get(input.sha256);
  if(!source){source={...await emit('material-sources/'+input.sha256+'.png',raw),width:sourceImage.width,height:sourceImage.height};sources.set(input.sha256,source);}
  const record={assetId:input.assetId,...await emit('materials/'+input.assetId+'.png',encodePng(image)),width:image.width,height:image.height,source:{...source,crop}};
  validateMaterialAsset(record);(pack.materialAssets??=[]).push(record);ids.add(record.assetId);
 }
 if(spec.surfaceStyles!==undefined)pack.surfaceStyles=structuredClone(spec.surfaceStyles);
 validateSurfaceStyles(pack.surfaceStyles,[...ids],pack.roles.map(r=>r.role));
}
export async function verifyMaterials(pack,resources){
 const seen=new Set();let pixels=0;
 for(const a of pack.materialAssets??[]){
  validateMaterialAsset(a);if(seen.has(a.assetId)||pack.assets.some(p=>p.assetId===a.assetId))fail('Duplicate material identity.');seen.add(a.assetId);
  const raw=resources.get(a.source.file),image=decodePng(raw),out=decodePng(resources.get(a.file));
  pixels+=image.width*image.height+out.width*out.height;if(pixels>64*1024*1024)fail('Material pixel budget exceeded.');
  if(image.width!==a.source.width||image.height!==a.source.height||out.width!==a.width||out.height!==a.height||out.transparentRgbPixels||!out.pixels.equals(cropPng(image,a.source.crop).pixels))fail('Material source replay differs.');
 }
}
export function verifyMaterialExtension(original,next,report){
 const core=pack=>Object.fromEntries(Object.entries(pack).filter(([k])=>!['revision','surfaceStyles','materialAssets'].includes(k)));
 if(report.kind!=='ui_skin_material_extension'||report.version!=='1.0'||report.modelCalls!==0||report.sourceSkinSha256!==original.manifestSha256||report.manifestSha256!==next.manifestSha256||next.pack.revision!==original.pack.revision+1||!isDeepStrictEqual(core(original.pack),core(next.pack)))fail('Material extension changed the original skin contract.');
 for(const a of original.pack.materialAssets??[])if(!next.pack.materialAssets?.some(b=>isDeepStrictEqual(a,b)))fail('Material extension replaced an existing material.');
 for(const [file,bytes]of original.resources)if(!next.resources.get(file)?.equals(bytes))fail('Material extension changed original resources.');
}
export async function extendSkinMaterials({packageDirectory,configPath,output}){
 await noLinks(output);
 const original=await verifySkinPackage(packageDirectory),bytes=await readSafe(dirname(configPath),configPath.split(/[\\/]/).at(-1),2*1024*1024),spec=JSON.parse(bytes);
 if(!spec||Object.keys(spec).some(k=>!['kind','version','sourceSkinSha256','materials','surfaceStyles'].includes(k))||spec.kind!=='ui_skin_material_input'||spec.version!=='1.0'||spec.sourceSkinSha256!==original.manifestSha256)fail('Material input is not bound to this skin.');
 const pack=structuredClone(original.pack);pack.revision++;
 await mkdir(output);await mkdir(join(output,'pack'));
 const written=new Map(),emit=async(file,data)=>{
  const fingerprint={file,sha256:hash(data),bytes:data.length};
  if(written.has(file)){if(written.get(file)!==fingerprint.sha256)fail('Conflicting material file.');return fingerprint;}
  await mkdir(dirname(join(output,'pack',file)),{recursive:true});await writeFile(join(output,'pack',file),data,{flag:'wx'});written.set(file,fingerprint.sha256);return fingerprint;
 };
 for(const [file,data]of original.resources)await emit(file,data);
 await importMaterials(pack,spec,dirname(configPath),emit);
 await emit('skin-pack.json',Buffer.from(json(pack)));
 const verified=await verifySkinPackage(join(output,'pack'));
 if(hash(await readSafe(dirname(configPath),configPath.split(/[\\/]/).at(-1)))!==hash(bytes))fail('Material configuration changed.');
 const report={kind:'ui_skin_material_extension',version:'1.0',sourceSkinSha256:original.manifestSha256,manifestSha256:verified.manifestSha256,inputSha256:hash(bytes),materials:pack.materialAssets?.length??0,modelCalls:0,visualAcceptance:'unreviewed',productionReady:false};
 verifyMaterialExtension(original,verified,report);
 await writeFile(join(output,'report.json'),json(report),{flag:'wx'});
 return {directory:output,packageDirectory:join(output,'pack'),manifestSha256:verified.manifestSha256,modelCalls:0,visualAcceptance:'unreviewed'};
}
