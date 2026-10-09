import { focusedLayoutFixtures, layoutSettings } from '../focused-layout-v1/fixture.mjs';
import { semanticSettingsFixture } from '../semantic-controls-v1/fixture.mjs';
import { arrangeIntentSpec } from '../../src/panel-intent.mjs';
import { workbenchRetrieval } from '../../src/workbench-assets.mjs';
import { recommendPanelIcons } from '../../src/asset-usage.mjs';

/** Authored controls and business behavior. Recommendations select only optional decoration. */
export async function assetUsageFixtures(catalog, base, pool) {
  const focused = await focusedLayoutFixtures(catalog), theme = catalog.themes.find(t => t.id === 'modern-blue-dark');
  const settings = semanticSettingsFixture(catalog, base);
  settings.id = 'usage-settings'; settings.title = '声音设置'; settings.sections[0].title = '声音设置';
  settings.state = [{ ...settings.state[0], initial: 70 }, { ...settings.state[1], initial: false }, { ...settings.state[0], id: 'music', initial: 40 }];
  settings.sections[0].rows = [settings.sections[0].rows[0], { ...settings.sections[0].rows[0], id: 'music-row', bind: 'music', label: '音乐', event: 'audio.musicChanged' }, settings.sections[0].rows[1]];
  settings.sections[0].rows[0].label = '主音量';
  settings.sections[1].rows[0].action.fields = ['volume', 'music', 'muted'];
  const pause = structuredClone(focused.menu); pause.id = 'usage-pause'; pause.title = '暂停菜单'; pause.sections[0].title = '暂停菜单';
  pause.sections[0].rows.forEach((row, i) => { row.buttonLabel = ['继续游戏', '设置', '返回主菜单'][i]; row.event = ['menu.resume', 'menu.settings', 'menu.home'][i]; });
  const loading = structuredClone(focused.dialog);
  loading.id = 'usage-loading'; loading.title = '资源加载'; loading.sections[0].title = '资源加载';
  loading.state = [{ id: 'progress', type: 'progress', initial: 35, max: 100 }];
  loading.sections[0].rows = [
    { id: 'status', kind: 'text', recipe: { id: 'settings.text', version: '0.1.0' }, label: '加载状态', text: '正在准备场景资源，请稍候。' },
    { id: 'progress-row', kind: 'progress', recipe: { id: 'settings.progress', version: '0.1.0' }, label: '加载进度', bind: 'progress', format: { mode: 'percent', fractionDigits: 0 } },
  ];
  loading.textLayouts = [{ rowId: 'status', wrap: 'word' }];
  const specs = { settings, role: focused.form, dialog: focused.dialog, pause, menu: focused.menu, loading };
  const requests = {
    settings: '声音设置，主音量、音乐、静音、恢复默认、关闭、保存设置。',
    role: '角色命名，角色名输入框、确认与取消按钮。',
    dialog: '删除存档确认弹窗，说明无法恢复，保留存档和删除存档按钮。',
    pause: '暂停菜单，继续游戏、设置、返回主菜单。',
    menu: '主菜单，开始游戏、设置和退出游戏。',
    loading: '资源加载面板，显示加载进度和状态文字。',
  };
  return Object.fromEntries(Object.entries(specs).map(([name, input]) => {
    const spec = arrangeIntentSpec(input, layoutSettings(name === 'settings' ? 760 : undefined), theme);
    spec.provenance = { kind: 'programmatic-fixture', description: 'Owned icon usage fixture; not a model-generated panel.', assumptions: [] };
    const retrieval = workbenchRetrieval(requests[name], pool), usage = recommendPanelIcons(spec, requests[name], retrieval);
    const chosen = structuredClone(spec), rowIcons = usage.rows.filter(row => row.recommendedAsset).map(row => ({ rowId: row.rowId, asset: row.recommendedAsset }));
    if (rowIcons.length) chosen.assets = { library: usage.library, panelSurface: null, rowIcons };
    return [name, { spec, chosen, requestText: requests[name], retrieval, usage }];
  }));
}
