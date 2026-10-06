export const tabsRequest={requestVersion:'0.1',id:'tabs-settings',target:'pixi',text:'生成分页设置面板，声音页与显示页，默认打开声音页。声音页包含主音量0～100，步长1，默认70，静音默认关闭。显示页包含亮度0～100，步长1，默认60，以及加载进度0～1，初始0.2，百分比显示一位小数。恢复声音按钮只重置主音量和静音。'};
export function tabsIntent(context){
  const slider=(id,label,initial,quote)=>({id,kind:'slider',label,recipeKey:'settings.slider@0.1.0',sourceQuote:quote,icon:null,enabled:true,min:0,max:100,step:1,initial,prefix:'',suffix:''});
  const section=(id,title,rows)=>({kind:'column',children:[{kind:'section',id,title,rows}]});
  return {panelIntentVersion:'0.5',contextSha256:context.sha256,unresolved:[],panel:{id:context.request.id,title:'分页设置',themeKey:'modern-mint-light@0.1.0',panelSurface:null,
    layout:{width:null,canvasWidth:null,canvasHeight:null,maxHeight:480,overflow:'auto'},
    body:{kind:'tabs',enabled:true,sourceQuote:context.request.text,pages:[
      {id:'page0',label:'声音',sourceQuote:'声音页与显示页',initial:true,body:section('section0','声音设置',[
        slider('row0','主音量',70,'主音量0～100，步长1，默认70'),
        {id:'row1',kind:'switch',label:'静音',recipeKey:'settings.switch@0.1.0',sourceQuote:'静音默认关闭',icon:null,enabled:true,initial:false},
        {id:'row2',kind:'button',label:'恢复声音',recipeKey:'settings.button@0.1.0',sourceQuote:'恢复声音按钮只重置主音量和静音',icon:null,enabled:true,action:'reset-initial',resetRows:['row0','row1']}
      ])},
      {id:'page1',label:'显示',sourceQuote:'显示页包含亮度',initial:false,body:section('section1','显示设置',[
        slider('row3','亮度',60,'亮度0～100，步长1，默认60'),
        {id:'row4',kind:'progress',label:'加载进度',recipeKey:'settings.progress@0.1.0',sourceQuote:'加载进度0～1，初始0.2，百分比显示一位小数',icon:null,max:1,initial:0.2,display:'percent',fractionDigits:1}
      ])}
    ]}}};
}
