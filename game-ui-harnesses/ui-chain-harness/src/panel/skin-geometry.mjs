import {skinUsage} from '../skins/usage.mjs';
// Read only verified pack metadata; the manifest digest binds this to the skin.
export function settingsSkinGeometry(pack){
  const id=pack.roles.find(r=>r.role==='skin.surface.content')?.assetId;
  const asset=pack.assets.find(a=>a.assetId===id);
  if(!asset)throw Error('Missing settings scroll surface');
  const panelId=pack.roles.find(r=>r.role==='skin.surface.panel')?.assetId;
  const panel=pack.assets.find(a=>a.assetId===panelId);
  if(!panel)throw Error('Missing panel surface');
  return {scrollInsets:skinUsage(asset,asset.width,asset.height,pack.scale).contentInsets,
    panelInsets:skinUsage(panel,panel.width,panel.height,pack.scale).contentInsets,
    skinGeometry:{version:'1.0',scale:pack.scale,roles:structuredClone(pack.roles),...(pack.surfaceStyles?{surfaceStyles:structuredClone(pack.surfaceStyles)}:{}),...(pack.materialAssets?{materialAssets:pack.materialAssets.map(a=>({assetId:a.assetId,width:a.width,height:a.height}))}:{}),assets:pack.assets.map(a=>Object.fromEntries(
      ['assetId','width','height','density','nineSlice','contentInsets','minSize','stretch'].filter(k=>a[k]!==undefined).map(k=>[k,structuredClone(a[k])])))} };
}
