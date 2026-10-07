/** Deterministic progress fixture; not a model result or a claim about game loading. */
export const progressRequest = { requestVersion: '0.1', id: 'loading-panel', target: 'pixi',
  text: '生成资源加载面板：加载进度范围 0～1，初始 0.2，以百分比显示，保留一位小数；已下载范围 0～250，初始 50，显示数值保留两位小数；声音开关默认开启；重新开始按钮仅重置加载进度。' };
export function progressIntent(context) {
  const base = { icon: null, sourceQuote: context.request.text };
  return { panelIntentVersion: '0.4', contextSha256: context.sha256, unresolved: [], panel: {
    id: context.request.id, title: '资源加载', themeKey: 'modern-mint-light@0.1.0', panelSurface: null,
    layout: { width: null, canvasWidth: null, canvasHeight: null, maxHeight: null, overflow: 'auto' },
    body: { kind: 'column', children: [{ kind: 'section', id: 'section0', title: '加载状态', rows: [
      { ...base, id: 'row0', kind: 'progress', label: '加载进度', recipeKey: 'settings.progress@0.1.0', max: 1, initial: 0.2, display: 'percent', fractionDigits: 1 },
      { ...base, id: 'row1', kind: 'progress', label: '已下载', recipeKey: 'settings.progress@0.1.0', max: 250, initial: 50, display: 'value', fractionDigits: 2 },
      { ...base, id: 'row2', kind: 'switch', label: '声音', recipeKey: 'settings.switch@0.1.0', enabled: true, initial: true },
      { ...base, id: 'row3', kind: 'button', label: '重新开始', recipeKey: 'settings.button@0.1.0', enabled: true, action: 'reset-initial', resetRows: ['row0'] },
    ] }] },
  } };
}
