import {hasDataItemPanels,measureDataItemPanels} from './data-item-panels.mjs';
import {hasAdaptiveGameData,measureReadableData} from './readable-data.mjs';
import {progressValueWidth} from './progress.mjs';
import {hasWrappedGameChoices} from './readable-game.mjs';
import {readableChoiceLayout} from './readable-choices.mjs';

/** Opt-in geometry for mixed readable rows; authored order, state and actions stay intact. */
export function measureReadableGameRows(spec,tokens,section,width,measured,geometry,textWidth,theme,catalog){
  const fields=new Map(spec.state.map(field=>[field.id,field])),icons=new Set(spec.assets?.rowIcons.map(icon=>icon.rowId)??[]);
  const explicit=new Set(spec.actionLayouts?.flatMap(action=>action.sectionId===section.id?section.rows.map(row=>row.id):[])??[]);
  const data=hasAdaptiveGameData(theme)?measureReadableData(spec,tokens,section,width,textWidth,catalog):new Map();
  const cards=hasDataItemPanels(theme)?measureDataItemPanels(spec,tokens,section,width,textWidth,catalog):new Map();
  const textHeight=Math.ceil(tokens.fontSize*1.3),rows=measured.rows.map((place,index)=>{
    const row=section.rows[index],iconOffset=icons.has(row.id)?40:0;
    if(cards.has(row.id)){const layout=cards.get(row.id);return {...place,...layout,height:Math.max(place.height,layout.height)};}
    if(data.has(row.id)&&!place.copy){const layout=data.get(row.id);return {...place,...layout,height:Math.max(place.height,layout.height)};}
    if(hasWrappedGameChoices(theme)&&['select','list','radio'].includes(row.kind)){
      const choiceLayout=readableChoiceLayout(row,fields.get(row.bind),width-iconOffset,tokens.fontSize);
      const controlY=textHeight+16,controlHeight=row.kind==='select'?choiceLayout.itemHeight
        :(row.kind==='list'?row.visibleItems:fields.get(row.bind).options.length)*choiceLayout.itemHeight;
      return {...place,height:Math.max(place.height,controlY+controlHeight+12),stacked:true,
        labelX:0,labelY:0,labelWidth:width-iconOffset,iconX:0,iconY:0,
        controlX:iconOffset,controlWidth:choiceLayout.controlWidth,controlY,controlHeight,choiceLayout};
    }
    if(['slider','progress'].includes(row.kind)){
      const field=fields.get(row.bind),valueWidth=row.kind==='progress'?progressValueWidth(row,field,tokens.fontSize)
        :Math.max(64,tokens.fontSize*4,...[field.min,field.max].map(value=>textWidth(row.format.prefix+value.toFixed(row.format.fractionDigits)+row.format.suffix,tokens.fontSize)+8));
      const controlY=textHeight+16,controlHeight=row.kind==='slider'?44:16;
      return {...place,height:Math.max(place.height,controlY+controlHeight),stacked:true,labelX:0,labelY:0,
        labelWidth:width-iconOffset-valueWidth-16,iconX:0,iconY:0,controlX:iconOffset,controlWidth:width-iconOffset,
        controlY,controlHeight,valueWidth,valueX:width-valueWidth,valueY:0,
        ...(row.kind==='slider'?{sliderStack:true}:{progressStack:true})};
    }
    if(row.kind==='button'&&!explicit.has(row.id)){
      const size=geometry(row,place.controlWidth??width-24-iconOffset,place.controlHeight??44);
      return {...place,height:Math.max(place.height,size.height),controlX:place.controlX??(width-size.width)/2,
        controlWidth:size.width,controlHeight:size.height,circle:size.circle};
    }
    return {...place};
  });
  // Horizontal actions share a row origin. Grow that band once, then shift later bands.
  const bands=[...new Set(measured.rows.map(place=>place.y))].sort((a,b)=>a-b);let extra=0;
  for(const y of bands){const indices=measured.rows.flatMap((place,index)=>place.y===y?[index]:[]);
    const before=Math.max(...indices.map(index=>measured.rows[index].height)),after=Math.max(...indices.map(index=>rows[index].height));
    for(const index of indices)rows[index].y+=extra;extra+=Math.max(0,after-before);
  }
  return {...measured,height:measured.height+extra,rows};
}
