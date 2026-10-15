const color=value=>typeof value==='string'&&/^#[a-f\d]{6}$/i.test(value);
const fail=message=>{throw Object.assign(Error(message),{code:'skin.runtime-ink'});};
const priorStrokes=new WeakMap();

// Only derived data is passed here. This helper never writes a profile, pack,
// role binding, authored node or source image.
export function runtimeRoleInk(skin,role,{enhanced=false,authorColor,styleColor,replacement=false}={}){
 const declared=skin.profile.textColors?.[role],legacy=skin.profile.palette.text;
 for(const value of [authorColor,styleColor,declared,legacy])if(value!==undefined&&!color(value))fail('Invalid text ink.');
 if(authorColor!==undefined)return {fill:authorColor,source:'author'};
 if(styleColor!==undefined)return {fill:styleColor,source:'surface-style'};
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
 text.runtimeDerivedInk=ink.source==='derived-role';
 return text;
}
