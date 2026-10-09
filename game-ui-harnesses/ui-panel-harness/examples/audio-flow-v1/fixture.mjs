/** One authored layout over the saved local study. Existing compiler and controls are reused. */
export function audioFlowStudy(source) {
  if(source.compilerVersion!=='0.23.0'||source.spec.id!=='usage-settings'
    ||source.spec.provenance.kind!=='programmatic-fixture')throw new Error('AUDIO_FLOW_FIXTURE_ONLY');
  const spec=structuredClone(source.spec),catalog=structuredClone(source.catalog);
  const theme=catalog.themes.find(item=>item.id===spec.theme.id&&item.version===spec.theme.version);
  const rows=spec.sections.flatMap(section=>section.rows);
  if(theme?.surfaceStyle!=='grouped-v1'||theme.iconStyle!=='plain-v1'||theme.sliderStyle!=='raised-v1'
    ||rows.map(row=>row.id).join('|')!=='volume-row|music-row|mute-row|reset-row|close|save')throw new Error('AUDIO_FLOW_SOURCE');
  spec.sections=[{id:'audio',title:spec.title,rows:rows.slice(0,3)},
    {id:'reset',title:spec.title,rows:rows.slice(3,4)},{id:'actions',title:spec.title,rows:rows.slice(4)}];
  spec.canvas={width:540,height:540};
  spec.layout={...spec.layout,maxHeight:540,body:{id:'audio-flow',kind:'column',width:'fill',gap:20,align:'start',children:[
    {kind:'section',sectionId:'audio',width:'fill'},
    {id:'audio-footer',kind:'row',width:'fill',gap:4,align:'start',children:[
      {kind:'section',sectionId:'reset',width:'fill'},{kind:'section',sectionId:'actions',width:'fill'},
    ]},
  ]}};
  spec.actionLayouts=[{sectionId:'reset',direction:'row',align:'start',gap:0,buttonWidth:112,buttonHeight:48,shape:'default'},
    ...spec.actionLayouts.filter(item=>item.sectionId==='actions')];
  const reset=spec.buttonStyles.find(item=>item.rowId==='reset-row');
  if(!reset)throw new Error('AUDIO_FLOW_RESET_STYLE');
  Object.assign(reset.style,{width:112,height:48,backgroundColor:theme.tokens.background});
  // This isolated catalog permits 220px standalone action rows in the existing equal-width footer slots.
  catalog.id='audio-flow-study';
  const footerRecipes=new Set(['settings.section',...rows.slice(3).map(row=>row.recipe.id)]);
  for(const recipe of catalog.recipes)if(footerRecipes.has(recipe.id))recipe.minWidth=Math.min(recipe.minWidth,220);
  return {spec,catalog};
}
