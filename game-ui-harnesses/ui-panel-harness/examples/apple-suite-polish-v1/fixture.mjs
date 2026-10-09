import {APPEARANCE_KEYS} from '../../src/appearance.mjs';
import {TITLE_BAR_KEYS} from '../../src/title-bar.mjs';
import {BUTTON_STYLE_KEYS} from '../../src/button-style.mjs';
import {polishAppleDialog} from '../apple-dialog-polish-v1/fixture.mjs';
import {APPLE_SUITE_RULES as rules,appleSuitePalette} from './art-direction.mjs';

export const suiteSamples=Object.freeze([
  {id:'menu',title:'主菜单',caption:'完整底板与居中操作组，突出开始游戏。'},
  {id:'pause',title:'暂停',caption:'沿用菜单比例，继续游戏保持最高优先级。'},
  {id:'audio',title:'声音设置',caption:'沿用无底色图标和清晰滑块，统一标题与底部操作区。'},
  {id:'graphics',title:'画质设置',caption:'滑块、下拉和开关使用同一设置卡节奏。'},
  {id:'profile',title:'角色信息',caption:'资料列表与经验条集中在完整底板内。'},
  {id:'exit',title:'退出游戏',caption:'沿用最新紧凑弹窗精修，作为这套比例与表面规则的参照。'},
]);
const buttonStyle=(rowId,width,palette,role)=>({rowId,style:{...Object.fromEntries(BUTTON_STYLE_KEYS.map(key=>[key,null])),
  width,height:rules.geometry.buttonHeight,cornerRadius:rules.geometry.buttonRadius,
  backgroundColor:role==='primary'?palette.primaryFill:role==='secondary'?palette.control:palette.surface,
  textColor:role==='primary'?palette.primaryText:role==='secondary'?palette.secondaryText:palette.accent,
  borderWidth:role==='secondary'?1:0,borderColor:role==='secondary'?palette.border:null}});

/** Explicit local samples only; never upgrades a saved model panel or public catalog. */
export function polishAppleSuite(source){
  const id=source.spec.id==='usage-settings'?'audio':source.spec.id?.replace(/^sample-/,''),sample=suiteSamples.find(sample=>sample.id===id);
  if(!sample||source.spec.provenance.kind!=='programmatic-fixture'
    ||(id==='audio'?(source.compilerVersion!=='0.23.0'||source.catalog.id!=='audio-flow-study')
      :(source.compilerVersion!=='0.24.0'||source.catalog.id!=='apple-panel-samples-v1')))throw new Error('APPLE_SUITE_FIXTURE_ONLY');
  if(id==='exit')return polishAppleDialog(source);
  const spec=structuredClone(source.spec),catalog=structuredClone(source.catalog),rows=spec.sections.flatMap(section=>section.rows);
  const theme=catalog.themes.find(theme=>theme.id===spec.theme.id&&theme.version===spec.theme.version);
  const mode=theme?.id.endsWith('-dark')?'dark':'light',p=appleSuitePalette(mode);
  if(!['grouped-v1','grouped-v2'].includes(theme?.surfaceStyle)||theme.sliderStyle!=='raised-v1')throw new Error('APPLE_SUITE_SOURCE');
  const expected={menu:'start|settings|exit',pause:'resume|settings|home',audio:'volume-row|music-row|mute-row|reset-row|close|save',
    graphics:'brightness-row|render-scale-row|quality-row|vsync-row|reset|close|save',profile:'name|level|power|experience-row|back|equipment'};
  if(rows.map(row=>row.id).join('|')!==expected[id])throw new Error('APPLE_SUITE_ROWS');
  catalog.id=rules.id;theme.version='0.16.0';theme.surfaceStyle='grouped-v2';
  Object.assign(theme.tokens,{background:p.canvas,surface:p.surface,control:p.control,accent:p.accent,text:p.text,muted:p.description,border:p.border,
    fontFamily:rules.fontFamily,fontSize:rules.typography.body,headingSize:rules.typography.body,titleSize:rules.typography.title,radius:14});
  spec.theme={id:theme.id,version:theme.version};
  spec.appearance={...Object.fromEntries(APPEARANCE_KEYS.map(key=>[key,null])),panelColor:p.surface,panelRadius:rules.geometry.panelRadius};
  spec.titleBar={...Object.fromEntries(TITLE_BAR_KEYS.map(key=>[key,null])),horizontalAlign:['menu','pause'].includes(id)?'center':'left',verticalAlign:'middle',textColor:p.text,fontSize:rules.typography.title,padding:0};
  spec.layout={...spec.layout,width:rules.widths[id],padding:rules.geometry.padding,titleHeight:34,gap:16,sectionGap:16};
  spec.buttonFonts=rows.filter(row=>row.kind==='button').map(row=>({rowId:row.id,fontSize:rules.typography.button}));
  if(['menu','pause'].includes(id)){
    spec.actionLayouts=[{sectionId:spec.sections[0].id,direction:'column',align:'center',gap:rules.geometry.menuGap,buttonWidth:280,buttonHeight:rules.geometry.buttonHeight,shape:'default'}];
    spec.buttonStyles=rows.map((row,index)=>buttonStyle(row.id,280,p,index===0?'primary':index===1?'secondary':'text'));
  }else{
    if(id==='audio'){
      spec.sections=[{id:'audio',title:spec.title,rows:rows.slice(0,3)},{id:'actions',title:spec.title,rows:rows.slice(3)}];
      spec.actionLayouts=[];
    }
    spec.layout.body={id:'suite-flow',kind:'column',width:'fill',gap:rules.geometry.sectionGap,align:'start',children:spec.sections.map(section=>({kind:'section',sectionId:section.id,width:'fill'}))};
    if(id==='profile'){
      spec.buttonStyles=[buttonStyle('back',96,p,'text'),buttonStyle('equipment',132,p,'primary')];
      spec.actionLayouts=[{sectionId:'actions',direction:'row',align:'end',gap:12,buttonWidth:132,buttonHeight:rules.geometry.buttonHeight,shape:'default'}];
    }else spec.buttonStyles=[buttonStyle(id==='audio'?'reset-row':'reset',112,p,'text'),buttonStyle('close',76,p,'text'),buttonStyle('save',132,p,'primary')];
  }
  return{spec,catalog};
}
