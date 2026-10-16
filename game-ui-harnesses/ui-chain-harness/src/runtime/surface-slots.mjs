import {surfaceLayerInfo} from '../skins/surface-styles.mjs';
import {textProfile} from './text-style.mjs';
import {scrollPadding} from './scroll-geometry.mjs';
import {tabsContentBox} from './tabs-geometry.mjs';

const sides=['left','right','top','bottom'];
const fail=(message,path='')=>{throw Object.assign(new Error(path?path+': '+message:message),{code:'panel.slot-bounds',path});};

// Match createFixtureSkin's metadata exactly without rendering or mutating a
// fixture. Imported skins always require their verified, frozen geometry.
export function surfaceGeometryForContext(ctx){
 if(ctx.skinGeometry)return ctx.skinGeometry;
 if(ctx.binding?.sourceKind!=='fixture')return null;
 const metadata=new Map(ctx.template.sheets.flatMap(sheet=>sheet.parts).map(part=>{
  const [,,width,height]=part.bodyRect;
  return [part.assetId,{assetId:part.assetId,width,height,stretch:part.stretch,slice:Math.max(1,Math.min(ctx.profile.slice,Math.floor(width/4),Math.floor(height/4)))}];
 }));
 return {roles:new Map(ctx.usage.bindings.map(b=>[b.role,b.assetId])),metadata,insets:role=>({left:ctx.profile.padding,right:ctx.profile.padding,top:role==='skin.surface.panel'?ctx.profile.padding:0,bottom:role==='skin.surface.panel'?ctx.profile.padding:0})};
}

// Explicit layers opt in; legacy node geometry remains unchanged.
// Child size means its fully resolved slot-local extent, not its authored size.
export function surfaceSlotBox({type,props={},size,profile,geometry,surfaceLayer,surfaceScale}){
 if(!surfaceLayer)return null;
 if(!geometry)fail('显式表面层缺少内容安全区证据。');
 const layer=surfaceLayerInfo(geometry,surfaceLayer,surfaceScale),s=textProfile(profile,props),g=s.geometry;
 let pad=layer.insets,width,height,x,y,allowVerticalOverflow=false;
 if(type==='Panel'){
  pad=props.contentPadding??pad;
  if(sides.some(side=>!Number.isFinite(pad[side])||pad[side]<layer.insets[side]))fail('内容边距侵入所选表面的安全区。');
  x=pad.left;y=pad.top+(props.title?g.lineHeight+g.titleGap:0);
  width=size.width-pad.left-pad.right;height=size.height-pad.top-pad.bottom-(props.title?g.lineHeight+g.titleGap:0);
 }else if(type==='Dialog'){
  const p=Math.max(s.padding,...Object.values(pad));pad=Object.fromEntries(sides.map(k=>[k,p]));x=p;y=p+(props.title?g.lineHeight+g.titleGap:0);
  width=size.width-p*2;height=size.height-p*2-(props.title?g.lineHeight+g.titleGap:0)-((props.actions??[]).length?s.itemHeight+g.labelGap:0);allowVerticalOverflow=true;
 }else if(type==='ScrollView'){
  pad=scrollPadding(s,pad);x=pad.left;y=pad.top;
  width=size.width-pad.left-pad.right-g.scrollbarWidth-g.scrollbarGap;height=size.height-pad.top-pad.bottom;allowVerticalOverflow=true;
 }else if(type==='Tabs'){
  const box=tabsContentBox(s,pad,size.width,size.height);({width,height,x,y}=box);
 }else if(type==='List'){
  x=pad.left;y=pad.top;width=size.width-pad.left-pad.right;height=size.height-pad.top-pad.bottom;allowVerticalOverflow=true;
 }else fail('该组件不支持显式表面内容槽。');
 if(![width,height,x,y].every(Number.isFinite)||width<0||height<0)fail('显式表面内容区无效。');
 return {width,height,x,y,allowVerticalOverflow,baseRole:layer.baseRole,insets:{...pad}};
}

export function assertSurfaceSlotChildren(options,children){
 const box=surfaceSlotBox(options);if(!box)return null;
 if(options.type==='List'&&options.props.inventory&&children.length)fail('仓库展示不接受显式内容子行。');
 for(const child of children){
  const size=child.size;
  if(!size||![size.width,size.height].every(n=>Number.isFinite(n)&&n>=0)||size.width>box.width+.1||!box.allowVerticalOverflow&&size.height>box.height+.1)
   fail('内容超过显式表面层的安全内容区；请扩大表面或调整内部内容。',child.id);
 }
 return box;
}

// Compute before mutating any actual handles, so simultaneous parent/child fill
// resize uses the complete new solution rather than a stale child measurement.
export function effectiveSurfaceSizes(handles,plans){
 const sizes=new Map([...handles].map(([id,h])=>[id,{...(h.requestedSize??h.size)}]));
 for(const plan of plans)for(const [id,rect]of plan)sizes.set(id,{width:rect.width,height:rect.height});
 return sizes;
}
