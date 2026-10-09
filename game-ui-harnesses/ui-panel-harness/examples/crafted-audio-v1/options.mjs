import {BUTTON_STYLE_KEYS} from '../../src/button-style.mjs';

export const AUDIO_ART_OPTIONS = Object.freeze([
  {id:'a',label:'A · 薄荷紧凑',description:'保留上一稿：左对齐标题，紧凑的纵向设置，轻量操作区。'},
  {id:'b',label:'B · 温润留白',description:'居中标题，温暖的中性色，更舒展的纵向间距。'},
  {id:'c',label:'C · 横向分栏',description:'两个音量并排，静音独立成行，适合较宽的游戏窗口。'},
]);
const section = sectionId => ({kind:'section',sectionId,width:'fill'});
const button = (rowId,values) => ({rowId,style:{...Object.fromEntries(BUTTON_STYLE_KEYS.map(key=>[key,null])),...values}});

/** Authored alternatives to the exact reviewed A bundle; never edits a saved/model panel. */
export function audioArtOption(source,option) {
  if (source.spec.provenance.kind !== 'programmatic-fixture' || source.spec.id !== 'usage-settings'
      || source.catalog.id !== 'crafted-audio-study' || source.compilerVersion !== '0.20.0') throw new Error('AUDIO_ART_OPTION_FIXTURE_ONLY');
  if (!['b','c'].includes(option)) throw new Error('AUDIO_ART_OPTION_UNKNOWN');
  const spec=structuredClone(source.spec),catalog=structuredClone(source.catalog),warm=option==='b';
  catalog.id=warm?'crafted-audio-warm-study':'crafted-audio-wide-study';catalog.version='0.1.0';
  catalog.themes=catalog.themes.map(theme=>({...theme,version:warm?'0.10.1':'0.10.2',tokens:{...theme.tokens,
    ...(warm ? theme.id.endsWith('-dark')
      ? {background:'#151A15',surface:'#292F28',control:'#384137',accent:'#BED6AD',text:'#F3F5EE',muted:'#BDC5B7',border:'#697662'}
      : {background:'#EAECE4',surface:'#FAFBF6',control:'#EAEFE3',accent:'#3D6248',text:'#2B382B',muted:'#65725F',border:'#B8C3AD'}
      : theme.id.endsWith('-dark')
      ? {background:'#0E1416',surface:'#1D292B',control:'#2B3A3D',accent:'#91DDCB',text:'#EDF6F5',muted:'#AAC0BD',border:'#4D6565'}
      : {background:'#E7EFED',surface:'#FBFEFD',control:'#E8F0ED',accent:'#176855',text:'#213A34',muted:'#5B746B',border:'#B8CBC3'}),
    titleSize:warm?24:26,radius:12}}));
  const theme=catalog.themes.find(theme=>theme.id===spec.theme.id);
  spec.theme={id:theme.id,version:theme.version};
  if(warm) {
    spec.panelSpecVersion='0.12';spec.buttonFonts=[];
    spec.titleBar={horizontalAlign:'center',verticalAlign:'middle',backgroundColor:null,textColor:null,cornerRadius:null,fontSize:24,padding:0};
    spec.canvas={width:544,height:596};
    spec.layout={...spec.layout,width:480,padding:40,rowHeight:80,titleHeight:36,gap:32,
      body:{id:'warm-audio-flow',kind:'column',width:'fill',gap:32,align:'start',children:spec.sections.map(s=>section(s.id))}};
    spec.actionLayouts=[{sectionId:'actions',direction:'row',align:'center',gap:12,buttonWidth:104,buttonHeight:48,shape:'default'}];
    spec.buttonStyles=[
      button('reset-row',{width:104,height:48,backgroundColor:theme.tokens.surface,textColor:theme.tokens.muted,borderWidth:0,cornerRadius:8}),
      button('close',{width:72,height:48,backgroundColor:theme.tokens.surface,textColor:theme.tokens.text,borderColor:theme.tokens.border,borderWidth:1,cornerRadius:8}),
      button('save',{width:144,height:48,borderWidth:0,cornerRadius:8}),
    ];
  } else {
    const preferences=spec.sections.find(s=>s.id==='preferences'),actions=spec.sections.find(s=>s.id==='actions');
    if(preferences.rows.map(row=>row.id).join(',')!=='volume-row,music-row,mute-row') throw new Error('AUDIO_ART_OPTION_ROWS');
    // Explicit fixture layout grouping; the row objects, order and business semantics stay exact.
    spec.sections=[{...preferences,rows:[preferences.rows[0]]},
      {id:'music',title:spec.title,rows:[preferences.rows[1]]},
      {id:'silence',title:spec.title,rows:[preferences.rows[2]]},actions];
    spec.canvas={width:784,height:476};
    spec.layout={...spec.layout,width:720,padding:40,rowHeight:80,titleHeight:36,gap:24,
      body:{id:'wide-audio-flow',kind:'column',width:'fill',gap:16,align:'start',children:[
        {id:'volume-pair',kind:'row',width:'fill',gap:32,align:'start',children:[section('preferences'),section('music')]},
        section('silence'),section('actions'),
      ]}};
    spec.actionLayouts=[];
    spec.buttonStyles=[
      button('reset-row',{width:104,height:48,backgroundColor:theme.tokens.surface,textColor:theme.tokens.muted,borderWidth:0,cornerRadius:8}),
      button('close',{width:80,height:48,backgroundColor:theme.tokens.control,textColor:theme.tokens.text,borderWidth:0,cornerRadius:8}),
      button('save',{width:160,height:48,borderWidth:0,cornerRadius:8}),
    ];
  }
  spec.provenance={kind:'programmatic-fixture',description:`Authored audio art option ${option.toUpperCase()}; local PanelSpec study, not a model-generated result.`,assumptions:[]};
  return {spec,catalog};
}
