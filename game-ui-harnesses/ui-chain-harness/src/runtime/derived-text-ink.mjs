import {surfaceLayerInfo} from '../skins/surface-styles.mjs';
import {rgb,contrastRatio,textReadabilityPolicy as insetPolicy} from '../skins/text-readability.mjs';
const color=value=>typeof value==='string'&&/^#[a-f\d]{6}$/i.test(value);
const fail=message=>{throw Object.assign(Error(message),{code:'skin.runtime-ink'});};
const priorStrokes=new WeakMap();


// Cache the exact UV region used inside explicit content/inset layers while verified
// source pixels are already loaded. Whole-role declared inks remain immutable.
export function prepareRuntimeContentInk(pack,images){
 const role='skin.surface.content',assetId=pack.roles?.find(r=>r.role===role)?.assetId;
 const asset=pack.assets?.find(a=>a.assetId===assetId),image=images.get(assetId);
 if(!asset||!image)return null;
 let info;try{info=surfaceLayerInfo(pack,'inset');}catch(error){if(error.code==='skin.surface-style')return null;throw error;}
 const sample=info.sample,resolution=pack.scale*(asset.density??1),rect=[sample.x*resolution,sample.y*resolution,sample.width*resolution,sample.height*resolution];
 const [x0,y0,width,height]=rect,colors=[],seen=new Set();let transparent=0;
 for(let y=0;y<insetPolicy.sampleGrid;y++)for(let x=0;x<insetPolicy.sampleGrid;x++){
  const px=Math.min(image.width-1,Math.max(0,Math.floor(x0+(x+.5)*width/insetPolicy.sampleGrid))),py=Math.min(image.height-1,Math.max(0,Math.floor(y0+(y+.5)*height/insetPolicy.sampleGrid))),i=(py*image.width+px)*4;
  if(seen.has(i))continue;seen.add(i);
  if(image.pixels[i+3]<insetPolicy.minimumAlpha){transparent++;continue;}colors.push([...image.pixels.slice(i,i+3)]);
 }
 const score=fill=>colors.length?Math.min(...colors.map(c=>contrastRatio(rgb(fill),c))):0;
 const dark=score(insetPolicy.dark),light=score(insetPolicy.light),fill=light>=dark?insetPolicy.light:insetPolicy.dark,minimumContrast=Math.max(dark,light),declared=pack.theme.textColors?.[role];
 const declaredMinimumContrast=color(declared)?score(declared):null,sufficient=colors.length>=insetPolicy.minimumOpaqueSamples&&transparent===0;
 const correction=sufficient&&declaredMinimumContrast!==null&&declaredMinimumContrast<insetPolicy.minimumContrast&&minimumContrast>declaredMinimumContrast;
 return Object.freeze({kind:'ui_runtime_content_ink',version:'1.0',role,assetId,sourceSha256:asset.sha256,
  sourceRect:Object.freeze(rect),fill,declaredColor:declared,declaredMinimumContrast,minimumContrast,correction,
  samples:colors.length,transparentSamples:transparent,samplingStatus:sufficient&&minimumContrast>=insetPolicy.minimumContrast?'passed':'needs-review',
  minimumRequiredContrast:insetPolicy.minimumContrast,opposite:fill===insetPolicy.light?insetPolicy.dark:insetPolicy.light,compositeAcceptance:'unreviewed'});
}

// Only derived data is passed here. This helper never writes a profile, pack,
// role binding, authored node or source image.
export function runtimeRoleInk(skin,role,{enhanced=false,authorColor,styleColor,replacement=false,contentInk}={}){
 const declared=skin.profile.textColors?.[role],legacy=skin.profile.palette.text;
 for(const value of [authorColor,styleColor,declared,legacy])if(value!==undefined&&!color(value))fail('Invalid text ink.');
 if(authorColor!==undefined)return {fill:authorColor,source:'author'};
 if(styleColor!==undefined)return {fill:styleColor,source:'surface-style'};
 if(enhanced&&!replacement&&contentInk?.correction===true&&contentInk.role===role&&contentInk.declaredColor===declared&&color(contentInk.fill)){
  return {fill:contentInk.fill,source:'derived-content-region',samplingStatus:contentInk.samplingStatus,minimumContrast:contentInk.minimumContrast,
   declaredMinimumContrast:contentInk.declaredMinimumContrast,sourceRect:contentInk.sourceRect,sourceSha256:contentInk.sourceSha256,
   ...(contentInk.minimumContrast<contentInk.minimumRequiredContrast?{stroke:{color:contentInk.opposite,width:1}}:{}),
   compositeAcceptance:'unreviewed',sourceSamplingAcceptance:contentInk.samplingStatus};
 }
 if(declared!==undefined)return {fill:declared,source:'declared-role'};
 const derived=skin.runtimeTextReadability,check=derived?.report.checks.find(c=>c.role===role),fill=derived?.inks[role];
 if(!enhanced||replacement||!color(fill)||!check)return {fill:legacy,source:'legacy'};
 const insufficient=check.status!=='passed'||check.minimumContrast<derived.report.policy.minimumContrast;
 const policy=derived.report.policy,opposite=fill.toUpperCase()===policy.light.toUpperCase()?policy.dark:policy.light;
 return {fill,source:'derived-role',samplingStatus:check.status,minimumContrast:check.minimumContrast,
  ...(insufficient?{stroke:{color:opposite,width:1}}:{}),
  compositeAcceptance:'unreviewed',sourceSamplingAcceptance:derived.report.status};
}

export function logicalEnhancedTextScope(handle){
 const seen=new Set();
 for(let owner=handle;owner;owner=owner.parent){
  if(seen.has(owner))fail('Cyclic logical text owner.');seen.add(owner);
  if(owner.enhancedTextScope||owner.surfaceLayer||owner.surfaceTextInsets)return true;
 }
 return false;
}
// Select and Dialog may portal display roots into an overlay. Logical handle
// ancestry retains scope even when display.parent no longer points to a Panel.
export function logicalTextScopeRoots(handles){
 const result=new Map();
 for(const handle of handles){
  const scope=logicalEnhancedTextScope(handle),view=handle.adapter?.view;
  for(const root of [handle.root,view,...(handle.recipe?.type==='Select'?[view?.view]:[])])if(root)result.set(root,scope);
 }
 return result;
}

// Restore the previous typography when an author override or declared ink wins
// later. The thin outline belongs only to the temporary derived fallback.
export function applyRuntimeInk(text,ink){
 if(text.style.fill!==ink.fill)text.style.fill=ink.fill;
 if(ink.stroke){
  const signature=ink.stroke.color+'|'+ink.stroke.width;
  if(!priorStrokes.has(text))priorStrokes.set(text,{previous:text.style.stroke,signature:null});
  const prior=priorStrokes.get(text);
  if(prior.signature!==signature){text.style.stroke=ink.stroke;prior.signature=signature;}
 }else if(priorStrokes.has(text)){
  text.style.stroke=priorStrokes.get(text).previous;priorStrokes.delete(text);
 }
 text.runtimeDerivedInk=ink.source==='derived-role'||ink.source==='derived-content-region';
 return text;
}
