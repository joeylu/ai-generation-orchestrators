import { ORDINAL_STABILITY_SUITE } from '../ordinal-stability-v1/suite.mjs';
import { compactIntentFixture } from '../panel-evaluation/intent-fixture.mjs';
import { tabsIntent } from '../tabs-v1/fixture.mjs';
import { ordinalFixture } from '../../tests/ordinal-intent-fixture.mjs';
const slider = (label, min, max, step, initial) => ({ kind: 'slider', label, min, max, step, initial, enabled: true });
const toggle = (label, initial) => ({ kind: 'switch', label, initial, enabled: true });
const reset = (label, resetLabels) => ({ kind: 'button', label, action: 'reset-initial', resetLabels, enabled: true });
const advanced = structuredClone(ORDINAL_STABILITY_SUITE.cases.find(item => item.id === 'eval-advanced'));
export const QUOTE_RECHECK_SUITE = { panelEvaluationSuiteVersion: '0.3',
  scope: 'Original failed long request, repeated-word clarification and tabs/progress native quote guard. Three fresh single attempts; not repeated all16 certification.',
  cases: [advanced, {
    id: 'quote-clarified-audio', title: '声音设置',
    request: { requestVersion: '0.1', id: 'quote-clarified-audio', target: 'pixi', text: '生成“声音设置”面板，依次放音量滑条、静音开关和恢复默认按钮。\n【补充回答】\n问题：音量范围、步长、默认值和静音默认值是多少？\n回答：音量0到100、步长1、默认70；静音默认关闭，开启表示静音；恢复默认只重置音量和静音。\n标签必须逐字为“音量”、“静音”、“恢复默认”。所有控件启用，使用现代薄荷色风格。只保留这三行，交互只通知宿主，不连接实际游戏。' },
    expected: { title: '声音设置', rows: [slider('音量', 0, 100, 1, 70), toggle('静音', false), reset('恢复默认', ['音量', '静音'])], layout: null },
  }, {
    id: 'quote-tabs-progress', title: '分页设置',
    request: { requestVersion: '0.1', id: 'quote-tabs-progress', target: 'pixi', text: '生成“分页设置”面板，只有横向“声音”和“显示”两个页签，默认打开声音页。声音页按顺序只有主音量滑条0～100、步长1、默认70，静音开关默认关闭（开启表示静音），恢复声音按钮只重置主音量和静音。显示页按顺序只有亮度滑条0～100、步长1、默认60，以及加载进度条0～1、初始0.2、百分比显示一位小数。所有交互和页签导航启用，进度条只读，由宿主更新。使用现代薄荷色风格，交互只通知宿主，不连接实际游戏。不添加其他行、按钮或页签。' },
    expected: { title: '分页设置', layout: null,
      rows: [slider('主音量', 0, 100, 1, 70), toggle('静音', false), reset('恢复声音', ['主音量', '静音']), slider('亮度', 0, 100, 1, 60),
        { kind: 'progress', label: '加载进度', max: 1, initial: 0.2, format: { mode: 'percent', fractionDigits: 1 } }],
      tabs: { enabled: true, initialLabel: '声音', pages: [{ label: '声音', rowLabels: ['主音量', '静音', '恢复声音'] }, { label: '显示', rowLabels: ['亮度', '加载进度'] }] },
    },
  }] };

/** Owned expected fixture conversion only. Never called to repair a model response. */
export function quoteRecheckFixture(context, item) {
  if (!item.expected.tabs) return ordinalFixture(compactIntentFixture(context, item));
  const fixture = ordinalFixture(tabsIntent(context));
  const visit = node => {
    if (node.kind === 'tabs') { node.sourceQuote = context.request.text; node.pages.forEach(page => { page.sourceQuote = context.request.text; visit(page.body); }); }
    else if (node.kind === 'section') node.rows.forEach(row => { row.sourceQuote = context.request.text; });
    else node.children.forEach(visit);
  };
  visit(fixture.panel.body); return fixture;
}

export function nativeQuotes(intent) {
  const quotes = [];
  const visit = node => {
    if (node.kind === 'tabs') { quotes.push(node.sourceQuote); node.pages.forEach(page => { quotes.push(page.sourceQuote); visit(page.body); }); }
    else if (node.kind === 'section') node.rows.forEach(row => quotes.push(row.sourceQuote));
    else node.children.forEach(visit);
  };
  if (intent.panel) visit(intent.panel.body); return quotes;
}
