/** Fixed human-authored requests and reference answers; never supplied together to a model. */
import {oldRows,newRows,request as fullRequest,intent as fullIntent,expectedTypes} from '../all-components-v1/fixture.mjs';

const copy = value => structuredClone(value);
const section = (title,rows) => ({kind:'section',title,actionLayout:null,rows:rows.map(row=>({...copy(row),sourceRef:'request',icon:null}))});
const fourText = '依次放 CheckBox“提示”，默认不勾选；RadioGroup“画质”，选项按低、高排列，默认高；List“背包”，选项依次是物品1到物品12，默认物品1，每项40高、可见4项；Dialog 用“打开说明”打开，初始关闭，模态，标题“说明”，正文“确认后继续操作。”，按钮“关闭”，宽400高240。都可用。';
const casualFour = '“提示”旁边放一个能打勾的小方框，起初别打勾。“画质”把“低”“高”两个圆点选项直接摆出来，只能选一个，先选“高”，别折叠。“背包”用能滚动并选中一条的文字条目，物品1到物品12按顺序，先选物品1，一条高40，窗口露出4条。“打开说明”按钮点了弹出独立对话框，开始先藏着，弹出后挡住背后的操作；标题“说明”，正文“确认后继续操作。”，里面一个“关闭”按钮，弹窗400宽240高。以上都可操作。';
const ready = (id,category,text,rows,extra={}) => ({id,operation:'generate',category,request:{requestVersion:'0.1',id,target:'pixi',text},reference:{title:'输入验收',rows:copy(rows),...extra}});
const clarify = (id,category,text,question,questionPattern) => ({id,operation:'generate',category,request:{requestVersion:'0.1',id,target:'pixi',text},clarification:{question,questionPattern}});
const edit = (id,category,text,operations,extra={}) => ({id,operation:'edit',category,request:{requestVersion:'0.1',id,target:'pixi',text},operations,...extra});
const small = copy(newRows);
small[2].options = [{label:'药水',initial:true},{label:'钥匙',initial:false},{label:'金币',initial:false}];
const literal = copy(newRows.slice(0,2)); literal[0].label='不要打扰 ✓'; literal[1].label='画质，Quality 🎨';
literal[1].options = [{label:'不省略 Low',initial:false},{label:'仅高清 High',initial:true}];
const reset = {kind:'button',label:'恢复这三项',recipeKey:'settings.button.secondary@0.1.0',enabled:true,action:'reset-initial',resetRows:[0,1,2],submitRows:[]};
const dialogProperties = {title:'说明',text:'确认后继续操作。',closeLabel:'关闭',modal:true,dialogWidth:400,dialogHeight:240};

