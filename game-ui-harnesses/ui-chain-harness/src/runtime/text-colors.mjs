import {Text} from 'pixi.js';
import {bestInk,rgb} from '../skins/text-readability.mjs';

// Every consumer uses the same frozen role colors. Layout and current displayed
// skin textures determine the backing role; no image sampling runs in a frame.
export function textColorOwner(app,skin,ownedRoots){
 if(!skin.profile.textColors)return null;
 const roles=new Map();for(const [role,id]of skin.roles)if(skin.profile.textColors[role])roles.set(skin.textures.get(id),role);
 let evidence=[];
 function refresh(){
  const backgrounds=[],roots=new Set(ownedRoots());evidence=[];
  const backdrop=app.renderer.background.color.toHex();
  function visit(view,owned=false,alpha=1,tinted=false){
   if(!view.visible||view.alpha===0)return;
   alpha*=view.alpha;tinted ||= view.tint!==undefined&&view.tint!==0xffffff;
   owned ||= roots.has(view);
   const role=roles.get(view.texture);if(role)backgrounds.push({role,box:view.getBounds(),alpha,tinted});
   if(owned&&view instanceof Text){
    const b=view.getBounds(),x=b.x+b.width/2,y=b.y+b.height/2;
    const surface=backgrounds.findLast(s=>x>=s.box.x&&x<=s.box.x+s.box.width&&y>=s.box.y&&y<=s.box.y+s.box.height);
    const fill=surface?skin.profile.textColors[surface.role]:bestInk(rgb(backdrop));
    if(view.style.fill!==fill)view.style.fill=fill;
    evidence.push({text:view.text,role:surface?.role??'host-background',fill,width:b.width,height:b.height,alpha,compositingReview:alpha<1||tinted||surface?.alpha<1||Boolean(surface?.tinted)||app.renderer.background.alpha<1});
   }
   for(const child of view.children??[])visit(child,owned,alpha,tinted);
  }visit(app.stage);return evidence;
 }
 app.ticker.add(refresh);
 return {refresh,get evidence(){return evidence;},dispose(){app.ticker.remove(refresh);}};
}
