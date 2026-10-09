/** Independently authored expectations. No prose classifier or model-success claim. */
const slider = (label, initial) => ({kind:'slider',label,min:0,max:100,step:1,initial});
const toggle = (label, initial=false) => ({kind:'switch',label,initial});
const reset = label => ({kind:'button',label,action:'reset-initial',resetRows:[0,1]});
const audio = (volume=70, labels=['主音量','静音','恢复默认']) => [slider(labels[0],volume),toggle(labels[1]),reset(labels[2])];
const generate = (id, category, text, rows, title='声音设置', groups=null) => ({id,mode:'generate',category,text,
  expected:rows ? {outcome:'READY_TO_COMPILE',title,rows,groups} : {outcome:'NEEDS_INPUT'}});
const clarify = (id,mode,category,text,question,extra={}) => ({id,mode,category,text,question,...extra,expected:{outcome:'NEEDS_INPUT'}});
const edit = (id,category,text,operations,extra={}) => ({id,mode:'edit',category,text,operations,...extra,
  expected:{outcome:operations.length?'READY_TO_APPLY':'NO_CHANGES'}});
export const INPUT_COVERAGE_V2 = {
  version:'0.1',sourceKind:'PROGRAMMATIC_FIXTURE',modelCalls:0,
  scope:'Six ready and six clarification generation cases; five ready, one no-change and six clarification edit cases. Contract coverage only; natural-language interpretation remains unverified without fresh authorized real calls.',
  cases:[
    generate('G01','explicit-correction','生成“声音设置”：主音量0到100、步长1、默认70。说错了，主音量默认值更正为50。静音默认关闭，开启表示静音。恢复默认只重置主音量和静音。三行都启用，除此之外不要加控件。',audio(50)),
    generate('G02','example-exclusion','生成“声音设置”。只要主音量0到100、步长1、默认70，静音默认关闭（开启表示静音），恢复默认只重置这两项。以上三行都启用。不要音乐滑条，不要保存按钮。“例如默认30”仅是举例，不是这次的值。',audio()),
    generate('G03','literal-negation-unicode','生成“声音设置”。只有“音量，Volume 🎵”滑条0～100、步长1、默认70，“不要打扰”开关默认关闭（开启表示静音）和“恢复，默认 🎵”按钮重置这两项。三个标签逐字保留，全部启用。',audio(70,['音量，Volume 🎵','不要打扰','恢复，默认 🎵'])),
    generate('G04','english','Create a panel titled "Audio" with exactly three enabled rows: "Volume" slider, range 0 to 100, step 1, default 70; "Mute" switch, initially off, on means muted; "Reset" resets only these two authored defaults. Host events only; no game integration.',audio(70,['Volume','Mute','Reset']),'Audio'),
    generate('G05','clarification-answer','生成“声音设置”，只有主音量滑条、静音开关和恢复默认按钮，全部启用，恢复默认只重置这两项。\n【补充回答】\n问题：音量默认50还是70？推荐50。\n回答：音量范围0～100、步长1、默认70；静音默认关闭，开启表示静音。',audio()),
    generate('G06','repeated-label-groups','生成“双声道”。“左声道”分组一个“音量”滑条0～100、步长1、默认70；“右声道”分组一个同名“音量”滑条0～100、步长1、默认40。“操作”分组一个“恢复默认”按钮同时重置左右两个音量。全部启用，不合并同名控件。',[slider('音量',70),slider('音量',40),reset('恢复默认')],'双声道',[[0],[1],[2]]),
    clarify('G07','generate','contradiction','生成声音设置，音量0～100、步长1，默认值必须为50，同时必须为70。','音量最终默认50还是70？'),
    clarify('G08','generate','missing-business-facts','生成一个音量滑条，默认70。','音量的范围和步长是多少？'),
    clarify('G09','generate','style-only','做一个酷一点、精致一点的游戏面板。','这个面板要显示哪些内容和操作？'),
    clarify('G10','generate','exclusion-only','不要设置按钮，也不要静音。','面板实际需要哪些内容和操作？'),
    clarify('G11','generate','unsupported-animation','生成暂停菜单，继续按钮只通知宿主，点击时必须播放可编辑的弹簧形变动画。','当前支持继续按钮通知宿主；是否接受不带弹簧形变动画的版本？'),
    clarify('G12','generate','unsupported-game-integration','做一个登录面板，用户名密码登录按钮直接调用我游戏里的联网登录逻辑。','当前只生成面板并通知宿主；是否接受由宿主接收登录事件的版本，并提供输入规则？'),
    edit('E01','explicit-correction','主音量默认值改为40。说错了，更正为50，其他不变。',[{op:'set-state-initial',fieldId:'row0',value:50}]),
    edit('E02','exclusion-preserve','不要改标题和静音，主音量默认值改为50，其他不变。',[{op:'set-state-initial',fieldId:'row0',value:50}]),
    edit('E03','compound-literal','面板标题改为“音量，Audio 🎵”，主音量默认值改为50，其他保持不变。',[{op:'set-panel-title',title:'音量，Audio 🎵'},{op:'set-state-initial',fieldId:'row0',value:50}]),
    edit('E04','selected-pronoun','这个开关默认开启，其他保持不变。',[{op:'set-state-initial',fieldId:'row1',value:true}],{selection:{rowId:'row1'}}),
    edit('E05','selected-repeated-label','这个默认值改为50，其他保持不变。',[{op:'set-state-initial',fieldId:'row1',value:50}],{selection:{rowId:'row1'},duplicate:true}),
    edit('E06','explicit-no-change','保持原样，不做任何修改。',[]),
    clarify('E07','edit','current-or-default','把主音量改成40，其他不变。','40是当前试玩值还是恢复默认时的值？'),
    clarify('E08','edit','unselected-pronoun','把这个字号调到24。','需要调整哪个标题或按钮的字号？'),
    clarify('E09','edit','repeated-label-ambiguous','音量默认值改为50。','需要修改左声道还是右声道的音量？',{duplicate:true}),
    clarify('E10','edit','outside-selection','静音默认开启，其他不变。','当前选中主音量；请清除选中后修改静音，或改为选中静音。',{selection:{rowId:'row0'}}),
    clarify('E11','edit','compound-unsupported','标题改成“音频”，同时让恢复默认按钮点击时弹簧形变，必须一起完成。','标题修改受支持；点击弹簧形变暂不支持，是否仅修改标题？'),
    clarify('E12','edit','contradiction','主音量默认值必须改成50，同时必须为70，其他不变。','主音量最终默认50还是70？'),
  ],
};

