import {hasTextWrap,wrapStaticText} from './text-wrap.mjs';
/** Opt-in grouped settings geometry; supplied rows, state and events remain authoritative. */
export function measureGroupedSection(spec,tokens,section,width,purpose,showTitle,geometry,version=1) {
  const heading=showTitle?spec.layout.sectionTitleHeight+12:0,inset=20;
  if(purpose==='settings'&&section.rows.every(row=>(version===2?['slider','switch','select','text','progress']:['slider','switch']).includes(row.kind))){
    const allSwitches=section.rows.every(row=>row.kind==='switch');
    let y=heading+(allSwitches?0:12);
    const rows=section.rows.map((row,index)=>{
      if(index>0)y+=12;
      const slider=row.kind==='slider',copy=version===2&&row.kind==='text'&&hasTextWrap(spec,row.id),textBlock=copy?wrapStaticText(row.text,width-inset*2,tokens.fontSize):null;
      const textHeight=Math.ceil(tokens.fontSize*1.3);
      const height=Math.max(spec.layout.rowHeight,copy?textHeight+8+textBlock.height+16:slider?88:row.kind==='text'?56:64);
      const place={y,height,stacked:slider,labelX:inset,labelY:slider?0:(height-Math.ceil(tokens.fontSize*1.3))/2,
        iconX:inset,iconY:slider?0:(height-28)/2,
        controlX:slider?inset:width-inset-76,controlWidth:slider?width-inset*2:76,
        ...(slider?{sliderStack:true,valueX:width-inset-68}:{})};
      if(version===2){
        if(row.kind==='select')Object.assign(place,{controlX:width-inset-164,controlWidth:164});
        if(row.kind==='text')Object.assign(place,copy?{copy:true,textBlock,labelY:8,copyTextY:8+textHeight+8,controlX:inset,controlWidth:width-inset*2}:{controlX:width-inset-176,controlWidth:176});
        if(row.kind==='progress')Object.assign(place,{controlX:152,controlWidth:width-inset-152,valueX:width-inset-68});
      }
      y+=height;return place;
    });
    return{purpose,showTitle,grouped:false,settingsGroup:true,dividerInset:inset,dividerOffset:6,heading,height:y+(allSwitches?0:12),rows};
  }
  if(purpose==='menu'&&section.rows.length===1&&section.rows[0].label===''){
    const size=geometry(section.rows[0],width,56),height=Math.max(spec.layout.rowHeight,56,size.height);
    if(size.width>width){const error=new Error('Grouped action exceeds its section width');error.code='ACTION_LAYOUT_OVERFLOW';throw error;}
    return{purpose,showTitle,grouped:false,settingsGroup:true,height:heading+height,
      rows:[{y:heading,height,explicitAction:true,controlX:(width-size.width)/2,controlWidth:size.width,controlHeight:size.height,circle:size.circle}]};
  }
  return null;
}
