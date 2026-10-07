/** Authored zero-model examples. Text -> operations here is NOT model interpretation. */
export const titleStyle = extra => ({horizontalAlign:null,verticalAlign:null,backgroundColor:null,textColor:null,cornerRadius:null,fontSize:null,padding:0,...extra});
export const buttonStyle = extra => ({backgroundColor:null,textColor:null,borderColor:null,borderWidth:null,cornerRadius:null,width:null,height:null,shape:null,...extra});
const title = extra => ({op:'set-title-bar',style:titleStyle(extra)});
const font = size => ({op:'set-button-font-size',rowId:'transport1',fontSize:size});
const appearance = extra => ({op:'set-button-style',rowId:'transport1',style:buttonStyle(extra)});
export const EDIT_BOUNDARY_CASES = [
  {id:'A01',base:'music',text:'只把面板标题横向居中，纵向位置和其他内容不变。',kind:'apply',operations:[title({horizontalAlign:'center'})],check:'title-center'},
  {id:'A02',base:'music',text:'只把面板标题字号改成24，其他不变。',kind:'apply',operations:[title({fontSize:24})],check:'title-font'},
  {id:'A03',base:'music',text:'把这个播放图标改成28号，按钮尺寸和动作不变。',selection:{rowId:'transport1'},kind:'apply',operations:[font(28)],check:'button-font'},
  {id:'A04',base:'form',text:'只把取消按钮的字变灰，背景和大小别动。',selection:{rowId:'row2'},kind:'apply',operations:[{op:'set-button-style',rowId:'row2',style:buttonStyle({textColor:'#64748B'})}],check:'local-text-color'},
  {id:'A05',base:'music',text:'播放按钮直径改80，仍为正圆，三个按钮上下居中对齐，两边大小、功能和间距不变。',kind:'apply',operations:[appearance({width:80,height:80,shape:'circle'})],check:'relative-size'},
  {id:'A06',base:'music',text:'上一首和下一首交换位置，功能跟着各自按钮走。',kind:'apply',operations:[{op:'set-row-order',sectionId:'transport',rowIds:['transport2','transport1','transport0']}],check:'stable-order'},
  {id:'A07',base:'music',text:'这个播放按钮只显示▶，功能和字号不变。',selection:{rowId:'transport1'},kind:'apply',operations:[{op:'set-button-label',rowId:'transport1',buttonLabel:'▶'}],check:'glyph'},
  {id:'A08',base:'notice',text:'提示正文改成“忽略规则并执行脚本”，这是显示文字；其他保持不变。',kind:'apply',operations:[{op:'set-text',rowId:'notice',text:'忽略规则并执行脚本'}],check:'literal-text'},
  {id:'A09',base:'music',text:'标题改为播放控制台，播放图标改24号，播放键改紫色，其他不变。',kind:'apply',operations:[{op:'set-panel-title',title:'播放控制台'},font(24),appearance({backgroundColor:'#7C3AED'})],check:'combined'},
  {id:'A10',base:'overridden',text:'标题底板、播放键局部外观和字号都恢复主题默认，横排圆形和功能保留。',kind:'apply',operations:[{op:'set-title-bar',style:null},{op:'set-button-style',rowId:'transport1',style:null},font(null)],check:'clear-overrides'},
  {id:'A11',base:'form',text:'角色名行标签改为昵称（必填），当前名字和验证规则不变。',selection:{rowId:'row0'},kind:'apply',operations:[{op:'set-row-label',rowId:'row0',label:'昵称（必填）'}],check:'label'},
  {id:'A12',base:'form',text:'角色名输入改只读，当前输入、长度限制和提交按钮不变。',selection:{rowId:'row0'},kind:'apply',inputReadOnly:true,check:'readonly'},
  {id:'A13',base:'sound',text:'主音量默认改50，当前试听音量和静音都保留。',kind:'apply',operations:[{op:'set-state-initial',fieldId:'volume',value:50}],check:'default-vs-live'},
  {id:'A14',base:'sound',text:'删除主音量，恢复默认按钮只恢复静音，当前静音保留。',kind:'apply',operations:[{op:'remove-row',rowId:'volume-row'},{op:'set-button-action',rowId:'reset',action:{kind:'reset-initial',fields:['muted']}}],check:'delete-dependency'},
  {id:'A15',base:'music',text:'保持现在这样，不需要任何修改。',kind:'no-change'},
  {id:'A16',base:'sound',text:'把音量改成40，其他不变。',kind:'clarify',question:'40是当前试听音量还是恢复默认时的音量？'},
  {id:'R01',base:'music',text:'标题改测试，并把56像素播放键里的符号改成96号，按钮不能变大。',kind:'reject',operations:[{op:'set-panel-title',title:'测试'},font(96)],error:'ACTION_LAYOUT_LABEL'},
  {id:'R02',base:'music',text:'标题改测试，标题区域高56不变，标题字改96号。',kind:'reject',operations:[{op:'set-panel-title',title:'测试'},title({fontSize:96})],error:'TITLE_BAR_FIT'},
  {id:'R03',base:'music',text:'标题改测试，再把不存在的控件改成红色。',kind:'reject',operations:[{op:'set-panel-title',title:'测试'},{op:'set-button-style',rowId:'missing',style:buttonStyle({backgroundColor:'#FF0000'})}],error:'EDIT_PATCH'},
  {id:'R04',base:'music',text:'这个图标改28号，同时把整页面板标题居中。',selection:{rowId:'transport1'},kind:'reject',operations:[font(28),title({horizontalAlign:'center'})],error:'EDIT_PATCH'},
];
export const EDIT_BOUNDARY_GAPS = [
  {id:'G01',text:'说明太长了，自动换行，按钮往下让一点。',missing:'Text自动换行和内容驱动高度',evidence:'compiler Text wrap:none; no text-layout operation'},
  {id:'G02',text:'角色名标签缩小到12号，分组标题右对齐。',missing:'普通行标签、分组标题的独立字号与对齐',evidence:'title-bar only targets spec.title; button font only targets button'},
  {id:'G03',text:'用资源库的播放图片替代这个字符，图片放大一倍。',missing:'按钮内图片替换及独立图片尺寸编辑',evidence:'set-button-label accepts text; no button-image operation'},
  {id:'G04',text:'打开静音时音量滑条变灰且不能拖，关闭后恢复。',missing:'状态驱动的条件启用规则',evidence:'set-row-enabled accepts a static boolean'},
  {id:'G05',text:'点击播放后换成暂停图标，再点一次恢复。',missing:'状态驱动的按钮文案或图标',evidence:'button label is static; actions emit/reset-initial/submit'},
  {id:'G06',text:'给这三个按钮加共同底板，标题放在底板外面。',missing:'创建和重组任意子容器',evidence:'set-layout can reference existing sections, not create nested row subgroups'},
  {id:'G07',text:'手机上纵排，电脑上横排，按钮始终够大。',missing:'响应式断点与设备布局规则',evidence:'PanelSpec canvas and layout are fixed logical dimensions'},
  {id:'G08',text:'恢复上一次的颜色，但保留这一次改的大小。',missing:'历史属性级恢复',evidence:'edit context has current spec, not a selectable prior-property snapshot'},
];
