import {png} from './raster-skin.mjs';

const luminance = color => {
  const c=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  return c[0]*.2126+c[1]*.7152+c[2]*.0722;
};
export function tabContrast(a,b) { const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05); }
const readable = (preferred,background,minimum=4.5) => tabContrast(preferred,background)>=minimum ? preferred
  : tabContrast('#000000',background)>=tabContrast('#FFFFFF',background)?'#000000':'#FFFFFF';

/** Equal semantic header cells retain their exact existing hit targets and page geometry. */
export function tabPalette(tokens) {
  return {idle:tokens.control,active:tokens.surface,text:readable(tokens.muted,tokens.control),
    activeText:readable(tokens.accent,tokens.surface),indicator:readable(tokens.accent,tokens.surface,3),focus:readable(tokens.accent,tokens.control,3)};
}
export function tabsSkin(rect,count,tokens,headerHeight=48) {
  const width=Math.ceil(rect.width/count),height=headerHeight,palette=tabPalette(tokens);
  const key=`generated/tabs-v1/${width}-${height}-${palette.idle.slice(1)}-${palette.active.slice(1)}-${palette.indicator.slice(1)}-${tokens.border.slice(1)}`;
  const paths={idle:`${key}/idle.png`,active:`${key}/active.png`};
  const resources=[{path:paths.idle,bytes:png(width,height,[palette.idle,tokens.border],(x,y)=>y===height-1?8:4)},
    {path:paths.active,bytes:png(width,height,[palette.active,palette.indicator],(x,y)=>y>=height-3?8:4)}].map(r=>({...r,mime:'image/png'}));
  return {palette,resources,appearance:{sourceCanvas:{width:rect.width,height:rect.height},tabImage:paths.idle,tabCanvas:{width,height},activeTabImage:paths.active,activeTabCanvas:{width,height},
    headerHeight,labelLayout:{x:12,y:0,width:width-24,height:height-3},hitArea:{x:0,y:0,width,height},activeTextColor:palette.activeText}};
}
