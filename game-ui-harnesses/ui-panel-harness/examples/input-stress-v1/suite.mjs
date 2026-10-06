/** New human-authored inputs and independent business expectations; never generated proposals. */
import { PANEL_EVALUATION_SUITE } from '../panel-evaluation/suite.mjs';

const texts = {
  'eval-audio': '帮我做个声音设置。主音量是能拖动的条，0到100，一格1，先按70来……改一下，最终默认65。静音做开关，开始不静音，打开才静音。底下恢复默认只恢复这两项。顺序：主音量、静音、恢复默认。',
  'eval-graphics': '画质设置分成显示和调节两块。显示里先画质下拉，选项按低/中/高排列，默认高，再放默认关闭的全屏开关；调节里先亮度滑块，范围0到100、步长1、初始50，再放恢复默认按钮，恢复画质、全屏、亮度。两块用两列grid，窄了改一列，不能折叠。逻辑画布宽1000，面板宽940。',
  'eval-controls': '控制设置：第一行鼠标灵敏度用拖动条，min=0.2，max=2，step=0.1，default=1.2。下一行反转 Y 轴开关，默认开启，开就表示反转。再下一行控制方案下拉，键鼠在前、手柄在后，默认手柄。最后恢复默认按钮只恢复这三项。',
  'eval-accessibility': '无障碍设置，从上到下是字体缩放滑动条（最小八十，最大一百五十，每次十，默认一百二十）、字幕开关（默认开）、减少动态效果开关（默认开）、对比度下拉（普通、高对比，默认高对比）、恢复默认。开关打开表示启用对应功能，按钮恢复刚才四项。',
  'eval-notifications': '通知设置只要四行：好友上线、任务完成、活动提醒，这三个做开关，初始分别关、开、开，开就启用该提醒；最后放应用按钮，它只是通知宿主，不要重置。',
  'eval-language': '标题：语言设置。语言用 dropdown，下拉选项必须依次保留原文：简体中文、English、日本語、한국어；initial=English。下面放应用按钮，只 emit 通知宿主，不重置。不要把语言名翻译成别的写法。',
  'eval-main-menu': '主菜单只放按钮，新游戏→继续游戏→设置→退出，顺序就是这个。没有存档，所以继续游戏灰掉且不可点击，另外三个可点。点击发事件给宿主，不操作真实游戏；不要引入状态字段。',
  'eval-pause': '暂停菜单，只有继续、设置、返回主菜单，三者都是可以点的按钮，按这个顺序排。都只发事件，不放开关或滑条，也不需要状态字段。',
  'eval-confirm': '做删除确认，先一行只读提示，标签就是提示，显示“删除后无法恢复”。下面先取消按钮再确认删除按钮，都可点击且只通知宿主，不执行删除，也没有状态字段。',
  'eval-save': '存档管理：存档槽只读显示槽位 2，状态只读显示已有存档；接着保存和读取两个按钮，保存暂时不可点击、读取可以点。按钮只发送事件，不读写文件。没有可变状态，四行按描述顺序。',
  'eval-character': '角色信息面板，两列grid，窄的时候一列，不折叠。左边角色分组，只有角色名只读文本，值为Blueberry；右边属性分组，依次等级只读显示21、金币只读显示1200、关闭按钮。关闭可以点，只发事件。逻辑画布宽1000、面板宽940，没有状态字段。',
  'eval-quest': '任务详情先展示任务名称：森林巡逻，再展示任务目标：找到三处营地，再展示奖励：金币 200。这三个均是只读文本行，标签保留任务名称、任务目标、奖励。最后追踪和关闭两个可点击按钮，只发送事件；无需可变状态。',
  'eval-inventory': '给背包筛选弄个面板：分类下拉按全部、武器、防具、消耗品、材料排，默认材料；下一行仅收藏开关，默认开，开就只看收藏；下一行排序下拉按名称、稀有度、最近获得排，初始最近获得；最后重置筛选按钮，只还原刚才这三项。不要画物品列表。',
  'eval-shop': '商店筛选，先分类下拉：全部/装备/补给，默认补给；再预算，弄条可以拖的条，0到1000，每格10，先500。不，预算最终默认750。再仅可购买开关，初始开启，开启表示只看可购买；最后查询按钮，只发事件不重置，不实际买东西。',
  'eval-room': '房间准备按这个顺序：房间只读文字蓝莓小队、人数上限只读文字4、准备开关初始关（开才表示准备）、难度下拉简单/普通/困难初始困难、开始按钮、离开按钮。开始不可点击，离开可点；两按钮只通知宿主，不连接网络。',
  'eval-advanced': '高级设置，单列column，面板最高480，装不下就竖向滚动。先画质下拉低/中/高默认中，再语言下拉中文/English默认中文；然后主音量、音乐音量、音效音量、亮度四个能拖的条，都是0到100，步长1，默认依次70、55、60、60；再鼠标灵敏度滑块1到10、步长1、默认5；再字体缩放滑动条80到150、步长10、默认100；接着静音、全屏、字幕、垂直同步、通知五个开关，默认依次关、关、开、开、开，开表示启用标签所说的功能；最后恢复默认按钮恢复以上全部十三项。',
};
const common = '面板标题保留上面给出的名称。使用现代薄荷色风格，面向Web/Pixi。仅保留明确列出的控件、按钮和顺序；未说明禁用的交互均启用。所有交互通知宿主，按钮仅发事件或重置列出的初值，不执行实际业务。';
export const INPUT_STRESS_SUITE = {
  panelEvaluationSuiteVersion: '0.3',
  scope: 'One new independent input per existing panel family; inline corrections, colloquial controls, mixed notation and unspecified visual choices. Not repeated-run or arbitrary-input reliability certification.',
  cases: PANEL_EVALUATION_SUITE.cases.map(original => {
    const item = structuredClone(original);
    item.request.text = `${texts[item.id]}${common}`;
    return item;
  }),
};
const row = (id, label) => INPUT_STRESS_SUITE.cases.find(item => item.id === id).expected.rows.find(item => item.label === label);
row('eval-audio', '主音量').initial = 65;
row('eval-graphics', '画质').initialLabel = '高';
row('eval-graphics', '亮度').initial = 50;
Object.assign(row('eval-controls', '鼠标灵敏度'), { min: 0.2, initial: 1.2 });
row('eval-controls', '反转 Y 轴').initial = true;
row('eval-controls', '控制方案').initialLabel = '手柄';
row('eval-accessibility', '字体缩放').initial = 120;
row('eval-accessibility', '减少动态效果').initial = true;
row('eval-accessibility', '对比度').initialLabel = '高对比';
row('eval-notifications', '好友上线').initial = false;
row('eval-notifications', '活动提醒').initial = true;
row('eval-language', '语言').initialLabel = 'English';
row('eval-save', '存档槽').text = '槽位 2';
row('eval-save', '状态').text = '已有存档';
row('eval-save', '保存').enabled = false;
row('eval-save', '读取').enabled = true;
row('eval-character', '角色名').text = 'Blueberry';
row('eval-character', '等级').text = '21';
row('eval-inventory', '分类').initialLabel = '材料';
row('eval-inventory', '仅收藏').initial = true;
row('eval-inventory', '排序').initialLabel = '最近获得';
row('eval-shop', '分类').initialLabel = '补给';
row('eval-shop', '预算').initial = 750;
row('eval-room', '难度').initialLabel = '困难';

