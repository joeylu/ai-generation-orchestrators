import {BUTTON_STYLE_KEYS} from '../../src/button-style.mjs';

/** A bounded art study using an authored audio fixture, never a saved/model panel. */
export function craftedAudioStudy(source) {
  if (source.spec.provenance.kind !== 'programmatic-fixture' || source.spec.id !== 'usage-settings') throw new Error('CRAFTED_AUDIO_FIXTURE_ONLY');
  const catalog = structuredClone(source.catalog), spec = structuredClone(source.spec);
  catalog.id = 'crafted-audio-study'; catalog.version = '0.1.0';
  catalog.themes = catalog.themes.filter(theme => ['modern-mint-light','modern-mint-dark'].includes(theme.id)).map(theme => {
    const dark = theme.id.endsWith('-dark');
    return {...theme, version:'0.10.0', surfaceStyle:'crafted-v1', tokens:{...theme.tokens,
      ...(dark ? {background:'#11161C',surface:'#242C36',control:'#2F3945',accent:'#8FE2C3',text:'#F2F6FA',muted:'#B1BDC9',border:'#485564'}
        : {background:'#E8EEF0',surface:'#FFFFFF',control:'#EFF3F5',accent:'#146D58',text:'#22313D',muted:'#5D6F7D',border:'#B7C4CB'}),
      fontFamily:'Segoe UI, Microsoft YaHei UI, sans-serif',fontSize:16,headingSize:14,titleSize:28,radius:16}};
  });
  const theme = catalog.themes.find(theme => theme.id === spec.theme.id);
  if (!theme) throw new Error('CRAFTED_AUDIO_MINT_ONLY');
  spec.theme = {id:theme.id,version:theme.version};
  spec.canvas = {width:564,height:504};
  spec.layout = {...spec.layout,width:500,padding:36,gap:24,titleHeight:40,sectionTitleHeight:24,maxHeight:600,overflow:'error',
    body:{id:'audio-flow',kind:'column',width:'fill',gap:24,align:'start',children:spec.sections.map(section=>({kind:'section',sectionId:section.id,width:'fill'}))}};
  // The authored study explicitly repeats the panel heading; the new profile
  // collapses repeated headings. Distinct supplied section titles stay visible.
  spec.sections.find(section=>section.id==='actions').title = spec.title;
  spec.actionLayouts = [];
  spec.buttonStyles = [
    ['reset-row',{width:104,height:48,backgroundColor:theme.tokens.surface,textColor:theme.tokens.muted,borderWidth:0}],
    ['close',{width:72,height:48,backgroundColor:theme.tokens.control,textColor:theme.tokens.text,borderWidth:0}],
    ['save',{width:132,height:48,borderWidth:0}],
  ].map(([rowId,values])=>({rowId,style:{...Object.fromEntries(BUTTON_STYLE_KEYS.map(key=>[key,null])),...values}}));
  spec.provenance = {kind:'programmatic-fixture',description:'Authored audio art study using Impeccable layout/type guidance; not a model-generated result.',assumptions:[]};
  return {spec,catalog};
}
