import {hasTextWrap} from './text-wrap.mjs';
import {isMessageText} from './message-text.mjs';

export const hasAdaptiveGameData = theme => ['game-readable-v4','game-readable-v5'].includes(theme?.draftSizing);
export const isSingleLineData = (spec,row,catalog) => row.kind==='text'&&!hasTextWrap(spec,row.id)&&!isMessageText(row,catalog);

/** One consistent label/value arrangement per data group; no source-line rewriting. */
export function measureReadableData(spec,tokens,section,width,textWidth,catalog){
  const rows=section.rows.filter(row=>isSingleLineData(spec,row,catalog)),icons=new Set(spec.assets?.rowIcons.map(icon=>icon.rowId)??[]);
  const labelWidth=Math.max(0,...rows.map(row=>textWidth(row.label,tokens.fontSize))),lineHeight=Math.ceil(tokens.fontSize*1.3),gap=16;
  const stacked=rows.some(row=>labelWidth+(row.label?gap:0)+textWidth(row.text,tokens.fontSize)+(icons.has(row.id)?40:0)>width);
  return new Map(rows.map(row=>{
    const inset=icons.has(row.id)?40:0,available=width-inset;
    if(textWidth(row.label,tokens.fontSize)>available||textWidth(row.text,tokens.fontSize)>available){const error=new Error('DATA_TEXT_FIT: Complete non-wrapping data must fit its explicit content width');error.code='DATA_TEXT_FIT';throw error;}
    const height=stacked&&row.label?lineHeight*2+12:lineHeight+12;
    const controlX=inset+(!stacked&&row.label?labelWidth+gap:0),copyTextY=stacked&&row.label?lineHeight+12:0;
    return [row.id,{height,copy:true,stacked,labelX:0,labelY:0,labelWidth:stacked?available:labelWidth,
      iconX:0,iconY:0,controlX,controlWidth:width-controlX,copyTextY,dataArrangement:stacked?'stacked':'inline'}];
  }));
}
