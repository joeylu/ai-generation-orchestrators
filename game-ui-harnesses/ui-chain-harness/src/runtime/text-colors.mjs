import {Text} from 'pixi.js';
import {bestInk,rgb} from '../skins/text-readability.mjs';
import {applyRuntimeInk} from './derived-text-ink.mjs';

// Frozen role colors and declared opaque program surfaces share one ink owner.
// Author overrides take priority; no image sampling runs in a frame.
export function textColorOwner(app,skin,ownedRoots,explicitRoots=()=>new Map(),textBackings=()=>new Map(),scopeRoots=()=>new Map()){
 const roles=new Map();for(const [role,id]of skin.roles)if(skin.profile.textColors?.[role]||skin.runtimeTextReadability?.inks[role])roles.set(skin.textures.get(id),role);
 let evidence=[],derivedTexts=new Set();
 function refresh(){
  const backgrounds=[],reviewRegions=[],roots=new Set(ownedRoots()),explicit=explicitRoots(),backings=textBackings(),scopes=scopeRoots(),previousDerived=derivedTexts;derivedTexts=new Set();evidence=[];
  if(!skin.profile.textColors&&!backings.size&&![...explicit.values()].some(color=>color!==null)&&![...scopes.values()].some(Boolean)&&!previousDerived.size)return evidence;
  const backdrop=app.renderer.background.color.toHex();
  function visit(view,owned=false,alpha=1,tinted=false,override=null,enhanced=false){
   if(!view.visible||view.alpha===0)return;
   alpha*=view.alpha;tinted ||= view.tint!==undefined&&view.tint!==0xffffff;
   owned ||= roots.has(view);
   if(explicit.has(view))override=explicit.get(view);
   if(scopes.has(view))enhanced=scopes.get(view);
   const role=view.surfaceBaseRole??roles.get(view.texture);if(role)backgrounds.push({role,box:view.getBounds(),alpha,tinted,contentInk:view.contentInk});
   if(view.surfaceCompositing)reviewRegions.push(view.getBounds());
   if(owned&&view instanceof Text&&(skin.profile.textColors||backings.has(view)||override!==null||enhanced||view.runtimeDerivedInk)){
    const b=view.getBounds(),x=b.x+b.width/2,y=b.y+b.height/2;
    const surface=backgrounds.findLast(s=>(enhanced||skin.profile.textColors?.[s.role])&&x>=s.box.x&&x<=s.box.x+s.box.width&&y>=s.box.y&&y<=s.box.y+s.box.height);
    const backing=backings.get(view),surfaceInk=view.surfaceInk;
    let ink;
    if((enhanced||view.runtimeDerivedInk)&&skin.runtimeRoleInk&&!backing){
     ink=skin.runtimeRoleInk(surfaceInk?.role??surface?.role,{enhanced,authorColor:override??undefined,contentInk:surface?.contentInk,...(surfaceInk??{})});
    }else{
     const fill=override??(backing?bestInk(rgb(backing)):null)??view.surfaceTextColor??(surface?skin.profile.textColors?.[surface.role]:bestInk(rgb(backdrop)));
     ink={fill};
    }
    applyRuntimeInk(view,ink);if(view.runtimeDerivedInk)derivedTexts.add(view);
    const fill=ink.fill;
    evidence.push({text:view.text,role:enhanced&&surfaceInk?surfaceInk.role:surface?.role??'host-background',fill,width:b.width,height:b.height,alpha,...(override!==null?{colorSource:'node-override'}:backing?{colorSource:'program-surface',backing}:ink.source==='derived-role'||ink.source==='derived-content-region'?{colorSource:ink.source,samplingStatus:ink.samplingStatus,minimumContrast:ink.minimumContrast,sourceSamplingAcceptance:ink.sourceSamplingAcceptance,compositeAcceptance:'unreviewed',...(ink.stroke?{fallbackStroke:ink.stroke}:{})}:view.surfaceTextColor?{colorSource:'surface-style'}:{}),compositingReview:ink.source==='derived-role'||ink.source==='derived-content-region'||Boolean(backing)||reviewRegions.some(r=>x>=r.x&&x<=r.x+r.width&&y>=r.y&&y<=r.y+r.height)||Boolean(view.surfaceTextColor)||override!==null||alpha<1||tinted||surface?.alpha<1||Boolean(surface?.tinted)||app.renderer.background.alpha<1});
   }
   for(const child of view.children??[])visit(child,owned,alpha,tinted,override,enhanced);
  }visit(app.stage);return evidence;
 }
 app.ticker.add(refresh);
 return {refresh,get evidence(){return evidence;},dispose(){app.ticker.remove(refresh);}};
}
