import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {hash,json,noLinks,readSafe} from './package.mjs';
import {safePath} from './contract.mjs';
import {decodePng,cropPng,encodePng} from './png.mjs';
import {surfaceStyleInfo,validateSurfaceStyles} from './surface-styles.mjs';
import {validateMaterialTemplate} from '../skin-generation/material-template.mjs';
import {materialHeadingCrops,completeHeadingCrop} from './material-heading-crops.mjs';
import {rgb,contrastRatio} from './text-readability.mjs';

const ids=['material.title-band','material.section-band','material.panel-fill'];
const sides=['left','right','top','bottom'];
const fail=message=>{throw Object.assign(Error(message),{code:'skin.material-atlas'});};
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function frozenTemplate(template){
 const spec=template?.spec??template;validateMaterialTemplate(spec);
 const bytes=template?.bytes===undefined?Buffer.from(json(spec)):Buffer.from(template.bytes);
 let parsed;try{parsed=JSON.parse(bytes);}catch{fail('Material template bytes are invalid.');}
 if(!isDeepStrictEqual(spec,parsed)||(template?.sha256!==undefined&&template.sha256!==hash(bytes)))fail('Material template identity changed.');
 return {spec,sha256:hash(bytes)};
}
function sourceName(file){
 if(!safePath(file)||file.includes('/')||!file.toLowerCase().endsWith('.png'))fail('Material source must be a local PNG filename.');
 return file;
}
function mappedRect(rect,scale,width,height){
 const [x,y,w,h]=rect,left=Math.round(x*scale),top=Math.round(y*scale),right=Math.round((x+w)*scale),bottom=Math.round((y+h)*scale),crop=[left,top,right-left,bottom-top];
 if(crop[2]<1||crop[3]<1||left<0||top<0||right>width||bottom>height)fail('Material rectangle exceeds source or collapses at this resolution.');
 return crop;
}
function pixelStats(image){
 let visiblePixels=0,opaquePixels=0,partialAlphaPixels=0;
 for(let i=3;i<image.pixels.length;i+=4)if(image.pixels[i]){visiblePixels++;if(image.pixels[i]===255)opaquePixels++;else partialAlphaPixels++;}
 return {visiblePixels,opaquePixels,partialAlphaPixels};
}
function seamDifference(image){
 const {width,height,pixels}=image;
 const difference=(a,b)=>{let total=0;for(let k=0;k<4;k++)total+=Math.abs(pixels[a+k]-pixels[b+k]);return total/4;};
 let horizontal=0,vertical=0;
 for(let y=0;y<height;y++)horizontal+=difference(y*width*4,(y*width+width-1)*4);
 for(let x=0;x<width;x++)vertical+=difference(x*4,((height-1)*width+x)*4);
 return {horizontal:Math.round(horizontal/height*100)/100,vertical:Math.round(vertical/width*100)/100};
}
// A report version owns its historical policy values. Do not read the current
// role-ink configuration here: future config changes must not invalidate a
// retained 1.1 extraction. Introduce a new version for different policy values.
const materialInkPolicyV11=Object.freeze({version:'1.0',dark:'#111827',light:'#F5F7FF',minimumContrast:4.5,
 sampleGrid:17,minimumOpaqueSamples:16,minimumAlpha:240,surfaceRolePattern:'^skin\\.(surface\\.|button\\.|field\\.|item\\.|slot\\.|tab\\.)'});
