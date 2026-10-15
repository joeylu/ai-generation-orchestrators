import {Text} from 'pixi.js';
import {bestInk,rgb} from '../skins/text-readability.mjs';

// Frozen role colors and declared opaque program surfaces share one ink owner.
// Author overrides take priority; no image sampling runs in a frame.
export function textColorOwner(app,skin,ownedRoots,explicitRoots=()=>new Map(),textBackings=()=>new Map()){
 const roles=new Map();for(const [role,id]of skin.roles)if(skin.profile.textColors?.[role])roles.set(skin.textures.get(id),role);
 let evidence=[];
 function refresh(){
  const backgrounds=[],reviewRegions=[],roots=new Set(ownedRoots()),explicit=explicitRoots(),backings=textBackings();evidence=[];
  if(!skin.profile.textColors&&!backings.size&&![...explicit.values()].some(color=>color!==null))return evidence;
  const backdrop=app.renderer.background.color.toHex();
  function visit(view,owned=false,alpha=1,tinted=false,override=null){
   if(!view.visible||view.alpha===0)return;
   alpha*=view.alpha;tinted ||= view.tint!==undefined&&view.tint!==0xffffff;
   owned ||= roots.has(view);
   if(explicit.has(view))override=explicit.get(view);
   const role=roles.get(view.texture);if(role)backgrounds.push({role,box:view.getBounds(),alpha,tinted});
   if(view.surfaceCompositing)reviewRegions.push(view.getBounds());
   if(owned&&view instanceof Text&&(skin.profile.textColors||backings.has(view)||override!==null)){
    const b=view.getBounds(),x=b.x+b.width/2,y=b.y+b.height/2;
    const surface=backgrounds.findLast(s=>x>=s.box.x&&x<=s.box.x+s.box.width&&y>=s.box.y&&y<=s.box.y+s.box.height);
    const backing=backings.get(view),fill=override??(backing?bestInk(rgb(backing)):null)??view.surfaceTextColor??(surface?skin.profile.textColors[surface.role]:bestInk(rgb(backdrop)));
    if(view.style.fill!==fill)view.style.fill=fill;
    evidence.push({text:view.text,role:surface?.role??'host-background',fill,width:b.width,height:b.height,alpha,...(override!==null?{colorSource:'node-override'}:backing?{colorSource:'program-surface',backing}:view.surfaceTextColor?{colorSource:'surface-style'}:{}),compositingReview:Boolean(backing)||reviewRegions.some(r=>x>=r.x&&x<=r.x+r.width&&y>=r.y&&y<=r.y+r.height)||Boolean(view.surfaceTextColor)||override!==null||alpha<1||tinted||surface?.alpha<1||Boolean(surface?.tinted)||app.renderer.background.alpha<1});
   }
   for(const child of view.children??[])visit(child,owned,alpha,tinted,override);
  }visit(app.stage);return evidence;
 }
 app.ticker.add(refresh);
 return {refresh,get evidence(){return evidence;},dispose(){app.ticker.remove(refresh);}};
}
