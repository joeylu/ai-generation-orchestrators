import {skinUsage} from '../skins/usage.mjs';
import {tabsContentBox} from './tabs-geometry.mjs';
import {textProfile} from './text-style.mjs';
import {inventoryLayout} from './inventory-geometry.mjs';
import {inventorySlotRoles} from './inventory-policy.mjs';
import {surfaceLayerInfo} from '../skins/surface-styles.mjs';

const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};

// Shared by the PNG renderer and deterministic panel compilation. Evidence contains
// only package geometry; it carries no paths, textures, credentials or host state.
export function pngGeometry(evidence,profile){
  if(evidence?.version!=='1.0'||!Array.isArray(evidence.assets)||!Array.isArray(evidence.roles))fail('skin.geometry','Verified PNG geometry is required.');
  const assets=new Map(evidence.assets.map(a=>[a.assetId,a])),roles=new Map(evidence.roles.map(r=>[r.role,r.assetId]));
  const asset=role=>{const a=assets.get(roles.get(role));if(!a)fail('skin.role',`Missing skin role: ${role}`);return a;};
  return {profile,roles,metadata:assets,scale:evidence.scale,surfaceStyles:evidence.surfaceStyles,
    insets(role){return {...asset(role).contentInsets};},
    assertView(role,w,h){const a=asset(role);if(!Number.isFinite(w)||!Number.isFinite(h)||w<a.minSize.width||h<a.minSize.height)fail('skin.minimum',`${role}: below declared skin minimum.`);skinUsage(a,a.width,a.height,evidence.scale).measure(w,h);},
    assertComponent(type,p,w,h,options){return assertPngComponent(this,type,p,w,h,options);},
  };
}

export function assertPngComponent(skin,type,p,w,h,{surfaceLayer,surfaceScale}={}){
  const s=textProfile(skin.profile,p),g=s.geometry,check=(role,width,height)=>skin.assertView(role,width,height);
  const layer=surfaceLayer?surfaceLayerInfo(skin.surfaceGeometry??skin,surfaceLayer,surfaceScale):null;
  if(layer){if(w<layer.minWidth||h<layer.minHeight)fail('skin.surface-style','Surface layer is smaller than its skin minimum.');check(layer.baseRole,w/layer.scale,h/layer.scale);}
  if(type==='List'&&p.inventory){const box=inventoryLayout(skin.profile,p,w,h,skin,{surfaceLayer,surfaceScale});for(const role of inventorySlotRoles(skin,p.inventory))check(role,box.cell.width,box.cell.height);return;}
  const button=(base,width,height)=>{for(const state of ['normal','pressed'])check(`${base}.${state}`,width,height);};
  if(type==='Button')button(`skin.button.${p.variant}`,w,h);
  if(type==='Input'||type==='Select'){
    check('skin.field.normal',w,h);
    const pad=skin.insets('skin.field.normal');
    if(w<pad.left+pad.right+g.minContent||h<pad.top+pad.bottom+g.lineHeight)fail('skin.content','Field content exceeds skin safe area.');
  }
  if(type==='Select'){
    check('skin.surface.popup',w,h+Math.min(p.options.length,p.maxVisibleItems)*s.itemHeight);
    if(Object.values(skin.insets('skin.surface.popup')).some(n=>n!==0))fail('skin.capability','Inset popup contents are not supported by the current Select adapter.');
  }
  if(type==='Select')for(const state of ['normal','selected'])check(`skin.item.${state}`,w,s.itemHeight);
  if(type==='Panel'||type==='Dialog'){
    check(layer?.baseRole??'skin.surface.panel',w,h);
    const safe=layer?.insets??skin.insets('skin.surface.panel'),dialogPadding=layer?Math.max(s.padding,...Object.values(safe)):s.padding,pad=type==='Panel'?(p.contentPadding??safe):{left:dialogPadding,right:dialogPadding,top:dialogPadding,bottom:dialogPadding};
    if(Object.keys(safe).some(k=>pad[k]<safe[k]))fail(type==='Panel'?'panel.padding':'skin.content','Padding intrudes into skin content area.');
    if(w<pad.left+pad.right+g.minContent||h<pad.top+pad.bottom+(p.title?g.lineHeight+g.titleGap:0)+g.minContent)fail('skin.content','Panel/Dialog content exceeds skin safe area.');
    if(type==='Dialog')for(const action of p.actions)button(`skin.button.${action.variant}`,(w-2*dialogPadding-Math.max(0,p.actions.length-1)*g.labelGap)/Math.max(1,p.actions.length),s.itemHeight);
  }
  if(type==='List')for(const state of ['normal','selected'])check(`skin.item.${state}`,w,s.itemHeight);
  if(type==='Tabs'){
    const box=tabsContentBox(s,layer?.insets??(skin.roles.has('skin.surface.content')?skin.insets('skin.surface.content'):null),w,h);
    if(skin.roles.has('skin.surface.content')){check(layer?.baseRole??'skin.surface.content',w,h);if(!layer)check('skin.surface.content',box.surface.width,box.surface.height);}
    if(p.tabs.length)for(const state of ['normal','selected'])check(`skin.tab.${state}`,(box.surface.width-Math.max(0,p.tabs.length-1)*g.tabGap)/p.tabs.length,s.itemHeight);
    if(box.width<g.minContent||box.height<g.minContent)fail('skin.content','Tabs content exceeds skin safe area.');
  }
  if(type==='Slider'||type==='ProgressBar')for(const role of ['skin.bar.track','skin.bar.fill'])check(role,type==='Slider'?w-s.thumbSize:w,s.trackHeight);
  if(type==='ScrollView'){
    check(layer?.baseRole??'skin.surface.content',w,h);
    const pad=Object.fromEntries(Object.entries(layer?.insets??skin.insets('skin.surface.content')).map(([key,value])=>[key,Math.max(value,s.padding)]));
    const innerHeight=h-pad.top-pad.bottom;
    if(w-pad.left-pad.right-g.scrollbarWidth-g.scrollbarGap<g.minContent||innerHeight<Math.max(g.minContent,g.minThumbLength))fail('skin.content','ScrollView content exceeds skin safe area.');
    check('skin.scrollbar.track',g.scrollbarWidth,innerHeight);check('skin.scrollbar.thumb',g.scrollbarWidth,g.minThumbLength);
  }
}
