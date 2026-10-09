import {BUTTON_STYLE_KEYS} from '../../src/button-style.mjs';
import {APPEARANCE_KEYS} from '../../src/appearance.mjs';

export const panelSamples=Object.freeze([
  {id:'menu',title:'主菜单',caption:'集中突出开始游戏，其余入口降低视觉权重。',height:480},
  {id:'pause',title:'暂停',caption:'继续游戏是主操作，设置与返回主菜单保持清晰层级。',height:480},
  {id:'graphics',title:'画质设置',caption:'滑块与选项归入一张设置卡，底部集中恢复、关闭和保存。',height:660},
  {id:'profile',title:'角色信息',caption:'名称、等级、战力和经验集中成一张资料卡。',height:600},
  {id:'exit',title:'退出游戏',caption:'完整圆角底板承载标题、说明与操作，取消和退出并列。',height:420},
]);
const recipe=kind=>({id:`settings.${kind}`,version:'0.1.0'});
const button=(id,buttonLabel,event,role='secondary',action={kind:'emit'})=>({id,kind:'button',recipe:recipe(`button.${role}`),label:'',buttonLabel,enabled:true,event,action});
const slider=(id,label,bind,event)=>({id,kind:'slider',recipe:recipe('slider'),label,bind,enabled:true,event,format:{fractionDigits:0,prefix:'',suffix:'%'}});
const text=(id,label,value)=>({id,kind:'text',recipe:recipe('text'),label,text:value});
const style=(rowId,width,height,backgroundColor,textColor)=>({rowId,style:{...Object.fromEntries(BUTTON_STYLE_KEYS.map(key=>[key,null])),width,height,backgroundColor,textColor,borderWidth:0,cornerRadius:14}});
const actionLayout=(sectionId,direction,align,buttonWidth,buttonHeight=48,gap=12)=>({sectionId,direction,align,gap,buttonWidth,buttonHeight,shape:'default'});

