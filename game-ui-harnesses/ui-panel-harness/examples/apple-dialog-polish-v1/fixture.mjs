import {APPEARANCE_KEYS} from '../../src/appearance.mjs';
import {TITLE_BAR_KEYS} from '../../src/title-bar.mjs';

/** One local composition study over the reviewed dialog, using existing portable styles. */
export function polishAppleDialog(source){
  if(source.compilerVersion!=='0.24.0'||source.spec.id!=='sample-exit'||source.spec.provenance.kind!=='programmatic-fixture'
    ||source.catalog.id!=='apple-panel-samples-v1')throw new Error('DIALOG_POLISH_FIXTURE_ONLY');
  const spec=structuredClone(source.spec),catalog=structuredClone(source.catalog),rows=spec.sections.flatMap(section=>section.rows);
  if(rows.map(row=>row.id).join('|')!=='message|cancel|confirm'||spec.appearance?.panelRadius!==20)throw new Error('DIALOG_POLISH_SOURCE');
  const theme=catalog.themes.find(theme=>theme.id===spec.theme.id&&theme.version===spec.theme.version),dark=theme.id.endsWith('-dark');
  if(theme.surfaceStyle!=='grouped-v2')throw new Error('DIALOG_POLISH_THEME');
  catalog.id='apple-dialog-polish-v1';theme.version='0.15.0';theme.surfaceStyle='refined-v1';delete theme.iconStyle;delete theme.sliderStyle;
  Object.assign(theme.tokens,dark?{background:'#101216',surface:'#24272D',control:'#343840',accent:'#71A7FF',text:'#C3C7D0',muted:'#AEB4BF',border:'#454A54'}
    :{background:'#E9EBEF',surface:'#FDFDFE',control:'#F0F1F4',accent:'#0066CC',text:'#5E626C',muted:'#6C717B',border:'#D4D7DE'},
    {fontSize:16,headingSize:16,titleSize:24,radius:20});
  spec.theme={id:theme.id,version:theme.version};
  spec.appearance={...Object.fromEntries(APPEARANCE_KEYS.map(key=>[key,null])),panelRadius:20};
  spec.titleBar={...Object.fromEntries(TITLE_BAR_KEYS.map(key=>[key,null])),horizontalAlign:'left',verticalAlign:'middle',
    textColor:dark?'#F5F6F8':'#23262C',fontSize:24,padding:0};
  spec.sections=[{id:'confirmation',title:spec.title,rows}];
  spec.layout={...spec.layout,width:428,padding:28,titleHeight:34,gap:14,rowHeight:56,
    body:{id:'dialog-flow',kind:'column',width:'fill',gap:0,align:'start',children:[{kind:'section',sectionId:'confirmation',width:'fill'}]}};
  spec.actionLayouts=[];spec.buttonFonts=[{rowId:'cancel',fontSize:16},{rowId:'confirm',fontSize:16}];
  for(const item of spec.buttonStyles)Object.assign(item.style,{width:179,height:48,cornerRadius:10,borderWidth:1,
    ...(item.rowId==='cancel'?{backgroundColor:theme.tokens.control,textColor:dark?'#E0E4EB':'#3D4654',borderColor:theme.tokens.border}
      :{backgroundColor:dark?'#C84243':'#C52F33',textColor:'#FFFFFF',borderColor:dark?'#DB595A':'#B82A2F'})});
  return{spec,catalog};
}