export const INPUT_ADAPTABILITY_CASES = [
  ready('G01','all-sixteen-explicit','生成标题逐字为“组件验收”的面板，包含基础、选择、说明三个横向页签，默认基础。基础页依次放：Slider“音量”0到100步长1默认57，整数后显示%；Switch“静音”默认关闭，开启表示静音；Select“性别”选项按男、女排列，默认男；“确认”按钮只发事件通知宿主，不改状态；Text 标签“说明”，正文“请选择角色”；ProgressBar“下载进度”最大100当前57，显示整数百分数；Input“角色名”单行文本，初始“小蓝莓”，占位“请输入角色名”，必填最少2最多12，可编辑；Image“验证纹理”绑定库中的战士肖像，宽填满高128，完整等比显示。选择页依次放 CheckBox“提示”默认不勾选、RadioGroup“画质”选项低和高默认高、List“背包”物品1到物品12按顺序默认物品1，每项40高可见4项。说明页放独立 Dialog，初始关闭、模态，打开按钮“打开说明”，标题“说明”，正文“确认后继续操作。”，关闭按钮“关闭”，400宽240高。所有可交互控件启用，溢出竖向滚动，不添加任何其他业务控件。',[...oldRows,...newRows],{full:true,title:'组件验收',requiredTypes:expectedTypes}),
  ready('G02','all-sixteen-colloquial','标题“组件验收”。基础页从上往下放：“音量”能拖的条，零到一百，每次变一，开始五十七，后面显示%；“静音”能切换，开始关着，开了就是静音；“性别”下拉只有男、女，先选男；“确认”按钮点了只通知宿主，不改状态；“说明”只读，内容“请选择角色”；“下载进度”只读进度条，最大100当前57，显示百分数不带小数；“角色名”单行文字框，初始“小蓝莓”，占位“请输入角色名”，必填，最少2最多12，可编辑；“验证纹理”用素材库的战士肖像，等比完整显示，高128，宽填满。选择页放：'+casualFour.replace('“打开说明”按钮点了','说明页放：“打开说明”按钮点了')+'三个横向页签基础、选择、说明，先打开基础；装不下竖向滚动。只要上述内容。',[...oldRows,...newRows],{full:true,title:'组件验收',requiredTypes:expectedTypes}),
  ready('G03','english','Create a panel titled “输入验收”. In order: enabled CheckBox “提示”, initially unchecked; visible RadioGroup “画质”, options “低”, “高”, initially “高”; selectable scrolling List “背包”, explicit items “物品1” through “物品12” in order, initially “物品1”, item height 40, 4 visible items; a modal Dialog initially closed, opened by “打开说明”, title “说明”, body exactly “确认后继续操作。”, close button “关闭”, width 400 height 240. All controls enabled, no other business content. Vertical overflow is allowed.',newRows),
  ready('G04','aliases-no-type-names','标题“输入验收”。'+casualFour+'严格只有这些业务内容，装不下竖向滚动。',newRows),
  ready('G05','explicit-corrections','标题“输入验收”。'+fourText+'更正前面默认值的旧描述：提示原先想勾选，现在确定不勾选；画质原想低，现在确定高；背包原想物品2，现在确定物品1；弹窗原想一开始打开，现在确定初始关闭。只用最后确定的值，不添加内容。',newRows),
  ready('G06','negative-exclusions','标题“输入验收”。只要 CheckBox“提示”默认不勾选，以及 RadioGroup“画质”选项低、高，默认高，都启用。不要 List，也不需要 Dialog，不要按钮，不要静态说明。',newRows.slice(0,2)),
  ready('G07','clarification-answer','标题“输入验收”。只有 List“背包”，文字选项按药水、钥匙、金币排列，每项40高、可见4项，启用。\n【补充回答】\n问题：默认选药水还是钥匙？推荐钥匙。\n回答：默认药水。', [small[2]]),
  ready('G08','literal-negation-unicode','标题“输入验收”。CheckBox 标签逐字为“不要打扰 ✓”，初始不勾选；RadioGroup 标签逐字为“画质，Quality 🎨”，选项按“不省略 Low”“仅高清 High”排列，默认“仅高清 High”。都启用，仅这两项，标签中的否定词不能删除。',literal),
  ready('G09','tabs-and-selection','标题“输入验收”。两个横向页签，默认“选择”。“选择”页依次放 CheckBox“提示”默认不勾选、RadioGroup“画质”选项低和高默认高、List“背包”物品1到物品12按顺序默认物品1，每项40高可见4项；“说明”页放打开说明按钮和独立 Dialog，初始关闭，模态，标题说明，正文“确认后继续操作。”，关闭按钮“关闭”，400宽240高。全部可用，内容溢出滚动，不加其他内容。',newRows,{twoTabs:true}),
  ready('G10','existing-eight-content','标题“输入验收”。按顺序：Slider 音量0到100步长1默认57显示%；Switch 静音默认关闭开启表示静音；Select 性别只有男、女默认男；确认按钮只通知宿主；只读说明“请选择角色”；下载进度最大100当前57显示整数百分数；角色名单行文字输入初始小蓝莓，占位请输入角色名，必填最少2最多12，可编辑；验证纹理图片用库中的战士肖像，高128宽填满，完整等比显示。都启用，仅这些内容，竖向滚动。',oldRows),
  ready('G11','reset-scope','标题“输入验收”。'+fourText.split('；Dialog')[0]+'。三个选择控件都启用。再放“恢复这三项”按钮，只重置提示、画质和背包的创作初始值；不需要 Dialog。严格按提示、画质、背包、恢复这三项排列。',[...newRows.slice(0,3),reset]),
  clarify('G12','unsupported-compound','生成标题“输入验收”，CheckBox 提示默认不勾选；还必须有 Dialog，打开按钮“打开登录”，标题“登录”，弹窗内包含用户名输入、密码输入和联网提交，必须一起完成，不接受只做复选框。','当前消息弹窗不支持内嵌登录表单和联网提交，是否接受宿主处理的方案？','弹窗|表单|登录|联网'),
  clarify('G13','missing-radio-default','只做 RadioGroup“画质”，选项低和高，都启用，标题“输入验收”。默认选哪个还没确定，请先问我，不能自行选择。','画质初始选择低还是高？','默认|初始|选择'),
  clarify('G14','missing-list-items','做 List“背包”，启用，每项40高显示4项，标题“输入验收”。具体有哪些物品和初始选中项还没提供，先问我，不能编造物品。','背包需要哪些文字选项，初始选中哪一项？','物品|选项|条目|内容'),
  clarify('G15','missing-dialog-body','做独立模态 Dialog，初始关闭，打开按钮“打开说明”，标题“说明”，关闭按钮“关闭”，400宽240高，启用。面板标题“输入验收”。正文还没确定，请先问我，不要自写正文。','说明弹窗正文需要显示什么？','正文|内容|显示|文案'),
  clarify('G16','unresolved-contradiction','标题“输入验收”，只有 CheckBox“提示”，启用。初始必须不勾选，同时初始必须勾选，这两条同时生效，不是改口。','提示初始应该勾选还是不勾选？','勾选|默认|初始|冲突'),
  edit('E01','selected-pronoun','这个默认勾选，其他保持不变。',[{op:'set-state-initial',fieldId:'row8',value:true}],{selection:{rowId:'row8'}}),
  edit('E02','rename-radio-options','画质的两个选项按原位置改名：低改为省电，高改为精细。默认仍选原来的高，也就是精细；不要改ID，其他不变。',[{op:'set-choice-options',rowId:'row9',options:[{id:'option0',label:'省电'},{id:'option1',label:'精细'}],initial:'option1'}]),
  edit('E03','list-geometry','这个列表每项高度改成48，可见3项；保留选项、默认选中项和当前试玩选择，其他不变。',[{op:'set-list-properties',rowId:'row10',itemHeight:48,visibleItems:3}],{selection:{rowId:'row10'}}),
  edit('E04','dialog-correction','把弹窗正文改成“请退出。”。说错了，最终正文逐字为“确认后返回面板。”，其他属性保持不变。',[{op:'set-dialog-properties',rowId:'row11',...dialogProperties,text:'确认后返回面板。'}],{selection:{rowId:'row11'}}),
  edit('E05','four-component-compound','提示默认勾选，画质默认低，背包可见3项，说明弹窗改成非模态；其他创作属性和当前试玩值不变。',[{op:'set-state-initial',fieldId:'row8',value:true},{op:'set-state-initial',fieldId:'row9',value:'option0'},{op:'set-list-properties',rowId:'row10',itemHeight:40,visibleItems:3},{op:'set-dialog-properties',rowId:'row11',...dialogProperties,modal:false}]),
  edit('E06','duplicate-selected','这个默认不勾选，其他保持不变。',[{op:'set-state-initial',fieldId:'row1',value:false}],{source:'duplicates',selection:{rowId:'row1'}}),
  edit('E07','duplicate-ambiguous','提示默认不勾选，其他保持不变。',null,{source:'duplicates',clarification:{question:'需要修改左侧还是右侧的提示？',questionPattern:'左|右|哪|选择|选中|两个'}}),
  edit('E08','unsupported-edit-compound','面板标题改为“登录”，同时把说明弹窗改成内嵌用户名、密码输入和联网提交的登录表单，两项必须一起完成。',null,{clarification:{question:'当前消息弹窗不支持内嵌登录表单和联网提交，是否只修改标题？',questionPattern:'弹窗|表单|登录|联网'}}),
];

