/** Coverage inventory and offline driver specimens. Never a unique answer for an open request. */
const button=label=>({kind:'button',label,recipeKey:'settings.button.primary@0.1.0',enabled:true,action:'emit',resetRows:[],submitRows:[]});
const text=(label,value)=>({kind:'text',label,recipeKey:'settings.text@0.1.0',text:value,wrap:'word'});
const toggle=(label,initial)=>({kind:'switch',label,recipeKey:'settings.switch@0.1.0',enabled:true,initial});
const choice=(label,options,kind='list')=>({kind,label,recipeKey:`content.${kind}@0.1.0`,enabled:true,options:options.map((label,i)=>({label,initial:i===0})),...(kind==='list'?{itemHeight:44,visibleItems:3}:{})});
const input=label=>({kind:'input',label,recipeKey:'forms.input@0.1.0',enabled:true,initial:'',placeholder:'请输入',inputType:'text',readOnly:false,maxLength:32,required:false,minLength:0});
const progress={kind:'progress',label:'进度（示例）',recipeKey:'settings.progress@0.1.0',max:100,initial:0,display:'percent',fractionDigits:0};
const menu=(...labels)=>labels.map(button);
// The reference rows below are used ONLY by the deterministic driver simulation.
const groups=[
  ['基础流程',[
    ['开始','做个游戏开始面板',menu('开始游戏','设置')],
    ['大厅','做个游戏大厅',menu('开始','背包','商店','设置')],
    ['设置','帮我做个设置面板',[toggle('音乐',true),toggle('音效',true),button('关闭')]],
    ['在线暂停','做个在线游戏暂停面板',menu('继续','返回大厅')],
    ['单机暂停','做个单机游戏暂停面板',menu('继续','重新开始','返回菜单')],
    ['通关','做个通关结算面板',[text('得分','示例：12800'),button('下一关'),button('再来一次')]],
    ['失败','做个挑战失败面板',[text('结果','挑战失败'),button('重试'),button('返回')]],
    ['加载','做个加载面板',[progress,text('提示','正在加载')]],
  ]],
  ['关卡与成长',[
    ['加载失败','做个加载失败面板',[text('提示','加载失败'),...menu('重试','返回')]],
    ['重连','做个断线重连面板',[text('提示','连接已断开'),...menu('重连','返回')]],
    ['选关','做个关卡选择面板',[choice('关卡（示例）',['关卡1','关卡2','关卡3']),button('进入')]],
    ['章节','做个章节选择面板',[choice('章节（示例）',['章节1','章节2']),button('进入')]],
    ['关卡未解锁','做个关卡未解锁提示',[text('提示','此关卡尚未解锁'),button('返回')]],
    ['任务列表','做个任务列表面板',[choice('任务（示例）',['任务1','任务2']),button('查看')]],
    ['任务详情','做个任务详情面板',[text('任务','示例：完成一次挑战'),text('进度','示例：0/1'),...menu('前往','关闭')]],
    ['成就','做个成就面板',[choice('成就（示例）',['初次挑战','坚持不懈']),text('状态','示例：未完成'),button('关闭')]],
  ]],
  ['角色与物品',[
    ['选角色','做个角色选择面板',[choice('角色（示例）',['角色1','角色2'],'radio'),button('确认')]],
    ['角色详情','做个角色详情面板',[text('角色','示例：角色1'),text('等级','示例：1'),button('关闭')]],
    ['升级','做个角色升级面板',[text('等级','示例：1'),text('升级消耗','示例：100金币'),...menu('升级','返回')]],
    ['技能','做个技能面板',[choice('技能（示例）',['技能1','技能2']),text('描述','示例技能说明'),button('关闭')]],
    ['装备','做个装备面板',[choice('装备（示例）',['装备1','装备2']),...menu('装备','关闭')]],
    ['背包','做个背包面板',[choice('物品（示例）',['物品1','物品2']),...menu('使用','关闭')]],
    ['物品详情','做个物品详情面板',[text('物品','示例：恢复药剂'),text('说明','示例：恢复少量生命'),...menu('使用','关闭')]],
    ['合成','做个物品合成面板',[text('配方','示例：材料1+材料2'),text('产物','示例：物品1'),...menu('合成','关闭')]],
  ]],
  ['商店与奖励',[
    ['商店','做个游戏商店面板',[choice('商品（示例）',['商品1','商品2']),text('价格','示例：100金币'),...menu('购买','关闭')]],
    ['商品详情','做个商品详情面板',[text('商品','示例：商品1'),text('价格','示例：100金币'),...menu('购买','返回')]],
    ['购买确认','做个购买确认面板',[text('提示','确认购买所选商品？'),...menu('确认','取消')]],
    ['金币不足','做个金币不足提示',[text('提示','金币不足'),button('关闭')]],
    ['体力不足','做个体力不足面板',[text('提示','体力不足'),...menu('补充','关闭')]],
    ['领奖','做个领取奖励面板',[text('奖励','示例：100金币'),button('领取')]],
    ['签到','做个每日签到面板',[choice('日期（示例）',['第1天','第2天','第3天']),...menu('签到','关闭')]],
    ['开箱结果','做个开箱结果面板',[text('获得物品','示例：物品1'),button('确认')]],
  ]],
  ['社交与对局',[
    ['排行榜','做个排行榜面板',[choice('榜单（示例）',['玩家1：100分','玩家2：90分']),button('关闭')]],
    ['好友','做个好友面板',[choice('好友（示例）',['好友1','好友2']),...menu('邀请','关闭')]],
    ['添加好友','做个添加好友面板',[input('玩家编号'),...menu('搜索','关闭')]],
    ['公会','做个公会面板',[text('公会','示例：公会1'),choice('成员（示例）',['成员1','成员2']),button('关闭')]],
    ['组队','做个组队面板',[choice('队员（示例）',['玩家1','空位']),...menu('邀请','准备','离队')]],
    ['房间','做个对战房间面板',[text('房间','示例：房间1'),choice('玩家（示例）',['玩家1','玩家2']),...menu('准备','退出')]],
    ['匹配中','做个匹配等待面板',[text('提示','正在匹配'),button('取消')]],
    ['匹配成功','做个匹配成功面板',[text('提示','匹配成功'),...menu('确认','取消')]],
  ]],
  ['活动与信息',[
    ['每日任务','做个每日任务面板',[choice('任务（示例）',['完成1次挑战','完成3次挑战']),...menu('领取','关闭')]],
    ['活动列表','做个活动面板',[choice('活动（示例）',['活动1','活动2']),...menu('查看','关闭')]],
    ['活动详情','做个活动详情面板',[text('活动','示例：活动1'),text('说明','示例活动说明'),...menu('参与','关闭')]],
    ['邮件','做个邮件面板',[choice('邮件（示例）',['邮件1','邮件2']),...menu('查看','关闭')]],
    ['邮件详情','做个邮件详情面板',[text('主题','示例：邮件1'),text('正文','示例邮件内容'),...menu('领取附件','关闭')]],
    ['公告','做个公告面板',[text('标题','示例：公告'),text('内容','示例公告内容'),button('关闭')]],
    ['战令','做个战令面板',[text('等级','示例：1'),progress,...menu('领取','关闭')]],
    ['新内容解锁','做个新内容解锁面板',[text('内容','示例：新角色'),...menu('查看','关闭')]],
  ]],
  ['账号与系统',[
    ['登录','做个游戏登录面板',[input('账号'),{...input('密码'),inputType:'password'},...menu('登录','返回')]],
    ['个人信息','做个玩家信息面板',[text('昵称','示例：玩家1'),text('等级','示例：1'),button('关闭')]],
    ['改昵称','做个修改昵称面板',[input('昵称'),...menu('确认','取消')]],
    ['保存','做个存档面板',[choice('存档槽（示例）',['存档1','存档2']),...menu('保存','关闭')]],
    ['读档','做个读档面板',[choice('存档（示例）',['存档1','存档2']),...menu('读取','关闭')]],
    ['退出确认','做个退出游戏确认框',[text('提示','确认退出游戏？'),...menu('确认','取消')]],
    ['帮助','做个游戏帮助面板',[text('说明','示例：选择关卡后开始挑战'),button('关闭')]],
    ['反馈','做个意见反馈面板',[input('反馈内容'),...menu('提交','关闭')]],
  ]],
];
const make=(category,title,request,rows,index,extra={})=>({id:'G'+String(index+1).padStart(2,'0'),operation:'generate',category,
  request:{requestVersion:'0.1',id:'G'+String(index+1).padStart(2,'0'),target:'pixi',text:request},
  reference:{title,rows,layout:{width:760,canvasWidth:824,canvasHeight:1300,maxHeight:1236}},
  evaluation:{kind:'OPEN_DRAFT_REVIEW',explicit:null},fixturePurpose:'ONE_POSSIBLE_DRIVER_FIXTURE_NOT_EXPECTED_ANSWER',
  designArm:'common-draft',promptProfile:'draft-first',...extra});
