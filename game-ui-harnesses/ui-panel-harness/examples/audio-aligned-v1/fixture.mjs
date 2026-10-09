/** Local layout study over the saved Noto specimen. Never rewrites a model result. */
export function alignAudioStudy(source){
  if(source.compilerVersion!=='0.24.0'||source.catalog.id!=='apple-typography-noto'||source.spec.id!=='usage-settings'||source.spec.provenance.kind!=='programmatic-fixture')throw new Error('ALIGNED_AUDIO_FIXTURE_ONLY');
  const spec=structuredClone(source.spec),catalog=structuredClone(source.catalog);
  const theme=catalog.themes.find(theme=>theme.id===spec.theme.id&&theme.version===spec.theme.version);
  if(theme.surfaceStyle!=='grouped-v2'||theme.sliderStyle!=='raised-v1')throw new Error('ALIGNED_AUDIO_SOURCE');
  catalog.id='audio-aligned-study';theme.surfaceStyle='grouped-v3';theme.version='0.18.0';spec.theme={id:theme.id,version:theme.version};
  Object.assign(spec.layout,{width:480,padding:28,gap:24,sectionGap:20,titleHeight:32});spec.layout.body.gap=20;
  spec.titleBar.fontSize=22;
  for(const entry of spec.buttonStyles){
    entry.style.height=44;
    if(entry.rowId==='reset-row')Object.assign(entry.style,{width:96,textColor:theme.tokens.muted});
    if(entry.rowId==='close')Object.assign(entry.style,{width:76,backgroundColor:theme.tokens.control,textColor:theme.tokens.text});
    if(entry.rowId==='save')entry.style.width=112;
  }
  return{spec,catalog};
}