export function referenceIntent(context,item) {
  if(item.clarification)return {panelIntentVersion:context.planningContextVersion==='0.12'?'0.13':'0.12',contextSha256:context.sha256,panel:null,unresolved:[{id:'q0',question:item.clarification.question}]};
  if(item.reference.full)return fullIntent(context);
  const {rows,title,twoTabs}=item.reference;
  const body=twoTabs?{kind:'tabs',enabled:true,sourceRef:'request',pages:[
    {label:'选择',initial:true,sourceRef:'request',body:{kind:'column',children:[section('选择',rows.slice(0,3))]}},
    {label:'说明',initial:false,sourceRef:'request',body:{kind:'column',children:[section('说明',rows.slice(3))]}},
  ]}:{kind:'column',children:[section('内容',rows)]};
  return {panelIntentVersion:context.planningContextVersion==='0.12'?'0.13':'0.12',contextSha256:context.sha256,unresolved:[],panel:{id:context.request.id,title,themeKey:'modern-mint-light@0.21.0',panelSurface:null,layout:{width:640,canvasWidth:720,canvasHeight:800,maxHeight:680,overflow:'auto',...item.reference.layout},body}};
}

export function duplicateIntent(context) {
  const result=referenceIntent(context,{reference:{title:'重复提示',rows:[]}});
  result.panel.body.children=[section('左侧',[newRows[0]]),section('右侧',[{...newRows[0],initial:true}])];
  return result;
}
