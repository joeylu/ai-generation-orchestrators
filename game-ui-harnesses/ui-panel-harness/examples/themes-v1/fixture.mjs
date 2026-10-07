/** Explicit theme/control expectations. Not an interpreter or model-generated result. */
export function themeRequest(theme) {
  const names={mint:'薄荷绿',blue:'蓝色',violet:'紫色',orange:'橙色'},match=/^modern-(mint|blue|violet|orange)-(light|dark)$/.exec(theme.id);
  if(!match)throw Error('THEME_FIXTURE_ID');
  return {requestVersion:'0.1',id:`theme-${match[1]}-${match[2]}`,target:'pixi',text:
    `生成主题控件预览，${match[2]==='dark'?'深色':'浅色'}，主色${names[match[1]]}。包含设置和角色两个页签，默认设置页。`
    +'设置页：主音量0到100，步长1，默认70；静音默认关闭，开启表示静音；画质下拉选项低、中、高，默认中；只读提示显示本地预览；恢复默认按钮只重置主音量、静音和画质。'
    +'角色页：角色名输入框初始为空，占位请输入角色名，必填，至少2个字符，最多12个字符；确认按钮提交角色名；取消按钮只通知宿主；加载进度最大100，初始25，百分比显示，零位小数。全部控件可用。'};
}
export function themeIntent(context,theme) {
  const common=(kind,label)=>({kind,label,recipeKey:`settings.${kind}@0.1.0`,sourceRef:'request',icon:null});
  return {panelIntentVersion:'0.8',contextSha256:context.sha256,unresolved:[],panel:{id:context.request.id,title:'主题控件预览',themeKey:`${theme.id}@${theme.version}`,panelSurface:null,
    layout:{width:null,canvasWidth:null,canvasHeight:null,maxHeight:480,overflow:'auto'},body:{kind:'tabs',enabled:true,sourceRef:'request',pages:[
      {label:'设置',sourceRef:'request',initial:true,body:{kind:'column',children:[{kind:'section',title:'声音与显示',rows:[
        {...common('slider','主音量'),enabled:true,min:0,max:100,step:1,initial:70,prefix:'',suffix:''},
        {...common('switch','静音'),enabled:true,initial:false},
        {...common('select','画质'),enabled:true,options:[{label:'低',initial:false},{label:'中',initial:true},{label:'高',initial:false}]},
        {...common('text','提示'),text:'本地预览'},
        {...common('button','恢复默认'),enabled:true,action:'reset-initial',resetRows:[0,1,2],submitRows:[]},
      ]}]}},
      {label:'角色',sourceRef:'request',initial:false,body:{kind:'column',children:[{kind:'section',title:'创建角色',rows:[
        {...common('input','角色名'),recipeKey:'forms.input@0.1.0',enabled:true,initial:'',placeholder:'请输入角色名',inputType:'text',readOnly:false,maxLength:12,required:true,minLength:2},
        {...common('button','确认'),enabled:true,action:'submit',resetRows:[],submitRows:[5]},
        {...common('button','取消'),enabled:true,action:'emit',resetRows:[],submitRows:[]},
        {...common('progress','加载进度'),max:100,initial:25,display:'percent',fractionDigits:0},
      ]}]}},
    ]}}};
}