export const COMMON_GAME_PANEL_CASES=groups.flatMap(([group,items])=>items.map(([title,request,rows])=>({group,title,request,rows})))
  .map((item,i)=>make(item.group,item.title,item.request,item.rows,i));
const variants=[
  ['设置','设置界面来一个',2],['单机暂停','来个暂停菜单',4],['背包','整个背包页面',21],['领奖','给我弄个领奖弹窗',29],
].map(([title,request,source],i)=>make('口语变体',title,request,structuredClone(COMMON_GAME_PANEL_CASES[source].reference.rows),56+i,{pairedCaseId:COMMON_GAME_PANEL_CASES[source].id}));
const explicit=[
  ['暂停','做暂停面板，只要继续和返回菜单。',menu('继续','返回菜单'),{labels:['继续','返回菜单'],kinds:['button','button'],initials:{}}],
  ['设置','做设置面板，只要音乐和音效开关，都开着。',[toggle('音乐',true),toggle('音效',true)],{labels:['音乐','音效'],kinds:['switch','switch'],initials:{音乐:true,音效:true}}],
  ['通关','做通关面板，得分12800，再来一次。',[text('得分','12800'),button('再来一次')],{labels:['得分','再来一次'],kinds:['text','button'],initials:{},textValues:{得分:'12800'}}],
  ['加载失败','做加载失败面板，只显示网络断开和重试。',[text('提示','网络断开'),button('重试')],{labels:[null,'重试'],kinds:['text','button'],initials:{},textValuesByIndex:{0:'网络断开'}}],
].map(([title,request,rows,rules],i)=>make('明确约束',title,request,rows,60+i,{evaluation:{kind:'OPEN_DRAFT_REVIEW',explicit:{textValues:{},textValuesByIndex:{},...rules}}}));
export const COMMON_GAME_PANEL_SUITE=[...COMMON_GAME_PANEL_CASES,...variants,...explicit];
export function commonGamePanelFixture(context,item,createReference){
  const intent=createReference(context,item),theme=context.catalog.themes.find(theme=>theme.id==='modern-mint-light'&&['concise-v4','concise-v5','concise-v6'].includes(theme.headingStyle));
  intent.panel.themeKey=theme?`${theme.id}@${theme.version}`:'modern-mint-light@0.22.0';
  intent.panel.body.children[0].title=intent.panel.title;return intent;
}
