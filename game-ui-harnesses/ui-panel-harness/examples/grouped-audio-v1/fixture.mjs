import {BUTTON_STYLE_KEYS} from '../../src/button-style.mjs';
/** One local layout study. Never rewrites a saved model result or a Studio default. */
export function groupedAudioStudy(source){
  if(source.spec.id!=='usage-settings'||source.spec.provenance.kind!=='programmatic-fixture')throw new Error('GROUPED_AUDIO_FIXTURE_ONLY');
  const spec=structuredClone(source.spec),catalog=structuredClone(source.catalog),dark=spec.theme.id.endsWith('-dark');
  const theme=structuredClone(catalog.themes.find(theme=>theme.id===spec.theme.id&&theme.version===spec.theme.version));
  if(!theme)throw new Error('GROUPED_AUDIO_THEME');
  theme.version='0.12.0';theme.surfaceStyle='grouped-v1';
  Object.assign(theme.tokens,dark?{background:'#000000',surface:'#1C1C1E',control:'#2C2C2E',accent:'#0A84FF',text:'#F5F5F7',muted:'#A5A5AD',border:'#48484A'}:
    {background:'#F2F2F7',surface:'#FFFFFF',control:'#E5E5EA',accent:'#0066CC',text:'#1D1D1F',muted:'#636366',border:'#D1D1D6'},
    {fontSize:17,headingSize:14,titleSize:32,radius:14,spacing:16});
  catalog.id='grouped-audio-study';catalog.version='0.1.0';catalog.themes=[theme];spec.theme={id:theme.id,version:theme.version};
  // This isolated catalog permits native-sized grouped cells; other catalogs retain their recipe minima.
  catalog.recipes.find(recipe=>recipe.id==='settings.section').minHeight=56;
  spec.panelSpecVersion='0.12';spec.buttonFonts=[];spec.titleBar=null;spec.appearance=null;
  const originalRows=spec.sections.flatMap(section=>section.rows),byId=new Map(originalRows.map(row=>[row.id,row]));
  if(originalRows.map(row=>row.id).join('|')!=='volume-row|music-row|mute-row|reset-row|close|save')throw new Error('GROUPED_AUDIO_ROWS');
  spec.sections=[['levels',['volume-row','music-row']],['mute',['mute-row']],['reset',['reset-row']],['actions',['close','save']]].map(([id,ids])=>({
    id,title:spec.title,rows:ids.map(id=>byId.get(id)),
  }));
  spec.canvas={width:540,height:640};
  spec.layout={...spec.layout,width:500,padding:28,gap:24,titleHeight:44,sectionTitleHeight:24,rowHeight:56,maxHeight:640,overflow:'error',
    body:{id:'grouped-audio-flow',kind:'column',width:'fill',gap:16,align:'start',children:spec.sections.map(section=>({kind:'section',sectionId:section.id,width:'fill'}))}};
  spec.actionLayouts=[{sectionId:'actions',direction:'row',align:'end',gap:12,buttonWidth:112,buttonHeight:48,shape:'default'}];
  spec.buttonStyles=[['reset-row',{width:444,height:56,backgroundColor:theme.tokens.surface,textColor:theme.tokens.accent}],
    ['close',{width:76,height:48,backgroundColor:theme.tokens.background,textColor:theme.tokens.accent}],
    ['save',{width:132,height:48,backgroundColor:'#0066CC',textColor:'#FFFFFF'}]].map(([rowId,style])=>({rowId,
      style:{...Object.fromEntries(BUTTON_STYLE_KEYS.map(key=>[key,null])),borderWidth:0,cornerRadius:14,...style},
    }));
  spec.provenance={kind:'programmatic-fixture',description:'Apple-inspired grouped settings layout study in the existing Panel Harness; no model or media generation.',assumptions:[]};
  return{spec,catalog};
}