// Version 1.1 samples only the quiet central 40% of each retained material crop.
// This is source evidence, not acceptance of its final rendered composition.
function materialTextInk(image,{assetId,sourceSha256,sourceCrop,requestedColor,fallback}){
 const policy=materialInkPolicyV11,colors=[],seen=new Set();let transparent=0;
 const region={x:image.width*.3,y:image.height*.3,width:image.width*.4,height:image.height*.4};
 for(let y=0;y<policy.sampleGrid;y++)for(let x=0;x<policy.sampleGrid;x++){
  const px=Math.min(image.width-1,Math.floor(region.x+(x+.5)*region.width/policy.sampleGrid)),py=Math.min(image.height-1,Math.floor(region.y+(y+.5)*region.height/policy.sampleGrid)),at=(py*image.width+px)*4;
  if(seen.has(at))continue;seen.add(at);
  if(image.pixels[at+3]<policy.minimumAlpha){transparent++;continue;}
  colors.push([...image.pixels.subarray(at,at+3)]);
 }
 const score=fill=>colors.length?Math.min(...colors.map(c=>contrastRatio(rgb(fill),c))):0;
 const fill=requestedColor??(colors.length?(score(policy.light)>=score(policy.dark)?policy.light:policy.dark):fallback);
 const minimumContrast=score(fill),source=requestedColor!==undefined?'explicit-surface-style':colors.length?'derived-material':'base-role-fallback';
 return {fill,evidence:{assetId,sourceSha256,sourceCrop:[...sourceCrop],fill,colorSource:source,
  sampleRegion:region,samples:colors.length,transparentSamples:transparent,minimumContrast,
  candidateMinimumContrast:{light:score(policy.light),dark:score(policy.dark)},
  status:colors.length>=policy.minimumOpaqueSamples&&transparent===0&&minimumContrast>=policy.minimumContrast?'passed':'needs-review'}};
}
function boundStyles(pack,{extractionVersion='1.0',materialImages=new Map(),rawSha256,parts=[]}={}){
 if(!pack||!Array.isArray(pack.roles)||!Array.isArray(pack.assets))fail('A verified base skin is required for material bindings.');
 const styles=structuredClone(pack.surfaceStyles??{}),inkChecks=[];
 for(const [i,key]of ['title','section','panel'].entries()){
  const baseRole=key==='panel'?'skin.surface.panel':'skin.surface.bar',assetId=pack.roles.find(r=>r.role===baseRole)?.assetId,asset=pack.assets.find(a=>a.assetId===assetId);
  if(!asset?.contentInsets||!asset?.nineSlice)fail('Material base skin role or safe insets are missing.');
  const old=pack.surfaceStyles?.[key],insets=Object.fromEntries(sides.map(side=>[side,Math.max(asset.contentInsets[side],old?.insets?.[side]??0,key==='panel'?0:['left','right'].includes(side)?12:4)]));
  if(Object.values(insets).some(n=>!Number.isFinite(n)||n<0||n>512))fail('Material base skin safe insets are invalid.');
  // A frozen explicit surface recipe remains authoritative. Only a newly
  // generated replacement's inherited base-role default is resampled.
  const ink=extractionVersion==='1.1'&&key!=='panel'?materialTextInk(materialImages.get(ids[i]),{
   assetId:ids[i],sourceSha256:rawSha256,sourceCrop:parts.find(p=>p.assetId===ids[i]).crop,
   requestedColor:old?.textColor,fallback:pack.theme?.textColors?.[baseRole]??pack.theme?.palette?.text??materialInkPolicyV11.dark}):null;
  if(ink)inkChecks.push({style:key,...ink.evidence});
  const style={baseRole,baseMode:key==='panel'?'overlay':'replace',insets,
   clipInsets:key==='panel'?Object.fromEntries(sides.map(side=>[side,Math.max(asset.nineSlice[side],old?.clipInsets?.[side]??0)])):{left:0,right:0,top:0,bottom:0},
   ...(old?.radius===undefined?{}:{radius:old.radius}),
   ...(ink?{textColor:ink.fill}:old?.textColor??pack.theme?.textColors?.[baseRole]?{textColor:old?.textColor??pack.theme.textColors[baseRole]}:{}),
   layers:[key==='panel'?{assetId:ids[i],mode:'tile',scale:1,alpha:.14,blendMode:'multiply'}:{assetId:ids[i],mode:'cover',anchorX:.5,anchorY:.5,alpha:1,blendMode:'normal'}]};
  styles[key]=style;
 }
 const assets=[...pack.assets,...(pack.materialAssets??[])].map(a=>a.assetId);
 if(ids.some(id=>assets.includes(id)))fail('This base skin already contains an S05 material identity.');
 validateSurfaceStyles(styles,[...assets,...ids],pack.roles.map(r=>r.role));
 for(const key of ['title','section','panel'])surfaceStyleInfo({...pack,surfaceStyles:styles},key);
 return {styles,inkChecks};
}

