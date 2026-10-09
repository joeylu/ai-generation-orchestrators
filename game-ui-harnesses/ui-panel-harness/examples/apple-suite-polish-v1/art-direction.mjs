/** Candidate art direction, shared by local samples. This is not a Studio default. */
export const APPLE_SUITE_RULES=Object.freeze({
  id:'apple-suite-polish-v1',status:'candidate',fontFamily:'Segoe UI, Microsoft YaHei UI, sans-serif',
  typography:Object.freeze({title:24,body:16,button:16}),
  geometry:Object.freeze({panelRadius:20,buttonRadius:10,buttonHeight:48,padding:28,sectionGap:16,menuGap:12}),
  widths:Object.freeze({menu:428,pause:428,audio:500,graphics:500,profile:460,exit:428}),
  behavior:'Preserve authored copy, row order, state, bindings, actions and assets; at most one filled primary per action group.',
  surfaces:'A complete rounded plate contains each panel; content grouping uses spacing and separators. Dialogs also use their existing fine edge and subtle shadow.',
  icons:'Preserve existing plain audio icons; add no decorative icons to text menus, profile data or confirmation actions.',
  presentation:'Use each content type’s existing layout. Retain raised-v1 slider artwork for settings.',
});
export function appleSuitePalette(mode){
  if(!['light','dark'].includes(mode))throw new Error('APPLE_SUITE_MODE');
  return mode==='dark'?{canvas:'#101216',surface:'#24272D',control:'#343840',accent:'#71A7FF',text:'#F5F6F8',description:'#C3C7D0',muted:'#AEB4BF',border:'#454A54',primaryFill:'#2466C9',primaryText:'#FFFFFF',secondaryText:'#E0E4EB'}
    :{canvas:'#E9EBEF',surface:'#FDFDFE',control:'#F0F1F4',accent:'#0066CC',text:'#23262C',description:'#5E626C',muted:'#6C717B',border:'#D4D7DE',primaryFill:'#0066CC',primaryText:'#FFFFFF',secondaryText:'#3D4654'};
}