/** Fixture proposal construction only; never used to produce or repair a model response. */
export function coverageIntent(context,item) {
  if(item.expected.outcome==='NEEDS_INPUT') return {panelIntentVersion:'0.10',contextSha256:context.sha256,panel:null,unresolved:[{id:'q0',question:item.question}]};
  const rows=item.expected.rows.map(row=>({...row,recipeKey:`settings.${row.kind==='button'?'button.secondary':row.kind}@0.1.0`,sourceRef:'request',icon:null,enabled:true,
    ...(row.kind==='slider'?{prefix:'',suffix:''}:{}),...(row.kind==='button'?{submitRows:[]}: {})}));
  return {panelIntentVersion:'0.10',contextSha256:context.sha256,unresolved:[],panel:{id:context.request.id,title:item.expected.title,
    themeKey:`${context.catalog.themes[0].id}@${context.catalog.themes[0].version}`,panelSurface:null,
    layout:{width:null,canvasWidth:null,canvasHeight:null,maxHeight:null,overflow:'auto'},
    body:{kind:'column',children:(item.expected.groups??[rows.map((_,i)=>i)]).map((indices,i)=>({kind:'section',title:item.expected.groups?['左声道','右声道','操作'][i]:item.expected.title,actionLayout:null,rows:indices.map(index=>rows[index])}))}}};
}