export const EDIT_STRESS_STEPS = [
  { id: 'edit01', text: '主音量默认值改为50，其他不变。', expectation: 'default50' },
  { id: 'edit02', text: '主音量的标签改为总音量，其他不变。', expectation: 'label' },
  { id: 'edit03', text: '在总音量之后、静音之前新增音效音量滑条，范围0到100，步长1，默认40，启用，只通知宿主；不加图标，不修改恢复默认按钮，它仍只重置总音量和静音。其他不变。', expectation: 'add' },
  { id: 'edit04', text: '恢复默认按钮现在重置总音量、音效音量、静音三项，其他不变。', expectation: 'resetAll' },
  { id: 'edit05', text: '面板标题改为声音选项，最大高度改为480，仍单列并在溢出时竖向滚动。其他不变。', expectation: 'layout' },
  { id: 'edit06', text: '删除静音开关及其状态，并从恢复默认按钮的重置范围移除静音；按钮仍重置总音量和音效音量，其他不变。', expectation: 'deleteMute' },
  { id: 'edit07', text: '恢复默认按钮上显示的文字改为恢复声音，重置范围和其他内容保持不变。', expectation: 'buttonLabel' },
  { id: 'edit08', text: '删除音效音量滑条及其状态，并从恢复声音按钮重置范围移除音效音量；按钮现在只重置总音量，其他不变。', expectation: 'deleteEffects' },
].map(step => ({ ...step, request: { requestVersion: '0.1', id: 'panel-edit', target: 'pixi', text: step.text } }));