/** Authored local samples. Never accepts or rewrites a model result. */
export function createApplePanelSample(id,mode,source,minimalCatalog){
  const sample=panelSamples.find(item=>item.id===id);
  if(!sample||!['light','dark'].includes(mode)||source.compilerVersion!=='0.23.0'||source.spec.provenance.kind!=='programmatic-fixture')throw new Error('APPLE_SAMPLE_SOURCE');
  const catalog=structuredClone(source.catalog),spec=structuredClone(source.spec);
  catalog.id='apple-panel-samples-v1';
  const theme=catalog.themes.find(item=>item.id===spec.theme.id&&item.version===spec.theme.version);
  if(theme?.surfaceStyle!=='grouped-v1'||theme.sliderStyle!=='raised-v1'||!theme.id.endsWith(mode))throw new Error('APPLE_SAMPLE_THEME');
  theme.surfaceStyle='grouped-v2';
  const t=theme.tokens,section=(sectionId,rows)=>({id:sectionId,title:sample.title,rows});
  Object.assign(spec,{panelSpecVersion:'0.13',id:`sample-${id}`,title:sample.title,canvas:{width:540,height:sample.height},state:[],sections:[],
    assets:null,tabs:null,appearance:null,titleBar:null,buttonFonts:[],buttonStyles:[],actionLayouts:[],textLayouts:[],
    provenance:{kind:'programmatic-fixture',description:'Local Apple-inspired multi-panel comparison; no model or media generation.',assumptions:['Host owns navigation, persistence and game actions.']}});
  spec.layout={...spec.layout,maxHeight:sample.height,body:null};
  if(id==='menu'||id==='pause'){
    const rows=id==='menu'?[button('start','开始游戏','menu.start','primary'),button('settings','设置','menu.settings'),button('exit','退出游戏','menu.exit')]
      :[button('resume','继续游戏','pause.resume','primary'),button('settings','设置','pause.settings'),button('home','返回主菜单','pause.home')];
    spec.sections=[section('menu',rows)];spec.actionLayouts=[actionLayout('menu','column','center',444,56)];
    spec.buttonStyles=rows.map((row,index)=>style(row.id,444,56,index===0?t.accent:index===1?t.surface:t.background,index===0?'#FFFFFF':t.accent));
  }else if(id==='graphics'){
    spec.state=[{id:'brightness',type:'number',initial:65,min:0,max:100,step:1},{id:'renderScale',type:'number',initial:100,min:50,max:150,step:1},
      {id:'quality',type:'enum',initial:'high',options:[{id:'low',label:'低'},{id:'medium',label:'中'},{id:'high',label:'高'}]},{id:'vsync',type:'boolean',initial:true}];
    spec.sections=[section('preferences',[slider('brightness-row','亮度','brightness','graphics.brightnessChanged'),slider('render-scale-row','渲染比例','renderScale','graphics.scaleChanged'),
      {id:'quality-row',kind:'select',recipe:recipe('select'),label:'画质档位',bind:'quality',enabled:true,event:'graphics.qualityChanged'},
      {id:'vsync-row',kind:'switch',recipe:recipe('switch'),label:'垂直同步',bind:'vsync',enabled:true,event:'graphics.vsyncChanged'}]),
      section('actions',[button('reset','恢复默认','graphics.reset','secondary',{kind:'reset-initial',fields:spec.state.map(field=>field.id)}),button('close','关闭','graphics.close'),button('save','保存设置','graphics.save','primary')])];
    spec.buttonStyles=[style('reset',112,48,t.background,t.accent),style('close',76,48,t.background,t.accent),style('save',132,48,t.accent,'#FFFFFF')];
  }else if(id==='profile'){
    spec.state=[{id:'experience',type:'progress',initial:68,max:100}];
    spec.sections=[section('profile',[text('name','角色','霜刃 · 剑士'),text('level','等级','12'),text('power','战力','9,860'),
      {id:'experience-row',kind:'progress',recipe:recipe('progress'),label:'经验',bind:'experience',format:{mode:'percent',fractionDigits:0}}]),
      section('actions',[button('back','返回','profile.back'),button('equipment','查看装备','profile.equipment','primary')])];
    spec.actionLayouts=[actionLayout('actions','row','end',132)];
    spec.buttonStyles=[style('back',96,48,t.background,t.accent),style('equipment',132,48,t.accent,'#FFFFFF')];
  }else{
    spec.sections=[section('message',[text('message','离开之前','确定要离开当前游戏吗？\n请先保存进度，避免丢失本次游戏记录。')]),
      section('actions',[button('cancel','取消','dialog.cancel'),button('confirm','退出游戏','dialog.exit','danger')])];
    spec.textLayouts=[{rowId:'message',wrap:'word'}];
    spec.actionLayouts=[actionLayout('actions','row','center',216)];
    spec.appearance={...Object.fromEntries(APPEARANCE_KEYS.map(key=>[key,null])),
      canvasColor:mode==='light'?'#E5E5EA':'#0B0B0F',panelColor:t.surface,panelRadius:20};
    spec.buttonStyles=[style('cancel',216,48,t.control,t.accent),style('confirm',216,48,mode==='light'?'#C72C25':'#D63B35','#FFFFFF')];
  }
  const children=spec.sections.map(item=>({kind:'section',sectionId:item.id,width:'fill'}));
  spec.layout.body={id:'sample-flow',kind:'column',width:'fill',gap:20,align:'start',children};
  const before=structuredClone(spec),beforeCatalog=structuredClone(minimalCatalog);
  before.theme={id:`modern-mint-${mode}`,version:'0.9.0'};
  before.buttonStyles=[];before.actionLayouts=[];before.appearance=null;
  // Comparison varies only presentation; all authored rows, state, events and copy are shared.
  return{sample,mode,before:{spec:before,catalog:beforeCatalog},after:{spec,catalog}};
}
