export const compactActionSamples=Object.freeze([
  {id:'pause',title:'暂停菜单',caption:'统一标题与按钮区的边界，继续游戏为主操作，设置与返回降低视觉权重。'},
  {id:'exit',title:'退出确认',caption:'去掉重复小标题，保留原说明，取消与退出集中在右下角。'},
]);

/** Explicit local composition studies; saved model panels never enter this factory. */
export function compactActionsStudy(source){
  const id=source.spec.id?.replace(/^sample-/,''),sample=compactActionSamples.find(item=>item.id===id);
  if(!sample||source.spec.provenance.kind!=='programmatic-fixture'
    ||(id==='pause'?(source.compilerVersion!=='0.24.0'||source.catalog.id!=='apple-suite-polish-v1')
      :(source.compilerVersion!=='0.18.0'||source.catalog.id!=='apple-typography-noto')))throw new Error('COMPACT_ACTIONS_FIXTURE_ONLY');
  const spec=structuredClone(source.spec),catalog=structuredClone(source.catalog),rows=spec.sections.flatMap(section=>section.rows);
  if(rows.map(row=>row.id).join('|')!==(id==='pause'?'resume|settings|home':'message|cancel|confirm'))throw new Error('COMPACT_ACTIONS_ROWS');
  const theme=catalog.themes.find(theme=>theme.id===spec.theme.id&&theme.version===spec.theme.version);
  Object.assign(spec.layout,{padding:28,titleHeight:32,gap:id==='pause'?24:16});
  Object.assign(spec.titleBar,{fontSize:22,horizontalAlign:'left',verticalAlign:'middle'});
  if(id==='pause'){
    const width=spec.layout.width-56;
    Object.assign(spec.actionLayouts[0],{buttonWidth:width,buttonHeight:44,gap:8,align:'start'});
    for(const entry of spec.buttonStyles){
      Object.assign(entry.style,{width,height:44,borderWidth:0});
      if(entry.rowId==='home')entry.style.textColor=theme.tokens.muted;
    }
  }else{
    // Whole-pixel outer geometry and a shorter dialog rhythm using existing portable slots.
    Object.assign(spec.layout,{gap:12,rowHeight:60});
    // Use the question as the required row label, retaining both original sentences.
    const paragraphs=rows[0].text.split('\n');if(paragraphs.length!==2||rows[0].label!=='离开之前')throw new Error('COMPACT_ACTIONS_COPY');
    rows[0].label=paragraphs[0];rows[0].text=paragraphs[1];
    for(const entry of spec.buttonStyles)Object.assign(entry.style,{width:entry.rowId==='cancel'?76:112,height:44,borderWidth:0});
  }
  return{spec,catalog};
}
