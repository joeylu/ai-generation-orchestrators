import {resampleArea} from '../skins/raster.mjs';
export {resampleArea} from '../skins/raster.mjs';
import Ajv from 'ajv';
import schema from '../../schemas/skin-normalization.schema.json' with { type: 'json' };
import { refineAssets } from './refine.mjs';

const check = new Ajv({ allErrors: true, strict: true }).compile(schema);
export const normalizationError = message => { throw Object.assign(Error(message), { code: 'skin.normalize' }); };
export function validatePolicy(policy) {
  if (!check(policy)) normalizationError('Invalid normalization policy.');
  if(policy.refinement?.edgeColor.hueRanges.some(([a,b])=>a>b))normalizationError('Hue ranges must be ordered.');
  return policy;
}
function validateInputs(image, geometry) {
  if (![image.width,image.height].every(n=>Number.isInteger(n)&&n>0&&n<=4096) || image.pixels.length!==image.width*image.height*4) normalizationError('Invalid bounded RGBA image.');
  const { width, height, outputScale } = geometry.coordinates ?? {};
  if (![width,height,outputScale].every(n=>Number.isInteger(n)&&n>0) || width*outputScale>4096 || height*outputScale>4096 || geometry.sheets?.length!==1) normalizationError('Expected one bounded template sheet.');
  const ids=new Set();
  if(!geometry.sheets[0].parts.length||geometry.sheets[0].parts.length>256) normalizationError('Invalid part count.');
  for(const p of geometry.sheets[0].parts) {
    if(ids.has(p.assetId)) normalizationError('Duplicate asset ID.'); ids.add(p.assetId);
    for(const r of [p.bodyRect,p.slotRect]) if(!Array.isArray(r)||r.length!==4||r.some(n=>!Number.isInteger(n)||n<0)||r[2]<1||r[3]<1||r[0]+r[2]>width||r[1]+r[3]>height) normalizationError('Invalid template rectangle.');
  }
}