// decodePng preserves every alpha and all visible RGB exactly. At alpha zero it
// records the dirty-pixel count and returns zero RGB, so re-encoding this image
// is a narrowly defined derived artifact, never a rewrite of the frozen raw.
function normalizedSource(raw,image,file){
 if(!image.transparentRgbPixels)return null;
 const bytes=encodePng(image),decoded=decodePng(bytes);
 if(decoded.transparentRgbPixels||decoded.width!==image.width||decoded.height!==image.height||!decoded.pixels.equals(image.pixels))fail('Material transparent-RGB normalization changed visible pixels or alpha.');
 return {file:sourceName('derived-'+file),sha256:hash(bytes),bytes:bytes.length,width:image.width,height:image.height};
}

/** Template-owned headings keep their full separated contours; tiles sample the frozen interior. */
export function extractMaterialAtlas({raw,template,sourceSkinSha256,rawSha256,pack,sourceFile='source.png',extractionVersion='1.1'}){
 if(!['1.0','1.1'].includes(extractionVersion))fail('Unsupported material extraction version.');
 if(!Buffer.isBuffer(raw)||!raw.length||raw.length>32*1024*1024||!digest(rawSha256)||hash(raw)!==rawSha256)fail('Material source digest differs from the frozen S05 input.');
 if(!digest(sourceSkinSha256)||(pack?.manifestSha256!==undefined&&pack.manifestSha256!==sourceSkinSha256))fail('Material input is not bound to this base skin.');
 const base=pack?.pack??pack,{spec:geometry,sha256:templateSha256}=frozenTemplate(template),file=sourceName(sourceFile),image=decodePng(raw);
 const derived=normalizedSource(raw,image,file),materialSource=derived??{file,sha256:rawSha256};
 if(!image.pixels.some((value,index)=>index%4===3&&value===0))fail('Material source has an opaque background; genuinely transparent gutters are required.');
 const {width,height}=geometry.coordinates;
 if(image.width*height!==image.height*width)fail('Material source aspect ratio differs from the frozen template.');
 const scale=image.width/width,parts=[],materials=[],materialImages=new Map(),occupied=new Uint8Array(image.width*image.height),warnings=[];
 const expectedSize=[width*geometry.coordinates.outputScale,height*geometry.coordinates.outputScale];
 if(image.width!==expectedSize[0]||image.height!==expectedSize[1])warnings.push({code:'material.source-resolution',expected:expectedSize,actual:[image.width,image.height],action:'Candidate uses proportional frozen slot coordinates; source pixels are cropped without resampling.'});
 const fixedCrops=new Map(geometry.parts.map(part=>[part.assetId,mappedRect(part.bodyRect,scale,image.width,image.height)]));
 const headingCrops=materialHeadingCrops(image,geometry);
 for(const part of geometry.parts){
  const selected=completeHeadingCrop(fixedCrops.get(part.assetId),headingCrops.get(part.assetId));
  const crop=selected.crop,slotRect=mappedRect(part.slotRect,scale,image.width,image.height),cut=cropPng(image,crop),stats=pixelStats(cut);
  if(!stats.visiblePixels)fail(`Material slot is empty: ${part.assetId}.`);
  const [x,y,w,h]=crop;for(let row=y;row<y+h;row++)occupied.fill(1,row*image.width+x,row*image.width+x+w);
  const detail={assetId:part.assetId,crop,slotRect,width:cut.width,height:cut.height,...stats,...(selected.evidence?{cropEvidence:selected.evidence}:{})};
  if(part.assetId==='material.panel-fill'){
   detail.edgeDifference=seamDifference(cut);
   if(Math.max(...Object.values(detail.edgeDifference))>24)warnings.push({code:'material.tile-seam',assetId:part.assetId,edgeDifference:detail.edgeDifference});
  }
  parts.push(detail);materialImages.set(part.assetId,cut);materials.push({assetId:part.assetId,file:materialSource.file,sha256:materialSource.sha256,crop});
 }
 let outsideBodyPixels=0;for(let i=0;i<occupied.length;i++)if(!occupied[i]&&image.pixels[i*4+3])outsideBodyPixels++;
 const localizedHeadings=parts.some(part=>part.cropEvidence);
 if(outsideBodyPixels)warnings.push({code:'material.outside-bodies',pixels:outsideBodyPixels,action:localizedHeadings?'Source retained unchanged; uniquely owned heading contours and the frozen tile interior are bound.':'Source retained unchanged; only frozen body rectangles are bound.'});
 const {styles:surfaceStyles,inkChecks}=boundStyles(base,{extractionVersion,materialImages,rawSha256,parts});
 const spec={kind:'ui_skin_material_input',version:'1.0',sourceSkinSha256,materials,surfaceStyles};
 const report={kind:'ui_material_atlas_extraction',version:extractionVersion,sheetId:'S05',sourceSkinSha256,templateSha256,
  source:{file,sha256:rawSha256,bytes:raw.length,width:image.width,height:image.height},coordinates:structuredClone(geometry.coordinates),scale,
  semanticIdentity:localizedHeadings?'template-slot-ownership':'fixed-template-slot',extraction:'byte-exact-crop',parts,outsideBodyPixels,warnings,
  inputSha256:hash(Buffer.from(json(spec))),modelCalls:0,technicalValidation:'passed',visualAcceptance:'unreviewed',productionReady:false,
  textReadability:extractionVersion==='1.0'?{status:'needs-review',reason:'Base skin text insets and ink are preserved; material composites require visual acceptance.',insets:Object.fromEntries(Object.entries(surfaceStyles).map(([key,style])=>[key,style.insets]))}:
   {status:'needs-review',sourceSamplingStatus:inkChecks.every(c=>c.status==='passed')?'passed':'needs-review',
    reason:'Only retained material centers were sampled; final layered composites require visual acceptance.',
    method:'central-material-minimum-contrast-v1',policy:structuredClone(materialInkPolicyV11),checks:inkChecks,
    insets:Object.fromEntries(Object.entries(surfaceStyles).map(([key,style])=>[key,style.insets]))}};
 if(derived){report.originalSource=structuredClone(report.source);report.derivedSource=derived;report.normalization={operation:'zero-rgb-at-alpha-zero',changedInvisibleRgbPixels:image.transparentRgbPixels,visibleRgbChanges:0,alphaChanges:0};}
 return {spec,report};
}

