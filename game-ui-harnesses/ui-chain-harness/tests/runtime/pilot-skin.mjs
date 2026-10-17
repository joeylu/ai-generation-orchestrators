import { ImageSource, Texture, Sprite, NineSliceSprite } from 'pixi.js';
import { reject } from '../../src/runtime/skin.mjs';
const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const digest=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(v=>v.toString(16).padStart(2,'0')).join('');

// Acceptance scaffold only. Fonts and nonvisual Container/Text still use the
// existing fixture profile. Every displayed skin texture comes from this pilot;
// missing roles throw and never fall back to a synthetic picture.
export async function attachPilotTextures(skin,packet){
  const old=[...skin.textures.values()],bitmaps=[],loaded=new Map(),metadata=new Map();
  const originalDispose=skin.dispose.bind(skin);let disposed=false;
  try{
    for(const a of packet.assets){
      const b=bytes(a.data);if(await digest(b)!==a.sha256)reject('pilot.digest','Pilot texture differs from selected normalized candidate.');
      const bitmap=await createImageBitmap(new Blob([b],{type:'image/png'}),{premultiplyAlpha:'premultiply',colorSpaceConversion:'none'});
      bitmaps.push(bitmap);if(bitmap.width!==a.width||bitmap.height!==a.height)reject('pilot.size','Pilot dimensions mismatch.');
      loaded.set(a.assetId,new Texture({source:new ImageSource({resource:bitmap,resolution:a.density,alphaMode:'premultiplied-alpha',scaleMode:'linear',autoGenerateMipmaps:true})}));
      metadata.set(a.assetId,a);
    }
    skin.textures.clear();for(const t of old)t.destroy(true);
    for(const [id,t] of loaded)skin.textures.set(id,t);
    skin.metadata=metadata;skin.contentKind='generated-pilot-candidates';skin.visualAcceptance='unreviewed';
    const asset=role=>{
      const id=skin.roles.get(role);if(disposed||!metadata.has(id))reject('pilot.missing-role','The partial pilot does not cover '+role);return metadata.get(id);
    };
    skin.texture=role=>skin.textures.get(asset(role).assetId);
    skin.tuple=role=>{const s=asset(role).nineSlice;return[s.left,s.top,s.right,s.bottom];};
    skin.insets=role=>{asset(role);return{left:0,top:0,right:0,bottom:0};};
    skin.assertView=(role,w,h)=>{const a=asset(role);if(w<a.minSize.width||h<a.minSize.height)reject('pilot.minimum','View below explicit pilot minimum.');};
    skin.view=(role,w,h)=>{
      skin.assertView(role,w,h);const a=asset(role),s=a.nineSlice,t=skin.texture(role);
      const view=a.stretch==='uniform'?new Sprite({texture:t}):new NineSliceSprite({texture:t,leftWidth:s.left,topHeight:s.top,rightWidth:s.right,bottomHeight:s.bottom});
      view.width=w;view.height=h;view.eventMode='none';return view;
    };
    skin.assertComponent=(type,p,w,h)=>{
      if(!['Slider','ProgressBar','Switch','ScrollView','Text','Container'].includes(type))reject('pilot.type','Component outside the partial pilot scope.');
      const profile=skin.profile,g=profile.geometry;
      if(type==='Slider'||type==='ProgressBar')for(const role of ['skin.bar.track','skin.bar.fill'])skin.assertView(role,type==='Slider'?w-profile.thumbSize:w,profile.trackHeight);
      if(type==='ScrollView'){skin.assertView('skin.scrollbar.track',g.scrollbarWidth,h);skin.assertView('skin.scrollbar.thumb',g.scrollbarWidth,g.minThumbLength);}
    };
    skin.dispose=()=>{if(disposed)return;disposed=true;originalDispose();for(const b of bitmaps)b.close();};
    return skin;
  }catch(e){for(const t of loaded.values())t.destroy(true);for(const b of bitmaps)b.close();throw e;}
}