// Eight-connected positive-alpha components retain their complete soft edges and holes.
// Strong pixels locate objects; they are not used as a hard alpha cutoff.
export function locateParts(image, geometry, policy) {
  validatePolicy(policy); validateInputs(image,geometry);
  const {width,height,pixels}=image, d=policy.detection, count=width*height;
  const labels=new Int32Array(count), queue=new Int32Array(count), components=[];
  let totalAlphaMass=0;
  for(let start=0;start<count;start++) {
    if(labels[start]||!pixels[start*4+3])continue;
    const id=components.length+1;
    let head=0,tail=1,x0=width,y0=height,x1=0,y1=0,alphaMass=0,corePixels=0,coreX=0,coreY=0,maxAlpha=0;
    queue[0]=start; labels[start]=id;
    while(head<tail) {
      const i=queue[head++],x=i%width,y=Math.floor(i/width),a=pixels[i*4+3];
      x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);alphaMass+=a;maxAlpha=Math.max(maxAlpha,a);
      if(a>=d.seedAlpha){corePixels++;coreX+=x+0.5;coreY+=y+0.5;}
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        if((dx===0&&dy===0)||x+dx<0||x+dx>=width||y+dy<0||y+dy>=height)continue;
        const j=(y+dy)*width+x+dx;
        if(!labels[j]&&pixels[j*4+3]){labels[j]=id;queue[tail++]=j;}
      }
    }
    components.push({id,bounds:[x0,y0,x1-x0+1,y1-y0+1],visiblePixels:tail,alphaMass,maxAlpha,corePixels,
      centroid:corePixels?[coreX/corePixels,coreY/corePixels]:null});
    totalAlphaMass+=alphaMass;
    if(components.length>65536)normalizationError('Too many disconnected fragments.');
  }
  const parts=geometry.sheets[0].parts, sx=width/geometry.coordinates.width,sy=height/geometry.coordinates.height;
  const issues=[],matches=[],discarded=[];
  const aspectDrift=Math.max(sx/sy,sy/sx);
  if(aspectDrift>d.maxCanvasAspectRatioDrift)issues.push({code:'canvas-aspect',actual:aspectDrift});
  for(const c of components){
    if(c.corePixels<d.minimumCorePixels){
      if(c.maxAlpha>=d.seedAlpha)issues.push({code:'strong-fragment',componentId:c.id});
      discarded.push(c);continue;
    }
    const hits=parts.filter(p=>{const [x,y,w,h]=p.slotRect;return c.centroid[0]>=x*sx&&c.centroid[0]<(x+w)*sx&&c.centroid[1]>=y*sy&&c.centroid[1]<(y+h)*sy;});
    if(hits.length!==1){issues.push({code:'unassigned-or-ambiguous',componentId:c.id});continue;}
    const p=hits[0],ratios=[c.bounds[2]/(p.bodyRect[2]*sx),c.bounds[3]/(p.bodyRect[3]*sy)];
    if(ratios.some(r=>r<d.minExtentRatio||r>d.maxExtentRatio))issues.push({code:'extent-drift',assetId:p.assetId,ratios});
    if(c.bounds[0]===0||c.bounds[1]===0||c.bounds[0]+c.bounds[2]===width||c.bounds[1]+c.bounds[3]===height)issues.push({code:'canvas-edge-clipping',assetId:p.assetId});
    matches.push({assetId:p.assetId,componentId:c.id,sourceRect:c.bounds,sourceCentroid:c.centroid,extentRatios:ratios});
  }
  for(const p of parts){const n=matches.filter(m=>m.assetId===p.assetId).length;if(n!==1)issues.push({code:n?'multiple-candidates':'missing-part',assetId:p.assetId,count:n});}
  // Count strong islands inside each soft component. Crossing a projected slot edge
  // alone is not a bridge: over-thick generated parts can extend into a neighbor slot.
  const strongVisited=new Uint8Array(count);
  for(const m of matches){
    const c=components[m.componentId-1];let significantCores=0;
    for(let row=c.bounds[1];row<c.bounds[1]+c.bounds[3];row++)for(let col=c.bounds[0];col<c.bounds[0]+c.bounds[2];col++){
      const i=row*width+col;
      if(labels[i]!==c.id||pixels[i*4+3]<d.seedAlpha||strongVisited[i])continue;
      let head=0,tail=1;queue[0]=i;strongVisited[i]=1;
      while(head<tail){
        const at=queue[head++],x=at%width,y=Math.floor(at/width);
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          if(x+dx<0||x+dx>=width||y+dy<0||y+dy>=height)continue;
          const j=(y+dy)*width+x+dx;
          if(!strongVisited[j]&&labels[j]===c.id&&pixels[j*4+3]>=d.seedAlpha){strongVisited[j]=1;queue[tail++]=j;}
        }
      }
      if(tail>=d.minimumCorePixels)significantCores++;
    }
    m.significantCoreCount=significantCores;
    if(significantCores!==1)issues.push({code:'joined-or-fragmented-cores',assetId:m.assetId,count:significantCores});
  }
  const discardedAlphaMass=discarded.reduce((n,c)=>n+c.alphaMass,0),discardedAlphaMassFraction=totalAlphaMass?discardedAlphaMass/totalAlphaMass:0;
  if(discardedAlphaMassFraction>d.maxDiscardedAlphaMassFraction)issues.push({code:'excess-discarded-alpha',fraction:discardedAlphaMassFraction});
  return {labels,report:{status:issues.length?'blocked':'located-awaiting-semantic-review',sheetId:geometry.sheets[0].id,
    identityEvidence:'unique-strong-centroid-in-template-slot',semanticReview:'required',visualAcceptance:'unreviewed',
    imageSize:[width,height],componentCount:components.length,matches,components,
    cleanup:{rule:'discard-only-disconnected-low-alpha-components',discardedComponentIds:discarded.map(c=>c.id),
      discardedPixels:discarded.reduce((n,c)=>n+c.visiblePixels,0),discardedAlphaMass,discardedAlphaMassFraction},issues}};
}

export function extractPart(image,labels,match){
  const [x,y,width,height]=match.sourceRect,pixels=Buffer.alloc(width*height*4);
  for(let row=0;row<height;row++)for(let col=0;col<width;col++){
    const i=(y+row)*image.width+x+col, j=(row*width+col)*4;
    if(labels[i]===match.componentId&&image.pixels[i*4+3])image.pixels.copy(pixels,j,i*4,i*4+4);
  }
  return {width,height,pixels};
}

