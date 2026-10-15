import { Texture, ImageSource, Sprite, NineSliceSprite, Text } from 'pixi.js';
import { validatePack, fail } from '../skins/contract.mjs';
import { fitText } from './skin.mjs';
import { skinUsage } from '../skins/usage.mjs';
import {assertPngComponent} from './png-geometry.mjs';
import {visibleSelectionBounds} from './selection-geometry.mjs';
import {deriveTextReadability,textRoles} from '../skins/text-readability.mjs';
import {prepareSurfaceTextRegions} from './surface-text-box.mjs';
import {runtimeRoleInk as resolveRuntimeRoleInk} from './derived-text-ink.mjs';

// read(file) supplies local package bytes. No implicit URL resolution, network,
// global Assets cache alias, or fallback texture is introduced by this loader.
export async function loadPngSkin({ manifestBytes, manifestSha256, expectedBindings, read }) {
  const digest = async b => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map(v=>v.toString(16).padStart(2,'0')).join('');
  if (await digest(manifestBytes) !== manifestSha256) fail('skin.digest','Skin manifest digest differs from selected revision.');
  if (!expectedBindings || !['templateSha256','registrySha256','usageSha256'].every(k=>/^[a-f0-9]{64}$/.test(expectedBindings[k]))) fail('skin.binding','Explicit consumer bindings are required.');
  const pack = validatePack(JSON.parse(new TextDecoder().decode(manifestBytes)), expectedBindings);
  const textures=new Map(), visualBounds=new Map(), metadata=new Map(pack.assets.map(a=>[a.assetId,a])), roles=new Map(pack.roles.map(b=>[b.role,b.assetId])), faces=[], bitmaps=[];
  const family=`Skin-${manifestSha256.slice(0,20)}-${crypto.randomUUID()}`;
  const profile={...pack.theme,fontFamily:family};
  const usages=new Map(pack.assets.map(a=>[a.assetId,skinUsage(a,a.width,a.height,pack.scale)]));
  const pixelImages=new Map(),pixelAssets=new Set(textRoles(pack).map(r=>r.assetId));
  for(const key of ['title','section']){
    const style=pack.surfaceStyles?.[key],id=pack.roles.find(r=>r.role===(style?.baseRole??'skin.surface.bar'))?.assetId;
    if(id)pixelAssets.add(id);
  }
  let runtimeSurfaceTextRegions,runtimeTextReadability;
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
    visualBounds.clear();
    pixelImages.clear();runtimeSurfaceTextRegions?.clear();
    for(const bitmap of bitmaps)bitmap.close();
    for(const face of faces)document.fonts.delete(face);
  };
  try {
    for(const a of [...pack.assets,...(pack.materialAssets??[])]){
      const bytes=await bytesOf(a);
      const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}),{premultiplyAlpha:'premultiply',colorSpaceConversion:'none'});
      bitmaps.push(bitmap);
      if(bitmap.width!==a.width || bitmap.height!==a.height)fail('skin.dimensions','Decoded PNG dimensions mismatch.');
      const selection=['radio.ring','radio.dot','checkbox.box','checkbox.mark'].includes(a.assetId);
      if(selection||pixelAssets.has(a.assetId)){
        const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
        const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(bitmap,0,0);
        const image={width:bitmap.width,height:bitmap.height,pixels:context.getImageData(0,0,bitmap.width,bitmap.height).data};
        if(selection)visualBounds.set(a.assetId,visibleSelectionBounds(image));
        if(pixelAssets.has(a.assetId))pixelImages.set(a.assetId,image);
        canvas.width=canvas.height=0;
      }
      textures.set(a.assetId,new Texture({source:new ImageSource({resource:bitmap,resolution:usages.get(a.assetId)?.resolution??1,alphaMode:'premultiplied-alpha',scaleMode:'linear',autoGenerateMipmaps:a.stretch!=='vertical'})}));
    }
    for(const f of pack.fonts){
      const face=new FontFace(family,await bytesOf(f),{weight:String(f.weight),style:f.style,unicodeRange:f.unicodeRange});
      await face.load(); document.fonts.add(face); faces.push(face);
    }
    for(const f of pack.licenses)await bytesOf(f);
    // These caches describe verified pixels at runtime. They never replace the
    // frozen profile, package metadata or sampled source acceptance report.
    runtimeSurfaceTextRegions=prepareSurfaceTextRegions(pack,pixelImages);
    runtimeTextReadability=deriveTextReadability(pack,pixelImages,{preserve:true});
    pixelImages.clear();
    const asset=role=>{
      const id=roles.get(role);
      if(disposed || !textures.has(id))fail('skin.role',`Missing live skin role: ${role}`);
      return metadata.get(id);
    };
    return {
      sourceKind:pack.sourceKind, format:'png-pack', manifestSha256, visualAcceptance:pack.visualAcceptance,
      profile,textures,metadata,roles,runtimeSurfaceTextRegions,runtimeTextReadability,
      runtimeRoleInk(role,options){return resolveRuntimeRoleInk(this,role,options);},
      surfaceGeometry:{scale:pack.scale,roles:pack.roles,assets:pack.assets,surfaceStyles:pack.surfaceStyles,materialAssets:pack.materialAssets},
      texture(role){return textures.get(asset(role).assetId);},
      visualBounds(role){return {...(visualBounds.get(asset(role).assetId)??{x:0,y:0,width:1,height:1})};},
      tuple(role){return [...usages.get(asset(role).assetId).tuple];},
      insets(role){return {...usages.get(asset(role).assetId).contentInsets};},
      backgroundSpec(role){return {texture:this.texture(role),borders:{...usages.get(asset(role).assetId).borders}};},
      assertView(role,width,height){const a=asset(role);if(!Number.isFinite(width)||!Number.isFinite(height)||width<a.minSize.width||height<a.minSize.height)fail('skin.minimum',`${role}: below declared skin minimum.`);usages.get(a.assetId).measure(width,height);},
      assertComponent(type,p,w,h,options){return assertPngComponent(this,type,p,w,h,options);},
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
