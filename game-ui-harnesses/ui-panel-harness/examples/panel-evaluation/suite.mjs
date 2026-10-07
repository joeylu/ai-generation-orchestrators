/** Natural-language inputs and independent acceptance expectations; not generated proposals. */
const slider = (label, min, max, step, initial) => ({ kind: 'slider', label, min, max, step, initial, enabled: true });
const toggle = (label, initial) => ({ kind: 'switch', label, initial, enabled: true });
const select = (label, options, initialLabel) => ({ kind: 'select', label, options, initialLabel, enabled: true });
const button = (label, action = 'emit', enabled = true, resetLabels = []) => ({ kind: 'button', label, action, enabled, resetLabels });
const text = (label, value) => ({ kind: 'text', label, text: value });
const common = '用于 Web/Pixi 的现代薄荷色 UI。保留已经列出的全部控件和按钮，不添加未列出的行或按钮。所有交互通知宿主，按钮只发送事件或重置面板初值，不执行实际游戏业务。所有滑条、开关、下拉及未说明禁用的按钮均启用。';
const panel = (id, title, request, rows, layout = null) => ({ id, title,
  request: { requestVersion: '0.1', id, target: 'pixi', text: `生成“${title}”面板。${request}${common}` },
  expected: { title, rows, layout } });

