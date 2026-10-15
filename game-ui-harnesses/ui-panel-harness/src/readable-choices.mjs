import {wrapStaticText} from './text-wrap.mjs';

/** Display-only line breaks. IDs, source labels and selected values remain authoritative. */
export function readableChoiceLayout(row,field,width,fontSize){
  const controlWidth=width-(row.kind==='select'?0:24),textWidth=controlWidth-48;
  const blocks=field.options.map(option=>wrapStaticText(option.label,textWidth,fontSize));
  const itemHeight=Math.max(row.kind==='list'?row.itemHeight:64,...blocks.map(block=>block.height+12));
  // List and its native adapter cap a cell at 96 logical pixels. Reject full copy
  // beyond that contract instead of ellipsizing, shrinking or clipping it.
  if(row.kind==='list'&&itemHeight>96){const error=new Error('CHOICE_WRAP_HEIGHT: List copy needs a wider explicit panel or shorter authored labels');error.code='CHOICE_WRAP_HEIGHT';throw error;}
  return {labels:blocks.map(block=>block.lines.join('\n')),itemHeight,controlWidth};
}