// Box-area integration in premultiplied alpha prevents dark/colored transparent halos.
// RGB averages in the source's sRGB encoding; this is explicitly versioned policy.
function capMap(sourceLength,targetLength,sourceCap,targetCap){
  if(sourceLength<=sourceCap*2||targetLength<=targetCap*2)normalizationError('Caps leave no stretchable center.');
  return x=>x<targetCap?x*sourceCap/targetCap:x>targetLength-targetCap?sourceLength-(targetLength-x)*sourceCap/targetCap:sourceCap+(x-targetCap)*(sourceLength-2*sourceCap)/(targetLength-2*targetCap);
}
export function normalizePart(source,part,outputScale,policy){
  validatePolicy(policy);
  const width=part.bodyRect[2]*outputScale,height=part.bodyRect[3]*outputScale;
  let image,operation;
  if(part.stretch==='uniform'){
    const drift=Math.max((source.width/source.height)/(width/height),(width/height)/(source.width/source.height));
    if(drift>policy.resampling.maxUniformAspectRatioDrift)normalizationError(`${part.assetId}: uniform aspect drift requires review.`);
    const scale=Math.min(width/source.width,height/source.height);
    if(scale>policy.resampling.maxUpscale)normalizationError('Upscale exceeds policy.');
    const w=Math.max(1,Math.round(source.width*scale)),h=Math.max(1,Math.round(source.height*scale)),offset=[Math.floor((width-w)/2),Math.floor((height-h)/2)];
    const resized=resampleArea(source,w,h);image={width,height,pixels:Buffer.alloc(width*height*4)};
    for(let row=0;row<h;row++)resized.pixels.copy(image.pixels,((offset[1]+row)*width+offset[0])*4,row*w*4,(row+1)*w*4);
    operation={method:'uniform-contain',resized:[w,h],offset,aspectDrift:drift};
  } else if(['horizontal','vertical'].includes(part.stretch)){
    const horizontal=part.stretch==='horizontal',targetCross=horizontal?height:width,sourceCross=horizontal?source.height:source.width;
    const logicalCross=horizontal?part.bodyRect[3]:part.bodyRect[2];
    if(part.primitive.type!=='roundRect'||part.primitive.radius!==logicalCross/2)normalizationError(`${part.assetId}: explicit source cap policy needed for non-capsule.`);
    const scale=targetCross/sourceCross;if(scale>policy.resampling.maxUpscale)normalizationError('Upscale exceeds policy.');
    const sourceCap=sourceCross/2,targetCap=targetCross/2;
    const axisMap=capMap(horizontal?source.width:source.height,horizontal?width:height,sourceCap,targetCap);
    image=resampleArea(source,width,height,horizontal?axisMap:t=>t/scale,horizontal?t=>t/scale:axisMap);
    operation={method:'preserve-caps',axis:part.stretch,sourceCap,targetCap,crossScale:scale};
  } else normalizationError(`${part.assetId}: this normalization profile does not support nine-slice surfaces.`);
  return {image,operation};
}

export function normalizeSheet(image,geometry,policy,stateGroups=[]){
  const analysis=locateParts(image,geometry,policy);
  if(analysis.report.issues.length)return {...analysis,assets:[],sheet:null};
  const scale=geometry.coordinates.outputScale,width=geometry.coordinates.width*scale,height=geometry.coordinates.height*scale;
  const sheet={width,height,pixels:Buffer.alloc(width*height*4)},assets=[];
  for(const part of geometry.sheets[0].parts){
    const match=analysis.report.matches.find(m=>m.assetId===part.assetId),source=extractPart(image,analysis.labels,match);
    try{
      const normalized=normalizePart(source,part,scale,policy),[x,y]=part.bodyRect.map(v=>v*scale);
      for(let row=0;row<normalized.image.height;row++)normalized.image.pixels.copy(sheet.pixels,((y+row)*width+x)*4,row*normalized.image.width*4,(row+1)*normalized.image.width*4);
      assets.push({part,match,source,...normalized});
    }catch(e){if(e.code!=='skin.normalize')throw e;analysis.report.issues.push({code:'normalization-unsupported',assetId:part.assetId,message:e.message});}
  }
  if(analysis.report.issues.length){analysis.report.status='blocked';return {...analysis,assets:[],sheet:null};}
  try{
    const refinement=refineAssets(assets,stateGroups,policy.refinement,resampleArea);
    analysis.report.refinement=refinement.report;
    assets.splice(0,assets.length,...refinement.assets);
    sheet.pixels.fill(0);
    for(const a of assets){const[x,y]=a.part.bodyRect.map(v=>v*scale);for(let row=0;row<a.image.height;row++)a.image.pixels.copy(sheet.pixels,((y+row)*width+x)*4,row*a.image.width*4,(row+1)*a.image.width*4);}
  }catch(e){if(e.code!=='skin.normalize')throw e;analysis.report.issues.push({code:'refinement-blocked',message:e.message});analysis.report.status='blocked';return {...analysis,assets:[],sheet:null};}
  analysis.report.status='normalized-candidates-awaiting-review';
  return {...analysis,assets,sheet};
}
