import {textProfile} from './text-style.mjs';
import {scrollPadding} from './scroll-geometry.mjs';
import {tabsContentBox} from './tabs-geometry.mjs';
import {surfaceSlotBox} from './surface-slots.mjs';

// Adapter-owned child space, in the owner's logical coordinates. Leaf controls
// have no authored child body; their label/mark geometry is a separate contract.
export const contentOwnerTypes=Object.freeze(['Container','Panel','Dialog','ScrollView','Tabs','List']);
function insets(geometry,role,fallback){
 if(geometry?.roles instanceof Map&&!geometry.roles.has(role)||Array.isArray(geometry?.roles)&&!geometry.roles.some(item=>item.role===role))return fallback;
 if(typeof geometry?.insets==='function')return geometry.insets(role);
 const id=geometry?.roles instanceof Map?geometry.roles.get(role):geometry?.roles?.find(item=>item.role===role)?.assetId;
 const asset=geometry?.metadata instanceof Map?geometry.metadata.get(id):geometry?.assets?.find(item=>item.assetId===id);
 return asset?.contentInsets??fallback;
}
export function componentContentBox(options){
 const {type,props={},size,profile,geometry,layout={}}=options;
 if(!contentOwnerTypes.includes(type))return null;
 if(type==='List'&&props.inventory)return null; // Independent grid/detail viewports; no authored body slot.
 if(options.surfaceLayer)return surfaceSlotBox(options);
 const s=textProfile(profile,props),g=s.geometry,all=value=>({left:value,right:value,top:value,bottom:value});
 let pad,x,y,width,height,allowVerticalOverflow=false;
 if(type==='Container'){pad=all(layout.padding??0);}
 if(type==='Panel'){pad=props.contentPadding??insets(geometry,'skin.surface.panel',all(s.padding));}
 if(type==='Dialog'){pad=all(s.padding);allowVerticalOverflow=true;}
 if(type==='ScrollView'){pad=scrollPadding(s,insets(geometry,'skin.surface.content',all(0)));allowVerticalOverflow=true;}
 if(type==='Tabs'){
  const padding=insets(geometry,'skin.surface.content',null),box=tabsContentBox(s,padding,size.width,size.height);
  return {x:box.x,y:box.y,width:box.width,height:box.height,allowVerticalOverflow:false,insets:{...box.pad}};
 }
 if(type==='List'){pad=all(0);allowVerticalOverflow=true;}
 x=pad.left;y=pad.top;width=size.width-pad.left-pad.right;height=size.height-pad.top-pad.bottom;
 if(['Panel','Dialog'].includes(type)&&props.title){y+=g.lineHeight+g.titleGap;height-=g.lineHeight+g.titleGap;}
 if(type==='Dialog'&&(props.actions??[]).length)height-=s.itemHeight+g.labelGap;
 if(type==='ScrollView')width-=g.scrollbarWidth+g.scrollbarGap;
 return {x,y,width,height,allowVerticalOverflow,insets:{...pad}};
}
