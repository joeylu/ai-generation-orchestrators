import {surfaceLayerInfo} from '../skins/surface-styles.mjs';
import {surfaceGeometryForContext} from '../runtime/surface-slots.mjs';
// Versioned consumer geometry. No upstream compiler, theme colors or model calls.
const fail=()=>{throw Object.assign(Error('Invalid custom layout policy.'),{code:'panel.action-layout-policy'});};
const keys=(v,allowed)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>allowed.includes(k));
const base=['version','groupGap','groupPadding','maxDepth','gridColumns','minColumnWidth'];
export function customLayoutPolicy(preset){
 const l=preset.layout;if(!l)fail();const modern=['2.0','3.0'].includes(l.version);
 if(!['1.0','2.0','3.0'].includes(l.version)||!keys(l,modern?[...base,'maxColumns','minCardWidth','groupSurfaces','dataSurfaces']:base)||
  !base.slice(1).every(k=>Number.isInteger(l[k]))||l.groupGap<0||l.groupGap>128||l.groupPadding<0||l.groupPadding>128||l.maxDepth<1||l.maxDepth>8||l.gridColumns!==2||l.minColumnWidth<24||l.minColumnWidth>512||
  modern&&(!Number.isInteger(l.maxColumns)||l.maxColumns<1||l.maxColumns>3||!Number.isInteger(l.minCardWidth)||l.minCardWidth<l.minColumnWidth||l.minCardWidth>1024||typeof l.groupSurfaces!=='boolean'||typeof l.dataSurfaces!=='boolean'))fail();
 return l;
}
export const adaptivePresentation=l=>['2.0','3.0'].includes(l.version);
export const isDataField=f=>f.type==='text'&&Boolean(f.label)&&f.label!==f.text;
export const hasContentSurface=(rows,layered=false)=>rows.some(f=>f.type!=='button'&&(layered||f.type!=='text'||isDataField(f)));
export function contentInsets(l,ctx,layer){
 const geometry=layer?surfaceGeometryForContext(ctx):null;
 const source=geometry?surfaceLayerInfo(geometry,layer)?.insets:ctx.panelInsets;
 return Object.fromEntries(['left','right','top','bottom'].map(k=>[k,Math.max(l.groupPadding,source?.[k]??ctx.profile.padding)]));
}
export function adaptiveColumns(l,canvas,count,width,minimum){
 if(!adaptivePresentation(l))return l.gridColumns;
 if(canvas==='portrait')return 1;
 const capacity=Math.max(1,Math.floor((width+l.groupGap)/(Math.max(minimum,l.minCardWidth)+l.groupGap)));
 return Math.min(count,l.maxColumns,capacity);
}
export function dataArrangement(rows,width,padding,gap,widthOf){
 const data=rows.filter(f=>isDataField(f)&&f.wrap==='none'),labelWidth=Math.max(24,...data.map(f=>widthOf(f.label)));
 return {labelWidth,stacked:data.some(f=>labelWidth+gap+Math.max(24,widthOf(f.text))>width-padding.left-padding.right)};
}
