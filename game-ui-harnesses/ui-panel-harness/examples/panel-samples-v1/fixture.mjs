import {conciseRoleIntent} from '../image-slots-v1/fixture.mjs';

/** Authored public-response fixtures. No prose interpreter, transport or model output repair. */
export const sampleCases=[
  {id:'audio',label:'声音设置',text:'生成声音设置。主音量0到100，步长1，默认70；音乐音量0到100，步长1，默认40；静音默认关闭。恢复默认只重置这三项。保存设置只通知宿主。'},
  {id:'form',label:'创建角色',text:'生成创建角色面板。说明：输入一个喜欢的名字，稍后也可以修改。角色名单行文本输入，初始为空，占位请输入角色名，必填，2到12字符。取消只通知宿主，创建角色校验并提交角色名。'},
  {id:'roles',label:'角色卡片',text:'生成角色选择界面。战士、魔法师、弓箭手三个角色并排，每张卡显示一次角色名，暂无肖像，保留图片槽和选择按钮。按钮分别通知宿主。'},
  {id:'progress',label:'下载进度',text:'生成资源下载面板。说明：正在准备森林地图资源，请稍候。下载进度57/100，百分比显示，进度由宿主更新，取消下载按钮只通知宿主。'},
  {id:'tabs',label:'综合页签',text:'生成角色配置，分角色和偏好两个页签，默认角色页。角色页有暂无素材的肖像槽、角色名单行输入初始为空且必填2到12字符、性别男和女默认男、说明稍后可以修改和创建按钮，校验并提交角色名；性别变化独立通知宿主。偏好页有音量0到100步长1默认57、静音默认关闭、资源进度57/100、保存按钮通知宿主。'},
];
export const sampleRequest=item=>({requestVersion:'0.1',id:'sample-'+item.id,target:'pixi',text:item.text});
const recipe=kind=>kind==='input'?'forms.input@0.1.0':`settings.${kind}@0.1.0`;
const row=(kind,label,props={})=>({kind,label,recipeKey:recipe(kind),sourceRef:'request',icon:null,...props});
const slider=(label,initial)=>row('slider',label,{enabled:true,min:0,max:100,step:1,initial,prefix:'',suffix:'%'});
const toggle=()=>row('switch','静音',{enabled:true,initial:false});
const input=()=>row('input','角色名',{enabled:true,initial:'',placeholder:'请输入角色名',inputType:'text',readOnly:false,maxLength:12,required:true,minLength:2});
const image=()=>row('image','待添加肖像',{recipeKey:'content.image@0.1.0',source:null,width:'fill',height:120,fit:'contain'});
const text=value=>row('text','说明',{text:value,wrap:'word'});
const progress=()=>row('progress','下载进度',{max:100,initial:57,display:'percent',fractionDigits:0});
const button=(label,action='emit',fields=[],primary=false)=>row('button',label,{recipeKey:`settings.button.${primary?'primary':'secondary'}@0.1.0`,enabled:true,action,
  resetRows:action==='reset-initial'?fields:[],submitRows:action==='submit'?fields:[]});
const section=(title,rows,actionLayout=null)=>({kind:'section',title,actionLayout,rows});
const column=(...children)=>({kind:'column',children});

export function sampleIntent(context,item,mode='light'){
  const theme=context.catalog.themes.find(theme=>theme.id===`modern-mint-${mode}`&&theme.headingStyle==='concise-v2');
  if(item.id==='roles'){
    const intent=conciseRoleIntent(context);intent.panel.themeKey=`${theme.id}@${theme.version}`;return intent;
  }
  let title,body;
  if(item.id==='audio'){
    title='声音设置';body=column(section(title,[slider('主音量',70),slider('音乐',40),toggle(),button('恢复默认','reset-initial',[0,1,2]),button('保存设置','emit',[],true)]));
  }else if(item.id==='form'){
    title='创建角色';body=column(section(title,[text('输入一个喜欢的名字，稍后也可以修改。'),input(),button('取消'),button('创建角色','submit',[1],true)]));
  }else if(item.id==='progress'){
    title='资源下载';body=column(section(title,[text('正在准备森林地图资源，请稍候。'),progress(),button('取消下载')]));
  }else if(item.id==='tabs'){
    title='角色配置';body={kind:'tabs',enabled:true,sourceRef:'request',pages:[
      {label:'角色',initial:true,sourceRef:'request',body:column(section('角色信息',[image(),input(),row('select','性别',{enabled:true,options:[{label:'男',initial:true},{label:'女',initial:false}]}),text('稍后可以修改。'),button('创建','submit',[1],true)]))},
      {label:'偏好',initial:false,sourceRef:'request',body:column(section('声音与资源',[slider('音量',57),toggle(),progress(),button('保存','emit',[],true)]))},
    ]};
  }else throw Error('UNKNOWN_SAMPLE');
  return {panelIntentVersion:'0.11',contextSha256:context.sha256,unresolved:[],panel:{id:context.request.id,title,themeKey:`${theme.id}@${theme.version}`,panelSurface:null,
    layout:{width:560,canvasWidth:640,canvasHeight:640,maxHeight:480,overflow:'auto'},body}};
}

/** Independent facts to check after public materialization; no expectations derived from compiler output. */
export const expectedKinds={audio:['slider','slider','switch','button','button'],form:['text','input','button','button'],
  roles:['image','button','image','button','image','button'],progress:['text','progress','button'],tabs:['image','input','select','text','button','slider','switch','progress','button']};