/** Replay the deterministic producer against the retained raw bytes and frozen inputs. */
export async function verifyMaterialAtlas({directory,template,sourceSkinSha256,rawSha256,pack}){
 const reportBytes=await readSafe(directory,'report.json',2*1024*1024),report=JSON.parse(reportBytes),file=sourceName(report.source?.file);
 const raw=await readSafe(directory,file),specBytes=await readSafe(directory,'materials.json',2*1024*1024);
 if(report.kind!=='ui_material_atlas_extraction'||!['1.0','1.1'].includes(report.version))fail('Unsupported material extraction report.');
 const replay=extractMaterialAtlas({raw,template,sourceSkinSha256,rawSha256,pack,sourceFile:file,extractionVersion:report.version});
 if(!specBytes.equals(Buffer.from(json(replay.spec)))||!reportBytes.equals(Buffer.from(json(replay.report))))fail('Material extraction replay differs from its manifest or report.');
 if(replay.report.derivedSource){
  const derived=await readSafe(directory,replay.report.derivedSource.file),expected=encodePng(decodePng(raw));
  if(!derived.equals(expected))fail('Material derived source differs from its invisible-RGB normalization replay.');
 }
 return {directory:resolve(directory),configPath:join(resolve(directory),'materials.json'),reportPath:join(resolve(directory),'report.json'),sourceFile:join(resolve(directory),file),...replay};
}

/** Exclusive output; this never replaces an existing extraction or a selected skin. */
export async function materializeMaterialAtlas({output,...input}){
 const extracted=extractMaterialAtlas(input),directory=resolve(output);await noLinks(directory);await mkdir(directory);
 await writeFile(join(directory,extracted.report.source.file),input.raw,{flag:'wx'});
 if(extracted.report.derivedSource)await writeFile(join(directory,extracted.report.derivedSource.file),encodePng(decodePng(input.raw)),{flag:'wx'});
 await writeFile(join(directory,'materials.json'),json(extracted.spec),{flag:'wx'});
 await writeFile(join(directory,'report.json'),json(extracted.report),{flag:'wx'});
 return verifyMaterialAtlas({directory,...input});
}
