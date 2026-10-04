/** Mixed natural-language panels with independent explicit expectations. */
import { PANEL_EVALUATION_SUITE } from './suite.mjs';
const originals = new Map(PANEL_EVALUATION_SUITE.cases.map(item => [item.id, item]));
const rows = (id, rename = {}) => originals.get(id).expected.rows.map(row => ({ ...row,
  label: rename[row.label] ?? row.label, ...(row.resetLabels ? { resetLabels: row.resetLabels.map(label => rename[label] ?? label) } : {}) }));
const common = '保留已经列出的全部控件和按钮，不添加其他行。所有滑条、开关、下拉和未说明禁用的按钮启用。现代薄荷色，用于 Web/Pixi；交互只通知宿主或恢复创作初值，不执行实际游戏业务。';
const make = (id, title, text, expectedRows, layout = null) => ({ id, title, request: { requestVersion: '0.1', id, target: 'pixi',
  text: `生成“${title}”面板。${text}${common}` }, expected: { title, rows: expectedRows, layout } });
export const PANEL_COMBINATION_SUITE = { panelEvaluationSuiteVersion: '0.3',
  scope: 'Six independently generated mixed panels; explicit local reset scopes, nested groups and long-list scrolling', cases: [
    make('mix-settings', '综合设置', '单列 column，最大高度 480，溢出滚动。声音分组：主音量 0～100 步长 1 默认 70；静音默认关闭；恢复声音按钮只重置主音量与静音。显示分组：画质下拉低、中、高，默认中；全屏默认关闭；亮度 0～100 步长 1 默认 60；恢复显示按钮只重置画质、全屏、亮度。控制分组：鼠标灵敏度 0.1～2 步长 0.1 默认 1；反转 Y 轴默认关闭；控制方案下拉键鼠、手柄，默认键鼠；恢复控制按钮只重置鼠标灵敏度、反转 Y 轴、控制方案。各分组恢复按钮不得修改其他分组。',
      [...rows('eval-audio', { '恢复默认': '恢复声音' }), ...rows('eval-graphics', { '恢复默认': '恢复显示' }), ...rows('eval-controls', { '恢复默认': '恢复控制' })], { kind: 'column', maxHeight: 480, overflow: 'scroll' }),
    make('mix-profile', '个人偏好', '三个分组依次单列：个人分组放角色名只读文字“蓝莓”，等级只读文字“20”，金币只读文字“1200”。语言分组放语言下拉，简体中文、English、日本語、한국어，默认简体中文，应用语言按钮发送事件。通知分组依次放好友上线、任务完成、活动提醒开关，默认开启、开启、关闭；应用通知按钮禁用，只发送事件。',
      [...rows('eval-character').slice(0, 3), ...rows('eval-language', { '应用': '应用语言' }), ...rows('eval-notifications', { '应用': '应用通知' }).map(row => row.label === '应用通知' ? { ...row, enabled: false } : row)]),
    make('mix-filters', '物品与商店筛选', '双列 grid，画布宽 1400，面板宽 1320，最大高度 480，溢出滚动。背包分组：背包分类下拉全部、武器、防具、消耗品、材料，默认全部；仅收藏默认关闭；排序下拉名称、稀有度、最近获得，默认名称；重置背包按钮只重置这三项。商店分组：商店分类下拉全部、装备、补给，默认全部；预算 0～1000 步长 10 默认 500；仅可购买默认开启；查询按钮发送事件且不重置。',
      [...rows('eval-inventory', { '分类': '背包分类', '重置筛选': '重置背包' }), ...rows('eval-shop', { '分类': '商店分类' })], { kind: 'grid', canvasWidth: 1400, width: 1320, maxHeight: 480, overflow: 'scroll' }),
    make('mix-quest-confirm', '任务操作确认', '单列两个分组：任务分组依次放只读文字，任务名称“森林巡逻”、任务目标“找到三处营地”、奖励“金币 200”，然后追踪、关闭按钮发送事件。确认分组依次放提示只读文字“删除后无法恢复”、取消、确认删除按钮发送事件。无状态字段。',
      [...rows('eval-quest'), ...rows('eval-confirm')]),
    make('mix-nested', '房间与偏好', '根布局 column，最大高度 480，溢出滚动。根容器先放一个 grid 容器，里面依次为房间分组和语言分组；根容器最后放无障碍分组。房间分组：房间只读文字“蓝莓小队”，人数上限只读文字“4”，准备默认关闭，难度下拉简单、普通、困难默认普通，开始按钮禁用，离开按钮启用，两者只发送事件。语言分组：语言下拉简体中文、English、日本語、한국어，默认简体中文；应用按钮发送事件。无障碍分组：字体缩放 80～150 步长 10 默认 100，字幕默认开启，减少动态效果默认关闭，对比度下拉普通、高对比默认普通；恢复默认按钮只重置这四项，不重置准备、难度或语言。',
      [...rows('eval-room'), ...rows('eval-language'), ...rows('eval-accessibility')], { kind: 'column', maxHeight: 480, overflow: 'scroll' }),
    make('mix-advanced-menu', '高级设置与游戏菜单', '单列 column，最大高度 480，溢出滚动。设置分组按顺序：画质下拉低、中、高默认中，语言下拉中文、English默认中文；六个滑条：主音量 0～100 步长 1 默认 70，音乐音量 0～100 步长 1 默认 55，音效音量 0～100 步长 1 默认 60，亮度 0～100 步长 1 默认 60，鼠标灵敏度 1～10 步长 1 默认 5，字体缩放 80～150 步长 10 默认 100；五个开关：静音默认关闭，全屏默认关闭，字幕默认开启，垂直同步默认开启，通知默认开启；恢复默认按钮只重置上述十三项。菜单分组按顺序放新游戏、继续游戏、设置、退出按钮，继续游戏禁用，其余启用，全部发送事件。',
      [...rows('eval-advanced'), ...rows('eval-main-menu')], { kind: 'column', maxHeight: 480, overflow: 'scroll' }),
  ] };

const sizes = [[3, 4, 4], [3, 2, 4], [4, 4], [5, 3], [6, 2, 5], [14, 4]];
PANEL_COMBINATION_SUITE.cases.forEach((item, i) => {
  let offset = 0; item.expected.groups = sizes[i].map(size => { const group = item.expected.rows.slice(offset, offset + size).map(row => row.label); offset += size; return group; });
});
PANEL_COMBINATION_SUITE.cases[4].expected.bodyShape = { kind: 'column', children: [
  { kind: 'grid', children: [{ kind: 'section', index: 0 }, { kind: 'section', index: 1 }] }, { kind: 'section', index: 2 }] };
