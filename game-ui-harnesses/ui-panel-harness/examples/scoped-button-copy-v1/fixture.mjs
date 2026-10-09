import {createPlanningContext} from '../../src/planning-context.mjs';
import {materializePanelIntent} from '../../src/panel-intent.mjs';

/** Authored protocol fixture; no text interpretation or model call. */
export async function scopedCopyFixture(catalog){
 const request={requestVersion:'0.1',id:'scoped-copy-fixture',target:'pixi',text:
  '生成“声音与显示”面板。“声音”分组有主音量滑条0到100、步长1、默认70和“恢复默认”按钮，仅重置主音量。'+
  '“显示”分组有亮度滑条0到100、步长1、默认40和同名“恢复默认”按钮，仅重置亮度。全部启用，深色蓝色，无图标，只通知宿主。'};
 const context=await createPlanningContext(request,catalog,undefined,{actionLayouts:true,textWrap:true});
 const slider=(label,initial)=>({kind:'slider',label,min:0,max:100,step:1,initial,prefix:'',suffix:'',
  recipeKey:'settings.slider@0.1.0',sourceRef:'request',icon:null,enabled:true});
 const reset=index=>({kind:'button',label:'恢复默认',action:'reset-initial',resetRows:[index],submitRows:[],
  recipeKey:'settings.button.secondary@0.1.0',sourceRef:'request',icon:null,enabled:true});
 const theme=catalog.themes.find(t=>t.id==='modern-blue-dark');
 const intent={panelIntentVersion:'0.10',contextSha256:context.sha256,unresolved:[],panel:{id:request.id,title:'声音与显示',
  themeKey:`${theme.id}@${theme.version}`,panelSurface:null,layout:{width:null,canvasWidth:null,canvasHeight:null,maxHeight:null,overflow:'auto'},
  body:{kind:'column',children:[{kind:'section',title:'声音',actionLayout:null,rows:[slider('主音量',70),reset(0)]},
   {kind:'section',title:'显示',actionLayout:null,rows:[slider('亮度',40),reset(2)]}]}}};
 return{context,intent,spec:(await materializePanelIntent(context,intent)).spec};
}
