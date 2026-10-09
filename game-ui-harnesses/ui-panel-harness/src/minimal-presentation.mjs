/** Presentation only; never changes labels, row order, values or action roles. */
export function measureMinimalSection(spec,tokens,section,width,purpose,geometry,showTitle) {
  const l=spec.layout,icons=new Set((spec.assets?.rowIcons??[]).map(icon=>icon.rowId));
  if(purpose==='menu'&&spec.sections.indexOf(section)>0&&spec.sections.some(s=>s.rows.some(r=>r.kind!=='button'))
    &&section.rows.every(row=>row.label===''&&!icons.has(row.id))) {
    const sizes=section.rows.map(row=>geometry(row,Math.max(112,[...row.buttonLabel].length*tokens.fontSize+32),48));
    const total=sizes.reduce((n,s)=>n+s.width,0)+(sizes.length-1)*12;
    if(total>width)return null;
    const heading=showTitle?l.sectionTitleHeight+8:0,height=Math.max(l.rowHeight,...sizes.map(s=>s.height));
    let x=0;
    return {purpose,showTitle,grouped:true,height:heading+height,rows:sizes.map((size,i)=>{
      // Reset stays at the leading edge; remaining actions share the trailing edge.
      if(i===1&&section.rows[0].action.kind==='reset-initial')x+=width-total;
      const place={y:heading,height,controlX:x,controlWidth:size.width,controlHeight:size.height,circle:size.circle,explicitAction:true};x+=size.width+12;return place;
    })};
  }
  if(purpose!=='settings'||section.rows.some(row=>row.kind==='input'||row.kind==='button'||row.kind==='text'))return null;
  let y=showTitle?l.sectionTitleHeight+12:0;
  const rows=section.rows.map((row,index)=>{
    const slider=row.kind==='slider',height=Math.max(l.rowHeight,slider?80:56);
    const place={y,height,stacked:slider,labelX:0,labelY:slider?0:(height-Math.ceil(tokens.fontSize*1.3))/2,
      ...(slider?{controlX:0,controlWidth:width,sliderStack:true,iconY:0}:{}),iconX:0};
    y+=height+(index<section.rows.length-1?16:0);return place;
  });
  return {purpose,showTitle,grouped:false,height:y,rows};
}
