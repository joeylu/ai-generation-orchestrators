/** Authored natural-language scenarios based on the Reference workbench's eight public templates. */
const button=label=>({kind:'button',label,recipeKey:'settings.button.primary@0.1.0',enabled:true,action:'emit',resetRows:[],submitRows:[]});
const text=(label,value)=>({kind:'text',label,recipeKey:'settings.text@0.1.0',text:value,wrap:'word'});
const toggle=(label,initial)=>({kind:'switch',label,recipeKey:'settings.switch@0.1.0',enabled:true,initial});
const progress=initial=>({kind:'progress',label:'加载进度',recipeKey:'settings.progress@0.1.0',max:100,initial,display:'percent',fractionDigits:0});
const shared='使用当前目录的简洁流式布局和默认视觉样式，逻辑画布960×800，面板自动测量。仅生成下述内容，所有交互控件启用。按钮只发出宿主事件，不实现联网、资源下载或游戏逻辑，不增加确认弹窗。';
const make=(id,sourcePanelId,title,request,rows)=>({id,operation:'generate',category:sourcePanelId,sourcePanelId,
  request:{requestVersion:'0.1',id,target:'pixi',text:request+' '+shared},
  reference:{title,rows,canvas:{width:960,height:800},layout:{width:null,canvasWidth:960,canvasHeight:800,maxHeight:null}}});
export const REFERENCE_EIGHT_CASES=[
  make('P01','sdk-ready','游戏标题','做游戏开始页，面板标题逐字为“游戏标题”。内容只有一个“开始”按钮。不要商城、退出或存档入口。',[button('开始')]),
  make('P02','sdk-settings','设置','做设置面板，标题“设置”。依次是“体感倾斜”开关默认关闭、“音乐”开关默认开启、“音效”开关默认开启；然后“语言”下拉，选项按“简体中文”“English”排列，默认“简体中文”；最后“关闭”按钮。更改控件立即更新面板状态，不增加保存、重置或音量滑块。',
    [toggle('体感倾斜',false),toggle('音乐',true),toggle('音效',true),{kind:'select',label:'语言',recipeKey:'settings.select@0.1.0',enabled:true,options:[{label:'简体中文',initial:true},{label:'English',initial:false}]},button('关闭')]),
  make('P03','sdk-pause-online','已暂停','做在线模式暂停页，标题“已暂停”。内容仅有“继续”按钮，不出现菜单、退出或重新开始。',[button('继续')]),
  make('P04','sdk-pause-local','已暂停','做本地离线暂停页，标题“已暂停”。内容依次是“继续”“菜单”两个按钮，不增加其他操作。',[button('继续'),button('菜单')]),
  make('P05','sdk-result-complete','通关','做通关结算页，标题“通关”。依次展示三项只读文字：标签“得分”、内容“12,800”；标签“用时”、内容“92 秒”；标签“完成状态”、内容“通关”。最后一个“再来一局”按钮。不要把用时转换成分秒格式，不要增加排行或分享。',
    [text('得分','12,800'),text('用时','92 秒'),text('完成状态','通关'),button('再来一局')]),
  make('P06','sdk-result-failed','未通关','做未通关结算页，标题“未通关”。依次展示三项只读文字：标签“得分”、内容“6,400”；标签“用时”、内容“48 秒”；标签“完成状态”、内容“未通关”。最后一个“再来一局”按钮。不增加通关奖励、菜单或其他指标。',
    [text('得分','6,400'),text('用时','48 秒'),text('完成状态','未通关'),button('再来一局')]),
  make('P07','sdk-loading','场景加载','做加载中面板，标题“场景加载”。依次放：只读Text标签“加载占位”、内容“○”，作为静态圆形占位，不要求动画；只读ProgressBar标签“加载进度”，最大100、当前60，以整数百分比显示；只读Text标签“加载阶段”、内容“正在准备图片”。不要任何按钮，进度不自动增长。',
    [text('加载占位','○'),progress(60),text('加载阶段','正在准备图片')]),
  make('P08','sdk-loading-failed','场景加载','做加载失败面板，标题“场景加载”。依次放：只读Text标签“加载占位”、内容“○”，作为静态圆形占位，不要求动画；只读ProgressBar标签“加载进度”，最大100、当前40，以整数百分比显示；只读Text标签“提示”、内容“场景资源加载失败”；最后“重试”“返回”两个按钮。错误提示替代加载阶段，不再显示“正在准备图片”，进度不自动增长。',
    [text('加载占位','○'),progress(40),text('提示','场景资源加载失败'),button('重试'),button('返回')]),
];
