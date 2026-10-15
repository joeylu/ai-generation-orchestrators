import {rgb,luminance,contrastRatio,bestInk} from '../skins/text-readability.mjs';

// Preview chrome follows the selected skin without becoming part of its assets
// or authored document. Keep the canvas neutral so the panel remains the focus.
export function previewPalette(profile){
 const surface=profile.palette.base;
 if(!/^#[a-fA-F0-9]{6}$/.test(surface))throw Error('PREVIEW_PALETTE_INVALID');
 const color=rgb(surface),target=luminance(color)>.4?255:8;
 const canvas='#'+color.map(value=>Math.round(value*.36+target*.64).toString(16).padStart(2,'0')).join('');
 const requested=profile.palette.text;
 const ink=fill=>/^#[a-fA-F0-9]{6}$/.test(fill??'')&&contrastRatio(rgb(fill),color)>=4.5?fill:bestInk(color);
 return {canvas,ink:bestInk(rgb(canvas)),surface,surfaceInk:ink(requested),border:profile.palette.stroke??bestInk(color)};
}

export function mountPreviewTheme(profile){
 const palette=previewPalette(profile);
 for(const [key,value]of Object.entries(palette))document.documentElement.style.setProperty('--preview-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase()),value);
 const style=document.createElement('style');style.textContent=`
  body{background:var(--preview-canvas);color:var(--preview-ink)}
  nav button{background:var(--preview-surface);color:var(--preview-surface-ink);border:1px solid var(--preview-border)}
  nav button:hover{filter:brightness(1.08)}
  nav button:focus-visible{outline:2px solid var(--preview-ink);outline-offset:3px}
  body>p{color:var(--preview-ink);opacity:.85}
 `;
 document.head.append(style);
 return palette;
}
