import {createPlanningContext} from '../../src/planning-context.mjs';
import {materializePanelIntent} from '../../src/panel-intent.mjs';
export const menuRequest={requestVersion:'0.1',id:'menu-default-fixture',target:'pixi',text:'做一个深色蓝色的暂停菜单，标题叫“暂停”，三个入口依次是“继续游戏”“设置”“返回主菜单”。按钮可点击并发出各自事件即可，暂不接入游戏逻辑。整体按简洁的 Apple 风格处理，继续游戏是主操作，不要图标，也不要增加其他内容。'};
/** Authored oracle only, never reported as a model's interpretation. */
export function menuIntent(context,themeId='modern-blue-dark',heading='暂停'){
  const theme=context.catalog.themes.find(theme=>theme.id===themeId);
  return{panelIntentVersion:'0.10',contextSha256:context.sha256,unresolved:[],panel:{id:context.request.id,title:'暂停',themeKey:`${theme.id}@${theme.version}`,panelSurface:null,
    layout:{width:null,canvasWidth:null,canvasHeight:null,maxHeight:null,overflow:'auto'},body:{kind:'column',children:[{kind:'section',title:heading,actionLayout:null,
      rows:['继续游戏','设置','返回主菜单'].map((label,i)=>({kind:'button',label,recipeKey:`settings.button.${i===0?'primary':'secondary'}@0.1.0`,sourceRef:'request',icon:null,enabled:true,action:'emit',resetRows:[],submitRows:[]}))}]}}};
}
export async function menuFixture(catalog,themeId='modern-blue-dark',heading='暂停'){
  const [,accent,mode]=/^modern-(mint|blue|violet|orange)-(light|dark)$/.exec(themeId);
  const description=(mode==='dark'?'深色':'浅色')+({mint:'薄荷绿',blue:'蓝色',violet:'紫色',orange:'橙色'})[accent];
  const request={...menuRequest,text:menuRequest.text.replace('深色蓝色',description)};
  const context=await createPlanningContext(request,catalog,undefined,{actionLayouts:true,textWrap:true});
  const intent=menuIntent(context,themeId,heading),proposal=await materializePanelIntent(context,intent);
  return{context,intent,proposal,spec:proposal.spec};
}