export const PANEL_EVALUATION_SUITE = { panelEvaluationSuiteVersion: '0.3',
  scope: '16 independent natural-language requests with unambiguous explicit button membership; each batch is a separate measured sample',
  cases: [
    panel('eval-audio', '声音设置', '主音量滑条范围 0～100，步长 1，默认 70；静音开关默认关闭，开启表示静音；恢复默认按钮重置这两项。',
      [slider('主音量', 0, 100, 1, 70), toggle('静音', false), button('恢复默认', 'reset-initial', true, ['主音量', '静音'])]),
    panel('eval-graphics', '画质设置', '两个分组：显示分组包含画质下拉（低、中、高三项，默认中）和全屏开关（默认关闭）；调节分组包含亮度滑条（0～100，步长 1，默认 60）和恢复默认按钮（重置上述三项）。两组使用双列 grid 布局，宽度不足时响应式排成单列；不需要点击折叠分组。逻辑画布宽 1000，面板宽 940。',
      [select('画质', ['低', '中', '高'], '中'), toggle('全屏', false), slider('亮度', 0, 100, 1, 60), button('恢复默认', 'reset-initial', true, ['画质', '全屏', '亮度'])], { kind: 'grid', canvasWidth: 1000, width: 940 }),
    panel('eval-controls', '控制设置', '鼠标灵敏度滑条范围 0.1～2，步长 0.1，默认 1；反转 Y 轴开关默认关闭；控制方案下拉有键鼠、手柄两项，默认键鼠；恢复默认按钮重置三项。',
      [slider('鼠标灵敏度', 0.1, 2, 0.1, 1), toggle('反转 Y 轴', false), select('控制方案', ['键鼠', '手柄'], '键鼠'), button('恢复默认', 'reset-initial', true, ['鼠标灵敏度', '反转 Y 轴', '控制方案'])]),
    panel('eval-accessibility', '无障碍设置', '字体缩放滑条范围 80～150，步长 10，默认 100；字幕开关默认开启；减少动态效果开关默认关闭；对比度下拉有普通、高对比两项，默认普通；恢复默认按钮重置四项。',
      [slider('字体缩放', 80, 150, 10, 100), toggle('字幕', true), toggle('减少动态效果', false), select('对比度', ['普通', '高对比'], '普通'), button('恢复默认', 'reset-initial', true, ['字体缩放', '字幕', '减少动态效果', '对比度'])]),
    panel('eval-notifications', '通知设置', '依次是好友上线、任务完成、活动提醒三个开关，默认分别开启、开启、关闭；最后是应用按钮，发送事件且不重置任何值。',
      [toggle('好友上线', true), toggle('任务完成', true), toggle('活动提醒', false), button('应用')]),
    panel('eval-language', '语言设置', '语言下拉包含简体中文、English、日本語、한국어四项，默认简体中文；应用按钮发送事件，不重置。',
      [select('语言', ['简体中文', 'English', '日本語', '한국어'], '简体中文'), button('应用')]),
    panel('eval-main-menu', '主菜单', '按顺序放置新游戏、继续游戏、设置、退出四个按钮；继续游戏禁用，其余启用；全部发送事件，不需要任何状态字段。',
      [button('新游戏'), button('继续游戏', 'emit', false), button('设置'), button('退出')]),
    panel('eval-pause', '暂停菜单', '只有继续、设置、返回主菜单三个按钮，按此顺序，全部发送事件，不需要状态字段。',
      [button('继续'), button('设置'), button('返回主菜单')]),
    panel('eval-confirm', '删除确认', '先放只读文本行，标签提示，内容为“删除后无法恢复”；然后取消、确认删除两个按钮，发送事件，不需要状态字段。',
      [text('提示', '删除后无法恢复'), button('取消'), button('确认删除')]),
    panel('eval-save', '存档管理', '两个只读文本行：存档槽的内容为“槽位 1”，状态的内容为“空”；然后保存、读取两个发送事件的按钮，保存启用，读取禁用。没有状态字段，不执行文件操作。',
      [text('存档槽', '槽位 1'), text('状态', '空'), button('保存'), button('读取', 'emit', false)]),
    panel('eval-character', '角色信息', '使用双列 grid：角色分组只有角色名只读文本行，内容“蓝莓”；属性分组放等级只读文本行，内容“20”，金币只读文本行，内容“1200”，以及关闭按钮（发送事件）。没有状态字段。逻辑画布宽 1000，面板宽 940。',
      [text('角色名', '蓝莓'), text('等级', '20'), text('金币', '1200'), button('关闭')], { kind: 'grid', canvasWidth: 1000, width: 940 }),
    panel('eval-quest', '任务详情', '按顺序放只读文本行：任务名称内容“森林巡逻”，任务目标内容“找到三处营地”，奖励内容“金币 200”；最后追踪、关闭按钮发送事件。没有状态字段。',
      [text('任务名称', '森林巡逻'), text('任务目标', '找到三处营地'), text('奖励', '金币 200'), button('追踪'), button('关闭')]),
    panel('eval-inventory', '背包筛选', '分类下拉包含全部、武器、防具、消耗品、材料，默认全部；仅收藏开关默认关闭；排序下拉包含名称、稀有度、最近获得，默认名称；重置筛选按钮重置三项。不生成物品列表。',
      [select('分类', ['全部', '武器', '防具', '消耗品', '材料'], '全部'), toggle('仅收藏', false), select('排序', ['名称', '稀有度', '最近获得'], '名称'), button('重置筛选', 'reset-initial', true, ['分类', '仅收藏', '排序'])]),
    panel('eval-shop', '商店筛选', '分类下拉有全部、装备、补给三项，默认全部；预算滑条范围 0～1000，步长 10，默认 500；仅可购买开关默认开启；查询按钮发送事件，不重置，不实际购买。',
      [select('分类', ['全部', '装备', '补给'], '全部'), slider('预算', 0, 1000, 10, 500), toggle('仅可购买', true), button('查询')]),
    panel('eval-room', '房间准备', '先放房间只读文本行，内容“蓝莓小队”，人数上限只读文本行，内容“4”；准备开关默认关闭；难度下拉有简单、普通、困难三项，默认普通；开始、离开按钮发送事件，开始禁用，离开启用。不连接网络。',
      [text('房间', '蓝莓小队'), text('人数上限', '4'), toggle('准备', false), select('难度', ['简单', '普通', '困难'], '普通'), button('开始', 'emit', false), button('离开')]),
    panel('eval-advanced', '高级设置', '单列 column 布局，面板最大高度 480，溢出时垂直滚动。按顺序：画质下拉（低、中、高，默认中），语言下拉（中文、English，默认中文）；六个滑条：主音量 0～100 步长 1 默认 70，音乐音量 0～100 步长 1 默认 55，音效音量 0～100 步长 1 默认 60，亮度 0～100 步长 1 默认 60，鼠标灵敏度 1～10 步长 1 默认 5，字体缩放 80～150 步长 10 默认 100；五个开关：静音默认关闭，全屏默认关闭，字幕默认开启，垂直同步默认开启，通知默认开启；最后恢复默认按钮重置上述全部十三项。',
      [select('画质', ['低', '中', '高'], '中'), select('语言', ['中文', 'English'], '中文'), slider('主音量', 0, 100, 1, 70), slider('音乐音量', 0, 100, 1, 55), slider('音效音量', 0, 100, 1, 60), slider('亮度', 0, 100, 1, 60), slider('鼠标灵敏度', 1, 10, 1, 5), slider('字体缩放', 80, 150, 10, 100), toggle('静音', false), toggle('全屏', false), toggle('字幕', true), toggle('垂直同步', true), toggle('通知', true), button('恢复默认', 'reset-initial', true, ['画质', '语言', '主音量', '音乐音量', '音效音量', '亮度', '鼠标灵敏度', '字体缩放', '静音', '全屏', '字幕', '垂直同步', '通知'])], { kind: 'column', maxHeight: 480, overflow: 'scroll' }),
  ] };

PANEL_EVALUATION_SUITE.cases.find(item => item.id === 'eval-graphics').expected.groups = [['画质', '全屏'], ['亮度', '恢复默认']];
PANEL_EVALUATION_SUITE.cases.find(item => item.id === 'eval-character').expected.groups = [['角色名'], ['等级', '金币', '关闭']];
