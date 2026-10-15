import {hasTextWrap,wrapStaticText} from './text-wrap.mjs';
import {isMessageText} from './message-text.mjs';
import {measureReadableData} from './readable-data.mjs';

export const DATA_ITEM_PADDING = 12;
export const hasDataItemPanels = theme => theme?.draftSizing==='game-readable-v5';
// Read-only labeled facts are data items. Prose/questions retain message.text.
export const isDataItem = (row,catalog) => row.kind==='text'&&Boolean(row.label)&&!isMessageText(row,catalog);

/** A real Panel encloses each complete label/value pair, within its semantic group. */
export function measureDataItemPanels(spec,tokens,section,width,textWidth,catalog){
  const rows=section.rows.filter(row=>isDataItem(row,catalog));
  if(!rows.length)return new Map();
  const innerWidth=width-DATA_ITEM_PADDING*2,icons=new Set(spec.assets?.rowIcons.map(icon=>icon.rowId)??[]);
  const single=measureReadableData(spec,tokens,{...section,rows},innerWidth,textWidth,catalog);
  return new Map(rows.map(row=>{
    const inset=icons.has(row.id)?40:0,available=innerWidth-inset,lineHeight=Math.ceil(tokens.fontSize*1.3);
    if(textWidth(row.label,tokens.fontSize)>available){const error=new Error('DATA_TEXT_FIT: Data label must fit inside its Panel');error.code='DATA_TEXT_FIT';throw error;}
    const block=hasTextWrap(spec,row.id)?wrapStaticText(row.text,available,tokens.fontSize):null;
    const layout=block?{height:lineHeight+12+block.height,copy:true,stacked:true,labelX:0,labelY:0,labelWidth:available,
      iconX:0,iconY:0,controlX:inset,controlWidth:available,copyTextY:lineHeight+12,textBlock:block,allowPartialScroll:true}:single.get(row.id);
    return [row.id,{...layout,height:layout.height+DATA_ITEM_PADDING*2,dataPanel:{padding:DATA_ITEM_PADDING,contentWidth:innerWidth,contentHeight:layout.height}}];
  }));
}
