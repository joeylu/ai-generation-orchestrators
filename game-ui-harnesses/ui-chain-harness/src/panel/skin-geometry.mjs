import {skinUsage} from '../skins/usage.mjs';
// Read only verified pack metadata; the manifest digest binds this to the skin.
export function settingsSkinGeometry(pack){
  const id=pack.roles.find(r=>r.role==='skin.surface.content')?.assetId;
  const asset=pack.assets.find(a=>a.assetId===id);
  if(!asset)throw Error('Missing settings scroll surface');
  return {scrollInsets:skinUsage(asset,asset.width,asset.height,pack.scale).contentInsets};
}
