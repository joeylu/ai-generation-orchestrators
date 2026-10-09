import { createPanelHost } from '../../src/panel-host.mjs';
import { pixiPanelCore, mountPixiPanelInstance } from '../../src/pixi-panel-instance.mjs';
const seed = JSON.parse(document.getElementById('review-seed').textContent);
const name = new URL(location.href).searchParams.get('panel') ?? 'settings-light', entry = seed[name];
const events = [], errors = [];
const reasons = { SEMANTIC_MATCH: '用途匹配', TEXT_ACTION: '文字操作更清晰', READ_ONLY_CONTENT: '正文与进度不加装饰',
  EXPLICIT_ACTION_LAYOUT: '保留操作区布局', INLINE_GLYPH: '已有符号', NO_MATCH: '没有合适素材',
  STYLE_FALLBACK: '保持统一风格', REPEATED_ICON: '减少重复图标', SECTION_BUDGET: '控制装饰数量', AMBIGUOUS_MATCH: '含义不够明确',
  MENU_TEXT_FALLBACK: '整组菜单保持文字与对齐' };
const host = createPanelHost({ core: pixiPanelCore, mount: mountPixiPanelInstance,
  onEvent: event => { events.push(event); document.getElementById('feedback').textContent = `已触发 ${event.event.name}`; },
  onError: error => errors.push(error.code) });
window.assetUsageReview = Object.freeze({ get: id => host.get(id), source: id => structuredClone(entry[id]),
  events: () => structuredClone(events), errors: () => structuredClone(errors) });
async function start() {
  if (!entry) throw new Error('USAGE_REVIEW_PANEL');
  document.getElementById('name').textContent = entry.title;
  document.getElementById('assets').textContent = entry.assetNames.join(' · ') || '保持文字界面，没有强行添加图标。';
  for (const row of entry.usage.rows) {
    const element = document.createElement('li');
    element.textContent = `${entry.labels[row.rowId]}：${row.recommendedAsset ? entry.assetLabels[row.recommendedAsset] : '保留文字'} · ${reasons[row.reason]}`;
    document.getElementById('decisions').append(element);
  }
  for (const id of ['before', 'after']) await host.add(id, entry[id], { container: document.getElementById(id) });
  document.getElementById('download').href = `delivery/${name}.panel-delivery.zip`;
  document.documentElement.dataset.ready = 'true';
}
window.addEventListener('pagehide', () => host.destroy(), { once: true });
start().catch(() => { errors.push('USAGE_REVIEW_MOUNT'); document.documentElement.dataset.ready = 'error'; });
