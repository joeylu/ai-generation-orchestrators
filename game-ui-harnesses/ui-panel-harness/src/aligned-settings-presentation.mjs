/** Explicit grouped-v3 candidate: shared optical edges for settings and actions. */
export function measureAlignedSettings(spec,tokens,section,width,purpose,showTitle,geometry) {
  const heading=showTitle?spec.layout.sectionTitleHeight+16:0,right=18;
  const icons=new Set((spec.assets?.rowIcons??[]).map(icon=>icon.rowId));
  const leading=(purpose==='menu'?icons.size>0:section.rows.some(row=>icons.has(row.id)))?32:18;
  const reject=message=>{const error=new Error(message);error.code='ALIGNED_SETTINGS_GEOMETRY';throw error;};
  if(purpose==='settings'){
    if(width-leading-right<160)reject('Aligned settings need a readable label and value column');
    let y=heading;
    const dividers=[];
    const rows=section.rows.map((row,index)=>{
      if(index>0){y+=16;if(row.kind!==section.rows[index-1].kind)dividers.push(index);}
      const slider=row.kind==='slider',height=slider?72:56;
      const place={y,height,stacked:slider,labelX:icons.has(row.id)?0:leading,labelY:slider?0:(height-Math.ceil(tokens.fontSize*1.3))/2,
        labelWidth:width-right-64-leading-16,
        iconX:0,iconY:slider?0:(height-22)/2,iconSize:22,iconOffset:32,
        controlX:slider?leading-18:width-right-64,controlWidth:slider?width-leading+18:76,
        ...(slider?{sliderStack:true,controlY:24,controlHeight:44,valueX:width-right-64,valueY:2,valueFontSize:14,valueWidth:64}:{})};
      y+=height;return place;
    });
    return{purpose,showTitle,grouped:false,settingsGroup:true,dividerRows:dividers,dividerInset:leading,dividerRightInset:right,dividerOffset:8,heading,height:y,rows};
  }
  // Standalone actions retain their authored order; reset is separated from the trailing actions.
  const sizes=section.rows.map(row=>geometry(row,112,44));
  const height=Math.max(56,...sizes.map(size=>size.height));
  const reset=section.rows[0]?.action.kind==='reset-initial',start=reset?1:0,gap=12;
  const trailing=sizes.slice(start).reduce((sum,size)=>sum+size.width,0)+Math.max(0,sizes.length-start-1)*gap;
  const x=width-right-trailing;
  const resetX=reset?Math.max(0,leading-(sizes[0].width-64)/2):0;
  if(x<0||reset&&resetX+sizes[0].width+gap>x)reject('Aligned actions exceed the section width');
  return{purpose,showTitle,grouped:true,height:heading+height,rows:sizes.map((size,index)=>({y:heading,height,explicitAction:true,
    controlX:reset&&index===0?resetX:x+sizes.slice(start,index).reduce((sum,item)=>sum+item.width+gap,0),
    controlWidth:size.width,controlHeight:size.height,circle:size.circle}))};
}
