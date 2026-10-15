import { Texture, ImageSource, Sprite, NineSliceSprite, Text } from 'pixi.js';
import { validatePack, fail } from '../skins/contract.mjs';
import { fitText } from './skin.mjs';
import { skinUsage } from '../skins/usage.mjs';
import {tabsContentBox} from './tabs-geometry.mjs';

// read(file) supplies local package bytes. No implicit URL resolution, network,
// global Assets cache alias, or fallback texture is introduced by this loader.
export async function loadPngSkin({ manifestBytes, manifestSha256, expectedBindings, read }) {
  const digest = async b => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map(v=>v.toString(16).padStart(2,'0')).join('');
  if (await digest(manifestBytes) !== manifestSha256) fail('skin.digest','Skin manifest digest differs from selected revision.');
  if (!expectedBindings || !['templateSha256','registrySha256','usageSha256'].every(k=>/^[a-f0-9]{64}$/.test(expectedBindings[k]))) fail('skin.binding','Explicit consumer bindings are required.');
  const pack = validatePack(JSON.parse(new TextDecoder().decode(manifestBytes)), expectedBindings);
  const textures=new Map(), metadata=new Map(pack.assets.map(a=>[a.assetId,a])), roles=new Map(pack.roles.map(b=>[b.role,b.assetId])), faces=[], bitmaps=[];
  const family=`Skin-${manifestSha256.slice(0,20)}-${crypto.randomUUID()}`;
  const profile={...pack.theme,fontFamily:family};
  const usages=new Map(pack.assets.map(a=>[a.assetId,skinUsage(a,a.width,a.height,pack.scale)]));
  let disposed=false, total=0;
  const bytesOf = async f => {
    const bytes=new Uint8Array(await read(f.file)); total+=bytes.byteLength;
    if(total>128*1024*1024 || bytes.byteLength!==f.bytes || await digest(bytes)!==f.sha256) fail('skin.digest',`Resource differs from manifest: ${f.file}`);
    return bytes;
  };
  const dispose=()=>{
    if(disposed)return; disposed=true;
    for(const texture of textures.values())texture.destroy(true);
    textures.clear();
    for(const bitmap of bitmaps)bitmap.close();
    for(const face of faces)document.fonts.delete(face);
  };
  try {
    for(const a of pack.assets){
      const bytes=await bytesOf(a);
      const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}),{premultiplyAlpha:'premultiply',colorSpaceConversion:'none'});
      bitmaps.push(bitmap);
      if(bitmap.width!==a.width || bitmap.height!==a.height)fail('skin.dimensions','Decoded PNG dimensions mismatch.');
      textures.set(a.assetId,new Texture({source:new ImageSource({resource:bitmap,resolution:usages.get(a.assetId).resolution,alphaMode:'premultiplied-alpha',scaleMode:'linear',autoGenerateMipmaps:a.stretch!=='vertical'})}));
    }
    for(const f of pack.fonts){
      const face=new FontFace(family,await bytesOf(f),{weight:String(f.weight),style:f.style,unicodeRange:f.unicodeRange});
      await face.load(); document.fonts.add(face); faces.push(face);
    }
    for(const f of pack.licenses)await bytesOf(f);
    const asset=role=>{
      const id=roles.get(role);
      if(disposed || !textures.has(id))fail('skin.role',`Missing live skin role: ${role}`);
      return metadata.get(id);
    };
    return {
      sourceKind:pack.sourceKind, format:'png-pack', manifestSha256, visualAcceptance:pack.visualAcceptance,
      profile,textures,metadata,roles,
      texture(role){return textures.get(asset(role).assetId);},
      tuple(role){return [...usages.get(asset(role).assetId).tuple];},
      insets(role){return {...usages.get(asset(role).assetId).contentInsets};},
      backgroundSpec(role){return {texture:this.texture(role),borders:{...usages.get(asset(role).assetId).borders}};},
      assertView(role,width,height){const a=asset(role);if(!Number.isFinite(width)||!Number.isFinite(height)||width<a.minSize.width||height<a.minSize.height)fail('skin.minimum',`${role}: below declared skin minimum.`);usages.get(a.assetId).measure(width,height);},
      assertComponent(type,p,w,h){
        const s=profile,g=s.geometry, check=(role,width,height)=>this.assertView(role,width,height);
        const button=(base,width,height)=>{for(const state of ['normal','pressed'])check(`${base}.${state}`,width,height);};
        if(type==='Button')button(`skin.button.${p.variant}`,w,h);
        if(type==='Input'||type==='Select'){
          check('skin.field.normal',w,h);
          const pad=this.insets('skin.field.normal');
          if(w<pad.left+pad.right+g.minContent||h<pad.top+pad.bottom+g.lineHeight)fail('skin.content','Field content exceeds skin safe area.');
        }
        if(type==='Select'){
          check('skin.surface.popup',w,h+Math.min(p.options.length,p.maxVisibleItems)*s.itemHeight);
          if(Object.values(this.insets('skin.surface.popup')).some(n=>n!==0))fail('skin.capability','Inset popup contents are not supported by the current Select adapter.');
        }
        if(type==='Select')for(const state of ['normal','selected'])check(`skin.item.${state}`,w,s.itemHeight);
        if(type==='Panel'||type==='Dialog'){
          check('skin.surface.panel',w,h);
          const safe=this.insets('skin.surface.panel'),pad=type==='Panel'?(p.contentPadding??safe):{left:s.padding,right:s.padding,top:s.padding,bottom:s.padding};
          if(Object.keys(safe).some(k=>pad[k]<safe[k]))fail(type==='Panel'?'panel.padding':'skin.content','Padding intrudes into skin content area.');
          if(w<pad.left+pad.right+g.minContent||h<pad.top+pad.bottom+(p.title?g.lineHeight+g.titleGap:0)+g.minContent)fail('skin.content','Panel/Dialog content exceeds skin safe area.');
          if(type==='Dialog')for(const action of p.actions)button(`skin.button.${action.variant}`, (w-2*s.padding-Math.max(0,p.actions.length-1)*g.labelGap)/Math.max(1,p.actions.length),s.itemHeight);
        }
        if(type==='List')for(const state of ['normal','selected'])check(`skin.item.${state}`,w,s.itemHeight);
        if(type==='Tabs'){
          const box=tabsContentBox(s,roles.has('skin.surface.content')?this.insets('skin.surface.content'):null,w,h);
          if(roles.has('skin.surface.content')){check('skin.surface.content',w,h);check('skin.surface.content',box.surface.width,box.surface.height);}
          if(p.tabs.length)for(const state of ['normal','selected'])check(`skin.tab.${state}`,(box.surface.width-Math.max(0,p.tabs.length-1)*g.tabGap)/p.tabs.length,s.itemHeight);
          if(box.width<g.minContent||box.height<g.minContent)fail('skin.content','Tabs content exceeds skin safe area.');
        }
        if(type==='Slider'||type==='ProgressBar')for(const role of ['skin.bar.track','skin.bar.fill'])check(role,type==='Slider'?w-s.thumbSize:w,s.trackHeight);
        if(type==='ScrollView'){
          check('skin.surface.content',w,h);
          const pad=Object.fromEntries(Object.entries(this.insets('skin.surface.content')).map(([key,value])=>[key,Math.max(value,s.padding)]));
          const innerHeight=h-pad.top-pad.bottom;
          if(w-pad.left-pad.right-g.scrollbarWidth-g.scrollbarGap<g.minContent||innerHeight<Math.max(g.minContent,g.minThumbLength))fail('skin.content','ScrollView content exceeds skin safe area.');
          check('skin.scrollbar.track',g.scrollbarWidth,innerHeight);check('skin.scrollbar.thumb',g.scrollbarWidth,g.minThumbLength);
        }
      },
      view(role,width,height){
        this.assertView(role,width,height);
        const a=asset(role), texture=this.texture(role);
        const view=a.stretch==='uniform'?new Sprite({texture}):new NineSliceSprite({texture,...usages.get(a.assetId).pixi});
        view.width=width;view.height=height;view.eventMode='none';return view;
      },
      textStyle(extra={}){return {fontFamily:family,fontSize:profile.fontSize,fill:profile.palette.text,...extra};},
      label(value,width,extra={}){return fitText(new Text({text:String(value).replace(/\s+/g,' '),style:this.textStyle(extra)}),width,10000,'ellipsis');},
      dispose,
    };
  } catch(e){dispose();throw e;}
}
