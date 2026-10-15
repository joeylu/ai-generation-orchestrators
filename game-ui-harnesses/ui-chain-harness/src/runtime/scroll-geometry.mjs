export function scrollPadding(profile,insets){
  return Object.fromEntries(['left','top','right','bottom'].map(side=>{
    if(!Number.isFinite(insets?.[side])||insets[side]<0)throw Error('Invalid scroll content insets');
    return [side,Math.max(insets[side],profile.padding)];
  }));
}
