/** Explicit intent fixture, not natural-language inference or generated artwork. */
export const expectedTypes=['Container','Panel','Image','Text','Button','Slider','Switch','CheckBox','Select','RadioGroup','ProgressBar','Input','ScrollView','Tabs','List','Dialog'].sort();
export const request={requestVersion:'0.1',id:'all-components',target:'pixi',text:'组件验收：音量0到100默认57；静音关闭；性别男和女默认男；确认按钮；说明请选择角色；下载57/100；角色名小蓝莓必填2到12字；使用战士肖像绑定验证纹理。CheckBox 提示未勾选。RadioGroup 画质低和高默认高。List 背包12个物品默认物品1，每项40高，显示4项。Dialog 初始关闭，打开说明按钮打开，标题说明，正文确认后继续操作，关闭按钮关闭，模态，400宽240高。三个页签基础、选择和说明，默认基础，内容滚动。'};
export const newRows=[
 {kind:'checkbox',label:'提示',recipeKey:'content.checkbox@0.1.0',enabled:true,initial:false},
 {kind:'radio',label:'画质',recipeKey:'content.radio@0.1.0',enabled:true,options:[{label:'低',initial:false},{label:'高',initial:true}]},
 {kind:'list',label:'背包',recipeKey:'content.list@0.1.0',enabled:true,options:Array.from({length:12},(_,i)=>({label:'物品'+(i+1),initial:i===0})),itemHeight:40,visibleItems:4},
 {kind:'dialog',label:'打开说明',recipeKey:'content.dialog@0.1.0',enabled:true,initial:false,title:'说明',text:'确认后继续操作。',closeLabel:'关闭',modal:true,dialogWidth:400,dialogHeight:240},
];
export const oldRows=[
 {kind:'slider',label:'音量',recipeKey:'settings.slider@0.1.0',enabled:true,min:0,max:100,step:1,initial:57,prefix:'',suffix:'%'},
 {kind:'switch',label:'静音',recipeKey:'settings.switch@0.1.0',enabled:true,initial:false},
 {kind:'select',label:'性别',recipeKey:'settings.select@0.1.0',enabled:true,options:[{label:'男',initial:true},{label:'女',initial:false}]},
 {kind:'button',label:'确认',recipeKey:'settings.button.primary@0.1.0',enabled:true,action:'emit',resetRows:[],submitRows:[]},
 {kind:'text',label:'说明',recipeKey:'settings.text@0.1.0',text:'请选择角色',wrap:'word'},
 {kind:'progress',label:'下载进度',recipeKey:'settings.progress@0.1.0',max:100,initial:57,display:'percent',fractionDigits:0},
 {kind:'input',label:'角色名',recipeKey:'forms.input@0.1.0',enabled:true,initial:'小蓝莓',placeholder:'请输入角色名',inputType:'text',readOnly:false,maxLength:12,required:true,minLength:2},
 {kind:'image',label:'验证纹理',recipeKey:'content.image@0.1.0',source:'image-fixtures/image0@1.0.0',width:'fill',height:128,fit:'contain'},
];
export function intent(context,{mode='light',tabs=true,rows=[...oldRows,...newRows]}={}){
 const section=(title,items)=>({kind:'section',title,actionLayout:null,rows:items.map(row=>({...structuredClone(row),sourceRef:'request',icon:null}))});
 const body=tabs?{kind:'tabs',enabled:true,sourceRef:'request',pages:[
  {label:'基础',initial:true,sourceRef:'request',body:{kind:'column',children:[section('基础',rows.slice(0,8))]}},
  {label:'选择',initial:false,sourceRef:'request',body:{kind:'column',children:[section('选择',rows.slice(8,11))]}},
  {label:'说明',initial:false,sourceRef:'request',body:{kind:'column',children:[section('说明',rows.slice(11))]}},
 ]}:{kind:'column',children:[section('组件',rows)]};
 const theme=context.catalog.themes.find(theme=>theme.id===`modern-mint-${mode}`&&theme.headingStyle?.startsWith('concise-v'));
 return {panelIntentVersion:'0.12',contextSha256:context.sha256,unresolved:[],panel:{id:context.request.id,title:'组件验收',themeKey:`${theme.id}@${theme.version}`,panelSurface:null,layout:{width:640,canvasWidth:720,canvasHeight:800,maxHeight:680,overflow:'auto'},body}};
}
